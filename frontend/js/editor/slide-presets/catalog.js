// Slide presets: the base preset catalog (SLIDE_PRESETS). Preset families below replace or add builders.

/* ─── Preset Definitions ─────────────────────────────────────────────────── */

const SLIDE_PRESETS = {
    "title-page": {
        name: "Title Page",
        icon: "fa-solid fa-star",
        color: "text-yellow-400",
        build(theme) {
            const { a, fg, mu, hf, bf } = _t(theme);
            const { wash } = _presetMeta(theme);
            return [
                _bar(0, 0, 1024, 6, a, undefined, undefined), // top rule
                _bar(0, 762, 1024, 6, a, undefined, undefined), // bottom rule
                _bar(0, 6, 1024, 756, a, 0.04, undefined),
                _box(72, 132, 880, 480, wash, undefined, "24px"),
                _text(80, 168, 864, "RESEARCH PRESENTATION", {
                    color: a,
                    fontSize: "12px",
                    fontFamily: bf,
                    fontWeight: "700",
                    textAlign: "center",
                    letterSpacing: "0.18em",
                }),
                _text(80, 220, 864, "Research Title Goes Here", {
                    color: fg,
                    fontSize: "52px",
                    fontFamily: hf,
                    fontWeight: "700",
                    lineHeight: "1.15",
                    textAlign: "center",
                }),
                _bar(412, 336, 200, 3, a, undefined, "2px"), // accent divider
                _text(80, 358, 864, "Author Name · Co-Author Name", {
                    color: fg,
                    fontSize: "22px",
                    fontFamily: bf,
                    fontWeight: "500",
                    textAlign: "center",
                }),
                _text(80, 400, 864, "Department · University · Conference 2025", {
                    color: mu,
                    fontSize: "16px",
                    fontFamily: bf,
                    fontWeight: "400",
                    textAlign: "center",
                }),
                _text(80, 670, 864, "contact@university.edu", {
                    color: a,
                    fontSize: "13px",
                    fontFamily: bf,
                    fontWeight: "400",
                    textAlign: "center",
                }),
            ];
        },
    },

    "section-divider": {
        name: "Section Divider",
        icon: "fa-solid fa-grip-lines",
        color: "text-indigo-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            return [
                _bar(0, 0, 7, 768, a, undefined, undefined, 1), // left accent strip
                _box(0, 0, 360, 768, sf, undefined, undefined, 0),
                _box(390, 210, 560, 210, card, `1px solid ${a}25`, "18px", 0),
                _text(36, 270, 290, "02", {
                    color: a,
                    fontSize: "110px",
                    fontFamily: hf,
                    fontWeight: "800",
                    opacity: "0.18",
                }),
                _text(400, 270, 580, "Section Title", {
                    color: fg,
                    fontSize: "48px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bar(400, 335, 80, 3, a, undefined, "2px", 1),
                _text(400, 355, 560, "A brief description of what this section covers", {
                    color: mu,
                    fontSize: "20px",
                    fontFamily: bf,
                    fontWeight: "400",
                    lineHeight: "1.55",
                }),
            ];
        },
    },

    "content-slide": {
        name: "Title + Content",
        icon: "fa-solid fa-align-left",
        color: "text-blue-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const mood = _contentPresetStyle(theme);
            return [
                _box(0, 0, 1024, 108, mood.header, undefined, undefined),
                _bar(0, 0, 1024, 6, a, mood.topRuleOpacity, undefined),
                _bar(54, 24, 6, 62, a, undefined, "999px"),
                _box(76, 18, 236, 28, mood.eyebrowBg, `1px solid ${mood.panelBorder}`, "999px"),
                _text(92, 24, 220, "Argument / Evidence", {
                    color: a,
                    fontSize: "11px",
                    fontFamily: bf,
                    fontWeight: "800",
                    letterSpacing: "0.18em",
                }),
                _text(76, 44, 850, "Slide Title", {
                    color: fg,
                    fontSize: mood.titleSize,
                    fontFamily: hf,
                    fontWeight: "800",
                    lineHeight: "1.05",
                    ...(mood.isDark ? { textShadow: "0 3px 18px rgba(0,0,0,0.42)" } : {}),
                }),
                _text(54, 126, 916, "One clear assertion that summarises the content on this slide", {
                    color: mu,
                    fontSize: "19px",
                    fontFamily: bf,
                    fontWeight: "500",
                    lineHeight: "1.4",
                }),
                _box(38, 158, 948, 428, mood.panel, `1px solid ${mood.panelBorder}`, "22px"),
                _bar(38, 158, 7, 428, a, undefined, "22px 0 0 22px"),
                _box(772, 186, 158, 158, mood.accentWash, undefined, "28px"),
                _bar(798, 236, 106, 7, a2, 0.72, "999px"),
                _bar(798, 264, 74, 7, a, 0.72, "999px"),
                _bullets(
                    68,
                    184,
                    680,
                    [
                        { text: "First key point — keep each bullet to one idea", level: 0 },
                        { text: "Supporting evidence or sub-detail", level: 1 },
                        { text: "Second key point with data or reference", level: 0 },
                        { text: "Third point — concrete and actionable", level: 0 },
                        { text: "Optional fourth point", level: 0 },
                    ],
                    {
                        color: fg,
                        fontSize: mood.bulletSize,
                        fontFamily: bf,
                        lineHeight: "1.62",
                    },
                ),
                _text(790, 384, 140, "Signal", {
                    color: a,
                    fontSize: "18px",
                    fontFamily: hf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
            ];
        },
    },

    "two-column": {
        name: "Two Column",
        icon: "fa-solid fa-table-columns",
        color: "text-emerald-400",
        build(theme) {
            const { a, fg, mu, sf, sb, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            return [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(54, 20, 5, 56, a, undefined, "3px"),
                _text(76, 22, 880, "Comparative Analysis", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                // Divider
                _bar(504, 110, 2, 616, a, 0.18, undefined),
                // Left
                _text(54, 114, 424, "Column A", {
                    color: a,
                    fontSize: "20px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bullets(
                    54,
                    150,
                    424,
                    [
                        { text: "First finding", level: 0 },
                        { text: "Detailed sub-note", level: 1 },
                        { text: "Second finding", level: 0 },
                        { text: "Third point", level: 0 },
                    ],
                    { color: fg, fontSize: "19px", fontFamily: bf, lineHeight: "1.6" },
                ),
                // Right
                _text(530, 114, 440, "Column B", {
                    color: a,
                    fontSize: "20px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bullets(
                    530,
                    150,
                    440,
                    [
                        { text: "Contrasting point", level: 0 },
                        { text: "Detailed sub-note", level: 1 },
                        { text: "Second contrast", level: 0 },
                        { text: "Third contrast", level: 0 },
                    ],
                    { color: fg, fontSize: "19px", fontFamily: bf, lineHeight: "1.6" },
                ),
            ];
        },
    },

    "figure-caption": {
        name: "Figure + Caption",
        icon: "fa-solid fa-image",
        color: "text-purple-400",
        build(theme) {
            const { a, fg, mu, sf, sb, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            return [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(54, 20, 5, 56, a, undefined, "3px"),
                _text(76, 22, 880, "Results / Figure", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(54, 106, 880, "Key finding stated as a clear assertion — the figure supports this claim", {
                    color: mu,
                    fontSize: "16px",
                    fontFamily: bf,
                    lineHeight: "1.4",
                }),
                // Figure placeholder
                _box(54, 140, 600, 430, card, `1px dashed ${a}`, "14px"),
                _text(54, 336, 600, "[ Insert Figure / Chart Here ]", {
                    color: mu,
                    fontSize: "17px",
                    fontFamily: bf,
                    textAlign: "center",
                }),
                _text(54, 582, 600, "Figure 1. Descriptive caption explaining the figure content.", {
                    color: mu,
                    fontSize: "13px",
                    fontFamily: bf,
                    textAlign: "center",
                }),
                // Insight panel
                _box(676, 140, 300, 430, card, `1px solid ${a}30`, "14px"),
                _bar(676, 140, 4, 430, a, undefined, "10px 0 0 10px"),
                _text(698, 160, 258, "Key Insight", {
                    color: a,
                    fontSize: "18px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bar(698, 188, 60, 2, a, 0.4, "1px"),
                _text(
                    698,
                    202,
                    258,
                    "Explain what this result means. Connect to your hypothesis or research question.",
                    {
                        color: fg,
                        fontSize: "16px",
                        fontFamily: bf,
                        lineHeight: "1.55",
                    },
                ),
                _text(698, 330, 258, "p < 0.001", {
                    color: a,
                    fontSize: "28px",
                    fontFamily: hf,
                    fontWeight: "800",
                }),
                _text(698, 368, 258, "Statistical significance", {
                    color: mu,
                    fontSize: "13px",
                    fontFamily: bf,
                }),
            ];
        },
    },

    methodology: {
        name: "Methodology",
        icon: "fa-solid fa-diagram-project",
        color: "text-cyan-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const steps = [
                { n: "01", label: "Data Collection", desc: "Sources, instruments and acquisition protocols" },
                { n: "02", label: "Preprocessing", desc: "Cleaning, normalisation, filtering steps" },
                { n: "03", label: "Analysis", desc: "Statistical / computational approaches" },
                { n: "04", label: "Validation", desc: "Cross-validation and robustness checks" },
            ];
            const els = [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(54, 20, 5, 56, a, undefined, "3px"),
                _text(76, 22, 880, "Methodology", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
            ];
            steps.forEach((s, i) => {
                const x = 54 + i * 242;
                els.push(_box(x, 118, 210, 220, sf, `1px solid ${a}30`, "10px"));
                els.push(
                    _text(x + 14, 130, 185, s.n, {
                        color: a,
                        fontSize: "36px",
                        fontFamily: hf,
                        fontWeight: "800",
                        opacity: "0.25",
                    }),
                );
                els.push(
                    _text(x + 14, 186, 185, s.label, {
                        color: fg,
                        fontSize: "17px",
                        fontFamily: hf,
                        fontWeight: "700",
                    }),
                );
                els.push(
                    _text(x + 14, 216, 185, s.desc, {
                        color: mu,
                        fontSize: "13px",
                        fontFamily: bf,
                        lineHeight: "1.4",
                    }),
                );
                if (i < 3) els.push(_bar(x + 215, 220, 22, 3, a, 0.4, "2px"));
            });
            els.push(_bar(54, 360, 916, 1, a, 0.15, undefined));
            els.push(
                _text(54, 376, 916, "Assumptions · Limitations · Ethical considerations relevant to this methodology", {
                    color: mu,
                    fontSize: "17px",
                    fontFamily: bf,
                    lineHeight: "1.5",
                }),
            );
            return els;
        },
    },

    "results-data": {
        name: "Results & Data",
        icon: "fa-solid fa-chart-bar",
        color: "text-orange-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            return [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(54, 20, 5, 56, a, undefined, "3px"),
                _text(76, 22, 880, "Key Results", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(54, 106, 880, "Main finding stated as a clear assertion — the chart below supports this", {
                    color: mu,
                    fontSize: "16px",
                    fontFamily: bf,
                    lineHeight: "1.4",
                }),
                // Chart placeholder
                _box(54, 136, 620, 390, card, `1px dashed ${a}`, "14px"),
                _text(54, 318, 620, "[ Chart / Graph Placeholder ]", {
                    color: mu,
                    fontSize: "17px",
                    fontFamily: bf,
                    textAlign: "center",
                }),
                _text(54, 538, 620, "Figure 1. Short caption for chart.", {
                    color: mu,
                    fontSize: "13px",
                    fontFamily: bf,
                    textAlign: "center",
                }),
                // Stat cards
                ...[
                    { label: "p < 0.001", desc: "Statistical Significance", y: 136 },
                    { label: "n = 1,024", desc: "Sample Size", y: 276 },
                    { label: "R² = 0.94", desc: "Model Fit", y: 416 },
                ]
                    .map(c => [
                        _box(696, c.y, 280, 120, card, `1px solid ${a}25`, "14px"),
                        _bar(696, c.y, 4, 120, a, undefined, "10px 0 0 10px"),
                        _text(716, c.y + 18, 240, c.label, {
                            color: a,
                            fontSize: "28px",
                            fontFamily: hf,
                            fontWeight: "800",
                        }),
                        _text(716, c.y + 58, 240, c.desc, {
                            color: mu,
                            fontSize: "14px",
                            fontFamily: bf,
                        }),
                    ])
                    .flat(),
            ];
        },
    },

    conclusion: {
        name: "Conclusion",
        icon: "fa-solid fa-flag-checkered",
        color: "text-green-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { wash } = _presetMeta(theme);
            return [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(0, 0, 7, 768, a, undefined, undefined), // left rail
                _box(54, 120, 916, 410, wash, `1px solid ${a}18`, "22px"),
                _text(76, 18, 880, "Conclusions", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bar(76, 76, 100, 3, a, undefined, "2px"),
                _bullets(
                    76,
                    106,
                    880,
                    [
                        { text: "Primary conclusion drawn directly from the results", level: 0 },
                        { text: "Broader implication for the field or community", level: 0 },
                        { text: "Acknowledged limitation and how it was addressed", level: 0 },
                        { text: "Recommended direction for future research", level: 0 },
                    ],
                    { color: fg, fontSize: "22px", fontFamily: bf, lineHeight: "1.7" },
                ),
                _bar(54, 598, 916, 1, a, 0.15, undefined),
                _text(54, 614, 580, "Acknowledgements · Funding · Grant Reference", {
                    color: mu,
                    fontSize: "14px",
                    fontFamily: bf,
                }),
                _text(700, 614, 270, "author@university.edu", {
                    color: a,
                    fontSize: "14px",
                    fontFamily: bf,
                    textAlign: "right",
                }),
            ];
        },
    },

    bibliography: {
        name: "References",
        icon: "fa-solid fa-book-open",
        color: "text-rose-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const refs = [
                "[1] Author A, Author B. (2023). Title of the paper. <em>Journal Name</em>, 12(3), 45–67. https://doi.org/…",
                "[2] Author C et al. (2022). Another relevant study. <em>Proc. Conference Name</em>, pp. 100–112.",
                "[3] Author D. (2021). Book or thesis reference. Publisher, City.",
                "[4] Author E, Author F. (2024). Preprint title. <em>arXiv</em>:2401.00000.",
                "[5] Author G. (2020). Foundational work. <em>Nature</em>, 580(7804), 456–460.",
            ];
            return [
                _box(0, 0, 1024, 96, sf, undefined, undefined),
                _bar(54, 20, 5, 56, a, undefined, "3px"),
                _text(76, 22, 880, "References", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bar(54, 104, 916, 1, a, 0.25, undefined),
                ...refs.map((ref, i) =>
                    _text(54, 122 + i * 108, 916, ref, {
                        color: fg,
                        fontSize: "15px",
                        fontFamily: bf,
                        lineHeight: "1.55",
                    }),
                ),
            ];
        },
    },

    "blank-titled": {
        name: "Blank Titled",
        icon: "fa-regular fa-square",
        color: "text-gray-400",
        build(theme) {
            const { a, fg, sf, hf } = _t(theme);
            return [
                _box(0, 0, 1024, 92, sf, undefined, undefined),
                _bar(0, 90, 1024, 3, a, 0.25, undefined),
                _bar(54, 18, 5, 56, a, undefined, "3px"),
                _text(76, 20, 880, "Slide Title", {
                    color: fg,
                    fontSize: "40px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
            ];
        },
    },

    "quote-slide": {
        name: "Quote Slide",
        icon: "fa-solid fa-quote-left",
        color: "text-rose-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { wash } = _presetMeta(theme);
            return [
                _box(100, 200, 824, 368, wash, undefined, "32px"),
                _text(130, 220, 100, "“", {
                    color: a,
                    fontSize: "120px",
                    fontFamily: hf,
                    fontWeight: "800",
                    opacity: "0.2",
                }),
                _text(150, 260, 724, "The best way to predict the future is to create it.", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "600",
                    fontStyle: "italic",
                    textAlign: "center",
                    lineHeight: "1.2",
                }),
                _bar(462, 420, 100, 4, a, undefined, "2px"),
                _text(150, 450, 724, "— PETER DRUCKER", {
                    color: mu,
                    fontSize: "18px",
                    fontFamily: bf,
                    fontWeight: "700",
                    textAlign: "center",
                    letterSpacing: "0.2em",
                }),
            ];
        },
    },

    "timeline-slide": {
        name: "Timeline",
        icon: "fa-solid fa-timeline",
        color: "text-amber-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { wash, line } = _presetMeta(theme);
            return [
                _text(54, 40, 916, "Project Roadmap", {
                    color: fg,
                    fontSize: "38px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _bar(54, 384, 916, 4, line, undefined, "2px"), // Timeline line
                // Node 1
                _box(100, 376, 20, 20, a, undefined, "50%"),
                _text(60, 310, 100, "Q1 2025", { color: a, fontSize: "14px", fontWeight: "700", textAlign: "center" }),
                _text(60, 410, 100, "Foundation", {
                    color: fg,
                    fontSize: "14px",
                    fontWeight: "600",
                    textAlign: "center",
                }),
                // Node 2
                _box(300, 376, 20, 20, a, undefined, "50%"),
                _text(260, 310, 100, "Q2 2025", { color: a, fontSize: "14px", fontWeight: "700", textAlign: "center" }),
                _text(260, 410, 100, "Development", {
                    color: fg,
                    fontSize: "14px",
                    fontWeight: "600",
                    textAlign: "center",
                }),
                // Node 3
                _box(512, 376, 20, 20, a, undefined, "50%"),
                _text(462, 310, 100, "Q3 2025", { color: a, fontSize: "14px", fontWeight: "700", textAlign: "center" }),
                _text(462, 410, 100, "Beta Testing", {
                    color: fg,
                    fontSize: "14px",
                    fontWeight: "600",
                    textAlign: "center",
                }),
                // Node 4
                _box(724, 376, 20, 20, a, undefined, "50%"),
                _text(674, 310, 100, "Q4 2025", { color: a, fontSize: "14px", fontWeight: "700", textAlign: "center" }),
                _text(674, 410, 100, "Launch", { color: fg, fontSize: "14px", fontWeight: "600", textAlign: "center" }),
            ];
        },
    },

    agenda: {
        name: "Agenda",
        icon: "fa-solid fa-list-check",
        color: "text-sky-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            const items = ["Context", "Approach", "Evidence", "Decision"];
            const els = [
                _kicker(64, 62, 180, "Today", theme),
                _text(64, 100, 540, "Agenda", { color: fg, fontSize: "54px", fontFamily: hf, fontWeight: "700" }),
                _text(64, 170, 640, "A clear path through the conversation.", {
                    color: mu,
                    fontSize: "20px",
                    fontFamily: bf,
                    lineHeight: "1.4",
                }),
            ];
            items.forEach((item, i) => {
                const y = 260 + i * 92;
                els.push(_box(64, y, 780, 66, card, `1px solid ${a}20`, "16px"));
                els.push(
                    _text(88, y + 14, 62, `0${i + 1}`, {
                        color: a,
                        fontSize: "26px",
                        fontFamily: hf,
                        fontWeight: "800",
                    }),
                );
                els.push(
                    _text(164, y + 17, 520, item, { color: fg, fontSize: "24px", fontFamily: bf, fontWeight: "700" }),
                );
                els.push(_bar(760, y + 28, 58, 4, i % 2 ? a2 : a, undefined, "999px"));
            });
            return els;
        },
    },

    "big-number": {
        name: "Big Number",
        icon: "fa-solid fa-hashtag",
        color: "text-fuchsia-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { wash, card } = _presetMeta(theme);
            return [
                _box(52, 74, 920, 620, wash, `1px solid ${a}18`, "28px"),
                _text(82, 98, 350, "Impact metric", {
                    color: a,
                    fontSize: "13px",
                    fontFamily: bf,
                    fontWeight: "800",
                    letterSpacing: "0.18em",
                }),
                _text(82, 150, 620, "87%", {
                    color: fg,
                    fontSize: "150px",
                    fontFamily: hf,
                    fontWeight: "800",
                    lineHeight: "0.95",
                }),
                _bar(90, 320, 350, 9, a, undefined, "999px"),
                _bar(90, 320, 250, 9, a2, undefined, "999px"),
                _text(82, 364, 480, "Reduction in processing time after introducing the new workflow.", {
                    color: fg,
                    fontSize: "28px",
                    fontFamily: hf,
                    fontWeight: "700",
                    lineHeight: "1.18",
                }),
                _box(640, 156, 250, 318, card, `1px solid ${a}22`, "20px"),
                _text(666, 188, 204, "Why it matters", {
                    color: a,
                    fontSize: "20px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(
                    666,
                    238,
                    204,
                    "Use this slide for a single statistic, KPI, or headline result that deserves room to breathe.",
                    { color: mu, fontSize: "17px", fontFamily: bf, lineHeight: "1.5" },
                ),
            ];
        },
    },

    "cards-grid": {
        name: "Cards Grid",
        icon: "fa-solid fa-grip",
        color: "text-violet-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            const cards = ["Discover", "Design", "Build", "Measure", "Learn", "Scale"];
            const els = [
                _text(58, 44, 700, "Six-Part Framework", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(
                    60,
                    100,
                    760,
                    "Use compact cards for themes, capabilities, pillars, or grouped recommendations.",
                    { color: mu, fontSize: "17px", fontFamily: bf },
                ),
            ];
            cards.forEach((label, i) => {
                const col = i % 3;
                const row = Math.floor(i / 3);
                const x = 58 + col * 314;
                const y = 164 + row * 214;
                els.push(_box(x, y, 280, 168, card, `1px solid ${i % 2 ? a2 : a}24`, "18px"));
                els.push(
                    _text(x + 20, y + 18, 60, `0${i + 1}`, {
                        color: i % 2 ? a2 : a,
                        fontSize: "26px",
                        fontFamily: hf,
                        fontWeight: "800",
                    }),
                );
                els.push(
                    _text(x + 20, y + 68, 230, label, {
                        color: fg,
                        fontSize: "24px",
                        fontFamily: hf,
                        fontWeight: "700",
                    }),
                );
                els.push(
                    _text(x + 20, y + 106, 230, "Short supporting description or evidence point.", {
                        color: mu,
                        fontSize: "14px",
                        fontFamily: bf,
                        lineHeight: "1.35",
                    }),
                );
            });
            return els;
        },
    },

    "problem-solution": {
        name: "Problem / Solution",
        icon: "fa-solid fa-scale-balanced",
        color: "text-amber-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            return [
                _text(58, 44, 820, "From Friction to Flow", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _box(58, 136, 420, 464, card, `1px solid ${a}25`, "22px"),
                _box(546, 136, 420, 464, card, `1px solid ${a2}25`, "22px"),
                _text(86, 166, 340, "Problem", { color: a, fontSize: "30px", fontFamily: hf, fontWeight: "800" }),
                _text(574, 166, 340, "Solution", { color: a2, fontSize: "30px", fontFamily: hf, fontWeight: "800" }),
                _bullets(
                    86,
                    230,
                    340,
                    [
                        { text: "Fragmented workflow", level: 0 },
                        { text: "Slow decisions", level: 0 },
                        { text: "Limited visibility", level: 0 },
                    ],
                    { color: fg, fontSize: "20px", fontFamily: bf, lineHeight: "1.7" },
                ),
                _bullets(
                    574,
                    230,
                    340,
                    [
                        { text: "Unified workspace", level: 0 },
                        { text: "Clear ownership", level: 0 },
                        { text: "Live performance view", level: 0 },
                    ],
                    { color: fg, fontSize: "20px", fontFamily: bf, lineHeight: "1.7" },
                ),
                _bar(492, 350, 40, 4, a, undefined, "999px"),
            ];
        },
    },

    "image-grid": {
        name: "Image Grid",
        icon: "fa-regular fa-images",
        color: "text-purple-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            const els = [
                _text(58, 42, 640, "Visual Evidence", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(60, 96, 720, "Use this layout for samples, screenshots, comparative images, or mood boards.", {
                    color: mu,
                    fontSize: "17px",
                    fontFamily: bf,
                }),
            ];
            [
                [58, 150, 430, 230],
                [516, 150, 220, 230],
                [764, 150, 200, 230],
                [58, 408, 270, 210],
                [356, 408, 300, 210],
                [684, 408, 280, 210],
            ].forEach((r, i) => {
                els.push(_box(r[0], r[1], r[2], r[3], card, `1px dashed ${a}`, "18px"));
                els.push(
                    _text(r[0], r[1] + r[3] / 2 - 10, r[2], `Image ${i + 1}`, {
                        color: mu,
                        fontSize: "15px",
                        fontFamily: bf,
                        textAlign: "center",
                    }),
                );
            });
            return els;
        },
    },

    dashboard: {
        name: "Dashboard",
        icon: "fa-solid fa-gauge-high",
        color: "text-cyan-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            const metrics = [
                ["Revenue", "$2.4M"],
                ["Growth", "+18%"],
                ["Retention", "94%"],
            ];
            const els = [
                _text(58, 38, 640, "Executive Snapshot", {
                    color: fg,
                    fontSize: "40px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(60, 90, 680, "A compact operating view for weekly updates or leadership reviews.", {
                    color: mu,
                    fontSize: "16px",
                    fontFamily: bf,
                }),
            ];
            metrics.forEach((m, i) => {
                const x = 58 + i * 306;
                els.push(_box(x, 136, 270, 128, card, `1px solid ${a}22`, "18px"));
                els.push(
                    _text(x + 20, 158, 220, m[0], { color: mu, fontSize: "14px", fontFamily: bf, fontWeight: "700" }),
                );
                els.push(
                    _text(x + 20, 190, 220, m[1], {
                        color: i === 1 ? a2 : a,
                        fontSize: "42px",
                        fontFamily: hf,
                        fontWeight: "800",
                    }),
                );
            });
            els.push(_box(58, 304, 574, 310, card, `1px dashed ${a}`, "20px"));
            els.push(
                _text(58, 442, 574, "Chart Area", { color: mu, fontSize: "18px", fontFamily: bf, textAlign: "center" }),
            );
            els.push(_box(662, 304, 300, 310, sf, `1px solid ${a}24`, "20px"));
            els.push(_text(690, 332, 240, "Notes", { color: fg, fontSize: "24px", fontFamily: hf, fontWeight: "700" }));
            els.push(
                _bullets(
                    690,
                    382,
                    236,
                    [
                        { text: "Momentum remains positive", level: 0 },
                        { text: "Watch onboarding time", level: 0 },
                        { text: "Next review in two weeks", level: 0 },
                    ],
                    { color: fg, fontSize: "16px", fontFamily: bf, lineHeight: "1.5" },
                ),
            );
            return els;
        },
    },

    swot: {
        name: "SWOT",
        icon: "fa-solid fa-border-all",
        color: "text-lime-400",
        build(theme) {
            const { a, a2, fg, mu, sf, hf, bf } = _t(theme);
            const { card } = _presetMeta(theme);
            const labels = [
                ["S", "Strengths"],
                ["W", "Weaknesses"],
                ["O", "Opportunities"],
                ["T", "Threats"],
            ];
            const els = [
                _text(58, 38, 700, "SWOT Analysis", { color: fg, fontSize: "42px", fontFamily: hf, fontWeight: "700" }),
            ];
            labels.forEach((item, i) => {
                const x = 58 + (i % 2) * 462;
                const y = 130 + Math.floor(i / 2) * 240;
                els.push(_box(x, y, 420, 196, card, `1px solid ${i % 2 ? a2 : a}24`, "18px"));
                els.push(
                    _text(x + 22, y + 20, 56, item[0], {
                        color: i % 2 ? a2 : a,
                        fontSize: "44px",
                        fontFamily: hf,
                        fontWeight: "800",
                    }),
                );
                els.push(
                    _text(x + 92, y + 28, 280, item[1], {
                        color: fg,
                        fontSize: "24px",
                        fontFamily: hf,
                        fontWeight: "700",
                    }),
                );
                els.push(
                    _text(x + 92, y + 72, 280, "Key observation or evidence point goes here.", {
                        color: mu,
                        fontSize: "15px",
                        fontFamily: bf,
                        lineHeight: "1.4",
                    }),
                );
            });
            return els;
        },
    },

    "comparison-table": {
        name: "Comparison Table",
        icon: "fa-solid fa-table",
        color: "text-emerald-400",
        build(theme) {
            const { a, fg, mu, sf, hf, bf } = _t(theme);
            return [
                _text(58, 42, 720, "Option Comparison", {
                    color: fg,
                    fontSize: "42px",
                    fontFamily: hf,
                    fontWeight: "700",
                }),
                _text(60, 96, 720, "Compare alternatives against decision criteria.", {
                    color: mu,
                    fontSize: "17px",
                    fontFamily: bf,
                }),
                _table(58, 160, 888, 390, {
                    rows: 5,
                    cols: 4,
                    headerRow: true,
                    zebra: true,
                    borderColor: a,
                    borderWidth: 1,
                    cellPadding: 10,
                    rowHeights: [52, 70, 70, 70, 70],
                    colWidths: [220, 220, 220, 220],
                    headerFill: a,
                    bodyFill: sf,
                    altFill: `${a}12`,
                    textColor: fg,
                    headerTextColor: _readableOn(a),
                    cells: [
                        [{ text: "Criteria" }, { text: "Option A" }, { text: "Option B" }, { text: "Option C" }],
                        [{ text: "Cost" }, { text: "Low" }, { text: "Medium" }, { text: "High" }],
                        [{ text: "Speed" }, { text: "Fast" }, { text: "Medium" }, { text: "Slow" }],
                        [{ text: "Risk" }, { text: "Medium" }, { text: "Low" }, { text: "Low" }],
                        [{ text: "Fit" }, { text: "Strong" }, { text: "Good" }, { text: "Selective" }],
                    ],
                }),
            ];
        },
    },

    "thank-you": {
        name: "Thank You",
        icon: "fa-regular fa-heart",
        color: "text-pink-400",
        build(theme) {
            const { a, a2, fg, mu, hf, bf } = _t(theme);
            const { wash } = _presetMeta(theme);
            return [
                _box(112, 154, 800, 420, wash, `1px solid ${a}18`, "34px"),
                _text(150, 226, 724, "Thank You", {
                    color: fg,
                    fontSize: "82px",
                    fontFamily: hf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
                _bar(412, 334, 200, 4, a, undefined, "999px"),
                _text(190, 376, 644, "Questions, discussion, and next steps", {
                    color: mu,
                    fontSize: "24px",
                    fontFamily: bf,
                    textAlign: "center",
                }),
                _text(190, 452, 644, "name@company.com · slideforge.ai", {
                    color: a2,
                    fontSize: "16px",
                    fontFamily: bf,
                    fontWeight: "700",
                    textAlign: "center",
                }),
            ];
        },
    },
};
