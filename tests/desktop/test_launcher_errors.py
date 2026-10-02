import os
import socket
import tempfile
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase

from slideforge.desktop import app


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
