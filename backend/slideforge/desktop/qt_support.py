"""Qt WebEngine settings pywebview's Qt backend does not make for us.

- The built-in PDF viewer (PDF elements are iframes pointing at the PDF file).
- Fullscreen (presentation mode calls requestFullscreen()).
- Popup windows: pywebview sends every window.open() to the system browser, which breaks the presenter view.
  Same-app popups open as real windows sharing the editor's session; external links still go to the browser.
- Permission requests (clipboard, microphone, ...): pywebview's handler passes a plain int where PyQt6 wants an enum,
  and the TypeError aborts the whole app. Ours answers them correctly and never raises.

pywebview runs its event handlers on worker threads, so view changes are queued to the Qt GUI thread.
"""

import logging
import webbrowser

log = logging.getLogger(__name__)
_bridge = None
_app_port = None  # popups on this port belong to the app; anything else goes to the system browser
_popups = []  # keep popup windows alive until closed


def available() -> bool:
    try:
        from qtpy import QtWebEngineWidgets  # noqa: F401
    except Exception:  # ImportError, or qtpy's error when no Qt binding is installed
        return False
    return True


def prepare(window) -> None:
    """Call before webview.start(gui="qt")."""
    global _bridge, _app_port
    from urllib.parse import urlparse

    from qtpy.QtCore import QObject, Qt, Signal

    _app_port = urlparse(window.original_url).port

    class _Bridge(QObject):
        configure = Signal(object)

    _patch_popups()
    _patch_permissions()
    _quit_on_terminate()
    _bridge = _Bridge()  # created on the GUI thread, so emits from worker threads are queued to it
    _bridge.configure.connect(_configure_window, Qt.ConnectionType.QueuedConnection)
    window.events.before_show += lambda: _bridge.configure.emit(window)


def _request_quit(*_args) -> None:
    """Close the Qt application so webview.start() returns and the launcher's clean-up runs."""
    try:
        from qtpy.QtWidgets import QApplication

        app = QApplication.instance()
        if app is not None:
            app.quit()
    except Exception:  # a signal handler runs inside a Qt callback: an exception there aborts the app
        log.exception("Could not quit the window on SIGTERM")


def _quit_on_terminate() -> None:
    """SIGTERM (kill, logout, shutdown) closes the window like Ctrl+C does.

    The launcher's handler raised SystemExit; with a Qt window that runs inside a Qt timer callback, where an
    exception aborts the process: instance.json stayed behind and a running share tunnel was never stopped.
    """
    import signal
    import threading

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, _request_quit)


def _enable_features(page) -> None:
    from qtpy.QtWebEngineCore import QWebEngineSettings

    settings = page.settings()
    for attribute in ("PluginsEnabled", "PdfViewerEnabled", "FullScreenSupportEnabled"):
        settings.setAttribute(getattr(QWebEngineSettings.WebAttribute, attribute), True)


def _follow_fullscreen(page, top_level) -> None:
    state = {"maximized": False}

    def on_request(request):
        request.accept()
        # Back to what the window was before (maximized stays maximized): showNormal() alone shrank a maximized
        # window every time a presentation ended.
        if request.toggleOn():
            if not top_level.isFullScreen():
                state["maximized"] = top_level.isMaximized()
            top_level.showFullScreen()
        elif state.get("maximized"):
            top_level.showMaximized()
        else:
            top_level.showNormal()

    page.fullScreenRequested.connect(on_request)


def _configure_window(window) -> None:
    browser = window.native  # pywebview's QMainWindow for this window
    if not hasattr(browser, "webview"):
        log.warning("Unexpected pywebview Qt window layout; PDF viewer and fullscreen stay disabled")
        return
    page = browser.webview.page()
    # Do not change the profile's HTTP cache here: the page is already loading, and switching or clearing the
    # cache then aborts the load (blank window). Fresh files come from the server's "Cache-Control: no-cache".
    _enable_features(page)
    _follow_fullscreen(page, browser)


def _is_app_url(url) -> bool:
    if url.scheme() in ("about", "blob", "data"):
        return True
    return url.host() in ("127.0.0.1", "localhost") and url.port() == _app_port


# Granted to the app's own pages: Share's "Copy link" and pasting use the clipboard, recording uses the microphone
# and camera (pywebview granted those too). Everything else (location, notifications, screen capture...) is refused.
_GRANTED_FEATURES = ("ClipboardReadWrite", "ClipboardSanitizedWrite", "MediaAudioCapture", "MediaVideoCapture",
                     "MediaAudioVideoCapture")


def _patch_permissions() -> None:
    from qtpy.QtWebEngineCore import QWebEnginePage
    from webview.platforms import qt as pywebview_qt

    page_class = getattr(getattr(pywebview_qt, "BrowserView", None), "WebPage", None)
    if page_class is None or not hasattr(page_class, "onFeaturePermissionRequested"):
        return
    feature_enum = QWebEnginePage.Feature
    granted = {getattr(feature_enum, name) for name in _GRANTED_FEATURES if hasattr(feature_enum, name)}
    policy = QWebEnginePage.PermissionPolicy

    def on_feature_permission_requested(page, url, feature):
        try:
            allow = feature in granted and _is_app_url(url)
            page.setFeaturePermission(
                url, feature, policy.PermissionGrantedByUser if allow else policy.PermissionDeniedByUser
            )
        except Exception:  # an exception escaping a Qt slot aborts the app
            log.exception("Could not answer a permission request for %s", feature)

    # WebPage.__init__ connects self.onFeaturePermissionRequested, so replacing it on the class covers every page.
    page_class.onFeaturePermissionRequested = on_feature_permission_requested


def _route_popup_navigation(view, url, is_main_frame, later) -> bool:
    """Whether a popup may load `url`. An outside link goes to the system browser and the popup closes.

    The close is handed to `later` (run once Qt is back in its event loop): closing the view inside
    acceptNavigationRequest discards the page while Chromium is still starting that navigation, and Qt WebEngine
    aborts the whole app (SIGTRAP). Opening a share link from the Share dialog did exactly that.
    """
    if not is_main_frame or _is_app_url(url):
        return True
    try:
        webbrowser.open(url.toString(), 2, True)
    except Exception:  # an exception escaping a Qt virtual aborts the app
        log.exception("Could not open %s in the system browser", url.toString())
    later(view.close)
    return False


def _patch_popups() -> None:
    from qtpy.QtCore import Qt, QTimer
    from qtpy.QtWebEngineCore import QWebEnginePage
    from qtpy.QtWebEngineWidgets import QWebEngineView
    from webview.platforms import qt as pywebview_qt

    if not hasattr(getattr(pywebview_qt, "BrowserView", None), "WebPage"):
        log.warning("Unexpected pywebview Qt internals; popups (presenter view) will open in the system browser")
        return

    class PopupPage(QWebEnginePage):
        def __init__(self, profile, view):
            super().__init__(profile, view)
            self._view = view

        def acceptNavigationRequest(self, url, nav_type, is_main_frame):
            return _route_popup_navigation(self._view, url, is_main_frame, lambda call: QTimer.singleShot(0, call))

    def create_window(page, _window_type):
        view = QWebEngineView()
        view.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        popup = PopupPage(page.profile(), view)  # same profile: same cookies, storage and BroadcastChannel
        view.setPage(popup)
        _enable_features(popup)
        _follow_fullscreen(popup, view)
        popup.windowCloseRequested.connect(view.close)
        view.destroyed.connect(lambda *_: _popups.remove(view) if view in _popups else None)
        view.setWindowTitle("SlideForge")
        view.resize(1400, 900)
        view.show()
        _popups.append(view)
        return popup

    pywebview_qt.BrowserView.WebPage.createWindow = create_window
