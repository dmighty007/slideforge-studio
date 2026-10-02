import {
    ANNOTATION_ANIMATION_DEFAULTS,
    ANNOTATION_EXPORT_DEFAULTS,
    ANNOTATION_PRESENTATION_DEFAULTS,
    ANNOTATION_SCHEMA_VERSION,
} from "./objectTypes.js";

export function createAnnotationId(prefix = "anno") {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export function createAnnotationObject({ kind, role = kind, geometry = {}, style = {}, metadata = {}, overrides = {} }) {
    return {
        id: overrides.id || createAnnotationId(),
        schemaVersion: ANNOTATION_SCHEMA_VERSION,
        kind,
        role,
        geometry: { ...geometry },
        style: { ...style },
        metadata: { ...metadata, ...(overrides.metadata || {}) },
        zIndex: Number.isFinite(Number(overrides.zIndex)) ? Number(overrides.zIndex) : 0,
        opacity: Number.isFinite(Number(overrides.opacity)) ? Number(overrides.opacity) : 1,
        groupId: overrides.groupId || null,
        locked: !!overrides.locked,
        visible: overrides.visible !== false,
        export: { ...ANNOTATION_EXPORT_DEFAULTS, ...(overrides.export || {}) },
        presentation: { ...ANNOTATION_PRESENTATION_DEFAULTS, ...(overrides.presentation || {}) },
        animation: { ...ANNOTATION_ANIMATION_DEFAULTS, ...(overrides.animation || {}) },
    };
}

export function createStrokeAnnotation(points, style = {}, overrides = {}) {
    return createAnnotationObject({
        kind: style.role === "highlighter" ? "highlightStroke" : "stroke",
        role: style.role || "pen",
        geometry: { points: Array.isArray(points) ? points : [] },
        style,
        overrides,
    });
}

export function createShapeAnnotation(kind, geometry, style = {}, overrides = {}) {
    return createAnnotationObject({
        kind,
        role: overrides.role || kind,
        geometry,
        style,
        metadata: overrides.metadata || {},
        overrides,
    });
}
