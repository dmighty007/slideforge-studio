"""Public viewing links from the desktop app.

A second local server answers only /s/<token>/... (shared presentations, see studio/sharing.py) and a Cloudflare
quick tunnel (https://<random>.trycloudflare.com, no account) points at it. The tunnel never reaches the editor:
every other path gets 404 without touching the app. The tunnel's address changes each time it starts, and links
work only while SlideForge runs.
"""

import atexit
import logging
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)

TUNNEL_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
DOWNLOAD_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download/"


def _download_name() -> str | None:
    """The official cloudflared release file for this computer, or None if there is none."""
    system = platform.system()
    machine = platform.machine().lower()
    arch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64", "armv7l": "arm"}.get(machine)
    if not arch:
        return None
    if system == "Linux":
        return f"cloudflared-linux-{arch}"
    if system == "Darwin" and arch in ("amd64", "arm64"):
        return f"cloudflared-darwin-{arch}.tgz"
    if system == "Windows" and arch == "amd64":
        return "cloudflared-windows-amd64.exe"
    return None


def share_only_app(environ, start_response):
    """WSGI app for the tunnel: shared presentations only (GET/HEAD /s/...), 404 for everything else."""
    path = environ.get("PATH_INFO", "")
    if not path.startswith("/s/") or environ.get("REQUEST_METHOD") not in ("GET", "HEAD"):
        start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8")])
        return [b"Not found"]
    from slideforge.desktop.wsgi import application

    # Requests arrive with the tunnel's public host name, which the app does not serve; only /s/ gets this far.
    environ = {**environ, "HTTP_HOST": "127.0.0.1", "SERVER_NAME": "127.0.0.1"}
    environ.pop("HTTP_X_FORWARDED_HOST", None)
    return application(environ, start_response)


class ShareTunnel:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self._lock = threading.Lock()
        self._server = None
        self._process = None
        self.url = None
        self.error = None
        self.starting = False
        self.installing = False

    # --- cloudflared -----------------------------------------------------------------------------------
    def binary(self) -> str | None:
        found = shutil.which("cloudflared")
        if found:
            return found
        local = self.data_dir / "bin" / ("cloudflared.exe" if platform.system() == "Windows" else "cloudflared")
        return str(local) if local.is_file() and os.access(local, os.X_OK) else None

    def install(self) -> None:
        """Download the official cloudflared release into the data directory."""
        name = _download_name()
        if not name:
            raise RuntimeError("cloudflared is not available for this computer; install it from cloudflare.com")
        target_dir = self.data_dir / "bin"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / ("cloudflared.exe" if name.endswith(".exe") else "cloudflared")
        self.installing = True
        try:
            with tempfile.TemporaryDirectory(dir=target_dir) as tmp:
                downloaded = Path(tmp) / name
                with urllib.request.urlopen(DOWNLOAD_BASE + name, timeout=120) as response, open(downloaded, "wb") as out:
                    shutil.copyfileobj(response, out)
                if name.endswith(".tgz"):
                    with tarfile.open(downloaded) as archive:
                        member = next(m for m in archive.getmembers() if Path(m.name).name == "cloudflared" and m.isfile())
                        archive.extract(member, tmp, filter="data")
                        downloaded = Path(tmp) / member.name
                if downloaded.stat().st_size < 1_000_000:
                    raise RuntimeError("The cloudflared download looks incomplete")
                downloaded.chmod(0o755)
                os.replace(downloaded, target)
        finally:
            self.installing = False
        log.info("Installed cloudflared at %s", target)

    # --- share server and tunnel -----------------------------------------------------------------------
    def _ensure_server(self) -> int:
        if self._server is None:
            from waitress.server import create_server

            self._server = create_server(share_only_app, host="127.0.0.1", port=0, threads=4, ident="SlideForge share")
            threading.Thread(target=self._server.run, name="slideforge-share-server", daemon=True).start()
        return self._server.effective_port

    def start(self) -> None:
        """Start the tunnel in the background (status() reports the address once Cloudflare assigns it)."""
        with self._lock:
            if self._process and self._process.poll() is None:
                return
            binary = self.binary()
            if not binary:
                self.error = "cloudflared is not installed"
                return
            port = self._ensure_server()
            config = self.data_dir / "bin" / "quick-tunnel.yml"  # an empty config: a user's own config would block quick tunnels
            config.parent.mkdir(parents=True, exist_ok=True)
            if not config.exists():
                config.write_text("# Used by SlideForge for quick tunnels.\n", encoding="utf-8")
            self.url = None
            self.error = None
            self.starting = True
            command = [binary, "tunnel", "--no-autoupdate", "--config", str(config), "--url", f"http://127.0.0.1:{port}"]
            try:
                self._process = subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except OSError as exc:
                self.starting = False
                self.error = f"Could not start cloudflared: {exc}"
                return
            threading.Thread(target=self._watch, args=(self._process,), name="slideforge-tunnel", daemon=True).start()

    def _watch(self, process) -> None:
        recent = []
        for line in process.stdout:
            recent = (recent + [line.strip()])[-12:]
            match = TUNNEL_URL_RE.search(line)
            if match and not self.url:
                self.url = match.group(0)
                self.starting = False
                log.info("Share tunnel at %s", self.url)
        process.wait()
        if process is self._process:
            self.starting = False
            self.url = None
            if not self.error:
                detail = next((line for line in reversed(recent) if "ERR" in line or "error" in line.lower()), "")
                self.error = f"The tunnel stopped{': ' + detail if detail else ''}"

    def stop(self) -> None:
        with self._lock:
            process, self._process = self._process, None
            self.url = None
            self.starting = False
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    def shutdown(self) -> None:
        self.stop()
        if self._server is not None:
            self._server.close()
            self._server = None

    def status(self) -> dict:
        running = bool(self._process and self._process.poll() is None)
        return {
            "available": bool(self.binary()),
            "installable": _download_name() is not None,
            "installing": self.installing,
            "running": running,
            "starting": self.starting and running,
            "url": self.url if running else None,
            "error": None if running else self.error,
        }

    def wait_for_url(self, timeout: float = 30.0) -> str | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.url or (self._process and self._process.poll() is not None):
                break
            time.sleep(0.2)
        return self.url


_tunnel: ShareTunnel | None = None


def shutdown() -> None:
    """Stop the tunnel and share server if they were started."""
    if _tunnel is not None:
        _tunnel.shutdown()


def get_tunnel() -> ShareTunnel:
    global _tunnel
    if _tunnel is None:
        from django.conf import settings

        _tunnel = ShareTunnel(Path(settings.DATA_DIR))
        atexit.register(_tunnel.shutdown)
    return _tunnel
