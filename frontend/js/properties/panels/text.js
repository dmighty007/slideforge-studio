function buildTextPanel(panel, data) {
  const listState = getTextListState(data.content, data.bulletStyle);
  const contentGrp = createGroup("Text Content");
  contentGrp.classList.add("prop-group-compact");
  contentGrp.appendChild(
    createField(
      "Content",
      `
        <textarea id="prop-text-content" class="prop-textarea" rows="5" spellcheck="true">${escapeHtml(getTextPanelEditableValue(data))}</textarea>
        <div class="prop-field-hint">${listState.kind === "bulleted" ? "Use leading spaces or Tab in canvas edit mode for nested bullets." : "Line breaks are preserved on the slide."}</div>
    `,
    ),
  );
  panel.appendChild(contentGrp);

  const fitMode =
    data.textFitMode === "autofit"
      ? "autofit"
      : data.autoHeight === false || data.textFitMode === "fixed"
        ? "fixed"
        : "autoHeight";
  const layoutGrp = createGroup("Text Box");
  layoutGrp.appendChild(
    createField(
      "Fit",
      `
        <select id="prop-text-fit-mode" class="prop-select">
            <option value="autoHeight" ${fitMode === "autoHeight" ? "selected" : ""}>Grow height to content</option>
            <option value="fixed" ${fitMode === "fixed" ? "selected" : ""}>Fixed box</option>
            <option value="autofit" ${fitMode === "autofit" ? "selected" : ""}>Auto fit text to box</option>
        </select>
    `,
    ),
  );
  if (fitMode === "autofit") {
    layoutGrp.appendChild(
      createField(
        "Minimum Size",
        `<input type="number" id="prop-text-autofit-min" class="prop-input-sm" min="6" max="72" step="1" value="${Math.max(6, Number(data.minAutoFitFontSize) || 8)}">`,
      ),
    );
  }
  panel.appendChild(layoutGrp);

  const grp = createGroup("Typography");

  // Font Family - Top
  grp.appendChild(
    createField(
      "Font Family",
      `
        <select id="prop-font" class="prop-select">
            ${buildFontOptions(data.styles.fontFamily)}
        </select>
    `,
    ),
  );

  // Compact Row: Size | Color | B I U S Clear
  const textToolsRow = document.createElement("div");
  textToolsRow.className = "grid grid-cols-6 gap-1.5 items-end mt-2";

  // Size
  const sizeCol = document.createElement("div");
  sizeCol.className = "col-span-2";
  sizeCol.innerHTML = `<label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Size</label>
        <input type="text" id="prop-fs" class="prop-input-sm" value="${escapeHtml(data.styles.fontSize || "32px")}">`;

  // Color
  const colorCol = document.createElement("div");
  colorCol.className = "col-span-1";
  colorCol.innerHTML = `<label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Color</label>
        <input type="color" id="prop-tc" class="prop-color-input" value="${_normalizeColorForInput(data.styles.color, "#ffffff")}">`;

  // Format buttons — B I U S + Clear
  const isUnderline = (data.styles.textDecoration || "").includes("underline");
  const isStrike = (data.styles.textDecoration || "").includes("line-through");
  const formatCol = document.createElement("div");
  formatCol.className = "col-span-3 flex gap-1 flex-wrap";
  formatCol.innerHTML = `
        <button id="prop-bold" class="prop-icon-btn ${data.styles.fontWeight === "bold" ? "active" : ""}" title="Bold">B</button>
        <button id="prop-italic" class="prop-icon-btn italic ${data.styles.fontStyle === "italic" ? "active" : ""}" title="Italic">I</button>
        <button id="prop-underline" class="prop-icon-btn underline ${isUnderline ? "active" : ""}" title="Underline">U</button>
        <button id="prop-strikethrough" class="prop-icon-btn line-through ${isStrike ? "active" : ""}" title="Strikethrough">S</button>
        <button id="prop-clear-format" class="prop-icon-btn" title="Clear formatting"><i class="fa-solid fa-eraser"></i></button>
    `;

  textToolsRow.appendChild(sizeCol);
  textToolsRow.appendChild(colorCol);
  textToolsRow.appendChild(formatCol);
  grp.appendChild(textToolsRow);

  const shadowState = _parseTextShadowValue(data.styles?.textShadow);
  const strokeWidth =
    parseFloat(
      _normalizeStrokeWidthValue(data.styles?.textStrokeWidth, "0px"),
    ) || 0;
  const strokeColor = _normalizeColorForInput(
    data.styles?.textStrokeColor,
    "#000000",
  );

  grp.appendChild(
    createField(
      "Text Shadow",
      `
        <div class="grid grid-cols-4 gap-2 items-end">
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">X</label>
                <input type="number" id="prop-ts-x" class="prop-input-sm" value="${shadowState.offsetX}" step="1">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Y</label>
                <input type="number" id="prop-ts-y" class="prop-input-sm" value="${shadowState.offsetY}" step="1">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Blur</label>
                <input type="number" id="prop-ts-blur" class="prop-input-sm" value="${shadowState.blur}" min="0" step="1">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Color</label>
                <input type="color" id="prop-ts-color" class="prop-color-input" value="${shadowState.color}">
            </div>
        </div>
    `,
    ),
  );

  grp.appendChild(
    createField(
      "Text Stroke",
      `
        <div class="grid grid-cols-2 gap-2 items-end">
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Width</label>
                <input type="number" id="prop-stroke-width" class="prop-input-sm" value="${strokeWidth}" min="0" max="24" step="0.5">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Color</label>
                <input type="color" id="prop-stroke-color" class="prop-color-input" value="${strokeColor}">
            </div>
        </div>
    `,
    ),
  );

  grp.appendChild(
    createField(
      "Effects",
      `
        <div class="grid grid-cols-2 gap-2">
            ${_renderTextEffectPresetButton(data, "auto", "Auto Theme")}
            ${_renderTextEffectPresetButton(data, "soft", "Soft")}
            ${_renderTextEffectPresetButton(data, "dramatic", "Dramatic")}
            ${_renderTextEffectPresetButton(data, "glow", "Glow")}
            ${_renderTextEffectPresetButton(data, "outline", "Outline")}
            ${_renderTextEffectPresetButton(data, "none", "Clear")}
        </div>
    `,
    ),
  );

  // Alignment
  grp.appendChild(
    createField(
      "Alignment",
      `
        <div class="prop-btn-group">
            ${["left", "center", "right", "justify"]
              .map(
                (align) => `
                <button id="prop-align-${align}" data-value="${align}" class="${(data.styles.textAlign || "left") === align ? "active" : ""}">
                    <i class="fa-solid fa-align-${align === "justify" ? "justify" : align}"></i>
                </button>
            `,
              )
              .join("")}
        </div>
    `,
    ),
  );

  // Line Height + Letter Spacing
  const spacingRow = document.createElement("div");
  spacingRow.className = "grid grid-cols-2 gap-2 items-end";
  const lineHeightRaw = parseFloat(data.styles.lineHeight) || 1.2;
  const letterSpacingRaw = parseFloat(data.styles.letterSpacing) || 0;
  spacingRow.innerHTML = `
        <div>
            <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Line Height</label>
            <input type="number" id="prop-line-height" class="prop-input-sm" value="${lineHeightRaw}" min="0.8" max="4" step="0.05">
        </div>
        <div>
            <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Letter Spacing</label>
            <input type="number" id="prop-letter-spacing" class="prop-input-sm" value="${letterSpacingRaw}" min="-5" max="20" step="0.5">
        </div>
    `;
  grp.appendChild(spacingRow);

  // Lists get their own group on the Content tab (next to the text), not buried in Typography.
  const listGrp = createGroup("Lists");

  // List Type Selector (Visual)
  const listTypeField = createField(
    "List Type",
    `
        <div class="prop-btn-group">
            <button id="prop-list-none" class="${listState.kind === "none" ? "active" : ""}" title="No List">None</button>
            <button id="prop-list-bullet" class="${listState.kind === "bulleted" ? "active" : ""}" title="Bulleted List"><i class="fa-solid fa-list-ul"></i></button>
            <button id="prop-list-number" class="${listState.kind === "numbered" ? "active" : ""}" title="Numbered List"><i class="fa-solid fa-list-ol"></i></button>
        </div>
    `,
  );
  listGrp.appendChild(listTypeField);

  // Sub-settings for Bullet/Number
  if (listState.kind !== "none") {
    const subGrp = document.createElement("div");
    subGrp.className = "pl-2 border-l-2 border-slate-100 space-y-2 mt-1";

    if (listState.kind === "bulleted") {
      subGrp.appendChild(
        createField(
          "Bullet Style",
          `
                <select id="prop-list-style" class="text-[10px] py-1">
                    ${Object.keys(BULLET_STYLE_THEMES)
                      .map(
                        (s) =>
                          `<option value="${s}" ${s === listState.style ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
                      )
                      .join("")}
                </select>
            `,
        ),
      );
    } else {
      subGrp.appendChild(
        createField(
          "Number Style",
          `
                <select id="prop-list-number-style" class="text-[10px] py-1">
                    ${Object.entries(NUMBERED_STYLE_THEMES)
                      .map(
                        ([k, v]) =>
                          `<option value="${k}" ${k === listState.style ? "selected" : ""}>${v}</option>`,
                      )
                      .join("")}
                </select>
            `,
        ),
      );
    }

    if (listState.kind === "bulleted") {
      const levelField = createField(
        "Nesting & Indent",
        `
                <div class="flex gap-1">
                    <button id="prop-list-outdent" class="flex-1 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50" title="Outdent (Shift+Tab)">
                        <i class="fa-solid fa-outdent text-[9px] mr-1"></i> <span class="text-[9px]">Out</span>
                    </button>
                    <button id="prop-list-indent" class="flex-1 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50" title="Indent (Tab)">
                        <i class="fa-solid fa-indent text-[9px] mr-1"></i> <span class="text-[9px]">In</span>
                    </button>
                </div>
            `,
      );
      subGrp.appendChild(levelField);
    }
    listGrp.appendChild(subGrp);
  }

  panel.appendChild(grp);
  contentGrp.after(listGrp);

  // Listeners (Delayed to ensure DOM is ready if needed, though here we can bind immediately as they are in panel)
  const onCommit = (cb) => {
    saveStateToUndo();
    cb();
    if (window.refreshPreviews) window.refreshPreviews();
  };

  const textContent = document.getElementById("prop-text-content");
  if (textContent) {
    bindInlineFormattingGuard(textContent);
    let contentTimer = null;
    let undoCaptured = false;
    const commitTextContent = ({ forceUndo = false } = {}) => {
      window.clearTimeout(contentTimer);
      const nextValue = textContent.value;
      if (nextValue === textContent.dataset.lastCommittedValue) return;
      if (!undoCaptured || forceUndo) {
        saveStateToUndo();
        undoCaptured = true;
      }
      textContent.dataset.lastCommittedValue = nextValue;
      applySidebarTextContent(data, nextValue);
    };
    textContent.dataset.lastCommittedValue = textContent.value;
    textContent.addEventListener("input", () => {
      window.clearTimeout(contentTimer);
      contentTimer = window.setTimeout(() => commitTextContent(), 140);
    });
    textContent.addEventListener("change", () =>
      commitTextContent({ forceUndo: false }),
    );
    textContent.addEventListener("blur", () =>
      commitTextContent({ forceUndo: false }),
    );
  }

  const font = document.getElementById("prop-font");
  if (font) {
    bindInlineFormattingGuard(font);
    font.onchange = (e) => {
      restoreInlineSelection?.();
      applyTextFormatting("fontFamily", e.target.value, {
        inlineAction: "fontFamily",
      });
    };
    setTextControlActive(
      font,
      normalizeFontFamily(font.value) !==
        normalizeFontFamily(getThemeTextStyleDefaults().fontFamily),
    );
  }
  const bold = document.getElementById("prop-bold");
  if (bold) {
    bindInlineFormattingGuard(bold);
    bold.onclick = () =>
      applyTextFormatting(
        "fontWeight",
        data.styles.fontWeight === "bold" ? "normal" : "bold",
        { inlineAction: "bold" },
      );
    setTextControlActive(bold, data.styles.fontWeight === "bold");
  }

  const italic = document.getElementById("prop-italic");
  if (italic) {
    bindInlineFormattingGuard(italic);
    italic.onclick = () =>
      applyTextFormatting(
        "fontStyle",
        data.styles.fontStyle === "italic" ? "normal" : "italic",
        {
          inlineAction: "italic",
        },
      );
    setTextControlActive(italic, data.styles.fontStyle === "italic");
  }

  const underlineBtn = document.getElementById("prop-underline");
  if (underlineBtn) {
    bindInlineFormattingGuard(underlineBtn);
    const _curDecoration = data.styles.textDecoration || "";
    const _hasUnderline = _curDecoration.includes("underline");
    underlineBtn.onclick = () =>
      applyTextFormatting(
        "textDecoration",
        _hasUnderline
          ? _curDecoration.replace("underline", "").trim() || "none"
          : [_curDecoration, "underline"].filter(Boolean).join(" ").trim(),
        { inlineAction: "underline" },
      );
    setTextControlActive(underlineBtn, _hasUnderline);
  }

  const strikethroughBtn = document.getElementById("prop-strikethrough");
  if (strikethroughBtn) {
    bindInlineFormattingGuard(strikethroughBtn);
    const _curDec2 = data.styles.textDecoration || "";
    const _hasStrike = _curDec2.includes("line-through");
    strikethroughBtn.onclick = () =>
      applyTextFormatting(
        "textDecoration",
        _hasStrike
          ? _curDec2.replace("line-through", "").trim() || "none"
          : [_curDec2, "line-through"].filter(Boolean).join(" ").trim(),
        { inlineAction: "textDecoration" },
      );
    setTextControlActive(strikethroughBtn, _hasStrike);
  }

  const clearFormat = document.getElementById("prop-clear-format");
  if (clearFormat) {
    bindInlineFormattingGuard(clearFormat);
    clearFormat.onclick = () => clearTextFormatting(data);
  }

  const fontSize = document.getElementById("prop-fs");
  if (fontSize) {
    bindFontSizeFormattingControl(fontSize);
    if (!isControlBeingEdited(fontSize)) {
      fontSize.dataset.lastCommittedValue = _normalizePx(
        fontSize.value,
        "32px",
      );
    }
    setTextControlActive(
      fontSize,
      _normalizePx(fontSize.value, "32px") !==
        getThemeTextStyleDefaults().fontSize,
    );
  }

  const textColor = document.getElementById("prop-tc");
  if (textColor) {
    bindInlineFormattingGuard(textColor);
    textColor.oninput = (e) => {
      if (textColor.dataset.sidebarColorFormattingActive !== "true") {
        beginFormattingInteraction();
        textColor.dataset.sidebarColorFormattingActive = "true";
      }
      applyTextFormatting("color", e.target.value, { inlineAction: "color" });
    };
    const endColorFormatting = () => {
      if (textColor.dataset.sidebarColorFormattingActive === "true") {
        delete textColor.dataset.sidebarColorFormattingActive;
        endFormattingInteraction();
      }
    };
    textColor.onchange = endColorFormatting;
    textColor.onblur = endColorFormatting;
    setTextControlActive(
      textColor,
      textColor.value.toLowerCase() !==
        _normalizeColorForInput(
          getThemeTextStyleDefaults().color,
          "#000000",
        ).toLowerCase(),
    );
  }

  const textFitMode = document.getElementById("prop-text-fit-mode");
  if (textFitMode) {
    textFitMode.onchange = (e) => {
      const nextMode =
        e.target.value === "autofit"
          ? "autofit"
          : e.target.value === "fixed"
            ? "fixed"
            : "autoHeight";
      saveStateToUndo();
      const updates = {
        textFitMode: nextMode,
        autoHeight: nextMode === "autoHeight",
      };
      if (nextMode !== "autofit") updates.minAutoFitFontSize = undefined;
      updateElementState(data.id, updates);
      data.textFitMode = nextMode;
      data.autoHeight = updates.autoHeight;
      if (updates.minAutoFitFontSize === undefined)
        delete data.minAutoFitFontSize;

      const dom = document.getElementById(data.id);
      const layout = dom ? syncTextBoxLayout(dom, data) : null;
      if (layout?.autoHeight && Number.isFinite(layout.height)) {
        updateElementState(data.id, { height: `${layout.height}px` });
        data.height = `${layout.height}px`;
      }
      buildPropertiesPanel();
      refreshPreviews?.();
    };
  }

  const autoFitMin = document.getElementById("prop-text-autofit-min");
  if (autoFitMin) {
    const commitAutoFitMin = () => {
      const next = Math.max(6, Math.min(72, Number(autoFitMin.value) || 8));
      if (next === (Number(data.minAutoFitFontSize) || 8)) return;
      saveStateToUndo();
      updateElementState(data.id, { minAutoFitFontSize: next });
      data.minAutoFitFontSize = next;
      const dom = document.getElementById(data.id);
      if (dom) syncTextBoxLayout(dom, data);
      refreshPreviews?.();
    };
    autoFitMin.onchange = commitAutoFitMin;
    autoFitMin.onblur = commitAutoFitMin;
  }

  const bindWholeTextStyleControl = (el, handler) => {
    if (!el) return;
    bindInlineFormattingGuard(el);
    el.addEventListener("input", () => {
      if (el.dataset.wholeTextStyleFormattingActive !== "true") {
        beginFormattingInteraction();
        el.dataset.wholeTextStyleFormattingActive = "true";
      }
    });
    const commit = () => {
      handler();
      if (el.dataset.wholeTextStyleFormattingActive === "true") {
        delete el.dataset.wholeTextStyleFormattingActive;
        endFormattingInteraction();
      }
    };
    el.onchange = commit;
    el.onblur = commit;
  };

  const shadowX = document.getElementById("prop-ts-x");
  const shadowY = document.getElementById("prop-ts-y");
  const shadowBlur = document.getElementById("prop-ts-blur");
  const shadowColor = document.getElementById("prop-ts-color");
  const commitTextShadow = () => {
    applyStyle(
      "textShadow",
      _buildTextShadowValue(
        shadowX?.value,
        shadowY?.value,
        shadowBlur?.value,
        shadowColor?.value,
      ),
    );
    buildPropertiesPanel();
  };
  bindWholeTextStyleControl(shadowX, commitTextShadow);
  bindWholeTextStyleControl(shadowY, commitTextShadow);
  bindWholeTextStyleControl(shadowBlur, commitTextShadow);
  bindWholeTextStyleControl(shadowColor, commitTextShadow);

  const strokeWidthInput = document.getElementById("prop-stroke-width");
  const strokeColorInput = document.getElementById("prop-stroke-color");
  const commitTextStroke = () => {
    const nextWidth = _normalizeStrokeWidthValue(
      strokeWidthInput?.value,
      "0px",
    );
    const nextColor = _normalizeColorForInput(
      strokeColorInput?.value,
      "#000000",
    );
    applyStyle("textStrokeWidth", nextWidth);
    applyStyle("textStrokeColor", nextColor);
    buildPropertiesPanel();
  };
  bindWholeTextStyleControl(strokeWidthInput, commitTextStroke);
  bindWholeTextStyleControl(strokeColorInput, commitTextStroke);

  const bindTextEffectPresetButton = (id, presetName) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    bindInlineFormattingGuard(btn);
    btn.onclick = () => {
      _applyTextEffectPreset(data, presetName);
      buildPropertiesPanel();
    };
  };
  bindTextEffectPresetButton("prop-effect-auto", "auto");
  bindTextEffectPresetButton("prop-effect-soft", "soft");
  bindTextEffectPresetButton("prop-effect-dramatic", "dramatic");
  bindTextEffectPresetButton("prop-effect-glow", "glow");
  bindTextEffectPresetButton("prop-effect-outline", "outline");
  bindTextEffectPresetButton("prop-effect-none", "none");

  // Alignment Button Group
  ["left", "center", "right", "justify"].forEach((align) => {
    const btn = document.getElementById(`prop-align-${align}`);
    if (btn) {
      btn.onclick = () => {
        applyStyleAndRefresh("textAlign", align);
      };
    }
  });

  // Line Height control
  const lineHeightInput = document.getElementById("prop-line-height");
  if (lineHeightInput) {
    const commitLineHeight = () => {
      const v = parseFloat(lineHeightInput.value);
      if (!Number.isFinite(v) || v < 0.5) return;
      saveStateToUndo();
      applyStyle("lineHeight", String(Math.round(v * 100) / 100));
      refreshPreviews?.();
    };
    lineHeightInput.addEventListener("change", commitLineHeight);
    lineHeightInput.addEventListener("blur", commitLineHeight);
  }

  // Letter Spacing control
  const letterSpacingInput = document.getElementById("prop-letter-spacing");
  if (letterSpacingInput) {
    const commitLetterSpacing = () => {
      const v = parseFloat(letterSpacingInput.value);
      if (!Number.isFinite(v)) return;
      saveStateToUndo();
      applyStyle("letterSpacing", `${Math.round(v * 10) / 10}px`);
      refreshPreviews?.();
    };
    letterSpacingInput.addEventListener("change", commitLetterSpacing);
    letterSpacingInput.addEventListener("blur", commitLetterSpacing);
  }

  // List Type Toggles
  const setListKind = (kind) => {
    onCommit(() => {
      const currentListState = getTextListState(data.content, data.bulletStyle);
      const nextStyle =
        kind === "numbered"
          ? currentListState.kind === "numbered"
            ? currentListState.style || "decimal"
            : "decimal"
          : currentListState.kind === "bulleted"
            ? currentListState.style || "default"
            : // Switching TO bulleted: preserve the last-used bullet style.
              data.bulletStyle || "default";
      applyTextBulletState(data, kind, nextStyle);
      buildPropertiesPanel();
    });
  };

  const btnNone = document.getElementById("prop-list-none");
  const btnBullet = document.getElementById("prop-list-bullet");
  const btnNumber = document.getElementById("prop-list-number");

  if (btnNone) btnNone.onclick = () => setListKind("none");
  if (btnBullet) btnBullet.onclick = () => setListKind("bulleted");
  if (btnNumber) btnNumber.onclick = () => setListKind("numbered");

  const listStyle = document.getElementById("prop-list-style");
  if (listStyle) {
    listStyle.onchange = (e) => {
      onCommit(() => {
        applyTextBulletState(data, "bulleted", e.target.value);
        buildPropertiesPanel();
      });
    };
  }

  const numberStyle = document.getElementById("prop-list-number-style");
  if (numberStyle) {
    numberStyle.onchange = (e) => {
      onCommit(() => {
        applyTextBulletState(data, "numbered", e.target.value);
        buildPropertiesPanel();
      });
    };
  }

  const indentBtn = document.getElementById("prop-list-indent");
  const outdentBtn = document.getElementById("prop-list-outdent");

  if (indentBtn) {
    indentBtn.onclick = () => {
      if (getTextListState(data.content, data.bulletStyle).kind !== "bulleted")
        return;
      onCommit(() => {
        shiftTextBulletLevels(data, 1);
        buildPropertiesPanel();
      });
    };
  }

  if (outdentBtn) {
    outdentBtn.onclick = () => {
      if (getTextListState(data.content, data.bulletStyle).kind !== "bulleted")
        return;
      onCommit(() => {
        shiftTextBulletLevels(data, -1);
        buildPropertiesPanel();
      });
    };
  }
}
