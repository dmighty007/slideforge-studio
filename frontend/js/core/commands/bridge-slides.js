// Document import: building title, section, evidence, argument, summary and content slides from presets.

function _bridgeBuildPresetSlide(presetId, theme, mutator = null) {
    if (typeof buildPresetSlideState === "function" && SLIDE_PRESETS?.[presetId]) {
        const slideState = buildPresetSlideState(presetId, theme, {
            slideId: generateId("slide"),
            notes: "",
            background: "",
        });
        if (mutator) mutator(slideState.elements || []);
        return slideState;
    }
    return { id: generateId("slide"), layoutId: presetId, presentationTransition: "none", elements: [] };
}

function _bridgePresetForContentSlide(slide) {
    const title = String(slide?.title || "");
    const hint = String(slide?.layout_hint || "").toLowerCase();
    const metrics = _bridgeSlideMetrics(slide);
    if (/summary|conclusion|impact/.test(hint)) return "conclusion";
    if (/comparison|compare|contrast/.test(hint)) return slide?.fig_path ? "results-data" : "two-column";
    if (/results|data|metric|benchmark/.test(hint)) return "results-data";
    if (/figure|mechanism|workflow/.test(hint) && slide?.fig_path) return "figure-caption";
    if (/text|argument|setup|problem/.test(hint) && !slide?.fig_path)
        return metrics.pointCount >= 3 ? "two-column" : "content-slide";
    if (/future|impact|implication|conclusion|summary|takeaway|limit|direction/i.test(title)) return "conclusion";
    if (slide?.fig_path) return "figure-caption";
    if (metrics.pointCount >= 4 || metrics.bulletCount >= 7 || metrics.wordCount >= 78) return "two-column";
    if (/result|finding|data|performance|metric|accuracy|increase|decrease|effect/i.test(title)) return "results-data";
    return "content-slide";
}

function _bridgeHydrateContentPreset(slideState, slide, theme) {
    const elements = slideState.elements || [];
    const title = _bridgeCleanImportedText(slide?.title, "Imported Slide");
    const summary = _bridgeWordClamp(_bridgeSlideSummary(slide), 18);
    const bullets = _buildBulletContent(slide.points);
    const presetId = slideState.layoutId;

    if (presetId === "figure-caption") {
        _bridgeSetTextByPlaceholders(elements, ["Results / Figure", "Trajectory result"], title);
        _bridgeSetTextByPlaceholder(elements, "FIGURE", "Figure");
        _bridgeSetTextByPlaceholders(
            elements,
            [
                "Key finding stated as a clear assertion — the figure supports this claim",
                "Replace the placeholder with RMSD, free-energy, PCA, contact, or clustering plots.",
            ],
            summary,
        );
        _bridgeSetTextByPlaceholders(
            elements,
            [
                "Figure 1. Descriptive caption explaining the figure content.",
                "Figure 1. Short caption describing the simulation system, model, and key observation.",
            ],
            _bridgeWordClamp(slide.fig_cap || summary || title, 26),
        );
        _bridgeSetTextByPlaceholders(elements, ["Key Insight", "Interpretation"], "Interpretation");
        const insight =
            _bridgeFindText(elements, text => text.startsWith("Explain what this result means")) ||
            _bridgeFindText(elements, text => text.startsWith("What changed in the ensemble"));
        if (insight)
            insight.content = _bridgeWordClamp(
                _bridgeNarrativeSummary(slide.points, 2) || summary || slide.fig_cap || title,
                34,
            );
        const stat = _bridgeFindText(elements, text => text === "p < 0.001");
        if (stat) stat.content = _bridgeWordClamp(slide.points?.[0]?.heading || "Evidence", 5);
        const sig = _bridgeFindText(elements, text => text === "Statistical significance");
        if (sig)
            sig.content = _bridgeWordClamp(slide.fig_cap || slide.points?.[0]?.content?.[0] || "Figure evidence", 9);
        elements.push(
            _makeImageElement({
                x: 72,
                y: 162,
                width: 564,
                height: slide.fig_cap ? 382 : 420,
                content: _normalizeImportedImagePath(slide.fig_path),
            }),
        );
        return;
    }

    if (presetId === "two-column") {
        _bridgeSetTextByPlaceholders(elements, ["Comparative Analysis", "Two complementary views"], title);
        _bridgeSetTextByPlaceholder(elements, "COMPARE", "Compare");
        _bridgeSetTextByPlaceholder(
            elements,
            "Use this layout to compare physical simulation and learned models.",
            summary,
        );
        const midpoint = Math.ceil(bullets.length / 2);
        const left = bullets.slice(0, midpoint);
        const right = bullets.slice(midpoint);
        const textBlocks = elements.filter(item => item.type === "text" && Array.isArray(item.content));
        if (textBlocks[0]) textBlocks[0].content = left.length ? left : bullets;
        if (textBlocks[1]) textBlocks[1].content = right.length ? right : bullets.slice(0, 2);
        _bridgeSetTextByPlaceholders(
            elements,
            ["Column A", "Molecular dynamics"],
            slide.fig_path ? "Figure evidence" : "Evidence",
        );
        _bridgeSetTextByPlaceholders(elements, ["Column B", "Machine learning"], "Model implication");
        if (!textBlocks.length) {
            const bulletEls = elements.filter(
                item => item.type === "text" && /^•\s+/.test(_bridgeTextPlain(item.content)),
            );
            const leftEls = bulletEls.filter(el => (parseFloat(el.x) || 0) < 500);
            const rightEls = bulletEls.filter(el => (parseFloat(el.x) || 0) >= 500);
            leftEls.forEach((el, idx) => {
                el.content = left[idx] ? `• ${_bridgeBulletPlainText(left[idx])}` : "";
            });
            rightEls.forEach((el, idx) => {
                el.content = right[idx] ? `• ${_bridgeBulletPlainText(right[idx])}` : "";
            });
        }
        return;
    }

    if (presetId === "results-data") {
        _bridgeSetTextByPlaceholders(elements, ["Key Results", "Quantitative summary"], title);
        _bridgeSetTextByPlaceholder(elements, "RESULTS", "Results");
        _bridgeSetTextByPlaceholders(
            elements,
            [
                "Main finding stated as a clear assertion — the chart below supports this",
                "Use simple metrics that are easy to edit and defend.",
            ],
            summary,
        );
        _bridgeSetTextByPlaceholder(
            elements,
            "Figure 1. Short caption for chart.",
            _bridgeWordClamp(slide.fig_cap || summary || title, 20),
        );
        const labels = _bridgePointsAsCards(slide.points, 3);
        ["p < 0.001", "n = 1,024", "R² = 0.94"].forEach((placeholder, idx) => {
            const el = _bridgeSetTextByPlaceholder(
                elements,
                placeholder,
                labels[idx]?.heading || ["Finding", "Evidence", "Impact"][idx],
            );
            if (el) el.styles.fontSize = "24px";
        });
        ["3 x 500 ns", "5 clusters", "0.91"].forEach((placeholder, idx) => {
            const el = _bridgeSetTextByPlaceholder(
                elements,
                placeholder,
                labels[idx]?.heading || ["Finding", "Evidence", "Impact"][idx],
            );
            if (el) el.styles.fontSize = "24px";
        });
        ["Statistical Significance", "Sample Size", "Model Fit"].forEach((placeholder, idx) => {
            _bridgeSetTextByPlaceholder(elements, placeholder, labels[idx]?.body || summary || title);
        });
        ["Trajectory", "States", "Model AUC"].forEach((placeholder, idx) => {
            _bridgeSetTextByPlaceholder(elements, placeholder, labels[idx]?.body || summary || title);
        });
        if (slide.fig_path) {
            elements.push(
                _makeImageElement({
                    x: 72,
                    y: 154,
                    width: 584,
                    height: 354,
                    content: _normalizeImportedImagePath(slide.fig_path),
                }),
            );
        }
        return;
    }

    if (presetId === "conclusion") {
        _bridgeSetTextByPlaceholder(elements, "Conclusions", title);
        _bridgeSetTextByPlaceholder(elements, "WRAP-UP", "Wrap-up");
        _bridgeSetTextByPlaceholder(elements, "Keep the final slide direct and editable.", summary);
        _bridgeSetBulletLines(elements, bullets);
        _bridgeSetTextByPlaceholders(
            elements,
            ["Acknowledgements · Funding · Grant Reference", "Acknowledgements - compute resources - funding"],
            summary,
        );
        _bridgeSetTextByPlaceholders(elements, ["author@university.edu", "email@institute.edu"], "");
        return;
    }

    _bridgeSetTextByPlaceholders(elements, ["Slide Title", "Key claim from simulation and learning"], title);
    _bridgeSetTextByPlaceholders(
        elements,
        [
            "One clear assertion that summarises the content on this slide",
            "State one result clearly, then support it with evidence.",
        ],
        summary,
    );
    _bridgeSetTextByPlaceholders(
        elements,
        ["Signal", "Finding", "FINDING"],
        _bridgeWordClamp(slide.points?.[0]?.heading || "Takeaway", 3),
    );
    _bridgeSetBulletLines(elements, bullets);
    const takeHome = _bridgeFindText(elements, text => text.startsWith("A compact sentence explaining why"));
    if (takeHome) takeHome.content = _bridgeWordClamp(_bridgeNarrativeSummary(slide.points, 2) || summary || title, 28);
}

function _bridgeFinalizeSlide(slideState) {
    if (!slideState) return slideState;
    slideState.elements = (slideState.elements || []).filter(el => {
        if (el.type !== "text") return true;
        const text = _bridgeContentText(el.content);
        if (!text) return false;
        return !_bridgeIsPlaceholderText(text);
    });
    return _bridgeApplyContentAwareFit(slideState);
}

function _makeBeamerHeader(theme, sectionTitle) {
    const ui = _bridgeVisualMeta(theme);
    return [
        _makeShapeElement({
            x: 0,
            y: 0,
            width: 1024,
            height: 72,
            backgroundColor: ui.accent,
            zIndex: 1,
            borderRadius: "0px",
        }),
        _makeTextElement({
            x: 40,
            y: 20,
            width: 944,
            content: String(sectionTitle || "Overview"),
            fontSize: 26,
            fontWeight: "700",
            color: "#ffffff",
            fontFamily: ui.headingFont,
            textAlign: "left",
        }),
    ];
}

function _makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides) {
    const ui = _bridgeVisualMeta(theme);
    const content = `${String(presentationTitle || "Presentation")} — Slide ${slideNumber} of ${totalSlides}`;
    return [
        _makeShapeElement({
            x: 0,
            y: 736,
            width: 1024,
            height: 32,
            backgroundColor: "rgba(0,0,0,0.04)",
            zIndex: 1,
            borderRadius: "0px",
        }),
        _makeTextElement({
            x: 40,
            y: 742,
            width: 944,
            content: content,
            fontSize: 12,
            fontWeight: "500",
            color: ui.muted,
            fontFamily: ui.bodyFont,
            textAlign: "center",
        }),
    ];
}

function _createBridgeTitleSlide(data, theme, presentationTitle, slideNumber, totalSlides) {
    return _bridgeFinalizeSlide(
        _bridgeBuildPresetSlide("title-page", theme, elements => {
            _bridgeSetTextByPlaceholders(
                elements,
                ["RESEARCH PRESENTATION", "Molecular Dynamics and Machine Learning"],
                data.journal_name || "Imported Presentation",
            );
            _bridgeSetTextByPlaceholder(
                elements,
                "Research Title Goes Here",
                _bridgeCleanImportedText(presentationTitle, "Imported Presentation"),
            );
            _bridgeSetTextByPlaceholders(
                elements,
                ["Author Name · Co-Author Name", "Author Name - Group / Institute - Date"],
                data.authors || "",
            );
            const metaText = [data.journal_name, data.publish_date, data.doi ? `DOI: ${data.doi}` : ""]
                .filter(Boolean)
                .join(" · ");
            _bridgeSetTextByPlaceholders(
                elements,
                [
                    "Department · University · Conference 2025",
                    "MD trajectories | protein dynamics | learned representations",
                ],
                metaText || _bridgeCleanImportedText(data.sub, "AI-generated research presentation"),
            );
            _bridgeSetTextByPlaceholder(elements, "contact@university.edu", "");
        }),
    );
    /*
    const ui = _bridgeVisualMeta(theme);
    const summary = String(data.sub || "AI-generated research presentation");
    const elements = [
        _makeShapeElement({
            x: 0, y: 0, width: 1024, height: 768,
            backgroundColor: ui.surface, opacity: 0.18, zIndex: 1, borderRadius: "0px"
        }),
        _makeShapeElement({
            x: 0, y: 160, width: 1024, height: 340,
            backgroundColor: ui.accent, opacity: 0.05, zIndex: 1, borderRadius: "0px"
        }),
        _makeShapeElement({
            x: 0, y: 160, width: 16, height: 340,
            backgroundColor: ui.accent, zIndex: 2, borderRadius: "0px"
        }),
        _makeTextElement({
            x: 80, y: 200, width: 864,
            content: presentationTitle,
            fontSize: 50, fontWeight: "800", color: ui.text, fontFamily: ui.headingFont, lineHeight: "1.15",
        }),
        _makeTextElement({
            x: 80, y: 380, width: 864,
            content: summary,
            fontSize: 24, fontWeight: "500", color: ui.muted, fontFamily: ui.bodyFont, lineHeight: "1.45",
        }),
    ];

    if (data.authors) {
        elements.push(
            _makeTextElement({
                x: 80, y: 540, width: 864,
                content: String(data.authors),
                fontSize: 20, fontWeight: "600", color: ui.text, fontFamily: ui.bodyFont, lineHeight: "1.3",
            })
        );
    }

    let metaText = [];
    if (data.journal_name) metaText.push(String(data.journal_name));
    if (data.publish_date) metaText.push(String(data.publish_date));
    if (data.doi) metaText.push(`DOI: ${data.doi}`);

    if (metaText.length > 0) {
        elements.push(
            _makeTextElement({
                x: 80, y: 580, width: 864,
                content: metaText.join(" | "),
                fontSize: 16, fontWeight: "500", color: ui.muted, fontFamily: ui.bodyFont, lineHeight: "1.3",
            })
        );
    }

    elements.push(..._makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides));

    return {
        id: generateId("slide"),
        elements
    };
*/
}

function _createBridgeSectionSlide(slide, theme, presentationTitle, slideNumber, totalSlides) {
    return _bridgeFinalizeSlide(
        _bridgeBuildPresetSlide("section-divider", theme, elements => {
            _bridgeSetTextByPlaceholder(elements, "02", String(Math.max(1, slideNumber - 1)).padStart(2, "0"));
            _bridgeSetTextByPlaceholder(elements, "Section Title", _bridgeCleanImportedText(slide.title, "Section"));
            const description = slide.goal || slide.claim || slide.summary || presentationTitle || "";
            _bridgeSetTextByPlaceholders(
                elements,
                [
                    "A brief description of what this section covers",
                    "Short framing sentence for this part of the MD/ML story.",
                ],
                _bridgeWordClamp(description, 18),
            );
        }),
    );
    /*
    const ui = _bridgeVisualMeta(theme);
    return {
        id: generateId("slide"),
        elements: [
            _makeShapeElement({
                x: 0, y: 0, width: 1024, height: 768,
                backgroundColor: ui.accent, opacity: 0.9, zIndex: 1, borderRadius: "0px"
            }),
            _makeTextElement({
                x: 80, y: 330, width: 864,
                content: "Section",
                fontSize: 24, fontWeight: "700", color: "rgba(255,255,255,0.7)", fontFamily: ui.bodyFont, lineHeight: "1.2",
            }),
            _makeTextElement({
                x: 80, y: 380, width: 864,
                content: String(slide.title || "Section"),
                fontSize: 56, fontWeight: "800", color: "#ffffff", fontFamily: ui.headingFont, lineHeight: "1.15",
            }),
            ..._makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides)
        ],
    };
*/
}

function _createBridgeEvidenceSlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides) {
    const slideState = _bridgeBuildPresetSlide("figure-caption", theme);
    _bridgeHydrateContentPreset(slideState, slide, theme);
    return _bridgeFinalizeSlide(slideState);
    /*
    const ui = _bridgeVisualMeta(theme);
    const hasFigure = Boolean(slide.fig_path);
    const bulletContent = _buildBulletContent(slide.points);
    const dense = _bridgeIsDenseSlide(slide);

    const elements = [
        ..._makeBeamerHeader(theme, currentSectionName),
        _makeTextElement({
            x: 40, y: 110, width: 944,
            content: String(slide.title || "Content"),
            fontSize: 34, fontWeight: "700", color: ui.text, fontFamily: ui.headingFont, lineHeight: "1.2",
        }),
        _makeTextElement({
            x: 40, y: 180, width: hasFigure ? 440 : 944,
            content: bulletContent,
            fontSize: dense ? 18 : 22, fontWeight: "400", color: ui.text, fontFamily: ui.bodyFont, lineHeight: "1.5",
        }),
        ..._makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides)
    ];

    if (hasFigure) {
        elements.push(
            _makeImageElement({
                x: 520, y: 180, width: 460, height: slide.fig_cap ? 460 : 500,
                content: _normalizeImportedImagePath(slide.fig_path),
            })
        );
        if (slide.fig_cap) {
            elements.push(
                _makeTextElement({
                    x: 520, y: 660, width: 460,
                    content: _bridgeWordClamp(String(slide.fig_cap), 30),
                    fontSize: 14, fontWeight: "400", color: ui.muted, fontFamily: ui.bodyFont, lineHeight: "1.35",
                })
            );
        }
    }

    return { id: generateId("slide"), elements };
*/
}

function _createBridgeArgumentSlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides) {
    const presetId = _bridgePresetForContentSlide(slide);
    const slideState = _bridgeBuildPresetSlide(presetId, theme);
    _bridgeHydrateContentPreset(slideState, slide, theme);
    return _bridgeFinalizeSlide(slideState);
    /*
    const ui = _bridgeVisualMeta(theme);
    const bulletContent = _buildBulletContent(slide.points);
    const hasFigure = Boolean(slide.fig_path);

    const elements = [
        ..._makeBeamerHeader(theme, currentSectionName),
        _makeTextElement({
            x: 40, y: 110, width: 944,
            content: String(slide.title || "Content"),
            fontSize: 34, fontWeight: "700", color: ui.text, fontFamily: ui.headingFont, lineHeight: "1.2",
        }),
        _makeTextElement({
            x: 40, y: 180, width: hasFigure ? 460 : 944,
            content: bulletContent,
            fontSize: 22, fontWeight: "400", color: ui.text, fontFamily: ui.bodyFont, lineHeight: "1.5",
        }),
        ..._makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides)
    ];

    if (hasFigure) {
        elements.push(
            _makeImageElement({
                x: 540, y: 180, width: 440, height: slide.fig_cap ? 400 : 440,
                content: _normalizeImportedImagePath(slide.fig_path),
            })
        );
        if (slide.fig_cap) {
            elements.push(
                _makeTextElement({
                    x: 540, y: 630, width: 440,
                    content: _bridgeWordClamp(String(slide.fig_cap), 30),
                    fontSize: 14, fontWeight: "400", color: ui.muted, fontFamily: ui.bodyFont, lineHeight: "1.35",
                })
            );
        }
    }
    return { id: generateId("slide"), elements };
*/
}

function _createBridgeSummarySlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides) {
    const slideState = _bridgeBuildPresetSlide("conclusion", theme);
    _bridgeHydrateContentPreset(slideState, slide, theme);
    return _bridgeFinalizeSlide(slideState);
    /*
    const ui = _bridgeVisualMeta(theme);
    const bulletContent = _buildBulletContent(slide.points);

    return {
        id: generateId("slide"),
        elements: [
            ..._makeBeamerHeader(theme, currentSectionName),
            _makeShapeElement({
                x: 40, y: 110, width: 944, height: 100,
                backgroundColor: ui.accentSoft, borderRadius: "12px", zIndex: 1
            }),
            _makeTextElement({
                x: 60, y: 140, width: 900,
                content: String(slide.title || "Summary"),
                fontSize: 36, fontWeight: "700", color: ui.accent, fontFamily: ui.headingFont, lineHeight: "1.2",
            }),
            _makeTextElement({
                x: 40, y: 240, width: 944,
                content: bulletContent,
                fontSize: 22, fontWeight: "400", color: ui.text, fontFamily: ui.bodyFont, lineHeight: "1.6",
            }),
            ..._makeBeamerFooter(theme, presentationTitle, slideNumber, totalSlides)
        ],
    };
*/
}

function _createBridgeContentSlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides) {
    const hasFigure = Boolean(slide.fig_path);
    const pointCount = Array.isArray(slide.points) ? slide.points.length : 0;
    const dense = _bridgeIsDenseSlide(slide);
    const summaryLike = /future|impact|implication|conclusion|limit|direction/i.test(String(slide.title || ""));
    const hint = String(slide?.layout_hint || "").toLowerCase();

    if (summaryLike && pointCount >= 2) {
        return _createBridgeSummarySlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides);
    }
    if (/text|summary/.test(hint) && !hasFigure) {
        return _createBridgeArgumentSlide(
            slide,
            theme,
            currentSectionName,
            presentationTitle,
            slideNumber,
            totalSlides,
        );
    }
    if (/comparison|results|data/.test(hint)) {
        return _createBridgeArgumentSlide(
            slide,
            theme,
            currentSectionName,
            presentationTitle,
            slideNumber,
            totalSlides,
        );
    }
    if (hasFigure && !dense && (slideNumber % 2 === 0 || pointCount <= 2)) {
        return _createBridgeEvidenceSlide(
            slide,
            theme,
            currentSectionName,
            presentationTitle,
            slideNumber,
            totalSlides,
        );
    }
    return _createBridgeArgumentSlide(slide, theme, currentSectionName, presentationTitle, slideNumber, totalSlides);
}
