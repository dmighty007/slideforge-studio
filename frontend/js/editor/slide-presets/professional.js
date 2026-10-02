// Slide presets: professional family helpers and builders.

function _professionalPalette(theme) {
    const p = _modernPalette(theme);
    const surface = p.isLight ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.078)";
    const raised = p.isLight ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.105)";
    const line = p.isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.16)";
    const subtle = p.isLight ? "rgba(15,23,42,0.045)" : "rgba(255,255,255,0.055)";
    return {
        ...p,
        surface,
        raised,
        line,
        subtle,
        shadow: p.isLight ? "0 18px 42px rgba(15,23,42,0.075)" : "0 18px 42px rgba(0,0,0,0.26)",
        titleSize: "34px",
        bodySize: "18px",
    };
}

function _proBase(theme) {
    const p = _professionalPalette(theme);
    return [
        _presetBackgroundBox(p.canvas, p.canvasBackground),
    ];
}

function _proHeader(theme, title, subtitle = "", label = "") {
    const p = _professionalPalette(theme);
    return [
        ..._proBase(theme),
        _bar(64, 58, 72, 4, p.a, undefined, "999px", 1),
        ...(label
            ? [
                  _text(64, 78, 360, label.toUpperCase(), {
                      color: p.muted,
                      fontSize: "13px",
                      fontFamily: p.bf,
                      fontWeight: "800",
                      letterSpacing: "0.14em",
                  }),
              ]
            : []),
        _text(64, label ? 102 : 82, 760, title, {
            color: p.ink,
            fontSize: p.titleSize,
            fontFamily: p.hf,
            fontWeight: "800",
            lineHeight: "1.12",
        }),
        ...(subtitle
            ? [
                  _text(66, label ? 150 : 130, 720, subtitle, {
                      color: p.muted,
                      fontSize: "16px",
                      fontFamily: p.bf,
                      fontWeight: "500",
                      lineHeight: "1.42",
                  }),
              ]
            : []),
    ];
}

function _proCard(theme, x, y, w, h, title, body = "", accentIndex = 0) {
    const p = _professionalPalette(theme);
    const accent = p.accents[accentIndex % p.accents.length] || p.a;
    return [
        _mBox(x, y, w, h, p.raised, `1px solid ${p.line}`, "10px", { boxShadow: p.shadow }),
        _bar(x, y, 4, h, accent, undefined, "10px 0 0 10px", 2),
        _text(x + 24, y + 22, w - 48, title, {
            color: p.ink,
            fontSize: "20px",
            fontFamily: p.hf,
            fontWeight: "800",
            lineHeight: "1.16",
        }),
        ...(body
            ? [
                  _text(x + 24, y + 62, w - 48, body, {
                      color: p.muted,
                      fontSize: "14px",
                      fontFamily: p.bf,
                      lineHeight: "1.45",
                  }),
              ]
            : []),
    ];
}

function _proMetric(theme, x, y, w, h, label, value, note, accentIndex = 0) {
    const p = _professionalPalette(theme);
    const accent = p.accents[accentIndex % p.accents.length] || p.a;
    return [
        _mBox(x, y, w, h, p.raised, `1px solid ${p.line}`, "10px", { boxShadow: p.shadow }),
        _text(x + 22, y + 20, w - 44, label.toUpperCase(), {
            color: p.muted,
            fontSize: "12px",
            fontFamily: p.bf,
            fontWeight: "800",
            letterSpacing: "0.12em",
        }),
        _text(x + 22, y + 46, w - 44, value, {
            color: _readableTextAccent(accent, p.isLight),
            fontSize: "34px",
            fontFamily: p.hf,
            fontWeight: "850",
            lineHeight: "1",
        }),
        _text(x + 22, y + 92, w - 44, note, {
            color: p.ink,
            fontSize: "15px",
            fontFamily: p.bf,
            lineHeight: "1.35",
        }),
    ];
}

function _installProfessionalPresetBuilders() {
    const professional = {
        "title-page": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proBase(theme),
                _bar(72, 96, 92, 5, p.a, undefined, "999px", 1),
                _text(72, 140, 660, "Presentation Title", {
                    color: p.ink,
                    fontSize: "60px",
                    fontFamily: p.hf,
                    fontWeight: "850",
                    lineHeight: "1.04",
                }),
                _text(76, 304, 560, "A concise subtitle that states the purpose, audience, or decision.", {
                    color: p.muted,
                    fontSize: "20px",
                    fontFamily: p.bf,
                    lineHeight: "1.45",
                }),
                _mBox(690, 128, 232, 326, p.raised, `1px solid ${p.line}`, "12px", { boxShadow: p.shadow }),
                _bar(722, 170, 80, 6, p.a, undefined, "999px", 2),
                _bar(722, 204, 150, 6, p.line, undefined, "999px", 2),
                _bar(722, 236, 112, 6, p.line, undefined, "999px", 2),
                _bar(722, 300, 168, 118, p.subtle, undefined, "10px", 2),
                _text(76, 604, 560, "Author / Team - Date", {
                    color: p.ink,
                    fontSize: "15px",
                    fontFamily: p.bf,
                    fontWeight: "700",
                }),
            ];
        },
        "section-divider": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proBase(theme),
                _text(80, 220, 160, "02", {
                    color: p.aText,
                    fontSize: "96px",
                    fontFamily: p.hf,
                    fontWeight: "850",
                    lineHeight: "0.92",
                }),
                _bar(278, 226, 5, 238, p.a, undefined, "999px", 1),
                _text(326, 236, 540, "Section Title", {
                    color: p.ink,
                    fontSize: "56px",
                    fontFamily: p.hf,
                    fontWeight: "850",
                    lineHeight: "1.08",
                }),
                _text(330, 338, 500, "One short sentence that frames the next part of the deck.", {
                    color: p.muted,
                    fontSize: "19px",
                    fontFamily: p.bf,
                    lineHeight: "1.45",
                }),
            ];
        },
        "content-slide": theme => [
            ..._proHeader(theme, "One clear idea", "Use the body area for evidence, context, and a short takeaway.", "Content"),
            ..._proCard(theme, 70, 230, 410, 280, "Key point", "State the claim in one sentence, then support it with two or three lines.", 0),
            _bullets(542, 238, 360, [
                { text: "Support with a concrete detail" },
                { text: "Keep each line short" },
                { text: "End with a useful implication" },
            ], {
                color: _professionalPalette(theme).ink,
                fontSize: "20px",
                fontFamily: _professionalPalette(theme).bf,
                lineHeight: "1.62",
            }),
        ],
        "two-column": theme => [
            ..._proHeader(theme, "Compare two paths", "Use equal columns when both options deserve equal weight.", "Comparison"),
            ..._proCard(theme, 72, 228, 400, 300, "Option A", "Strengths, constraints, and evidence for the first path.", 0),
            ..._proCard(theme, 552, 228, 400, 300, "Option B", "Strengths, constraints, and evidence for the second path.", 1),
        ],
        "figure-caption": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "Visual evidence", "Keep the visual dominant and the interpretation concise.", "Figure"),
                _mBox(70, 220, 600, 330, p.raised, `1px dashed ${p.line}`, "10px", { boxShadow: p.shadow }),
                _text(70, 368, 600, "Figure / chart area", {
                    color: p.muted,
                    fontSize: "16px",
                    fontFamily: p.bf,
                    fontWeight: "700",
                    textAlign: "center",
                }),
                ..._proCard(theme, 710, 220, 240, 238, "Interpretation", "Explain what the audience should notice and why it matters.", 0),
                _text(88, 574, 560, "Figure 1. Caption with source, method, or measurement context.", {
                    color: p.muted,
                    fontSize: "15px",
                    fontFamily: p.bf,
                }),
            ];
        },
        methodology: theme => {
            const p = _professionalPalette(theme);
            const steps = ["Plan", "Collect", "Analyse", "Validate"];
            return [
                ..._proHeader(theme, "Method at a glance", "Show the process as a sequence of accountable steps.", "Method"),
                _bar(132, 364, 760, 3, p.line, undefined, "999px", 1),
                ...steps.flatMap((step, index) => {
                    const x = 90 + index * 224;
                    return [
                        _bar(x, 342, 46, 46, p.accents[index], undefined, "999px", 2),
                        _text(x, 354, 46, String(index + 1), {
                            color: _readableOn(p.accents[index]),
                            fontSize: "16px",
                            fontFamily: p.bf,
                            fontWeight: "850",
                            textAlign: "center",
                        }),
                        _text(x - 28, 420, 106, step, {
                            color: p.ink,
                            fontSize: "20px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                            textAlign: "center",
                        }),
                    ];
                }),
            ];
        },
        "results-data": theme => [
            ..._proHeader(theme, "Results summary", "Put the headline result first, then show the supporting metrics.", "Data"),
            ..._proMetric(theme, 72, 230, 260, 140, "Sample", "1,024", "Records included after quality checks.", 0),
            ..._proMetric(theme, 382, 230, 260, 140, "Lift", "+18%", "Improvement compared with baseline.", 1),
            ..._proMetric(theme, 692, 230, 260, 140, "Confidence", "94%", "Validated on the holdout set.", 2),
            ..._proCard(theme, 72, 430, 880, 116, "Takeaway", "Write the single result interpretation that the audience should remember.", 0),
        ],
        conclusion: theme => [
            ..._proHeader(theme, "Takeaways", "Close with decisions, implications, and next steps.", "Close"),
            ...["Primary conclusion", "Implication", "Next action"].flatMap((title, index) =>
                _proCard(theme, 92 + index * 292, 250, 250, 210, title, "Short supporting statement.", index),
            ),
        ],
        bibliography: theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "References", "Keep only sources the audience may need to inspect.", "Sources"),
                ...[0, 1, 2, 3].map(index =>
                    _text(84, 224 + index * 82, 820, `[${index + 1}] Author et al. Source title. Journal or publisher, year.`, {
                        color: p.ink,
                        fontSize: "16px",
                        fontFamily: p.bf,
                        lineHeight: "1.42",
                    }),
                ),
            ];
        },
        "blank-titled": theme => _proHeader(theme, "Slide title", "A clean starting point with consistent spacing and footer.", "Blank"),
        "quote-slide": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proBase(theme),
                _mBox(132, 214, 760, 298, p.raised, `1px solid ${p.line}`, "12px", { boxShadow: p.shadow }),
                _text(178, 264, 668, "“A concise quote or principle that deserves space.”", {
                    color: p.ink,
                    fontSize: "40px",
                    fontFamily: p.hf,
                    fontWeight: "750",
                    fontStyle: "italic",
                    lineHeight: "1.2",
                    textAlign: "center",
                }),
                _bar(432, 400, 160, 4, p.a, undefined, "999px", 2),
                _text(230, 432, 564, "SOURCE NAME", {
                    color: p.muted,
                    fontSize: "15px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    letterSpacing: "0.18em",
                    textAlign: "center",
                }),
            ];
        },
        "timeline-slide": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "Roadmap", "A minimal sequence for milestones or phases.", "Timeline"),
                _bar(122, 356, 780, 3, p.line, undefined, "999px", 1),
                ...["Q1", "Q2", "Q3", "Q4"].flatMap((label, index) => {
                    const x = 112 + index * 254;
                    return [
                        _bar(x, 338, 40, 40, p.accents[index], undefined, "999px", 2),
                        _text(x - 42, 410, 124, label, {
                            color: p.ink,
                            fontSize: "21px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                            textAlign: "center",
                        }),
                        _text(x - 52, 446, 144, "Milestone", {
                            color: p.muted,
                            fontSize: "15px",
                            fontFamily: p.bf,
                            textAlign: "center",
                        }),
                    ];
                }),
            ];
        },
        agenda: theme => [
            ..._proHeader(theme, "Agenda", "Set expectations with a simple ordered structure.", "Open"),
            ...["Context", "Approach", "Evidence", "Decision"].flatMap((item, index) =>
                _proCard(theme, 120, 230 + index * 82, 720, 58, `0${index + 1}  ${item}`, "", index),
            ),
        ],
        "big-number": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "Headline metric", "Use one number and one interpretation.", "Metric"),
                _text(88, 220, 470, "87%", {
                    color: p.aText,
                    fontSize: "142px",
                    fontFamily: p.hf,
                    fontWeight: "850",
                    lineHeight: "0.92",
                }),
                _text(102, 394, 520, "Reduction in processing time after the workflow change.", {
                    color: p.ink,
                    fontSize: "30px",
                    fontFamily: p.hf,
                    fontWeight: "800",
                    lineHeight: "1.15",
                }),
                ..._proCard(theme, 700, 270, 220, 190, "Context", "Add baseline, period, and caveat.", 1),
            ];
        },
        "cards-grid": theme => [
            ..._proHeader(theme, "Six-part framework", "Use compact cards for parallel concepts.", "Framework"),
            ...["Discover", "Design", "Build", "Measure", "Learn", "Scale"].flatMap((label, index) => {
                const x = 78 + (index % 3) * 292;
                const y = 230 + Math.floor(index / 3) * 146;
                return _proCard(theme, x, y, 244, 104, label, "Short supporting point.", index);
            }),
        ],
        "problem-solution": theme => [
            ..._proHeader(theme, "Problem to solution", "Frame the shift from current pain to proposed path.", "Strategy"),
            ..._proCard(theme, 92, 238, 370, 300, "Problem", "Describe the friction, cost, or risk in concrete terms.", 0),
            ..._proCard(theme, 562, 238, 370, 300, "Solution", "Describe the proposed path and why it is credible.", 1),
        ],
        "image-grid": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "Image set", "A clean multi-image layout with consistent gaps.", "Gallery"),
                ...[
                    [74, 230, 410, 180],
                    [512, 230, 190, 180],
                    [730, 230, 190, 180],
                    [74, 438, 260, 126],
                    [362, 438, 270, 126],
                    [660, 438, 260, 126],
                ].flatMap((r, index) => [
                    _mBox(r[0], r[1], r[2], r[3], p.raised, `1px dashed ${p.line}`, "10px", { boxShadow: p.softShadow }),
                    _text(r[0], r[1] + r[3] / 2 - 10, r[2], `Image ${index + 1}`, {
                        color: p.muted,
                        fontSize: "14px",
                        fontFamily: p.bf,
                        fontWeight: "700",
                        textAlign: "center",
                    }),
                ]),
            ];
        },
        dashboard: theme => [
            ..._proHeader(theme, "Executive snapshot", "A calm operating view for repeated review.", "Dashboard"),
            ..._proMetric(theme, 72, 220, 250, 130, "Velocity", "32", "Completed items this cycle.", 0),
            ..._proMetric(theme, 386, 220, 250, 130, "Open", "18", "Items still requiring action.", 1),
            ..._proMetric(theme, 700, 220, 250, 130, "On track", "86%", "Delivery confidence.", 2),
            ..._proCard(theme, 72, 414, 878, 112, "Management note", "Add the action, owner, and due date that should drive the next meeting.", 0),
        ],
        swot: theme => [
            ..._proHeader(theme, "SWOT analysis", "Four lenses, consistent hierarchy, no visual noise.", "Strategy"),
            ...[
                ["S", "Strengths"],
                ["W", "Weaknesses"],
                ["O", "Opportunities"],
                ["T", "Threats"],
            ].flatMap((item, index) => {
                const x = 78 + (index % 2) * 438;
                const y = 230 + Math.floor(index / 2) * 146;
                return _proCard(theme, x, y, 388, 108, `${item[0]}  ${item[1]}`, "Key observation or evidence point.", index);
            }),
        ],
        "comparison-table": theme => {
            const p = _professionalPalette(theme);
            return [
                ..._proHeader(theme, "Option comparison", "Use a table when exact differences matter.", "Decision"),
                _mBox(78, 230, 868, 314, p.raised, `1px solid ${p.line}`, "10px", { boxShadow: p.shadow }),
                _table(100, 258, 824, 244, {
                    rows: 5,
                    cols: 4,
                    headerRow: true,
                    zebra: true,
                    borderColor: p.line,
                    borderWidth: 1,
                    cellPadding: 10,
                    rowHeights: [44, 50, 50, 50, 50],
                    colWidths: [206, 206, 206, 206],
                    headerFill: p.a,
                    bodyFill: p.raised,
                    altFill: p.surface,
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
            const p = _professionalPalette(theme);
            return [
                ..._proBase(theme),
                _mBox(178, 220, 668, 280, p.raised, `1px solid ${p.line}`, "12px", { boxShadow: p.shadow }),
                _text(220, 286, 584, "Thank you", {
                    color: p.ink,
                    fontSize: "76px",
                    fontFamily: p.hf,
                    fontWeight: "850",
                    textAlign: "center",
                }),
                _text(242, 394, 540, "Questions, discussion, and next steps", {
                    color: p.muted,
                    fontSize: "20px",
                    fontFamily: p.bf,
                    textAlign: "center",
                }),
                _text(242, 446, 540, "name@company.com", {
                    color: p.aText,
                    fontSize: "15px",
                    fontFamily: p.bf,
                    fontWeight: "800",
                    textAlign: "center",
                }),
            ];
        },
    };
    Object.entries(professional).forEach(([id, build]) => {
        if (SLIDE_PRESETS[id]) SLIDE_PRESETS[id].build = build;
    });
}
