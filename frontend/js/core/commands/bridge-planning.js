// Document import: choosing visuals, measuring content density and summarizing slides.

function _bridgeChoosePrimaryVisual(slide) {
    const visuals = Array.isArray(slide?.visuals) ? slide.visuals.filter(item => item?.path) : [];
    if (!visuals.length) return null;
    const preferred = slide?.primary_visual_id ? visuals.find(item => item.id === slide.primary_visual_id) : null;
    if (preferred) return preferred;
    const weakPreferredId = slide?.fig_id || slide?.visual_id;
    const slideText = _bridgeSlideMatchText(slide);
    return visuals
        .map((visual, index) => ({
            visual,
            index,
            score: _bridgeTextMatchScore(
                slideText,
                [visual.caption, visual.finding, visual.type, visual.id].filter(Boolean).join(" "),
            ),
            preferred: weakPreferredId && visual.id === weakPreferredId ? 1 : 0,
        }))
        .sort((a, b) => b.score - a.score || b.preferred - a.preferred || a.index - b.index)[0].visual;
}

function _normalizeBridgeContentSlide(slide) {
    const visuals = Array.isArray(slide?.visuals) ? slide.visuals.filter(Boolean) : [];
    const primaryVisual = _bridgeChoosePrimaryVisual({ ...slide, visuals });
    const normalizedFigPath =
        typeof slide?.fig_path === "string" &&
        slide.fig_path.trim() &&
        (!primaryVisual || primaryVisual.id === slide?.visual_id || primaryVisual.path === slide.fig_path)
            ? slide.fig_path
            : primaryVisual?.path || "";
    const normalizedFigCap =
        typeof slide?.fig_cap === "string" && slide.fig_cap.trim() ? slide.fig_cap : primaryVisual?.caption || "";

    return {
        ...slide,
        visuals,
        visual_id: primaryVisual?.id || slide?.visual_id || null,
        fig_path: normalizedFigPath,
        fig_cap: normalizedFigCap,
    };
}

function _bridgePlanPrimaryVisuals(slides) {
    const contentSlides = (slides || []).filter(slide => slide?.type === "content");
    const visualUsage = new Map();
    const candidates = [];

    contentSlides.forEach((slide, slideIndex) => {
        const primary = _bridgeChoosePrimaryVisual(slide);
        if (primary?.id) visualUsage.set(primary.id, (visualUsage.get(primary.id) || 0) + 1);
        (Array.isArray(slide.visuals) ? slide.visuals : []).forEach(visual => {
            if (!visual?.id || !visual?.path) return;
            candidates.push({
                slide,
                slideIndex,
                visual,
                score: _bridgeTextMatchScore(
                    _bridgeSlideMatchText(slide),
                    [visual.caption, visual.finding, visual.type, visual.id].filter(Boolean).join(" "),
                ),
            });
        });
    });

    const allVisualIds = new Set(candidates.map(item => item.visual.id));
    allVisualIds.forEach(visualId => {
        if (visualUsage.has(visualId)) return;
        const best = candidates
            .filter(item => item.visual.id === visualId)
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    (visualUsage.get(_bridgeChoosePrimaryVisual(a.slide)?.id) || 0) -
                        (visualUsage.get(_bridgeChoosePrimaryVisual(b.slide)?.id) || 0),
            )[0];
        if (!best) return;
        const previous = _bridgeChoosePrimaryVisual(best.slide);
        if (previous?.id) visualUsage.set(previous.id, Math.max(0, (visualUsage.get(previous.id) || 1) - 1));
        best.slide.primary_visual_id = best.visual.id;
        visualUsage.set(best.visual.id, 1);
    });

    return slides;
}

function _bridgeSlideMetrics(slide) {
    const points = Array.isArray(slide?.points) ? slide.points : [];
    let bulletCount = 0;
    let wordCount = 0;
    for (const point of points) {
        const heading = String(point?.heading || "").trim();
        if (heading) wordCount += heading.split(/\s+/).filter(Boolean).length;
        const bullets = Array.isArray(point?.content) ? point.content : [point?.content];
        for (const bullet of bullets) {
            const clean = String(bullet || "").trim();
            if (!clean) continue;
            bulletCount += 1;
            wordCount += clean.split(/\s+/).filter(Boolean).length;
        }
    }
    return {
        pointCount: points.length,
        bulletCount,
        wordCount,
        hasFigure: Boolean(slide?.fig_path),
        hasCaption: Boolean(slide?.fig_cap),
    };
}

function _bridgeIsDenseSlide(slide) {
    const metrics = _bridgeSlideMetrics(slide);
    return metrics.wordCount >= 62 || metrics.bulletCount >= 5 || (metrics.hasFigure && metrics.wordCount >= 42);
}

function _bridgePointsAsCards(points, maxCards = 3) {
    return (Array.isArray(points) ? points : [])
        .map(point => {
            const heading = _bridgeCleanImportedText(point?.heading, "Takeaway");
            const bullets = (Array.isArray(point?.content) ? point.content : [point?.content])
                .map(item => _bridgeCleanImportedText(item))
                .filter(Boolean);
            return {
                heading: _bridgeWordClamp(heading, 6),
                body: _bridgeWordClamp(bullets.join(" "), 28),
            };
        })
        .filter(card => card.heading || card.body)
        .slice(0, maxCards);
}

function _bridgeNarrativeSummary(points, maxSentences = 2) {
    const chunks = [];
    _bridgePointsAsCards(points, maxSentences + 1).forEach(card => {
        if (card.body) chunks.push(card.body);
    });
    return chunks.slice(0, maxSentences).join(" ");
}

function _bridgeVisualMeta(theme) {
    return {
        accent: theme.accentStrong || "#2563EB",
        accentSoft: `${theme.accentStrong || "#2563EB"}18`,
        text: theme.defaultTextColor,
        muted: theme.defaultMutedColor,
        headingFont: theme.headingFont,
        bodyFont: theme.bodyFont,
        surface: theme.surfaceColor || "rgba(255,255,255,0.72)",
        surfaceBorder: theme.surfaceBorder || "rgba(148,163,184,0.22)",
    };
}

function _bridgeSlideSummary(slide) {
    const direct = _bridgeNarrativeSummary(slide?.points, 1);
    return direct || String(slide?.claim || slide?.goal || slide?.fig_cap || slide?.title || "");
}
