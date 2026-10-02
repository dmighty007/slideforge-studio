export class EdgeRouter {
    static route(edge, from, to, mode = "orthogonal") {
        if (!from || !to) return [];
        const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
        const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
        if (mode === "curved") return [a, b];
        const midX = (a.x + b.x) / 2;
        return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
    }
}
