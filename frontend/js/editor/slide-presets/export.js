// Slide presets: export-oriented preset builders.

function _installExportPresetBuilders() {
    // Display faces (Retro Pop's Bangers is capitals only) suit short titles, not sentences: a heading longer than
    // a title is set in the theme's body font instead.
    const DISPLAY_FONTS = /Bangers|Permanent Marker|Caveat/i;
    const pText = (theme, x, y, w, content, styles = {}) => {
        const p = _professionalPalette(theme);
        const next = { color: p.ink, fontFamily: p.bf, lineHeight: "1.35", ...styles };
        const plain = typeof content === "string" ? content.replace(/<[^>]*>/g, "") : "";
        if (next.fontFamily === p.hf && DISPLAY_FONTS.test(String(p.hf)) && plain.length > 28) next.fontFamily = p.bf;
        return _text(x, y, w, content, next);
    };
    const pPanel = (theme, x, y, w, h, extra = {}) => {
        const p = _professionalPalette(theme);
        return _mBox(x, y, w, h, p.raised, `1px solid ${p.line}`, "8px", {
            boxShadow: p.softShadow,
            ...extra,
        });
    };
    // Spread a preset's content (everything below the header, from y = top) down to y = bottom: these layouts ended
    // their cards mid-slide and left the lower fifth empty. Positions and box heights stretch; text sizes do not.
    const fillContentArea = (elements, contentBottom, { top = 200, bottom = 640 } = {}) => {
        const k = (bottom - top) / Math.max(1, contentBottom - top);
        if (k <= 1.01) return elements;
        return elements.map(el => {
            if (el.presetBackground || !Number.isFinite(Number(el.y)) || Number(el.y) < top) return el;
            const next = { ...el, y: Math.round(top + (Number(el.y) - top) * k) };
            const h = parseFloat(el.height);
            if (el.type !== "text" && Number.isFinite(h)) next.height = `${Math.round(h * k)}px`;
            return next;
        });
    };

    const sectionLabel = (theme, x, y, label) => {
        const p = _professionalPalette(theme);
        return _text(x, y, 240, label.toUpperCase(), {
            color: p.aText,
            fontSize: "13px",
            fontFamily: p.bf,
            fontWeight: "800",
            letterSpacing: "0.12em",
        });
    };

    const curated = {
        "poster-conference": {
            name: "Conference Poster",
            icon: "fa-solid fa-table-cells-large",
            color: "text-blue-500",
            build(theme) {
                const p = _professionalPalette(theme);
                const colW = 286;
                const cols = [54, 369, 684];
                const els = [
                    ..._proBase(theme),
                    _mBox(42, 36, 940, 118, p.surface, `1px solid ${p.line}`, "10px", { boxShadow: p.shadow }),
                    _bar(42, 36, 940, 8, p.a, undefined, "10px 10px 0 0", 2),
                    pText(theme, 66, 62, 670, "Conference Poster Title", {
                        fontSize: "42px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.05",
                    }),
                    pText(theme, 68, 118, 660, "Authors · Department · Institution", {
                        color: p.muted,
                        fontSize: "16px",
                        fontWeight: "600",
                    }),
                    _mBox(804, 64, 104, 64, p.subtle, `1px dashed ${p.a}`, "6px"),
                    pText(theme, 814, 84, 84, "QR / DOI", {
                        color: p.muted,
                        fontSize: "15px",
                        fontWeight: "800",
                        textAlign: "center",
                    }),
                ];
                [
                    ["Question", "State the research question in one direct sentence.", ["Context", "Gap", "Hypothesis"]],
                    ["Methods", "Summarize the experimental or computational workflow.", ["Samples", "Model", "Validation"]],
                    ["Results", "Put the strongest quantitative result here.", ["Finding 1", "Finding 2", "Effect size"]],
                ].forEach((block, index) => {
                    const x = cols[index];
                    els.push(pPanel(theme, x, 186, colW, 442));
                    els.push(sectionLabel(theme, x + 20, 210, block[0]));
                    // Room for a four-line heading: in a wide display font "…computational workflow." ran into the
                    // first bullet.
                    els.push(pText(theme, x + 20, 240, colW - 40, block[1], {
                        fontSize: "20px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.18",
                    }));
                    els.push(
                        _bullets(
                            x + 20,
                            352,
                            colW - 42,
                            block[2].map(text => ({ text, level: 0 })),
                            { color: p.ink, fontSize: "17px", fontFamily: p.bf, lineHeight: "1.5" },
                        ),
                    );
                    els.push(_mBox(x + 20, 470, colW - 40, 104, p.subtle, `1px dashed ${p.a}`, "6px"));
                    els.push(pText(theme, x + 20, 510, colW - 40, index === 2 ? "Chart / Figure" : "Diagram", {
                        color: p.muted,
                        fontSize: "15px",
                        fontWeight: "800",
                        textAlign: "center",
                    }));
                });
                els.push(_bar(54, 658, 916, 1, p.line, undefined, undefined));
                els.push(sectionLabel(theme, 54, 682, "Takeaway"));
                els.push(pText(theme, 184, 674, 580, "One sentence conclusion that visitors can remember after leaving the poster.", {
                    fontSize: "18px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }));
                els.push(pText(theme, 778, 682, 190, "contact@lab.edu", {
                    color: p.aText,
                    fontSize: "14px",
                    fontWeight: "800",
                    textAlign: "right",
                }));
                return els;
            },
        },
        "talk-title": {
            name: "Talk Title",
            icon: "fa-solid fa-person-chalkboard",
            color: "text-indigo-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return [
                    ..._proBase(theme),
                    _bar(64, 70, 96, 5, p.a, undefined, "999px", 1),
                    pText(theme, 64, 112, 760, "Professional Talk Title", {
                        fontSize: "58px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                        lineHeight: "1.02",
                    }),
                    pText(theme, 68, 270, 640, "A clear subtitle that frames the audience, decision, or scientific contribution.", {
                        color: p.muted,
                        fontSize: "21px",
                        fontWeight: "600",
                        lineHeight: "1.42",
                    }),
                    _mBox(64, 526, 560, 72, p.surface, `1px solid ${p.line}`, "8px"),
                    pText(theme, 86, 546, 516, "Name · Organization · Conference", {
                        fontSize: "18px",
                        fontWeight: "800",
                    }),
                    pText(theme, 86, 574, 516, "June 2026", {
                        color: p.muted,
                        fontSize: "14px",
                        fontWeight: "700",
                    }),
                    // A place for a logo or hero image, said in words: four coloured bars here read as an unfilled
                    // placeholder of unknown purpose.
                    _mBox(760, 120, 156, 420, p.subtle, `1px dashed ${_alpha(p.a, 0.45)}`, "12px"),
                    pText(theme, 772, 312, 132, "Logo or hero image", {
                        color: p.muted,
                        fontSize: "15px",
                        fontWeight: "700",
                        textAlign: "center",
                    }),
                ];
            },
        },
        "talk-key-message": {
            name: "Talk Key Message",
            icon: "fa-solid fa-bullseye",
            color: "text-sky-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return fillContentArea([
                    ..._proHeader(theme, "One Slide, One Message", "Use this for the main claim in a conference talk.", "Talk"),
                    pPanel(theme, 64, 218, 520, 316),
                    pText(theme, 94, 252, 460, "The takeaway should read like a sentence, not a topic label.", {
                        fontSize: "34px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                        lineHeight: "1.12",
                    }),
                    _bar(94, 386, 120, 5, p.a, undefined, "999px"),
                    _bullets(
                        94,
                        424,
                        430,
                        [
                            { text: "Evidence point supporting the claim", level: 0 },
                            { text: "Second proof point or implication", level: 0 },
                            { text: "Action or transition to the next slide", level: 0 },
                        ],
                        { color: p.ink, fontSize: "18px", fontFamily: p.bf, lineHeight: "1.55" },
                    ),
                    pPanel(theme, 632, 218, 300, 316, { backgroundColor: p.subtle }),
                    pText(theme, 660, 248, 244, "Evidence", {
                        color: p.aText,
                        fontSize: "16px",
                        fontFamily: p.bf,
                        fontWeight: "900",
                        letterSpacing: "0.08em",
                    }),
                    ..._chartBars(662, 324, 230, 132, theme, [0.42, 0.68, 0.76, 0.58]),
                    pText(theme, 662, 486, 230, "Replace with a chart, image, or statistic.", {
                        color: p.muted,
                        fontSize: "14px",
                        textAlign: "center",
                    }),
                ], 534);
            },
        },
        "lecture-concept": {
            name: "Lecture Concept",
            icon: "fa-solid fa-chalkboard-user",
            color: "text-emerald-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return fillContentArea([
                    ..._proHeader(theme, "Core Concept", "Define, explain, then connect to an example.", "Lecture"),
                    pPanel(theme, 64, 220, 326, 330),
                    sectionLabel(theme, 92, 248, "Definition"),
                    pText(theme, 92, 286, 266, "A concise definition that students can quote or apply.", {
                        fontSize: "25px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                        lineHeight: "1.18",
                    }),
                    pPanel(theme, 426, 220, 236, 330, { backgroundColor: p.subtle }),
                    sectionLabel(theme, 454, 248, "Mechanism"),
                    // Input leads to the rule: one down arrow between the two boxes (two crossed bars drew a "+"
                    // through the word "Input").
                    { ..._box(522, 332, 40, 70, p.a, undefined, "0px"), shapeType: "arrow-down", arrowHeadSize: 42, arrowShaftSize: 34 },
                    _mBox(486, 278, 112, 44, p.raised, `1px solid ${p.line}`, "8px"),
                    _mBox(454, 412, 176, 48, p.raised, `1px solid ${p.line}`, "8px"),
                    pText(theme, 486, 292, 112, "Input", { fontSize: "14px", fontWeight: "800", textAlign: "center" }),
                    pText(theme, 454, 428, 176, "Process / Rule", { fontSize: "14px", fontWeight: "800", textAlign: "center" }),
                    pPanel(theme, 698, 220, 262, 330),
                    sectionLabel(theme, 726, 248, "Example"),
                    _bullets(
                        728,
                        292,
                        202,
                        [
                            { text: "Worked example prompt", level: 0 },
                            { text: "Known values", level: 0 },
                            { text: "What to solve", level: 0 },
                        ],
                        { color: p.ink, fontSize: "17px", fontFamily: p.bf, lineHeight: "1.55" },
                    ),
                ], 550);
            },
        },
        "lecture-worked-example": {
            name: "Worked Example",
            icon: "fa-solid fa-square-root-variable",
            color: "text-teal-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return fillContentArea([
                    ..._proHeader(theme, "Worked Example", "Keep the setup, solution, and check visible together.", "Lecture"),
                    pPanel(theme, 64, 214, 286, 358),
                    sectionLabel(theme, 90, 244, "Problem"),
                    pText(theme, 90, 282, 230, "Given a simple scenario, compute the quantity of interest.", {
                        fontSize: "22px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                    }),
                    pPanel(theme, 384, 214, 286, 358),
                    sectionLabel(theme, 410, 244, "Steps"),
                    _bullets(
                        410,
                        286,
                        220,
                        [
                            { text: "Write the governing relation", level: 0 },
                            { text: "Substitute known values", level: 0 },
                            { text: "Solve and simplify", level: 0 },
                        ],
                        { color: p.ink, fontSize: "18px", fontFamily: p.bf, lineHeight: "1.55" },
                    ),
                    pPanel(theme, 704, 214, 256, 358, { backgroundColor: p.subtle }),
                    sectionLabel(theme, 730, 244, "Answer"),
                    pText(theme, 730, 304, 204, "42.0", {
                        color: p.aText,
                        fontSize: "76px",
                        fontFamily: p.hf,
                        fontWeight: "900",
                        textAlign: "center",
                    }),
                    pText(theme, 730, 410, 204, "Include units and a quick reasonableness check.", {
                        color: p.muted,
                        fontSize: "15px",
                        textAlign: "center",
                    }),
                ], 572);
            },
        },
        "paper-title": {
            name: "Paper Summary",
            icon: "fa-regular fa-file-lines",
            color: "text-slate-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return [
                    ..._proBase(theme),
                    _mBox(96, 82, 832, 560, p.raised, `1px solid ${p.line}`, "6px", { boxShadow: p.shadow }),
                    _bar(96, 82, 832, 6, p.a, undefined, "6px 6px 0 0", 2),
                    pText(theme, 136, 134, 752, "Paper Title in Sentence Case", {
                        fontSize: "42px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                        lineHeight: "1.12",
                    }),
                    pText(theme, 138, 248, 700, "Author One, Author Two, and Author Three", {
                        color: p.muted,
                        fontSize: "18px",
                        fontWeight: "700",
                    }),
                    pText(theme, 138, 292, 700, "Journal / Venue · DOI · Year", {
                        color: p.aText,
                        fontSize: "15px",
                        fontWeight: "800",
                    }),
                    _bar(136, 344, 752, 1, p.line, undefined, undefined),
                    sectionLabel(theme, 136, 382, "Abstract"),
                    pText(theme, 136, 414, 752, "One compact paragraph summarizing the problem, method, result, and implication. This preset is designed for paper reading groups and exportable handouts.", {
                        fontSize: "21px",
                        lineHeight: "1.55",
                    }),
                ];
            },
        },
        "paper-figure": {
            name: "Paper Figure",
            icon: "fa-regular fa-image",
            color: "text-violet-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return [
                    ..._proHeader(theme, "Figure 1. Main Result", "Use a clear caption and a narrow interpretation panel.", "Paper"),
                    pPanel(theme, 64, 210, 596, 356, { backgroundColor: p.subtle }),
                    pText(theme, 64, 360, 596, "Figure / Table", {
                        color: p.muted,
                        fontSize: "20px",
                        fontWeight: "800",
                        textAlign: "center",
                    }),
                    pText(theme, 66, 584, 594, "Caption: describe the visual, sample, method, and important comparison without over-explaining.", {
                        color: p.muted,
                        fontSize: "15px",
                        lineHeight: "1.4",
                    }),
                    pPanel(theme, 700, 210, 260, 356),
                    sectionLabel(theme, 728, 238, "Interpretation"),
                    pText(theme, 728, 276, 204, "What the figure proves, where uncertainty remains, and why it matters.", {
                        fontSize: "21px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.22",
                    }),
                    _bar(728, 420, 86, 4, p.a, undefined, "999px"),
                    pText(theme, 728, 452, 204, "Replace with significance, effect size, or limitation.", {
                        color: p.muted,
                        fontSize: "14px",
                        lineHeight: "1.45",
                    }),
                ];
            },
        },
        "paper-methods": {
            name: "Paper Methods",
            icon: "fa-solid fa-diagram-project",
            color: "text-cyan-500",
            build(theme) {
                const p = _professionalPalette(theme);
                const steps = ["Dataset", "Protocol", "Analysis", "Validation"];
                const els = [
                    ..._proHeader(theme, "Methods at a Glance", "A compact flow for paper summaries and reproducibility notes.", "Paper"),
                ];
                steps.forEach((step, index) => {
                    const x = 72 + index * 232;
                    els.push(pPanel(theme, x, 258, 184, 180));
                    els.push(pText(theme, x + 22, 286, 136, `0${index + 1}`, {
                        color: p.aText,
                        fontSize: "34px",
                        fontFamily: p.hf,
                        fontWeight: "900",
                    }));
                    els.push(pText(theme, x + 22, 344, 136, step, {
                        fontSize: "20px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                    }));
                    els.push(pText(theme, x + 22, 384, 136, "Key detail or parameter.", {
                        color: p.muted,
                        fontSize: "15px",
                    }));
                    if (index < steps.length - 1) els.push(_bar(x + 192, 346, 30, 4, p.a, 0.5, "999px"));
                });
                els.push(pPanel(theme, 72, 500, 880, 78, { backgroundColor: p.subtle }));
                els.push(pText(theme, 98, 522, 820, "Reproducibility note: include software versions, data availability, and assumptions.", {
                    fontSize: "18px",
                    fontWeight: "700",
                }));
                return els;
            },
        },
        "paper-references": {
            name: "References",
            icon: "fa-solid fa-book-open",
            color: "text-rose-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return [
                    ..._proHeader(theme, "References", "Keep citation slides clean and export-friendly.", "Paper"),
                    _bar(64, 196, 896, 1, p.line, undefined, undefined),
                    ...[
                        "[1] Author A, Author B. Paper title. Journal, volume(issue), pages, year.",
                        "[2] Author C et al. Conference paper title. Proceedings, pages, year.",
                        "[3] Author D. Book or dataset title. Publisher or repository, year.",
                        "[4] Author E, Author F. Preprint title. arXiv:0000.00000, year.",
                    ].map((ref, index) =>
                        pText(theme, 72, 230 + index * 92, 860, ref, {
                            fontSize: "16px",
                            lineHeight: "1.45",
                        }),
                    ),
                ];
            },
        },
        "blank-titled": {
            name: "Blank Titled",
            icon: "fa-regular fa-square",
            color: "text-slate-500",
            build(theme) {
                const p = _professionalPalette(theme);
                return [
                    ..._proBase(theme),
                    _bar(64, 64, 76, 4, p.a, undefined, "999px", 1),
                    pText(theme, 64, 88, 820, "Slide Title", {
                        fontSize: "38px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                    }),
                ];
            },
        },
    };

    // Every preset is offered: the 20 outside the curated set were hidden, which left a talk with no section
    // divider, agenda, comparison, big number, quote or closing slide (they render well in every theme).
    const visibleIds = new Set(Object.keys(SLIDE_PRESETS).concat(Object.keys(curated)));
    Object.entries(curated).forEach(([id, preset]) => {
        SLIDE_PRESETS[id] = {
            ...(SLIDE_PRESETS[id] || {}),
            ...preset,
            hiddenInPalette: false,
        };
    });
    Object.values(SLIDE_PRESETS).forEach(preset => {
        preset.hiddenInPalette = false;
    });
    // Two presets were both called "References".
    if (SLIDE_PRESETS.bibliography) SLIDE_PRESETS.bibliography.name = "Reference List";
    window.SLIDEFORGE_VISIBLE_PRESET_IDS = Array.from(visibleIds);
}
