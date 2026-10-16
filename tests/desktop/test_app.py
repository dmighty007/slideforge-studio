import json
import os
import socket
from unittest import mock

from django.test import SimpleTestCase
from filelock import FileLock

from slideforge.desktop import app


class StablePortTests(SimpleTestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path

        self.data_dir = Path(tempfile.mkdtemp())

    def test_reuses_the_previous_port(self):
        first = app._start_server_on_stable_port(0, self.data_dir)
        port = first.effective_port
        first.close()

        second = app._start_server_on_stable_port(0, self.data_dir)
        self.addCleanup(second.close)
        self.assertEqual(second.effective_port, port)

    def test_falls_back_to_a_free_port_when_the_previous_one_is_taken(self):
        blocker = socket.socket()
        blocker.bind(("127.0.0.1", 0))
        blocker.listen()
        self.addCleanup(blocker.close)
        taken = blocker.getsockname()[1]
        (self.data_dir / "port").write_text(str(taken))

        server = app._start_server_on_stable_port(0, self.data_dir)
        self.addCleanup(server.close)
        self.assertNotEqual(server.effective_port, taken)
        self.assertEqual((self.data_dir / "port").read_text(), str(server.effective_port))


class SingleInstanceTests(SimpleTestCase):
    def test_second_instance_points_to_the_running_one_instead_of_starting(self):
        import tempfile
        from pathlib import Path

        data_dir = Path(tempfile.mkdtemp())
        (data_dir / "instance.json").write_text(json.dumps({"url": "http://127.0.0.1:1234/?token=abc"}))
        running = FileLock(str(data_dir / "instance.lock"))
        running.acquire()
        self.addCleanup(running.release)

        with (
            mock.patch.dict(os.environ),
            mock.patch.object(app, "_prepare_django") as prepare,
            mock.patch.object(app.webbrowser, "open") as browser,
        ):
            code = app.main(["--data-dir", str(data_dir)])

        self.assertEqual(code, 0)
        prepare.assert_not_called()
        browser.assert_called_once_with("http://127.0.0.1:1234/?token=abc")


class PywebviewQtInternalsTests(SimpleTestCase):
    """qt_support.py patches these pywebview internals; fail loudly if an upgrade moves them."""

    def test_hooked_internals_exist(self):
        try:
            from webview.platforms import qt as pywebview_qt
        except Exception as exc:  # Qt backend not installed in this environment
            self.skipTest(f"pywebview Qt backend unavailable: {exc}")
        self.assertTrue(hasattr(pywebview_qt.BrowserView, "WebPage"))
        self.assertTrue(hasattr(pywebview_qt.BrowserView.WebPage, "createWindow"))
        self.assertTrue(hasattr(pywebview_qt.BrowserView, "on_download_requested"))
        self.assertTrue(hasattr(pywebview_qt, "QFileDialog"))


class QtDownloadTests(SimpleTestCase):
    def _download(self, qt6=True):
        methods = ["url", "accept", "cancel"]
        methods += (["downloadDirectory", "downloadFileName", "setDownloadDirectory", "setDownloadFileName"]
                    if qt6 else ["path", "suggestedFileName", "setPath"])
        download = mock.Mock(spec=methods)
        if qt6:
            download.downloadDirectory.return_value = "/tmp/exports"
            download.downloadFileName.return_value = "Scientific talk.zip"
        else:
            download.path.return_value = "/tmp/exports/temporary-name"
            download.suggestedFileName.return_value = "Scientific talk.zip"
        download.url.return_value.fileName.return_value = "blob-uuid"
        return download

    def _save(self, download, chooser):
        from slideforge.desktop import qt_support

        browser = mock.Mock(localization={"global.saveFile": "Save file"})
        qt_support._handle_download(browser, download, chooser)
        return browser

    def test_qt6_sets_directory_and_filename_before_accepting(self):
        download = self._download()
        chooser = mock.Mock(return_value=("/tmp/chosen/My talk.zip", "*.zip"))
        browser = self._save(download, chooser)
        chooser.assert_called_once_with(browser, "Save file", "/tmp/exports/Scientific talk.zip", "*.zip")
        self.assertEqual(download.method_calls[-3:], [
            mock.call.setDownloadDirectory("/tmp/chosen"),
            mock.call.setDownloadFileName("My talk.zip"), mock.call.accept(),
        ])
        download.cancel.assert_not_called()

    def test_qt5_keeps_the_legacy_path_api(self):
        download = self._download(qt6=False)
        self._save(download, mock.Mock(return_value=("/tmp/talk.zip", "*.zip")))
        download.setPath.assert_called_once_with("/tmp/talk.zip")
        download.accept.assert_called_once_with()

    def test_cancel_does_not_accept_or_set_a_destination(self):
        download = self._download()
        self._save(download, mock.Mock(return_value=("", "")))
        download.cancel.assert_called_once_with()
        download.accept.assert_not_called()
        download.setDownloadDirectory.assert_not_called()

    def test_dialog_and_download_errors_cannot_escape_the_qt_callback(self):
        for stage in ("dialog", "destination", "accept"):
            with self.subTest(stage=stage), self.assertLogs("slideforge.desktop.qt_support", level="ERROR"):
                download = self._download()
                chooser = mock.Mock(return_value=("/tmp/talk.zip", "*.zip"))
                if stage == "dialog":
                    chooser.side_effect = RuntimeError("dialog failed")
                elif stage == "destination":
                    download.setDownloadFileName.side_effect = RuntimeError("destination failed")
                else:
                    download.accept.side_effect = RuntimeError("download failed")
                self._save(download, chooser)
                download.cancel.assert_called_once_with()

    def test_failed_cancel_also_cannot_escape_the_qt_callback(self):
        download = self._download()
        download.cancel.side_effect = RuntimeError("request already deleted")
        with self.assertLogs("slideforge.desktop.qt_support", level="ERROR"):
            self._save(download, mock.Mock(side_effect=RuntimeError("dialog failed")))


class DesktopPolishTests(SimpleTestCase):
    def test_icon_ships_with_the_package(self):
        from slideforge.desktop.paths import ICON_PATH

        self.assertTrue(ICON_PATH.is_file())

    def test_install_shortcut_writes_a_desktop_entry(self):
        import sys
        import tempfile

        if not sys.platform.startswith("linux"):
            self.skipTest("Linux only")
        xdg = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"XDG_DATA_HOME": xdg}):
            entry = app.install_shortcut()
        text = entry.read_text()
        self.assertIn("Name=SlideForge", text)
        self.assertIn("Exec=", text)
        self.assertIn("favicon_icon.png", text)


class DatabaseBackupTests(SimpleTestCase):
    databases = {"default"}

    def test_backup_is_taken_only_when_migrations_are_pending(self):
        import tempfile
        from pathlib import Path

        data = Path(tempfile.mkdtemp())
        db = data / "slideforge.sqlite3"
        import sqlite3

        with sqlite3.connect(db) as conn:
            conn.execute("create table t (x)")
        plan = "django.db.migrations.executor.MigrationExecutor.migration_plan"
        with mock.patch(plan, return_value=[]):
            app._backup_database_before_migrating(db_path=db)
        self.assertFalse((data / "backups").exists())

        with mock.patch(plan, return_value=["pending"]):
            for _ in range(7):
                app._backup_database_before_migrating(db_path=db)
        backups = sorted((data / "backups").glob("slideforge-*.sqlite3"))
        self.assertEqual(len(backups), 5)
        with sqlite3.connect(backups[-1]) as conn:
            self.assertEqual(conn.execute("select name from sqlite_master").fetchall(), [("t",)])
