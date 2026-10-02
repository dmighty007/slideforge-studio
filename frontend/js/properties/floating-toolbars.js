// Floating text/shape/image toolbars and hover toolbars.

function updateFloatingToolbars() {
  const data = getSelectedElementData();
  const isPlaying = document.body.classList.contains("play-mode-active");

  let activeToolbarId = null;
  if (data && !isPlaying && state.selectedIds.length === 1) {
    // Shown while a text box is being edited; never on mere hover.
    if (data.type === "text" && !data.iconMode) {
      const dom = document.getElementById(data.id);
      const contentHost = dom?.querySelector(".text-element-content");
      const activeEditor =
        dom?.classList.contains("editing-text") ||
        contentHost?.isContentEditable ||
        (typeof getActiveInlineEditor === "function" &&
          getActiveInlineEditor() === contentHost);
      if (activeEditor) activeToolbarId = "floating-text-toolbar";
    } else if (data.type === "shape")
      activeToolbarId = "floating-shape-toolbar";
    else if (data.type === "image") activeToolbarId = "floating-image-toolbar";
    else if (data.type === "chart") activeToolbarId = "floating-chart-toolbar";
  }

  [
    "floating-text-toolbar",
    "floating-shape-toolbar",
    "floating-image-toolbar",
    "floating-chart-toolbar",
  ].forEach((id) => {
    const tb = document.getElementById(id);
    if (tb && id !== activeToolbarId) {
      tb.classList.add("hidden");
      tb.dataset.wasVisible = "false";
    }
  });

  if (!activeToolbarId) return;

  const toolbar = document.getElementById(activeToolbarId);
  if (!toolbar) return;

  const dom = document.getElementById(data.id);
  if (!dom) return;

  const wasVisible =
    toolbar.dataset.wasVisible === "true" &&
    !toolbar.classList.contains("hidden");
  toolbar.dataset.wasVisible = "true";

  const rect = dom.getBoundingClientRect();
  // Other objects on the slide, so the toolbar can sit where it hides none of them (e.g. below the body text
  // instead of over the title).
  const slideRoot = dom.closest(".presentation-slide");
  const avoidRects = Array.from(slideRoot?.querySelectorAll(".canvas-element") || [])
    .filter((node) => node !== dom && !node.contains(dom) && node.offsetParent)
    .map((node) => node.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  positionFloatingToolbar(toolbar, rect, {
    placement: data.type === "text" ? "top" : "auto",
    wasVisible,
    avoidRects,
  });

  if (data.type === "text") _bindFloatingTextToolbar(data, toolbar);
  else if (data.type === "shape") _bindFloatingShapeToolbar(data, toolbar);
  else if (data.type === "image") _bindFloatingImageToolbar(data, toolbar);
  else if (data.type === "chart") _bindFloatingChartToolbar(data, toolbar);
}

function _bindFloatingChartToolbar(data, toolbar) {
  toolbar.querySelector("#floating-chart-edit-data").onclick = () => openChartEditor(data.id);
  toolbar.querySelector("#floating-chart-style").onclick = () => {
    openChartEditor(data.id);
    _propertiesPanelActiveTab = "style";
    buildPropertiesPanel();
  };
}

function positionFloatingToolbar(toolbar, targetRect, options = {}) {
  if (!toolbar || !targetRect) return;

  const isNewlyShown = !options.wasVisible;
  toolbar.classList.remove("hidden");

  if (isNewlyShown) {
    toolbar.classList.remove("animate-popIn");
    void toolbar.offsetWidth;
    toolbar.classList.add("animate-popIn");
    toolbar.style.visibility = "hidden";
    toolbar.style.left = "0px";
    toolbar.style.top = "0px";
    toolbar.style.transform = "";
  }

  const toolbarRect = toolbar.getBoundingClientRect();
  const toolbarWidth = toolbarRect.width || toolbar.offsetWidth || 320;
  const toolbarHeight = toolbarRect.height || toolbar.offsetHeight || 44;
  const gap = 16; // clear of the selection handles (they stick out 6px), not only the box
  const viewportPad = 12;

  const appToolbarRect = document
    .getElementById("app-toolbar")
    ?.getBoundingClientRect();
  const insertToolbarRect = document
    .getElementById("insert-toolbar-row")
    ?.getBoundingClientRect();
  const canvasRect = document
    .getElementById("canvas-wrapper")
    ?.getBoundingClientRect();
  const propertiesRect = document
    .getElementById("properties-panel")
    ?.classList.contains("hidden")
    ? null
    : document.getElementById("properties-panel")?.getBoundingClientRect();

  const minTop =
    Math.max(
      viewportPad,
      appToolbarRect?.bottom || 0,
      insertToolbarRect?.bottom || 0,
    ) + 8;
  const maxTop = window.innerHeight - toolbarHeight - viewportPad;
  const minLeft = Math.max(viewportPad, (canvasRect?.left || 0) + 8);
  const maxLeft = Math.max(
    minLeft,
    (propertiesRect?.left || window.innerWidth) - toolbarWidth - 8,
  );

  const centeredLeft =
    targetRect.left + targetRect.width / 2 - toolbarWidth / 2;
  const left = Math.max(minLeft, Math.min(maxLeft, centeredLeft));

  const topAbove = targetRect.top - toolbarHeight - gap;
  const topBelow = targetRect.bottom + gap;
  const hasRoomAbove = topAbove >= minTop;
  const hasRoomBelow = topBelow <= maxTop;

  const preferTop = options.placement === "top";

  const covered = (candidateTop) =>
    (options.avoidRects || []).reduce((sum, r) => {
      const w = Math.min(left + toolbarWidth, r.right) - Math.max(left, r.left);
      const h = Math.min(candidateTop + toolbarHeight, r.bottom) - Math.max(candidateTop, r.top);
      return sum + (w > 0 && h > 0 ? w * h : 0);
    }, 0);

  let top;
  if (preferTop) {
    top = Math.max(minTop, Math.min(maxTop, topAbove));
    // Above covers another object but below is free: go below.
    if (covered(top) > 0 && hasRoomBelow && covered(topBelow) < covered(top)) {
      top = topBelow;
    }
  } else if (hasRoomAbove) {
    top = topAbove;
  } else if (hasRoomBelow) {
    top = topBelow;
  } else {
    const spaceAbove = Math.max(0, targetRect.top - minTop);
    const spaceBelow = Math.max(0, maxTop - targetRect.bottom);
    top = spaceBelow >= spaceAbove ? topBelow : topAbove;
    top = Math.max(minTop, Math.min(maxTop, top));
  }

  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${top}px`;
  const renderedRect = toolbar.getBoundingClientRect();
  const dx = renderedRect.left - left;
  const dy = renderedRect.top - top;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    toolbar.style.left = `${left - dx}px`;
    toolbar.style.top = `${top - dy}px`;
  }
  toolbar.style.visibility = "";
}

function _getToolbarTargetTextData(toolbar, fallbackData = null) {
  const id =
    fallbackData?.id || state.selectedIds?.[0];
  return (
    state.slides[currentSlideIndex]?.elements?.find(
      (el) => el.id === id && el.type === "text",
    ) || fallbackData
  );
}

function _ensureTextToolbarTargetSelected(toolbar, fallbackData = null) {
  const target = _getToolbarTargetTextData(toolbar, fallbackData);
  if (!target) return null;
  if (state.selectedIds.length !== 1 || state.selectedIds[0] !== target.id) {
    selectElement(target.id, "replace");
  }
  return (
    state.slides[currentSlideIndex]?.elements?.find(
      (el) => el.id === target.id,
    ) || target
  );
}

function _bindFloatingTextToolbar(data, toolbar) {
  const boldBtn = document.getElementById("floating-text-bold");
  const italicBtn = document.getElementById("floating-text-italic");
  const fontSelect = document.getElementById("floating-text-font");
  const sizeInput = document.getElementById("floating-text-size");
  const colorInput = document.getElementById("floating-text-color");
  const subBtn = document.getElementById("floating-text-sub");
  const supBtn = document.getElementById("floating-text-sup");
  const clearBtn = document.getElementById("floating-text-clear");
  const insertSymbolBtn = document.getElementById("floating-insert-symbol");
  const insertEquationBtn = document.getElementById("floating-insert-equation");

  const applyFloatingTextFormatting = (prop, value, options = {}) => {
    const target = _ensureTextToolbarTargetSelected(toolbar, data);
    if (!target) return;
    applyTextFormatting(prop, value, options);
    requestAnimationFrame(() => {
      if (!isControlBeingEdited(document.activeElement)) {
        updateFloatingToolbars();
      }
      updateUIFromSelection?.();
    });
  };

  if (boldBtn) {
    bindInlineFormattingGuard(boldBtn);
    boldBtn.onclick = () => {
      const latest = getSelectedElementData();
      const nextWeight =
        latest?.styles?.fontWeight === "bold" ? "normal" : "bold";
      applyFloatingTextFormatting("fontWeight", nextWeight, {
        inlineAction: "bold",
      });
    };
    setTextControlActive(boldBtn, data.styles.fontWeight === "bold");
  }
  if (italicBtn) {
    bindInlineFormattingGuard(italicBtn);
    italicBtn.onclick = () => {
      const latest = getSelectedElementData();
      const nextStyle =
        latest?.styles?.fontStyle === "italic" ? "normal" : "italic";
      applyFloatingTextFormatting("fontStyle", nextStyle, {
        inlineAction: "italic",
      });
    };
    setTextControlActive(italicBtn, data.styles.fontStyle === "italic");
  }

  const underlineFloatBtn = document.getElementById("floating-text-underline");
  if (underlineFloatBtn) {
    bindInlineFormattingGuard(underlineFloatBtn);
    underlineFloatBtn.onclick = () => {
      const latest = getSelectedElementData();
      const curDec = latest?.styles?.textDecoration || "";
      const hasUnderline = curDec.includes("underline");
      applyFloatingTextFormatting(
        "textDecoration",
        hasUnderline
          ? curDec.replace("underline", "").trim() || "none"
          : [curDec, "underline"].filter(Boolean).join(" ").trim(),
        { inlineAction: "underline" },
      );
    };
    setTextControlActive(
      underlineFloatBtn,
      (data.styles.textDecoration || "").includes("underline"),
    );
  }

  const strikethroughFloatBtn = document.getElementById(
    "floating-text-strikethrough",
  );
  if (strikethroughFloatBtn) {
    bindInlineFormattingGuard(strikethroughFloatBtn);
    strikethroughFloatBtn.onclick = () => {
      const latest = getSelectedElementData();
      const curDec = latest?.styles?.textDecoration || "";
      const hasStrike = curDec.includes("line-through");
      applyFloatingTextFormatting(
        "textDecoration",
        hasStrike
          ? curDec.replace("line-through", "").trim() || "none"
          : [curDec, "line-through"].filter(Boolean).join(" ").trim(),
        { inlineAction: "textDecoration" },
      );
    };
    setTextControlActive(
      strikethroughFloatBtn,
      (data.styles.textDecoration || "").includes("line-through"),
    );
  }

  if (fontSelect) {
    bindInlineFormattingGuard(fontSelect);
    if (
      !isControlBeingEdited(fontSelect) &&
      typeof buildFontOptions === "function"
    ) {
      const nextOptions = buildFontOptions(data.styles.fontFamily);
      if (fontSelect.innerHTML !== nextOptions) {
        fontSelect.innerHTML = nextOptions;
      }
    }
    fontSelect.onchange = (e) => {
      restoreInlineSelection?.();
      applyFloatingTextFormatting("fontFamily", e.target.value, {
        inlineAction: "fontFamily",
      });
    };
    if (!isControlBeingEdited(fontSelect)) {
      fontSelect.value = data.styles.fontFamily || "Inter, sans-serif";
    }
    setTextControlActive(
      fontSelect,
      normalizeFontFamily(fontSelect.value) !==
        normalizeFontFamily(getThemeTextStyleDefaults().fontFamily),
    );
  }
  if (sizeInput) {
    bindFontSizeFormattingControl(sizeInput);
    if (!isControlBeingEdited(sizeInput)) {
      sizeInput.value = parseInt(data.styles.fontSize) || 32;
      sizeInput.dataset.lastCommittedValue = _normalizePx(
        sizeInput.value,
        "32px",
      );
    }
    setTextControlActive(
      sizeInput,
      `${parseInt(data.styles.fontSize) || 32}px` !==
        getThemeTextStyleDefaults().fontSize,
    );
  }
  if (colorInput) {
    bindInlineFormattingGuard(colorInput);
    colorInput.oninput = (e) => {
      if (colorInput.dataset.floatingColorFormattingActive !== "true") {
        beginFormattingInteraction();
        colorInput.dataset.floatingColorFormattingActive = "true";
      }
      applyFloatingTextFormatting("color", e.target.value, {
        inlineAction: "color",
      });
    };
    const endFloatingColorFormatting = () => {
      if (colorInput.dataset.floatingColorFormattingActive === "true") {
        delete colorInput.dataset.floatingColorFormattingActive;
        endFormattingInteraction();
      }
    };
    colorInput.onchange = endFloatingColorFormatting;
    colorInput.onblur = endFloatingColorFormatting;
    if (!isControlBeingEdited(colorInput)) {
      colorInput.value = _normalizeColorForInput(data.styles.color, "#000000");
    }
    setTextControlActive(
      colorInput,
      _normalizeColorForInput(data.styles.color, "#000000").toLowerCase() !==
        _normalizeColorForInput(
          getThemeTextStyleDefaults().color,
          "#000000",
        ).toLowerCase(),
    );
  }

  // Bulleted / numbered list toggles (the same conversion as the properties panel's list buttons).
  const listState = getTextListState(data.content, data.bulletStyle);
  [
    ["bulleted", document.getElementById("floating-text-bullets")],
    ["numbered", document.getElementById("floating-text-numbers")],
  ].forEach(([kind, button]) => {
    if (!button) return;
    bindInlineFormattingGuard(button);
    setTextControlActive(button, listState.kind === kind);
    button.onclick = () => {
      const target = _ensureTextToolbarTargetSelected(toolbar, data);
      if (!target) return;
      const current = getTextListState(target.content, target.bulletStyle);
      saveStateToUndo();
      applyTextBulletState(
        target,
        current.kind === kind ? "none" : kind,
        kind === "numbered" ? "decimal" : target.bulletStyle || "default",
      );
      if (window.refreshPreviews) window.refreshPreviews();
      schedulePresentationAutosave?.(150);
      buildPropertiesPanel?.();
      requestAnimationFrame(() => updateFloatingToolbars());
    };
  });

  const paletteContainer = document.getElementById("floating-text-palette");
  if (paletteContainer) {
    paletteContainer.innerHTML = "";
    (state.colorPalette || []).forEach((color) => {
      const swatch = document.createElement("button");
      swatch.className =
        "w-4 h-4 rounded-full border border-slate-200 hover:scale-110 transition-transform shadow-sm";
      swatch.style.backgroundColor = color;
      swatch.title = color;
      bindInlineFormattingGuard(swatch);
      swatch.onclick = () => {
        applyFloatingTextFormatting("color", color, { inlineAction: "color" });
        if (colorInput) colorInput.value = color;
      };
      paletteContainer.appendChild(swatch);
    });
  }

  if (subBtn) {
    bindInlineFormattingGuard(subBtn);
    subBtn.onclick = () =>
      applyFloatingTextFormatting("subscript", null, {
        inlineAction: "subscript",
      });
  }
  if (supBtn) {
    bindInlineFormattingGuard(supBtn);
    supBtn.onclick = () =>
      applyFloatingTextFormatting("superscript", null, {
        inlineAction: "superscript",
      });
  }
  if (clearBtn) {
    bindInlineFormattingGuard(clearBtn);
    clearBtn.onclick = () => {
      const target = _ensureTextToolbarTargetSelected(toolbar, data);
      if (target) clearTextFormatting(target);
    };
  }

  if (insertSymbolBtn) {
    bindInlineFormattingGuard(insertSymbolBtn);
    // onclick is handled in HTML but we guard it here
  }
  if (insertEquationBtn) {
    bindInlineFormattingGuard(insertEquationBtn);
    // onclick is handled in HTML but we guard it here
  }

  toolbar.dataset.guarded = "true";
}

function _bindFloatingShapeToolbar(data, toolbar) {
  const fillInput = document.getElementById("floating-shape-fill");
  const borderInput = document.getElementById("floating-shape-border");
  const widthSelect = document.getElementById("floating-shape-border-width");
  const repaintShape = () => {
    const dom = document.getElementById(data.id);
    if (
      dom &&
      data.type === "shape" &&
      typeof renderShapeContent === "function"
    ) {
      renderShapeContent(dom, data);
    }
    refreshPreviews?.();
    updateGroupBound?.();
    schedulePresentationAutosave?.(150);
  };

  if (fillInput) {
    if (!isControlBeingEdited(fillInput)) {
      fillInput.value = _normalizeColorForInput(
        data.styles.backgroundColor,
        "#ffffff",
      );
    }
    fillInput.oninput = (e) => {
      updateElementStyleState(data.id, { backgroundColor: e.target.value });
      data.styles.backgroundColor = e.target.value;
      repaintShape();
    };
    fillInput.onchange = () => {
      saveStateToUndo();
      if (window.renderSlidesFromState) renderSlidesFromState();
    };
  }

  if (borderInput) {
    if (!isControlBeingEdited(borderInput)) {
      const borderMatches = (data.styles.border || "").match(
        /solid\s+(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)/,
      );
      borderInput.value = borderMatches
        ? _normalizeColorForInput(borderMatches[1], "#000000")
        : "#000000";
    }
    borderInput.oninput = (e) => {
      const currentBorder = data.styles.border || "0px solid #000000";
      const widthMatch = currentBorder.match(/^(\d+)px/);
      const w = widthMatch ? widthMatch[1] : data.styles.borderWidth || "1";
      const width = normalizeBorderWidthValue(w, "1px");
      const color = _normalizeColorForInput(e.target.value, "#000000");
      updateElementStyleState(data.id, {
        border: `${parseFloat(width) || 1}px solid ${color}`,
        borderStyle: "solid",
        borderWidth: width,
        borderColor: color,
      });
      Object.assign(data.styles, {
        border: `${parseFloat(width) || 1}px solid ${color}`,
        borderStyle: "solid",
        borderWidth: width,
        borderColor: color,
      });
      repaintShape();
    };
    borderInput.onchange = () => {
      saveStateToUndo();
      if (window.renderSlidesFromState) renderSlidesFromState();
    };
  }

  if (widthSelect) {
    if (!isControlBeingEdited(widthSelect)) {
      const currentBorder = data.styles.border || "0px solid #000000";
      const widthMatch = currentBorder.match(/^(\d+)px/);
      const w = widthMatch ? widthMatch[1] : data.styles.border ? "1" : "0";
      widthSelect.value = w;
    }
    widthSelect.onchange = (e) => {
      const w = parseInt(e.target.value) || 0;
      if (w === 0) {
        updateElementStyleState(data.id, {
          border: "none",
          borderStyle: "none",
          borderWidth: "0px",
          borderColor: data.styles.borderColor || "#000000",
        });
        Object.assign(data.styles, {
          border: "none",
          borderStyle: "none",
          borderWidth: "0px",
          borderColor: data.styles.borderColor || "#000000",
        });
      } else {
        const borderMatches = (data.styles.border || "").match(
          /solid\s+(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)/,
        );
        const color = _normalizeColorForInput(
          data.styles.borderColor ||
            (borderMatches ? borderMatches[1] : "#000000"),
          "#000000",
        );
        updateElementStyleState(data.id, {
          border: `${w}px solid ${color}`,
          borderStyle: "solid",
          borderWidth: `${w}px`,
          borderColor: color,
        });
        Object.assign(data.styles, {
          border: `${w}px solid ${color}`,
          borderStyle: "solid",
          borderWidth: `${w}px`,
          borderColor: color,
        });
      }
      saveStateToUndo();
      repaintShape();
    };
  }
}

function _bindFloatingImageToolbar(data, toolbar) {
  const cropBtn = document.getElementById("floating-image-crop");
  const opacityInput = document.getElementById("floating-image-opacity");
  const radiusSelect = document.getElementById("floating-image-radius");
  const dom = document.getElementById(data.id);
  if (!data.styles) data.styles = {};

  // A drawing is edited in Excalidraw rather than cropped or rounded.
  const isDrawing = Boolean(data.excalidraw);
  const label = document.getElementById("floating-image-label");
  if (label) label.textContent = isDrawing ? "Drawing" : "Image";
  const editDrawingBtn = document.getElementById("floating-image-edit-drawing");
  if (editDrawingBtn) {
    editDrawingBtn.classList.toggle("hidden", !isDrawing);
    editDrawingBtn.onclick = () => window.editDrawing?.(data.id);
  }
  cropBtn?.classList.toggle("hidden", isDrawing);
  radiusSelect?.classList.toggle("hidden", isDrawing);
  radiusSelect?.previousElementSibling?.classList.toggle("hidden", isDrawing); // its divider

  if (cropBtn) {
    cropBtn.onclick = () => {
      if (window.triggerImageCrop) triggerImageCrop(data.id);
    };
  }

  if (opacityInput) {
    if (!isControlBeingEdited(opacityInput)) {
      opacityInput.value =
        data.styles.opacity !== undefined ? data.styles.opacity : 1;
    }
    opacityInput.oninput = (e) => {
      updateElementStyleState(data.id, { opacity: e.target.value });
      data.styles.opacity = e.target.value;
      if (dom) dom.style.opacity = e.target.value;
    };
    opacityInput.onchange = () => {
      saveStateToUndo();
      if (window.refreshPreviews) refreshPreviews();
    };
  }

  if (radiusSelect) {
    if (!isControlBeingEdited(radiusSelect)) {
      const radius = String(data.styles.borderRadius || "0");
      radiusSelect.value = /^0(px)?$/.test(radius) ? "0" : radius;
    }
    radiusSelect.onchange = (e) => {
      updateElementStyleState(data.id, { borderRadius: e.target.value });
      data.styles.borderRadius = e.target.value;
      if (dom) dom.style.borderRadius = e.target.value;
      saveStateToUndo();
      if (window.refreshPreviews) refreshPreviews();
    };
  }
}
