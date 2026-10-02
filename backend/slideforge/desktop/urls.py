from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from slideforge.studio.frontend_files import serve_frontend_file
from slideforge.studio.views import shared_presentation, spa_index

from .views import share_tunnel

# The desktop app always serves the bundled frontend and the user's media itself (there is no separate web server).
_frontend = settings.FRONTEND_DIR

urlpatterns = [
    path("api/share/tunnel/", share_tunnel, name="share-tunnel"),
    path("api/", include("slideforge.studio.urls")),
    path("", spa_index, name="spa-index"),
    re_path(r"^(?:index\.html)?$", spa_index, name="spa-index-html"),
    # Shared presentations (read-only viewer, no sign-in): see slideforge/studio/sharing.py.
    re_path(r"^s/(?P<token>[A-Za-z0-9_-]{16,64})/(?P<path>.*)$", shared_presentation, name="shared-presentation"),
    *(
        re_path(rf"^{prefix}/(?P<path>.*)$", serve_frontend_file, {"document_root": _frontend / prefix})
        for prefix in ("js", "css", "assets", "static", "vendor")
    ),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
