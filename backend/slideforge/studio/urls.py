from django.conf import settings
from django.urls import path

from .auth_views import auth_login, auth_logout, auth_register, auth_session
from .views import (
    asset_pdf_page,
    asset_upload,
    export_pptx_view,
    presentation_create,
    presentation_detail,
    presentation_share,
    slide_cleanup_view,
)


urlpatterns = [
    path("auth/session/", auth_session, name="auth-session"),
    path("assets/upload/", asset_upload, name="asset-upload"),
    path("assets/pdf-page/", asset_pdf_page, name="asset-pdf-page"),
    path("slides/cleanup/", slide_cleanup_view, name="slide-cleanup"),
    path("presentations/", presentation_create, name="presentation-create"),
    path("presentations/<uuid:presentation_id>/", presentation_detail, name="presentation-detail"),
    path("presentations/<uuid:presentation_id>/share/", presentation_share, name="presentation-share"),
    path("presentations/export/pptx/", export_pptx_view, name="export-pptx"),
]

# Sign-in exists only when accounts are enabled (the web app). The desktop app runs as one local user.
if getattr(settings, "SLIDEFORGE_ACCOUNTS_ENABLED", True):
    urlpatterns += [
        path("auth/register/", auth_register, name="auth-register"),
        path("auth/login/", auth_login, name="auth-login"),
        path("auth/logout/", auth_logout, name="auth-logout"),
    ]
