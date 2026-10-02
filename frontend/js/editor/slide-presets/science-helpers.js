// Slide presets: building blocks for the science (MD/ML) preset family.

function _sciencePalette(theme) {
    const { a, a2, aText, a2Text, fg, mu, sf, sb, hf, bf } = _t(theme);
    const meta = _presetMeta(theme);
    const isLight = meta.isLightCanvas;
    const themeId = Object.entries(PRESENTATION_THEMES || {}).find(([, candidate]) => candidate === theme)?.[0] || "";
    const softAccent = _alpha(a, isLight ? 0.105 : 0.18);
    const softAccent2 = _alpha(a2, isLight ? 0.095 : 0.16);
    const elevatedFill = isLight ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.088)";
    const themeMoods = {
        editorial: {
            panelRadius: "18px",
            headerTone: "rgba(255,255,255,0.70)",
            paperFill: "rgba(255,255,255,0.76)",
        },
        blueprint: {
            panelRadius: "14px",
            headerTone: "rgba(255,255,255,0.62)",
            gridLine: "rgba(37,99,235,0.13)",
        },
        fieldnotes: {
            panelRadius: "16px",
            headerTone: "rgba(255,249,238,0.66)",
            paperFill: "rgba(255,249,238,0.78)",
        },
        monograph: {
            panelRadius: "10px",
            headerTone: "rgba(255,255,255,0.74)",
            paperFill: "rgba(255,255,255,0.84)",
        },
        graphite: {
            panelRadius: "16px",
            headerTone: "rgba(255,255,255,0.045)",
            paperFill: "rgba(255,255,255,0.070)",
        },
        horizon: {
            panelRadius: "18px",
            headerTone: "rgba(238,244,255,0.052)",
            paperFill: "rgba(238,244,255,0.075)",
        },
        chalkboard: {
            panelRadius: "13px",
            headerTone: "rgba(248,243,231,0.045)",
            paperFill: "rgba(248,243,231,0.070)",
        },
        circuit: {
            panelRadius: "12px",
            headerTone: "rgba(99,230,216,0.055)",
            paperFill: "rgba(236,247,245,0.062)",
            gridLine: "rgba(99,230,216,0.11)",
        },
        afterglow: {
            panelRadius: "20px",
            headerTone: "rgba(245,247,255,0.055)",
            paperFill: "rgba(245,247,255,0.082)",
        },
        sage: {
            panelRadius: "18px",
            headerTone: "rgba(247,250,244,0.68)",
            paperFill: "rgba(247,250,244,0.82)",
        },
        porcelain: {
            panelRadius: "20px",
            headerTone: "rgba(255,255,255,0.66)",
            paperFill: "rgba(255,255,255,0.80)",
        },
        rosewater: {
            panelRadius: "20px",
            headerTone: "rgba(255,247,247,0.68)",
            paperFill: "rgba(255,247,247,0.82)",
        },
        buttercup: {
            panelRadius: "22px",
            headerTone: "rgba(255,252,238,0.70)",
            paperFill: "rgba(255,252,238,0.82)",
        },
        tidepool: {
            panelRadius: "16px",
            headerTone: "rgba(243,252,251,0.68)",
            paperFill: "rgba(243,252,251,0.80)",
        },
        lavender: {
            panelRadius: "20px",
            headerTone: "rgba(250,248,255,0.68)",
            paperFill: "rgba(250,248,255,0.82)",
        },
        midnightGarden: {
            panelRadius: "20px",
            headerTone: "rgba(239,247,237,0.052)",
            paperFill: "rgba(239,247,237,0.078)",
        },
        retroPop: {
            panelRadius: "18px",
            headerTone: "rgba(255,250,240,0.74)",
            paperFill: "rgba(255,250,240,0.86)",
            shadow: "0 12px 0 rgba(239,71,111,0.13)",
        },
    };
    const mood = themeMoods[themeId] || {};
    return {
        themeId,
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
        panel: mood.paperFill || meta.card,
        raisedPanel: mood.paperFill || elevatedFill,
        wash: meta.wash,
        line: mood.gridLine || meta.line,
        panelBorder: isLight ? _alpha(a, 0.20) : _alpha(a, 0.36),
        accentWash: softAccent2,
        accentWashStrong: softAccent,
        headerTone: mood.headerTone || (isLight ? "rgba(255,255,255,0.66)" : "rgba(255,255,255,0.052)"),
        panelRadius: mood.panelRadius || "16px",
        shadow: mood.shadow || (isLight ? "0 16px 38px rgba(15,23,42,0.085)" : "0 18px 44px rgba(0,0,0,0.30)"),
        softShadow: isLight ? "0 8px 22px rgba(15,23,42,0.065)" : "0 10px 28px rgba(0,0,0,0.24)",
    };
}

function _scienceHeader(theme, title, subtitle = "", label = "") {
    const p = _sciencePalette(theme);
    const titleY = label ? 42 : 28;
    const titleSize = 28;
    const titleLines = _estimateTextLines(title, 850, titleSize, 0.52);
    const subtitleY = titleY + titleLines * titleSize * 1.05 + 10;
    const headerHeight = subtitle ? Math.max(122, subtitleY + 34) : 104;
    return [
        _bar(0, 0, 1024, 7, p.a, undefined, undefined),
        _box(0, 0, 1024, headerHeight, p.headerTone, undefined, undefined),
        _bar(0, headerHeight, 1024, 1, p.line, undefined, undefined),
        _bar(790, 22, 150, 16, p.accentWash, undefined, "999px"),
        _bar(836, 52, 104, 6, p.a2, 0.38, "999px"),
        _bar(716, 52, 94, 6, p.a, 0.30, "999px"),
        _bar(908, 72, 32, 32, p.accentWashStrong, undefined, "999px"),
        _bar(56, 24, 5, 56, p.a, undefined, "3px"),
        ...(label
            ? [
                  _text(78, 20, 520, label.toUpperCase(), {
                      color: p.a,
                      fontSize: "12px",
                      fontFamily: p.bf,
                      fontWeight: "800",
                      letterSpacing: "0.14em",
                  }),
              ]
            : []),
        _text(78, titleY, 850, title, {
            color: p.fg,
            fontSize: `${titleSize}px`,
            fontFamily: p.hf,
            fontWeight: "800",
            lineHeight: "1.05",
        }),
        ...(subtitle
            ? [
                  _text(80, subtitleY, 820, subtitle, {
                      color: p.mu,
                      fontSize: "15px",
                      fontFamily: p.bf,
                      lineHeight: "1.35",
                  }),
              ]
            : []),
    ];
}

function _sciencePanel(theme, x, y, w, h) {
    const p = _sciencePalette(theme);
    return _mBox(x, y, w, h, p.panel, `1px solid ${p.panelBorder}`, p.panelRadius, {
        boxShadow: p.softShadow,
    });
}

function _scienceLabel(x, y, w, text, color, theme) {
    const p = _sciencePalette(theme);
    return _text(x, y, w, String(text || "").toUpperCase(), {
        color,
        fontSize: "11px",
        fontFamily: p.bf,
        fontWeight: "800",
        letterSpacing: "0.12em",
    });
}

function _scienceFigureFrame(theme, x, y, w, h, label = "Drop figure, chart, or molecule view here") {
    const p = _sciencePalette(theme);
    const plotX = x + Math.round(w * 0.18);
    const plotY = y + Math.round(h * 0.25);
    const plotW = Math.round(w * 0.62);
    const plotH = Math.round(h * 0.34);
    return [
        _mBox(x, y, w, h, p.accentWash, `1px dashed ${_alpha(p.a, 0.52)}`, p.panelRadius, {
            boxShadow: p.softShadow,
        }),
        _box(plotX, plotY, plotW, plotH, p.raisedPanel, `1px solid ${p.line}`, "12px"),
        _bar(plotX + 22, plotY + plotH - 34, Math.round(plotW * 0.18), 30, p.a, 0.72, "8px 8px 0 0"),
        _bar(plotX + 78, plotY + plotH - 62, Math.round(plotW * 0.18), 58, p.a2, 0.72, "8px 8px 0 0"),
        _bar(plotX + 134, plotY + plotH - 46, Math.round(plotW * 0.18), 42, p.a, 0.42, "8px 8px 0 0"),
        _bar(plotX + plotW - 118, plotY + 34, 74, 74, p.a2, 0.18, "999px"),
        _bar(plotX + plotW - 92, plotY + 60, 22, 22, p.a, 0.7, "999px"),
        _bar(plotX + plotW - 48, plotY + 78, 16, 16, p.a2, 0.76, "999px"),
        _bar(x + 22, y + h - 52, w - 44, 2, p.line, undefined, "999px"),
        _text(x + 28, y + h - 88, w - 56, label, {
            color: p.mu,
            fontSize: "17px",
            fontFamily: p.bf,
            fontWeight: "700",
            textAlign: "center",
        }),
    ];
}

function _scienceMetric(theme, x, y, w, h, label, value, note, accent) {
    const p = _sciencePalette(theme);
    const color = accent || p.a;
    return [
        _mBox(x, y, w, h, p.raisedPanel, `1px solid ${p.panelBorder}`, p.panelRadius, { boxShadow: p.softShadow }),
        _bar(x, y, w, 4, color, 0.82, `${p.panelRadius} ${p.panelRadius} 0 0`),
        _scienceLabel(x + 20, y + 18, w - 40, label, p.mu, theme),
        _text(x + 20, y + 44, w - 40, value, {
            color,
            fontSize: "34px",
            fontFamily: p.hf,
            fontWeight: "850",
            lineHeight: "1",
        }),
        _text(x + 20, y + 88, w - 40, note, {
            color: p.fg,
            fontSize: "13px",
            fontFamily: p.bf,
            lineHeight: "1.35",
        }),
        _bar(x + w - 74, y + 24, 38, 6, _alpha(color, 0.28), undefined, "999px"),
        _bar(x + w - 74, y + 40, 54, 6, _alpha(color, 0.46), undefined, "999px"),
        _bar(x + w - 74, y + 56, 28, 6, _alpha(color, 0.28), undefined, "999px"),
    ];
}

function _scienceCallout(theme, x, y, w, h, title, body, accent) {
    const p = _sciencePalette(theme);
    const color = accent || p.a;
    return [
        _sciencePanel(theme, x, y, w, h),
        _bar(x, y, 5, h, color, undefined, "14px 0 0 14px"),
        _text(x + 24, y + 22, w - 48, title, {
            color,
            fontSize: "23px",
            fontFamily: p.hf,
            fontWeight: "850",
            lineHeight: "1.1",
        }),
        _text(x + 24, y + 72, w - 48, body, {
            color: p.fg,
            fontSize: "16px",
            fontFamily: p.bf,
            lineHeight: "1.45",
        }),
    ];
}

function _scienceStep(theme, x, y, w, number, title, body, accent) {
    const p = _sciencePalette(theme);
    const color = accent || p.a;
    return [
        _bar(x, y + 18, 34, 34, color, undefined, "999px"),
        _text(x, y + 24, 34, number, {
            color: _readableOn(color),
            fontSize: "13px",
            fontFamily: p.bf,
            fontWeight: "850",
            textAlign: "center",
        }),
        _text(x + 48, y, w - 48, title, {
            color: p.fg,
            fontSize: "21px",
            fontFamily: p.hf,
            fontWeight: "850",
            lineHeight: "1.12",
        }),
        _text(x + 48, y + 42, w - 48, body, {
            color: p.mu,
            fontSize: "14px",
            fontFamily: p.bf,
            lineHeight: "1.38",
        }),
    ];
}

function _scienceBullets(x, y, w, items, styles = {}, options = {}) {
    const gap = Number(options.gap) || 46;
    const marker = options.marker || "•";
    return (Array.isArray(items) ? items : []).map((rawItem, index) => {
        const item = typeof rawItem === "string" ? { text: rawItem, level: 0 } : rawItem || {};
        const level = Math.max(0, Number(item.level) || 0);
        const indent = level * 28;
        return _text(x + indent, y + index * gap, w - indent, `${marker} ${item.text || "List item"}`, {
            lineHeight: "1.3",
            ...styles,
        });
    });
}
