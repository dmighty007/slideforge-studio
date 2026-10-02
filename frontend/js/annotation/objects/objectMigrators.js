import { ANNOTATION_SCHEMA_VERSION } from "./objectTypes.js";
import { createAnnotationObject } from "./objectFactory.js";

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function baseStyleFromLegacy(el = {}) {
    return {
        strokeColor: el.strokeColor || "#1f2937",
        backgroundColor: el.backgroundColor || "transparent",
        fillStyle: el.fillStyle || "none",
        strokeWidth: Number(el.strokeWidth) || 2,
        strokeStyle: el.strokeStyle || "solid",
        roughness: Number(el.roughness) || 0,
        bowing: Number(el.bowing) || 1,
        opacity: el.opacity ?? 1,
        fontFamily: el.fontFamily,
        fontSize: el.fontSize,
        blendMode: el.blendMode,
    };
}

export function isAnnotationV2(el) {
    return !!el && Number(el.schemaVersion) >= ANNOTATION_SCHEMA_VERSION && !!el.kind && !!el.geometry;
}

export function legacyDrawingToAnnotation(el = {}, index = 0) {
    if (isAnnotationV2(el)) {
        return {
            ...clone(el),
            schemaVersion: ANNOTATION_SCHEMA_VERSION,
        };
    }

    if (el.type === "freehand") {
        const highlighter = el.role === "highlighter" || el.blendMode === "multiply" || Number(el.opacity) < 0.5;
        return createAnnotationObject({
            kind: highlighter ? "highlightStroke" : "stroke",
            role: highlighter ? "highlighter" : "pen",
            geometry: { points: clone(el.points || []) || [] },
            style: {
                ...baseStyleFromLegacy(el),
                backgroundColor: "transparent",
                fillStyle: "none",
                blendMode: highlighter ? "multiply" : "normal",
            },
            overrides: {
                id: el.id || `anno_legacy_stroke_${index}`,
                zIndex: Number.isFinite(Number(el.zIndex)) ? Number(el.zIndex) : index,
                opacity: el.opacity ?? 1,
                groupId: el.groupId || null,
                locked: !!el.locked,
                visible: el.visible !== false,
                export: el.export,
                presentation: el.presentation,
                animation: el.animation,
            },
        });
    }

    if (el.type === "text") {
        return createAnnotationObject({
            kind: "label",
            role: el.role || "label",
            geometry: {
                x: Number(el.x) || 0,
                y: Number(el.y) || 0,
                text: String(el.text || ""),
                width: Number(el.width) || null,
                height: Number(el.height) || null,
            },
            style: baseStyleFromLegacy(el),
            overrides: {
                id: el.id || `anno_legacy_label_${index}`,
                zIndex: index,
                opacity: el.opacity ?? 1,
                animation: el.animation,
            },
        });
    }

    if (el.type === "draw_shape") {
        const shapeType = el.shapeType || "rectangle";
        const linear = ["line", "arrow", "curve", "curve_arrow"].includes(shapeType);
        const kind = shapeType === "arrow" || shapeType === "curve_arrow" ? "arrow" : linear ? "connector" : "boxedEmphasis";
        return createAnnotationObject({
            kind,
            role: el.role || shapeType,
            geometry: {
                shapeType,
                x: Number(el.x) || 0,
                y: Number(el.y) || 0,
                width: Number(el.width) || 0,
                height: Number(el.height) || 0,
            },
            style: baseStyleFromLegacy(el),
            overrides: {
                id: el.id || `anno_legacy_shape_${index}`,
                zIndex: index,
                opacity: el.opacity ?? 1,
                groupId: el.groupId || null,
                locked: !!el.locked,
                visible: el.visible !== false,
                export: el.export,
                presentation: el.presentation,
                animation: el.animation,
            },
        });
    }

    return null;
}

export function annotationToLegacyDrawing(annotation = {}) {
    if (!isAnnotationV2(annotation)) return clone(annotation);
    const style = annotation.style || {};
    const common = {
        id: annotation.id,
        sourceAnnotationId: annotation.id,
        role: annotation.role,
        strokeColor: style.strokeColor || "#1f2937",
        backgroundColor: style.backgroundColor || "transparent",
        fillStyle: style.fillStyle || "none",
        strokeWidth: Number(style.strokeWidth) || 2,
        strokeStyle: style.strokeStyle || "solid",
        roughness: Number(style.roughness) || 0,
        bowing: Number(style.bowing) || 1,
        opacity: annotation.opacity ?? style.opacity ?? 1,
        groupId: annotation.groupId || null,
        locked: !!annotation.locked,
        visible: annotation.visible !== false,
        export: annotation.export,
        presentation: annotation.presentation,
        animation: annotation.animation,
    };
    const geometry = annotation.geometry || {};
    if (annotation.kind === "stroke" || annotation.kind === "highlightStroke" || annotation.kind === "freeformPath" || annotation.kind === "laserTrail" || annotation.kind === "gesture") {
        return {
            ...common,
            type: "freehand",
            points: clone(geometry.points || []) || [],
            blendMode: style.blendMode || (annotation.kind === "highlightStroke" ? "multiply" : "normal"),
        };
    }
    if (annotation.kind === "label" || annotation.kind === "sticky") {
        return {
            ...common,
            type: "text",
            x: Number(geometry.x) || 0,
            y: Number(geometry.y) || 0,
            text: String(geometry.text || ""),
            fontSize: Number(style.fontSize) || 22,
            fontFamily: style.fontFamily || '"Virgil", "Comic Sans MS", "Segoe Print", cursive',
        };
    }
    return {
        ...common,
        type: "draw_shape",
        shapeType: geometry.shapeType || (annotation.kind === "arrow" ? "arrow" : "rectangle"),
        x: Number(geometry.x) || 0,
        y: Number(geometry.y) || 0,
        width: Number(geometry.width) || 0,
        height: Number(geometry.height) || 0,
    };
}

export function normalizeAnnotationElements(elements = []) {
    return (Array.isArray(elements) ? elements : [])
        .map((el, index) => legacyDrawingToAnnotation(el, index))
        .filter(Boolean)
        .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0));
}

export function legacySketchElementToAnnotations(sketchElement = {}, offsetX = 0, offsetY = 0) {
    return (sketchElement.strokes || []).map((stroke, index) =>
        createAnnotationObject({
            kind: "stroke",
            role: "legacy-sketch",
            geometry: {
                points: (stroke.points || []).map(point => ({
                    x: (Number(point.x) || 0) + offsetX,
                    y: (Number(point.y) || 0) + offsetY,
                    pressure: point.pressure ?? 0.5,
                    t: point.t || stroke.timestamp || Date.now(),
                })),
            },
            style: {
                strokeColor: stroke.color || sketchElement.sketchStrokeColor || "#1f2937",
                strokeWidth: Number(stroke.width || sketchElement.sketchStrokeWidth) || 2,
                backgroundColor: "transparent",
                fillStyle: "none",
                strokeStyle: "solid",
                roughness: 0,
                opacity: 1,
            },
            overrides: {
                id: `anno_sketch_${sketchElement.id || "legacy"}_${index}`,
                zIndex: index,
                metadata: { migratedFrom: "sketch", sourceElementId: sketchElement.id },
            },
        }),
    );
}
