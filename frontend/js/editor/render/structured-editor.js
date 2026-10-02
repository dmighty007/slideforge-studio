// Structured (list/bullet) text editor: caret handling, list item editing, shortcuts and clipboard.

function _getStructuredSelectionOffsets(el) {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !el.contains(selection.anchorNode)
  ) {
    const length = el.innerText.length;
    return { start: length, end: length };
  }

  const range = selection.getRangeAt(0);
  const preStart = range.cloneRange();
  preStart.selectNodeContents(el);
  preStart.setEnd(range.startContainer, range.startOffset);

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(el);
  preEnd.setEnd(range.endContainer, range.endOffset);

  return {
    start: preStart.toString().length,
    end: preEnd.toString().length,
  };
}

function _setStructuredSelectionOffsets(el, start, end = start) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let current = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const next = current + node.textContent.length;

    if (!startNode && start <= next) {
      startNode = node;
      startOffset = Math.max(0, start - current);
    }
    if (!endNode && end <= next) {
      endNode = node;
      endOffset = Math.max(0, end - current);
      break;
    }
    current = next;
  }

  const fallbackNode = el.lastChild || el;
  range.setStart(
    startNode || fallbackNode,
    startNode ? startOffset : fallbackNode.textContent?.length || 0,
  );
  range.setEnd(
    endNode || startNode || fallbackNode,
    endNode
      ? endOffset
      : startNode
        ? startOffset
        : fallbackNode.textContent?.length || 0,
  );
  selection.removeAllRanges();
  selection.addRange(range);
}

function _updateStructuredEditorText(
  el,
  nextText,
  selectionStart,
  selectionEnd = selectionStart,
) {
  el.textContent = nextText;
  _setStructuredSelectionOffsets(el, selectionStart, selectionEnd);
}

function _getActiveStructuredEditor() {
  const active = document.activeElement;
  if (!active) return null;
  if (
    active.classList?.contains("text-element-content") &&
    active.dataset.structuredEdit === "true" &&
    active.contentEditable === "true"
  ) {
    return active;
  }
  return null;
}

function _focusEditableHost(el, options = {}) {
  if (!el) return;
  const { placeCaretAtEnd = true, preserveSelection = false } = options;
  el.focus();
  const selection = window.getSelection();
  const hasSelectionInside = Boolean(
    selection && selection.rangeCount > 0 && el.contains(selection.anchorNode),
  );
  if (preserveSelection && hasSelectionInside) return;
  if (!selection || selection.rangeCount === 0 || !hasSelectionInside) {
    if (!placeCaretAtEnd) return;
    const length = el.textContent.length;
    _setStructuredSelectionOffsets(el, length, length);
  }
}

function _getStructuredEditorBulletStyle(el) {
  return el?.dataset?.structuredEditBulletStyle || "default";
}

function _getStructuredEditorMode(el) {
  return el?.dataset?.structuredEditMode || "plain";
}

function _getActiveStructuredBulletListItem(host) {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!host || !node) return null;
  const elementNode =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return elementNode?.closest?.(".ppt-bullet-edit-item") || null;
}

function _refreshStructuredBulletEditorMarkers(host) {
  if (!host || _getStructuredEditorMode(host) !== "list") return;
  const bulletStyle = _getStructuredEditorBulletStyle(host);
  host.querySelectorAll(".ppt-bullet-edit-item").forEach((item) => {
    const level = Number(item.dataset.level) || 0;
    const meta = getBulletLevelMeta(level, bulletStyle);
    const levelStyle =
      typeof getLevelStyle === "function"
        ? getLevelStyle(bulletStyle, level)
        : null;
    const color = levelStyle?.color || "inherit";
    const fontScale = Number(levelStyle?.fontSize) || 1;
    item.dataset.level = String(meta.level);
    item.dataset.marker = meta.marker;
    item.style.setProperty("--bullet-indent", `${meta.indent}px`);
    item.style.setProperty("--bullet-color", color);
    item.style.setProperty("--bullet-font-scale", String(fontScale));
  });

  // Initialize virtual scrolling if not already done
  _initializeVirtualScrollingForListEditor(host);
}

// ============================================================================
// VIRTUAL SCROLLING - Optimize rendering for large lists (10k+ items)
// ============================================================================

let _virtualScrollingInstances = new WeakMap();

function _initializeVirtualScrollingForListEditor(host) {
  if (!host || _virtualScrollingInstances.has(host)) return;

  const items = host.querySelectorAll(".ppt-bullet-edit-item");
  if (items.length < 500) return; // Only enable for large lists

  _virtualScrollingInstances.set(host, {
    visibleItems: new Set(),
    observer: null,
    renderBuffer: 50, // Render items 50 above and below viewport
  });

  const instance = _virtualScrollingInstances.get(host);

  // Create Intersection Observer to track visible items
  instance.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const itemId = entry.target.dataset.virtualId;
        if (entry.isIntersecting) {
          instance.visibleItems.add(itemId);
          entry.target.style.display = "";
        } else {
          instance.visibleItems.delete(itemId);
          // Keep items slightly outside viewport for smoother scrolling
          const rect = entry.target.getBoundingClientRect();
          const isAboveViewport = rect.bottom < -100;
          const isBelowViewport = rect.top > window.innerHeight + 100;
          if (isAboveViewport || isBelowViewport) {
            entry.target.style.display = "none";
          }
        }
      });
    },
    {
      root: host.parentElement,
      rootMargin: `${100}px 0px`,
      threshold: 0.01,
    },
  );

  // Assign virtual IDs and observe each item
  items.forEach((item, idx) => {
    item.dataset.virtualId = `item-${idx}`;
    instance.observer.observe(item);
  });
}

function _disposeVirtualScrolling(host) {
  const instance = _virtualScrollingInstances.get(host);
  if (instance && instance.observer) {
    instance.observer.disconnect();
  }
  _virtualScrollingInstances.delete(host);
}

function _commitStructuredBulletEditorChange(host) {
  if (!host || _getStructuredEditorMode(host) !== "list") return;
  const dom = host.closest(".canvas-element");
  const id = dom?.id || dom?.dataset?.id;
  if (!id) return;
  const elData = state.slides[currentSlideIndex]?.elements?.find(
    (el) => el.id === id,
  );
  if (!elData || elData.type !== "text") return;

  const nextContent = parseStructuredBulletEditorHtml(host, {
    preserveTrailingEmpty: true,
  });
  const nextTextDocument =
    typeof createTextDocumentFromLegacyContent === "function"
      ? createTextDocumentFromLegacyContent(nextContent, {
          bulletStyle: _getStructuredEditorBulletStyle(host),
        })
      : elData.textDocument;
  if (host.dataset.undoSnapshotCaptured !== "true") {
    saveStateToUndo();
    host.dataset.undoSnapshotCaptured = "true";
  }
  updateElementState(id, {
    content: nextContent,
    bulletStyle: _getStructuredEditorBulletStyle(host),
    textDocument: nextTextDocument,
  });
  elData.content = nextContent;
  elData.bulletStyle = _getStructuredEditorBulletStyle(host);
  elData.textDocument = nextTextDocument;

  const layout = syncTextBoxLayout(dom, elData);
  if (layout?.autoHeight && Number.isFinite(layout.height)) {
    updateElementState(id, { height: `${layout.height}px` });
    elData.height = `${layout.height}px`;
  }
  refreshPreviews?.();
}

function _placeCaretInElement(el, { atEnd = false } = {}) {
  if (!el) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function _placeCaretInListItemText(item, { atEnd = false } = {}) {
  if (!item) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (_isListItemEmpty(item)) {
    item.textContent = "";
  }
  const textNodes = [];
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  let textNode = atEnd ? textNodes[textNodes.length - 1] : textNodes[0];
  if (!textNode) {
    textNode = document.createTextNode("");
    item.insertBefore(textNode, atEnd ? null : item.firstChild);
  }
  const offset = atEnd ? textNode.textContent.length : 0;
  range.setStart(textNode, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function _getTextOffsetWithinElement(el, container, offset) {
  if (!el || !container) return 0;
  const range = document.createRange();
  try {
    range.selectNodeContents(el);
    range.setEnd(container, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

function _getPlainTextLength(el) {
  if (!el) return 0;
  return plainTextFromHtmlSnippet(el.innerHTML).length;
}

function _isListItemEmpty(item) {
  if (!item) return true;
  return (
    !plainTextFromHtmlSnippet(item.innerHTML).trim() &&
    !item.querySelector("img,svg,math")
  );
}

function _isRangeAtStartOfElement(el, range) {
  if (!el || !range) return false;
  return (
    _getTextOffsetWithinElement(el, range.startContainer, range.startOffset) ===
    0
  );
}

function _isRangeAtEndOfElement(el, range) {
  if (!el || !range) return false;
  return (
    _getTextOffsetWithinElement(el, range.startContainer, range.startOffset) >=
    _getPlainTextLength(el)
  );
}

function _placeCaretAtTextOffset(el, offset = 0) {
  if (!el) return;
  const selection = window.getSelection();
  if (!selection) return;
  const targetOffset = Math.max(0, Number(offset) || 0);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = targetOffset;

  while (node) {
    const length = node.textContent.length;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode();
  }

  _placeCaretInElement(el, { atEnd: true });
}

function _removeEmptyStructuredListItem(host, item) {
  if (!host || !item) return false;
  const previous = item.previousElementSibling;
  const next = item.nextElementSibling;
  if (!previous && !next) {
    item.innerHTML = "<br>";
    _refreshStructuredBulletEditorMarkers(host);
    _placeCaretInListItemText(item);
    _commitStructuredBulletEditorChange(host);
    return true;
  }

  item.remove();
  _refreshStructuredBulletEditorMarkers(host);
  if (previous) {
    _placeCaretInElement(previous, { atEnd: true });
  } else {
    _placeCaretInListItemText(next);
  }
  _commitStructuredBulletEditorChange(host);
  return true;
}

function _moveListItemChildren(target, source) {
  if (!target || !source || _isListItemEmpty(source)) return;

  // CRITICAL FIX: Validate level compatibility before merging
  const targetLevel = Number(target.dataset.level) || 0;
  const sourceLevel = Number(source.dataset.level) || 0;

  // If items are at different nesting levels, outdent source children to target level
  // This prevents structural corruption when merging items at different depths
  if (sourceLevel !== targetLevel) {
    const levelDiff = sourceLevel - targetLevel;
    const children = Array.from(source.childNodes);
    children.forEach((child) => {
      if (
        child.nodeType === 1 &&
        child.dataset &&
        child.dataset.level !== undefined
      ) {
        const childLevel = Number(child.dataset.level) || 0;
        child.dataset.level = String(
          Math.max(0, Math.min(8, childLevel - levelDiff)),
        );
      }
    });
  }

  if (_isListItemEmpty(target)) target.innerHTML = "";
  while (source.firstChild) {
    target.appendChild(source.firstChild);
  }
}

function _insertStructuredListItemBreak(host) {
  const item = _getActiveStructuredBulletListItem(host);
  if (!host || !item) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!item.contains(range.startContainer)) return false;

  if (!range.collapsed) {
    range.deleteContents();
  }

  if (range.collapsed && _isListItemEmpty(item)) {
    return _removeEmptyStructuredListItem(host, item);
  }

  const splitRange = document.createRange();
  splitRange.selectNodeContents(item);
  splitRange.setStart(range.startContainer, range.startOffset);
  const trailingContent = splitRange.extractContents();

  const nextItem = document.createElement("li");
  nextItem.className = "ppt-bullet-edit-item";
  nextItem.dataset.level = item.dataset.level || "0";
  nextItem.appendChild(trailingContent);
  if (
    !nextItem.textContent.trim() &&
    !nextItem.querySelector("br,img,svg,math")
  ) {
    nextItem.innerHTML = "<br>";
  }
  if (!item.textContent.trim() && !item.querySelector("br,img,svg,math")) {
    item.innerHTML = "<br>";
  }
  item.insertAdjacentElement("afterend", nextItem);
  _refreshStructuredBulletEditorMarkers(host);
  _placeCaretInListItemText(nextItem);
  _commitStructuredBulletEditorChange(host);
  return true;
}

function _handleStructuredListBackspace(host) {
  const item = _getActiveStructuredBulletListItem(host);
  if (!host || !item) return false;
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!item.contains(range.startContainer)) return false;

  if (!_isRangeAtStartOfElement(item, range)) return false;
  if (_isListItemEmpty(item)) return _removeEmptyStructuredListItem(host, item);

  const previous = item.previousElementSibling;
  if (!previous) return false;
  const caretOffset = _getPlainTextLength(previous);
  _moveListItemChildren(previous, item);
  item.remove();
  _refreshStructuredBulletEditorMarkers(host);
  _placeCaretAtTextOffset(previous, caretOffset);
  _commitStructuredBulletEditorChange(host);
  return true;
}

function _handleStructuredListDelete(host) {
  const item = _getActiveStructuredBulletListItem(host);
  if (!host || !item) return false;
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!item.contains(range.startContainer)) return false;

  if (!_isRangeAtEndOfElement(item, range)) return false;
  if (_isListItemEmpty(item)) return _removeEmptyStructuredListItem(host, item);

  const next = item.nextElementSibling;
  if (!next) return false;
  const caretOffset = _getPlainTextLength(item);
  _moveListItemChildren(item, next);
  next.remove();
  _refreshStructuredBulletEditorMarkers(host);
  _placeCaretAtTextOffset(item, caretOffset);
  _commitStructuredBulletEditorChange(host);
  return true;
}

let _structuredEditorShortcutsInstalled = false;

let _clipboardHandlersInstalled = false;

function _installStructuredEditorShortcuts() {
  if (_structuredEditorShortcutsInstalled) return;
  _structuredEditorShortcutsInstalled = true;
  document.addEventListener(
    "keydown",
    (e) => {
      const host = _getActiveStructuredEditor();
      if (!host) return;
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        _adjustStructuredIndentation(host, e.shiftKey ? -1 : 1);
      } else if (e.key === "Enter") {
        const handled =
          _getStructuredEditorMode(host) === "list"
            ? _insertStructuredListItemBreak(host)
            : (_insertStructuredLineBreak(host), true);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === "Backspace") {
        const handled =
          _getStructuredEditorMode(host) === "list"
            ? _handleStructuredListBackspace(host)
            : _handleStructuredBackspace(host);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === "Delete") {
        const handled =
          _getStructuredEditorMode(host) === "list"
            ? _handleStructuredListDelete(host)
            : false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    true,
  );
  _installStructuredEditorClipboardHandlers();
}

// ============================================================================
// CLIPBOARD HANDLERS - Preserve list structure during copy/paste operations
// ============================================================================

function _installStructuredEditorClipboardHandlers() {
  if (_clipboardHandlersInstalled) return;
  _clipboardHandlersInstalled = true;

  document.addEventListener(
    "copy",
    (e) => {
      const host = _getActiveStructuredEditor();
      if (!host || _getStructuredEditorMode(host) !== "list") return;
      _handleStructuredListCopy(e, host);
    },
    true,
  );

  document.addEventListener(
    "cut",
    (e) => {
      const host = _getActiveStructuredEditor();
      if (!host || _getStructuredEditorMode(host) !== "list") return;
      _handleStructuredListCut(e, host);
    },
    true,
  );

  document.addEventListener(
    "paste",
    (e) => {
      const host = _getActiveStructuredEditor();
      if (!host || _getStructuredEditorMode(host) !== "list") return;
      _handleStructuredListPaste(e, host);
    },
    true,
  );
}

function _serializeListItemsForClipboard(items) {
  const serialized = items.map((item) => ({
    level: Number(item.dataset.level) || 0,
    kind: item.dataset.kind || "bullet",
    style: item.dataset.style || "default",
    ordinal: Number(item.dataset.ordinal) || 0,
    textContent: item.textContent || "",
    html: item.innerHTML,
  }));
  return JSON.stringify(serialized);
}

function _deserializeListItemsFromClipboard(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

function _getSelectedListItems(host) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  const items = [];
  const allItems = Array.from(host.querySelectorAll(".ppt-bullet-edit-item"));

  for (const item of allItems) {
    if (range.intersectsNode(item)) {
      items.push(item);
    }
  }

  return items.length > 0 ? items : [];
}

function _handleStructuredListCopy(event, host) {
  const selectedItems = _getSelectedListItems(host);
  if (selectedItems.length === 0) return;

  event.preventDefault();
  event.stopPropagation();

  const serialized = _serializeListItemsForClipboard(selectedItems);
  const plainText = selectedItems.map((item) => item.textContent).join("\n");

  event.clipboardData.setData("application/x-slideforge-list", serialized);
  event.clipboardData.setData("text/plain", plainText);
  event.clipboardData.setData(
    "text/html",
    selectedItems.map((item) => item.innerHTML).join("<br>"),
  );
}

function _handleStructuredListCut(event, host) {
  _handleStructuredListCopy(event, host);
  const selectedItems = _getSelectedListItems(host);
  if (selectedItems.length === 0) return;

  selectedItems.forEach((item) => item.remove());
  _refreshStructuredBulletEditorMarkers(host);
  _commitStructuredBulletEditorChange(host);
}

function _handleStructuredListPaste(event, host) {
  event.preventDefault();
  event.stopPropagation();

  const clipboardData = event.clipboardData;
  if (!clipboardData) return;

  const customData = clipboardData.getData("application/x-slideforge-list");
  if (customData) {
    const items = _deserializeListItemsFromClipboard(customData);
    if (items && Array.isArray(items)) {
      _insertDeserializedListItems(host, items);
      return;
    }
  }

  const htmlData = clipboardData.getData("text/html");
  if (
    htmlData &&
    (htmlData.includes("<li>") ||
      htmlData.includes("<ul>") ||
      htmlData.includes("<ol>"))
  ) {
    const items = _convertHtmlListToStructured(htmlData);
    if (items.length > 0) {
      _insertDeserializedListItems(host, items);
      return;
    }
  }

  const plainText = clipboardData.getData("text/plain");
  if (plainText) {
    _insertPlainTextAsListItems(host, plainText);
  }
}

function _convertHtmlListToStructured(htmlStr) {
  const items = [];
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = DOMPurify.sanitize(htmlStr);

  const processListElement = (el, baseLevel = 0) => {
    if (el.tagName === "UL" || el.tagName === "OL") {
      const isOrdered = el.tagName === "OL";
      const children = Array.from(el.children);
      const liElements = children.filter((c) => c.tagName === "LI");

      liElements.forEach((li, idx) => {
        const nestedLists = Array.from(li.children).filter(
          (child) => child.tagName === "UL" || child.tagName === "OL",
        );
        const textClone = li.cloneNode(true);
        textClone.querySelectorAll("ul, ol").forEach((list) => list.remove());
        const textContent = (textClone.textContent || "").trim();

        if (textContent) {
          items.push({
            level: baseLevel,
            kind: isOrdered ? "numbered" : "bullet",
            style: "default",
            ordinal: isOrdered ? idx + 1 : 0,
            textContent,
            html: escapeHtml(textContent),
          });
        }

        nestedLists.forEach((nestedList) =>
          processListElement(nestedList, baseLevel + 1),
        );
      });
    }
  };

  Array.from(tempDiv.children).forEach((child) => processListElement(child, 0));
  return items;
}

function _createStructuredEditorListItem({
  html = "",
  textContent = "",
  level = 0,
} = {}) {
  const item = document.createElement("li");
  item.className = "ppt-bullet-edit-item";
  item.dataset.level = String(Math.max(0, Math.min(8, Number(level) || 0)));
  item.innerHTML =
    html && typeof sanitizeTextHtml === "function"
      ? sanitizeTextHtml(html)
      : html
        ? String(html)
        : escapeHtml(textContent || "");
  if (!item.textContent.trim() && !item.querySelector("br,img,svg,math")) {
    item.innerHTML = "<br>";
  }
  return item;
}

function _parsePlainTextListLine(line, fallbackLevel = 0) {
  const raw = String(line || "").replace(/\r/g, "");
  const leading = raw.match(/^[\t ]*/)?.[0] || "";
  const tabLevel = (leading.match(/\t/g) || []).length;
  const spaceLevel = Math.floor((leading.replace(/\t/g, "").length || 0) / 2);
  const markerPattern = /^(\s*)(?:[-*+•◦▪–—]\s+|\d+[.)]\s+|[a-zA-Z][.)]\s+)/;
  const text = raw.replace(markerPattern, "").trim();
  return {
    level: Math.max(0, Math.min(8, tabLevel + spaceLevel || fallbackLevel)),
    textContent: text || raw.trim(),
  };
}

function _insertPlainTextAsListItems(host, plainText) {
  const item = _getActiveStructuredBulletListItem(host);
  if (!item) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  let range = selection.getRangeAt(0);
  if (!item.contains(range.startContainer)) return;

  const value = String(plainText || "").replace(/\r\n?/g, "\n");
  if (!value.includes("\n")) {
    if (!range.collapsed) range.deleteContents();
    const textNode = document.createTextNode(value);
    range.insertNode(textNode);
    range = document.createRange();
    range.setStart(textNode, textNode.textContent.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    _commitStructuredBulletEditorChange(host);
    return;
  }

  if (!range.collapsed) {
    range.deleteContents();
    range = selection.getRangeAt(0);
  }

  const caretOffset = _getTextOffsetWithinElement(
    item,
    range.startContainer,
    range.startOffset,
  );
  const currentText = plainTextFromHtmlSnippet(item.innerHTML);
  const beforeText = currentText.slice(0, caretOffset);
  const afterText = currentText.slice(caretOffset);
  const rawLines = value.split("\n");
  const baseLevel = Number(item.dataset.level) || 0;
  const firstText = rawLines[0] || "";
  const lastIndex = rawLines.length - 1;

  item.textContent = `${beforeText}${firstText}`;
  let previousItem = item;
  let caretItem = item;
  let caretOffsetInItem = item.textContent.length;

  rawLines.slice(1).forEach((line, idx) => {
    const isLast = idx + 1 === lastIndex;
    const parsed = _parsePlainTextListLine(line, baseLevel);
    const text = `${parsed.textContent}${isLast ? afterText : ""}`;
    if (!text.trim() && !isLast) return;
    const newItem = _createStructuredEditorListItem({
      textContent: text,
      level: parsed.level,
    });
    previousItem.insertAdjacentElement("afterend", newItem);
    previousItem = newItem;
    caretItem = newItem;
    caretOffsetInItem = parsed.textContent.length;
  });

  _refreshStructuredBulletEditorMarkers(host);
  _placeCaretAtTextOffset(caretItem, caretOffsetInItem);
  _commitStructuredBulletEditorChange(host);
}

function _insertDeserializedListItems(host, items) {
  const targetItem = _getActiveStructuredBulletListItem(host);
  if (!targetItem || items.length === 0) return;

  let previousItem = targetItem;

  for (let i = 0; i < items.length; i++) {
    const data = items[i];
    const newItem = _createStructuredEditorListItem({
      html: data.html,
      textContent: data.textContent,
      level: data.level,
    });

    if (i === 0) {
      targetItem.replaceWith(newItem);
      previousItem = newItem;
    } else {
      previousItem.insertAdjacentElement("afterend", newItem);
      previousItem = newItem;
    }
  }

  _refreshStructuredBulletEditorMarkers(host);
  _placeCaretInListItemText(previousItem);
  _commitStructuredBulletEditorChange(host);
}

function _adjustStructuredIndentation(el, direction) {
  if (_getStructuredEditorMode(el) === "list") {
    const item = _getActiveStructuredBulletListItem(el);
    if (!item) return;
    const nextLevel = Math.max(
      0,
      Math.min(8, (Number(item.dataset.level) || 0) + direction),
    );
    item.dataset.level = String(nextLevel);
    _refreshStructuredBulletEditorMarkers(el);
    _commitStructuredBulletEditorChange(el);
    return;
  }

  const value = (el.textContent || "").replace(/\r/g, "");
  const { start, end } = _getStructuredSelectionOffsets(el);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const selectedBlock = value.slice(lineStart, lineEnd);
  const lines = selectedBlock.split("\n");

  const bulletStyle = _getStructuredEditorBulletStyle(el);
  const updated = lines.map((line) => {
    if (!line.trim()) return line;
    const parsed = stripEditableBulletPrefix(line);
    const nextLevel = Math.max(0, Math.min(8, parsed.level + direction));
    return `${getEditableBulletPrefix(nextLevel, bulletStyle)}${parsed.text}`;
  });

  const nextBlock = updated.join("\n");
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
  const delta = nextBlock.length - selectedBlock.length;
  _updateStructuredEditorText(
    el,
    nextValue,
    start + (direction > 0 ? 2 : Math.max(-2, delta)),
    end + delta,
  );
}

function _insertStructuredLineBreak(el) {
  const value = (el.textContent || "").replace(/\r/g, "");
  const { start, end } = _getStructuredSelectionOffsets(el);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", start);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const currentLine = value.slice(lineStart, lineEnd);
  const bulletStyle = _getStructuredEditorBulletStyle(el);
  const parsed = stripEditableBulletPrefix(currentLine);
  const prefix = getEditableBulletPrefix(parsed.level, bulletStyle);
  const nextValue = `${value.slice(0, start)}\n${prefix}${value.slice(end)}`;
  const nextCaret = start + 1 + prefix.length;
  _updateStructuredEditorText(el, nextValue, nextCaret, nextCaret);
}

function _handleStructuredBackspace(el) {
  const value = (el.textContent || "").replace(/\r/g, "");
  const { start, end } = _getStructuredSelectionOffsets(el);
  if (start !== end) return false;

  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", start);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const currentLine = value.slice(lineStart, lineEnd);
  const bulletStyle = _getStructuredEditorBulletStyle(el);
  const parsed = stripEditableBulletPrefix(currentLine);
  const prefix = getEditableBulletPrefix(parsed.level, bulletStyle);

  if (currentLine !== prefix || start < lineStart + prefix.length) {
    return false;
  }

  const nextValue = `${value.slice(0, lineStart)}${value.slice(lineEnd)}`;
  const nextCaret = lineStart;
  _updateStructuredEditorText(el, nextValue, nextCaret, nextCaret);
  return true;
}
