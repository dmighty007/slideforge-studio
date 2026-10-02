// Sketch element rendering and utilities

function renderSketchStrokes(ctx, strokes = [], width, height) {
    if (!ctx || !strokes.length) return;

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    strokes.forEach(stroke => {
        if (!stroke.points || stroke.points.length < 2) return;

        const color = stroke.color || "#000000";
        const strokeWidth = Math.max(1, Math.min(8, stroke.width || 2));

        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 0.8;

        ctx.beginPath();
        const firstPoint = stroke.points[0];
        ctx.moveTo(firstPoint.x, firstPoint.y);

        for (let i = 1; i < stroke.points.length; i++) {
            const point = stroke.points[i];
            ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
    });

    ctx.restore();
}

function createSketchDrawingContext(canvas, elData) {
    const ctx = {
        canvas,
        elementData: elData,
        isDrawing: false,
        currentStroke: null,
        capturedPointerId: null,
    };
    return ctx;
}

function startSketchStroke(ctx, startPoint, color, width) {
    ctx.currentStroke = {
        points: [{ x: startPoint.x, y: startPoint.y }],
        color: color || "#000000",
        width: Math.max(1, Math.min(8, width || 2)),
        timestamp: Date.now(),
    };
    ctx.isDrawing = true;
}

function addPointToSketchStroke(ctx, point) {
    if (!ctx.isDrawing || !ctx.currentStroke) return;
    ctx.currentStroke.points.push({
        x: point.x,
        y: point.y,
    });
}

function finishSketchStroke(ctx) {
    if (!ctx.isDrawing || !ctx.currentStroke) return;

    if (ctx.currentStroke.points.length >= 2) {
        ctx.elementData.strokes = ctx.elementData.strokes || [];
        ctx.elementData.strokes.push(ctx.currentStroke);
    }

    ctx.isDrawing = false;
    ctx.currentStroke = null;
}

function eraseSketchStrokes(ctx, eraserRadius, eraserPoint) {
    if (!ctx.elementData.strokes || !ctx.elementData.strokes.length) return;

    ctx.elementData.strokes = ctx.elementData.strokes
        .map(stroke => {
            if (!stroke.points || !stroke.points.length) return stroke;

            const filteredPoints = stroke.points.filter(point => {
                const dx = point.x - eraserPoint.x;
                const dy = point.y - eraserPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                return dist > eraserRadius;
            });

            return {
                ...stroke,
                points: filteredPoints,
            };
        })
        .filter(stroke => stroke.points && stroke.points.length >= 2);
}

function clearSketchStrokes(ctx) {
    ctx.elementData.strokes = [];
    ctx.isDrawing = false;
    ctx.currentStroke = null;
}
