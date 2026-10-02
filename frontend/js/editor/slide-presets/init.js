// Slide presets: installs the preset families, metadata and palette at load time. Must load after the other editor/slide-presets/*.js files.

_installModernPresetBuilders();

_installSciencePresetBuilders();

_installProfessionalPresetBuilders();

_installExportPresetBuilders();

installPresetMetadata();

window.SLIDE_PRESETS = SLIDE_PRESETS;

window.PRESET_METADATA = PRESET_METADATA;

window.PRESET_CATEGORY_LABELS = PRESET_CATEGORY_LABELS;

renderPresetSlidePalette();
