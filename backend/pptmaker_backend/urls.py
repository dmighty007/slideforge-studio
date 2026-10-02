from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from slideforge.studio.frontend_files import serve_frontend_file
from slideforge.studio.views import shared_presentation, spa_index


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("slideforge.studio.urls")),
    path("", spa_index, name="spa-index"),
    re_path(r"^(?:index\.html)?$", spa_index, name="spa-index-html"),
    # Shared presentations (read-only viewer, no sign-in): see slideforge/studio/sharing.py.
    re_path(r"^s/(?P<token>[A-Za-z0-9_-]{16,64})/(?P<path>.*)$", shared_presentation, name="shared-presentation"),
]

if settings.DEBUG:
    urlpatterns += [
        re_path(r"^js/(?P<path>.*)$", serve_frontend_file, {"document_root": settings.FRONTEND_DIR / "js"}),
        re_path(r"^css/(?P<path>.*)$", serve_frontend_file, {"document_root": settings.FRONTEND_DIR / "css"}),
        re_path(r"^assets/(?P<path>.*)$", serve_frontend_file, {"document_root": settings.FRONTEND_DIR / "assets"}),
        re_path(r"^static/(?P<path>.*)$", serve_frontend_file, {"document_root": settings.FRONTEND_DIR / "static"}),
        re_path(r"^vendor/(?P<path>.*)$", serve_frontend_file, {"document_root": settings.FRONTEND_DIR / "vendor"}),
    ]
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
