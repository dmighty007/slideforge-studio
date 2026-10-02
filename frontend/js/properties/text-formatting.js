// Properties panel: text formatting, text effects/shadows and inline formatting guards.

function getActiveInlineTextContext(data = getSelectedElementData()) {
  if (!data || data.type !== "text") return null;
  const dom = document.getElementById(data.id);
  if (!dom) return null;
  const editor = dom.querySelector(".text-element-content");
  if (!editor) return null;

  // Check if the editor is in edit mode (either attribute or class based)
  const isEditing =
    editor.contentEditable === "true" ||
    dom.classList.contains("editing-text") ||
    (typeof getActiveInlineEditor === "function" &&
      editor === getActiveInlineEditor());

  if (isEditing) {
    if (editor.contentEditable !== "true") {
      editor.contentEditable = "true";
    }
    if (typeof setActiveInlineEditor === "function") {
      setActiveInlineEditor(editor);
    }
    return { editor, dom, data };
  }
  return null;
}

function markTextElementStyleAsLocal(data, prop, force = false) {
  if (!data || data.type !== "text") return;
  const localTextStyleProps = new Set([
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "textDecoration",
    "textAlign",
    "lineHeight",
    "textShadow",
    "textStrokeWidth",
    "textStrokeColor",
  ]);
  if (!localTextStyleProps.has(prop)) return;
  if (data.themeManaged === false) return;
  if (force) {
    updateElementState(data.id, { themeManaged: false });
    data.themeManaged = false;
    return;
  }
  const theme =
    typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
  const currentValue = String(data.styles?.[prop] || "")
    .trim()
    .toLowerCase();
  if (prop === "color") {
    const normalizedThemeColors = new Set(
      [
        theme?.defaultTextColor,
        theme?.defaultMutedColor,
        theme?.accentStrong,
        theme?.defaultShapeColor,
        theme?.cssVars?.["--slide-accent"],
        theme?.cssVars?.["--slide-accent-2"],
      ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase()),
    );
    if (normalizedThemeColors.has(currentValue)) return;
  } else {
    const defaults = getThemeTextStyleDefaults();
    const defaultValue = String(defaults?.[prop] || "")
      .trim()
      .toLowerCase();
    if (currentValue && defaultValue && currentValue === defaultValue) return;
  }
  updateElementState(data.id, { themeManaged: false });
  data.themeManaged = false;
}

function _normalizeStrokeWidthValue(value, fallback = "0px") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const num = Number.parseFloat(raw.replace("px", ""));
  return Number.isFinite(num) && num >= 0 ? `${num}px` : fallback;
}

function _parseTextShadowValue(value) {
  const fallback = { offsetX: 0, offsetY: 0, blur: 0, color: "#000000" };
  if (!value || value === "none") return fallback;
  const match = String(value)
    .trim()
    .match(
      /^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)$/i,
    );
  if (!match) return fallback;
  return {
    offsetX: Number(match[1]) || 0,
    offsetY: Number(match[2]) || 0,
    blur: Math.max(0, Number(match[3]) || 0),
    color: _normalizeColorForInput(match[4], "#000000"),
  };
}

function _buildTextShadowValue(offsetX, offsetY, blur, color) {
  const x = Number(offsetX) || 0;
  const y = Number(offsetY) || 0;
  const b = Math.max(0, Number(blur) || 0);
  const c = _normalizeColorForInput(color, "#000000");
  if (x === 0 && y === 0 && b === 0) return "none";
  return `${x}px ${y}px ${b}px ${c}`;
}

function _buildTextEffectPresetMap(data) {
  const theme =
    typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
  const themeId = typeof state !== "undefined" ? state.presentationTheme : "";
  const accent = _normalizeColorForInput(theme?.accentStrong, "#2563eb");
  const textColor = _normalizeColorForInput(data?.styles?.color, "#172033");
  const fontSize =
    parseFloat(String(data?.styles?.fontSize || "32").replace("px", "")) || 32;
  const isTitleLike = fontSize >= 40;
  return {
    none: {
      textShadow: "none",
      textStrokeWidth: "0px",
      textStrokeColor: "#000000",
    },
    soft: {
      textShadow: _buildTextShadowValue(0, 2, 10, "#00000044"),
      textStrokeWidth: "0px",
      textStrokeColor: "#000000",
    },
    dramatic: {
      textShadow: _buildTextShadowValue(0, 5, 18, "#00000088"),
      textStrokeWidth: "0px",
      textStrokeColor: "#000000",
    },
    glow: {
      textShadow: _buildTextShadowValue(
        0,
        0,
        isTitleLike ? 18 : 12,
        `${accent}cc`,
      ),
      textStrokeWidth: "0px",
      textStrokeColor: accent,
    },
    outline: {
      textShadow: "none",
      textStrokeWidth: isTitleLike ? "2px" : "1px",
      textStrokeColor: textColor === "#ffffff" ? "#111827" : "#ffffff",
    },
    auto: {
      textShadow: isTitleLike
        ? _buildTextShadowValue(
            0,
            4,
            16,
            themeId === "chalkboard" ? "#00000066" : "#00000055",
          )
        : _buildTextShadowValue(0, 2, 8, "#00000033"),
      textStrokeWidth: themeId === "chalkboard" && isTitleLike ? "1px" : "0px",
      textStrokeColor: themeId === "chalkboard" ? "#f6f1d1" : accent,
    },
  };
}

function _applyTextEffectPreset(data, presetName) {
  if (!data || data.type !== "text") return;
  const preset = _buildTextEffectPresetMap(data)[presetName];
  if (!preset) return;
  applyStyle("textShadow", preset.textShadow);
  applyStyle("textStrokeWidth", preset.textStrokeWidth);
  applyStyle("textStrokeColor", preset.textStrokeColor);
}

function applySelectedTextEffectPreset(presetName) {
  const data = getSelectedElementData();
  if (!data || data.type !== "text") return;
  _applyTextEffectPreset(data, presetName);
  buildPropertiesPanel();
}

function _renderTextEffectPresetButton(data, presetName, label) {
  const preset = _buildTextEffectPresetMap(data)[presetName];
  const baseColor = _normalizeColorForInput(data?.styles?.color, "#172033");
  const strokeWidth = _normalizeStrokeWidthValue(
    preset?.textStrokeWidth,
    "0px",
  );
  const strokeColor = _normalizeColorForInput(
    preset?.textStrokeColor,
    "#000000",
  );
  const shadow = preset?.textShadow || "none";
  const swatchStyle = [
    `color:${baseColor}`,
    `text-shadow:${shadow === "none" ? "none" : shadow}`,
    `-webkit-text-stroke-width:${strokeWidth}`,
    `-webkit-text-stroke-color:${strokeColor}`,
  ].join(";");
  return `
        <button type="button" id="prop-effect-${presetName}" class="prop-effect-btn" title="${label}" onclick="applySelectedTextEffectPreset('${presetName}')">
            <span class="prop-effect-swatch" style="${swatchStyle}">Aa</span>
            <span class="prop-effect-label">${label}</span>
        </button>
    `;
}

function getThemeTextStyleDefaults() {
  const theme =
    typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
  return {
    fontFamily: theme?.bodyFont || '"Manrope", sans-serif',
    fontSize: "24px", // body text size, as in the slide's content placeholder
    fontWeight: "normal",
    fontStyle: "normal",
    color: theme?.defaultTextColor || "#2E2E2E",
  };
}

function setTextControlActive(element, isActive) {
  if (!element) return;
  element.classList.toggle("active", Boolean(isActive));
  element.classList.toggle("text-style-active", Boolean(isActive));
}

function bindFontSizeFormattingControl(input) {
  if (!input || input.dataset.fontSizeFormattingBound === "true") return;
  input.dataset.fontSizeFormattingBound = "true";
  bindInlineFormattingGuard(input);

  const commit = () => {
    const raw = String(input.value || "").trim();
    if (!raw) return;
    const nextValue = _normalizePx(raw, "");
    if (!nextValue) return;
    if (input.dataset.lastCommittedValue === nextValue) return;
    input.dataset.lastCommittedValue = nextValue;
    restoreInlineSelection?.();
    applyTextFormatting("fontSize", nextValue, { inlineAction: "fontSize" });
  };

  input.addEventListener("input", () => {
    setTextControlActive(
      input,
      _normalizePx(input.value, "32px") !==
        getThemeTextStyleDefaults().fontSize,
    );
  });
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commit();
    input.blur();
  });
  input.addEventListener("focus", () => input.select());
}

function clearTextFormatting(data = getSelectedElementData()) {
  if (!data || data.type !== "text") return;
  const defaults = getThemeTextStyleDefaults();
  const dom = document.getElementById(data.id);
  const contentHost = dom?.querySelector(".text-element-content");
  const sourceContent = contentHost?.isContentEditable
    ? contentHost.innerHTML
    : data.content;
  const nextContent =
    stripAllInlineTextFormattingFromTextContent(sourceContent);
  const nextStyles = {
    ...data.styles,
    fontFamily: defaults.fontFamily,
    fontSize: defaults.fontSize,
    fontWeight: defaults.fontWeight,
    fontStyle: defaults.fontStyle,
    color: defaults.color,
  };

  saveStateToUndo();
  const nextTextDocument =
    typeof createTextDocumentFromLegacyContent === "function"
      ? createTextDocumentFromLegacyContent(nextContent, {
          bulletStyle: data.bulletStyle || "default",
        })
      : data.textDocument;
  updateElementState(data.id, {
    content: nextContent,
    textDocument: nextTextDocument,
    styles: nextStyles,
    themeManaged: true,
  });
  data.content = nextContent;
  data.textDocument = nextTextDocument;
  data.styles = nextStyles;
  data.themeManaged = true;

  if (contentHost) {
    contentHost.innerHTML = renderTextContent({
      ...data,
      content: nextContent,
    });
    [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "color",
      "textDecoration",
    ].forEach((prop) => {
      _setElementDomStyleProperty(
        contentHost,
        prop,
        nextStyles[prop],
        "important",
      );
      _setElementDomStyleProperty(dom, prop, nextStyles[prop], "important");
    });
    if (contentHost.isContentEditable) {
      const selection = window.getSelection?.();
      const range = document.createRange();
      range.selectNodeContents(contentHost);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      captureInlineSelection?.();
    }
  } else if (dom) {
    syncTextDomContent(data);
  }

  const layout = dom ? syncTextBoxLayout(dom, data) : null;
  if (layout?.autoHeight && Number.isFinite(layout.height)) {
    updateElementState(data.id, { height: `${layout.height}px` });
    data.height = `${layout.height}px`;
  }
  updateFloatingToolbars?.();
  buildPropertiesPanel();
  refreshPreviews?.();
  schedulePresentationAutosave?.(150);
}

function applyTextFormatting(prop, value, options = {}) {
  const data = getSelectedElementData();
  if (!data || data.type !== "text") return;

  const inlineContext = getActiveInlineTextContext(data);
  const isInlineEditingSession = !!document.querySelector(
    ".canvas-element.editing-text .text-element-content[contenteditable='true']",
  );

  if (inlineContext) {
    // We have an active editor context.
    // We MUST restore the selection before checking or applying styles
    // because the focus is likely on the sidebar/color picker now.
    if (typeof restoreInlineSelection === "function") {
      restoreInlineSelection();
    }

    if (
      typeof hasNonCollapsedInlineSelection === "function" &&
      !hasNonCollapsedInlineSelection()
    ) {
      if (
        [
          "fontWeight",
          "fontStyle",
          "fontFamily",
          "fontSize",
          "color",
          "textDecoration",
        ].includes(prop)
      ) {
        applyStyle(prop, value);
      }
      return;
    }

    saveStateToUndo();
    inlineContext.editor.dataset.undoSnapshotCaptured = "true";
    inlineContext.editor._recordTypingSnapshot?.(); // so Ctrl+Z while editing takes back just this formatting
    const success = applyInlineTextStyle(
      options.inlineAction || prop,
      options.inlineValue !== undefined ? options.inlineValue : value,
    );

    if (success) {
      const nextContent =
        inlineContext.editor.dataset.structuredEdit === "true" &&
        _getStructuredEditorMode(inlineContext.editor) === "list"
          ? parseStructuredBulletEditorHtml(inlineContext.editor)
          : inlineContext.editor.innerHTML;
      const nextTextDocument =
        typeof createTextDocumentFromLegacyContent === "function"
          ? createTextDocumentFromLegacyContent(nextContent, {
              bulletStyle: data.bulletStyle || "default",
            })
          : data.textDocument;
      updateElementState(data.id, {
        content: nextContent,
        textDocument: nextTextDocument,
      });
      data.content = nextContent;
      data.textDocument = nextTextDocument;
      markTextElementStyleAsLocal(data, prop, true);
      const layout = syncTextBoxLayout(inlineContext.dom, data);
      if (layout?.autoHeight && Number.isFinite(layout.height)) {
        updateElementState(data.id, { height: `${layout.height}px` });
        data.height = `${layout.height}px`;
      }
      captureInlineSelection();
      if (window.refreshPreviews) window.refreshPreviews();
      schedulePresentationAutosave?.(150);
      return;
    }
  }

  // Fallback: Apply to the entire element only outside inline edit mode.
  if (
    [
      "fontWeight",
      "fontStyle",
      "fontFamily",
      "fontSize",
      "color",
      "textDecoration",
    ].includes(prop)
  ) {
    applyStyle(prop, value);
  }
}

function applyTextAlignmentToSelection(align) {
  const allowed = new Set(["left", "center", "right", "justify"]);
  if (!allowed.has(align) || state.selectedIds.length === 0) return;

  const slide = state.slides[currentSlideIndex];
  if (!slide) return;

  const textElements = state.selectedIds
    .map((id) => slide.elements.find((e) => e.id === id))
    .filter((e) => e?.type === "text" && !e.locked);
  if (!textElements.length) return;

  saveStateToUndo();
  textElements.forEach((data) => {
    updateElementStyleState(data.id, { textAlign: align });
    markTextElementStyleAsLocal(data, "textAlign");

    const dom = document.getElementById(data.id);
    if (!dom) return;

    _setElementDomStyleProperty(dom, "textAlign", align, "important");
    const contentHost = dom.querySelector(".text-element-content");
    if (contentHost) {
      _setElementDomStyleProperty(contentHost, "textAlign", align, "important");
    }

    const layout = syncTextBoxLayout(dom, data);
    if (layout?.autoHeight && Number.isFinite(layout.height)) {
      updateElementState(data.id, { height: `${layout.height}px` });
      data.height = `${layout.height}px`;
    }
  });

  if (window.refreshPreviews) window.refreshPreviews();
  updateGroupBound();
  schedulePresentationAutosave?.(150);
  buildPropertiesPanel();
}

function bindInlineFormattingGuard(element) {
  if (!element) return;
  if (element.dataset.inlineFormattingGuardBound === "true") return;
  element.dataset.inlineFormattingGuardBound = "true";
  const isFormControl = ["INPUT", "SELECT", "TEXTAREA"].includes(
    element.tagName,
  );
  element.addEventListener("pointerdown", (event) => {
    const editor =
      typeof getInlineEditorForFormatting === "function"
        ? getInlineEditorForFormatting()
        : getActiveInlineEditor();
    if (editor) {
      captureInlineSelection();
      beginFormattingInteraction();
    }
    const interactiveTarget = event.target?.closest?.(
      "input, select, textarea, button, label",
    );
    if (
      !interactiveTarget &&
      !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "LABEL"].includes(
        element.tagName,
      )
    ) {
      event.preventDefault();
    }
  });
  const release = (event) => {
    // A click on the button's icon targets the icon; it still ends the interaction started on pointerdown
    // (otherwise the count never drops and the text editor can no longer commit on blur).
    if (event && event.target !== element && !element.contains(event.target)) return;
    if (getActiveInlineEditor()) {
      requestAnimationFrame(() => endFormattingInteraction());
    } else {
      endFormattingInteraction();
    }
  };
  element.addEventListener("change", release);
  if (!isFormControl) {
    element.addEventListener("click", release);
  }
  element.addEventListener("blur", release);
}
