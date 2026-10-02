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
}

function clearActiveInlineEditor(editor = null) {
    if (!editor || activeEditor === editor) {
        activeEditor = null;
        savedRange = null;
    }
}

function beginFormattingInteraction() {
    formattingInteractionDepth += 1;
}

function endFormattingInteraction() {
    formattingInteractionDepth = Math.max(0, formattingInteractionDepth - 1);
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
    return true;
}

function hasNonCollapsedInlineSelection() {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return !range.collapsed && editor.contains(range.commonAncestorContainer);
}

function selectInsertedNode(node) {
    const selection = _getNativeSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
}

function wrapSelectionWithStyledSpan(styleMap) {
    const editor = getInlineEditorForFormatting();
    const selection = _getNativeSelection();
    if (!editor || !selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return false;

    const wrapper = document.createElement("span");
    Object.entries(styleMap).forEach(([prop, value]) => {
        wrapper.style[prop] = value;
    });

    if (range.collapsed) {
        wrapper.textContent = "\u200B";
        range.insertNode(wrapper);
        
        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedRange = newRange.cloneRange();
    } else {
        const fragment = range.extractContents();
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);
        const newRange = document.createRange();
        newRange.setStartAfter(wrapper);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        savedRange = newRange.cloneRange();
        editor.normalize();
    }
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

    switch (action) {
        case "bold":
            document.execCommand?.("styleWithCSS", false, true);
            return document.execCommand?.("bold", false) ?? false;
        case "italic":
            document.execCommand?.("styleWithCSS", false, true);
            return document.execCommand?.("italic", false) ?? false;
        case "underline":
        case "textDecoration":
            document.execCommand?.("styleWithCSS", false, true);
            return document.execCommand?.("underline", false) ?? false;
        case "fontFamily":
            return wrapSelectionWithStyledSpan({ fontFamily: value });
        case "fontSize":
            return wrapSelectionWithStyledSpan({ fontSize: value });
        case "color":
            return wrapSelectionWithStyledSpan({ color: value });
        case "subscript":
            return document.execCommand?.("subscript", false) ?? false;
        case "superscript":
            return document.execCommand?.("superscript", false) ?? false;
        default:
            return false;
    }
}
function getStyleAtSelection() {
    const editor = getActiveInlineEditor();
    if (!editor) return null;
    const selection = _getNativeSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;

    // Use queryCommandValue for standard props
    const isBold = document.queryCommandState?.("bold") ?? false;
    const isItalic = document.queryCommandState?.("italic") ?? false;
    const fontName = document.queryCommandValue?.("fontName") ?? "";
    const foreColor = document.queryCommandValue?.("foreColor") ?? "";

    // For font size, it's trickier because queryCommandValue returns 1-7
    // We can check the computed style of the selection's anchor node
    let fontSize = "";
    let node = selection.anchorNode;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (node && editor.contains(node)) {
        const style = window.getComputedStyle(node);
        fontSize = style.fontSize;
    }

    return {
        fontWeight: isBold ? "bold" : "normal",
        fontStyle: isItalic ? "italic" : "normal",
        fontFamily: fontName,
        fontSize: fontSize,
        color: foreColor
    };
}
