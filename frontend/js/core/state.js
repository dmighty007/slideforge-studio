// --- Core State Layer ---
let _idCounter = 0;

function generateId(prefix) {
    const hasUUID = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
    const raw = hasUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${(_idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}_${raw}`;
}

function parseSlideforgeDimension(value) {
    if (typeof value === "number") return value;
    const parsed = parseFloat(String(value || "").replace("px", ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function isPresetBackgroundElement(el) {
    if (!el || el.type !== "shape") return false;
    if (el.presetBackground === true || el.backgroundRole === "preset") return true;

    const styles = el.styles || {};
    if (styles.pointerEvents !== "none") return false;
    if (Number(styles.zIndex || 0) > 0) return false;
    if (parseSlideforgeDimension(el.x) !== 0 || parseSlideforgeDimension(el.y) !== 0) return false;

    const setup =
        typeof getPresentationPageSetupConfig === "function"
            ? getPresentationPageSetupConfig()
            : { width: 1024, height: 768 };
    const width = parseSlideforgeDimension(el.width);
    const height = parseSlideforgeDimension(el.height);
    const expectedWidth = parseSlideforgeDimension(setup?.width) || 1024;
    const expectedHeight = parseSlideforgeDimension(setup?.height) || 768;
    const coversCurrentSlide = width >= expectedWidth - 1 && height >= expectedHeight - 1;
    const coversBaseSlide = width >= 1023 && height >= 767;

    return coversCurrentSlide || coversBaseSlide;
}

// An empty text box that shows a hint ("Click to add title") in the editor until the user types. The hint never
// appears when presenting, in thumbnails or in exports (see .text-element-content[data-placeholder] in base.css).
// Titles use a fixed box whose text shrinks to fit ("autofit") so a long title never runs into what is below it;
// body text grows downwards. role "content" marks the placeholder that the first inserted object replaces.
function buildPlaceholderText({
    x, y, width, fontSize, placeholder, fontFamily, color,
    fontWeight = null, textAlign = "left", zIndex = 10, fitHeight = null, role = null,
}) {
    return {
        id: generateId("el"),
        type: "text",
        x,
        y,
        width: `${width}px`,
        ...(fitHeight
            ? { height: `${fitHeight}px`, autoHeight: false, textFitMode: "autofit", minAutoFitFontSize: 20 }
            : { height: "auto", autoHeight: true, textFitMode: "autoHeight" }),
        // The body of a "Title and content" slide is a bulleted list from the start, as in PowerPoint.
        content: role === "content" ? [{ text: "", level: 0 }] : "",
        placeholder,
        ...(role ? { placeholderRole: role } : {}),
        styles: {
            color,
            fontSize: `${fontSize}px`,
            fontFamily,
            textAlign,
            zIndex,
            ...(fontWeight ? { fontWeight } : {}),
        },
        animation: null,
    };
}

function _isEmptyTextElement(el) {
    if (!el || el.type !== "text") return false;
    const content = Array.isArray(el.content) ? el.content.map(item => item?.html ?? item?.text ?? "").join("") : el.content;
    const html = String(content || "").replace(/<[^>]*>/g, "").trim();
    const docText = (JSON.stringify(el.textDocument || {}).match(/"text":"((?:[^"\\]|\\.)*)"/g) || [])
        .some(match => match.slice(8, -1).trim());
    return !html && !docText;
}

// Like PowerPoint's content placeholder: the first object inserted into a slide takes the empty "Click to add
// text" box's place (scaled to fit the area above the footer) instead of landing on top of it.
function claimContentPlaceholder(slide, element) {
    if (!slide || !element || element.type === "text") return false;
    const index = (slide.elements || []).findIndex(el => el?.placeholderRole === "content" && _isEmptyTextElement(el));
    if (index < 0) return false;
    const box = slide.elements[index];
    const page = typeof getPresentationPageSetupConfig === "function" ? getPresentationPageSetupConfig() : {};
    const x = parseFloat(box.x) || 0;
    const y = parseFloat(box.y) || 0;
    const maxW = parseFloat(box.width) || 800;
    const maxH = Math.max(120, (Number(page.height) || 768) - 110 - y); // stay clear of the footer
    const width = parseFloat(element.width);
    const height = parseFloat(element.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        const scale = Math.min(1, maxW / width, maxH / height);
        element.width = `${Math.round(width * scale)}px`;
        element.height = `${Math.round(height * scale)}px`;
        element.x = Math.round(x + (maxW - width * scale) / 2);
    } else {
        element.x = x;
    }
    element.y = y;
    slide.elements.splice(index, 1);
    return true;
}

// For insert commands: element placed into the slide's empty content placeholder if it has one. Otherwise an
// object still at the old fixed default spot (100, 100), which sat on top of the title, goes where it covers the
// least of the slide's content (title included) above the footer. Objects that chose a spot keep it.
// anywhere: place it whatever its starting position (for inserts whose default spot is only a guess: equations,
// flowcharts, embeds and icons landed at fixed spots on top of whatever was there). claim: false keeps it out of
// the content placeholder (an icon should not take the bullet box's place).
function placeInContentPlaceholder(slide, element, { anywhere = false, claim = true } = {}) {
    if (claim && claimContentPlaceholder(slide, element)) return element;
    if (!anywhere && (parseFloat(element.x) !== 100 || parseFloat(element.y) !== 100)) return element;
    const width = parseFloat(element.width);
    const height = parseFloat(element.height) || 80;
    if (!Number.isFinite(width) || width <= 0) return element;
    if (
        slide !== state.slides?.[currentSlideIndex] ||
        typeof _leastOverlapPosition !== "function" ||
        typeof _getSlideInsertBounds !== "function"
    ) {
        return element;
    }
    const bounds = _getSlideInsertBounds();
    const footerTop = typeof _currentSlideFooterTop === "function" ? _currentSlideFooterTop() : null;
    const floor = footerTop === null ? bounds.slideH - bounds.margin : footerTop - 12;
    const boxes = _currentSlideContentBoxes();
    let best = { ..._leastOverlapPosition(width, height, bounds, boxes, floor), width, height };
    // On a crowded slide, a smaller copy that fits beside the content beats a full-size one on top of it (text
    // boxes keep their size: their height follows the text).
    if (best.overlap > 0 && element.type !== "text" && Number.isFinite(parseFloat(element.height))) {
        for (const share of [0.8, 0.62, 0.48]) {
            const w = Math.round(width * share);
            const h = Math.round(height * share);
            const spot = _leastOverlapPosition(w, h, bounds, boxes, floor);
            if (spot.overlap < best.overlap) best = { ...spot, width: w, height: h };
            if (!best.overlap) break;
        }
        element.width = `${best.width}px`;
        element.height = `${best.height}px`;
    }
    element.x = best.x;
    element.y = best.y;
    return element;
}

function placeWhereFree(slide, element, options = {}) {
    return placeInContentPlaceholder(slide, element, { ...options, anywhere: true });
}

function buildDefaultPresentationState() {
    const pageSetup = typeof NEW_PRESENTATION_PAGE_SETUP !== "undefined" ? NEW_PRESENTATION_PAGE_SETUP : DEFAULT_PRESENTATION_PAGE_SETUP;
    const page = typeof PRESENTATION_PAGE_SETUPS !== "undefined" ? PRESENTATION_PAGE_SETUPS[pageSetup] : { width: 1024, height: 768 };
    // Title and subtitle laid out for the page: full width less margins, centred on the upper middle.
    const textWidth = page.width - 128;
    const titleY = Math.round(page.height * 0.3);
    return {
        presentationTheme: "editorial",
        presentationTransition: "none",
        pageSetup,
        masterSlides: createDefaultMasterSlidesState(),
        colorPalette: ["#172033", "#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#D97706", "#059669", "#FFFFFF"],
        slides: [
            {
                id: generateId("slide"),
                layoutId: "blank-titled",
                masterId: "content",
                notes: "",
                presentationTransition: "none",
                // Title slide: full-width, centred title and subtitle that wrap instead of running off the slide.
                elements: [
                    buildPlaceholderText({
                        x: 64, y: titleY, width: textWidth, fitHeight: 150, fontSize: 56, textAlign: "center", zIndex: 1,
                        placeholder: "Click to add title", fontFamily: '"Manrope", sans-serif', color: "#172033",
                    }),
                    buildPlaceholderText({
                        x: 64, y: titleY + 174, width: textWidth, fontSize: 26, textAlign: "center", zIndex: 2,
                        placeholder: "Click to add subtitle", fontFamily: '"Manrope", sans-serif', color: "#475569",
                    }),
                ],
            },
        ],
        selectedIds: [],
        clipboard: null,
    };
}

const MASTER_SLIDE_DEFINITIONS = {
    none: { id: "none", name: "None", description: "No shared master elements" },
    content: { id: "content", name: "Content", description: "Footer, slide number, and subtle accent rule" },
    title: { id: "title", name: "Title", description: "Presentation title treatment with minimal footer" },
    section: { id: "section", name: "Section", description: "Section divider treatment with strong side accent" },
};

function createDefaultMasterSlidesState() {
    return {
        content: {
            id: "content",
            name: "Content",
            enabled: true,
            footerText: "Presentation",
            logoText: "SlideForge",
            showSlideNumber: true,
            showFooter: true,
            showTopRule: true,
        },
        title: {
            id: "title",
            name: "Title",
            enabled: true,
            footerText: "",
            logoText: "SlideForge",
            showSlideNumber: false,
            showFooter: false,
            showTopRule: true,
        },
        section: {
            id: "section",
            name: "Section",
            enabled: true,
            footerText: "Section",
            logoText: "SlideForge",
            showSlideNumber: true,
            showFooter: true,
            showTopRule: false,
        },
    };
}

function normalizeMasterSlidesState(rawMasters = {}) {
    const defaults = createDefaultMasterSlidesState();
    const normalized = {};
    Object.entries(defaults).forEach(([id, fallback]) => {
        const raw = rawMasters && typeof rawMasters === "object" ? rawMasters[id] || {} : {};
        normalized[id] = {
            ...fallback,
            ...(raw && typeof raw === "object" ? raw : {}),
            id,
            name: typeof raw.name === "string" && raw.name.trim() ? _truncateStateString(raw.name, 80) : fallback.name,
            footerText:
                typeof raw.footerText === "string" ? _truncateStateString(raw.footerText, 180) : fallback.footerText,
            logoText: typeof raw.logoText === "string" ? _truncateStateString(raw.logoText, 80) : fallback.logoText,
            enabled: raw.enabled !== false,
            showSlideNumber: raw.showSlideNumber !== false,
            showFooter: raw.showFooter !== false,
            showTopRule: raw.showTopRule !== false,
        };
    });
    return normalized;
}

function resolveSlideMasterId(slide = {}) {
    const requested = typeof slide.masterId === "string" ? slide.masterId : "";
    if (requested === "none") return "none";
    return MASTER_SLIDE_DEFINITIONS[requested] ? requested : "content";
}

let state = buildDefaultPresentationState();

let currentSlideIndex = 0;
let undoStack = [];
let redoStack = [];
Object.defineProperties(window, {
    state: {
        configurable: true,
        get: () => state,
        set: value => {
            if (value && typeof value === "object") state = value;
        },
    },
    currentSlideIndex: {
        configurable: true,
        get: () => currentSlideIndex,
        set: value => {
            setCurrentSlideIndex(Number(value) || 0);
        },
    },
});
let currentPresentationId = null;
let currentPresentationAutosaveVersion = 0;
let currentPresentationTitle = "Untitled Presentation";
let currentAuthUser = null;
let currentAuthMode = "login";
let currentEntryAuthMode = "login";
let _authReady = false;
let _presentationPersistenceReady = false;
let _presentationPersistenceEnabled = true;
let _presentationHydrating = false;
let _autosaveTimer = null;
let _lastPersistedFingerprint = "";
let _backendApiAvailable = true;
const PRESENTATION_STORAGE_KEY = "pptmaker_presentation_id";
const LOCAL_PRESENTATION_STORAGE_KEY = "pptmaker_local_presentation";
// Unsaved edits captured when the page closes before autosave ran; recovered on the next load.
const UNSAVED_BACKUP_STORAGE_KEY = "pptmaker_unsaved_backup";
let _pendingRecoverySave = false;
const ENTRY_GATE_DISMISSED_KEY = "pptmaker_entry_gate_dismissed";
const PRESENTATION_ANIMATION_EFFECTS = [
    "fade-in",
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "zoom-in",
    "pop-in",
    "wipe-in",
    "pulse",
    "glow",
];
const PRESENTATION_TRANSITION_EFFECTS = new Set(["none", "fade", "diffuse", "slide", "convex", "concave", "zoom"]);
const PRESENTATION_ENTRANCE_EFFECTS = new Set([
    "fade-in",
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "zoom-in",
    "pop-in",
    "wipe-in",
]);
const PRESENTATION_EMPHASIS_EFFECTS = new Set(["pulse", "glow"]);

function createDefaultTableData(rows = 3, cols = 4) {
    const safeRows = Math.max(1, Number(rows) || 3);
    const safeCols = Math.max(1, Number(cols) || 4);
    const cells = Array.from({ length: safeRows }, (_, rowIndex) =>
        Array.from({ length: safeCols }, (_, colIndex) => ({
            text:
                rowIndex === 0
                    ? `Header ${colIndex + 1}`
                    : rowIndex === 1 && colIndex === 0
                      ? "Item"
                      : rowIndex === 1 && colIndex === 1
                        ? "Value"
                        : "",
            styles: {},
        })),
    );
    return {
        rows: safeRows,
        cols: safeCols,
        headerRow: true,
        zebra: false,
        borderColor: "#cbd5e1",
        borderWidth: 1,
        cellPadding: 10,
        rowHeights: Array.from({ length: safeRows }, () => 44),
        colWidths: Array.from({ length: safeCols }, () => 140),
        selection: null,
        headerFill: "#e2e8f0",
        bodyFill: "#ffffff",
        altFill: "#f8fafc",
        textColor: "#172033",
        headerTextColor: "#172033",
        cells,
    };
}

function normalizeTableData(tableData) {
    const fallback = createDefaultTableData();
    if (!tableData || typeof tableData !== "object") return fallback;
    const rows = Math.max(1, Number(tableData.rows) || fallback.rows);
    const cols = Math.max(1, Number(tableData.cols) || fallback.cols);
    const rawCells = Array.isArray(tableData.cells) ? tableData.cells : [];
    const rawRowHeights = Array.isArray(tableData.rowHeights) ? tableData.rowHeights : [];
    const rawColWidths = Array.isArray(tableData.colWidths) ? tableData.colWidths : [];
    const rowHeights = Array.from({ length: rows }, (_, rowIndex) => {
        const value = Number(rawRowHeights[rowIndex]);
        return Number.isFinite(value) && value >= 24 ? value : fallback.rowHeights[rowIndex] || 44;
    });
    const colWidths = Array.from({ length: cols }, (_, colIndex) => {
        const value = Number(rawColWidths[colIndex]);
        return Number.isFinite(value) && value >= 36 ? value : fallback.colWidths[colIndex] || 140;
    });
    const rawSelection = tableData.selection && typeof tableData.selection === "object" ? tableData.selection : null;
    const selectionType = ["cell", "row", "col"].includes(rawSelection?.type) ? rawSelection.type : "";
    const selection =
        selectionType === "row" && Number(rawSelection.row) >= 0 && Number(rawSelection.row) < rows
            ? { type: "row", row: Number(rawSelection.row) }
            : selectionType === "col" && Number(rawSelection.col) >= 0 && Number(rawSelection.col) < cols
              ? { type: "col", col: Number(rawSelection.col) }
              : selectionType === "cell" &&
                  Number(rawSelection.row) >= 0 &&
                  Number(rawSelection.row) < rows &&
                  Number(rawSelection.col) >= 0 &&
                  Number(rawSelection.col) < cols
                ? { type: "cell", row: Number(rawSelection.row), col: Number(rawSelection.col) }
                : null;
    const cells = Array.from({ length: rows }, (_, rowIndex) =>
        Array.from({ length: cols }, (_, colIndex) => {
            const rawCell = rawCells[rowIndex]?.[colIndex];
            if (rawCell && typeof rawCell === "object") {
                return {
                    text: typeof rawCell.text === "string" ? rawCell.text : "",
                    styles: rawCell.styles && typeof rawCell.styles === "object" ? { ...rawCell.styles } : {},
                };
            }
            return {
                text: rowIndex === 0 ? `Header ${colIndex + 1}` : "",
                styles: {},
            };
        }),
    );
    return {
        rows,
        cols,
        headerRow: tableData.headerRow !== false,
        zebra: Boolean(tableData.zebra),
        borderColor: typeof tableData.borderColor === "string" ? tableData.borderColor : fallback.borderColor,
        borderWidth: Math.max(0, Number(tableData.borderWidth) || fallback.borderWidth),
        cellPadding: Math.max(2, Number(tableData.cellPadding) || fallback.cellPadding),
        rowHeights,
        colWidths,
        selection,
        headerFill: typeof tableData.headerFill === "string" ? tableData.headerFill : fallback.headerFill,
        bodyFill: typeof tableData.bodyFill === "string" ? tableData.bodyFill : fallback.bodyFill,
        altFill: typeof tableData.altFill === "string" ? tableData.altFill : fallback.altFill,
        textColor: typeof tableData.textColor === "string" ? tableData.textColor : fallback.textColor,
        headerTextColor:
            typeof tableData.headerTextColor === "string" ? tableData.headerTextColor : fallback.headerTextColor,
        fontFamily: typeof tableData.fontFamily === "string" ? tableData.fontFamily : '"Manrope", sans-serif',
        fontSize: typeof tableData.fontSize === "string" ? tableData.fontSize : "16px",
        fontWeight: typeof tableData.fontWeight === "string" ? tableData.fontWeight : "400",
        fontStyle: typeof tableData.fontStyle === "string" ? tableData.fontStyle : "normal",
        textAlign: typeof tableData.textAlign === "string" ? tableData.textAlign : "left",
        cells,
    };
}

function isStructuredAnimationEffect(effect) {
    return PRESENTATION_ANIMATION_EFFECTS.includes(effect);
}

function createDefaultAnimation(effect = "fade-in", overrides = {}) {
    const safeEffect = isStructuredAnimationEffect(effect) ? effect : "fade-in";
    return {
        effect: safeEffect,
        trigger: overrides.trigger === "on-click" ? "on-click" : "on-slide",
        order: Number.isFinite(Number(overrides.order)) ? Number(overrides.order) : 0,
        durationMs: Math.max(100, Number(overrides.durationMs) || 800),
        delayMs: Math.max(0, Number(overrides.delayMs) || 0),
        easing: ["ease-out", "ease-in-out", "linear"].includes(overrides.easing) ? overrides.easing : "ease-out",
        direction: typeof overrides.direction === "string" ? overrides.direction : "",
        distancePx: Number.isFinite(Number(overrides.distancePx)) ? Number(overrides.distancePx) : 48,
        scaleFrom: Number.isFinite(Number(overrides.scaleFrom)) ? Number(overrides.scaleFrom) : 0.88,
        emphasisStyle:
            overrides.emphasisStyle === "glow" ||
            overrides.emphasisStyle === "shake" ||
            overrides.emphasisStyle === "pulse"
                ? overrides.emphasisStyle
                : PRESENTATION_EMPHASIS_EFFECTS.has(safeEffect)
                  ? safeEffect
                  : "pulse",
    };
}

function normalizeElementAnimation(el = {}) {
    const legacyValue = typeof el.animation === "string" ? el.animation.trim() : "";
    const raw = legacyValue
        ? { effect: legacyValue }
        : el.animation && typeof el.animation === "object"
          ? el.animation
          : null;
    if (!raw) return null;
    // Preserve advanced animation configs (timelines-based or advanced type)
    if (Array.isArray(raw.timelines)) return raw;
    if (
        raw.type &&
        typeof ANIMATION_TRANSITION_TYPES !== "undefined" &&
        Array.isArray(ANIMATION_TRANSITION_TYPES) &&
        ANIMATION_TRANSITION_TYPES.includes(raw.type)
    )
        return raw;
    if (!raw.effect || !isStructuredAnimationEffect(raw.effect)) {
        return null;
    }
    const normalized = createDefaultAnimation(raw.effect, {
        ...raw,
        durationMs: raw.durationMs ?? el.animDuration,
        delayMs: raw.delayMs ?? el.animDelay,
    });
    if (PRESENTATION_ENTRANCE_EFFECTS.has(normalized.effect)) {
        if (!normalized.direction) {
            normalized.direction =
                normalized.effect === "slide-up"
                    ? "up"
                    : normalized.effect === "slide-down"
                      ? "down"
                      : normalized.effect === "slide-left"
                        ? "left"
                        : normalized.effect === "slide-right"
                          ? "right"
                          : "";
        }
    }
    return normalized;
}

function parseElementPixelValue(value, fallback = 0) {
    const parsed = Number.parseFloat(String(value ?? "").replace("px", ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getImageAspectRatio(data = {}) {
    const stored = Number(data.imageAspectRatio ?? data.aspectRatio);
    if (Number.isFinite(stored) && stored > 0) return stored;
    const width = parseElementPixelValue(data.width, 0);
    const height = parseElementPixelValue(data.height, 0);
    return width > 0 && height > 0 ? width / height : 1;
}

function normalizeImageCropTransform(crop = null) {
    if (!crop || typeof crop !== "object") return null;
    const widthPercent = Math.max(100, Number(crop.widthPercent) || 100);
    const heightPercent = Math.max(100, Number(crop.heightPercent) || 100);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    return {
        widthPercent,
        heightPercent,
        leftPercent: clamp(crop.leftPercent, 100 - widthPercent, 0),
        topPercent: clamp(crop.topPercent, 100 - heightPercent, 0),
    };
}

function isElementAnimationConfigured(el = {}) {
    return Boolean(normalizeElementAnimation(el));
}

function normalizeSlideBackground(background) {
    if (!background) return null;
    const clampBackgroundAdjustments = source => ({
        opacity: Math.max(0, Math.min(1, Number(source.opacity ?? 1))),
        blur: Math.max(0, Math.min(40, Number(source.blur) || 0)),
        brightness: Math.max(10, Math.min(200, Number(source.brightness ?? 100))),
        saturate: Math.max(0, Math.min(250, Number(source.saturate ?? 100))),
    });
    if (typeof background === "string") {
        const trimmed = background.trim();
        if (!trimmed) return null;
        return {
            type: /\.(mp4|webm|ogg)(\?.*)?$/i.test(trimmed) || /^data:video\//i.test(trimmed) ? "video" : "image",
            content: trimmed,
            mimeType: "",
            fit: "cover",
            ...clampBackgroundAdjustments({}),
        };
    }
    if (typeof background !== "object") return null;
    if (background.type === "three" || background.type === "3d") {
        const styles = ["orbital", "mesh", "particles", "lattice", "wave", "vortex"];
        const style = styles.includes(background.style) ? background.style : "orbital";
        return {
            type: "three",
            content: "theme-motion",
            mimeType: "",
            fit: "cover",
            style,
            ...clampBackgroundAdjustments(background),
        };
    }
    const content = String(background.content || "").trim();
    if (!content || !_isSafeAssetUrl(content, { allowData: true })) return null;
    const type = background.type === "video" ? "video" : "image";
    const fit = ["cover", "contain", "fill"].includes(background.fit) ? background.fit : "cover";
    return {
        type,
        content,
        mimeType: typeof background.mimeType === "string" ? background.mimeType : "",
        fit,
        ...clampBackgroundAdjustments(background),
    };
}

function updateProjectTitleUi() {
    const input = document.getElementById("project-title-input");
    if (!input) return;
    input.value = currentPresentationTitle || "Untitled Presentation";
}

function setProjectSaveHint(message, tone = "muted") {
    const hint = document.getElementById("project-save-hint");
    if (!hint) return;
    hint.textContent = message;
    hint.style.color =
        tone === "success" ? "#047857" : tone === "warn" ? "#b45309" : tone === "danger" ? "#b91c1c" : "#94a3b8";
}

function markBackendUnavailable(reason = "Backend API unavailable") {
    _backendApiAvailable = false;
    _presentationPersistenceEnabled = false;
    _presentationPersistenceReady = true;
    setAuthState(null);
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    setProjectSaveHint("Local autosave on", "success");
    console.warn(reason);
}

function isBackendApiAvailable() {
    return _backendApiAvailable;
}

function accountsDisabled() {
    return document.body.classList.contains("accounts-disabled");
}

function updateEntryGate() {
    const hero = document.getElementById("entry-hero");
    if (!hero) return;
    const dismissed = sessionStorage.getItem(ENTRY_GATE_DISMISSED_KEY) === "true";
    // Without accounts (the desktop app) there is nothing to sign in to, so the gate never shows.
    const shouldShow = !accountsDisabled() && !currentAuthUser && !dismissed;
    document.body.classList.remove("entry-gate-pending");
    document.body.classList.toggle("entry-gate-active", shouldShow);
    hero.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

function enterEditorWorkspace() {
    sessionStorage.setItem(ENTRY_GATE_DISMISSED_KEY, "true");
    updateEntryGate();
    requestAnimationFrame(() => {
        if (typeof Reveal !== "undefined" && Reveal.layout) Reveal.layout();
        if (typeof applyZoom === "function") applyZoom();
    });
}

function continueAsGuest() {
    setProjectSaveHint("Local autosave on", "success");
    enterEditorWorkspace();
}

function switchEntryAuthMode(mode = "login") {
    currentEntryAuthMode = mode === "register" ? "register" : "login";
    const title = document.getElementById("entry-auth-title");
    const subtitle = document.getElementById("entry-auth-subtitle");
    const submit = document.getElementById("entry-auth-submit");
    const toggle = document.getElementById("entry-auth-toggle");
    const error = document.getElementById("entry-auth-error");
    const password = document.getElementById("entry-auth-password");
    if (title) title.textContent = currentEntryAuthMode === "register" ? "Create account" : "Sign in";
    if (subtitle) {
        subtitle.textContent =
            currentEntryAuthMode === "register"
                ? "Create an account to save projects."
                : "Use your account to save projects.";
    }
    if (submit) submit.textContent = currentEntryAuthMode === "register" ? "Create account" : "Sign in";
    if (toggle)
        toggle.textContent = currentEntryAuthMode === "register" ? "Use an existing account" : "Create a new account";
    if (password) password.autocomplete = currentEntryAuthMode === "register" ? "new-password" : "current-password";
    if (error) error.textContent = "";
}

function toggleEntryAuthMode() {
    switchEntryAuthMode(currentEntryAuthMode === "login" ? "register" : "login");
}

async function submitEntryAuthForm(event) {
    if (event) event.preventDefault();
    if (!_backendApiAvailable) {
        continueAsGuest();
        return;
    }
    const username = document.getElementById("entry-auth-username")?.value?.trim() || "";
    const password = document.getElementById("entry-auth-password")?.value || "";
    const error = document.getElementById("entry-auth-error");
    if (error) error.textContent = "";

    try {
        const path = currentEntryAuthMode === "register" ? "/api/auth/register/" : "/api/auth/login/";
        const session = await _authRequest(path, {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        sessionStorage.setItem(ENTRY_GATE_DISMISSED_KEY, "true");
        setAuthState(session.user || null);
        sessionStorage.setItem(ENTRY_GATE_DISMISSED_KEY, "true");
        updateEntryGate();
        closeAuthModal();
        await initPresentationPersistence(true);
        openStartScreen?.();
        renderSlidesFromState?.();
        updateSlideCounter?.();
    } catch (err) {
        if (error) error.textContent = err.message || "Authentication failed";
    }
}

function closeUserMenu() {
    const menu = document.getElementById("auth-menu");
    if (!menu) return;
    menu.classList.add("hidden");
}

function toggleUserMenu() {
    const menu = document.getElementById("auth-menu");
    if (!menu) return;
    closeExportMenu();
    window.closeLayersPopover?.();
    menu.classList.toggle("hidden");
}

function toggleExportMenu() {
    const dd = document.getElementById("export-menu-dropdown");
    if (!dd) return;
    closeUserMenu();
    window.closeLayersPopover?.();
    dd.classList.toggle("show");
}

function closeExportMenu() {
    const dd = document.getElementById("export-menu-dropdown");
    if (dd) dd.classList.remove("show");
}

function bindUserMenu() {
    if (document.body.dataset.userMenuBound === "true") return;
    document.body.dataset.userMenuBound = "true";
    document.addEventListener("mousedown", event => {
        const menu = document.getElementById("auth-menu");
        const button = document.getElementById("auth-menu-button");
        if (!menu || menu.classList.contains("hidden")) return;
        if (menu.contains(event.target) || button?.contains(event.target)) return;
        closeUserMenu();
    });
    document.addEventListener("mousedown", event => {
        const dd = document.getElementById("export-menu-dropdown");
        const container = document.getElementById("export-menu-container");
        if (!dd || !dd.classList.contains("show")) return;
        if (container?.contains(event.target)) return;
        closeExportMenu();
    });
}

function updateAuthUi() {
    const authStatus = document.getElementById("auth-status");
    const authHeader = document.getElementById("auth-menu-header");
    const authPrimary = document.getElementById("auth-primary-btn");
    const authSecondary = document.getElementById("auth-secondary-btn");
    const authGlyph = document.getElementById("auth-user-glyph");
    const autosaveBadge = document.getElementById("autosave-status");

    if (authStatus) {
        authStatus.textContent = currentAuthUser ? currentAuthUser.username : "Guest";
    }

    if (authHeader) {
        authHeader.textContent = currentAuthUser ? `Signed in as ${currentAuthUser.username}` : "Not signed in";
    }

    if (authGlyph) {
        authGlyph.innerHTML = currentAuthUser
            ? `<span>${(currentAuthUser.username || "U").slice(0, 1).toUpperCase()}</span>`
            : `<i class="fa-regular fa-user"></i>`;
    }

    if (authPrimary) {
        if (!_backendApiAvailable) {
            authPrimary.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>Local mode</span>`;
            authPrimary.disabled = true;
        } else {
            authPrimary.disabled = false;
            authPrimary.innerHTML = currentAuthUser
                ? `<i class="fa-solid fa-folder-open"></i><span>Saved projects</span>`
                : `<i class="fa-solid fa-right-to-bracket"></i><span>Sign In</span>`;
            authPrimary.onclick = currentAuthUser
                ? () => {
                      closeUserMenu();
                      openProjectsModal();
                  }
                : () => openAuthModal("login");
        }
    }

    if (authSecondary) {
        if (!_backendApiAvailable) {
            authSecondary.innerHTML = `<i class="fa-solid fa-hard-drive"></i><span>Continue locally</span>`;
            authSecondary.disabled = false;
            authSecondary.onclick = () => {
                closeUserMenu();
                continueAsGuest();
            };
        } else {
            authSecondary.disabled = false;
            authSecondary.innerHTML = currentAuthUser
                ? `<i class="fa-solid fa-arrow-right-from-bracket"></i><span>Logout</span>`
                : `<i class="fa-solid fa-user-plus"></i><span>Register</span>`;
            authSecondary.onclick = currentAuthUser
                ? () => {
                      closeUserMenu();
                      logoutCurrentUser();
                  }
                : () => openAuthModal("register");
        }
    }

    if (autosaveBadge) {
        autosaveBadge.textContent = currentAuthUser ? "Autosave on" : "Local only";
    }
}

function setAuthState(user) {
    currentAuthUser = user || null;
    _authReady = true;
    updateAuthUi();
    updateEntryGate();
    updateProjectTitleUi();
}

const SAFE_ELEMENT_TYPES = new Set([
    "text",
    "image",
    "shape",
    "table",
    "connector",
    "video",
    "html",
    "pdf",
    "molecule",
    "chart",
    "equation",
    "latex",
    "sketch",
    "whiteboard",
    "mermaid",
]);
const SAFE_TEXT_TAGS = new Set([
    "A",
    "B",
    "BR",
    "DIV",
    "EM",
    "I",
    "LI",
    "MARK",
    "OL",
    "P",
    "S",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "U",
    "UL",
]);
const SAFE_TEXT_STYLE_PROPS = new Set([
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "text-align",
    "text-decoration",
    "text-decoration-line",
    "vertical-align",
    "list-style-type",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "line-height",
    "width",
]);
const SAFE_ELEMENT_STYLE_PROPS = new Set([
    "backgroundColor",
    "border",
    "borderColor",
    "borderRadius",
    "borderStyle",
    "borderWidth",
    "boxShadow",
    "color",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "fill",
    "letterSpacing",
    "lineHeight",
    "minHeight",
    "minWidth",
    "opacity",
    "padding",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "stroke",
    "text",
    "textAlign",
    "textDecoration",
    "textTransform",
    "textStrokeColor",
    "textStrokeWidth",
    "transform",
    "zIndex",
]);
const MAX_PRESENTATION_SLIDES = 250;
const MAX_ELEMENTS_PER_SLIDE = 300;
const MAX_TEXT_HTML_LENGTH = 20000;
const MAX_EMBED_HTML_LENGTH = 100000;
const MAX_MERMAID_SOURCE_LENGTH = 50000;
const MAX_MERMAID_SVG_LENGTH = 500000;

function _truncateStateString(value, maxLength) {
    return String(value ?? "").slice(0, maxLength);
}

function _isSafeAssetUrl(value, { allowData = false } = {}) {
    const url = String(value || "").trim();
    if (!url) return false;
    if (
        url.startsWith("/media/") ||
        url.startsWith("/static/") ||
        url.startsWith("assets/") ||
        url.startsWith("/assets/") ||
        url.startsWith("blob:")
    ) {
        return true;
    }
    if (allowData && /^data:(image|video|application\/pdf)\//i.test(url)) {
        return true;
    }
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_err) {
        return false;
    }
}

function _isSafeCssValue(value) {
    const str = String(value ?? "");
    return !/(?:expression\s*\(|javascript:|data:text\/html|url\s*\()/i.test(str);
}

function sanitizeTextHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = _truncateStateString(html, MAX_TEXT_HTML_LENGTH);

    Array.from(template.content.querySelectorAll("*")).forEach(node => {
        if (!SAFE_TEXT_TAGS.has(node.tagName)) {
            node.replaceWith(...Array.from(node.childNodes));
            return;
        }

        Array.from(node.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name === "style") return;
            if (name === "class") {
                // Whitelist FontAwesome and internal ppt-* classes
                const safeClasses = attr.value
                    .split(/\s+/)
                    .filter(cls => /^fa-/.test(cls) || /^fa[srltdbk]?$/.test(cls) || /^ppt-/.test(cls));
                if (safeClasses.length) {
                    node.setAttribute("class", safeClasses.join(" "));
                    return;
                }
            }
            if (name.startsWith("data-bullet") || name.startsWith("data-level")) return;
            // A link keeps a web or mail address only, and opens in a new tab.
            if (node.tagName === "A" && name === "href" && /^(https?:|mailto:)/i.test(attr.value.trim())) return;
            node.removeAttribute(attr.name);
        });
        if (node.tagName === "A") {
            if (node.hasAttribute("href")) {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
            } else {
                node.replaceWith(...Array.from(node.childNodes));
            }
        }

        if (node instanceof HTMLElement) {
            const kept = {};
            Array.from(node.style).forEach(prop => {
                const value = node.style.getPropertyValue(prop);
                if (SAFE_TEXT_STYLE_PROPS.has(prop) && _isSafeCssValue(value)) {
                    kept[prop] = value;
                }
            });
            node.removeAttribute("style");
            Object.entries(kept).forEach(([prop, value]) => node.style.setProperty(prop, value));
        }
    });

    return template.innerHTML;
}

function sanitizeIconClassValue(value) {
    const raw = String(value || "");
    const source = raw.includes("<") ? raw : raw.replace(/[^\w\s-]/g, " ");
    const classMatch =
        source.match(/class\s*=\s*["']([^"']+)["']/i) || source.match(/class\s*=\s*&quot;([^&]+)&quot;/i);
    const classSource = classMatch ? classMatch[1] : source;
    const safeClasses = classSource
        .split(/\s+/)
        .map(cls => cls.trim())
        .filter(cls => /^fa-/.test(cls) || /^fa[srltdbk]?$/.test(cls));
    return safeClasses.length ? safeClasses.join(" ") : "";
}

function sanitizeTextContentValue(content) {
    if (Array.isArray(content)) {
        return content.map(item => ({
            ...(item && typeof item === "object" ? item : {}),
            html: sanitizeTextHtml(item?.html ?? item?.text ?? ""),
            text: typeof item?.text === "string" ? _truncateStateString(item.text, MAX_TEXT_HTML_LENGTH) : undefined,
            level: Math.max(0, Math.min(8, Number(item?.level) || 0)),
        }));
    }
    return sanitizeTextHtml(content);
}

function sanitizeElementStyles(styles = {}) {
    if (!styles || typeof styles !== "object") return {};
    return Object.fromEntries(
        Object.entries(styles)
            .filter(([prop, value]) => SAFE_ELEMENT_STYLE_PROPS.has(prop) && _isSafeCssValue(value))
            .map(([prop, value]) => [prop, typeof value === "string" ? _truncateStateString(value, 256) : value]),
    );
}

function sanitizeElementContent(safeEl, fallbackType) {
    if (fallbackType === "text") {
        return sanitizeTextContentValue(safeEl.content);
    }
    if (fallbackType === "html") {
        return _truncateStateString(safeEl.content || "", MAX_EMBED_HTML_LENGTH);
    }
    if (fallbackType === "image" || fallbackType === "video" || fallbackType === "pdf") {
        const content = String(safeEl.content || "");
        return _isSafeAssetUrl(content, { allowData: true }) ? content : "";
    }
    if (fallbackType === "molecule") {
        const content = String(safeEl.content || "");
        if (typeof isMoleculeContentUrl === "function" && isMoleculeContentUrl(content)) {
            return _isSafeAssetUrl(content) ? content : "";
        }
        return _truncateStateString(content, 2000000);
    }
    if (fallbackType === "latex") {
        return _truncateStateString(safeEl.content || safeEl.latexSrc || "", 10000);
    }
    return typeof safeEl.content === "string" ? _truncateStateString(safeEl.content, 20000) : "";
}

function sanitizeMermaidSvgContent(svg) {
    let cleaned = _truncateStateString(svg || "", MAX_MERMAID_SVG_LENGTH);
    cleaned = cleaned.replace(/<\s*(script|foreignObject)\b[^>]*>.*?<\s*\/\s*\1\s*>/gis, "");
    cleaned = cleaned.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gis, "");
    cleaned = cleaned.replace(/\s+(href|xlink:href)\s*=\s*(['"])\s*(javascript:|data:text\/html).*?\2/gis, "");
    cleaned = cleaned.replace(/url\s*\(\s*(['"]?)\s*(javascript:|data:text\/html).*?\)/gis, "none");
    return cleaned.trim();
}

function normalizeMermaidTheme(theme) {
    return ["default", "neutral", "dark", "forest", "base"].includes(theme) ? theme : "default";
}

function normalizeMermaidType(type) {
    return [
        "flowchart",
        "sequenceDiagram",
        "stateDiagram-v2",
        "classDiagram",
        "erDiagram",
        "gantt",
        "journey",
        "mindmap",
    ].includes(type)
        ? type
        : "flowchart";
}

function normalizeMermaidStyle(style = {}) {
    const safe = style && typeof style === "object" ? style : {};
    const color = (value, fallback) => {
        const raw = String(value || "").trim();
        return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : fallback;
    };
    return {
        fontFamily: _truncateStateString(safe.fontFamily || "Inter, Arial, sans-serif", 120),
        fontSize: Math.max(10, Math.min(28, Number(safe.fontSize) || 16)),
        primaryColor: color(safe.primaryColor, "#eef2ff"),
        primaryTextColor: color(safe.primaryTextColor, "#0f172a"),
        lineColor: color(safe.lineColor, "#4f46e5"),
        backgroundColor: color(safe.backgroundColor, "#ffffff"),
        handDrawn: Boolean(safe.handDrawn),
    };
}

function normalizeMermaidGraphModel(graph = null) {
    if (!graph || typeof graph !== "object") return null;
    const safeNodes = Array.isArray(graph.nodes)
        ? graph.nodes.slice(0, 600).map((node, index) => ({
              id:
                  _truncateStateString(node?.id || `Node${index + 1}`, 80).replace(/[^\w-]/g, "_") ||
                  `Node${index + 1}`,
              label: _truncateStateString(node?.label || node?.id || `Node ${index + 1}`, 180),
              shape: [
                  "process",
                  "decision",
                  "database",
                  "cloud",
                  "actor",
                  "queue",
                  "hexagon",
                  "parallelogram",
                  "terminal",
                  "document",
                  "scientific",
              ].includes(node?.shape)
                  ? node.shape
                  : "process",
              x: Number.isFinite(Number(node?.x)) ? Math.round(Number(node.x)) : 48,
              y: Number.isFinite(Number(node?.y)) ? Math.round(Number(node.y)) : 48,
              width: Number.isFinite(Number(node?.width)) ? Math.max(48, Math.min(320, Number(node.width))) : 138,
              height: Number.isFinite(Number(node?.height)) ? Math.max(32, Math.min(220, Number(node.height))) : 58,
              locked: Boolean(node?.locked),
              style: sanitizeElementStyles(node?.style || {}),
          }))
        : [];
    const nodeIds = new Set(safeNodes.map(node => node.id));
    const safeEdges = Array.isArray(graph.edges)
        ? graph.edges
              .slice(0, 2500)
              .map((edge, index) => ({
                  id:
                      _truncateStateString(edge?.id || `edge_${index + 1}`, 120).replace(/[^\w-]/g, "_") ||
                      `edge_${index + 1}`,
                  from: _truncateStateString(edge?.from || "", 80).replace(/[^\w-]/g, "_"),
                  to: _truncateStateString(edge?.to || "", 80).replace(/[^\w-]/g, "_"),
                  label: _truncateStateString(edge?.label || "", 180),
                  arrow: ["arrow", "circle", "cross", "none"].includes(edge?.arrow) ? edge.arrow : "arrow",
                  routingStyle: edge?.routingStyle === "curved" ? "curved" : "orthogonal",
                  waypoints: Array.isArray(edge?.waypoints)
                      ? edge.waypoints.slice(0, 24).map(point => ({
                            x: Number.isFinite(Number(point?.x)) ? Math.round(Number(point.x)) : 0,
                            y: Number.isFinite(Number(point?.y)) ? Math.round(Number(point.y)) : 0,
                        }))
                      : [],
                  labelOffset: {
                      x: Number.isFinite(Number(edge?.labelOffset?.x)) ? Math.round(Number(edge.labelOffset.x)) : 0,
                      y: Number.isFinite(Number(edge?.labelOffset?.y)) ? Math.round(Number(edge.labelOffset.y)) : 0,
                  },
                  style: sanitizeElementStyles(edge?.style || {}),
              }))
              .filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))
        : [];
    return {
        version: 1,
        type: graph.type === "flowchart" ? "flowchart" : "flowchart",
        direction: ["TD", "TB", "BT", "LR", "RL"].includes(graph.direction) ? graph.direction : "TD",
        nodes: safeNodes,
        edges: safeEdges,
        groups: Array.isArray(graph.groups) ? graph.groups.slice(0, 100) : [],
        mermaidSource: _truncateStateString(graph.mermaidSource || "", MAX_MERMAID_SOURCE_LENGTH),
        layoutMetadata: graph.layoutMetadata && typeof graph.layoutMetadata === "object" ? graph.layoutMetadata : {},
        viewport: {
            x: Number.isFinite(Number(graph.viewport?.x)) ? Number(graph.viewport.x) : 0,
            y: Number.isFinite(Number(graph.viewport?.y)) ? Number(graph.viewport.y) : 0,
            zoom: Number.isFinite(Number(graph.viewport?.zoom))
                ? Math.max(0.1, Math.min(8, Number(graph.viewport.zoom)))
                : 1,
        },
        style: normalizeMermaidStyle(graph.style || {}),
        nodePositions: Object.fromEntries(safeNodes.map(node => [node.id, { x: node.x, y: node.y }])),
        lockedLayout: Boolean(graph.lockedLayout),
        autoLayout: graph.autoLayout !== false,
        routingStyle: graph.routingStyle === "curved" ? "curved" : "orthogonal",
        connectionStyle: ["arrow", "circle", "cross", "none"].includes(graph.connectionStyle)
            ? graph.connectionStyle
            : "arrow",
    };
}

// Ids are interpolated into markup and inline handlers; reject anything outside the generated charset.
function _isSafeStateId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(id);
}

function normalizeStateIds() {
    if (!state.presentationTheme || typeof state.presentationTheme !== "string") {
        state.presentationTheme = "editorial";
    }
    if (
        !state.presentationTransition ||
        typeof state.presentationTransition !== "string" ||
        !PRESENTATION_TRANSITION_EFFECTS.has(state.presentationTransition)
    ) {
        state.presentationTransition = "none";
    }
    ensurePresentationPageSetup(state);
    state.masterSlides = normalizeMasterSlidesState(state.masterSlides);

    const usedSlideIds = new Set();
    const usedElementIds = new Set();

    const legacyDeckTransition = state.presentationTransition;
    state.slides = (state.slides || []).slice(0, MAX_PRESENTATION_SLIDES).map(slide => {
        const safeSlide = slide || { elements: [] };
        const nextSlideId = _isSafeStateId(safeSlide.id) && !usedSlideIds.has(safeSlide.id) ? safeSlide.id : generateId("slide");
        usedSlideIds.add(nextSlideId);

        const nextElements = Array.isArray(safeSlide.elements)
            ? safeSlide.elements.slice(0, MAX_ELEMENTS_PER_SLIDE)
            : [];
        const normalizedElements = nextElements.map(el => {
            const safeEl = el || {};
            const nextElId = _isSafeStateId(safeEl.id) && !usedElementIds.has(safeEl.id) ? safeEl.id : generateId("el");
            usedElementIds.add(nextElId);

            const fallbackType = SAFE_ELEMENT_TYPES.has(safeEl.type) ? safeEl.type : "text";
            const fallbackStyles = {
                zIndex: 1,
                borderRadius: "0px",
                ...(fallbackType === "text"
                    ? {
                          color: "#172033",
                          fontSize: "32px",
                          fontFamily: '"Manrope", sans-serif',
                          backgroundColor: "transparent",
                          textAlign: "left",
                      }
                    : fallbackType === "table"
                      ? {
                            color: "#172033",
                            fontSize: "16px",
                            fontFamily: '"Manrope", sans-serif',
                            backgroundColor: "transparent",
                            textAlign: "left",
                        }
                      : {}),
                ...(fallbackType === "shape" ? { backgroundColor: "#6366f1" } : {}),
                ...(fallbackType === "connector"
                    ? {
                          color: "#2563eb",
                          backgroundColor: "transparent",
                          borderRadius: "0px",
                          strokeWidth: 4,
                      }
                    : {}),
            };

            const normalizedAnimation = normalizeElementAnimation(safeEl);
            // Preserve the original animation object if normalizeElementAnimation couldn't
            // process it but the raw data exists (e.g. advanced animation-engine configs)
            const preservedAnimation =
                normalizedAnimation ??
                (safeEl.animation && typeof safeEl.animation === "object" ? safeEl.animation : null);
            const normalizedIconClass =
                fallbackType === "text" && safeEl.iconMode
                    ? sanitizeIconClassValue(safeEl.iconClass || safeEl.content)
                    : "";
            return {
                ...safeEl,
                id: nextElId,
                type: fallbackType,
                animation: preservedAnimation,
                animDuration: undefined,
                animDelay: undefined,
                ...(fallbackType === "video"
                    ? {
                          videoType:
                              safeEl.videoType === "youtube" ||
                              safeEl.videoType === "vimeo" ||
                              safeEl.videoType === "local"
                                  ? safeEl.videoType
                                  : "direct",
                          muted: safeEl.muted ?? safeEl.mute ?? true,
                          autoplay: safeEl.autoplay ?? false,
                          loop: safeEl.loop ?? false,
                      }
                    : {}),
                ...(fallbackType === "html"
                    ? {
                          htmlInteractive: safeEl.htmlInteractive ?? true,
                          htmlMode: safeEl.htmlMode === "autofit" ? "autofit" : "responsive",
                      }
                    : {}),
                ...(fallbackType === "molecule"
                    ? {
                          moleculeName:
                              typeof safeEl.moleculeName === "string"
                                  ? _truncateStateString(safeEl.moleculeName, 240)
                                  : "Molecule",
                          moleculeFormat:
                              typeof normalizeMoleculeFormat === "function"
                                  ? normalizeMoleculeFormat(safeEl.moleculeFormat || "pdb")
                                  : "pdb",
                          moleculeIsTrajectory: Boolean(
                              safeEl.moleculeIsTrajectory ||
                              (typeof isMoleculeTrajectoryData === "function" &&
                                  !(
                                      typeof isMoleculeContentUrl === "function" && isMoleculeContentUrl(safeEl.content)
                                  ) &&
                                  isMoleculeTrajectoryData(safeEl.content)),
                          ),
                          moleculeSourceType:
                              typeof isMoleculeContentUrl === "function" && isMoleculeContentUrl(safeEl.content)
                                  ? "url"
                                  : "inline",
                          moleculeInteractive: safeEl.moleculeInteractive ?? true,
                          moleculeAutoRotate: Boolean(safeEl.moleculeAutoRotate),
                          moleculeProjection:
                              safeEl.moleculeProjection === "orthographic" ? "orthographic" : "perspective",
                          moleculeDefaultStyle: ["cartoon", "stick", "sphere", "line", "surface"].includes(
                              safeEl.moleculeDefaultStyle,
                          )
                              ? safeEl.moleculeDefaultStyle
                              : "cartoon",
                          moleculeDefaultColor: ["default", "chain", "amino", "ssJmol", "spectrum", "custom"].includes(
                              safeEl.moleculeDefaultColor,
                          )
                              ? safeEl.moleculeDefaultColor
                              : "spectrum",
                          moleculeRepresentationLayers:
                              typeof normalizeMoleculeRepresentationLayer === "function" &&
                              Array.isArray(safeEl.moleculeRepresentationLayers)
                                  ? safeEl.moleculeRepresentationLayers
                                        .map(normalizeMoleculeRepresentationLayer)
                                        .slice(0, 12)
                                  : [],
                          moleculeViewState:
                              typeof normalizeMoleculeViewState === "function"
                                  ? normalizeMoleculeViewState(safeEl.moleculeViewState)
                                  : null,
                      }
                    : {}),
                ...(fallbackType === "image"
                    ? {
                          lockAspectRatio: safeEl.lockAspectRatio ?? true,
                          imageAspectRatio: getImageAspectRatio(safeEl),
                      }
                    : {}),
                ...(fallbackType === "pdf"
                    ? {
                          pdfInteractive: safeEl.pdfInteractive ?? true,
                          pdfEditorMode:
                              safeEl.pdfEditorMode === "highlight" || safeEl.pdfEditorMode === "note"
                                  ? safeEl.pdfEditorMode
                                  : "navigate",
                          pdfAnnotations: Array.isArray(safeEl.pdfAnnotations) ? safeEl.pdfAnnotations : [],
                          pdfSelectedAnnotationId:
                              typeof safeEl.pdfSelectedAnnotationId === "string" ? safeEl.pdfSelectedAnnotationId : "",
                          localMimeType: safeEl.localMimeType || "application/pdf",
                      }
                    : {}),
                ...(fallbackType === "mermaid"
                    ? {
                          mermaidSource: _truncateStateString(
                              safeEl.mermaidSource || safeEl.content || "flowchart TD\n    A[Start] --> B[End]",
                              MAX_MERMAID_SOURCE_LENGTH,
                          ),
                          mermaidType: normalizeMermaidType(safeEl.mermaidType),
                          theme: normalizeMermaidTheme(safeEl.theme),
                          svgContent: sanitizeMermaidSvgContent(safeEl.svgContent || ""),
                          svgManualEdits: Boolean(safeEl.svgManualEdits),
                          editMode: ["visual", "code", "split"].includes(safeEl.editMode) ? safeEl.editMode : "split",
                          graphModel: normalizeMermaidGraphModel(safeEl.graphModel),
                          nodePositions:
                              safeEl.nodePositions && typeof safeEl.nodePositions === "object"
                                  ? Object.fromEntries(
                                        Object.entries(safeEl.nodePositions)
                                            .slice(0, 600)
                                            .map(([id, pos]) => [
                                                _truncateStateString(id, 80).replace(/[^\w-]/g, "_"),
                                                {
                                                    x: Number.isFinite(Number(pos?.x)) ? Math.round(Number(pos.x)) : 0,
                                                    y: Number.isFinite(Number(pos?.y)) ? Math.round(Number(pos.y)) : 0,
                                                },
                                            ]),
                                    )
                                  : {},
                          lockedLayout: Boolean(safeEl.lockedLayout),
                          autoLayout: safeEl.autoLayout !== false,
                          routingStyle: safeEl.routingStyle === "curved" ? "curved" : "orthogonal",
                          connectionStyle: ["arrow", "circle", "cross", "none"].includes(safeEl.connectionStyle)
                              ? safeEl.connectionStyle
                              : "arrow",
                          rotation: Number.isFinite(Number(safeEl.rotation)) ? Number(safeEl.rotation) : 0,
                          locked: Boolean(safeEl.locked),
                          opacity: Number.isFinite(Number(safeEl.opacity))
                              ? Math.max(0, Math.min(1, Number(safeEl.opacity)))
                              : 1,
                          style: normalizeMermaidStyle(safeEl.style),
                      }
                    : {}),
                ...(fallbackType === "text"
                    ? {
                          iconMode: Boolean(safeEl.iconMode),
                          iconClass: normalizedIconClass || undefined,
                          bulletStyle:
                              typeof safeEl.bulletStyle === "string" && safeEl.bulletStyle
                                  ? safeEl.bulletStyle
                                  : "default",
                          autoHeight: safeEl.textFitMode === "autofit" ? false : safeEl.autoHeight !== false,
                          textFitMode:
                              safeEl.textFitMode === "autofit"
                                  ? "autofit"
                                  : safeEl.textFitMode === "fixed" || safeEl.autoHeight === false
                                    ? "fixed"
                                    : "autoHeight",
                          minAutoFitFontSize: Number.isFinite(Number(safeEl.minAutoFitFontSize))
                              ? Math.max(6, Math.min(72, Number(safeEl.minAutoFitFontSize)))
                              : undefined,
                          textDocument:
                              typeof createTextDocumentFromLegacyContent === "function"
                                  ? createTextDocumentFromLegacyContent(
                                        safeEl.content !== undefined && safeEl.content !== null
                                            ? safeEl.content
                                            : safeEl.textDocument,
                                        {
                                        bulletStyle:
                                            typeof safeEl.bulletStyle === "string" && safeEl.bulletStyle
                                                ? safeEl.bulletStyle
                                                : "default",
                                        },
                                    )
                                  : safeEl.textDocument,
                          themeManaged: safeEl.themeManaged ?? true,
                      }
                    : fallbackType === "table"
                      ? {
                            tableData: normalizeTableData(safeEl.tableData),
                        }
                      : fallbackType === "shape"
                        ? {
                              arrowHeadSize:
                                  typeof safeEl.shapeType === "string" && safeEl.shapeType.startsWith("arrow-")
                                      ? Math.max(12, Math.min(80, Number(safeEl.arrowHeadSize) || 38))
                                      : safeEl.arrowHeadSize,
                              arrowShaftSize:
                                  typeof safeEl.shapeType === "string" && safeEl.shapeType.startsWith("arrow-")
                                      ? Math.max(12, Math.min(90, Number(safeEl.arrowShaftSize) || 36))
                                      : safeEl.arrowShaftSize,
                              themeManaged: safeEl.themeManaged ?? true,
                          }
                        : fallbackType === "connector"
                          ? {
                                connectorType:
                                    safeEl.connectorType === "curve" || safeEl.connectorType === "poly"
                                        ? safeEl.connectorType
                                        : "line",
                                connectorStart:
                                    typeof safeEl.connectorStart === "string" ? safeEl.connectorStart : "none",
                                connectorEnd: typeof safeEl.connectorEnd === "string" ? safeEl.connectorEnd : "arrow",
                                connectorHeadWidth: Number.isFinite(Number(safeEl.connectorHeadWidth))
                                    ? Math.max(4, Math.min(40, Number(safeEl.connectorHeadWidth)))
                                    : 14,
                                connectorHeadLength: Number.isFinite(Number(safeEl.connectorHeadLength))
                                    ? Math.max(4, Math.min(40, Number(safeEl.connectorHeadLength)))
                                    : 14,
                                points: Array.isArray(safeEl.points) ? safeEl.points : null,
                                themeManaged: safeEl.themeManaged ?? true,
                            }
                          : {}),
                // parseFloat also reads older "123px" positions instead of dropping them to the default.
                x: Number.isFinite(parseFloat(safeEl.x)) ? parseFloat(safeEl.x) : 100,
                y: Number.isFinite(parseFloat(safeEl.y)) ? parseFloat(safeEl.y) : 100,
                width:
                    safeEl.width ||
                    (fallbackType === "shape"
                        ? "150px"
                        : fallbackType === "connector"
                          ? "280px"
                          : fallbackType === "mermaid"
                            ? "560px"
                            : fallbackType === "table"
                              ? "520px"
                              : fallbackType === "image"
                                ? "300px"
                                : fallbackType === "pdf"
                                  ? "520px"
                                  : fallbackType === "html"
                                    ? "520px"
                                    : fallbackType === "molecule"
                                      ? "620px"
                                      : "auto"),
                height:
                    safeEl.height ||
                    (fallbackType === "shape"
                        ? "150px"
                        : fallbackType === "connector"
                          ? "140px"
                          : fallbackType === "mermaid"
                            ? "360px"
                            : fallbackType === "table"
                              ? "240px"
                              : fallbackType === "image"
                                ? "200px"
                                : fallbackType === "pdf"
                                  ? "360px"
                                  : fallbackType === "html"
                                    ? "320px"
                                    : fallbackType === "molecule"
                                      ? "420px"
                                      : "auto"),
                content:
                    fallbackType === "text" && safeEl.iconMode && normalizedIconClass
                        ? `<i class="${normalizedIconClass}"></i>`
                        : fallbackType === "text"
                          ? typeof normalizeTextElementContent === "function"
                              ? normalizeTextElementContent(sanitizeElementContent(safeEl, fallbackType))
                              : sanitizeElementContent(safeEl, fallbackType)
                          : typeof safeEl.content === "string"
                            ? sanitizeElementContent(safeEl, fallbackType)
                            : fallbackType === "image"
                              ? "https://picsum.photos/400/300"
                              : fallbackType === "html"
                                ? "<html><body style='font-family: sans-serif; padding: 16px;'>Embedded HTML</body></html>"
                                : fallbackType === "molecule" && typeof createDefaultMoleculeContent === "function"
                                  ? createDefaultMoleculeContent()
                                  : "",
                styles: (() => {
                    const rawStyles = safeEl.styles && typeof safeEl.styles === "object" ? safeEl.styles : null;
                    const normalizedStyles = { ...fallbackStyles, ...sanitizeElementStyles(rawStyles || {}) };
                    if (
                        (fallbackType === "text" || fallbackType === "table") &&
                        rawStyles &&
                        !Object.prototype.hasOwnProperty.call(rawStyles, "textAlign")
                    ) {
                        delete normalizedStyles.textAlign;
                    }
                    return normalizedStyles;
                })(),
            };
        });

        return {
            ...safeSlide,
            id: nextSlideId,
            layoutId:
                typeof safeSlide.layoutId === "string" && safeSlide.layoutId ? safeSlide.layoutId : "blank-titled",
            masterId: resolveSlideMasterId(safeSlide),
            notes: typeof safeSlide.notes === "string" ? _truncateStateString(safeSlide.notes, 20000) : "",
            presentationTransition:
                typeof safeSlide.presentationTransition === "string" &&
                PRESENTATION_TRANSITION_EFFECTS.has(safeSlide.presentationTransition)
                    ? safeSlide.presentationTransition
                    : legacyDeckTransition,
            background: normalizeSlideBackground(safeSlide.background),
            elements: normalizedElements,
        };
    });

    if (!state.slides.length) {
        state.slides = [
            {
                id: generateId("slide"),
                layoutId: "blank-titled",
                masterId: "content",
                notes: "",
                presentationTransition: "none",
                background: null,
                elements: [],
            },
        ];
    }

    if (currentSlideIndex > state.slides.length - 1) {
        currentSlideIndex = state.slides.length - 1;
    }
    if (currentSlideIndex < 0) {
        currentSlideIndex = 0;
    }

    const currentElements = state.slides[currentSlideIndex]?.elements || [];
    const validSelected = new Set(
        currentElements
            .filter(el => !isPresetBackgroundElement(el))
            .map(el => el.id),
    );
    state.selectedIds = (state.selectedIds || []).filter(id => validSelected.has(id));
}

function setCurrentSlideIndex(index) {
    const changed = currentSlideIndex !== index;
    currentSlideIndex = index;
    if (changed && typeof window !== "undefined" && typeof window.refreshTimelineForSlide === "function") {
        requestAnimationFrame(() => window.refreshTimelineForSlide());
    }
}

function setSelectedIds(ids) {
    const asArray = Array.isArray(ids) ? ids : [ids];
    const slideElements = state.slides[currentSlideIndex]?.elements || [];
    const selectableIds = new Set(
        slideElements
            .filter(el => !isPresetBackgroundElement(el))
            .map(el => el.id),
    );
    state.selectedIds = Array.from(new Set(asArray.filter(id => id && selectableIds.has(id))));
}

function _serializeEditorSnapshot() {
    // Exclude `textDocument` from snapshots — it is a derived/computed field
    // built from `content` at render time via ensureElementTextDocument().
    // Serialising it causes stale textDocument values to survive undo/redo and
    // then corrupt other text elements when they are re-rendered from the snapshot.
    const stateForSnapshot = {
        ...state,
        slides: (state.slides || []).map(slide => ({
            ...slide,
            elements: (slide.elements || []).map(el => {
                if (el.type !== "text") return el;
                // Omit textDocument; renderer will rebuild it from `content`.
                const { textDocument: _td, ...rest } = el;
                return rest;
            }),
        })),
    };
    return JSON.stringify({
        state: stateForSnapshot,
        currentSlideIndex,
    });
}

function _restoreEditorSnapshot(rawSnapshot) {
    try {
        const parsed = JSON.parse(rawSnapshot);
        if (parsed && typeof parsed === "object" && parsed.state && Array.isArray(parsed.state.slides)) {
            state = parsed.state;
            // Defensively drop any stale textDocument so the renderer always
            // regenerates it fresh from `content` on the next render pass.
            (state.slides || []).forEach(slide => {
                (slide.elements || []).forEach(el => {
                    if (el.type === "text") delete el.textDocument;
                });
            });
            currentSlideIndex = Number.isInteger(parsed.currentSlideIndex) ? parsed.currentSlideIndex : currentSlideIndex;
            return true;
        }
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.slides)) {
            state = parsed;
            (state.slides || []).forEach(slide => {
                (slide.elements || []).forEach(el => {
                    if (el.type === "text") delete el.textDocument;
                });
            });
            return true;
        }
    } catch (err) {
        console.warn("Failed to restore editor snapshot:", err);
    }
    return false;
}

function saveStateToUndo() {
    undoStack.push(_serializeEditorSnapshot());
    if (undoStack.length > 30) undoStack.shift();
    redoStack = [];
}

// Undo history belongs to one project: never let Ctrl+Z restore another deck's slides into this one.
function resetUndoHistory() {
    undoStack = [];
    redoStack = [];
}

function restoreUndoState() {
    if (undoStack.length > 0) {
        redoStack.push(_serializeEditorSnapshot());
        if (redoStack.length > 30) redoStack.shift();
        return _restoreEditorSnapshot(undoStack.pop());
    }
    return false;
}

function restoreRedoState() {
    if (redoStack.length > 0) {
        undoStack.push(_serializeEditorSnapshot());
        if (undoStack.length > 30) undoStack.shift();
        return _restoreEditorSnapshot(redoStack.pop());
    }
    return false;
}

function updateElementState(id, updates) {
    const slide = state.slides?.[currentSlideIndex];
    if (!slide) return;
    const el = slide.elements?.find(e => e.id === id);
    if (el) Object.assign(el, updates);
}

function updateElementStyleState(id, styleUpdates) {
    const slide = state.slides?.[currentSlideIndex];
    if (!slide) return;
    const el = slide.elements?.find(e => e.id === id);
    if (!el) return;
    if (!el.styles) el.styles = {};
    Object.assign(el.styles, styleUpdates);
}

function getNextZIndex() {
    const activeIndex = currentSlideIndex;
    if (!state || !state.slides || !state.slides[activeIndex]) return 1;
    const elements = state.slides[activeIndex].elements || [];
    const maxZ = elements.reduce((m, el) => Math.max(m, Number(el.styles?.zIndex) || 0), 0);
    return maxZ + 1;
}

function getPersistableState() {
    normalizeStateIds();
    return {
        presentationTheme: state.presentationTheme,
        presentationTransition: state.presentationTransition,
        pageSetup: getPresentationPageSetupId(state),
        masterSlides: JSON.parse(JSON.stringify(state.masterSlides || normalizeMasterSlidesState())),
        slides: JSON.parse(JSON.stringify(state.slides || [])),
        selectedIds: [],
        clipboard: null,
    };
}

function getPersistableFingerprint() {
    return JSON.stringify(getPersistableState());
}

function saveLocalPresentationNow() {
    if (isPresentationHydrating()) return false;
    const payload = {
        title: _inferPresentationTitle(),
        presentationTheme: state.presentationTheme,
        state: getPersistableState(),
        savedAt: new Date().toISOString(),
    };
    try {
        localStorage.setItem(LOCAL_PRESENTATION_STORAGE_KEY, JSON.stringify(payload));
        setProjectSaveHint("Saved locally", "success");
        return true;
    } catch (err) {
        console.warn("Local save failed:", err);
        setProjectSaveHint("Local save failed", "danger");
        return false;
    }
}

function loadLocalPresentation() {
    const raw = localStorage.getItem(LOCAL_PRESENTATION_STORAGE_KEY);
    if (!raw) return false;
    try {
        const loaded = JSON.parse(raw);
        const loadedState = loaded?.state;
        if (!loadedState || !Array.isArray(loadedState.slides) || !loadedState.slides.length) return false;
        state = loadedState;
        state.presentationTheme = state.presentationTheme || loaded.presentationTheme || "editorial";
        normalizeStateIds();
        syncPresentationThemeFromState?.({ persist: false });
        setCurrentPresentationTitle(loaded.title || "Untitled Presentation");
        resetUndoHistory();
        setProjectSaveHint("Loaded local project", "success");
        return true;
    } catch (err) {
        console.warn("Local project could not be loaded:", err);
        localStorage.removeItem(LOCAL_PRESENTATION_STORAGE_KEY);
        return false;
    }
}

function setPresentationHydrating(value) {
    _presentationHydrating = Boolean(value);
}

function isPresentationHydrating() {
    return _presentationHydrating;
}

function _getCsrfToken() {
    const cookie = document.cookie
        .split(";")
        .map(part => part.trim())
        .find(part => part.startsWith("csrftoken="));
    return cookie ? decodeURIComponent(cookie.split("=", 2)[1] || "") : "";
}

async function _apiFetch(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData) && !("Content-Type" in headers)) {
        headers["Content-Type"] = "application/json";
    }
    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
        const csrfToken = _getCsrfToken();
        if (csrfToken) {
            headers["X-CSRFToken"] = csrfToken;
        }
    }
    return fetch(path, {
        credentials: "same-origin",
        ...options,
        method,
        headers,
    });
}

async function _presentationRequest(path, options = {}) {
    let response;
    try {
        response = await _apiFetch(path, options);
    } catch (err) {
        markBackendUnavailable(`Presentation API request failed: ${err.message || err}`);
        throw err;
    }
    if (response.status === 401) {
        setAuthState(null);
        _presentationPersistenceEnabled = false;
        openAuthModal("login");
        throw new Error("401 Unauthorized");
    }
    if (response.status === 404) {
        markBackendUnavailable(`Presentation API endpoint not found: ${path}`);
    }
    if (!response.ok) {
        let payload = {};
        try {
            payload = await response.json();
        } catch (_err) {}
        const err = new Error(payload.error || `${response.status} ${response.statusText}`);
        err.status = response.status;
        err.payload = payload;
        throw err;
    }
    return response.json();
}

async function _authRequest(path, options = {}) {
    let response;
    try {
        response = await _apiFetch(path, options);
    } catch (err) {
        markBackendUnavailable(`Auth API request failed: ${err.message || err}`);
        throw err;
    }
    let payload = {};
    try {
        payload = await response.json();
    } catch (_err) {}
    if (response.status === 404) {
        markBackendUnavailable(`Auth API endpoint not found: ${path}`);
    }
    if (!response.ok) {
        throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    return payload;
}

async function refreshAuthSession() {
    const session = await _authRequest("/api/auth/session/", { method: "GET" });
    setAuthState(session.user || null);
    return session;
}

function switchAuthMode(mode = "login") {
    currentAuthMode = mode === "register" ? "register" : "login";
    const title = document.getElementById("auth-modal-title");
    const submit = document.getElementById("auth-submit-btn");
    const toggle = document.getElementById("auth-toggle-btn");
    const subtitle = document.getElementById("auth-modal-subtitle");
    const error = document.getElementById("auth-error");
    if (title) title.textContent = currentAuthMode === "register" ? "Create account" : "Sign in";
    if (submit) submit.textContent = currentAuthMode === "register" ? "Create account" : "Sign in";
    if (toggle) toggle.textContent = currentAuthMode === "register" ? "Use existing account" : "Create account";
    if (subtitle)
        subtitle.textContent =
            currentAuthMode === "register"
                ? "Create a user to enable autosave."
                : "Sign in to load and save presentations.";
    if (error) error.textContent = "";
}

function toggleAuthMode() {
    switchAuthMode(currentAuthMode === "login" ? "register" : "login");
}

function openAuthModal(mode = "login") {
    if (accountsDisabled()) {
        setProjectSaveHint("Local server not ready yet. Try again in a moment.", "warn");
        return;
    }
    if (!_backendApiAvailable) {
        closeUserMenu();
        setProjectSaveHint("Account features unavailable in local mode", "warn");
        return;
    }
    const modal = document.getElementById("auth-modal");
    closeUserMenu();
    switchAuthMode(mode);
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}

function closeAuthModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

async function submitAuthForm(event) {
    if (event) event.preventDefault();
    const username = document.getElementById("auth-username")?.value?.trim() || "";
    const password = document.getElementById("auth-password")?.value || "";
    const error = document.getElementById("auth-error");
    if (error) error.textContent = "";

    try {
        const path = currentAuthMode === "register" ? "/api/auth/register/" : "/api/auth/login/";
        const session = await _authRequest(path, {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        setAuthState(session.user || null);
        closeAuthModal();
        await initPresentationPersistence(true);
        openStartScreen?.();
        renderSlidesFromState?.();
    } catch (err) {
        if (error) error.textContent = err.message || "Authentication failed";
    }
}

async function logoutCurrentUser() {
    await _authRequest("/api/auth/logout/", { method: "POST" });
    closeStartScreen?.({ force: true });
    sessionStorage.removeItem(ENTRY_GATE_DISMISSED_KEY);
    setAuthState(null);
    currentPresentationId = null;
    currentPresentationAutosaveVersion = 0;
    _presentationPersistenceEnabled = false;
    _presentationPersistenceReady = true;
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    setProjectSaveHint("Sign in to save projects", "warn");
    clearSelection?.();
}

function requireAuthenticatedAction(action, mode = "login") {
    if (currentAuthUser) {
        action();
        return true;
    }
    openAuthModal(mode);
    return false;
}

function _inferPresentationTitle() {
    if (currentPresentationTitle && currentPresentationTitle !== "Untitled Presentation") {
        return currentPresentationTitle;
    }
    const firstSlide = (state.slides || [])[0];
    const firstText = (firstSlide?.elements || []).find(el => el.type === "text");
    if (typeof firstText?.content === "string") {
        const text = parseTextFromHtml(firstText.content).split("\n")[0].trim();
        if (text) return text.slice(0, 255);
    }
    return "Untitled Presentation";
}

function setCurrentPresentationTitle(title) {
    currentPresentationTitle = (title || "").trim() || "Untitled Presentation";
    updateProjectTitleUi();
}

async function createPresentationRecord() {
    if (typeof syncMoleculeViewStatesFromDom === "function") {
        await syncMoleculeViewStatesFromDom();
    }
    const payload = {
        title: _inferPresentationTitle(),
        presentationTheme: state.presentationTheme,
        state: getPersistableState(),
    };
    const created = await _presentationRequest("/api/presentations/", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    currentPresentationId = created.id;
    currentPresentationAutosaveVersion = created.autosaveVersion || 1;
    setCurrentPresentationTitle(created.title || payload.title);
    localStorage.setItem(PRESENTATION_STORAGE_KEY, currentPresentationId);
    _lastPersistedFingerprint = JSON.stringify(created.state || payload.state);
    setProjectSaveHint("Project saved", "success");
    return created;
}

async function loadPresentationRecord(presentationId) {
    const loaded = await _presentationRequest(`/api/presentations/${presentationId}/`, { method: "GET" });
    currentPresentationId = loaded.id;
    currentPresentationAutosaveVersion = loaded.autosaveVersion || 1;
    setCurrentPresentationTitle(loaded.title || "Untitled Presentation");
    const hasSlides = loaded.state && Array.isArray(loaded.state.slides) && loaded.state.slides.length > 0;
    if (hasSlides) {
        state = loaded.state;
        state.presentationTheme = state.presentationTheme || loaded.presentationTheme || "editorial";
    } else if (
        loaded.bridgeResult &&
        typeof _looksLikeBridgeExport === "function" &&
        _looksLikeBridgeExport(loaded.bridgeResult) &&
        typeof _convertBridgeExportToEditorState === "function"
    ) {
        state = _convertBridgeExportToEditorState(loaded.bridgeResult);
        state.presentationTheme = state.presentationTheme || loaded.presentationTheme || "editorial";
    }
    const recovered = _takeUnsavedBackup(loaded.id, loaded.autosaveVersion || 1);
    if (recovered) {
        state = recovered.state;
        _pendingRecoverySave = true;
    }
    resetUndoHistory();
    normalizeStateIds();
    syncPresentationThemeFromState?.({ persist: false });
    localStorage.setItem(PRESENTATION_STORAGE_KEY, currentPresentationId);
    _lastPersistedFingerprint = JSON.stringify(hasSlides ? loaded.state : getPersistableState());
    setProjectSaveHint(recovered ? "Recovered unsaved changes" : "All changes saved", recovered ? "warn" : "success");
    return loaded;
}

async function initPresentationPersistence(force = false) {
    if (_presentationPersistenceReady && !force) return true;
    if (!_backendApiAvailable) {
        _presentationPersistenceEnabled = false;
        _presentationPersistenceReady = true;
        loadLocalPresentation();
        return false;
    }
    if (!_authReady && !_getCsrfToken()) {
        markBackendUnavailable("Backend API unavailable: no CSRF cookie on initial page load");
        loadLocalPresentation();
        return false;
    }
    setPresentationHydrating(true);
    try {
        const session = _authReady ? { user: currentAuthUser } : await refreshAuthSession();
        if (!session.user) {
            _presentationPersistenceEnabled = false;
            _presentationPersistenceReady = true;
            localStorage.removeItem(PRESENTATION_STORAGE_KEY);
            loadLocalPresentation();
            if (!localStorage.getItem(LOCAL_PRESENTATION_STORAGE_KEY)) {
                setProjectSaveHint("Local autosave on", "success");
            }
            return false;
        }
        // Reopen the last project if there is one. Otherwise wait: the start screen lets the user pick or create
        // a project, and the first edit creates one (see _ensurePresentationRecord), so opening the editor no
        // longer leaves an empty "Untitled" project behind.
        const storedId = localStorage.getItem(PRESENTATION_STORAGE_KEY);
        if (storedId) {
            try {
                await loadPresentationRecord(storedId);
            } catch (err) {
                console.warn("Stored presentation could not be loaded:", err);
                localStorage.removeItem(PRESENTATION_STORAGE_KEY);
            }
        }
        _presentationPersistenceReady = true;
        _presentationPersistenceEnabled = true;
        return true;
    } catch (err) {
        console.warn("Presentation persistence unavailable:", err);
        _presentationPersistenceEnabled = false;
        _presentationPersistenceReady = true;
        loadLocalPresentation();
        if (_backendApiAvailable && !localStorage.getItem(LOCAL_PRESENTATION_STORAGE_KEY)) {
            setProjectSaveHint("Sign in to save projects", "warn");
        }
        return false;
    } finally {
        setPresentationHydrating(false);
        _saveRecoveredChanges();
    }
}

async function autosavePresentationNow() {
    if (
        !_presentationPersistenceEnabled ||
        !_presentationPersistenceReady ||
        !currentPresentationId ||
        isPresentationHydrating()
    ) {
        return false;
    }
    // A save belongs to the project it started for; if the user opens another project meanwhile, drop it.
    const presentationId = currentPresentationId;
    const stillCurrent = () => currentPresentationId === presentationId && !isPresentationHydrating();
    if (typeof syncMoleculeViewStatesFromDom === "function") {
        await syncMoleculeViewStatesFromDom();
    }
    if (!stillCurrent()) return false;
    const fingerprint = getPersistableFingerprint();
    if (fingerprint === _lastPersistedFingerprint) {
        setProjectSaveHint("All changes saved", "success");
        return false;
    }

    const payload = {
        title: _inferPresentationTitle(),
        presentationTheme: state.presentationTheme,
        state: getPersistableState(),
        autosaveVersion: currentPresentationAutosaveVersion,
    };
    let saved;
    try {
        saved = await _presentationRequest(`/api/presentations/${presentationId}/`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        if (!stillCurrent()) return false;
        if (err?.status === 409) {
            currentPresentationAutosaveVersion =
                err.payload?.autosaveVersion || currentPresentationAutosaveVersion;
            setProjectSaveHint("Save conflict. Reload project before saving.", "danger");
        }
        throw err;
    }
    if (!stillCurrent()) return false;
    currentPresentationAutosaveVersion = saved.autosaveVersion || currentPresentationAutosaveVersion;
    setCurrentPresentationTitle(payload.title);
    _lastPersistedFingerprint = fingerprint;
    _clearUnsavedBackup(presentationId);
    setProjectSaveHint("All changes saved", "success");
    window.dispatchEvent(new CustomEvent("slideforge:presentation-saved", { detail: { id: presentationId } }));
    return true;
}

function schedulePresentationAutosave(delay = 1200) {
    if (!_backendApiAvailable || !_presentationPersistenceEnabled) {
        setProjectSaveHint("Unsaved local changes", "warn");
        clearTimeout(_autosaveTimer);
        _autosaveTimer = setTimeout(() => saveLocalPresentationNow(), Math.min(delay, 300));
        return;
    }
    if (!_presentationPersistenceEnabled || !_presentationPersistenceReady || isPresentationHydrating()) {
        return;
    }
    setProjectSaveHint("Unsaved changes", "warn");
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
        // Renders schedule saves too; while the start screen is open with nothing chosen there is nothing to save.
        if (!currentPresentationId && window.isStartScreenOpen?.()) return;
        _ensurePresentationRecord()
            .then(created => (created ? true : autosavePresentationNow()))
            .catch(err => {
                console.warn("Autosave failed:", err);
                setProjectSaveHint("Save failed", "danger");
            });
    }, delay);
}

function _takeUnsavedBackup(presentationId, serverVersion) {
    let backup = null;
    try {
        backup = JSON.parse(localStorage.getItem(UNSAVED_BACKUP_STORAGE_KEY) || "null");
    } catch (_err) {
        backup = null;
    }
    if (!backup || backup.presentationId !== presentationId) return null;
    localStorage.removeItem(UNSAVED_BACKUP_STORAGE_KEY);
    // Same version as when the backup was taken: the server never received those edits.
    const usable = backup.autosaveVersion === serverVersion && Array.isArray(backup.state?.slides) && backup.state.slides.length;
    return usable ? backup : null;
}

function _clearUnsavedBackup(presentationId) {
    try {
        const backup = JSON.parse(localStorage.getItem(UNSAVED_BACKUP_STORAGE_KEY) || "null");
        if (backup?.presentationId === presentationId) localStorage.removeItem(UNSAVED_BACKUP_STORAGE_KEY);
    } catch (_err) {
        localStorage.removeItem(UNSAVED_BACKUP_STORAGE_KEY);
    }
}

function _saveRecoveredChanges() {
    if (!_pendingRecoverySave) return;
    _pendingRecoverySave = false;
    schedulePresentationAutosave(300);
}

// Autosave is debounced, so closing the page right after an edit would lose it. Keep a local backup (recovered on
// the next load if the server never got it) and try one last save that survives the page closing.
function flushUnsavedChangesOnExit() {
    if (isPresentationHydrating()) return;
    if (!_backendApiAvailable || !_presentationPersistenceEnabled) {
        saveLocalPresentationNow();
        return;
    }
    if (!_presentationPersistenceReady || !currentPresentationId) return;
    if (getPersistableFingerprint() === _lastPersistedFingerprint) return;
    clearTimeout(_autosaveTimer);
    const payload = {
        title: _inferPresentationTitle(),
        presentationTheme: state.presentationTheme,
        state: getPersistableState(),
        autosaveVersion: currentPresentationAutosaveVersion,
    };
    try {
        localStorage.setItem(
            UNSAVED_BACKUP_STORAGE_KEY,
            JSON.stringify({ ...payload, presentationId: currentPresentationId, savedAt: new Date().toISOString() }),
        );
    } catch (err) {
        console.warn("Could not keep a backup of unsaved changes:", err);
    }
    // keepalive requests are limited to 64 KB; larger decks rely on the backup above.
    _apiFetch(`/api/presentations/${currentPresentationId}/`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => {});
}

window.addEventListener("pagehide", flushUnsavedChangesOnExit);

function adoptPresentationRecord(presentationId, title = null, autosaveVersion = 1) {
    if (!presentationId) return;
    currentPresentationId = presentationId;
    currentPresentationAutosaveVersion = autosaveVersion || 1;
    if (title) setCurrentPresentationTitle(title);
    localStorage.setItem(PRESENTATION_STORAGE_KEY, currentPresentationId);
    _lastPersistedFingerprint = "";
}

// Editing before any project exists (nothing picked on the start screen yet) creates one, so no edit is unsaved.
let _creatingPresentationRecord = null;
function _ensurePresentationRecord() {
    if (currentPresentationId) return Promise.resolve(false);
    if (!_creatingPresentationRecord) {
        _creatingPresentationRecord = createPresentationRecord()
            .then(() => true)
            .finally(() => {
                _creatingPresentationRecord = null;
            });
    }
    return _creatingPresentationRecord;
}

async function saveCurrentProject() {
    if (!_backendApiAvailable) {
        return saveLocalPresentationNow();
    }
    if (!currentAuthUser) {
        return saveLocalPresentationNow();
    }
    if (!currentPresentationId) {
        await createPresentationRecord();
        setProjectSaveHint("Project saved", "success");
        return true;
    }
    const saved = await autosavePresentationNow();
    if (!saved) {
        setProjectSaveHint("All changes saved", "success");
    }
    return true;
}

async function createNewProject() {
    if (!_backendApiAvailable) {
        saveStateToUndo();
        clearTimeout(_autosaveTimer);
        state = buildDefaultPresentationState();
        normalizeStateIds();
        syncPresentationThemeFromState?.({ persist: false });
        syncPresentationPageSetup?.();
        currentSlideIndex = 0;
        setCurrentPresentationTitle("Untitled Presentation");
        localStorage.removeItem(LOCAL_PRESENTATION_STORAGE_KEY);
        saveLocalPresentationNow();
        setProjectSaveHint("New local project", "muted");
        renderSlidesFromState?.();
        updateSlideCounter?.();
        return true;
    }
    if (!currentAuthUser) {
        openAuthModal("login");
        return false;
    }
    clearTimeout(_autosaveTimer);
    state = buildDefaultPresentationState();
    resetUndoHistory();
    normalizeStateIds();
    syncPresentationThemeFromState?.({ persist: false });
    syncPresentationPageSetup?.();
    currentSlideIndex = 0;
    currentPresentationId = null;
    currentPresentationAutosaveVersion = 0;
    setCurrentPresentationTitle("Untitled Presentation");
    setProjectSaveHint("New project created", "muted");
    _lastPersistedFingerprint = "";
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    await createPresentationRecord();
    applyPresentationTheme(state.presentationTheme, { persist: false });
    renderSlidesFromState?.();
    updateSlideCounter?.();
    return true;
}

async function loadProjectById(presentationId) {
    if (!_backendApiAvailable) return false;
    if (!presentationId) return false;
    if (!currentAuthUser) {
        openAuthModal("login");
        return false;
    }
    clearTimeout(_autosaveTimer);
    setPresentationHydrating(true);
    try {
        await loadPresentationRecord(presentationId);
        normalizeStateIds();
        if (typeof migrateInlineVideoAssets === "function") {
            try {
                await migrateInlineVideoAssets();
            } catch (err) {
                console.warn("Inline video migration failed:", err);
            }
        }
        currentSlideIndex = 0;
        applyPresentationTheme(state.presentationTheme, { persist: false });
        syncPresentationPageSetup?.();
        renderSlidesFromState?.();
        updateSlideCounter?.();
        return true;
    } finally {
        setPresentationHydrating(false);
        _saveRecoveredChanges();
    }
}

async function duplicateCurrentStateToNewProject(title = null) {
    if (!_backendApiAvailable) return false;
    if (!currentAuthUser) {
        openAuthModal("login");
        return false;
    }
    currentPresentationId = null;
    currentPresentationAutosaveVersion = 0;
    setCurrentPresentationTitle(title || _inferPresentationTitle());
    _lastPersistedFingerprint = "";
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    await createPresentationRecord();
    return true;
}

function bindProjectTitleInput() {
    const input = document.getElementById("project-title-input");
    if (!input || input.dataset.bound === "true") return;
    input.dataset.bound = "true";
    updateProjectTitleUi();

    const commitTitle = () => {
        const nextTitle = (input.value || "").trim() || "Untitled Presentation";
        if (nextTitle === currentPresentationTitle) {
            input.value = currentPresentationTitle;
            return;
        }
        setCurrentPresentationTitle(nextTitle);
        setProjectSaveHint("Unsaved changes", "warn");
        schedulePresentationAutosave(150);
    };

    input.addEventListener("input", () => {
        currentPresentationTitle = (input.value || "").trim() || "Untitled Presentation";
        setProjectSaveHint("Editing title…", "muted");
    });
    input.addEventListener("change", commitTitle);
    input.addEventListener("blur", commitTitle);
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
        }
    });
}

async function listSavedProjects() {
    const payload = await _presentationRequest("/api/presentations/", { method: "GET" });
    return payload.presentations || [];
}

async function openProjectsModal() {
    if (!_backendApiAvailable) {
        closeUserMenu();
        setProjectSaveHint("Saved projects unavailable in local mode", "warn");
        return;
    }
    if (!currentAuthUser) {
        openAuthModal("login");
        return;
    }
    closeUserMenu();
    const modal = document.getElementById("projects-modal");
    const list = document.getElementById("projects-list");
    const status = document.getElementById("projects-status");
    if (!modal || !list || !status) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    status.textContent = "Loading projects…";
    list.innerHTML = "";
    try {
        const projects = await listSavedProjects();
        status.textContent = projects.length ? "" : "No saved projects yet.";
        list.innerHTML = projects
            .map(
                project => `
                    <button type="button" class="w-full text-left border border-border rounded-xl px-4 py-3 hover:bg-surface transition-colors" data-project-id="${escapeHtml(String(project.id))}">
                        <div class="text-sm font-semibold text-text-main">${escapeHtml(project.title || "Untitled Presentation")}</div>
                        <div class="text-xs text-text-sub mt-1">Updated ${new Date(project.updatedAt).toLocaleString()}</div>
                    </button>
                `,
            )
            .join("");
        list.querySelectorAll("[data-project-id]").forEach(btn => {
            btn.onclick = async () => {
                await loadProjectById(btn.dataset.projectId);
                closeProjectsModal();
            };
        });
    } catch (err) {
        status.textContent = `Failed to load projects: ${err.message}`;
    }
}

function closeProjectsModal() {
    const modal = document.getElementById("projects-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}
