export class CanvasGraphRenderer {
    static renderEdges(ctx, edges = [], nodesById = new Map()) {
        if (!ctx) return;
        ctx.save();
        ctx.strokeStyle = "#64748b";
        ctx.lineWidth = 1.5;
        edges.forEach(edge => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            if (!from || !to) return;
            ctx.beginPath();
            ctx.moveTo(from.x + from.width / 2, from.y + from.height / 2);
            ctx.lineTo(to.x + to.width / 2, to.y + to.height / 2);
            ctx.stroke();
        });
        ctx.restore();
    }
}
