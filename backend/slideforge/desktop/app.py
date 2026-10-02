"""`slideforge` command: start the local server and open the editor in a window (or the browser)."""

import argparse
import errno
import json
import logging
import logging.handlers
import os
import secrets
import shutil
import signal
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path

from filelock import FileLock, Timeout

from slideforge import __version__
from slideforge.desktop import paths, qt_support, share_tunnel
from slideforge.desktop.logformat import UTCFormatter

log = logging.getLogger("slideforge")


def _parse_args(argv):
    parser = argparse.ArgumentParser(prog="slideforge", description="SlideForge presentation editor.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--browser", action="store_true", help="open in the default web browser instead of a window")
    mode.add_argument("--no-open", action="store_true", help="only start the server and print its URL")
    parser.add_argument("--port", type=int, default=0, help="port to listen on (default: a free port)")
    parser.add_argument("--data-dir", help="where to keep the database, media and config (default: per-user data dir)")
    parser.add_argument("--install-shortcut", action="store_true", help="add SlideForge to the Linux application menu")
    parser.add_argument("--version", action="version", version=f"SlideForge {__version__}")
    return parser.parse_args(argv)


def _prepare_django():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "slideforge.desktop.settings")
    import django
    from django.core.management import call_command

    django.setup()
    _backup_database_before_migrating()
    call_command("migrate", verbosity=0, interactive=False)


def _backup_database_before_migrating(keep: int = 5, db_path=None) -> None:
    """Copy the database into <data dir>/backups before an upgrade changes its schema."""
    import sqlite3

    from django.conf import settings
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    db_path = Path(db_path or settings.DATABASES["default"]["NAME"])
    if not db_path.exists() or db_path.stat().st_size == 0:
        return  # first run: nothing to protect
    executor = MigrationExecutor(connection)
    if not executor.migration_plan(executor.loader.graph.leaf_nodes()):
        return
    backups = db_path.parent / "backups"
    backups.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")  # sortable; unique even for back-to-back runs
    target = backups / f"slideforge-{stamp}.sqlite3"
    with sqlite3.connect(db_path) as source, sqlite3.connect(target) as copy:
        source.backup(copy)  # consistent copy even with WAL
    log.info("Backed up the database to %s before migrating", target)
    for old in sorted(backups.glob("slideforge-*.sqlite3"))[:-keep]:
        old.unlink(missing_ok=True)


def _start_server(port):
    from waitress.server import create_server

    from slideforge.desktop.wsgi import application

    server = create_server(
        application,
        host="127.0.0.1",
        port=port,
        threads=8,
        max_request_body_size=1024 * 1024 * 1024,
        ident="SlideForge",
    )
    threading.Thread(target=server.run, name="slideforge-server", daemon=True).start()
    return server


def _start_server_on_stable_port(requested_port, data_dir):
    """Reuse the port from the last launch when possible.

    The browser keys localStorage by origin (including the port), and the editor keeps the open project and
    unsaved-change backups there, so a new port on every launch would start with an empty project each time.
    """
    port_file = data_dir / "port"
    if requested_port:
        return _start_server(requested_port)
    try:
        previous = int(port_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        previous = 0
    server = None
    if previous:
        # A just-closed instance may release the port a moment later, so retry briefly before giving it up.
        for attempt in range(10):
            try:
                server = _start_server(previous)
                break
            except OSError:
                if attempt < 9:
                    time.sleep(0.2)
        else:
            log.warning("Port %s is taken; using a new one (the open project will not be restored this time)", previous)
    if server is None:
        server = _start_server(0)
    try:
        port_file.write_text(str(server.effective_port), encoding="utf-8")
    except OSError:
        pass
    return server


class StartupError(Exception):
    """A problem the user can fix; the message is shown as-is."""


def _setup_logging(data_dir) -> None:
    """Log to <data dir>/slideforge.log from the very start (Django's settings reuse the same file)."""
    handler = logging.handlers.RotatingFileHandler(
        data_dir / "slideforge.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(UTCFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def _notify(message: str, *, gui: bool, error: bool = True) -> None:
    """Tell the user something: on the console if there is one, and in a dialog for GUI launches."""
    if sys.stderr is not None:
        print(message, file=sys.stderr if error else sys.stdout, flush=True)
    if not gui:
        return
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        (messagebox.showerror if error else messagebox.showinfo)("SlideForge", message)
        root.destroy()
    except Exception:  # no Tk available: the message is still in the log
        pass


def _open_window(url, data_dir, *, gui: bool) -> bool:
    """Show the editor in a native window. Returns False if no GUI backend is available."""
    hint = 'On Linux, install a GUI backend with: pip install "slideforge-studio[qt]"'
    try:
        import webview
    except ImportError as exc:
        log.warning("Native window unavailable: %s", exc)
        _notify(f"Native window unavailable ({exc}).\n{hint}", gui=gui)
        return False
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
        window = webview.create_window("SlideForge", url, width=1440, height=900, min_size=(1024, 680))
        # Prefer Qt when installed: it has a built-in PDF viewer (WebKitGTK does not), and we configure it ourselves.
        backend = None
        if qt_support.available():
            qt_support.prepare(window)
            backend = "qt"
        # Persistent profile: the editor keeps the open project and unsaved-change backups in localStorage.
        webview.start(
            gui=backend,
            private_mode=False,
            storage_path=str(data_dir / "webview"),
            icon=str(paths.ICON_PATH),
        )
    except Exception as exc:  # pywebview raises various errors when no GUI toolkit is installed
        log.warning("Native window unavailable: %s", exc)
        _notify(f"Native window unavailable ({exc}).\n{hint}", gui=gui)
        return False
    return True


def _wait_forever(server):
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()


def _show_running_instance(data_dir, no_open, *, gui: bool) -> int:
    """Another SlideForge already owns this data directory: point the user at it instead of starting a second one."""
    try:
        url = json.loads((data_dir / "instance.json").read_text(encoding="utf-8"))["url"]
    except (OSError, ValueError, KeyError):
        _notify("SlideForge is already running (it may still be starting up).", gui=gui)
        return 1
    print(f"SlideForge is already running at {url}", flush=True)
    if not no_open:
        webbrowser.open(url)
    return 0


def _clean_up_unused_assets() -> None:
    from django.db import connection

    from slideforge.studio.asset_cleanup import collect_unused_assets

    try:
        collect_unused_assets()
    except Exception:
        log.exception("Cleaning up unused uploads failed")
    finally:
        connection.close()


def _data_dir_or_fail():
    try:
        data_dir = paths.data_dir()
        (data_dir / "media").mkdir(exist_ok=True)
        probe = data_dir / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return data_dir
    except OSError as exc:
        location = os.environ.get("SLIDEFORGE_DATA_DIR") or "the default data directory"
        raise StartupError(f"Cannot use {location} for SlideForge data: {exc.strerror or exc}") from exc


def _run(args, *, gui: bool) -> int:
    data_dir = _data_dir_or_fail()
    _setup_logging(data_dir)
    log.info("Starting SlideForge %s (data directory %s)", __version__, data_dir)

    # One running instance per data directory: two would race on migrations and write the same SQLite file.
    lock = FileLock(str(data_dir / "instance.lock"))
    try:
        lock.acquire(timeout=0)
    except Timeout:
        return _show_running_instance(data_dir, args.no_open, gui=gui)

    instance_file = data_dir / "instance.json"
    # A plain "kill" (or logging out) should still clean up below, including a running share tunnel.
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        token = secrets.token_urlsafe(32)
        os.environ["SLIDEFORGE_LAUNCH_TOKEN"] = token

        _prepare_django()
        threading.Thread(target=_clean_up_unused_assets, name="slideforge-asset-cleanup", daemon=True).start()
        try:
            server = _start_server_on_stable_port(args.port, data_dir)
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE and args.port:
                raise StartupError(f"Port {args.port} is already in use. Pick another with --port, or omit it.") from exc
            raise
        url = f"http://127.0.0.1:{server.effective_port}/?token={token}"
        # Owner-only from the start: the URL carries the launch token.
        fd = os.open(instance_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"url": url, "pid": os.getpid()}, handle)

        print(f"SlideForge {__version__} running at {url}\nData directory: {data_dir}", flush=True)

        if args.no_open:
            _wait_forever(server)
            return 0
        if not args.browser and _open_window(url, data_dir, gui=gui):
            server.close()  # window closed: quit
            return 0
        if gui:
            # No console to stop a browser-mode server from, so don't leave one running invisibly.
            server.close()
            return 1
        webbrowser.open(url)
        print("Press Ctrl+C to stop.", flush=True)
        _wait_forever(server)
        return 0
    finally:
        share_tunnel.shutdown()
        instance_file.unlink(missing_ok=True)
        lock.release()


def install_shortcut() -> Path:
    """Write a freedesktop .desktop entry so SlideForge appears in the Linux application menu."""
    if not sys.platform.startswith("linux"):
        raise StartupError("--install-shortcut is only supported on Linux for now.")
    launcher = shutil.which("slideforge-gui") or shutil.which("slideforge")
    command = f'"{launcher}"' if launcher else f'"{sys.executable}" -m slideforge'
    applications = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    entry = applications / "slideforge.desktop"
    entry.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=SlideForge\n"
        "Comment=Presentation editor\n"
        f"Exec={command}\n"
        f"Icon={paths.ICON_PATH}\n"
        "Terminal=false\n"
        "Categories=Office;Presentation;\n"
        "StartupWMClass=SlideForge\n",
        encoding="utf-8",
    )
    return entry


def main(argv=None, *, gui: bool = False) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    if args.install_shortcut:
        try:
            entry = install_shortcut()
        except StartupError as exc:
            _notify(str(exc), gui=gui)
            return 1
        print(f"Added SlideForge to the application menu ({entry}). Delete that file to remove it.")
        return 0
    if args.data_dir:
        os.environ["SLIDEFORGE_DATA_DIR"] = args.data_dir
    try:
        return _run(args, gui=gui)
    except StartupError as exc:
        log.error("%s", exc)
        _notify(str(exc), gui=gui)
        return 1
    except Exception:
        log.exception("SlideForge failed to start")
        _notify(f"SlideForge failed to start:\n\n{traceback.format_exc(limit=5)}", gui=gui)
        return 1


def gui_main() -> int:
    """Entry point for `slideforge-gui` (no console window on Windows): report problems in dialogs."""
    return main(gui=True)
