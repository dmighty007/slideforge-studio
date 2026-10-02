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
