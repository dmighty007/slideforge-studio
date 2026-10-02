// The shapes SlideForge offers, in one place: the picker, the editor, the HTML viewer, SVG export and PowerPoint
// export/import all read this, so a shape looks the same everywhere.
// points: the outline as [x, y] in percent of the box (0-100). pptx: the PowerPoint preset (prst) name.
// Block arrows are drawn from their head and shaft sizes in shapes.js, so they have no fixed points here.

const SHAPE_CATALOG = [
    { type: "rectangle", label: "Rectangle", group: "basic", pptx: "rect" },
    {
        type: "rounded-rectangle",
        label: "Rounded",
        group: "basic",
        pptx: "roundRect",
        // A rectangle with corners: it stays a rectangle with a radius, so the radius can still be edited.
        insertAs: { shapeType: "rectangle", styles: { borderRadius: "18px" } },
    },
    { type: "circle", label: "Circle", group: "basic", pptx: "ellipse" },
    { type: "triangle", label: "Triangle", group: "basic", pptx: "triangle", points: [[50, 0], [100, 100], [0, 100]] },
    { type: "right-triangle", label: "Right triangle", group: "basic", pptx: "rtTriangle", points: [[0, 0], [100, 100], [0, 100]] },
    { type: "diamond", label: "Diamond", group: "basic", pptx: "diamond", points: [[50, 0], [100, 50], [50, 100], [0, 50]] },
    { type: "parallelogram", label: "Parallelogram", group: "basic", pptx: "parallelogram", points: [[20, 0], [100, 0], [80, 100], [0, 100]] },
    { type: "trapezoid", label: "Trapezoid", group: "basic", pptx: "trapezoid", points: [[20, 0], [80, 0], [100, 100], [0, 100]] },
    { type: "pentagon", label: "Pentagon", group: "basic", pptx: "pentagon", points: [[50, 0], [100, 38], [81, 100], [19, 100], [0, 38]] },
    { type: "hexagon", label: "Hexagon", group: "basic", pptx: "hexagon", points: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]] },
    { type: "octagon", label: "Octagon", group: "basic", pptx: "octagon", points: [[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]] },
    {
        type: "star",
        label: "Star",
        group: "basic",
        pptx: "star5",
        points: [[50, 0], [61.2, 34.5], [97.6, 34.5], [68.2, 55.9], [79.4, 90.5], [50, 69.1], [20.6, 90.5], [31.8, 55.9], [2.4, 34.5], [38.8, 34.5]],
    },
    { type: "plus", label: "Plus", group: "basic", pptx: "plus", points: [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]] },
    { type: "chevron", label: "Chevron", group: "basic", pptx: "chevron", points: [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]] },
    {
        type: "callout",
        label: "Callout",
        group: "basic",
        pptx: "wedgeRectCallout",
        points: [[0, 0], [100, 0], [100, 76], [42, 76], [22, 100], [26, 76], [0, 76]],
    },
    { type: "arrow-right", label: "Right", group: "arrow", pptx: "rightArrow" },
    { type: "arrow-left", label: "Left", group: "arrow", pptx: "leftArrow" },
    { type: "arrow-up", label: "Up", group: "arrow", pptx: "upArrow" },
    { type: "arrow-down", label: "Down", group: "arrow", pptx: "downArrow" },
];

// Outline points by shape type, for the shapes with a fixed outline.
const SHAPE_POLYGONS = Object.fromEntries(SHAPE_CATALOG.filter(shape => shape.points).map(shape => [shape.type, shape.points]));

// A small SVG of the shape for the picker (block arrows use the default head and shaft sizes).
function shapeCatalogPreviewSvg(shape) {
    const frame = 'viewBox="-4 -4 108 108" width="34" height="34" aria-hidden="true"';
    const paint = 'fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="2.25" stroke-linejoin="round" vector-effect="non-scaling-stroke"';
    if (shape.type === "circle") return `<svg ${frame}><ellipse cx="50" cy="50" rx="50" ry="50" ${paint}/></svg>`;
    if (shape.type === "rectangle") return `<svg ${frame}><rect x="0" y="12" width="100" height="76" ${paint}/></svg>`;
    if (shape.type === "rounded-rectangle") return `<svg ${frame}><rect x="0" y="12" width="100" height="76" rx="18" ${paint}/></svg>`;
    let points = shape.points;
    if (!points && typeof getShapeStyle === "function") {
        const clip = getShapeStyle(shape.type).clipPath;
        points = typeof _parseShapePolygonPoints === "function" ? _parseShapePolygonPoints(clip) : [];
    }
    if (!points?.length) return `<svg ${frame}><rect x="0" y="0" width="100" height="100" ${paint}/></svg>`;
    // Arrows are wide boxes: squash them into the icon so they read as arrows.
    const squash = shape.group === "arrow" && (shape.type === "arrow-right" || shape.type === "arrow-left");
    const lift = shape.group === "arrow" && (shape.type === "arrow-up" || shape.type === "arrow-down");
    const mapped = points.map(([x, y]) => [lift ? 20 + x * 0.6 : x, squash ? 20 + y * 0.6 : y]);
    return `<svg ${frame}><polygon points="${mapped.map(([x, y]) => `${x},${y}`).join(" ")}" ${paint}/></svg>`;
}

function renderShapePickerGrids() {
    [["basic", "shape-picker-basic"], ["arrow", "shape-picker-arrows"]].forEach(([group, id]) => {
        const grid = document.getElementById(id);
        if (!grid) return;
        grid.innerHTML = SHAPE_CATALOG.filter(shape => shape.group === group)
            .map(
                shape => `<button type="button" onclick="insertShapeFromPicker('${shape.type}')" class="shape-picker-item" title="${shape.label}">
                    ${shapeCatalogPreviewSvg(shape)}
                    <span>${shape.label}</span>
                </button>`,
            )
            .join("");
    });
}

window.SHAPE_CATALOG = SHAPE_CATALOG;
window.SHAPE_POLYGONS = SHAPE_POLYGONS;
window.renderShapePickerGrids = renderShapePickerGrids;
