export class StrokePlayback {
    static strokeDrawTiming(annotation, fallbackDuration = 600) {
        const pointCount = annotation?.geometry?.points?.length || 0;
        return {
            duration: annotation?.animation?.duration || Math.max(fallbackDuration, pointCount * 8),
            easing: annotation?.animation?.easing || "easeOutCubic",
        };
    }
}
