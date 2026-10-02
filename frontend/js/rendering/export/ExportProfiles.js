export const EXPORT_PROFILES = Object.freeze({
    editor: {
        id: "editor",
        dpi: 144,
        background: "opaque",
        preserveLayers: true,
        vectorPreferred: true,
        rasterFallback: "allowed",
    },
    projector: {
        id: "projector",
        dpi: 144,
        background: "opaque",
        preserveLayers: false,
        vectorPreferred: true,
        rasterFallback: "allowed",
        contrastBoost: true,
    },
    conference: {
        id: "conference",
        dpi: 192,
        background: "opaque",
        preserveLayers: true,
        vectorPreferred: true,
        rasterFallback: "allowed",
    },
    publication: {
        id: "publication",
        dpi: 300,
        background: "transparent",
        preserveLayers: true,
        vectorPreferred: true,
        rasterFallback: "warn",
    },
});

export function resolveExportProfile(profile = "publication") {
    if (typeof profile === "object" && profile) {
        return { ...EXPORT_PROFILES.publication, ...profile };
    }
    return EXPORT_PROFILES[profile] || EXPORT_PROFILES.publication;
}
