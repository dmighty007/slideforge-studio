export class CanvasLiveRenderer {
    static resizeForDpr(canvas, width, height) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
    }
}
