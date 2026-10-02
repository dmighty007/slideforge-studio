import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
# Real environment variables take precedence over values in .env.
load_dotenv(PROJECT_ROOT / ".env", override=False)
FRONTEND_DIR = PROJECT_ROOT / "frontend"


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


TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"
DEBUG = os.getenv("DJANGO_DEBUG", "1" if "runserver" in sys.argv else "0") == "1"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG or TESTING:
        import warnings

        warnings.warn(
            "DJANGO_SECRET_KEY not set. Using development key. "
            "Set DJANGO_SECRET_KEY environment variable in production!",
            RuntimeWarning,
            stacklevel=2,
        )
        SECRET_KEY = "dev-only-pptmaker-secret-key-change-in-production"
    else:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY environment variable must be set in production. "
            "Generate a new key with: python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'"
        )
ALLOWED_HOSTS_ENV = os.getenv("DJANGO_ALLOWED_HOSTS", "")
if not ALLOWED_HOSTS_ENV:
    if DEBUG or TESTING:
        ALLOWED_HOSTS = ["127.0.0.1", "localhost", "testserver"]
    else:
        raise ImproperlyConfigured(
            "DJANGO_ALLOWED_HOSTS environment variable must be set in production. "
            "Set it to a comma-separated list of allowed hostnames (e.g., 'example.com,www.example.com')"
        )
else:
    ALLOWED_HOSTS = [host.strip() for host in ALLOWED_HOSTS_ENV.split(",") if host.strip()]
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS is empty after parsing")


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "slideforge.studio",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "slideforge.studio.middleware.ContentSecurityPolicyMiddleware",
]

ROOT_URLCONF = "pptmaker_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "pptmaker_backend.wsgi.application"
ASGI_APPLICATION = "pptmaker_backend.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "OPTIONS": {
            # Take the write lock at BEGIN and wait for it, instead of failing with "database is locked"
            # when saves overlap; WAL lets reads continue during a write.
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

AUTH_PASSWORD_VALIDATORS = (
    []
    if DEBUG
    else [
        {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
        {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
        {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
        {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    ]
)

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [FRONTEND_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DATA_UPLOAD_MAX_MEMORY_SIZE = _env_int("DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE", 500 * 1024 * 1024)
# Uploaded files larger than this are streamed to a temp file instead of held in memory.
FILE_UPLOAD_MAX_MEMORY_SIZE = _env_int("DJANGO_FILE_UPLOAD_MAX_MEMORY_SIZE", 10 * 1024 * 1024)
PPTMAKER_MAX_ASSET_UPLOAD_BYTES = _env_int("PPTMAKER_MAX_ASSET_UPLOAD_BYTES", 500 * 1024 * 1024)
PPTMAKER_MAX_MOLECULE_UPLOAD_BYTES = _env_int("PPTMAKER_MAX_MOLECULE_UPLOAD_BYTES", 500 * 1024 * 1024)
PPTMAKER_MAX_USER_ASSET_STORAGE_BYTES = _env_int("PPTMAKER_MAX_USER_ASSET_STORAGE_BYTES", 5000 * 1024 * 1024)
PPTMAKER_ALLOW_SERVER_LOCAL_FILE_UPLOAD = _env_bool("PPTMAKER_ALLOW_SERVER_LOCAL_FILE_UPLOAD", False)
# Sign-in and per-user projects. The desktop app (slideforge.desktop) turns this off and runs as one local user.
SLIDEFORGE_ACCOUNTS_ENABLED = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
X_FRAME_OPTIONS = "SAMEORIGIN"

# ========== SECURITY SETTINGS ==========
_SECURE = not DEBUG and not TESTING
SECURE_SSL_REDIRECT = _SECURE
SESSION_COOKIE_SECURE = _SECURE
CSRF_COOKIE_SECURE = _SECURE
SECURE_HSTS_SECONDS = 31536000 if _SECURE else 0  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = _SECURE
SECURE_HSTS_PRELOAD = _SECURE

# Sent by studio.middleware.ContentSecurityPolicyMiddleware (Django 5.2 has no built-in CSP).
# Report-only by default in DEBUG so violations show in the browser console without breaking the editor.
CSP_REPORT_ONLY = _env_bool("PPTMAKER_CSP_REPORT_ONLY", DEBUG)
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
# ========== END SECURITY SETTINGS ==========

PPTMAKER_FFMPEG_TIMEOUT_SECONDS = _env_int("PPTMAKER_FFMPEG_TIMEOUT_SECONDS", 900, minimum=30)
PPTMAKER_USE_MARKER_VISUALS = os.getenv("PPTMAKER_USE_MARKER_VISUALS", "0") == "1"
PPTMAKER_MARKER_TIMEOUT_SECONDS = _env_int("PPTMAKER_MARKER_TIMEOUT_SECONDS", 300, minimum=30)
PPTMAKER_ENABLE_AI_CLEANUP = os.getenv("PPTMAKER_ENABLE_AI_CLEANUP", "0") == "1"
PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS = _env_int("PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS", 90, minimum=5)
