let activeEditor = null;
let savedRange = null;
let formattingInteractionDepth = 0;

function normalizeFontFamily(value) {
    return String(value || "")
        .split(",")[0]
        .replace(/['"]/g, "")
        .trim();
}

function _getNativeSelection() {
    return window.getSelection ? window.getSelection() : null;
}

// Paints the saved text range when focus leaves the canvas editor for a toolbar or properties input
// (such as typing a font size or opening a color picker), so the user still sees their highlighted selection.
function _syncSavedSelectionHighlight() {
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
    try {
        if (
            activeEditor &&
            activeEditor.isConnected &&
            savedRange &&
            !savedRange.collapsed &&
            activeEditor.contains(savedRange.commonAncestorContainer) &&
            (formattingInteractionDepth > 0 || document.activeElement !== activeEditor)
        ) {
            CSS.highlights.set("sf-inline-selection", new Highlight(savedRange));
        } else {
            CSS.highlights.delete("sf-inline-selection");
        }
    } catch (_err) {
        CSS.highlights.delete("sf-inline-selection");
    }
}

function isEditorActive(editor) {
    return (
        !!editor &&
        editor.classList?.contains("text-element-content") &&
        editor.contentEditable === "true"
    );
}

function getActiveInlineEditor() {
    return isEditorActive(activeEditor) ? activeEditor : null;
}

function findEditableTextHostFromSelection() {
    const selection = _getNativeSelection();
    const node = selection?.anchorNode;
    if (!node) return null;
    const host = (node.nodeType === 3 ? node.parentElement : node).closest?.(".text-element-content");
    return isEditorActive(host) ? host : null;
}

function findEditableTextHostFromSelectedElement() {
    if (!Array.isArray(state?.selectedIds) || state.selectedIds.length !== 1) return null;
    const dom = document.getElementById(state.selectedIds[0]);
    if (!dom?.classList?.contains("editing-text")) return null;
    const host = dom.querySelector(".text-element-content");
    return isEditorActive(host) ? host : null;
}

function getInlineEditorForFormatting() {
    return getActiveInlineEditor() || findEditableTextHostFromSelection() || findEditableTextHostFromSelectedElement();
}

function setActiveInlineEditor(editor) {
    activeEditor = isEditorActive(editor) ? editor : null;
    if (!activeEditor) {
        savedRange = null;
    }
    _syncSavedSelectionHighlight();
}

function clearActiveInlineEditor(editor = null) {
    if (!editor || activeEditor === editor) {
        activeEditor = null;
        savedRange = null;
    }
    _syncSavedSelectionHighlight();
}

function beginFormattingInteraction() {
    formattingInteractionDepth += 1;
    _syncSavedSelectionHighlight();
}

function endFormattingInteraction() {
    formattingInteractionDepth = Math.max(0, formattingInteractionDepth - 1);
    _syncSavedSelectionHighlight();
}

function shouldKeepInlineEditorOpen(e) {
    if (formattingInteractionDepth > 0) return true;
    const target = (e && e.relatedTarget) || document.activeElement;
    if (
        target &&
        target.closest &&
        (target.closest('#properties-panel') ||
            target.closest('#floating-text-toolbar') ||
            target.closest('#symbol-picker-modal') ||
            target.closest('[data-preserve-inline-selection="true"]'))
    ) {
        return true;
    }
    return false;
}

function captureInlineSelection() {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;
    activeEditor = editor;
    savedRange = range.cloneRange();
    _syncSavedSelectionHighlight();
    return true;
}

function restoreInlineSelection() {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor || !selection || !savedRange) return false;
    // Focusing the editor re-captures its current (collapsed) selection into savedRange, so keep ours first.
    const range = savedRange.cloneRange();
    activeEditor = editor;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    _syncSavedSelectionHighlight();
    return true;
}

function hasNonCollapsedInlineSelection() {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor) return false;
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed && editor.contains(range.commonAncestorContainer)) {
            return true;
        }
    }
    if (savedRange && !savedRange.collapsed && editor.contains(savedRange.commonAncestorContainer)) {
        return true;
    }
    return false;
}

function selectInsertedNode(node) {
    const selection = _getNativeSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    _syncSavedSelectionHighlight();
}

const _INLINE_BLOCK_BOUNDARY_TAGS = new Set([
    "LI", "UL", "OL", "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "BLOCKQUOTE", "PRE",
]);

function _stripConflictingStylesFromSubtree(root, styleMap) {
    if (!root || !styleMap) return;
    const props = Object.keys(styleMap);
    Array.from(root.querySelectorAll?.("*") || []).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        props.forEach((prop) => {
            const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
            node.style.removeProperty(cssProp);
            if (node.tagName === "FONT") {
                if (prop === "color") node.removeAttribute("color");
                if (prop === "fontFamily") node.removeAttribute("face");
                if (prop === "fontSize") node.removeAttribute("size");
            }
        });
        if (!node.getAttribute("style")?.trim()) {
            node.removeAttribute("style");
        }
    });
    Array.from(root.querySelectorAll?.("span") || [])
        .reverse()
        .forEach((span) => {
            if (span.attributes.length === 0) {
                span.replaceWith(...Array.from(span.childNodes));
            }
        });
}

function _rangeCrossesBlockBoundary(range, editor) {
    const fragment = range.cloneContents();
    if (Array.from(fragment.querySelectorAll("*")).some((el) => _INLINE_BLOCK_BOUNDARY_TAGS.has(el.tagName))) {
        return true;
    }
    const blockOf = (node) => {
        const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return el?.closest?.(".ppt-bullet-edit-item, .ppt-bullet-row, li, p, div, h1, h2, h3, h4, h5, h6") || editor;
    };
    return blockOf(range.startContainer) !== blockOf(range.endContainer);
}

function _wrapRangeAcrossBlocks(editor, range, styleMap, selection) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const segments = [];
    let current = walker.nextNode();
    while (current) {
        if (range.intersectsNode(current) && current.textContent.length > 0) {
            const start = current === range.startContainer ? range.startOffset : 0;
            const end = current === range.endContainer ? range.endOffset : current.textContent.length;
            if (end > start) {
                segments.push({ node: current, start, end });
            }
        }
        current = walker.nextNode();
    }
    if (!segments.length) return false;

    const wrappers = [];
    segments.forEach(({ node, start, end }) => {
        let targetNode = node;
        if (end < targetNode.textContent.length) {
            targetNode.splitText(end);
        }
        if (start > 0) {
            targetNode = targetNode.splitText(start);
        }
        const parent = targetNode.parentElement;
        if (
            parent &&
            parent !== editor &&
            parent.tagName === "SPAN" &&
            parent.childNodes.length === 1 &&
            !parent.classList.length
        ) {
            Object.entries(styleMap).forEach(([prop, value]) => {
                parent.style[prop] = value;
            });
            wrappers.push(parent);
            return;
        }
        const wrapper = document.createElement("span");
        Object.entries(styleMap).forEach(([prop, value]) => {
            wrapper.style[prop] = value;
        });
        targetNode.parentNode?.insertBefore(wrapper, targetNode);
        wrapper.appendChild(targetNode);
        wrappers.push(wrapper);
    });

    if (!wrappers.length) return false;
    const newRange = document.createRange();
    newRange.setStartBefore(wrappers[0]);
    newRange.setEndAfter(wrappers[wrappers.length - 1]);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedRange = newRange.cloneRange();
    _syncSavedSelectionHighlight();
    return true;
}

function wrapSelectionWithStyledSpan(styleMap) {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor || !selection) return false;
    if (selection.rangeCount === 0 && savedRange && editor.contains(savedRange.commonAncestorContainer)) {
        selection.addRange(savedRange.cloneRange());
    }
    if (selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;

    if (range.collapsed) {
        const wrapper = document.createElement("span");
        Object.entries(styleMap).forEach(([prop, value]) => {
            wrapper.style[prop] = value;
        });
        wrapper.textContent = "\u200B";
        range.insertNode(wrapper);

        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedRange = newRange.cloneRange();
        _syncSavedSelectionHighlight();
        return true;
    }

    if (_rangeCrossesBlockBoundary(range, editor)) {
        return _wrapRangeAcrossBlocks(editor, range, styleMap, selection);
    }

    // Reuse an existing span wrapper when the selection already matches it (e.g. while dragging a color picker
    // or repeatedly adjusting font size), avoiding deeply nested spans and keeping the selection intact.
    const ancestorEl =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer;
    if (
        ancestorEl &&
        ancestorEl !== editor &&
        ancestorEl.tagName === "SPAN" &&
        !ancestorEl.classList.length &&
        range.toString() === ancestorEl.textContent
    ) {
        _stripConflictingStylesFromSubtree(ancestorEl, styleMap);
        Object.entries(styleMap).forEach(([prop, value]) => {
            ancestorEl.style[prop] = value;
        });
        const newRange = document.createRange();
        newRange.selectNodeContents(ancestorEl);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedRange = newRange.cloneRange();
        _syncSavedSelectionHighlight();
        return true;
    }

    const wrapper = document.createElement("span");
    Object.entries(styleMap).forEach(([prop, value]) => {
        wrapper.style[prop] = value;
    });

    const fragment = range.extractContents();
    _stripConflictingStylesFromSubtree(fragment, styleMap);
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);

    // Keep the selection around the newly styled text (as in PowerPoint, WPS, and Google Docs)
    // so the user can apply additional styles or adjust font size/color again without re-selecting.
    const newRange = document.createRange();
    newRange.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(newRange);
    savedRange = newRange.cloneRange();
    _syncSavedSelectionHighlight();
    return true;
}

function applyInlineTextStyle(action, value) {
    let editor = getInlineEditorForFormatting();

    // If no active editor found, try to find it from the current selection if possible
    if (!editor) {
        editor = findEditableTextHostFromSelection();
    }

    if (!editor) return false;
    activeEditor = editor;

    // Force re-enable if it was temporarily disabled
    if (editor.contentEditable !== "true") {
        editor.contentEditable = "true";
        editor.classList.add("editing-text");
    }

    editor.focus();
    restoreInlineSelection();

    let result = false;
    switch (action) {
        case "bold":
            document.execCommand?.("styleWithCSS", false, true);
            result = document.execCommand?.("bold", false) ?? false;
            break;
        case "italic":
            document.execCommand?.("styleWithCSS", false, true);
            result = document.execCommand?.("italic", false) ?? false;
            break;
        case "underline":
            document.execCommand?.("styleWithCSS", false, true);
            result = document.execCommand?.("underline", false) ?? false;
            break;
        case "strikethrough":
        case "strikeThrough":
            document.execCommand?.("styleWithCSS", false, true);
            result = document.execCommand?.("strikeThrough", false) ?? false;
            break;
        case "textDecoration":
            document.execCommand?.("styleWithCSS", false, true);
            if (typeof value === "string" && value.includes("line-through") && !value.includes("underline")) {
                result = document.execCommand?.("strikeThrough", false) ?? false;
            } else {
                result = document.execCommand?.("underline", false) ?? false;
            }
            break;
        case "fontFamily":
            result = wrapSelectionWithStyledSpan({ fontFamily: value });
            break;
        case "fontSize":
            result = wrapSelectionWithStyledSpan({ fontSize: value });
            break;
        case "color":
            result = wrapSelectionWithStyledSpan({ color: value });
            break;
        case "subscript":
            result = document.execCommand?.("subscript", false) ?? false;
            break;
        case "superscript":
            result = document.execCommand?.("superscript", false) ?? false;
            break;
        default:
            return false;
    }
    captureInlineSelection();
    return result;
}

function getStyleAtSelection() {
    const editor = getInlineEditorForFormatting();
    if (!editor) return null;
    const selection = _getNativeSelection();
    let range = null;
    let isLiveSelection = false;
    if (selection && selection.rangeCount > 0) {
        const candidate = selection.getRangeAt(0);
        if (editor.contains(candidate.commonAncestorContainer)) {
            range = candidate;
            isLiveSelection = true;
        }
    }
    if (!range && savedRange && editor.contains(savedRange.commonAncestorContainer)) {
        range = savedRange;
    }
    if (!range) return null;

    let node = isLiveSelection ? selection.anchorNode : range.startContainer;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !editor.contains(node)) node = editor;

    const computed = window.getComputedStyle(node);
    const weightNum = parseInt(computed.fontWeight, 10);
    const computedBold =
        computed.fontWeight === "bold" ||
        (Number.isFinite(weightNum) && weightNum >= 600) ||
        Boolean(node.closest?.("b, strong"));
    const computedItalic =
        computed.fontStyle === "italic" ||
        computed.fontStyle === "oblique" ||
        Boolean(node.closest?.("i, em"));

    let decorationLine = `${computed.textDecorationLine || ""} ${computed.textDecoration || ""}`;
    let cursor = node;
    while (cursor && editor.contains(cursor)) {
        if (cursor.tagName === "U") decorationLine += " underline";
        if (cursor.tagName === "S" || cursor.tagName === "STRIKE" || cursor.tagName === "DEL") {
            decorationLine += " line-through";
        }
        if (cursor.style?.textDecoration || cursor.style?.textDecorationLine) {
            decorationLine += ` ${cursor.style.textDecoration || ""} ${cursor.style.textDecorationLine || ""}`;
        }
        cursor = cursor.parentElement;
    }

    const isBold = isLiveSelection ? (document.queryCommandState?.("bold") || computedBold) : computedBold;
    const isItalic = isLiveSelection ? (document.queryCommandState?.("italic") || computedItalic) : computedItalic;
    const isUnderline =
        (isLiveSelection && Boolean(document.queryCommandState?.("underline"))) ||
        decorationLine.includes("underline");
    const isStrikethrough =
        (isLiveSelection && Boolean(document.queryCommandState?.("strikeThrough"))) ||
        decorationLine.includes("line-through");
    const isSubscript =
        (isLiveSelection && Boolean(document.queryCommandState?.("subscript"))) ||
        Boolean(node.closest?.("sub")) ||
        computed.verticalAlign === "sub";
    const isSuperscript =
        (isLiveSelection && Boolean(document.queryCommandState?.("superscript"))) ||
        Boolean(node.closest?.("sup")) ||
        computed.verticalAlign === "super";

    const fontName = computed.fontFamily || (isLiveSelection ? document.queryCommandValue?.("fontName") : "") || "";
    const foreColor = computed.color || (isLiveSelection ? document.queryCommandValue?.("foreColor") : "") || "";

    // Check if an inline descendant inside editor explicitly overrides font-size; if not and the box is in autofit
    // mode, report the element's authored fontSize rather than the scaled-down autofit size on contentHost.
    let explicitInlineSize = "";
    let sizeProbe = node;
    while (sizeProbe && sizeProbe !== editor && editor.contains(sizeProbe)) {
        if (sizeProbe.style?.fontSize) {
            explicitInlineSize = sizeProbe.style.fontSize;
            break;
        }
        sizeProbe = sizeProbe.parentElement;
    }
    let fontSize = explicitInlineSize || computed.fontSize || "";
    if (!explicitInlineSize) {
        const hostDom = editor.closest?.(".canvas-element");
        if (hostDom?.dataset?.textFitMode === "autofit") {
            const elData = typeof getSelectedElementData === "function" ? getSelectedElementData() : null;
            if (elData?.styles?.fontSize) {
                fontSize = elData.styles.fontSize;
            }
        }
    }

    return {
        fontWeight: isBold ? "bold" : "normal",
        fontStyle: isItalic ? "italic" : "normal",
        underline: isUnderline,
        strikethrough: isStrikethrough,
        subscript: isSubscript,
        superscript: isSuperscript,
        fontFamily: fontName,
        fontSize,
        color: foreColor,
    };
}

let _selectionChangeRaf = null;
document.addEventListener("selectionchange", () => {
    const editor = getInlineEditorForFormatting();
    if (!editor) {
        _syncSavedSelectionHighlight();
        return;
    }
    const selection = _getNativeSelection();
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
            activeEditor = editor;
            savedRange = range.cloneRange();
        }
    }
    _syncSavedSelectionHighlight();
    if (_selectionChangeRaf) cancelAnimationFrame(_selectionChangeRaf);
    _selectionChangeRaf = requestAnimationFrame(() => {
        _selectionChangeRaf = null;
        if (typeof updateUIFromSelection === "function") {
            updateUIFromSelection();
        }
    });
});
document.addEventListener("focusin", _syncSavedSelectionHighlight);
document.addEventListener("focusout", () => {
    requestAnimationFrame(_syncSavedSelectionHighlight);
});
