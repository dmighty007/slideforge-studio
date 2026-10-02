// Commands: copy/paste within the editor and with the system clipboard.

// ─── Clipboard ───────────────────────────────────────────────────────────────

let _clipboard = {
    elements: [],
};

function _cloneSelectedElements() {
    const activeIndex = ensureActiveSlideSync();
    if (!state.selectedIds.length) return [];
    return state.selectedIds
        .map(id => {
            const el = state.slides[activeIndex].elements.find(e => e.id === id);
            return JSON.parse(JSON.stringify(el));
        })
        .filter(Boolean);
}

function copyElement(clipboardEvent = null) {
    const selectedElements = _cloneSelectedElements();
    if (!selectedElements.length) return;
    _clipboard = { elements: selectedElements };

    if (clipboardEvent?.clipboardData) {
        clipboardEvent.preventDefault();
        clipboardEvent.clipboardData.setData(
            "application/x-slideforge-elements",
            JSON.stringify({ elements: selectedElements }),
        );
        const textSummary = selectedElements
            .map(el =>
                el.type === "text" ? String(parseTextFromHtml?.(el.content) || el.content || "") : `[${el.type}]`,
            )
            .filter(Boolean)
            .join("\n");
        clipboardEvent.clipboardData.setData("text/plain", textSummary || "[SlideForge elements]");
    }

    _copySelectionToSystemClipboard(selectedElements).catch(err => {
        console.warn("System clipboard write failed:", err);
    });
}

async function copySelectionToClipboard() {
    const selectedElements = _cloneSelectedElements();
    if (!selectedElements.length) {
        setProjectSaveHint?.("Select a text or image element first", "warn");
        return false;
    }
    _clipboard = { elements: selectedElements };
    try {
        await _copySelectionToSystemClipboard(selectedElements);
        return true;
    } catch (err) {
        console.warn("Explicit clipboard copy failed:", err);
        setProjectSaveHint?.("Clipboard copy was blocked by the browser", "danger");
        return false;
    }
}

function _normalizeClipboardPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.elements)) return payload.elements;
    return [];
}

function _escapeClipboardText(text) {
    const node = document.createElement("div");
    node.textContent = String(text || "");
    return node.innerHTML.replace(/\n/g, "<br>");
}

function _createClipboardTextElement(text, x = 100, y = 100) {
    const theme = getPresentationTheme();
    return {
        id: generateId("el"),
        type: "text",
        x,
        y,
        width: "420px",
        height: "auto",
        autoHeight: true,
        textFitMode: "autoHeight",
        content: _escapeClipboardText(text),
        styles: {
            color: theme.defaultTextColor,
            fontSize: "28px",
            fontFamily: theme.bodyFont,
            textAlign: "left",
            lineHeight: "1.45",
            zIndex: getNextZIndex(),
            backgroundColor: "transparent",
        },
    };
}

function _createClipboardImageElement(dataUrl, origWidth, origHeight, x = 100, y = 100) {
    const placement = _getImageInsertPlacement(origWidth, origHeight, { x, y, center: false });
    return {
        id: generateId("el"),
        type: "image",
        x: placement.x,
        y: placement.y,
        width: `${placement.width}px`,
        height: `${placement.height}px`,
        lockAspectRatio: true,
        imageAspectRatio: placement.ratio,
        content: dataUrl,
        styles: { zIndex: getNextZIndex(), borderRadius: "8px" },
    };
}

function _getSlideInsertBounds() {
    const slideConfig =
        typeof getPresentationPageSetupConfig === "function"
            ? getPresentationPageSetupConfig()
            : { width: 1024, height: 768 };
    const slideW = Number(slideConfig.width) || 1024;
    const slideH = Number(slideConfig.height) || 768;
    const margin = Math.max(32, Math.min(slideW, slideH) * 0.06);
    return {
        slideW,
        slideH,
        margin,
        maxW: Math.max(80, slideW - margin * 2),
        maxH: Math.max(80, slideH - margin * 2),
    };
}

// Top edge of the current slide's footer (logo, footer text, page number), or null if it has none.
function _currentSlideFooterTop() {
    const tops = (state.slides?.[currentSlideIndex]?.elements || [])
        .filter(el => el?.editableMasterFooterElement)
        .map(el => parseFloat(el.y))
        .filter(Number.isFinite);
    return tops.length ? Math.min(...tops) : null;
}

// Boxes of the user's content on the current slide (footer excluded; it limits placement instead).
function _currentSlideContentBoxes() {
    const elements = state.slides?.[currentSlideIndex]?.elements || [];
    return elements
        .filter(el => !el?.isMasterElement && !el?.editableMasterFooterElement)
        .map(el => {
            let w = parseFloat(el.width) || 0;
            let h = parseFloat(el.height) || 0;
            // An object sized by its content (an equation's height is "auto") has no stored size: use the size
            // it is drawn at, or new pictures were placed on top of it as if it were not there.
            if (!(w > 0 && h > 0)) {
                const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find(n => !n.closest("#slide-previews"));
                w = w || node?.offsetWidth || 0;
                h = h || node?.offsetHeight || 0;
            }
            return { x: parseFloat(el.x) || 0, y: parseFloat(el.y) || 0, w, h };
        })
        .filter(box => box.w > 0 && box.h > 0);
}

// Of a few standard spots, the one where a width x height box covers the least existing content (centre wins ties).
function _leastOverlapPosition(width, height, bounds, boxes, floor = bounds.slideH - bounds.margin) {
    const m = bounds.margin;
    const cx = Math.round((bounds.slideW - width) / 2);
    const cy = Math.max(m, Math.min(Math.round((bounds.slideH - height) / 2), floor - height));
    const right = bounds.slideW - width - m;
    const bottom = Math.max(m, floor - height);
    const candidates = [[cx, cy], [right, cy], [m, cy], [cx, bottom], [right, bottom], [right, m], [m, bottom], [m, m]];
    const overlap = ([x, y]) =>
        boxes.reduce((sum, b) => {
            const w = Math.min(x + width, b.x + b.w) - Math.max(x, b.x);
            const h = Math.min(y + height, b.y + b.h) - Math.max(y, b.y);
            return sum + (w > 0 && h > 0 ? w * h : 0);
        }, 0);
    const best = candidates.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
    return { x: best[0], y: best[1], overlap: overlap(best) };
}

function _getImageInsertPlacement(origWidth, origHeight, { x = 100, y = 100, center = true } = {}) {
    const naturalW = Math.max(1, Number(origWidth) || 400);
    const naturalH = Math.max(1, Number(origHeight) || 300);
    const ratio = Math.max(0.01, naturalW / naturalH);
    const bounds = _getSlideInsertBounds();
    // On a slide that already has content, insert smaller and beside it rather than on top of it: the largest of a
    // few sizes that fits without covering anything, else the size and spot that cover the least.
    const boxes = center ? _currentSlideContentBoxes() : [];
    const footerTop = center ? _currentSlideFooterTop() : null;
    const floor = footerTop === null ? bounds.slideH - bounds.margin : footerTop - 12;
    const sizeFor = share => {
        const maxW = Math.min(bounds.maxW, bounds.slideW * share);
        const maxH = Math.min(bounds.maxH, bounds.slideH * share, floor - bounds.margin);
        const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
        return [Math.max(24, Math.round(naturalW * scale)), Math.max(24, Math.round(naturalH * scale))];
    };
    let [width, height] = sizeFor(boxes.length ? 0.55 : 0.72);
    let spot = center ? _leastOverlapPosition(width, height, bounds, boxes, floor) : null;
    if (spot && spot.overlap > 0) {
        // Smaller steps too: on a wide slide the gap under a centred table is short, and 35% was a few pixels too tall.
        for (const share of [0.45, 0.35, 0.3, 0.25, 0.2]) {
            const [w, h] = sizeFor(share);
            const candidate = _leastOverlapPosition(w, h, bounds, boxes, floor);
            if (candidate.overlap < spot.overlap) [width, height, spot] = [w, h, candidate];
            if (!spot.overlap) break;
        }
    }
    const [freeX, freeY] = spot ? [spot.x, spot.y] : [0, 0];
    const nextX = center ? freeX : Math.min(Math.max(bounds.margin, x), bounds.slideW - width - bounds.margin);
    const nextY = center ? freeY : Math.min(Math.max(bounds.margin, y), bounds.slideH - height - bounds.margin);
    return {
        x: Math.max(0, nextX),
        y: Math.max(0, nextY),
        width,
        height,
        ratio,
    };
}

function _looksLikeImageSource(text) {
    const value = String(text || "").trim();
    if (!value) return false;
    if (value.startsWith("data:image/")) return true;
    return /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
}

function _insertClipboardTextAsBestFit(text, x = 100, y = 100) {
    const activeIndex = ensureActiveSlideSync();
    const value = String(text || "").trim();
    if (!value) return false;

    saveStateToUndo();
    if (_looksLikeImageSource(value)) {
        const imageEl = _createClipboardImageElement(value, 400, 300, x, y);
        state.slides[activeIndex].elements.push(imageEl);
        renderSlidesFromState();
        selectElement(imageEl.id);
        return true;
    }

    const textEl = _createClipboardTextElement(value, x, y);
    state.slides[activeIndex].elements.push(textEl);
    renderSlidesFromState();
    selectElement(textEl.id);
    return true;
}

function _dataUrlToBlob(dataUrl) {
    const [meta, base64] = String(dataUrl || "").split(",");
    const mimeMatch = meta?.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
    });
}

function _getImageSourceDimensions(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error("Could not read image dimensions"));
        img.src = src;
    });
}

async function _copySelectionToSystemClipboard(selectedElements) {
    if (!navigator.clipboard) return;

    const textSummary = selectedElements
        .map(el => (el.type === "text" ? String(parseTextFromHtml?.(el.content) || el.content || "") : `[${el.type}]`))
        .filter(Boolean)
        .join("\n");

    if (navigator.clipboard.write && typeof ClipboardItem !== "undefined" && selectedElements.length === 1) {
        const [element] = selectedElements;
        if (element.type === "image" && typeof element.content === "string" && element.content.startsWith("data:")) {
            const blob = _dataUrlToBlob(element.content);
            await navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type || "image/png"]: blob,
                    "text/plain": new Blob([textSummary || "[image]"], { type: "text/plain" }),
                }),
            ]);
            return;
        }
    }

    if (navigator.clipboard.writeText && textSummary) {
        await navigator.clipboard.writeText(textSummary);
    }
}

async function _pasteFromSystemClipboard(activeIndex) {
    if (!navigator.clipboard) return false;

    if (navigator.clipboard.read && typeof ClipboardItem !== "undefined") {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const imageType = item.types.find(type => type.startsWith("image/"));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const dataUrl = await _blobToDataUrl(blob);
                    let dimensions = { width: 400, height: 300 };
                    try {
                        dimensions = await _getImageSourceDimensions(dataUrl);
                    } catch (_err) {}
                    const imageEl = _createClipboardImageElement(
                        dataUrl,
                        dimensions.width,
                        dimensions.height,
                        100,
                        100,
                    );
                    saveStateToUndo();
                    state.slides[activeIndex].elements.push(imageEl);
                    renderSlidesFromState();
                    selectElement(imageEl.id);
                    return true;
                }
                if (item.types.includes("text/plain")) {
                    const blob = await item.getType("text/plain");
                    const text = (await blob.text()).trim();
                    if (text) {
                        return _insertClipboardTextAsBestFit(text, 100, 100);
                    }
                }
            }
        } catch (err) {
            console.warn("navigator.clipboard.read failed:", err);
        }
    }

    if (navigator.clipboard.readText) {
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (text) {
                return _insertClipboardTextAsBestFit(text, 100, 100);
            }
        } catch (err) {
            console.warn("navigator.clipboard.readText failed:", err);
        }
    }

    return false;
}

function pasteElement(payload = null) {
    const activeIndex = ensureActiveSlideSync();
    const sourceElements = _normalizeClipboardPayload(payload).length
        ? _normalizeClipboardPayload(payload)
        : _clipboard.elements;
    if (!sourceElements.length) return;
    saveStateToUndo();
    const newIds = [];
    const groupIdMap = {};
    const idMap = {};
    const copies = [];

    sourceElements.forEach(el => {
        const newId = generateId("el");
        const copy = JSON.parse(JSON.stringify(el));
        idMap[el.id] = newId;
        copies.push(copy);
        copy.id = newId;
        copy.x = (Number(copy.x) || 0) + 40;
        copy.y = (Number(copy.y) || 0) + 40;

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

async function pasteFromClipboard() {
    const activeIndex = ensureActiveSlideSync();
    const pasted = await _pasteFromSystemClipboard(activeIndex);
    if (pasted) {
        return true;
    }

    if (_clipboard.elements?.length) {
        pasteElement();
        return true;
    }

    setProjectSaveHint?.("Nothing usable was found in the clipboard, or clipboard access was blocked", "warn");
    return false;
}

async function handlePaste(e) {
    const pasteTarget = e?.target || document.activeElement;
    const editablePasteHost =
        pasteTarget?.closest?.('[contenteditable="true"]') ||
        document.activeElement?.closest?.('[contenteditable="true"]') ||
        null;
    const isNativeTextInput =
        pasteTarget?.tagName === "TEXTAREA" ||
        pasteTarget?.tagName === "SELECT" ||
        (pasteTarget?.tagName === "INPUT" &&
            !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(
                String(pasteTarget.type || "text").toLowerCase(),
            ));
    if (isNativeTextInput) return;

    const isTextEditing = Boolean(
        editablePasteHost || pasteTarget?.isContentEditable || document.activeElement?.isContentEditable,
    );
    const items = e.clipboardData?.items || [];
    let hasImage = false;
    let handled = false;
    for (const item of items) {
        if (item.type.startsWith("image/")) {
            hasImage = true;
            break;
        }
    }

    // Prevent pasting raw base64 string into contenteditable if we are handling it
    if (hasImage && isTextEditing) {
        e.preventDefault();
    }

    if (!hasImage && !isTextEditing) {
        const customData = e.clipboardData?.getData("application/x-slideforge-elements");
        if (customData) {
            try {
                const parsed = JSON.parse(customData);
                e.preventDefault();
                pasteElement(parsed);
                return;
            } catch (err) {
                console.error("Clipboard parse error:", err);
            }
        }
    }

    const activeIndex = ensureActiveSlideSync();

    if (!hasImage && !isTextEditing) {
        const plainText = e.clipboardData?.getData("text/plain") || "";
        const htmlText = e.clipboardData?.getData("text/html") || "";
        const incomingText =
            String(plainText || "").trim() ||
            (htmlText ? new DOMParser().parseFromString(htmlText, "text/html").body.innerText.trim() : "");
        if (incomingText) {
            e.preventDefault();
            handled = _insertClipboardTextAsBestFit(incomingText, 100, 100);
        }
    }

    if (handled) return;

    for (const item of items) {
        if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (!file) continue;
            try {
                const { dataUrl, origWidth, origHeight } = await optimizeImageToWebP(file);
                saveStateToUndo();
                const imageEl = _createClipboardImageElement(dataUrl, origWidth, origHeight, 100, 100);
                state.slides[activeIndex].elements.push(imageEl);
                renderSlidesFromState();
                selectElement(imageEl.id);
                handled = true;
            } catch (err) {
                console.error("Paste image error:", err);
            }
        }
    }

    if (handled) {
        e.preventDefault();
        return;
    }

    if (!isTextEditing) {
        const pasted = await _pasteFromSystemClipboard(activeIndex);
        if (pasted) {
            e.preventDefault();
        }
    }
}
