import io
import json
import tempfile
import zipfile
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings


def _zip(files: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


PLUGIN_JS = "SlideForgePlugins.register({ id: 'demo', render: () => '<svg/>' });"


class PluginManagerTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.user_dir = root / "plugins"
        self.state_file = root / "plugin-settings.json"
        self.override = override_settings(
            SLIDEFORGE_USER_PLUGINS_DIR=str(self.user_dir), SLIDEFORGE_PLUGIN_STATE_FILE=str(self.state_file)
        )
        self.override.enable()
        users = get_user_model().objects
        self.staff = Client()
        self.staff.force_login(users.create_user(username="admin", password="pw-123456789", is_staff=True))
        self.member = Client()
        self.member.force_login(users.create_user(username="member", password="pw-123456789"))

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def listing(self, client=None):
        return (client or self.staff).get("/api/plugins/").json()

    def install(self, files, client=None):
        upload = SimpleUploadedFile("plugin.zip", _zip(files), content_type="application/zip")
        return (client or self.staff).post("/api/plugins/install/", {"plugin": upload})

    def test_built_in_plugins_are_listed_with_their_description_and_on_by_default(self):
        data = self.listing()
        smiles = next(p for p in data["plugins"] if p["id"] == "smiles")
        self.assertEqual(smiles["source"], "bundled")
        self.assertTrue(smiles["enabled"])
        self.assertEqual(smiles["script"], "/plugins/smiles/plugin.js")
        self.assertIn("SMILES", smiles["name"])
        built_in = {p["id"]: p for p in data["plugins"] if p["source"] == "bundled"}
        expected = json.loads((settings.FRONTEND_DIR / "plugins" / "plugins.json").read_text())["plugins"]
        self.assertEqual(len(expected), 26)
        for plugin_id in expected:
            self.assertTrue(built_in[plugin_id]["enabled"], plugin_id)
            self.assertTrue(built_in[plugin_id].get("description"), plugin_id)
        self.assertTrue(data["canManage"] and data["canInstall"])
        self.assertEqual(data["userDir"], str(self.user_dir.resolve()))

    def test_only_staff_can_change_plugins_on_the_web(self):
        data = self.listing(self.member)
        self.assertFalse(data["canManage"])
        self.assertEqual(data["userDir"], "")
        response = self.member.post("/api/plugins/smiles/", json.dumps({"enabled": False}), content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.install({"demo/plugin.js": PLUGIN_JS}, self.member).status_code, 403)
        self.assertEqual(self.member.delete("/api/plugins/demo/").status_code, 403)

    def test_switching_a_plugin_off_is_remembered(self):
        response = self.staff.post("/api/plugins/smiles/", json.dumps({"enabled": False}), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(next(p for p in response.json()["plugins"] if p["id"] == "smiles")["enabled"])
        self.assertEqual(json.loads(self.state_file.read_text())["enabled"], {"smiles": False})
        self.assertFalse(next(p for p in self.listing(self.member)["plugins"] if p["id"] == "smiles")["enabled"])
        bad = self.staff.post("/api/plugins/smiles/", json.dumps({"enabled": "no"}), content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        missing = self.staff.post("/api/plugins/nope/", json.dumps({"enabled": True}), content_type="application/json")
        self.assertEqual(missing.status_code, 400)

    def test_install_from_zip_serve_update_and_remove(self):
        response = self.install(
            {"demo/plugin.js": PLUGIN_JS, "demo/plugin.json": json.dumps({"name": "Demo", "version": "1"}), "demo/lib/a.js": "1"}
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["installed"], "demo")
        demo = next(p for p in response.json()["plugins"] if p["id"] == "demo")
        self.assertEqual((demo["source"], demo["enabled"], demo["name"], demo["version"]), ("user", True, "Demo", "1"))
        self.assertEqual(demo["script"], "/user-plugins/demo/plugin.js")
        served = self.staff.get("/user-plugins/demo/plugin.js")
        self.assertEqual(served.status_code, 200)
        self.assertIn(b"SlideForgePlugins.register", b"".join(served.streaming_content))
        # A new version (files at the zip's top, id from plugin.json) replaces the old one.
        response = self.install({"plugin.js": PLUGIN_JS, "plugin.json": json.dumps({"id": "demo", "version": "2"})})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse((self.user_dir / "demo" / "lib").exists())
        self.assertEqual(next(p for p in self.listing()["plugins"] if p["id"] == "demo")["version"], "2")
        self.assertEqual(self.staff.delete("/api/plugins/demo/").status_code, 200)
        self.assertFalse((self.user_dir / "demo").exists())
        self.assertNotIn("demo", [p["id"] for p in self.listing()["plugins"]])
        # Built-in plugins cannot be removed.
        self.assertEqual(self.staff.delete("/api/plugins/smiles/").status_code, 400)

    def test_bad_zips_are_refused_and_nothing_is_written(self):
        cases = [
            ({"demo/readme.txt": "no script"}, "no plugin.js"),
            ({"../evil/plugin.js": PLUGIN_JS}, "unsafe path"),
            ({"smiles/plugin.js": PLUGIN_JS}, "already called"),
            ({"plugin.js": PLUGIN_JS}, "needs an id"),
            ({"Bad_Name/plugin.js": PLUGIN_JS}, "needs an id"),
        ]
        for files, message in cases:
            response = self.install(files)
            self.assertEqual(response.status_code, 400, files)
            self.assertIn(message, response.json()["error"], files)
        upload = SimpleUploadedFile("plugin.zip", b"not a zip", content_type="application/zip")
        self.assertEqual(self.staff.post("/api/plugins/install/", {"plugin": upload}).status_code, 400)
        self.assertEqual([p.name for p in self.user_dir.iterdir()], [])

    def test_a_user_plugin_cannot_take_a_built_in_name(self):
        (self.user_dir / "smiles").mkdir(parents=True)
        (self.user_dir / "smiles" / "plugin.js").write_text(PLUGIN_JS)
        clash = [p for p in self.listing()["plugins"] if p["id"] == "smiles" and p["source"] == "user"][0]
        self.assertFalse(clash["enabled"])
        self.assertIn("already called", clash["error"])

    def test_unsafe_manifest_values_are_dropped(self):
        (self.user_dir / "demo").mkdir(parents=True)
        (self.user_dir / "demo" / "plugin.js").write_text(PLUGIN_JS)
        (self.user_dir / "demo" / "plugin.json").write_text(
            json.dumps({"icon": 'fa-x" onmouseover="alert(1)', "homepage": "javascript:alert(1)", "name": "D"})
        )
        demo = next(p for p in self.listing()["plugins"] if p["id"] == "demo")
        self.assertNotIn("icon", demo)
        self.assertNotIn("homepage", demo)
        self.assertEqual(demo["name"], "D")

    @override_settings(SLIDEFORGE_USER_PLUGINS_DIR=None)
    def test_without_a_user_folder_install_is_off_and_user_plugin_urls_404(self):
        data = self.listing()
        self.assertFalse(data["canInstall"])
        self.assertEqual(self.install({"demo/plugin.js": PLUGIN_JS}).status_code, 400)
        self.assertEqual(self.staff.get("/user-plugins/demo/plugin.js").status_code, 404)


class PluginLookupPolicyTests(TestCase):
    def test_the_page_may_fetch_only_the_lookup_services_plugins_use(self):
        response = Client().get("/")
        header = response.get("Content-Security-Policy") or response.get("Content-Security-Policy-Report-Only") or ""
        connect = next(part for part in header.split(";") if part.strip().startswith("connect-src")).split()[1:]
        self.assertEqual(sorted(connect), sorted(["'self'", "https://pubchem.ncbi.nlm.nih.gov", "https://api.crossref.org"]))
