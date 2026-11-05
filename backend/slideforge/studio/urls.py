from django.conf import settings
from django.urls import path, re_path

from .auth_views import auth_login, auth_logout, auth_register, auth_session
from .plugin_views import plugin_detail, plugin_install, plugin_list
from .views import (
    asset_pdf_page,
    asset_upload,
    asset_video_webm,
    export_pptx_view,
    font_files_view,
    fonts_view,
    own_font_file,
    import_keynote_view,
    import_pdf_view,
    presentation_create,
    presentation_detail,
    presentation_share,
    slide_cleanup_view,
)


urlpatterns = [
    path("auth/session/", auth_session, name="auth-session"),
    path("assets/upload/", asset_upload, name="asset-upload"),
    path("assets/pdf-page/", asset_pdf_page, name="asset-pdf-page"),
    path("assets/video-webm/", asset_video_webm, name="asset-video-webm"),
    path("fonts/", fonts_view, name="fonts"),
    path("fonts/files/", font_files_view, name="font-files"),
    re_path(r"^fonts/own/(?P<path>[A-Za-z0-9._/-]{1,80})$", own_font_file, name="own-font-file"),
    path("slides/cleanup/", slide_cleanup_view, name="slide-cleanup"),
    path("presentations/", presentation_create, name="presentation-create"),
    path("presentations/<uuid:presentation_id>/", presentation_detail, name="presentation-detail"),
    path("presentations/<uuid:presentation_id>/share/", presentation_share, name="presentation-share"),
    path("presentations/export/pptx/", export_pptx_view, name="export-pptx"),
    path("presentations/import/keynote/", import_keynote_view, name="import-keynote"),
    path("presentations/import/pdf/", import_pdf_view, name="import-pdf"),
    path("plugins/", plugin_list, name="plugin-list"),
    path("plugins/install/", plugin_install, name="plugin-install"),
    path("plugins/<slug:plugin_id>/", plugin_detail, name="plugin-detail"),
]

# Sign-in exists only when accounts are enabled (the web app). The desktop app runs as one local user.
if getattr(settings, "SLIDEFORGE_ACCOUNTS_ENABLED", True):
    urlpatterns += [
        path("auth/register/", auth_register, name="auth-register"),
        path("auth/login/", auth_login, name="auth-login"),
        path("auth/logout/", auth_logout, name="auth-logout"),
    ]
