// Commands: inserting, deleting, duplicating and nudging elements.

function _inferVideoType(url) {
    const value = String(url || "").trim();
    if (!value) return "direct";
    if (/^data:video\//i.test(value) || /^blob:/i.test(value) || value.startsWith("/media/")) return "local";
    const parseableValue = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const parsed = new URL(parseableValue);
        const host = parsed.hostname.replace(/^www\./, "");
        if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") return "youtube";
        if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return "vimeo";
    } catch (_err) {}
    return "direct";
}

// ─── Element Commands ────────────────────────────────────────────────────────

function addElement(type, options = {}) {
    // A video needs its address first: asked in the app's own dialog (it was the browser's prompt box).
    if (type === "video" && options.content == null) {
        if (typeof sfPrompt !== "function") return;
        sfPrompt({
            title: "Add a video",
            label: "Video address",
            placeholder: "https://www.youtube.com/watch?v=… or a .mp4 / .webm link",
            hint: "YouTube and Vimeo links play in the slide; other addresses should point to an MP4 or WebM file.",
            okLabel: "Add video",
        }).then(url => {
            if (url && url.trim()) addElement("video", { ...options, content: url.trim() });
        });
        return;
    }
    const activeIndex = ensureActiveSlideSync();
    const videoSource = type === "video" ? String(options.content ?? "").trim() : "";
    if (type === "video" && !videoSource) return;

    saveStateToUndo();
    const id = generateId("el");
    const theme = getPresentationTheme();
    const shapeType = type === "shape" ? options.shapeType || "rectangle" : undefined;
    const isArrowShape = typeof shapeType === "string" && shapeType.startsWith("arrow-");
    const shapeBorderRadius = shapeType === "circle" ? "50%" : "0px";
    state.slides[activeIndex].elements.push(placeInContentPlaceholder(state.slides[activeIndex], {
        id,
        type,
        ...(type === "text" ? { bulletStyle: "default", autoHeight: true, placeholder: "Click to add text" } : {}),
        ...(type === "text" && typeof createTextDocumentFromLegacyContent === "function"
            ? {
                  textDocument: createTextDocumentFromLegacyContent("", {
                      bulletStyle: "default",
                  }),
              }
            : {}),
        ...(type === "table"
            ? { tableData: { ...createDefaultTableData(3, 4), ...(typeof themeTableColors === "function" ? themeTableColors(theme) : {}) } }
            : {}),
        ...(type === "shape" ? { shapeType } : {}),
        ...(type === "image" ? { lockAspectRatio: true, imageAspectRatio: 1.5 } : {}),
        ...(type === "shape" && isArrowShape ? { arrowHeadSize: 38, arrowShaftSize: 36 } : {}),
        ...(type === "video"
            ? { videoType: _inferVideoType(videoSource), muted: true, autoplay: false, loop: false }
            : {}),
        ...(type === "molecule" && typeof createMoleculeElementData === "function" ? createMoleculeElementData() : {}),
        ...(type === "pdf"
            ? {
                  pdfInteractive: true,
                  pdfEditorMode: "navigate",
                  pdfAnnotations: [],
                  pdfSelectedAnnotationId: "",
                  localMimeType: "application/pdf",
              }
            : {}),
        ...(type === "sketch"
            ? {
                  strokes: [],
                  sketchStrokeColor: "#000000",
                  sketchStrokeWidth: 2,
                  sketchIsDrawing: false,
              }
            : {}),
        x: 100,
        y: 100,
        width:
            type === "shape"
                ? isArrowShape
                    ? "220px"
                    : "150px"
                : type === "image"
                  ? "300px"
                  : type === "text"
                    ? "360px"
                    : type === "table"
                      ? "520px"
                      : type === "video"
                        ? "480px"
                        : type === "pdf"
                          ? "520px"
                          : type === "molecule"
                            ? "620px"
                            : type === "sketch"
                              ? "400px"
                              : "auto",
        height:
            type === "shape"
                ? isArrowShape
                    ? "100px"
                    : "150px"
                : type === "image"
                  ? "200px"
                  : type === "table"
                    ? "240px"
                    : type === "video"
                      ? "270px"
                      : type === "pdf"
                        ? "360px"
                        : type === "molecule"
                          ? "420px"
                          : type === "sketch"
                            ? "300px"
                            : "auto",
        content:
            type === "text"
                ? ""
                : type === "table"
                  ? ""
                  : type === "image"
                    ? "https://picsum.photos/400/300"
                    : type === "video"
                      ? videoSource
                      : type === "pdf"
                        ? ""
                        : type === "molecule" && typeof createDefaultMoleculeContent === "function"
                          ? createDefaultMoleculeContent()
                          : "",
        styles: {
            color: type === "text" || type === "table" ? theme.defaultTextColor : "transparent",
            fontSize: type === "text" ? "24px" : type === "table" ? "16px" : "0px", // text: same as body text
            fontFamily: theme.bodyFont,
            textAlign: type === "text" || type === "table" ? "left" : undefined,
            zIndex: getNextZIndex(),
            borderRadius:
                type === "shape"
                    ? shapeBorderRadius
                    : type === "video" || type === "pdf" || type === "molecule"
                      ? "8px"
                      : "0px",
            backgroundColor:
                type === "molecule"
                    ? "#020617"
                    : type === "sketch"
                      ? "#ffffff"
                      : type === "shape"
                        ? theme.defaultShapeColor
                        : "transparent",
        },
        // Room for a few lines, so the box does not grow into the footer or the next box as the user types.
        ...(type === "text" ? { textFitMode: "autoHeight", ..._textBoxInsertPosition(360, 140) } : {}),
        animation: null,
    }));
    renderSlidesFromState();
    selectElement(id);
    // A new text box is ready for typing, as in PowerPoint (focus would otherwise stay on the toolbar button).
    if (type === "text") document.getElementById(id)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

// Where a new text box goes: the first spot, reading top-down, that covers none of the slide's content (empty
// placeholders included) above the footer; if every spot covers something, the one that covers the least.
function _textBoxInsertPosition(width, height) {
    if (typeof _getSlideInsertBounds !== "function" || typeof _currentSlideContentBoxes !== "function") return {};
    const bounds = _getSlideInsertBounds();
    const footerTop = _currentSlideFooterTop();
    const floor = footerTop === null ? bounds.slideH - bounds.margin : footerTop - 12;
    const boxes = _currentSlideContentBoxes();
    const m = Math.round(bounds.margin);
    const columns = [m, Math.round((bounds.slideW - width) / 2), Math.round(bounds.slideW - width - m)];
    const overlap = (x, y) =>
        boxes.reduce((sum, b) => {
            const w = Math.min(x + width, b.x + b.w) - Math.max(x, b.x);
            const h = Math.min(y + height, b.y + b.h) - Math.max(y, b.y);
            return sum + (w > 0 && h > 0 ? w * h : 0);
        }, 0);
    let best = null;
    for (let y = m; y + height <= floor || y === m; y += 16) {
        for (const x of columns) {
            const covered = overlap(x, y);
            if (!best || covered < best.covered) best = { x, y, covered };
            if (!covered) return { x, y };
        }
    }
    return best ? { x: best.x, y: best.y } : {};
}

function addShape(shapeType = "rectangle") {
    addElement("shape", { shapeType });
}

function addSketchElement() {
    addElement("sketch");
}

function addChart(chartType = "bar") {
    const activeIndex = ensureActiveSlideSync();
    saveStateToUndo();
    const id = generateId("el");
    const theme = getPresentationTheme();
    const chart = placeInContentPlaceholder(state.slides[activeIndex], {
        id,
        type: "chart",
        chartType,
        chartData: {
            labels: ["Jan", "Feb", "Mar", "Apr", "May"],
            datasets: [
                {
                    label: "Sales",
                    data: [12, 19, 3, 5, 2],
                    ...(typeof chartSeriesColors === "function"
                        ? chartSeriesColors(chartType, 5, theme)
                        : { backgroundColor: theme.accentStrong, borderColor: theme.accentStrong }),
                    borderWidth: 1,
                },
            ],
        },
        chartOptions: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: "top" },
            },
        },
        // 16px: 12px labels were too small to read once the slide was projected.
        chartStyle: { legend: "top", title: "", xTitle: "", yTitle: "", grid: true, fontSize: 16, seriesColors: [] },
        x: 100,
        y: 100,
        width: "500px",
        height: "350px",
        styles: {
            zIndex: getNextZIndex(),
            // The theme's card, not a white box on every theme: on a dark theme the chart sits on the slide.
            backgroundColor: theme.surfaceColor || "#ffffff",
            padding: "16px",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
        },
    });
    if (typeof applyChartSeriesColors === "function") applyChartSeriesColors(chart, theme);
    state.slides[activeIndex].elements.push(chart);
    renderSlidesFromState();
    selectElement(id);
}

function addConnector(connectorType = "line") {
    const activeIndex = ensureActiveSlideSync();
    saveStateToUndo();
    const id = generateId("el");
    const theme = getPresentationTheme();
    const safeType = connectorType === "curve" || connectorType === "poly" ? connectorType : "line";
    const points =
        safeType === "curve"
            ? [
                  { x: 24, y: 96 },
                  { x: 140, y: 24 },
                  { x: 256, y: 96 },
              ]
            : safeType === "poly"
              ? [
                    { x: 24, y: 110 },
                    { x: 140, y: 110 },
                    { x: 140, y: 36 },
                    { x: 256, y: 36 },
                ]
              : [
                    { x: 24, y: 96 },
                    { x: 256, y: 36 },
                ];

    const newConnector = {
        id,
        type: "connector",
        connectorType: safeType,
        connectorStart: "none",
        connectorEnd: "arrow",
        connectorHeadWidth: 14,
        connectorHeadLength: 14,
        points,
        x: 120,
        y: 120,
        width: "280px",
        height: "140px",
        content: "",
        styles: {
            backgroundColor: "transparent",
            color: theme.accentStrong,
            strokeWidth: 4,
            zIndex: getNextZIndex(),
            borderRadius: "0px",
        },
        themeManaged: true,
    };
    normalizeConnectorGeometry(newConnector);
    state.slides[activeIndex].elements.push(newConnector);
    renderSlidesFromState();
    selectElement(id);
}

function addComponent(templateId) {
    const activeIndex = ensureActiveSlideSync();
    const template = resolveComponentTemplate(templateId, getPresentationTheme());
    if (!template) return;
    saveStateToUndo();
    const groupId = generateId("grp");
    const newIds = [];
    const baseZ = getNextZIndex();
    template.elements.forEach(el => {
        const id = generateId("el");
        const componentZ = el.styles && el.styles.zIndex ? el.styles.zIndex : 1;
        state.slides[activeIndex].elements.push(placeInContentPlaceholder(state.slides[activeIndex], {
            ...el,
            id,
            groupId,
            themeManaged: true,
            x: 200 + (el.offsetX || 0),
            y: 200 + (el.offsetY || 0),
            styles: {
                ...(el.styles || {}),
                zIndex: baseZ + componentZ - 1,
            },
        }));
        newIds.push(id);
    });
    renderSlidesFromState();
    setSelectedIds(newIds);
    buildPropertiesPanel();
    updateGroupBound();
}

function deleteSelectedElements() {
    const activeIndex = ensureActiveSlideSync();
    if (!state.selectedIds.length) return;
    saveStateToUndo();
    state.slides[activeIndex].elements = state.slides[activeIndex].elements.filter(
        el => !state.selectedIds.includes(el.id) || el.locked === true,
    );
    // Keep selection only for elements that were NOT deleted (because they were locked)
    state.selectedIds = state.selectedIds.filter(id => {
        const el = state.slides[activeIndex].elements.find(e => e.id === id);
        return !!el;
    });
    if (state.selectedIds.length === 0) {
        clearSelection();
    } else {
        buildPropertiesPanel();
        updateGroupBound();
    }
    renderSlidesFromState();
}

function deleteElement(id) {
    const activeIndex = ensureActiveSlideSync();
    const el = state.slides[activeIndex].elements.find(e => e.id === id);
    if (el?.locked) return;

    state.slides[activeIndex].elements = state.slides[activeIndex].elements.filter(el => el.id !== id);
    clearSelection();
    renderSlidesFromState();
}

function duplicateSelectedElements() {
    const activeIndex = ensureActiveSlideSync();
    if (!state.selectedIds.length) return;
    saveStateToUndo();
    const newIds = [];
    const groupIdMap = {};
    const idMap = {};
    const copies = [];

    state.selectedIds.forEach(id => {
        const el = state.slides[activeIndex].elements.find(e => e.id === id);
        if (!el) return;
        const newId = generateId("el");
        const copy = JSON.parse(JSON.stringify(el));
        idMap[el.id] = newId;
        copies.push(copy);
        copy.id = newId;
        copy.x += 20;
        copy.y += 20;

        if (copy.groupId) {
            if (!groupIdMap[copy.groupId]) {
                groupIdMap[copy.groupId] = generateId("grp");
            }
            copy.groupId = groupIdMap[copy.groupId];
        } else {
            copy.groupId = null;
        }

        if (!copy.styles) copy.styles = {};
        copy.styles.zIndex = getNextZIndex();

        state.slides[activeIndex].elements.push(copy);
        newIds.push(newId);
    });
    if (typeof remapConnectorBindings === "function") remapConnectorBindings(copies, idMap);
    renderSlidesFromState();
    setSelectedIds(newIds);
    buildPropertiesPanel();
    updateGroupBound();
}

function duplicateElement(id) {
    const activeIndex = ensureActiveSlideSync();
    saveStateToUndo();
    const el = state.slides[activeIndex].elements.find(e => e.id === id);
    if (!el) return;
    const newId = generateId("el");
    const copy = JSON.parse(JSON.stringify(el));
    copy.id = newId;
    copy.x += 20;
    copy.y += 20;
    copy.groupId = null; // never inherit group
    if (typeof remapConnectorBindings === "function") remapConnectorBindings([copy], {});
    if (!copy.styles) copy.styles = {};
    copy.styles.zIndex = getNextZIndex();
    state.slides[activeIndex].elements.push(copy);
    renderSlidesFromState();
    selectElement(newId);
}

function nudgeSelectedElements(dx, dy) {
    const activeIndex = ensureActiveSlideSync();
    if (!state.selectedIds.length) return;
    saveStateToUndo();
    state.selectedIds.forEach(id => {
        const el = state.slides[activeIndex].elements.find(e => e.id === id);
        if (!el || el.locked === true) return;
        const nextX = (Number(el.x) || 0) + dx;
        const nextY = (Number(el.y) || 0) + dy;
        el.x = nextX;
        el.y = nextY;

        const dom = document.getElementById(id);
        if (dom) {
            dom.style.transform = canvasElementTransform(el, nextX, nextY);
            dom.setAttribute("data-x", nextX);
            dom.setAttribute("data-y", nextY);
        }
    });
    if (typeof detachMovedConnectors === "function") detachMovedConnectors();
    if (typeof followAttachedConnectors === "function") followAttachedConnectors();
    updateGroupBound();
    renderSlidePreviews(currentSlideIndex);
    if (typeof schedulePresentationAutosave === "function") {
        schedulePresentationAutosave();
    }
}
