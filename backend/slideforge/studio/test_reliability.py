import io
import json
import os
import subprocess
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from PIL import Image
from pptx import Presentation as PptxPresentation

from django.contrib.auth import get_user_model
from slideforge.studio import views
from slideforge.studio.asset_cleanup import collect_unused_assets
from slideforge.studio.models import Asset, Presentation, PresentationRevision


def _png(name="img.png"):
    data = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(data, format="PNG")
    return SimpleUploadedFile(name, data.getvalue(), content_type="image/png")


def _deck(*urls):
    return {"slides": [{"id": "slide_1", "elements": [{"id": f"el_{i}", "type": "image", "content": url} for i, url in enumerate(urls)]}]}


class AssetCleanupTests(TestCase):
    def setUp(self):
        media = override_settings(MEDIA_ROOT=tempfile.mkdtemp())  # each test sees only its own files
        media.enable()
        self.addCleanup(media.disable)
        self.client = Client()
        self.user = get_user_model().objects.create_user(username="cleanup-user", password="strong-password-123")
        self.client.force_login(self.user)

    def _upload(self, age_hours=48):
        response = self.client.post("/api/assets/upload/", {"file": _png()})
        self.assertEqual(response.status_code, 201, response.content)
        asset = Asset.objects.get(id=response.json()["id"]) if "id" in response.json() else Asset.objects.latest("created_at")
        Asset.objects.filter(pk=asset.pk).update(created_at=timezone.now() - timedelta(hours=age_hours))
        asset.refresh_from_db()
        old = (timezone.now() - timedelta(hours=age_hours)).timestamp()
        os.utime(asset.file.path, (old, old))
        return asset, response.json()["url"]

    def test_unreferenced_old_upload_is_deleted(self):
        asset, _ = self._upload()
        path = Path(asset.file.path)

        stats = collect_unused_assets()

        self.assertEqual(stats["asset_rows"], 1)
        self.assertFalse(Asset.objects.filter(pk=asset.pk).exists())
        self.assertFalse(path.exists())

    def test_recent_upload_is_kept_even_if_unreferenced(self):
        asset, _ = self._upload(age_hours=1)
        collect_unused_assets()
        self.assertTrue(Asset.objects.filter(pk=asset.pk).exists())

    def test_upload_used_by_a_deck_or_revision_is_kept(self):
        in_deck, deck_url = self._upload()
        in_revision, revision_url = self._upload()
        deck = Presentation.objects.create(owner=self.user, title="d", state_json=_deck(deck_url))
        PresentationRevision.objects.create(presentation=deck, version=1, state_json=_deck(revision_url))

        collect_unused_assets()

        self.assertTrue(Path(in_deck.file.path).exists())
        self.assertTrue(Path(in_revision.file.path).exists())

    def test_deleting_a_deck_keeps_files_another_deck_still_uses(self):
        asset, url = self._upload()
        original = Presentation.objects.create(owner=self.user, title="a", state_json=_deck(url))
        Asset.objects.filter(pk=asset.pk).update(presentation=original)
        Presentation.objects.create(owner=self.user, title="copy", state_json=_deck(url))
        path = Path(asset.file.path)

        original.delete()  # cascades the Asset row away
        collect_unused_assets()

        self.assertTrue(path.exists(), "file still used by the copied deck was deleted")

    def test_orphan_file_nobody_uses_is_deleted(self):
        asset, url = self._upload()
        deck = Presentation.objects.create(owner=self.user, title="a", state_json=_deck(url))
        Asset.objects.filter(pk=asset.pk).update(presentation=deck)
        path = Path(asset.file.path)

        deck.delete()
        stats = collect_unused_assets()

        self.assertEqual(stats["orphan_files"], 1)
        self.assertFalse(path.exists())

    def test_quota_reclaims_unused_uploads_before_refusing(self):
        self._upload()
        size = Asset.objects.get().metadata_json["size"]
        with override_settings(PPTMAKER_MAX_USER_ASSET_STORAGE_BYTES=size + 10):
            response = self.client.post("/api/assets/upload/", {"file": _png("second.png")})
        self.assertEqual(response.status_code, 201, response.content)


class ExportHardeningTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.client.force_login(get_user_model().objects.create_user(username="export-user", password="strong-password-123"))

    def _export(self, state):
        return self.client.post(
            "/api/presentations/export/pptx/",
            data=json.dumps({"state": state, "title": "t"}),
            content_type="application/json",
        )

    def test_malformed_fields_do_not_abort_the_export(self):
        state = {
            "slides": [
                {
                    "id": "slide_1",
                    "background": "red",
                    "elements": [
                        {"id": "el_a", "type": "text", "content": "styles null", "styles": None},
                        {"id": "el_b", "type": "text", "content": "odd zIndex", "styles": {"zIndex": "front"}},
                        {"id": "el_c", "type": "text", "content": "no zIndex", "styles": {"zIndex": None}},
                    ],
                },
                {"id": "slide_2", "elements": [{"id": "el_d", "type": "text", "content": "fine", "styles": {"zIndex": 2}}]},
            ]
        }
        response = self._export(state)

        self.assertEqual(response.status_code, 200, getattr(response, "content", b"")[:300])
        deck = PptxPresentation(io.BytesIO(b"".join(response.streaming_content)))
        self.assertEqual(len(deck.slides), 2)

    def test_non_object_json_is_a_bad_request(self):
        for path in ("/api/presentations/", "/api/presentations/export/pptx/"):
            response = self.client.post(path, data="[]", content_type="application/json")
            self.assertEqual(response.status_code, 400, path)

    def test_non_string_title_is_a_bad_request(self):
        response = self.client.post(
            "/api/presentations/", data=json.dumps({"title": {"x": 1}}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)


class VideoTranscodeTests(SimpleTestCase):
    def _video(self):
        return SimpleUploadedFile("clip.webm", b"\x1a\x45\xdf\xa3" + b"0" * 64, content_type="video/webm")

    def test_without_ffmpeg_the_original_format_is_kept(self):
        with mock.patch.object(views.shutil, "which", return_value=None):
            path, meta, ext, content_type = views._normalize_video_file(self._video())
        self.assertIsNone(path)
        self.assertEqual((ext, content_type), (".webm", "video/webm"))
        self.assertFalse(meta["transcoded"])

    def test_ffmpeg_timeout_falls_back_and_cleans_up_temp_files(self):
        before = set(os.listdir(tempfile.gettempdir()))
        with (
            mock.patch.object(views.shutil, "which", return_value="/usr/bin/ffmpeg"),
            mock.patch.object(views.subprocess, "run", side_effect=subprocess.TimeoutExpired("ffmpeg", 1)) as run,
        ):
            path, meta, ext, content_type = views._normalize_video_file(self._video())
        self.assertIn("timeout", run.call_args.kwargs)
        self.assertIsNone(path)
        self.assertEqual((ext, content_type), (".webm", "video/webm"))
        self.assertIn("timed out", meta["transcodeError"])
        self.assertEqual(set(os.listdir(tempfile.gettempdir())) - before, set())


@override_settings(PPTMAKER_ENABLE_AI_CLEANUP=True, PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS=0.5)
class AICleanupDeadlineTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.client.force_login(get_user_model().objects.create_user(username="ai-user", password="strong-password-123"))

    def _cleanup(self):
        slide = {"elements": [{"id": "t", "type": "text", "x": 1, "y": 1, "width": "100px", "height": "40px", "content": "Hi"}]}
        return self.client.post("/api/slides/cleanup/", data=json.dumps({"slide": slide}), content_type="application/json")

    def test_slow_ai_falls_back_within_the_deadline(self):
        import threading
        import time

        release = threading.Event()
        started = time.monotonic()
        with (
            mock.patch.object(views, "build_task_provider", return_value=object()),
            mock.patch.object(views, "_generate_structured_json", side_effect=lambda *a, **k: release.wait(10) or {}),
        ):
            response = self._cleanup()
            elapsed = time.monotonic() - started
            busy = self._cleanup()  # the slow call still holds the single AI slot
            release.set()

        self.assertLess(elapsed, 5)
        self.assertEqual(response.json()["summary"], "Local cleanup applied because the AI cleanup took too long")
        self.assertEqual(
            busy.json()["summary"], "Local cleanup applied because the AI is still busy with an earlier cleanup"
        )


class PresentationListSummaryTests(TestCase):
    def test_cover_font_rejects_css_injection(self):
        from slideforge.studio.views import _deck_summary

        state = {"slides": [{"elements": [{"type": "text", "content": "T", "styles": {"fontFamily": "x; background:url(evil)"}}]}]}
        self.assertEqual(_deck_summary(state)["coverFont"], "")

    def test_list_includes_slide_count_and_cover_title(self):
        user = get_user_model().objects.create_user(username="list-user", password="strong-password-123")
        client = Client()
        client.force_login(user)
        state = {"slides": [
            {"id": "s1", "elements": [
                {"id": "m", "type": "text", "content": "Footer", "isMasterElement": True},
                {"id": "t", "type": "text", "content": "<b>Protein</b> &amp; folding", "styles": {"fontFamily": '"Manrope", sans-serif'}},
            ]},
            {"id": "s2", "elements": []},
        ]}
        Presentation.objects.create(owner=user, title="Deck", state_json=state)

        item = client.get("/api/presentations/").json()["presentations"][0]

        self.assertEqual(item["slideCount"], 2)
        self.assertEqual(item["coverTitle"], "Protein & folding")
        self.assertEqual(item["coverFont"], '"Manrope", sans-serif')
