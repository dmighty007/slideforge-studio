"""Django settings for the SlideForge desktop app (single local user, served on localhost only).

The web app uses backend/pptmaker_backend/settings.py; both run the same slideforge.studio app and frontend.
"""

import os
import secrets

from dotenv import load_dotenv

from slideforge.desktop import paths

DATA_DIR = paths.data_dir()
MEDIA_ROOT = DATA_DIR / "media"
MEDIA_ROOT.mkdir(exist_ok=True)
# Scratch output of the PDF-to-slides pipeline (read by slideforge.bridge.utils.figures_root).
os.environ.setdefault("SLIDEFORGE_FIGURES_DIR", str(DATA_DIR / "extracted_figures"))

# Optional user configuration (LLM keys, Ollama URL, ...). Real environment variables take precedence.
load_dotenv(DATA_DIR / "config.env", override=False)


def _env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _secret_key() -> str:
    """Generated once per installation and stored in the data directory."""
    key_file = DATA_DIR / "secret_key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(50)
    key_file.write_text(key, encoding="utf-8")
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    return key


BASE_DIR = paths.PACKAGE_DIR
FRONTEND_DIR = paths.FRONTEND_DIR  # read by studio.views.spa_index
DEBUG = _env_bool("SLIDEFORGE_DEBUG", False)
SECRET_KEY = _secret_key()
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

# Set by the launcher for each run; see slideforge.desktop.LaunchTokenMiddleware.
SLIDEFORGE_LAUNCH_TOKEN = os.getenv("SLIDEFORGE_LAUNCH_TOKEN", "")
SLIDEFORGE_LOCAL_USERNAME = "local"
# No sign-in: every request runs as the local user (see middleware.LocalUserMiddleware).
SLIDEFORGE_ACCOUNTS_ENABLED = False

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "slideforge.studio",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "slideforge.desktop.middleware.LaunchTokenMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "slideforge.desktop.middleware.LocalUserMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "slideforge.studio.middleware.ContentSecurityPolicyMiddleware",
]

ROOT_URLCONF = "slideforge.desktop.urls"
WSGI_APPLICATION = "slideforge.desktop.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    }
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "slideforge.sqlite3",
        "OPTIONS": {
            # Take the write lock at BEGIN and wait for it, instead of failing with "database is locked"
            # when saves overlap; WAL lets reads continue during a write.
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("SLIDEFORGE_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
MEDIA_URL = "/media/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

DATA_UPLOAD_MAX_MEMORY_SIZE = _env_int("DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE", 500 * 1024 * 1024)
# Uploaded files larger than this are streamed to a temp file instead of held in memory.
FILE_UPLOAD_MAX_MEMORY_SIZE = _env_int("DJANGO_FILE_UPLOAD_MAX_MEMORY_SIZE", 10 * 1024 * 1024)
PPTMAKER_MAX_ASSET_UPLOAD_BYTES = _env_int("PPTMAKER_MAX_ASSET_UPLOAD_BYTES", 500 * 1024 * 1024)
PPTMAKER_MAX_MOLECULE_UPLOAD_BYTES = _env_int("PPTMAKER_MAX_MOLECULE_UPLOAD_BYTES", 500 * 1024 * 1024)
PPTMAKER_MAX_USER_ASSET_STORAGE_BYTES = _env_int("PPTMAKER_MAX_USER_ASSET_STORAGE_BYTES", 5000 * 1024 * 1024)
PPTMAKER_FFMPEG_TIMEOUT_SECONDS = _env_int("PPTMAKER_FFMPEG_TIMEOUT_SECONDS", 900, minimum=30)
PPTMAKER_USE_MARKER_VISUALS = os.getenv("PPTMAKER_USE_MARKER_VISUALS", "0") == "1"
PPTMAKER_MARKER_TIMEOUT_SECONDS = _env_int("PPTMAKER_MARKER_TIMEOUT_SECONDS", 300, minimum=30)
PPTMAKER_ENABLE_AI_CLEANUP = os.getenv("PPTMAKER_ENABLE_AI_CLEANUP", "0") == "1"
PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS = _env_int("PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS", 90, minimum=5)

# Single local user: per-user upload rate limiting only gets in the way.
RATELIMIT_ENABLE = False

# Served over plain HTTP on localhost, so no HTTPS-only cookies or HSTS.
SESSION_COOKIE_NAME = "slideforge_sessionid"
SESSION_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SAMESITE = "Strict"
X_FRAME_OPTIONS = "SAMEORIGIN"

# Sent by slideforge.studio.middleware.ContentSecurityPolicyMiddleware.
CSP_REPORT_ONLY = _env_bool("PPTMAKER_CSP_REPORT_ONLY", False)
CONTENT_SECURITY_POLICY = {
    "default-src": ("'self'",),
    "script-src": ("'self'", "'unsafe-inline'"),
    "style-src": ("'self'", "'unsafe-inline'"),
    "img-src": ("'self'", "data:", "blob:", "https:"),
    "font-src": ("'self'", "data:"),
    "connect-src": ("'self'",),
    "frame-ancestors": ("'self'",),
    "media-src": ("'self'", "blob:", "data:", "https:"),
    "frame-src": ("'self'", "blob:", "data:", "https:"),
    "worker-src": ("'self'", "blob:"),
    "object-src": ("'none'",),
    "base-uri": ("'self'",),
    "form-action": ("'self'",),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"()": "slideforge.desktop.logformat.UTCFormatter"}},
    "handlers": {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(DATA_DIR / "slideforge.log"),
            "maxBytes": 2_000_000,
            "backupCount": 3,
            "encoding": "utf-8",
            "formatter": "plain",
        },
    },
    "root": {"handlers": ["file"], "level": os.getenv("SLIDEFORGE_LOG_LEVEL", "INFO")},
}
