export const ANNOTATION_SCHEMA_VERSION = 2;

export const ANNOTATION_KINDS = Object.freeze({
    STROKE: "stroke",
    HIGHLIGHT_STROKE: "highlightStroke",
    ARROW: "arrow",
    CALLOUT: "callout",
    LABEL: "label",
    STICKY: "sticky",
    CONNECTOR: "connector",
    EQUATION: "equationAnnotation",
    BOXED_EMPHASIS: "boxedEmphasis",
    MOLECULE_REGION: "moleculeRegion",
    FREEFORM_PATH: "freeformPath",
    LASER_TRAIL: "laserTrail",
    GESTURE: "gesture",
});

export const ANNOTATION_EXPORT_DEFAULTS = Object.freeze({
    includeInPdf: true,
    includeInPng: true,
    includeInSvg: true,
    flatten: false,
});

export const ANNOTATION_PRESENTATION_DEFAULTS = Object.freeze({
    mode: "persistent",
    audienceVisible: true,
});

export const ANNOTATION_ANIMATION_DEFAULTS = Object.freeze({
    type: "none",
    delay: 0,
    duration: 600,
    sequence: null,
});

export const SCIENTIFIC_ANNOTATION_PRESETS = Object.freeze([
    {
        id: "molecule-pocket",
        label: "Ligand pocket",
        tool: "moleculeHighlight",
        kind: ANNOTATION_KINDS.MOLECULE_REGION,
        role: "ligand-pocket",
        icon: "fa-atom",
    },
    {
        id: "pathway-activation",
        label: "Activation arrow",
        tool: "pathwayArrow",
        kind: ANNOTATION_KINDS.ARROW,
        role: "pathway-activation",
        icon: "fa-arrow-trend-up",
    },
    {
        id: "equation-term",
        label: "Equation term",
        tool: "equationMarker",
        kind: ANNOTATION_KINDS.EQUATION,
        role: "term-emphasis",
        icon: "fa-square-root-variable",
    },
    {
        id: "figure-callout",
        label: "Figure callout",
        tool: "callout",
        kind: ANNOTATION_KINDS.CALLOUT,
        role: "figure-callout",
        icon: "fa-comment-medical",
    },
    {
        id: "spectral-peak",
        label: "Peak label",
        tool: "callout",
        kind: ANNOTATION_KINDS.LABEL,
        role: "spectral-peak",
        icon: "fa-chart-line",
    },
]);
