"""Web-suite configuration with disposable database and media paths."""
from pptmaker_backend.settings import *  # noqa: F403
MEDIA_ROOT = '/tmp/sf-release-web-media'
SLIDEFORGE_FIGURES_DIR = '/tmp/sf-release-web-figures'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
