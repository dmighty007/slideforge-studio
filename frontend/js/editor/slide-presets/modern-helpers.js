// Slide presets: building blocks for the modern preset family.

function _modernPalette(theme) {
    const { a, a2, aText, a2Text, fg, mu, sf, sb, hf, bf } = _t(theme);
    const meta = _presetMeta(theme);
    const isLight = meta.isLightCanvas;
    const canvasBackground = theme.cssVars?.["--slide-bg"] || (isLight ? "#F8FAFC" : "#0B1020");
    const canvas = isLight ? "#F8FAFC" : "#0B1020";
    const panel = isLight ? sf || "rgba(255,255,255,0.88)" : sf || "rgba(255,255,255,0.075)";
    const raisedPanel = isLight ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.095)";
    const line = sb || (isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.14)");
    const washOpacity = isLight ? 0.12 : 0.18;
    const washOpacityStrong = isLight ? 0.18 : 0.24;
    const fallbackAccents = isLight
        ? ["#2563EB", "#0F766E", "#B45309", "#7C3AED", "#BE185D", "#0369A1"]
        : ["#7DD3FC", "#5EEAD4", "#FBBF24", "#C4B5FD", "#FDA4AF", "#93C5FD"];
    const accents = [a, a2, ...fallbackAccents].filter(Boolean);
    return {
        a,
        a2,
        aText,
        a2Text,
        fg,
        mu,
        sf,
        sb,
        hf,
        bf,
        isLight,
        canvas,
        canvasBackground,
        bg: canvas,
        panel,
        raisedPanel,
        line,
        ink: fg,
        muted: _readableTextAccent(mu, isLight),
        footer: isLight ? _alpha(fg, 0.88) : "rgba(0,0,0,0.28)",
        header: isLight ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.045)",
        shadow: isLight ? "0 18px 45px rgba(15,23,42,0.09)" : "0 18px 45px rgba(0,0,0,0.30)",
        softShadow: isLight ? "0 10px 24px rgba(15,23,42,0.07)" : "0 10px 24px rgba(0,0,0,0.24)",
        pastels: accents.slice(0, 7).map((color, i) => _alpha(color, i % 2 ? washOpacityStrong : washOpacity)),
        accents: accents.slice(0, 7),
    };
}

function _mBox(x, y, w, h, fill, border, radius = "18px", extra = {}, zIndex) {
    const box = _box(x, y, w, h, fill, border, radius, zIndex);
    box.styles = { ...box.styles, ...extra };
    return box;
}

function _presetBackgroundBox(fill, background) {
    return {
        ..._mBox(0, 0, 1024, 768, fill, undefined, "0px", {
            background,
            pointerEvents: "none",
        }, 0),
        presetBackground: true,
        backgroundRole: "preset",
        locked: true,
        themeManaged: true,
    };
}

function _estimateTextLines(text, width, fontSize, averageGlyphRatio = 0.52) {
    const safeText = String(text || "");
    const safeWidth = Math.max(80, Number(width) || 80);
    const safeFontSize = Math.max(10, Number(fontSize) || 16);
    const approxCharsPerLine = Math.max(8, Math.floor(safeWidth / (safeFontSize * averageGlyphRatio)));
    return Math.max(1, Math.ceil(safeText.length / approxCharsPerLine));
}

function _modernShell(theme, title, subtitle = "", kicker = "") {
    const p = _modernPalette(theme);
    const titleY = kicker ? 132 : 108;
    const titleSize = 38;
    const titleLines = _estimateTextLines(title, 640, titleSize, 0.5);
    const subtitleY = titleY + titleLines * titleSize * 1.08 + 22;
    return [
        _presetBackgroundBox(p.canvas, p.canvasBackground),
        _bar(0, 0, 1024, 7, p.a, undefined, undefined, 0),
        _bar(0, 7, 1024, 124, p.header, undefined, undefined, 0),
        _bar(0, 131, 1024, 1, p.line, undefined, undefined, 0),
        _bar(50, 64, 18, 18, p.a, undefined, "999px"),
        _bar(76, 70, 150, 6, p.line, undefined, "999px"),
        _bar(798, 58, 44, 22, p.pastels[0], undefined, "999px"),
        _bar(850, 58, 44, 22, p.pastels[1], undefined, "999px"),
        _bar(902, 58, 44, 22, p.pastels[3], undefined, "999px"),
        ...(kicker
            ? [
                  _text(64, 112, 260, kicker.toUpperCase(), {
                      color: p.a,
                      fontSize: "12px",
                      fontFamily: p.bf,
                      fontWeight: "800",
                      letterSpacing: "0.16em",
                  }),
              ]
            : []),
        _text(64, titleY, 640, title, {
            color: p.ink,
            fontSize: `${titleSize}px`,
            fontFamily: p.hf,
            fontWeight: "800",
            lineHeight: "1.08",
        }),
        ...(subtitle
            ? [
                  _text(66, subtitleY, 650, subtitle, {
                      color: p.muted,
                      fontSize: "16px",
                      fontFamily: p.bf,
                      fontWeight: "500",
                      lineHeight: "1.45",
                  }),
              ]
            : []),
    ];
}

function _presetFooterNumberElements(theme) {
    return [];
}

function _taskCard(x, y, w, h, title, meta, tint, accent, theme, tags = []) {
    const p = _modernPalette(theme);
    const els = [
        _mBox(x, y, w, h, tint, `1px solid ${_alpha(accent, 0.2)}`, "14px", {
            boxShadow: "0 7px 16px rgba(15,23,42,0.06)",
        }),
        _text(x + 14, y + 14, w - 28, title, {
            color: p.ink,
            fontSize: "13px",
            fontFamily: p.bf,
            fontWeight: "800",
            lineHeight: "1.25",
        }),
        _text(x + 14, y + h - 26, w - 28, meta, {
            color: p.muted,
            fontSize: "10px",
            fontFamily: p.bf,
            fontWeight: "700",
        }),
    ];
    tags.slice(0, 2).forEach((tag, i) => {
        els.push(
            _mBox(x + 14 + i * 58, y + h - 48, 48, 16, p.raisedPanel, `1px solid ${_alpha(accent, 0.12)}`, "999px"),
        );
        els.push(
            _text(x + 21 + i * 58, y + h - 45, 38, tag, {
                color: accent,
                fontSize: "8px",
                fontFamily: p.bf,
                fontWeight: "800",
                textAlign: "center",
            }),
        );
    });
    return els;
}

function _metricCard(x, y, w, h, label, value, tint, accent, theme) {
    const p = _modernPalette(theme);
    return [
        _mBox(x, y, w, h, p.raisedPanel, `1px solid ${p.line}`, "18px", { boxShadow: p.softShadow }),
        _bar(x + 18, y + 18, 34, 34, tint, undefined, "12px"),
        _bar(x + 28, y + 30, 14, 10, accent, 0.72, "999px"),
        _text(x + 66, y + 18, w - 86, label, { color: p.muted, fontSize: "12px", fontFamily: p.bf, fontWeight: "800" }),
        _text(x + 66, y + 44, w - 86, value, { color: p.ink, fontSize: "30px", fontFamily: p.hf, fontWeight: "800" }),
    ];
}

function _chartBars(x, y, w, h, theme, values = [0.58, 0.76, 0.44, 0.86, 0.64]) {
    const p = _modernPalette(theme);
    const gap = 18;
    const bw = (w - gap * (values.length - 1)) / values.length;
    const els = [_bar(x, y + h, w, 1, "rgba(148,163,184,0.35)", undefined, "999px")];
    values.forEach((v, i) => {
        const bh = Math.round(h * v);
        els.push(
            _bar(x + i * (bw + gap), y + h - bh, bw, bh, p.pastels[i % p.pastels.length], undefined, "12px 12px 0 0"),
        );
        els.push(_bar(x + i * (bw + gap), y + h - bh, bw, 6, p.accents[i % p.accents.length], 0.82, "12px 12px 0 0"));
    });
    return els;
}

function _statusRail(x, y, w, h, theme) {
    const p = _modernPalette(theme);
    return [
        _mBox(x, y, w, h, p.panel, `1px solid ${p.line}`, "20px", { boxShadow: p.softShadow }),
        _text(x + 18, y + 18, w - 36, "Waiting list", {
            color: p.ink,
            fontSize: "17px",
            fontFamily: p.hf,
            fontWeight: "800",
        }),
        ..._taskCard(
            x + 16,
            y + 58,
            w - 32,
            74,
            "Review design handoff",
            "UI System · 2 days left",
            p.pastels[0],
            p.accents[0],
            theme,
            ["High"],
        ),
        ..._taskCard(
            x + 16,
            y + 146,
            w - 32,
            74,
            "Prepare stakeholder notes",
            "Research · 5 days left",
            p.pastels[5],
            p.accents[5],
            theme,
            ["Draft"],
        ),
        ..._taskCard(
            x + 16,
            y + 234,
            w - 32,
            74,
            "Map follow-up actions",
            "Operations · this week",
            p.pastels[2],
            p.accents[2],
            theme,
            ["Next"],
        ),
    ];
}
