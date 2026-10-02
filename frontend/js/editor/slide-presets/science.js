// Slide presets: science (MD/ML) family layouts.

function _installSciencePresetBuilders() {
    const layouts = {
        "title-page": {
            name: "MD + ML Title",
            icon: "fa-solid fa-atom",
            color: "text-cyan-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    _presetBackgroundBox(p.wash, theme.cssVars?.["--slide-bg"] || p.wash),
                    _bar(0, 0, 1024, 8, p.a, undefined, undefined, 1),
                    _bar(72, 86, 132, 6, p.a, undefined, "999px", 1),
                    _bar(220, 86, 74, 6, p.a2, 0.72, "999px", 1),
                    _text(72, 118, 520, "Molecular Dynamics and Machine Learning", {
                        color: p.a,
                        fontSize: "15px",
                        fontFamily: p.bf,
                        fontWeight: "800",
                        letterSpacing: "0.10em",
                    }),
                    _text(70, 176, 520, "Research Title Goes Here", {
                        color: p.fg,
                        fontSize: "62px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.04",
                    }),
                    _text(74, 384, 450, "A concise conference subtitle that states the biological system, model family, and result direction.", {
                        color: p.mu,
                        fontSize: "21px",
                        fontFamily: p.bf,
                        lineHeight: "1.42",
                    }),
                    _mBox(72, 514, 420, 72, p.raisedPanel, `1px solid ${p.panelBorder}`, "18px", {
                        boxShadow: p.softShadow,
                    }),
                    _text(96, 536, 360, "Author Name - Group / Institute - Date", {
                        color: p.mu,
                        fontSize: "17px",
                        fontFamily: p.bf,
                        fontWeight: "700",
                    }),
                    _mBox(594, 112, 330, 438, p.raisedPanel, `1px solid ${p.panelBorder}`, "28px", {
                        boxShadow: p.shadow,
                    }),
                    _bar(624, 148, 92, 8, p.a, undefined, "999px", 2),
                    _bar(730, 148, 62, 8, p.a2, 0.7, "999px", 2),
                    _mBox(638, 198, 236, 196, p.accentWash, `1px dashed ${_alpha(p.a, 0.44)}`, "24px", {}, 1),
                    _bar(690, 250, 44, 44, p.a, 0.76, "999px", 2),
                    _bar(766, 232, 34, 34, p.a2, 0.78, "999px", 2),
                    _bar(802, 312, 26, 26, p.a, 0.56, "999px", 2),
                    _bar(710, 332, 30, 30, p.a2, 0.58, "999px", 2),
                    _bar(716, 270, 74, 2, p.a, 0.32, "999px", 2),
                    _bar(786, 254, 34, 2, p.a2, 0.32, "999px", 2),
                    _bar(730, 346, 84, 2, p.a, 0.28, "999px", 2),
                    _text(628, 426, 264, "MD trajectories | protein dynamics | learned representations", {
                        color: p.fg,
                        fontSize: "17px",
                        fontFamily: p.bf,
                        textAlign: "center",
                        lineHeight: "1.35",
                    }),
                    _bar(628, 488, 84, 28, p.accentWashStrong, undefined, "999px", 1),
                    _bar(724, 488, 72, 28, p.accentWash, undefined, "999px", 1),
                    _bar(808, 488, 62, 28, p.accentWashStrong, undefined, "999px", 1),
                ];
            },
        },
        "section-divider": {
            name: "Section Divider",
            icon: "fa-solid fa-grip-lines",
            color: "text-indigo-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    _bar(0, 0, 1024, 8, p.a, undefined, undefined, 0),
                    // Glassmorphic container with left-hand accent ribbon
                    _box(72, 140, 880, 420, p.wash, `1px solid ${p.panelBorder}`, "24px", 0),
                    _bar(72, 140, 8, 420, p.a, undefined, "24px 0 0 24px", 1),
                    // Centered vertical separator
                    _bar(314, 190, 1, 320, p.line, undefined, "999px", 1),
                    // Left-side section details
                    _text(102, 210, 180, "02", {
                        color: p.a,
                        fontSize: "110px",
                        fontFamily: p.hf,
                        fontWeight: "900",
                        lineHeight: "0.9",
                        textAlign: "center",
                        letterSpacing: "-0.04em",
                    }),
                    _text(102, 325, 180, "SECTION TWO", {
                        color: p.mu,
                        fontSize: "12px",
                        fontFamily: p.bf,
                        fontWeight: "800",
                        letterSpacing: "0.22em",
                        textAlign: "center",
                    }),
                    // Main title and description
                    _text(360, 200, 540, "Section Title", {
                        color: p.fg,
                        fontSize: "64px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.1",
                    }),
                    _bar(360, 298, 80, 4, p.a, undefined, "999px", 1),
                    _text(360, 325, 540, "A brief description of what this section covers", {
                        color: p.mu,
                        fontSize: "20px",
                        fontFamily: p.bf,
                        fontWeight: "400",
                        lineHeight: "1.45",
                    }),
                    // Bottom capsule callout
                    _box(360, 412, 540, 54, p.raisedPanel, `1px solid ${p.panelBorder}`, "16px", 0),
                    _text(380, 428, 500, "Focus area, core metrics, and strategic outcomes.", {
                        color: p.fg,
                        fontSize: "14px",
                        fontFamily: p.bf,
                        fontWeight: "600",
                        lineHeight: "1.32",
                    }),
                ];
            },
        },
        "content-slide": {
            name: "Assertion + Evidence",
            icon: "fa-solid fa-align-left",
            color: "text-blue-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Learned states reveal a hidden transition",
                        "Use one complete sentence as the slide headline, then make the evidence obvious.",
                        "Finding",
                    ),
                    ..._scienceFigureFrame(
                        theme,
                        58,
                        162,
                        574,
                        340,
                        "Primary visual evidence: structure pair, free-energy map, or latent projection",
                    ),
                    _text(
                        82,
                        522,
                        526,
                        "Figure caption: identify the system, trajectory length, model, and the single observation the audience should retain.",
                        {
                            color: p.mu,
                            fontSize: "14px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                    ..._scienceCallout(
                        theme,
                        670,
                        162,
                        286,
                        142,
                        "Take-home",
                        "The workflow separates states that looked mixed in the raw trajectory.",
                        p.a,
                    ),
                    ..._scienceMetric(theme, 670, 330, 136, 140, "Coverage", "5", "Metastable states", p.a),
                    ..._scienceMetric(theme, 820, 330, 136, 140, "Model", "0.91", "Held-out AUC", p.a2),
                    _text(
                        674,
                        510,
                        272,
                        "Speaker note: replace these placeholders with one visual, one result metric, and one interpretation.",
                        {
                            color: p.mu,
                            fontSize: "14px",
                            fontFamily: p.bf,
                            lineHeight: "1.4",
                        },
                    ),
                ];
            },
        },
        "two-column": {
            name: "Compare Evidence",
            icon: "fa-solid fa-table-columns",
            color: "text-emerald-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "MD and ML agree on the dominant state change",
                        "Place comparable evidence in mirrored panels so the contrast is immediate.",
                        "Compare",
                    ),
                    _sciencePanel(theme, 58, 160, 422, 420),
                    _sciencePanel(theme, 544, 160, 422, 420),
                    _scienceLabel(88, 190, 320, "Physical simulation", p.a, theme),
                    _text(88, 220, 330, "Trajectory ensemble", {
                        color: p.fg,
                        fontSize: "29px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                    }),
                    ..._scienceFigureFrame(theme, 88, 280, 340, 150, "RMSD, contact map, or representative structures"),
                    _text(
                        88,
                        452,
                        340,
                        "Evidence: stable basin shift after ligand binding; uncertainty estimated over replicates.",
                        {
                            color: p.mu,
                            fontSize: "15px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                    _scienceLabel(574, 190, 320, "Learned representation", p.a2, theme),
                    _text(574, 220, 330, "Latent state model", {
                        color: p.fg,
                        fontSize: "29px",
                        fontFamily: p.hf,
                        fontWeight: "850",
                    }),
                    ..._scienceFigureFrame(
                        theme,
                        574,
                        280,
                        340,
                        150,
                        "UMAP, classifier output, or feature attribution",
                    ),
                    _text(
                        574,
                        452,
                        340,
                        "Interpretation: embeddings separate the same transition and identify residues driving the split.",
                        {
                            color: p.mu,
                            fontSize: "15px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                    _bar(500, 208, 4, 324, p.line, undefined, "999px"),
                ];
            },
        },
        "figure-caption": {
            name: "Hero Figure",
            icon: "fa-solid fa-chart-line",
            color: "text-purple-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "The transition concentrates in two residue networks",
                        "A figure-first slide: one large visual, one interpretation panel, no decorative clutter.",
                        "Figure",
                    ),
                    ..._scienceFigureFrame(theme, 54, 148, 640, 420, "Insert main chart or molecular view"),
                    _text(
                        72,
                        586,
                        604,
                        "Figure 1. State the system, trajectory/model, and the visual cue that supports the headline.",
                        {
                            color: p.mu,
                            fontSize: "14px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                    ..._scienceCallout(
                        theme,
                        720,
                        148,
                        246,
                        176,
                        "What changed?",
                        "Open and closed ensembles differ in contacts around the active-site loop.",
                        p.a,
                    ),
                    ..._scienceCallout(
                        theme,
                        720,
                        350,
                        246,
                        176,
                        "Why trust it?",
                        "The same separation appears in held-out trajectories and feature attribution.",
                        p.a2,
                    ),
                ];
            },
        },
        methodology: {
            name: "Workflow",
            icon: "fa-solid fa-diagram-project",
            color: "text-cyan-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Workflow converts trajectories into interpretable states",
                        "Show methods as a pipeline with quality checks, not as a paragraph.",
                        "Methods",
                    ),
                    _sciencePanel(theme, 66, 164, 892, 350),
                    _bar(142, 310, 740, 4, p.line, undefined, "999px"),
                    ..._scienceStep(
                        theme,
                        100,
                        210,
                        190,
                        "1",
                        "Prepare",
                        "Structure, protonation, ligands, solvent box",
                        p.a,
                    ),
                    ..._scienceStep(
                        theme,
                        316,
                        210,
                        190,
                        "2",
                        "Simulate",
                        "Equilibration, production MD, quality control",
                        p.a2,
                    ),
                    ..._scienceStep(
                        theme,
                        532,
                        210,
                        190,
                        "3",
                        "Featurize",
                        "Contacts, distances, dihedrals, energies",
                        p.a,
                    ),
                    ..._scienceStep(
                        theme,
                        748,
                        210,
                        170,
                        "4",
                        "Learn",
                        "Embedding, clustering, prediction, validation",
                        p.a2,
                    ),
                    _text(
                        86,
                        548,
                        852,
                        "Report the exact software versions, sampling length, data split, and validation criterion in speaker notes or a methods backup.",
                        {
                            color: p.mu,
                            fontSize: "16px",
                            fontFamily: p.bf,
                            lineHeight: "1.35",
                        },
                    ),
                ];
            },
        },
        "results-data": {
            name: "Quant Summary",
            icon: "fa-solid fa-chart-bar",
            color: "text-orange-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Three checks support the reported state assignment",
                        "Use the top row for defensible metrics and the lower area for the chart that explains them.",
                        "Results",
                    ),
                    ..._scienceMetric(
                        theme,
                        58,
                        154,
                        280,
                        126,
                        "Sampling",
                        "1.5 us",
                        "3 replicates; no drift after equilibration",
                        p.a,
                    ),
                    ..._scienceMetric(
                        theme,
                        372,
                        154,
                        280,
                        126,
                        "States",
                        "5",
                        "Clusters stable under bootstrap resampling",
                        p.a2,
                    ),
                    ..._scienceMetric(
                        theme,
                        686,
                        154,
                        280,
                        126,
                        "Predictive fit",
                        "0.91",
                        "Held-out AUC; calibrated probabilities",
                        p.a,
                    ),
                    ..._scienceFigureFrame(theme, 58, 326, 596, 246, "Main quantitative plot"),
                    ..._scienceCallout(
                        theme,
                        690,
                        326,
                        276,
                        246,
                        "Readout",
                        "Write the sentence the chart should prove. Add uncertainty and baseline so the result is defensible.",
                        p.a2,
                    ),
                ];
            },
        },
        conclusion: {
            name: "Takeaways",
            icon: "fa-solid fa-flag-checkered",
            color: "text-green-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "The workflow turns simulation data into testable hypotheses",
                        "End with three remembered points and one next action.",
                        "Wrap-up",
                    ),
                    ...[
                        ["1", "Mechanism", "MD identifies the physical transition and the residues involved."],
                        ["2", "Model", "ML compresses trajectories into interpretable state descriptors."],
                        ["3", "Next", "Validate the predicted contacts with perturbation or experiment."],
                    ].flatMap((item, i) => {
                        const x = 72 + i * 300;
                        return [
                            _sciencePanel(theme, x, 176, 250, 284),
                            _bar(x + 24, 208, 44, 44, i === 1 ? p.a2 : p.a, undefined, "999px"),
                            _text(x + 24, 218, 44, item[0], {
                                color: _readableOn(i === 1 ? p.a2 : p.a),
                                fontSize: "18px",
                                fontFamily: p.hf,
                                fontWeight: "850",
                                textAlign: "center",
                            }),
                            _text(x + 24, 282, 202, item[1], {
                                color: i === 1 ? p.a2 : p.a,
                                fontSize: "24px",
                                fontFamily: p.hf,
                                fontWeight: "850",
                            }),
                            _text(x + 24, 334, 202, item[2], {
                                color: p.fg,
                                fontSize: "16px",
                                fontFamily: p.bf,
                                lineHeight: "1.42",
                            }),
                        ];
                    }),
                    _bar(72, 548, 880, 1, p.line, undefined, undefined),
                    _text(74, 584, 470, "Acknowledgements - compute resources - funding", {
                        color: p.mu,
                        fontSize: "14px",
                        fontFamily: p.bf,
                    }),
                    _text(640, 584, 290, "email@institute.edu", {
                        color: p.a,
                        fontSize: "14px",
                        fontFamily: p.bf,
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
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "References",
                        "Replace with key MD, enhanced sampling, and ML papers.",
                        "Sources",
                    ),
                    ...[
                        "[1] Author et al. Molecular dynamics study title. Journal, year.",
                        "[2] Author et al. Machine learning for molecular simulation. Journal, year.",
                        "[3] Author et al. Enhanced sampling or Markov state model reference. Journal, year.",
                        "[4] Software and dataset references: GROMACS, OpenMM, MDAnalysis, PyTorch.",
                    ].map((ref, i) =>
                        _text(70, 166 + i * 96, 860, ref, {
                            color: p.fg,
                            fontSize: "17px",
                            fontFamily: p.bf,
                            lineHeight: "1.45",
                        }),
                    ),
                ];
            },
        },
        "blank-titled": {
            name: "Blank Research",
            icon: "fa-regular fa-square",
            color: "text-gray-400",
            build(theme) {
                return _scienceHeader(
                    theme,
                    "Slide title",
                    "Add simulation, analysis, or model details here.",
                    "MD + ML",
                );
            },
        },
        "quote-slide": {
            name: "Research Question",
            icon: "fa-solid fa-circle-question",
            color: "text-rose-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(theme, "Research question", "", "Question"),
                    _sciencePanel(theme, 118, 220, 788, 268),
                    _text(
                        160,
                        270,
                        704,
                        "Can learned representations from MD trajectories reveal functional conformational states?",
                        {
                            color: p.fg,
                            fontSize: "38px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                            lineHeight: "1.22",
                            textAlign: "center",
                        },
                    ),
                    _text(210, 520, 604, "System - dataset - model - validation criterion", {
                        color: p.mu,
                        fontSize: "18px",
                        fontFamily: p.bf,
                        textAlign: "center",
                    }),
                ];
            },
        },
        "timeline-slide": {
            name: "Experiment Plan",
            icon: "fa-solid fa-timeline",
            color: "text-amber-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Experiment plan",
                        "A simple timeline for simulation and modeling work.",
                        "Plan",
                    ),
                    _bar(110, 350, 804, 4, p.line, undefined, "999px"),
                    ...["System setup", "MD runs", "Feature set", "ML validation"].flatMap((label, i) => {
                        const x = 102 + i * 258;
                        return [
                            _bar(x, 336, 32, 32, p.a, undefined, "999px"),
                            _text(x - 44, i % 2 ? 386 : 250, 120, label, {
                                color: p.fg,
                                fontSize: "17px",
                                fontFamily: p.bf,
                                fontWeight: "800",
                                textAlign: "center",
                            }),
                        ];
                    }),
                ];
            },
        },
        agenda: {
            name: "Talk Outline",
            icon: "fa-solid fa-list-check",
            color: "text-sky-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Talk outline",
                        "A clean structure for an MD and ML presentation.",
                        "Agenda",
                    ),
                    ..._scienceBullets(
                        120,
                        180,
                        760,
                        [
                            { text: "System and scientific motivation" },
                            { text: "MD setup and trajectory quality checks" },
                            { text: "Feature engineering and model design" },
                            { text: "Results, interpretation, and limitations" },
                        ],
                        { color: p.fg, fontSize: "27px", fontFamily: p.bf },
                        { gap: 74 },
                    ),
                ];
            },
        },
        "big-number": {
            name: "Metric Highlight",
            icon: "fa-solid fa-hashtag",
            color: "text-fuchsia-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(theme, "One metric", "Use this for a headline result.", "Metric"),
                    _text(92, 216, 430, "0.91", {
                        color: p.a,
                        fontSize: "142px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "0.95",
                    }),
                    _text(104, 390, 410, "Model AUC for classifying active vs inactive conformational states.", {
                        color: p.fg,
                        fontSize: "29px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        lineHeight: "1.2",
                    }),
                    _sciencePanel(theme, 640, 242, 260, 220),
                    _text(670, 288, 200, "Context", {
                        color: p.a,
                        fontSize: "24px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                    }),
                    _text(670, 342, 200, "Report baseline, data split, uncertainty, and interpretation.", {
                        color: p.fg,
                        fontSize: "17px",
                        fontFamily: p.bf,
                        lineHeight: "1.45",
                    }),
                ];
            },
        },
        "cards-grid": {
            name: "Feature Grid",
            icon: "fa-solid fa-grip",
            color: "text-violet-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Feature set",
                        "Six editable cards for MD descriptors or ML inputs.",
                        "Features",
                    ),
                    _table(78, 170, 868, 330, {
                        rows: 4,
                        cols: 3,
                        headerRow: true,
                        zebra: true,
                        borderColor: p.a,
                        borderWidth: 1,
                        cellPadding: 12,
                        rowHeights: [54, 76, 76, 76],
                        colWidths: [289, 289, 289],
                        headerFill: p.a,
                        bodyFill: p.sf,
                        altFill: _alpha(p.a, 0.1),
                        textColor: p.fg,
                        headerTextColor: _readableOn(p.a),
                        cells: [
                            [{ text: "Feature" }, { text: "Meaning" }, { text: "Use" }],
                            [
                                { text: "RMSD / RMSF" },
                                { text: "Global and local motion" },
                                { text: "Stability checks" },
                            ],
                            [
                                { text: "Contacts / distances" },
                                { text: "Interaction patterns" },
                                { text: "State classification" },
                            ],
                            [
                                { text: "Latent embedding" },
                                { text: "Compressed trajectory" },
                                { text: "Clustering or prediction" },
                            ],
                        ],
                    }),
                ];
            },
        },
        "problem-solution": {
            name: "Challenge / Approach",
            icon: "fa-solid fa-scale-balanced",
            color: "text-amber-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Challenge and approach",
                        "Frame what is hard and how the workflow addresses it.",
                        "Strategy",
                    ),
                    _sciencePanel(theme, 70, 174, 390, 330),
                    _sciencePanel(theme, 564, 174, 390, 330),
                    _text(102, 214, 300, "Challenge", {
                        color: p.a,
                        fontSize: "31px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                    }),
                    ..._scienceBullets(
                        102,
                        282,
                        300,
                        [
                            { text: "High-dimensional trajectories" },
                            { text: "Rare transitions and limited labels" },
                            { text: "Need physical interpretability" },
                        ],
                        { color: p.fg, fontSize: "19px", fontFamily: p.bf },
                        { gap: 52 },
                    ),
                    _text(596, 214, 300, "Approach", {
                        color: p.a2,
                        fontSize: "31px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                    }),
                    ..._scienceBullets(
                        596,
                        282,
                        300,
                        [
                            { text: "Featurize interpretable descriptors" },
                            { text: "Train simple baseline models first" },
                            { text: "Check against MD physics" },
                        ],
                        { color: p.fg, fontSize: "19px", fontFamily: p.bf },
                        { gap: 52 },
                    ),
                ];
            },
        },
        "image-grid": {
            name: "Structure Gallery",
            icon: "fa-regular fa-images",
            color: "text-purple-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Structures and states",
                        "Drop in structures, density maps, or representative conformations.",
                        "Gallery",
                    ),
                    ...[
                        [66, 164, 420, 250, "State A"],
                        [538, 164, 420, 250, "State B"],
                        [66, 456, 260, 140, "Ligand pose"],
                        [382, 456, 260, 140, "Contact map"],
                        [698, 456, 260, 140, "Embedding"],
                    ].flatMap(r => [
                        _box(r[0], r[1], r[2], r[3], p.panel, `1px dashed ${p.a}`, "14px"),
                        _text(r[0], r[1] + r[3] / 2 - 10, r[2], r[4], {
                            color: p.mu,
                            fontSize: "16px",
                            fontFamily: p.bf,
                            textAlign: "center",
                        }),
                    ]),
                ];
            },
        },
        dashboard: {
            name: "Run Dashboard",
            icon: "fa-solid fa-gauge-high",
            color: "text-cyan-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Simulation run dashboard",
                        "Track a small set of metrics without making the slide hard to edit.",
                        "Dashboard",
                    ),
                    ...[
                        ["Systems", "12"],
                        ["Total MD", "6 us"],
                        ["Failed runs", "1"],
                    ].flatMap((m, i) => [
                        _sciencePanel(theme, 70 + i * 296, 160, 240, 120),
                        _text(94 + i * 296, 184, 190, m[0], {
                            color: p.mu,
                            fontSize: "14px",
                            fontFamily: p.bf,
                            fontWeight: "700",
                        }),
                        _text(94 + i * 296, 220, 190, m[1], {
                            color: p.a,
                            fontSize: "34px",
                            fontFamily: p.hf,
                            fontWeight: "800",
                        }),
                    ]),
                    _sciencePanel(theme, 70, 340, 410, 210),
                    _text(100, 374, 330, "Current notes", {
                        color: p.fg,
                        fontSize: "24px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                    }),
                    ..._scienceBullets(
                        100,
                        424,
                        330,
                        [
                            { text: "Equilibration stable for most systems" },
                            { text: "Inspect outlier trajectory" },
                            { text: "Retrain model after new labels" },
                        ],
                        { color: p.fg, fontSize: "16px", fontFamily: p.bf },
                        { gap: 38 },
                    ),
                    _box(540, 340, 384, 210, p.panel, `1px dashed ${p.a}`, "14px"),
                    _text(540, 430, 384, "Insert run-quality chart", {
                        color: p.mu,
                        fontSize: "17px",
                        fontFamily: p.bf,
                        textAlign: "center",
                    }),
                ];
            },
        },
        swot: {
            name: "Model Audit",
            icon: "fa-solid fa-border-all",
            color: "text-lime-400",
            build(theme) {
                const p = _sciencePalette(theme);
                const cards = [
                    ["Data", "Trajectory coverage and label quality"],
                    ["Model", "Architecture, baseline, and metrics"],
                    ["Physics", "Conservation, stability, interpretability"],
                    ["Risk", "Leakage, overfitting, extrapolation"],
                ];
                return [
                    ..._scienceHeader(theme, "Model audit", "Four checks before trusting an MD/ML result.", "Audit"),
                    ...cards.flatMap((card, i) => {
                        const x = 70 + (i % 2) * 456;
                        const y = 166 + Math.floor(i / 2) * 178;
                        return [
                            _sciencePanel(theme, x, y, 390, 130),
                            _text(x + 24, y + 24, 320, card[0], {
                                color: p.a,
                                fontSize: "26px",
                                fontFamily: p.hf,
                                fontWeight: "800",
                            }),
                            _text(x + 24, y + 72, 320, card[1], {
                                color: p.mu,
                                fontSize: "15px",
                                fontFamily: p.bf,
                            }),
                        ];
                    }),
                ];
            },
        },
        "comparison-table": {
            name: "Method Table",
            icon: "fa-solid fa-table",
            color: "text-emerald-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    ..._scienceHeader(
                        theme,
                        "Method comparison",
                        "Editable table for models, features, or simulation conditions.",
                        "Table",
                    ),
                    _table(78, 170, 868, 330, {
                        rows: 5,
                        cols: 4,
                        headerRow: true,
                        zebra: true,
                        borderColor: p.a,
                        borderWidth: 1,
                        cellPadding: 10,
                        rowHeights: [54, 64, 64, 64, 64],
                        colWidths: [217, 217, 217, 217],
                        headerFill: p.a,
                        bodyFill: p.sf,
                        altFill: _alpha(p.a, 0.1),
                        textColor: p.fg,
                        headerTextColor: _readableOn(p.a),
                        cells: [
                            [{ text: "Method" }, { text: "Input" }, { text: "Metric" }, { text: "Comment" }],
                            [{ text: "PCA" }, { text: "Contacts" }, { text: "Variance" }, { text: "Simple baseline" }],
                            [
                                { text: "t-SNE/UMAP" },
                                { text: "Dihedrals" },
                                { text: "Clusters" },
                                { text: "Visualization" },
                            ],
                            [
                                { text: "Random forest" },
                                { text: "Features" },
                                { text: "AUC" },
                                { text: "Interpretable" },
                            ],
                            [{ text: "GNN" }, { text: "Graph" }, { text: "RMSE" }, { text: "Needs more data" }],
                        ],
                    }),
                ];
            },
        },
        "thank-you": {
            name: "Questions",
            icon: "fa-regular fa-heart",
            color: "text-pink-400",
            build(theme) {
                const p = _sciencePalette(theme);
                return [
                    _bar(0, 0, 1024, 8, p.a, undefined, undefined),
                    _sciencePanel(theme, 154, 190, 716, 336),
                    _text(184, 258, 656, "Questions?", {
                        color: p.fg,
                        fontSize: "78px",
                        fontFamily: p.hf,
                        fontWeight: "800",
                        textAlign: "center",
                    }),
                    _text(
                        220,
                        380,
                        584,
                        "Discussion: MD setup, feature design, model validation, and next experiments",
                        {
                            color: p.mu,
                            fontSize: "20px",
                            fontFamily: p.bf,
                            textAlign: "center",
                            lineHeight: "1.4",
                        },
                    ),
                    _text(220, 468, 584, "email@institute.edu", {
                        color: p.a,
                        fontSize: "16px",
                        fontFamily: p.bf,
                        fontWeight: "800",
                        textAlign: "center",
                    }),
                ];
            },
        },
    };

    Object.entries(layouts).forEach(([id, preset]) => {
        if (!SLIDE_PRESETS[id]) return;
        Object.assign(SLIDE_PRESETS[id], preset);
    });
}
