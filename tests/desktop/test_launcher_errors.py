import os
import socket
import subprocess
import tempfile
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase

from slideforge.desktop import app
from slideforge.desktop import qt_support


class LauncherErrorTests(SimpleTestCase):
    def _run(self, *argv):
        with mock.patch.dict(os.environ), mock.patch.object(app, "_notify") as notify:
            code = app.main(list(argv))
        return code, " ".join(str(call.args[0]) for call in notify.call_args_list)

    def test_port_in_use_is_reported_plainly(self):
        blocker = socket.socket()
        blocker.bind(("127.0.0.1", 0))
        blocker.listen()
        self.addCleanup(blocker.close)
        port = blocker.getsockname()[1]
        data_dir = tempfile.mkdtemp()

        with mock.patch.object(app, "_prepare_django"):
            code, message = self._run("--no-open", "--port", str(port), "--data-dir", data_dir)

        self.assertEqual(code, 1)
        self.assertIn(f"Port {port} is already in use", message)
        self.assertFalse((Path(data_dir) / "instance.json").exists())

    def test_unusable_data_dir_is_reported_plainly(self):
        not_a_dir = Path(tempfile.mkdtemp()) / "file"
        not_a_dir.write_text("x")

        code, message = self._run("--no-open", "--data-dir", str(not_a_dir))

        self.assertEqual(code, 1)
        self.assertIn("Cannot use", message)
        self.assertNotIn("Traceback", message)


class QtPlatformTests(SimpleTestCase):
    def test_linux_platform_failure_is_reported_without_initializing_webview(self):
        webview = mock.MagicMock()
        with (
            mock.patch.dict("sys.modules", {"webview": webview}),
            mock.patch.object(qt_support, "available", return_value=True),
            mock.patch.object(qt_support.sys, "platform", "linux"),
            mock.patch.object(qt_support.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], -6, "", "Failed to create wl_display"
            )),
            mock.patch.object(app, "_notify") as notify,
        ):
            self.assertFalse(app._open_window("http://127.0.0.1/", Path("/tmp"), gui=False))
        webview.create_window.assert_not_called()
        webview.start.assert_not_called()
        self.assertIn("slideforge --browser", notify.call_args.args[0])
        self.assertIn("QT_QPA_PLATFORM=xcb", notify.call_args.args[0])

    def test_linux_probe_succeeds_and_inherits_platform_override(self):
        with (
            mock.patch.object(qt_support.sys, "platform", "linux"),
            mock.patch.object(qt_support.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run,
        ):
            qt_support.check_platform()
        self.assertNotIn("env", run.call_args.kwargs)
        self.assertEqual(run.call_args.kwargs["timeout"], 15)

    def test_probe_errors_and_timeouts_are_recoverable(self):
        for error in (OSError("cannot spawn"), subprocess.TimeoutExpired("qt", 15)):
            with (
                self.subTest(error=error),
                mock.patch.object(qt_support.sys, "platform", "linux"),
                mock.patch.object(qt_support.subprocess, "run", side_effect=error),
                self.assertRaisesRegex(RuntimeError, "slideforge --browser"),
            ):
                qt_support.check_platform()

    def test_other_platforms_do_not_spawn_a_probe(self):
        for platform in ("darwin", "win32"):
            with (
                mock.patch.object(qt_support.sys, "platform", platform),
                mock.patch.object(qt_support.subprocess, "run") as run,
            ):
                qt_support.check_platform()
                run.assert_not_called()
