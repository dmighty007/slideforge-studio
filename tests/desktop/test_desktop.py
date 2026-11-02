import io
import json
import shutil

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from pptx import Presentation as PptxPresentation
from django.test import Client, TestCase, override_settings

from slideforge.desktop.middleware import get_local_user, launch_cookie_name
from slideforge.desktop.paths import FRONTEND_DIR


class LocalUserTests(TestCase):
    def test_session_reports_local_user_without_sign_in(self):
        response = Client().get("/api/auth/session/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"authenticated": True, "user": {"id": get_local_user().id, "username": "local"}, "accountsEnabled": False},
        )

    def test_local_user_cannot_sign_in_with_a_password(self):
        self.assertFalse(get_local_user().has_usable_password())

    def test_sign_in_endpoints_are_gone(self):
        client = Client()
        for path in ("/api/auth/login/", "/api/auth/register/", "/api/auth/logout/", "/admin/"):
            self.assertEqual(client.post(path).status_code, 404, path)

    def test_presentations_are_created_for_local_user(self):
        response = Client().post(
            "/api/presentations/",
            data='{"title": "Deck", "state": {"slides": []}}',
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["title"], "Deck")


@override_settings(SLIDEFORGE_LAUNCH_TOKEN="launch-secret")
class LaunchTokenTests(TestCase):
    def test_request_without_token_is_refused(self):
        self.assertEqual(Client().get("/").status_code, 403)
        self.assertEqual(Client().get("/api/auth/session/").status_code, 403)

    def test_bundled_frontend_code_loads_without_the_cookie(self):
        # The sandboxed molecule viewer fetches vendor/ngl/ngl.js without cookies.
        for path in ("/vendor/dompurify/purify.min.js", "/js/core/state.js", "/plugins/plugins.json"):
            response = Client().get(path)
            self.assertEqual(response.status_code, 200, path)
            response.close()
        for path in ("/", "/api/auth/session/", "/media/assets/x.png"):
            self.assertEqual(Client().get(path).status_code, 403, path)

    def test_wrong_token_is_refused(self):
        self.assertEqual(Client().get("/?token=nope").status_code, 403)
        self.assertEqual(Client().get("/?token=%C3%A9").status_code, 403)

    def test_token_is_traded_for_cookie_and_removed_from_url(self):
        client = Client()
        response = client.get("/?token=launch-secret&slide=2")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/?slide=2")
        cookie = response.cookies[launch_cookie_name(80)]
        self.assertEqual(cookie.value, "launch-secret")
        self.assertTrue(cookie["httponly"])
        self.assertEqual(client.get("/").status_code, 200)
        self.assertEqual(client.get("/api/auth/session/").status_code, 200)


class DesktopServingTests(TestCase):
    def test_frontend_assets_are_served_with_debug_off(self):
        self.assertFalse(settings.DEBUG)
        client = Client()
        for path in ("/", "/js/core/state.js", "/css/base.css", "/vendor/dompurify/purify.min.js", "/plugins/smiles/plugin.js"):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, path)
            if hasattr(response, "close"):
                response.close()

    def test_csp_only_on_html_so_the_pdf_viewer_is_not_blocked(self):
        (settings.MEDIA_ROOT / "csp-test.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
        client = Client()
        page = client.get("/")
        pdf = client.get("/media/csp-test.pdf")

        self.assertIn("Content-Security-Policy", page)
        self.assertEqual(pdf.status_code, 200)
        self.assertNotIn("Content-Security-Policy", pdf)
        for response in (page, pdf):
            response.close()

    def test_data_lives_in_the_data_directory(self):
        # The database path is checked end to end by the installed-app test (tests run on a test database).
        self.assertTrue(str(settings.MEDIA_ROOT).startswith(str(settings.DATA_DIR)))
        self.assertTrue((settings.DATA_DIR / "secret_key").exists())


class DesktopPluginTests(TestCase):
    def test_the_local_user_manages_plugins_in_the_data_directory(self):
        folder = settings.DATA_DIR / "plugins"
        data = Client().get("/api/plugins/").json()
        self.assertTrue(data["canManage"] and data["canInstall"])
        self.assertEqual(data["userDir"], str(folder.resolve()))
        (folder / "demo").mkdir(parents=True, exist_ok=True)
        (folder / "demo" / "plugin.js").write_text("// demo", encoding="utf-8")
        try:
            response = Client().get("/user-plugins/demo/plugin.js")
            self.assertEqual(response.status_code, 200)
            response.close()
            ids = [p["id"] for p in Client().get("/api/plugins/").json()["plugins"]]
            self.assertIn("demo", ids)
            self.assertEqual(Client().delete("/api/plugins/demo/").status_code, 200)
            self.assertFalse((folder / "demo").exists())
        finally:
            shutil.rmtree(folder / "demo", ignore_errors=True)

    def test_plugin_lookups_are_allowed_by_the_page_policy(self):
        header = Client().get("/")["Content-Security-Policy"]
        self.assertIn("connect-src 'self' https://pubchem.ncbi.nlm.nih.gov https://api.crossref.org", header)

    @override_settings(SLIDEFORGE_LAUNCH_TOKEN="launch-secret")
    def test_user_plugins_and_the_plugin_api_need_the_launch_token(self):
        # Built-in plugin code is public like /js/; the user's own plugins and the API are the user's data.
        self.assertEqual(Client().get("/plugins/plugins.json").status_code, 200)
        self.assertEqual(Client().get("/user-plugins/demo/plugin.js").status_code, 403)
        self.assertEqual(Client().get("/api/plugins/").status_code, 403)


class NoSignInUiTests(TestCase):
    def test_page_is_served_with_accounts_disabled(self):
        response = Client().get("/")
        self.assertContains(response, '<body class="accounts-disabled ')
        # Only the desktop app's page looks for updates (js/ui/updates.js).
        self.assertContains(response, '<body class="accounts-disabled desktop-app ')

    def test_css_hides_all_sign_in_ui_when_accounts_are_disabled(self):
        css = (FRONTEND_DIR / "css" / "base.css").read_text(encoding="utf-8")
        for selector in ("body.accounts-disabled #entry-hero", "body.accounts-disabled #auth-modal", "body.accounts-disabled .toolbar-auth"):
            self.assertIn(selector, css)

    def test_session_reports_accounts_disabled(self):
        self.assertFalse(Client().get("/api/auth/session/").json()["accountsEnabled"])


class UploadedMediaExportTests(TestCase):
    def test_uploaded_image_is_included_in_pptx_export(self):
        # Uploads live in the data directory, not the package; the exporter must still find them.
        png = io.BytesIO()
        Image.new("RGB", (64, 48), (200, 30, 30)).save(png, format="PNG")
        client = Client()
        upload = client.post("/api/assets/upload/", {"file": SimpleUploadedFile("red.png", png.getvalue(), "image/png")})
        self.assertEqual(upload.status_code, 201, upload.content)
        image = {"id": "el_1", "type": "image", "content": upload.json()["url"], "x": 10, "y": 10,
                 "width": "200px", "height": "150px", "styles": {}}
        state = {"slides": [{"id": "slide_1", "elements": [image]}]}

        response = client.post(
            "/api/presentations/export/pptx/",
            data=json.dumps({"state": state, "title": "Deck"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        deck = PptxPresentation(io.BytesIO(b"".join(response.streaming_content)))
        pictures = [shape for slide in deck.slides for shape in slide.shapes if shape.shape_type == 13]
        self.assertEqual(len(pictures), 1)


class FrontendCachingTests(TestCase):
    """After an update the window must not mix cached old scripts with new ones (ES modules import each other by
    plain relative paths, so a stale module breaks the page)."""

    def test_scripts_styles_and_the_page_are_always_revalidated(self):
        client = Client()
        for path in ("/js/mermaid/mermaid-graph.js", "/css/base.css", "/"):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response["Cache-Control"], "no-cache", path)

    def test_a_changed_file_is_sent_again_even_when_its_date_went_back(self):
        import os
        import tempfile
        from django.test import RequestFactory
        from slideforge.studio.frontend_files import serve_frontend_file

        root = tempfile.mkdtemp()
        script = os.path.join(root, "engine.js")
        with open(script, "w") as handle:
            handle.write("old();")
        os.utime(script, (2_000_000_000, 2_000_000_000))
        first = serve_frontend_file(RequestFactory().get("/engine.js"), "engine.js", document_root=root)
        tag, date = first["ETag"], first["Last-Modified"]
        # The browser asks again with what it has: unchanged, it gets a 304.
        again = serve_frontend_file(RequestFactory().get("/engine.js", HTTP_IF_NONE_MATCH=tag, HTTP_IF_MODIFIED_SINCE=date), "engine.js", document_root=root)
        self.assertEqual(again.status_code, 304)
        # Replaced by a newer version whose file date is older (restored from git): sent again.
        with open(script, "w") as handle:
            handle.write("fixed_engine();")
        os.utime(script, (1_900_000_000, 1_900_000_000))
        changed = serve_frontend_file(RequestFactory().get("/engine.js", HTTP_IF_NONE_MATCH=tag, HTTP_IF_MODIFIED_SINCE=date), "engine.js", document_root=root)
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(b"".join(changed.streaming_content), b"fixed_engine();")
        # A copy cached before files had tags (date only) is sent again too.
        dated_only = serve_frontend_file(RequestFactory().get("/engine.js", HTTP_IF_MODIFIED_SINCE=date), "engine.js", document_root=root)
        self.assertEqual(dated_only.status_code, 200)


class ShareTunnelTests(TestCase):
    """The public tunnel reaches shared presentations (/s/...) and nothing else."""

    def call(self, path, method="GET"):
        from slideforge.desktop.share_tunnel import share_only_app

        captured = {}

        def start_response(status, headers, exc_info=None):
            captured["status"] = int(status.split()[0])

        environ = {
            "REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": "", "SERVER_NAME": "x.trycloudflare.com",
            "SERVER_PORT": "443", "HTTP_HOST": "x.trycloudflare.com", "wsgi.url_scheme": "https",
            "wsgi.input": io.BytesIO(), "wsgi.errors": io.StringIO(), "SERVER_PROTOCOL": "HTTP/1.1",
        }
        body = share_only_app(environ, start_response)
        b"".join(body)
        if hasattr(body, "close"):
            body.close()
        return captured["status"]

    def test_editor_api_and_media_are_not_reachable_through_the_tunnel(self):
        for path in ("/", "/index.html", "/api/presentations/", "/api/share/tunnel/", "/media/x.png", "/js/core/state.js"):
            self.assertEqual(self.call(path), 404, path)
        self.assertEqual(self.call("/s/AAAAAAAAAAAAAAAAAAAAAA/", method="POST"), 404)

    def test_shared_presentation_is_served_through_the_tunnel(self):
        from slideforge.studio import sharing
        from slideforge.studio.models import Presentation, ShareLink

        deck = Presentation.objects.create(owner=get_local_user(), title="Deck")
        share = ShareLink.objects.create(presentation=deck, token=sharing.new_token())
        self.addCleanup(sharing.delete_bundle, share.token)
        buffer = io.BytesIO()
        import zipfile

        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("index.html", "<!doctype html><title>Deck</title>")
        sharing.publish(share, buffer.getvalue())

        self.assertEqual(self.call(f"/s/{share.token}/"), 200)
        self.assertEqual(self.call("/s/AAAAAAAAAAAAAAAAAAAAAA/"), 404)

    @override_settings(SLIDEFORGE_LAUNCH_TOKEN="launch-secret")
    def test_tunnel_controls_need_the_launch_token(self):
        self.assertEqual(Client().get("/api/share/tunnel/").status_code, 403)
        self.assertEqual(Client().post("/api/share/tunnel/", data='{"action": "start"}', content_type="application/json").status_code, 403)

    def test_tunnel_address_is_read_from_cloudflared(self):
        import sys
        import tempfile
        from pathlib import Path
        from unittest import mock

        from slideforge.desktop.share_tunnel import ShareTunnel

        with tempfile.TemporaryDirectory() as data_dir:
            fake = Path(data_dir) / "bin" / "cloudflared"
            fake.parent.mkdir()
            # Prints what cloudflared prints, records its arguments, then stays up like a running tunnel.
            fake.write_text(
                f"#!{sys.executable}\nimport sys, time, pathlib\n"
                f"pathlib.Path({str(Path(data_dir) / 'args')!r}).write_text(' '.join(sys.argv[1:]))\n"
                "print('INF |  https://quiet-river-demo.trycloudflare.com                                  |', flush=True)\n"
                "time.sleep(60)\n"
            )
            fake.chmod(0o755)
            tunnel = ShareTunnel(Path(data_dir))
            with mock.patch("shutil.which", return_value=None):
                self.assertEqual(tunnel.binary(), str(fake))
                tunnel.start()
                try:
                    self.assertEqual(tunnel.wait_for_url(15), "https://quiet-river-demo.trycloudflare.com")
                    status = tunnel.status()
                    self.assertTrue(status["running"])
                    self.assertEqual(status["url"], "https://quiet-river-demo.trycloudflare.com")
                    args = (Path(data_dir) / "args").read_text()
                    port = tunnel._server.effective_port
                    self.assertIn(f"--url http://127.0.0.1:{port}", args)
                    self.assertIn("--no-autoupdate", args)
                finally:
                    tunnel.shutdown()
                self.assertFalse(tunnel.status()["running"])
                self.assertIsNone(tunnel.status()["url"])


class WindowStorageTests(TestCase):
    """The window's cookies and localStorage live in <data dir>/webview, not in a profile shared by every window."""

    def test_the_qt_backend_uses_the_data_directory_for_its_profile(self):
        import importlib.util

        # The Qt window backend is the optional "qt" extra (PyQt or PySide through qtpy); CI installs only "dev".
        if importlib.util.find_spec("qtpy") is None:
            self.skipTest("the Qt backend (pip install slideforge-studio[qt]) is not installed")
        from webview.platforms import qt as pywebview_qt

        from slideforge.desktop import qt_support

        before = pywebview_qt._profile_storage_path
        try:
            # Importing the backend (as qt_support.prepare does) fixed the path at ~/.pywebview before start() ran.
            self.assertTrue(before.endswith(".pywebview") or before.endswith("webview"))
            qt_support.use_storage_path("/tmp/sf-data/webview")
            self.assertEqual(pywebview_qt._profile_storage_path, "/tmp/sf-data/webview")
        finally:
            pywebview_qt._profile_storage_path = before

    def test_only_the_default_data_directory_takes_over_the_old_shared_storage(self):
        import tempfile
        from pathlib import Path
        from unittest import mock

        from slideforge.desktop import app

        with tempfile.TemporaryDirectory() as root:
            home = Path(root) / "home"
            (home / ".pywebview" / "Local Storage").mkdir(parents=True)
            (home / ".pywebview" / "Local Storage" / "leveldb").write_text("open project")
            default = Path(root) / "SlideForge"
            other = Path(root) / "test-data"
            with mock.patch("pathlib.Path.home", return_value=home), mock.patch.object(app.paths, "default_data_dir", return_value=default):
                self.assertEqual(app._webview_storage(other), other.resolve() / "webview")
                self.assertFalse((other / "webview" / "Local Storage").exists())
                self.assertEqual(app._webview_storage(default), default.resolve() / "webview")
                self.assertEqual((default / "webview" / "Local Storage" / "leveldb").read_text(), "open project")
                # Only once: later changes in the old place are not copied again.
                (home / ".pywebview" / "Local Storage" / "leveldb").write_text("changed")
                app._webview_storage(default)
                self.assertEqual((default / "webview" / "Local Storage" / "leveldb").read_text(), "open project")

    def test_webview_storage_is_absolute_for_a_relative_data_dir(self):
        # Qt kept cookies in a relative profile folder but dropped localStorage: the open project, the
        # last view and the unsaved-change backups were lost at every restart of `slideforge --data-dir ./data`.
        import os
        import tempfile
        from pathlib import Path

        from slideforge.desktop import app

        with tempfile.TemporaryDirectory() as root:
            cwd = os.getcwd()
            try:
                os.chdir(root)
                storage = app._webview_storage(Path("data"))
            finally:
                os.chdir(cwd)
            self.assertTrue(storage.is_absolute())
            self.assertEqual(storage, (Path(root) / "data" / "webview").resolve())


class QtPermissionTests(TestCase):
    """pywebview's own permission handler passes an int where PyQt6 wants an enum; the TypeError aborted the app
    the first time a page asked for the clipboard (Share > Copy)."""

    def test_permission_requests_are_answered_with_enums_and_never_raise(self):
        import unittest

        from slideforge.desktop import qt_support

        if not qt_support.available():
            raise unittest.SkipTest("Qt WebEngine is not installed")
        from qtpy.QtCore import QUrl
        from qtpy.QtWebEngineCore import QWebEnginePage
        from webview.platforms import qt as pywebview_qt

        qt_support._app_port = 8123
        qt_support._patch_permissions()
        handler = pywebview_qt.BrowserView.WebPage.onFeaturePermissionRequested
        answers = []

        class Page:
            def setFeaturePermission(self, url, feature, policy):
                assert isinstance(policy, QWebEnginePage.PermissionPolicy), type(policy)
                answers.append((url.port(), feature, policy))

        feature = QWebEnginePage.Feature
        policy = QWebEnginePage.PermissionPolicy
        handler(Page(), QUrl("http://127.0.0.1:8123"), feature.ClipboardReadWrite)
        handler(Page(), QUrl("https://example.com"), feature.ClipboardReadWrite)
        handler(Page(), QUrl("http://127.0.0.1:8123"), feature.Geolocation)
        self.assertEqual(
            [answer[2] for answer in answers],
            [policy.PermissionGrantedByUser, policy.PermissionDeniedByUser, policy.PermissionDeniedByUser],
        )

        class BrokenPage:
            def setFeaturePermission(self, *args):
                raise TypeError("boom")

        handler(BrokenPage(), QUrl("http://127.0.0.1:8123"), feature.ClipboardReadWrite)  # logged, not raised


class QtPopupNavigationTests(TestCase):
    """Opening a share link (an outside address) from the app closed its popup inside Qt's navigation callback;
    Qt WebEngine then aborted the whole app with SIGTRAP."""

    def test_outside_link_goes_to_the_browser_and_the_popup_closes_only_afterwards(self):
        from unittest import mock

        from slideforge.desktop import qt_support

        class Url:
            def __init__(self, scheme, host, port, text):
                self._parts = (scheme, host, port, text)

            def scheme(self):
                return self._parts[0]

            def host(self):
                return self._parts[1]

            def port(self):
                return self._parts[2]

            def toString(self):
                return self._parts[3]

        class View:
            closed = 0

            def close(self):
                self.closed += 1

        qt_support._app_port = 8123
        outside = Url("https", "demo.trycloudflare.com", -1, "https://demo.trycloudflare.com/s/abc/")
        inside = Url("http", "127.0.0.1", 8123, "http://127.0.0.1:8123/presenter")
        view, scheduled = View(), []
        with mock.patch.object(qt_support.webbrowser, "open") as browser:
            self.assertFalse(qt_support._route_popup_navigation(view, outside, True, scheduled.append))
            browser.assert_called_once_with("https://demo.trycloudflare.com/s/abc/", 2, True)
            self.assertEqual(view.closed, 0, "the popup was closed inside the navigation callback")
            self.assertEqual(len(scheduled), 1)
            scheduled[0]()
            self.assertEqual(view.closed, 1)

            # The app's own pages (presenter view) and sub-frames load in the popup.
            self.assertTrue(qt_support._route_popup_navigation(view, inside, True, scheduled.append))
            self.assertTrue(qt_support._route_popup_navigation(view, outside, False, scheduled.append))
            self.assertEqual((view.closed, len(scheduled)), (1, 1))

            # A browser that cannot be started must not raise out of the Qt callback.
            browser.side_effect = OSError("no browser")
            self.assertFalse(qt_support._route_popup_navigation(view, outside, True, scheduled.append))


class QtTerminateTests(TestCase):
    """`kill` on the desktop window raised SystemExit inside a Qt callback: the process aborted and nothing was
    cleaned up (instance.json left behind, a share tunnel left running)."""

    def test_sigterm_asks_qt_to_quit_and_never_raises(self):
        import signal
        import unittest
        from unittest import mock

        from slideforge.desktop import qt_support

        if not qt_support.available():
            raise unittest.SkipTest("Qt WebEngine is not installed")
        previous = signal.getsignal(signal.SIGTERM)
        try:
            qt_support._quit_on_terminate()
            handler = signal.getsignal(signal.SIGTERM)
            self.assertIs(handler, qt_support._request_quit)
            with mock.patch("qtpy.QtWidgets.QApplication") as application:
                handler(signal.SIGTERM, None)  # must not raise SystemExit
                application.instance.return_value.quit.assert_called_once_with()
                application.instance.side_effect = RuntimeError("no app")
                handler(signal.SIGTERM, None)  # logged, not raised
        finally:
            signal.signal(signal.SIGTERM, previous)


class QtFullscreenTests(TestCase):
    """Leaving a presentation puts the window back as it was: a maximized window came back small."""

    def test_window_returns_to_its_state_before_fullscreen(self):
        from slideforge.desktop import qt_support

        class Signal:
            def connect(self, handler):
                self.handler = handler

        class Page:
            fullScreenRequested = Signal()

        class Window:
            def __init__(self, maximized):
                self.maximized, self.fullscreen, self.calls = maximized, False, []

            def isFullScreen(self):
                return self.fullscreen

            def isMaximized(self):
                return self.maximized

            def showFullScreen(self):
                self.fullscreen = True
                self.calls.append("fullscreen")

            def showMaximized(self):
                self.fullscreen = False
                self.calls.append("maximized")

            def showNormal(self):
                self.fullscreen = False
                self.calls.append("normal")

        class Request:
            def __init__(self, on):
                self.on = on

            def accept(self):
                pass

            def toggleOn(self):
                return self.on

        for maximized, expected in ((True, "maximized"), (False, "normal")):
            page, window = Page(), Window(maximized)
            qt_support._follow_fullscreen(page, window)
            for _ in range(2):  # twice: the remembered state must survive a second presentation
                page.fullScreenRequested.handler(Request(True))
                page.fullScreenRequested.handler(Request(False))
            self.assertEqual(window.calls, ["fullscreen", expected, "fullscreen", expected])


class UpdateTests(TestCase):
    """Updating the app (slideforge/desktop/updates.py): where the latest version is read, how it is installed."""

    def test_versions_compare_as_numbers(self):
        from slideforge.desktop.updates import is_newer, version_key

        self.assertTrue(is_newer("0.10.0", "0.9.9"))
        self.assertTrue(is_newer("0.4.1", "0.4.0"))
        self.assertFalse(is_newer("0.4.0", "0.4"))
        self.assertFalse(is_newer("0.4.0rc1", "0.4.0"))
        self.assertTrue(version_key("1.0.0") > version_key("1.0.0rc2"))
        self.assertFalse(is_newer("", "0.4.0"))

    def _receipt(self, prefix, line):
        from pathlib import Path

        Path(prefix, "uv-receipt.toml").write_text(f'[tool]\nrequirements = [{line}]\npython = "3.12"\n', encoding="utf-8")

    def test_installer_copies_update_with_the_installers_command(self):
        import tempfile
        from unittest import mock

        from slideforge.desktop import updates

        zip_url = "https://github.com/dmighty007/slideforge-studio/archive/refs/heads/main.zip"
        with tempfile.TemporaryDirectory() as prefix, mock.patch.object(updates, "_direct_url", return_value={"url": zip_url, "archive_info": {}}), mock.patch.object(updates, "_uv", return_value="/usr/bin/uv"):
            self._receipt(prefix, f'{{ name = "slideforge-studio", extras = ["qt"], url = "{zip_url}" }}')
            origin = updates.detect_origin(prefix)
            self.assertEqual((origin.kind, origin.method, origin.extras, origin.python), ("github", "uv-tool", ["qt"], "3.12"))
            command = updates.update_command(origin)
            self.assertEqual(command[:3], ["/usr/bin/uv", "tool", "install"])
            self.assertIn("--refresh-package", command)
            self.assertEqual(command[-1], f"slideforge-studio[qt] @ {zip_url}")
            # From PyPI through the installer: the release, no URL.
            self._receipt(prefix, '{ name = "slideforge-studio", extras = ["qt"] }')
            origin = updates.detect_origin(prefix)
            self.assertEqual((origin.kind, origin.method), ("pypi", "uv-tool"))
            self.assertEqual(updates.update_command(origin)[-1], "slideforge-studio[qt]")

    def test_a_copy_installed_from_a_folder_updates_from_that_folder(self):
        import tempfile
        from pathlib import Path
        from unittest import mock

        from slideforge.desktop import updates

        with tempfile.TemporaryDirectory() as prefix, tempfile.TemporaryDirectory() as clone, mock.patch.object(updates, "_direct_url", return_value={"url": f"file://{clone}"}), mock.patch.object(updates, "_uv", return_value="/usr/bin/uv"):
            (Path(clone) / "backend" / "slideforge").mkdir(parents=True)
            (Path(clone) / "backend" / "slideforge" / "__init__.py").write_text('__version__ = "9.1.0"\n', encoding="utf-8")
            # uv records a folder as "directory".
            self._receipt(prefix, f'{{ name = "slideforge-studio", extras = ["qt"], directory = "{clone}" }}')
            origin = updates.detect_origin(prefix)
            self.assertEqual((origin.kind, origin.method), ("local", "uv-tool"))
            self.assertEqual(updates.latest_version(origin), "9.1.0")
            self.assertEqual(updates.update_command(origin)[-1], f"slideforge-studio[qt] @ {Path(clone).as_uri()}")

    def test_pip_and_editable_copies(self):
        import sys
        import tempfile
        from unittest import mock

        from slideforge.desktop import updates

        with tempfile.TemporaryDirectory() as prefix:
            with mock.patch.object(updates, "_direct_url", return_value=None), mock.patch.object(updates, "_installed_extras", return_value=[]):
                origin = updates.detect_origin(prefix)
                self.assertEqual((origin.kind, origin.method), ("pypi", "pip"))
                self.assertEqual(updates.update_command(origin), [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "slideforge-studio"])
            with mock.patch.object(updates, "_direct_url", return_value={"dir_info": {"editable": True}, "url": "file:///src"}):
                origin = updates.detect_origin(prefix)
                self.assertEqual(origin.kind, "editable")
                self.assertIsNone(updates.update_command(origin))
                self.assertIn("git pull", updates._manual_hint(origin))

    def test_checks_are_daily_remembered_and_skippable(self):
        import tempfile
        from unittest import mock

        from slideforge.desktop import updates

        with tempfile.TemporaryDirectory() as data, mock.patch.object(updates, "detect_origin", return_value=updates.Origin("pypi", "pip")):
            updater = updates.Updater(data)
            with mock.patch.object(updates, "latest_version", return_value="99.0.0") as latest:
                updater.check(automatic=True)
                updater.check(automatic=True)  # within the day: not asked again
                self.assertEqual(latest.call_count, 1)
                status = updater.status()
                self.assertTrue(status["available"] and status["canUpdate"])
                self.assertEqual((status["latest"], status["skipped"]), ("99.0.0", False))
                updater.skip("99.0.0")
                self.assertTrue(updates.Updater(data).status()["skipped"])  # remembered
                updater.set_auto_check(False)
                again = updates.Updater(data)
                again.checked_at = 0
                again.check(automatic=True)
                self.assertEqual(latest.call_count, 1)  # automatic checks off
                again.check()  # asked for: always
                self.assertEqual(latest.call_count, 2)
            with mock.patch.object(updates, "latest_version", side_effect=OSError("offline")):
                updater.check()
                self.assertIn("internet", updater.status()["checkError"])

    def test_the_update_runs_its_command_and_reports_the_new_version(self):
        import sys
        import tempfile
        import time
        from unittest import mock

        from slideforge.desktop import updates

        with tempfile.TemporaryDirectory() as data, mock.patch.object(updates, "detect_origin", return_value=updates.Origin("pypi", "pip")):
            updater = updates.Updater(data)
            updater.latest = "99.0.0"
            ok = [sys.executable, "-c", "print('Installed slideforge-studio-99.0.0')"]
            with mock.patch.object(updates, "update_command", return_value=ok), mock.patch.object(updates.Updater, "_new_version", return_value="99.0.0"):
                self.assertTrue(updater.start_update())
                for _ in range(100):
                    if updater.state != "updating":
                        break
                    time.sleep(0.05)
            self.assertEqual((updater.state, updater.installed_version), ("updated", "99.0.0"))
            self.assertIn("Installed slideforge-studio-99.0.0", updater.output)
            failing = [sys.executable, "-c", "import sys; print('no space'); sys.exit(3)"]
            with mock.patch.object(updates, "update_command", return_value=failing):
                updater.start_update()
                for _ in range(100):
                    if updater.state != "updating":
                        break
                    time.sleep(0.05)
            self.assertEqual(updater.state, "failed")
            self.assertIn("no space", updater.output)

    def test_the_update_endpoint(self):
        import tempfile
        from unittest import mock

        from slideforge.desktop import updates

        client = Client()
        with tempfile.TemporaryDirectory() as data, mock.patch.object(updates, "detect_origin", return_value=updates.Origin("editable", "none")):
            updater = updates.Updater(data)
            with mock.patch.object(updates, "get_updater", return_value=updater), mock.patch.object(updates, "latest_version", return_value="99.0.0"):
                status = client.post("/api/desktop/update/", data=json.dumps({"action": "check"}), content_type="application/json").json()
                self.assertEqual((status["latest"], status["available"], status["canUpdate"]), ("99.0.0", True, False))
                self.assertIn("git pull", status["manualHint"])
                refused = client.post("/api/desktop/update/", data=json.dumps({"action": "install"}), content_type="application/json")
                self.assertEqual(refused.status_code, 409)
                self.assertEqual(client.post("/api/desktop/update/", data=json.dumps({"action": "restart"}), content_type="application/json").status_code, 409)
                self.assertEqual(client.post("/api/desktop/update/", data=json.dumps({"action": "nonsense"}), content_type="application/json").status_code, 400)
                client.post("/api/desktop/update/", data=json.dumps({"action": "autoCheck", "enabled": False}), content_type="application/json")
                self.assertFalse(client.get("/api/desktop/update/").json()["autoCheck"])

    def test_the_restart_helper_waits_for_the_old_instance_to_quit(self):
        import os
        import subprocess
        import sys
        import tempfile
        import time

        from filelock import FileLock

        from slideforge.desktop import updates

        with tempfile.TemporaryDirectory() as data:
            lock = FileLock(os.path.join(data, "instance.lock"))
            lock.acquire()
            marker = os.path.join(data, "started")
            command = [sys.executable, "-c", f"open({marker!r}, 'w').write('new version')"]
            helper = subprocess.Popen([sys.executable, "-c", updates._RESTART_HELPER, os.path.join(data, "instance.lock"), *command])
            time.sleep(1.5)
            self.assertFalse(os.path.exists(marker))  # the old instance still runs: nothing started
            lock.release()
            helper.wait(timeout=30)
            for _ in range(50):
                if os.path.exists(marker):
                    break
                time.sleep(0.1)
            self.assertTrue(os.path.exists(marker))
