// Text element content and inline text editing.

function commitActiveTextEditors() {
  let committed = false;
  document
    .querySelectorAll(".canvas-element[data-type='text']")
    .forEach((dom) => {
      const contentHost = dom.querySelector(".text-element-content");
      if (!contentHost) return;
      const isEditing =
        contentHost.isContentEditable ||
        contentHost.contentEditable === "true" ||
        dom.classList.contains("editing-text") ||
        contentHost.dataset.structuredEdit === "true";
      if (!isEditing) return;
      const slideIndex = Number(
        dom.closest(".presentation-slide")?.dataset?.slideIndex,
      );
      const slide = Number.isInteger(slideIndex)
        ? state.slides?.[slideIndex]
        : state.slides?.[currentSlideIndex];
      const elData = slide?.elements?.find((item) => item.id === dom.id);
      if (!elData || elData.type !== "text" || elData.iconMode) return;

      const nextContent =
        contentHost.dataset.structuredEdit === "true"
          ? _getStructuredEditorMode(contentHost) === "list"
            ? parseStructuredBulletEditorHtml(contentHost)
            : parseEditableStructuredText(
                contentHost.textContent || "",
                elData.content,
              )
          : contentHost.innerHTML;
      const nextTextDocument =
        typeof createTextDocumentFromLegacyContent === "function"
          ? createTextDocumentFromLegacyContent(nextContent, {
              bulletStyle: elData.bulletStyle || "default",
            })
          : elData.textDocument;
      updateElementState?.(elData.id, {
        content: nextContent,
        textDocument: nextTextDocument,
      });
      elData.content = nextContent;
      elData.textDocument = nextTextDocument;
      committed = true;
      contentHost.contentEditable = "false";
      delete contentHost.dataset.structuredEdit;
      delete contentHost.dataset.structuredEditMode;
      delete contentHost.dataset.structuredEditBulletStyle;
      dom.classList.remove("cursor-text", "editing-text");
      clearActiveInlineEditor?.(contentHost);
    });
  if (committed) schedulePresentationAutosave?.(150);
}

window.commitActiveTextEditors = commitActiveTextEditors;

function _applyTextTypeContent(el, elData, options) {
  if (!elData.iconMode && typeof ensureElementTextDocument === "function") {
    ensureElementTextDocument(elData);
  }
  _installStructuredEditorShortcuts();
  const contentHost = document.createElement("div");
  contentHost.className = "text-element-content";
  if (elData.iconMode) {
    contentHost.classList.add("icon-mode-content");
    el.classList.add("icon-mode-element");
  }
  contentHost.tabIndex = 0;
  if (elData.iconMode) {
    renderIconContentHost(contentHost, elData);
  } else {
    contentHost.innerHTML = DOMPurify.sanitize(renderTextContent(elData));
  }
  _applyBulletFragmentAnimation(contentHost, elData);
  if (elData.placeholder && !options.forPreview) {
    contentHost.dataset.placeholder = String(elData.placeholder).slice(0, 120);
    // Empty means no typed text; bullet markers do not count.
    const syncPlaceholder = () => {
      const markers = Array.from(contentHost.querySelectorAll(".ppt-bullet-marker"), (m) => m.textContent).join("");
      const typed = contentHost.textContent.replace(/\s/g, "").length - markers.replace(/\s/g, "").length;
      contentHost.classList.toggle("is-empty", typed <= 0);
      if (!contentHost.isConnected) return;
      const style = getComputedStyle(contentHost);
      contentHost.style.setProperty("--placeholder-left", style.paddingLeft);
      contentHost.style.setProperty("--placeholder-top", style.paddingTop);
    };
    syncPlaceholder();
    requestAnimationFrame(syncPlaceholder);
    contentHost.addEventListener("input", syncPlaceholder);
  }
  el.appendChild(contentHost);
  requestAnimationFrame(() => {
    const layout = syncTextBoxLayout(el, elData);
    if (
      !options.preserveState &&
      layout?.autoHeight &&
      Number.isFinite(layout.height)
    ) {
      updateElementState(el.id, { height: `${layout.height}px` });
      elData.height = `${layout.height}px`;
    }
  });

  const restoreInlineTextContent = () => {
    if (contentHost.dataset.editingSnapshotContent == null) return;
    const snapshotContentRaw = contentHost.dataset.editingSnapshotContent;
    const snapshotWasStructured =
      contentHost.dataset.editingSnapshotContentType === "structured";
    let snapshotContent = snapshotContentRaw;
    if (snapshotWasStructured) {
      const parsedStructured =
        typeof parseStringifiedStructuredBulletContent === "function"
          ? parseStringifiedStructuredBulletContent(snapshotContentRaw)
          : null;
      if (parsedStructured) {
        snapshotContent = parsedStructured;
      } else {
        try {
          const parsed = JSON.parse(snapshotContentRaw);
          if (Array.isArray(parsed)) snapshotContent = parsed;
        } catch (error) {
          snapshotContent = [];
        }
      }
    }
    const snapshotTextDocument =
      contentHost.dataset.editingSnapshotTextDocument;
    if (JSON.stringify(snapshotContent) !== JSON.stringify(elData.content)) {
      updateElementState(el.id, {
        content: snapshotContent,
        ...(snapshotTextDocument
          ? { textDocument: JSON.parse(snapshotTextDocument) }
          : {}),
      });
      elData.content = snapshotContent;
      if (snapshotTextDocument) {
        elData.textDocument = JSON.parse(snapshotTextDocument);
      }
    }
    if (contentHost.dataset.structuredEdit === "true") {
      contentHost.innerHTML = renderTextContent({
        ...elData,
        content: snapshotContent,
      });
    } else {
      contentHost.innerHTML = snapshotContent;
    }
  };

  const beginInlineTextEdit = ({ preserveSelection = false } = {}) => {
    if (document.body.classList.contains("play-mode-active")) return;
    // The box's data as it is now: this closure holds the copy the box was drawn from, and a bullet style (or
    // font, colour, content) changed in Properties since then reached only the live element. Editing started from
    // the old copy's "default" bullets, and the next change saved them over the user's style.
    const live = state.slides?.[currentSlideIndex]?.elements?.find((item) => item.id === elData.id);
    if (live && live !== elData) {
      ["bulletStyle", "content", "textDocument", "styles"].forEach((key) => {
        if (live[key] !== undefined) elData[key] = live[key];
      });
    }
    if (elData.iconMode) return;
    if (elData.footerRole === "slide-number") return; // numbered automatically; typing would be overwritten
    if (contentHost.contentEditable === "true") {
      if (preserveSelection) {
        requestAnimationFrame(() =>
          _focusEditableHost(contentHost, { preserveSelection: true }),
        );
      }
      return;
    }
    selectElement(elData.id, "replace");
    let isStructured = isStructuredBulletContent(elData.content);

    let targetRowIndex = -1;
    let targetCaretOffset = 0;
    if (isStructured) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const clickedRow =
          range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement.closest(".ppt-bullet-row")
            : range.startContainer.closest?.(".ppt-bullet-row");
        if (clickedRow) {
          const rows = Array.from(
            contentHost.querySelectorAll(".ppt-bullet-row"),
          );
          targetRowIndex = rows.indexOf(clickedRow);
          const textSpan =
            clickedRow.querySelector(".ppt-bullet-text") || clickedRow;
          targetCaretOffset = _getTextOffsetWithinElement(
            textSpan,
            range.startContainer,
            range.startOffset,
          );
        }
      }
    }

    if (isStructured) {
      contentHost.dataset.structuredEdit = "true";
      contentHost.dataset.structuredEditMode = "list";
      contentHost.dataset.structuredEditBulletStyle =
        elData.bulletStyle || "default";
      contentHost.dataset.structuredEditPreviousTextAlign =
        contentHost.style.textAlign || "";
      contentHost.style.setProperty("text-align", structuredEditTextAlign(elData), "important");
      contentHost.innerHTML = buildStructuredBulletEditorHtml(
        elData.content,
        elData.bulletStyle || "default",
      );
    }
    contentHost.dataset.editingSnapshotContent =
      typeof elData.content === "string"
        ? elData.content
        : JSON.stringify(elData.content);
    contentHost.dataset.editingSnapshotContentType =
      isStructured ? "structured" : "html";
    contentHost.dataset.editingSnapshotTextDocument = elData.textDocument
      ? JSON.stringify(elData.textDocument)
      : "";
    contentHost.contentEditable = true;
    contentHost.spellcheck = true;
    if (!isStructured) {
      setActiveInlineEditor(contentHost);
    }
    syncTextBoxLayout(el, elData);
    el.classList.add("cursor-text", "editing-text");
    interact(el).draggable(false);
    interact(el).resizable(false);
    requestAnimationFrame(() => {
      if (isStructured && targetRowIndex !== -1) {
        const items = contentHost.querySelectorAll(".ppt-bullet-edit-item");
        const targetItem = items[targetRowIndex];
        if (targetItem) {
          contentHost.focus();
          _placeCaretAtTextOffset(targetItem, targetCaretOffset);
        } else {
          _focusEditableHost(contentHost, {
            placeCaretAtEnd: !preserveSelection,
            preserveSelection,
          });
        }
      } else {
        _focusEditableHost(contentHost, {
          placeCaretAtEnd: !preserveSelection,
          preserveSelection,
        });
      }
      if (!isStructured) {
        captureInlineSelection();
      }
      resetTypingHistory();
      updateFloatingToolbars?.();
      buildPropertiesPanel?.();
    });
  };

  el.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    beginInlineTextEdit({ preserveSelection: true });
  });
  contentHost.addEventListener("mousedown", (e) => {
    if (!contentHost.isContentEditable) return;
    e.stopPropagation();
  });
  // Where the pointer went down, so the click that ends a drag does not also start editing.
  let pointerDownAt = null;
  el.addEventListener(
    "pointerdown",
    (e) => {
      pointerDownAt = { x: e.clientX, y: e.clientY };
    },
    true,
  );
  contentHost.addEventListener("click", (e) => {
    if (document.body.classList.contains("play-mode-active")) return;
    if (elData.iconMode) return;
    e.stopPropagation();
    if (contentHost.contentEditable === "true") return;
    const moved = pointerDownAt && Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) > 4;
    pointerDownAt = null;
    if (moved) return; // that was a drag of the box
    // Shift/Ctrl+click adds the box to the selection (or takes it out); it must not start editing, which also
    // dropped the rest of the selection.
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (state.selectedIds.includes(elData.id)) {
      beginInlineTextEdit({ preserveSelection: true });
    }
  });
  el.addEventListener("dragstart", (e) => {
    if (!el.classList.contains("editing-text")) return;
    e.preventDefault();
  });
  contentHost.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      // Like PowerPoint and Google Slides: Escape leaves the text box and keeps what was typed.
      e.preventDefault();
      e.stopPropagation();
      contentHost.blur();
      return;
    }
    if (contentHost.dataset.structuredEdit !== "true") {
      // Plain text: Tab is a tab character, as in PowerPoint. Left to the browser it moved focus out of the box,
      // and whatever was typed next was lost.
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.shiftKey) document.execCommand("insertText", false, "\t");
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      _adjustStructuredIndentation(contentHost, e.shiftKey ? -1 : 1);
    }
  });
  const refreshInlineEditingUi = () => {
    captureInlineSelection?.();
    updateFloatingToolbars?.();
    // Do not call buildPropertiesPanel here — it fires on every keystroke
    // and causes the panel to jump to top. The panel rebuilds on commit (blur).
  };
  contentHost.addEventListener("keyup", refreshInlineEditingUi);
  contentHost.addEventListener("mouseup", refreshInlineEditingUi);
  contentHost.addEventListener("focus", refreshInlineEditingUi);
  // Word-by-word undo while typing, as in Word or PowerPoint (the browser's own text undo is unpredictably coarse:
  // it may take back one letter or everything typed since the caret last moved). A snapshot is taken when a new
  // word starts, when switching between typing and deleting, before formatting and after a pause.
  let typingHistory = [];
  let typingFuture = [];
  let lastTypingAt = 0;
  let lastTypingKind = "";
  const typingSnapshot = () => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const caret =
      range && contentHost.contains(range.startContainer)
        ? _getTextOffsetWithinElement(contentHost, range.startContainer, range.startOffset)
        : contentHost.textContent.length;
    return { html: contentHost.innerHTML, caret };
  };
  const recordTypingSnapshot = () => {
    const snapshot = typingSnapshot();
    if (typingHistory.at(-1)?.html !== snapshot.html) typingHistory.push(snapshot);
    if (typingHistory.length > 300) typingHistory.shift();
    typingFuture = [];
  };
  const resetTypingHistory = () => {
    typingHistory = [];
    typingFuture = [];
    lastTypingAt = 0;
    lastTypingKind = "";
  };
  const applyTypingSnapshot = (snapshot) => {
    contentHost.innerHTML = snapshot.html;
    _placeCaretAtTextOffset(contentHost, snapshot.caret);
    lastTypingAt = 0;
    lastTypingKind = "";
    contentHost.dispatchEvent(new Event("input", { bubbles: true })); // updates the slide state like typing does
  };
  contentHost._recordTypingSnapshot = recordTypingSnapshot;
  contentHost._typingUndo = () => {
    if (!contentHost.isContentEditable) return false;
    const current = typingSnapshot();
    let previous = typingHistory.pop();
    while (previous && previous.html === current.html) previous = typingHistory.pop();
    if (!previous) return false;
    typingFuture.push(current);
    applyTypingSnapshot(previous);
    return true;
  };
  contentHost._typingRedo = () => {
    if (!contentHost.isContentEditable) return false;
    const next = typingFuture.pop();
    if (!next) return false;
    const future = typingFuture;
    typingHistory.push(typingSnapshot());
    applyTypingSnapshot(next);
    typingFuture = future;
    return true;
  };
  contentHost.addEventListener(
    "beforeinput",
    (e) => {
      if (!contentHost.isContentEditable) return;
      if (e.inputType === "historyUndo" || e.inputType === "historyRedo") return;
      const kind = e.inputType.startsWith("delete")
        ? "delete"
        : e.inputType.startsWith("format")
          ? "format"
          : "insert";
      const wordBoundary =
        kind === "insert" &&
        (/^\s+$/.test(e.data || "") ||
          e.inputType === "insertParagraph" ||
          e.inputType === "insertLineBreak");
      const now = Date.now();
      let snapshot = !typingHistory.length || now - lastTypingAt > 1500 || kind === "format";
      if (kind === "insert" && !wordBoundary) snapshot ||= lastTypingKind !== "insert";
      if (kind === "delete") snapshot ||= lastTypingKind !== "delete";
      if (wordBoundary) snapshot ||= lastTypingKind === "delete" || lastTypingKind === "format";
      if (snapshot) recordTypingSnapshot();
      else typingFuture = [];
      lastTypingAt = now;
      lastTypingKind = wordBoundary ? "boundary" : kind;
    },
    true,
  );
  contentHost.addEventListener("beforeinput", (e) => {
    if (
      !contentHost.isContentEditable ||
      contentHost.dataset.structuredEdit === "true"
    )
      return;
    if (e.inputType === "insertParagraph") {
      // Inside a numbered list Enter starts the next item; elsewhere it is a line break.
      const anchor = window.getSelection()?.anchorNode;
      const anchorElement = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      if (anchorElement?.closest?.("li") && contentHost.contains(anchorElement)) return;
      e.preventDefault();
      document.execCommand?.("insertLineBreak");
    }
  });
  contentHost.addEventListener("paste", (e) => {
    if (
      !contentHost.isContentEditable ||
      contentHost.dataset.structuredEdit === "true"
    )
      return;
    e.stopPropagation();
  });
  contentHost.addEventListener("input", () => {
    if (contentHost.dataset.undoSnapshotCaptured !== "true") {
      saveStateToUndo();
      contentHost.dataset.undoSnapshotCaptured = "true";
    }
    if (contentHost.dataset.structuredEdit === "true") {
      const nextContent =
        _getStructuredEditorMode(contentHost) === "list"
          ? parseStructuredBulletEditorHtml(contentHost, {
              preserveTrailingEmpty: true,
            })
          : parseEditableStructuredText(
              contentHost.textContent || "",
              elData.content,
            );
      const nextTextDocument =
        typeof createTextDocumentFromLegacyContent === "function"
          ? createTextDocumentFromLegacyContent(nextContent, {
              bulletStyle: elData.bulletStyle || "default",
            })
          : elData.textDocument;
      updateElementState(el.id, {
        content: nextContent,
        textDocument: nextTextDocument,
      });
      elData.content = nextContent;
      elData.textDocument = nextTextDocument;
    } else {
      const nextHtml = contentHost.innerHTML;
      const nextTextDocument =
        typeof createTextDocumentFromLegacyContent === "function"
          ? createTextDocumentFromLegacyContent(nextHtml, {
              bulletStyle: elData.bulletStyle || "default",
            })
          : elData.textDocument;
      updateElementState(el.id, {
        content: nextHtml,
        textDocument: nextTextDocument,
      });
      elData.content = nextHtml;
      elData.textDocument = nextTextDocument;
      captureInlineSelection();
    }
    updateFloatingToolbars?.();
    // Skip panel rebuild on every input — it resets scroll during typing.
    const layout = syncTextBoxLayout(el, elData);
    if (layout?.autoHeight && Number.isFinite(layout.height)) {
      updateElementState(el.id, { height: `${layout.height}px` });
      elData.height = `${layout.height}px`;
    }
  });
  // Ends the inline edit: commits the text and leaves edit mode (at most once per edit).
  const finishInlineEdit = () => {
    if (contentHost.contentEditable !== "true") return;
    resetTypingHistory();
    contentHost.removeAttribute("spellcheck");
    if (contentHost.dataset.cancelEdit === "true") {
      delete contentHost.dataset.cancelEdit;
      restoreInlineTextContent();
      delete contentHost.dataset.undoSnapshotCaptured;
      delete contentHost.dataset.editingSnapshotContent;
      delete contentHost.dataset.editingSnapshotContentType;
      delete contentHost.dataset.editingSnapshotTextDocument;
      delete contentHost.dataset.structuredEdit;
      delete contentHost.dataset.structuredEditMode;
      delete contentHost.dataset.structuredEditBulletStyle;
      delete contentHost.dataset.structuredEditPreviousTextAlign;
      contentHost.contentEditable = false;
      clearActiveInlineEditor(contentHost);
      el.classList.remove("cursor-text", "editing-text");
      updateFloatingToolbars?.();
      buildPropertiesPanel?.();
      interact(el).draggable(true);
      interact(el).resizable(true);
      return;
    }
    if (contentHost.dataset.structuredEdit === "true") {
      const nextStructured =
        _getStructuredEditorMode(contentHost) === "list"
          ? parseStructuredBulletEditorHtml(contentHost)
          : parseEditableStructuredText(
              contentHost.textContent || "",
              elData.content,
            );
      const nextContent = nextStructured.length
        ? nextStructured
        : [normalizeStructuredBulletItem({ html: "", level: 0 })];
      if (
        JSON.stringify(nextContent) !== JSON.stringify(elData.content) &&
        contentHost.dataset.undoSnapshotCaptured !== "true"
      ) {
        saveStateToUndo();
        contentHost.dataset.undoSnapshotCaptured = "true";
      }
      // Preserve the bullet style that was active during this edit session.
      const committedBulletStyle =
        contentHost.dataset.structuredEditBulletStyle ||
        elData.bulletStyle ||
        "default";
      updateElementState(el.id, {
        content: nextContent,
        bulletStyle: committedBulletStyle,
      });
      elData.content = nextContent;
      elData.bulletStyle = committedBulletStyle;
      if (typeof createTextDocumentFromLegacyContent === "function") {
        elData.textDocument = createTextDocumentFromLegacyContent(
          nextContent,
          {
            bulletStyle: elData.bulletStyle || "default",
          },
        );
        updateElementState(el.id, { textDocument: elData.textDocument });
      }
      delete contentHost.dataset.structuredEdit;
      delete contentHost.dataset.structuredEditMode;
      delete contentHost.dataset.structuredEditBulletStyle;
      const previousTextAlign =
        contentHost.dataset.structuredEditPreviousTextAlign || "";
      delete contentHost.dataset.structuredEditPreviousTextAlign;
      if (previousTextAlign) {
        contentHost.style.setProperty("text-align", previousTextAlign);
      } else {
        contentHost.style.removeProperty("text-align");
      }
      contentHost.innerHTML = renderTextContent({
        ...elData,
        content: nextContent,
      });
      contentHost.style.whiteSpace = "";
    } else {
      const nextHtml = contentHost.innerHTML;
      const nextTextDocument =
        typeof createTextDocumentFromLegacyContent === "function"
          ? createTextDocumentFromLegacyContent(nextHtml, {
              bulletStyle: elData.bulletStyle || "default",
            })
          : elData.textDocument;
      updateElementState(el.id, {
        content: nextHtml,
        textDocument: nextTextDocument,
      });
      elData.content = nextHtml;
      elData.textDocument = nextTextDocument;
    }
    const layout = syncTextBoxLayout(el, elData);
    if (layout?.autoHeight && Number.isFinite(layout.height)) {
      updateElementState(el.id, { height: `${layout.height}px` });
      elData.height = `${layout.height}px`;
    }
    delete contentHost.dataset.undoSnapshotCaptured;
    delete contentHost.dataset.editingSnapshotContent;
    delete contentHost.dataset.editingSnapshotContentType;
    delete contentHost.dataset.editingSnapshotTextDocument;
    contentHost.contentEditable = false;
    clearActiveInlineEditor(contentHost);
    el.classList.remove("cursor-text", "editing-text");
    updateFloatingToolbars?.();
    buildPropertiesPanel?.();
    interact(el).draggable(true);
    interact(el).resizable(true);
    // The thumbnail kept showing the old text until some other change redrew it.
    refreshPreviews?.();
    if (typeof schedulePresentationAutosave === "function") {
      schedulePresentationAutosave();
    }
  };
  contentHost.addEventListener("blur", (e) => {
    if (shouldKeepInlineEditorOpen(e)) {
      // Focus went to the properties panel or the floating toolbar, so the edit stays open for them; it ends
      // on the next Escape or on a click anywhere outside the text, the panel and the toolbar.
      _finishInlineEditWhenUserLeaves(contentHost, finishInlineEdit);
      return;
    }
    finishInlineEdit();
  });
}

function _finishInlineEditWhenUserLeaves(contentHost, finishInlineEdit) {
  if (contentHost._inlineEditExitWatch) return;
  const keepsEditOpen = (target) =>
    target?.closest?.(
      "#properties-panel, #floating-text-toolbar, #symbol-picker-modal, [data-preserve-inline-selection='true']",
    );
  const stop = () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    delete contentHost._inlineEditExitWatch;
  };
  const leave = () => {
    stop();
    // A re-render replaced this text box; the new one holds the current state already.
    if (contentHost.isConnected) finishInlineEdit();
  };
  const onPointerDown = (event) => {
    if (contentHost.contains(event.target)) return stop(); // back in the text; its own blur takes over
    if (!keepsEditOpen(event.target)) leave();
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || document.activeElement === contentHost) return;
    if (keepsEditOpen(document.activeElement) && document.activeElement.matches?.("input, select, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    leave();
  };
  const onFocusIn = (event) => {
    if (event.target === contentHost) stop();
  };
  contentHost._inlineEditExitWatch = true;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
}
