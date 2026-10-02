from django.contrib import admin

from .models import Asset, Presentation, PresentationRevision


@admin.register(Presentation)
class PresentationAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "presentation_theme", "autosave_version", "updated_at")
    search_fields = ("title",)


@admin.register(PresentationRevision)
class PresentationRevisionAdmin(admin.ModelAdmin):
    list_display = ("presentation", "version", "created_at")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("id", "asset_type", "presentation", "created_at")
