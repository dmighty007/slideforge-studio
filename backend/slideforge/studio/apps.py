from django.apps import AppConfig


class StudioConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "slideforge.studio"
    label = "studio"  # keeps existing table names and migration history
