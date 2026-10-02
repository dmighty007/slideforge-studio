// Slide presets: shared element builders and color helpers used by every preset family.

/**
 * ACADEMIC SLIDE PRESETS — fully theme-aware
 * All colors/fonts are derived from the active theme at insert time.
 * Slide logical dimensions: 1024 × 768 px
 */

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function _t(theme) {
    // Shorthand resolver
    const themeId = Object.entries(PRESENTATION_THEMES || {}).find(([, candidate]) => candidate === theme)?.[0] || "";
    const a = theme.accentStrong;
    const a2 = theme.cssVars["--slide-accent-2"] || theme.defaultShapeColor;
    const fg = theme.defaultTextColor;
    const mu = theme.defaultMutedColor;
    const sf = theme.surfaceColor;
    const sb = theme.surfaceBorder;
    const hf = theme.headingFont;
    const bf = theme.bodyFont;
    const accentTextOverrides = {
        retroPop: {
            aText: "#C91F57",
            a2Text: "#047857",
        },
    };
    const textAccents = accentTextOverrides[themeId] || {};
    const isLight = _presetMeta(theme).isLightCanvas;
    return {
        themeId,
        a,
        a2,
        aText: textAccents.aText || _readableTextAccent(a, isLight),
        a2Text: textAccents.a2Text || _readableTextAccent(a2, isLight),
        fg,
        mu,
        sf,
        sb,
        hf,
        bf,
    };
}

function _presetMeta(theme) {
    const fg = String(theme.defaultTextColor || "").trim();
    const hex = fg.match(/^#([0-9a-f]{6})$/i)?.[1];
    const luminance = hex
        ? [0, 2, 4]
              .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
              .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        : 0.2;
    const isLightCanvas = luminance < 0.45;
    return {
        isLightCanvas,
        wash: isLightCanvas ? "rgba(255,255,255,0.68)" : "rgba(255,255,255,0.06)",
        card: isLightCanvas ? "rgba(255,255,255,0.76)" : "rgba(255,255,255,0.08)",
        line: isLightCanvas ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.12)",
        ghost: isLightCanvas ? "0.08" : "0.16",
    };
}

// Named apart from render/theme-motion.js's _hexToRgb (different signature and return for invalid input).
function _presetHexToRgb(hex) {
    const raw = String(hex || "")
        .trim()
        .match(/^#([0-9a-f]{6})$/i)?.[1];
    if (!raw) return null;
    return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
    };
}

function _relativeLuminance(hex) {
    const rgb = _presetHexToRgb(hex);
    if (!rgb) return 0.5;
    return ["r", "g", "b"]
        .map(key => rgb[key] / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

// Dark ink or white on a fill, whichever reads better (a fixed brightness cut chose white on mid-tone accents).
function _readableOn(color) {
    const lum = _relativeLuminance(color);
    const onDark = (1 + 0.05) / (lum + 0.05);
    const onLight = (lum + 0.05) / (_relativeLuminance("#111827") + 0.05);
    return onLight >= onDark ? "#111827" : "#FFFFFF";
}

// The accent as a text colour: darkened (light themes) or lightened (dark themes) just enough to read at 4.5:1 on the
// greyest light surface a preset uses (its tinted panels and the foot of the slide gradient) or the dark canvas.
// Accent labels such as "ANSWER" or "Evidence" were 2-3:1 on most light themes (Buttercup's yellow 1.97:1).
function _readableTextAccent(hex, isLight) {
    const rgb = _presetHexToRgb(hex);
    if (!rgb) return hex;
    const reference = _relativeLuminance(isLight ? "#DCE1E8" : "#0B1020");
    const target = isLight ? [0, 0, 0] : [255, 255, 255];
    const contrast = lum => (Math.max(lum, reference) + 0.05) / (Math.min(lum, reference) + 0.05);
    for (let step = 0; step <= 20; step += 1) {
        const mix = step / 20;
        const channels = [rgb.r, rgb.g, rgb.b].map((value, i) => Math.round(value + (target[i] - value) * mix));
        const candidate = `#${channels.map(value => value.toString(16).padStart(2, "0")).join("")}`;
        if (contrast(_relativeLuminance(candidate)) >= 4.5) return step === 0 ? hex : candidate.toUpperCase();
    }
    return isLight ? "#111827" : "#FFFFFF";
}

function _alpha(hex, opacity) {
    const rgb = _presetHexToRgb(hex);
    if (!rgb) return hex;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

function _contentPresetStyle(theme) {
    const { a, a2, fg } = _t(theme);
    const meta = _presetMeta(theme);
    const themeId = Object.entries(PRESENTATION_THEMES || {}).find(([, candidate]) => candidate === theme)?.[0] || "";
    const isDark = !meta.isLightCanvas;
    const base = {
        themeId,
        isDark,
        header: isDark ? "rgba(255,255,255,0.045)" : theme.surfaceColor,
        panel: isDark ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.78)",
        panelBorder: isDark ? _alpha(a, 0.34) : _alpha(a, 0.18),
        titleSize: isDark ? "44px" : "40px",
        eyebrowBg: isDark ? _alpha(a, 0.13) : _alpha(a, 0.1),
        shadow: isDark ? "0 16px 42px rgba(0,0,0,0.28)" : "0 18px 42px rgba(31,41,55,0.08)",
        topRuleOpacity: isDark ? 0.92 : 0.86,
        accentWash: _alpha(a2, isDark ? 0.16 : 0.1),
        bulletSize: isDark ? "23px" : "22px",
    };
    const overrides = {
        afterglow: {
            titleSize: "48px",
            header: "rgba(245,247,255,0.052)",
            panel: "rgba(245,247,255,0.082)",
            panelBorder: _alpha(a, 0.42),
            accentWash: "rgba(110,134,255,0.18)",
        },
        circuit: {
            titleSize: "46px",
            header: "rgba(99,230,216,0.055)",
            panel: "rgba(236,247,245,0.065)",
            panelBorder: _alpha(a, 0.44),
            accentWash: "rgba(31,182,166,0.18)",
        },
        chalkboard: {
            titleSize: "46px",
            header: "rgba(248,243,231,0.050)",
            panel: "rgba(248,243,231,0.070)",
            panelBorder: "rgba(245,215,110,0.36)",
            accentWash: "rgba(142,209,199,0.16)",
        },
        horizon: {
            titleSize: "48px",
            header: "rgba(238,244,255,0.050)",
            panel: "rgba(238,244,255,0.075)",
            panelBorder: "rgba(125,211,252,0.40)",
            accentWash: "rgba(79,124,255,0.18)",
        },
        graphite: {
            titleSize: "46px",
            panelBorder: "rgba(34,211,238,0.38)",
            accentWash: "rgba(56,189,248,0.15)",
        },
        midnightGarden: {
            titleSize: "46px",
            panelBorder: "rgba(154,230,180,0.36)",
            accentWash: "rgba(95,175,121,0.18)",
        },
        retroPop: {
            titleSize: "54px",
            panelBorder: "rgba(239,71,111,0.28)",
            shadow: "0 18px 0 rgba(239,71,111,0.12)",
            topRuleOpacity: 1,
        },
    };
    return { ...base, ...(overrides[themeId] || {}) };
}

function _bar(x, y, w, h, color, opacity, radius, zIndex) {
    return {
        type: "shape",
        shapeType: "rectangle",
        x,
        y,
        width: `${w}px`,
        height: `${h}px`,
        content: "",
        styles: {
            backgroundColor: color,
            ...(opacity !== undefined ? { opacity: String(opacity) } : {}),
            ...(radius ? { borderRadius: radius } : {}),
            zIndex: zIndex !== undefined ? zIndex : 1,
        },
    };
}

function _kicker(x, y, w, text, theme) {
    const { a, bf } = _t(theme);
    const { wash } = _presetMeta(theme);
    return _text(x, y, w, text.toUpperCase(), {
        color: a,
        fontSize: "12px",
        fontFamily: bf,
        fontWeight: "700",
        letterSpacing: "0.18em",
        backgroundColor: wash,
        padding: "6px 10px",
        borderRadius: "999px",
    });
}

function _text(x, y, w, content, styles) {
    return {
        type: "text",
        x,
        y,
        width: `${w}px`,
        height: "auto",
        autoHeight: true,
        textFitMode: "autoHeight",
        content,
        styles: {
            zIndex: 2,
            minWidth: "0px",
            minHeight: "0px",
            padding: "0px",
            ...styles,
        },
    };
}

function _bullets(x, y, w, items, styles) {
    return {
        type: "text",
        x,
        y,
        width: `${w}px`,
        height: "auto",
        autoHeight: true,
        textFitMode: "autoHeight",
        content: items.map(t => ({ text: t.text, level: t.level || 0 })),
        bulletStyle: "default",
        styles: {
            zIndex: 2,
            minWidth: "0px",
            minHeight: "0px",
            padding: "0px",
            ...styles,
        },
    };
}

function _box(x, y, w, h, color, border, radius, zIndex) {
    return {
        type: "shape",
        shapeType: "rectangle",
        x,
        y,
        width: `${w}px`,
        height: `${h}px`,
        content: "",
        styles: {
            backgroundColor: color,
            ...(border ? { border } : {}),
            ...(radius ? { borderRadius: radius } : {}),
            zIndex: zIndex !== undefined ? zIndex : 1,
        },
    };
}

function _table(x, y, w, h, tableData, styles = {}) {
    return {
        type: "table",
        x,
        y,
        width: `${w}px`,
        height: `${h}px`,
        tableData,
        styles: { zIndex: 2, ...styles },
    };
}
