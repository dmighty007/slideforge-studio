// Document import: converting a document-to-slides export into editor state.

function _attachBridgeEquations(slideState, slide) {
    const equations = Array.isArray(slide?.equations) ? slide.equations : [];
    const usable = equations
        .filter(
            item =>
                item &&
                ((typeof item.path === "string" && item.path.trim()) ||
                    (typeof item.latex === "string" && item.latex.trim())),
        )
        .slice(0, slide?.equation_slide ? 4 : 1);
    if (!usable.length) return slideState;

    if (slide?.equation_slide) {
        const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : {};
        const elements = (slideState.elements || []).filter(el => !(el.type === "text" && Array.isArray(el.content)));
        usable.forEach((equation, idx) => {
            elements.push(
                _makeTextElement({
                    x: 64,
                    y: 158 + idx * 132,
                    width: 190,
                    height: 34,
                    content: String(equation.label || `Equation ${idx + 1}`),
                    fontSize: 18,
                    fontWeight: "700",
                    color: theme.accentStrong || "#2563EB",
                    fontFamily: theme.headingFont || '"Manrope", sans-serif',
                    lineHeight: "1.2",
                    autoHeight: false,
                }),
            );
            if (equation.path) {
                elements.push(
                    _makeImageElement({
                        x: 274,
                        y: 140 + idx * 132,
                        width: 660,
                        height: 92,
                        content: _normalizeImportedImagePath(equation.path),
                    }),
                );
            } else {
                elements.push(
                    _makeEquationElement({
                        x: 274,
                        y: 140 + idx * 132,
                        width: 660,
                        height: 92,
                        latexSrc: equation.latex,
                    }),
                );
            }
        });
        return _bridgeFinalizeSlide({ ...slideState, elements });
    }

    const hasFigure = Boolean(slide?.fig_path);
    const first = usable[0];
    const eqEl = first.path
        ? _makeImageElement({
              x: hasFigure ? 590 : 660,
              y: hasFigure ? 652 : 620,
              width: hasFigure ? 300 : 280,
              height: 70,
              content: _normalizeImportedImagePath(first.path),
          })
        : _makeEquationElement({
              x: hasFigure ? 590 : 660,
              y: hasFigure ? 652 : 620,
              width: hasFigure ? 300 : 280,
              height: 70,
              latexSrc: first.latex,
          });
    return {
        ...slideState,
        elements: [...(slideState.elements || []), eqEl],
    };
}

function _looksLikeBridgeExport(data) {
    return Boolean(
        data &&
        Array.isArray(data.slides) &&
        data.slides.every(slide => slide && typeof slide === "object" && "type" in slide && !("elements" in slide)),
    );
}

function _bridgeInferPresentationTitle(data) {
    const direct = _bridgeCleanImportedText(data?.title);
    if (direct && !/^untitled|imported presentation$/i.test(direct)) return direct;
    const firstContent = (data?.slides || []).find(
        slide => slide?.type === "content" && String(slide?.title || "").trim(),
    );
    if (firstContent?.title) return _bridgeCleanImportedText(firstContent.title);
    const firstSection = (data?.slides || []).find(
        slide => slide?.type === "section" && String(slide?.title || "").trim(),
    );
    if (firstSection?.title) return _bridgeCleanImportedText(firstSection.title);
    return direct || "Imported Presentation";
}

function _convertBridgeExportToEditorState(data) {
    const themeId = state.presentationTheme || "editorial";
    const theme = getPresentationTheme(themeId);
    const targetPageSetup = getPresentationPageSetupId();
    const bridgeBaseConfig = PRESENTATION_PAGE_SETUPS[DEFAULT_PRESENTATION_PAGE_SETUP];
    const targetConfig = getPresentationPageSetupConfig();
    const slides = [];

    const addBridgeSlide = slideState => {
        const nextSlide =
            targetConfig.id === bridgeBaseConfig.id
                ? slideState
                : scaleSlideElementsForPageSetup(slideState, bridgeBaseConfig, targetConfig);
        slides.push(nextSlide);
    };

    const presentationTitle = _bridgeInferPresentationTitle(data);
    const shouldAddTitleSlide = Boolean(presentationTitle || data.sub || data.authors || data.journal_name || data.doi);
    const totalSlides = (data.slides || []).length + (shouldAddTitleSlide ? 1 : 0);
    let currentSlideNumber = 1;

    if (shouldAddTitleSlide) {
        addBridgeSlide(_createBridgeTitleSlide(data, theme, presentationTitle, currentSlideNumber++, totalSlides));
    }

    let currentSectionName = "";

    const bridgeSlides = _bridgePlanPrimaryVisuals((data.slides || []).map(slide => ({ ...slide })));

    for (const slide of bridgeSlides) {
        if (slide.type === "section") {
            currentSectionName = slide.title || "Section";
            addBridgeSlide(
                _createBridgeSectionSlide(slide, theme, presentationTitle, currentSlideNumber++, totalSlides),
            );
        } else if (slide.type === "content") {
            const normalizedSlide = _normalizeBridgeContentSlide(slide);
            addBridgeSlide(
                _attachBridgeEquations(
                    _createBridgeContentSlide(
                        normalizedSlide,
                        theme,
                        currentSectionName,
                        presentationTitle,
                        currentSlideNumber++,
                        totalSlides,
                    ),
                    normalizedSlide,
                ),
            );
        }
    }

    return {
        presentationTheme: themeId,
        pageSetup: targetPageSetup,
        slides: slides.length ? slides : [{ id: generateId("slide"), presentationTransition: "none", elements: [] }],
        selectedIds: [],
        clipboard: null,
    };
}
