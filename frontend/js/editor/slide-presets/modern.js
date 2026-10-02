// Slide presets: modern family builders.

function _installModernPresetBuilders() {
    const modern = {
        "title-page": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Plan the work. Show the progress.",
                    "A crisp project snapshot layout for research, product, or team updates.",
                    "SlideForge preset",
                ),
                _text(68, 256, 390, "Deck Title Goes Here", {
                    color: p.ink,
                    fontSize: "58px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    lineHeight: "1.02",
                }),
                _text(70, 408, 340, "Author Name · Team · Date", {
                    color: p.muted,
                    fontSize: "18px",
                    fontFamily: p.bf,
                    fontWeight: "700",
                }),
                _mBox(500, 154, 432, 416, p.raisedPanel, `1px solid ${p.line}`, "24px", { boxShadow: p.shadow }),
                _bar(530, 188, 110, 8, p.a, undefined, "999px"),
                _bar(660, 188, 70, 8, p.pastels[1], undefined, "999px"),
                ..._taskCard(
                    530,
                    226,
                    166,
                    92,
                    "Define campaign messaging",
                    "Marketing · 1:00h",
                    p.pastels[0],
                    p.accents[0],
                    theme,
                    ["Draft"],
                ),
                ..._taskCard(
                    716,
                    226,
                    166,
                    92,
                    "Executive meeting",
                    "Operations · 9:00",
                    p.pastels[3],
                    p.accents[3],
                    theme,
                    ["Today"],
                ),
                ..._taskCard(
                    530,
                    338,
                    166,
                    92,
                    "Analyse ROI by channel",
                    "Data · 4:00h",
                    p.pastels[1],
                    p.accents[1],
                    theme,
                    ["High"],
                ),
                ..._taskCard(
                    716,
                    338,
                    166,
                    92,
                    "Weekly team meeting",
                    "Team · 12:30",
                    p.pastels[2],
                    p.accents[2],
                    theme,
                    ["Sync"],
                ),
                _mBox(650, 482, 218, 72, p.raisedPanel, `1px solid ${p.line}`, "999px", { boxShadow: p.softShadow }),
                _text(680, 499, 70, "4.7", { color: p.ink, fontSize: "30px", fontFamily: p.hf, fontWeight: "800" }),
                _text(754, 509, 90, "review score", {
                    color: p.muted,
                    fontSize: "11px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                }),
            ];
        },
        "section-divider": theme => {
            const p = _modernPalette(theme);
            return [
                _presetBackgroundBox(p.canvas, p.canvasBackground),
                // Left hand sidebar layout
                _bar(80, 180, 8, 400, p.a, undefined, "999px", 1),
                _text(112, 174, 180, "02", {
                    color: p.a,
                    fontSize: "110px",
                    fontFamily: p.hf,
                    fontWeight: "900",
                    lineHeight: "0.9",
                    letterSpacing: "-0.04em",
                }),
                _text(118, 285, 180, "SECTION", {
                    color: p.muted,
                    fontSize: "12px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    letterSpacing: "0.22em",
                }),
                // Main content
                _text(320, 230, 480, "Section Title", {
                    color: p.ink,
                    fontSize: "64px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    lineHeight: "1.1",
                }),
                _bar(320, 328, 80, 4, p.a, undefined, "999px", 1),
                _text(320, 355, 460, "A short sentence that frames what the audience should expect next.", {
                    color: p.muted,
                    fontSize: "20px",
                    fontFamily: p.bf,
                    lineHeight: "1.45",
                }),
                // Decorative right panel
                _mBox(830, 180, 130, 400, p.pastels[0], `1px solid ${_alpha(p.accents[0], 0.14)}`, "24px", { boxShadow: p.softShadow }, 0),
                _bar(855, 210, 80, 28, p.raisedPanel, undefined, "999px", 1),
                _bar(855, 260, 80, 6, p.accents[0], undefined, "999px", 1),
                _bar(855, 290, 80, 100, p.raisedPanel, 0.65, "12px", 1),
                _bar(855, 410, 80, 130, p.raisedPanel, 0.65, "12px", 1),
            ];
        },
        "content-slide": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Campaign workplan",
                    "Use this slide for a clear claim supported by grouped evidence cards.",
                    "Argument / evidence",
                ),
                ..._taskCard(66, 250, 250, 132, "Core insight", "Research · 0:30h", p.pastels[0], p.accents[0], theme, [
                    "Key",
                ]),
                ..._taskCard(
                    338,
                    250,
                    250,
                    132,
                    "Supporting evidence",
                    "Analysis · 1:15h",
                    p.pastels[2],
                    p.accents[2],
                    theme,
                    ["Proof"],
                ),
                ..._taskCard(
                    66,
                    408,
                    250,
                    132,
                    "Recommended action",
                    "Planning · 2 days",
                    p.pastels[3],
                    p.accents[3],
                    theme,
                    ["Next"],
                ),
                ..._taskCard(
                    338,
                    408,
                    250,
                    132,
                    "Risk to monitor",
                    "Review · weekly",
                    p.pastels[5],
                    p.accents[5],
                    theme,
                    ["Watch"],
                ),
                ..._statusRail(650, 226, 280, 342, theme),
            ];
        },
        "two-column": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Two-track comparison",
                    "Compare workstreams, options, or findings in a structured weekly board.",
                    "Compare",
                ),
                _text(80, 244, 360, "Track A", { color: p.ink, fontSize: "24px", fontFamily: p.hf, fontWeight: "800" }),
                _text(536, 244, 360, "Track B", {
                    color: p.ink,
                    fontSize: "24px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
                _bar(500, 232, 1, 342, p.line, undefined, "999px"),
                ..._taskCard(
                    78,
                    288,
                    360,
                    92,
                    "Prepare webinar storyline",
                    "Content · 3:30h",
                    p.pastels[0],
                    p.accents[0],
                    theme,
                    ["Need help"],
                ),
                ..._taskCard(
                    78,
                    398,
                    360,
                    92,
                    "Review product launch strategy",
                    "Planning · 12:30",
                    p.pastels[2],
                    p.accents[2],
                    theme,
                    ["Invite"],
                ),
                ..._taskCard(
                    536,
                    288,
                    360,
                    92,
                    "Evaluate marketing ROI",
                    "Data · 4:00h",
                    p.pastels[1],
                    p.accents[1],
                    theme,
                    ["High"],
                ),
                ..._taskCard(
                    536,
                    398,
                    360,
                    92,
                    "Check new Google events",
                    "Ops · 2 days left",
                    p.pastels[3],
                    p.accents[3],
                    theme,
                    ["ASAP"],
                ),
            ];
        },
        "figure-caption": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Visual evidence",
                    "A modern figure slide with a clear insight panel and chart-like placeholder.",
                    "Figure",
                ),
                _mBox(66, 228, 566, 326, p.raisedPanel, `1px solid ${p.line}`, "22px", { boxShadow: p.softShadow }),
                ..._chartBars(106, 314, 470, 160, theme, [0.42, 0.68, 0.56, 0.88, 0.74, 0.5]),
                _text(96, 512, 500, "Figure 1. Short caption explaining what the audience should notice.", {
                    color: p.muted,
                    fontSize: "13px",
                    fontFamily: p.bf,
                    textAlign: "center",
                }),
                _mBox(670, 228, 250, 326, p.pastels[1], `1px solid ${_alpha(p.accents[1], 0.22)}`, "22px"),
                _text(696, 264, 196, "Key insight", {
                    color: p.accents[1],
                    fontSize: "24px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
                _text(696, 314, 190, "Explain the implication of the figure in one concise paragraph.", {
                    color: p.ink,
                    fontSize: "17px",
                    fontFamily: p.bf,
                    lineHeight: "1.45",
                }),
                _text(696, 438, 190, "p < 0.001", {
                    color: p.ink,
                    fontSize: "34px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
            ];
        },
        methodology: theme => {
            const p = _modernPalette(theme);
            const steps = ["Collect", "Clean", "Analyse", "Validate"];
            return [
                ..._modernShell(theme, "Methodology", "A process view that feels like a planned workflow.", "Process"),
                ...steps.flatMap((label, i) => {
                    const x = 74 + i * 220;
                    return [
                        _mBox(x, 260, 178, 220, p.raisedPanel, `1px solid ${p.line}`, "22px", {
                            boxShadow: p.softShadow,
                        }),
                        _bar(x + 22, 286, 42, 42, p.pastels[i], undefined, "14px"),
                        _text(x + 82, 292, 72, `0${i + 1}`, {
                            color: p.accents[i],
                            fontSize: "22px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                        }),
                        _text(x + 22, 354, 132, label, {
                            color: p.ink,
                            fontSize: "22px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                        }),
                        _text(x + 22, 400, 132, "Brief method detail with enough context to be useful.", {
                            color: p.muted,
                            fontSize: "13px",
                            fontFamily: p.bf,
                            lineHeight: "1.4",
                        }),
                        ...(i < 3 ? [_bar(x + 184, 364, 46, 3, p.accents[i], 0.35, "999px")] : []),
                    ];
                }),
            ];
        },
        "results-data": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Results snapshot",
                    "A card-based quantitative summary inspired by product analytics dashboards.",
                    "Data",
                ),
                ..._metricCard(66, 232, 250, 112, "Sample size", "1,024", p.pastels[0], p.accents[0], theme),
                ..._metricCard(338, 232, 250, 112, "Model fit", "0.94", p.pastels[1], p.accents[1], theme),
                ..._metricCard(610, 232, 250, 112, "Lift", "+18%", p.pastels[3], p.accents[3], theme),
                _mBox(66, 382, 794, 198, p.raisedPanel, `1px solid ${p.line}`, "22px", { boxShadow: p.softShadow }),
                ..._chartBars(114, 430, 690, 104, theme, [0.52, 0.7, 0.62, 0.86, 0.76, 0.6, 0.91]),
            ];
        },
        conclusion: theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Conclusion",
                    "Close with decisions, implications, and follow-up actions.",
                    "Wrap-up",
                ),
                ...[
                    "Primary conclusion from the results",
                    "Broader implication for the team",
                    "Known limitation and mitigation",
                    "Recommended next step",
                ].flatMap((t, i) =>
                    _taskCard(82, 248 + i * 86, 560, 66, t, "Decision log", p.pastels[i], p.accents[i], theme, [
                        "Done",
                    ]),
                ),
                _mBox(710, 270, 150, 190, p.raisedPanel, `1px solid ${p.line}`, "999px", { boxShadow: p.shadow }),
                _text(746, 312, 78, "4.7", {
                    color: p.ink,
                    fontSize: "42px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
                _text(730, 374, 110, "readiness score", {
                    color: p.muted,
                    fontSize: "12px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
            ];
        },
        bibliography: theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "References",
                    "A cleaner citation layout with grouped reference cards.",
                    "Sources",
                ),
                ...[0, 1, 2, 3].flatMap(i => [
                    _mBox(
                        76,
                        240 + i * 82,
                        820,
                        58,
                        i % 2 ? p.raisedPanel : p.pastels[i],
                        `1px solid ${p.line}`,
                        "14px",
                    ),
                    _text(
                        96,
                        254 + i * 82,
                        760,
                        `[${i + 1}] Author ${String.fromCharCode(65 + i)} et al. (202${i}). Paper title or source reference. Journal / Conference.`,
                        {
                            color: p.ink,
                            fontSize: "14px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                ]),
            ];
        },
        "blank-titled": theme => [
            ..._modernShell(
                theme,
                "Slide title",
                "Start from a polished blank slide with enough structure to guide composition.",
                "Blank",
            ),
        ],
        "quote-slide": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Perspective", "", "Quote"),
                _mBox(112, 210, 800, 330, p.raisedPanel, `1px solid ${p.line}`, "30px", { boxShadow: p.shadow }),
                _text(150, 236, 80, "“", {
                    color: p.a,
                    fontSize: "110px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    opacity: "0.22",
                }),
                _text(190, 300, 650, "The best way to predict the future is to create it.", {
                    color: p.ink,
                    fontSize: "42px",
                    fontFamily: p.hf,
                    fontWeight: "700",
                    fontStyle: "italic",
                    textAlign: "center",
                    lineHeight: "1.18",
                }),
                _text(320, 438, 380, "PETER DRUCKER", {
                    color: p.muted,
                    fontSize: "14px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    textAlign: "center",
                    letterSpacing: "0.18em",
                }),
            ];
        },
        "timeline-slide": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Roadmap", "Calendar-style milestones with modern task cards.", "Timeline"),
                _bar(116, 360, 760, 4, p.line, undefined, "999px"),
                ...["Q1", "Q2", "Q3", "Q4"].flatMap((q, i) => {
                    const x = 112 + i * 250;
                    return [
                        _bar(x, 346, 32, 32, p.accents[i], undefined, "999px"),
                        ..._taskCard(
                            x - 38,
                            i % 2 ? 396 : 246,
                            140,
                            82,
                            q + " milestone",
                            "Project phase",
                            p.pastels[i],
                            p.accents[i],
                            theme,
                        ),
                    ];
                }),
            ];
        },
        agenda: theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Agenda", "A focused path through the conversation.", "Today"),
                ...["Context", "Approach", "Evidence", "Decision"].flatMap((item, i) =>
                    _taskCard(
                        100,
                        238 + i * 86,
                        720,
                        66,
                        `0${i + 1}  ${item}`,
                        "Discussion block",
                        p.pastels[i],
                        p.accents[i],
                        theme,
                    ),
                ),
            ];
        },
        "big-number": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Impact metric", "Give one number enough room to carry the slide.", "KPI"),
                _text(82, 230, 470, "87%", {
                    color: p.ink,
                    fontSize: "150px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    lineHeight: "0.92",
                }),
                _text(92, 398, 430, "Reduction in processing time after introducing the new workflow.", {
                    color: p.ink,
                    fontSize: "29px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    lineHeight: "1.15",
                }),
                _mBox(650, 246, 230, 220, p.pastels[1], `1px solid ${_alpha(p.accents[1], 0.22)}`, "26px"),
                _text(682, 294, 166, "Why it matters", {
                    color: p.accents[1],
                    fontSize: "22px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
                _text(682, 350, 166, "Use this for a headline result, conversion lift, or operational KPI.", {
                    color: p.ink,
                    fontSize: "15px",
                    fontFamily: p.bf,
                    lineHeight: "1.45",
                }),
            ];
        },
        "cards-grid": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Six-part framework",
                    "A polished card grid for capabilities, pillars, or recommendations.",
                    "Framework",
                ),
                ...["Discover", "Design", "Build", "Measure", "Learn", "Scale"].flatMap((label, i) => {
                    const x = 76 + (i % 3) * 286;
                    const y = 238 + Math.floor(i / 3) * 150;
                    return _taskCard(
                        x,
                        y,
                        236,
                        110,
                        label,
                        "Short supporting point",
                        p.pastels[i],
                        p.accents[i],
                        theme,
                        [`0${i + 1}`],
                    );
                }),
            ];
        },
        "problem-solution": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "From friction to flow",
                    "Frame the current problem and the proposed path forward.",
                    "Strategy",
                ),
                _mBox(78, 238, 382, 300, p.pastels[5], `1px solid ${_alpha(p.accents[5], 0.22)}`, "24px"),
                _mBox(544, 238, 382, 300, p.pastels[1], `1px solid ${_alpha(p.accents[1], 0.22)}`, "24px"),
                _text(110, 282, 300, "Problem", {
                    color: p.accents[5],
                    fontSize: "34px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
                _text(576, 282, 300, "Solution", {
                    color: p.accents[1],
                    fontSize: "34px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                }),
                _bullets(
                    110,
                    350,
                    300,
                    [{ text: "Fragmented workflow" }, { text: "Slow decisions" }, { text: "Limited visibility" }],
                    { color: p.ink, fontSize: "19px", fontFamily: p.bf, lineHeight: "1.65" },
                ),
                _bullets(
                    576,
                    350,
                    300,
                    [{ text: "Unified workspace" }, { text: "Clear ownership" }, { text: "Live performance view" }],
                    { color: p.ink, fontSize: "19px", fontFamily: p.bf, lineHeight: "1.65" },
                ),
            ];
        },
        "image-grid": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Visual evidence",
                    "Use image cards for screenshots, samples, or comparative states.",
                    "Gallery",
                ),
                ...[
                    [74, 236, 360, 182],
                    [458, 236, 220, 182],
                    [702, 236, 220, 182],
                    [74, 444, 250, 108],
                    [348, 444, 280, 108],
                    [652, 444, 270, 108],
                ].flatMap((r, i) => [
                    _mBox(
                        r[0],
                        r[1],
                        r[2],
                        r[3],
                        p.pastels[i % p.pastels.length],
                        `1px dashed ${_alpha(p.accents[i % p.accents.length], 0.34)}`,
                        "20px",
                    ),
                    _text(r[0], r[1] + r[3] / 2 - 10, r[2], `Image ${i + 1}`, {
                        color: p.muted,
                        fontSize: "14px",
                        fontFamily: p.bf,
                        fontWeight: "800",
                        textAlign: "center",
                    }),
                ]),
            ];
        },
        dashboard: theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "Executive snapshot",
                    "A weekly operating view with KPIs, work cards, and follow-up items.",
                    "Dashboard",
                ),
                ..._metricCard(66, 224, 250, 104, "Velocity", "32", p.pastels[0], p.accents[0], theme),
                ..._metricCard(336, 224, 250, 104, "Open items", "18", p.pastels[5], p.accents[5], theme),
                ..._metricCard(606, 224, 250, 104, "On track", "86%", p.pastels[2], p.accents[2], theme),
                ..._taskCard(
                    76,
                    370,
                    170,
                    96,
                    "Develop campaign messaging",
                    "Tue · 1:00h",
                    p.pastels[0],
                    p.accents[0],
                    theme,
                    ["Draft"],
                ),
                ..._taskCard(
                    266,
                    370,
                    170,
                    96,
                    "Execute product launch",
                    "Wed · 12:30",
                    p.pastels[2],
                    p.accents[2],
                    theme,
                    ["Invite"],
                ),
                ..._taskCard(456, 370, 170, 96, "Analyse ROI", "Thu · 4:00h", p.pastels[1], p.accents[1], theme, [
                    "High",
                ]),
                ..._statusRail(676, 360, 230, 210, theme),
            ];
        },
        swot: theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(
                    theme,
                    "SWOT analysis",
                    "Four strategic lenses presented as scannable cards.",
                    "Strategy",
                ),
                ...[
                    ["S", "Strengths"],
                    ["W", "Weaknesses"],
                    ["O", "Opportunities"],
                    ["T", "Threats"],
                ].flatMap((item, i) => {
                    const x = 76 + (i % 2) * 432;
                    const y = 236 + Math.floor(i / 2) * 150;
                    return [
                        _mBox(x, y, 382, 118, p.pastels[i], `1px solid ${_alpha(p.accents[i], 0.22)}`, "22px"),
                        _text(x + 24, y + 22, 54, item[0], {
                            color: p.accents[i],
                            fontSize: "42px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                        }),
                        _text(x + 96, y + 26, 240, item[1], {
                            color: p.ink,
                            fontSize: "23px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                        }),
                        _text(x + 96, y + 66, 240, "Key observation or evidence point.", {
                            color: p.muted,
                            fontSize: "13px",
                            fontFamily: p.bf,
                        }),
                    ];
                }),
            ];
        },
        "comparison-table": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Option comparison", "A decision table with modern card framing.", "Decision"),
                _mBox(70, 238, 838, 326, p.raisedPanel, `1px solid ${p.line}`, "22px", { boxShadow: p.softShadow }),
                _table(92, 264, 794, 252, {
                    rows: 5,
                    cols: 4,
                    headerRow: true,
                    zebra: true,
                    borderColor: p.line,
                    borderWidth: 1,
                    cellPadding: 10,
                    rowHeights: [48, 50, 50, 50, 50],
                    colWidths: [198, 198, 198, 198],
                    headerFill: p.a,
                    bodyFill: p.raisedPanel,
                    altFill: p.panel,
                    textColor: p.ink,
                    headerTextColor: _readableOn(p.a),
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
        "thank-you": theme => {
            const p = _modernPalette(theme);
            return [
                ..._modernShell(theme, "Thank you", "Questions, discussion, and next steps.", "Close"),
                _mBox(214, 246, 596, 250, p.raisedPanel, `1px solid ${p.line}`, "34px", { boxShadow: p.shadow }),
                _text(250, 300, 520, "Thank You", {
                    color: p.ink,
                    fontSize: "78px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
                _text(282, 406, 460, "name@company.com · slideforge.ai", {
                    color: p.a,
                    fontSize: "17px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
            ];
        },
    };
    Object.entries(modern).forEach(([id, build]) => {
        if (SLIDE_PRESETS[id]) SLIDE_PRESETS[id].build = build;
    });
}
