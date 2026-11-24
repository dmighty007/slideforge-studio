function _extractExistingTextHref(data) {
  if (!data) return "";
  const dom = document.getElementById(data.id);
  const host = dom?.querySelector(".text-element-content");
  const sel = window.getSelection?.();
  if (host && sel && sel.rangeCount > 0 && host.contains(sel.anchorNode)) {
    const anchorEl =
      (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest?.("a[href]") ||
      (sel.focusNode?.nodeType === 1 ? sel.focusNode : sel.focusNode?.parentElement)?.closest?.("a[href]");
    if (anchorEl) return anchorEl.getAttribute("href") || "";
  }
  if (typeof data.content === "string") {
    const m = data.content.match(/<a\s+[^>]*href=["']([^"']+)["']/i);
    if (m) return m[1];
  }
  return data.clickLink || "";
}

function _slideLabelForLinkOption(slide, idx) {
  let heading = "";
  for (const el of slide?.elements || []) {
    if (el?.type === "text" && typeof el.content === "string") {
      const plain = el.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (plain && !/^SLIDEFORGE$/i.test(plain) && !/^\d+\s*\/\s*\d+$/.test(plain) && !/^BACKUP$/i.test(plain)) {
        heading = plain;
        break;
      }
    }
  }
  const shortHeading = heading.length > 36 ? `${heading.slice(0, 35)}…` : heading;
  const suffix = slide?.hidden ? " (Hidden backup)" : "";
  return `Slide ${idx + 1}${shortHeading ? ` — ${shortHeading}` : ""}${suffix}`;
}

function buildElementLinkGroup(panel, data) {
  if (!data || !["text", "shape", "image", "plugin"].includes(data.type)) return;
  const currentHref = data.type === "plugin" ? (data.pluginData?.href || data.clickLink || "") : _extractExistingTextHref(data);
  const slides = state.slides || [];
  const isSlideHref = currentHref.startsWith("#slide:");
  const isUrlHref = Boolean(currentHref && !isSlideHref);
  const presetTargets = [
    ["#slide:next", "Next slide"],
    ["#slide:previous", "Previous slide"],
    ["#slide:first", "First slide"],
    ["#slide:last", "Last shown slide"],
  ];

  const slideOptionsHtml = [
    `<option value="" ${!currentHref ? "selected" : ""}>No link</option>`,
    `<optgroup label="Slide in this deck">`,
    ...slides.map((s, idx) => {
      const val = `#slide:${s.id}`;
      return `<option value="${escapeHtml(val)}" ${currentHref === val ? "selected" : ""}>${escapeHtml(_slideLabelForLinkOption(s, idx))}</option>`;
    }),
    ...presetTargets.map(
      ([val, label]) =>
        `<option value="${val}" ${currentHref === val ? "selected" : ""}>${label}</option>`,
    ),
    `</optgroup>`,
    `<optgroup label="External">`,
    `<option value="__url__" ${isUrlHref ? "selected" : ""}>Web address or email (https:// or mailto:)</option>`,
    `</optgroup>`,
  ].join("");

  const linkGrp = createGroup("Link");
  linkGrp.classList.add("prop-group-compact");
  linkGrp.appendChild(
    createField(
      data.type === "text" ? "Link selected text (or box)" : "Click action while presenting",
      `
        <div class="space-y-2">
          <select id="prop-link-destination" class="prop-select">
            ${slideOptionsHtml}
          </select>
          <div id="prop-link-url-row" class="${isUrlHref ? "" : "hidden"} flex gap-1.5">
            <input type="text" id="prop-link-url" class="prop-input-sm flex-1" placeholder="https://example.org or #slide:..." value="${escapeHtml(isUrlHref ? currentHref : "")}">
            <button type="button" id="prop-link-apply" class="prop-action-btn" style="width:auto;padding:0 10px;">Apply</button>
          </div>
          ${currentHref ? `<div class="flex items-center justify-between text-xs text-slate-600 pt-0.5">
            <span class="truncate" title="${escapeHtml(currentHref)}"><i class="fa-solid fa-link text-primary mr-1"></i>${escapeHtml(currentHref)}</span>
            <button type="button" id="prop-link-remove" class="text-red-600 hover:underline font-semibold ml-2 shrink-0">Remove link</button>
          </div>` : `<div class="prop-field-hint">${data.type === "text" ? "Highlight words on the canvas (or select the box) and choose a slide or hidden backup slide to jump to while presenting." : "Clicking this object while presenting jumps to the chosen slide or opens the web link."}</div>`}
        </div>
      `,
    ),
  );
  panel.appendChild(linkGrp);

  const destSelect = linkGrp.querySelector("#prop-link-destination");
  const urlRow = linkGrp.querySelector("#prop-link-url-row");
  const urlInput = linkGrp.querySelector("#prop-link-url");
  const applyBtn = linkGrp.querySelector("#prop-link-apply");
  const removeBtn = linkGrp.querySelector("#prop-link-remove");

  if (destSelect) bindInlineFormattingGuard(destSelect);
  if (applyBtn) bindInlineFormattingGuard(applyBtn);
  if (removeBtn) bindInlineFormattingGuard(removeBtn);

  if (destSelect) {
    destSelect.onchange = () => {
      const val = destSelect.value;
      if (val === "__url__") {
        urlRow?.classList.remove("hidden");
        urlInput?.focus();
        return;
      }
      urlRow?.classList.add("hidden");
      applyElementLink(data.id, val);
    };
  }
  if (applyBtn && urlInput) {
    const commitUrl = () => {
      let raw = (urlInput.value || "").trim();
      if (raw && !/^(https?:|mailto:|#slide:)/i.test(raw)) {
        raw = `https://${raw}`;
      }
      applyElementLink(data.id, raw);
    };
    applyBtn.onclick = commitUrl;
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitUrl();
      }
    });
  }
  if (removeBtn) {
    removeBtn.onclick = () => applyElementLink(data.id, "");
  }
}

function applyElementLink(elementId, href) {
  const slide = state.slides?.[currentSlideIndex];
  const data = slide?.elements?.find((el) => el.id === elementId);
  if (!data) return false;
  const cleanHref = String(href || "").trim();
  if (cleanHref && typeof isSafeClickLink === "function" && !isSafeClickLink(cleanHref)) {
    showNotification?.("Enter a valid slide link (#slide:...) or web address (https://...)", "error");
    return false;
  }

  saveStateToUndo();

  if (data.type === "text" && !data.iconMode && !Array.isArray(data.content)) {
    const dom = document.getElementById(data.id);
    const host = dom?.querySelector(".text-element-content");
    if (host && typeof restoreInlineSelection === "function") {
      restoreInlineSelection(host);
    }
    const sel = window.getSelection?.();
    const hasInlineRange =
      host &&
      sel &&
      sel.rangeCount > 0 &&
      !sel.getRangeAt(0).collapsed &&
      host.contains(sel.getRangeAt(0).commonAncestorContainer);

    if (!cleanHref) {
      // Remove link from selected anchor or whole text box
      if (host) {
        const existingAnchors = [...host.querySelectorAll("a[href]")];
        existingAnchors.forEach((a) => {
          const textNode = document.createTextNode(a.textContent || "");
          a.replaceWith(textNode);
        });
        host.normalize();
        data.content = sanitizeTextContentValue(host.innerHTML);
      } else if (typeof data.content === "string") {
        data.content = data.content.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
      }
      delete data.clickLink;
      delete data.textDocument;
    } else if (hasInlineRange) {
      const range = sel.getRangeAt(0);
      // Unwrap any nested anchors inside the selection first
      const fragment = range.extractContents();
      fragment.querySelectorAll?.("a").forEach((a) => {
        a.replaceWith(...a.childNodes);
      });
      const anchor = document.createElement("a");
      anchor.setAttribute("href", cleanHref);
      anchor.appendChild(fragment);
      range.insertNode(anchor);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(anchor);
      sel.addRange(newRange);
      if (typeof saveInlineSelection === "function") saveInlineSelection(host);
      data.content = sanitizeTextContentValue(host.innerHTML);
      delete data.textDocument;
    } else {
      // If cursor is inside an existing <a>, update its href; otherwise wrap the text box's content in <a href="...">
      const anchorInHost =
        host &&
        sel &&
        sel.rangeCount > 0 &&
        host.contains(sel.anchorNode) &&
        (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest?.("a[href]");
      if (anchorInHost) {
        anchorInHost.setAttribute("href", cleanHref);
        data.content = sanitizeTextContentValue(host.innerHTML);
      } else if (typeof data.content === "string" && /^<a\b[^>]*>[\s\S]*<\/a>$/i.test(data.content.trim())) {
        data.content = data.content.replace(/^<a\b[^>]*>/i, `<a href="${escapeHtml(cleanHref)}">`);
      } else {
        const inner = String(data.content || "").replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
        let fallbackLabel = inner;
        if (!fallbackLabel.replace(/<[^>]+>/g, "").trim()) {
          if (cleanHref.startsWith("#slide:")) {
            const targetId = cleanHref.slice(7);
            const targetIdx = (state.slides || []).findIndex((s) => s?.id === targetId);
            if (targetIdx >= 0) {
              fallbackLabel = escapeHtml(_slideLabelForLinkOption(state.slides[targetIdx], targetIdx));
            } else {
              fallbackLabel = escapeHtml(`Go to ${targetId} slide`);
            }
          } else {
            fallbackLabel = escapeHtml(cleanHref);
          }
        }
        data.content = `<a href="${escapeHtml(cleanHref)}">${fallbackLabel}</a>`;
      }
      delete data.textDocument;
    }
  } else {
    if (cleanHref) {
      data.clickLink = cleanHref;
      if (data.type === "plugin" && data.pluginId === "designer-button" && data.pluginData) {
        data.pluginData = { ...data.pluginData, href: cleanHref };
      }
    } else {
      delete data.clickLink;
      if (data.type === "plugin" && data.pluginId === "designer-button" && data.pluginData) {
        data.pluginData = { ...data.pluginData, href: "" };
      }
    }
  }

  renderSlidesFromState?.();
  buildPropertiesPanel?.({ immediate: true });
  schedulePresentationAutosave?.(150);
  return true;
}

function openElementLinkInspector(elementId = null) {
  const id = elementId || state.selectedIds?.[0];
  if (id && (!state.selectedIds?.includes(id) || state.selectedIds.length !== 1)) {
    selectElement?.(id, "replace");
  }
  setPropertiesPanelVisible?.(true, { persist: false });
  if (typeof _propertiesPanelActiveTab !== "undefined") {
    _propertiesPanelActiveTab = "content";
  }
  buildPropertiesPanel?.({ immediate: true });
  requestAnimationFrame(() => {
    const select = document.getElementById("prop-link-destination");
    if (select) {
      select.scrollIntoView({ behavior: "smooth", block: "center" });
      select.focus();
    }
  });
}

window.buildElementLinkGroup = buildElementLinkGroup;
window.applyElementLink = applyElementLink;
window.openElementLinkInspector = openElementLinkInspector;

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
  buildElementLinkGroup(panel, data);

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
    // How far the text was shrunk to fit, so a title at 24 pt is noticed (1 px = 0.75 pt at the slide's size), with a
    // way to keep the set size by letting the box grow instead (study 2026-10-16b).
    const node = [...document.querySelectorAll(`[id="${data.id}"]`)].find((n) => !n.closest("#slide-previews"));
    const shown = parseFloat(node?.querySelector(".text-element-content")?.style.fontSize);
    const set = parseFloat(data.styles?.fontSize);
    if (Number.isFinite(shown) && Number.isFinite(set) && shown < set - 0.5) {
      const points = Math.round(shown * 0.75);
      const small = points < 28;
      const note = document.createElement("div");
      note.id = "prop-text-autofit-note";
      note.className = `prop-field-hint text-autofit-note${small ? " is-small" : ""}`;
      note.innerHTML = `Shrunk to ${points} pt to fit (set: ${Math.round(set * 0.75)} pt)${small ? ", small for a slide title" : ""}. <button type="button" id="prop-text-autofit-grow" class="font-semibold text-primary">Keep ${Math.round(set * 0.75)} pt, grow the box</button>`;
      layoutGrp.appendChild(note);
    }
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

  // Size and colour on one row; the formatting buttons on their own (seven buttons in half a row were squeezed).
  const textToolsRow = document.createElement("div");
  textToolsRow.className = "grid grid-cols-2 gap-2 items-end mt-2";

  // Size
  const sizeCol = document.createElement("div");
  sizeCol.className = "col-span-1";
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
  formatCol.className = "prop-format-row flex gap-1";
  formatCol.innerHTML = `
        <button id="prop-bold" class="prop-icon-btn ${data.styles.fontWeight === "bold" ? "active" : ""}" title="Bold">B</button>
        <button id="prop-italic" class="prop-icon-btn italic ${data.styles.fontStyle === "italic" ? "active" : ""}" title="Italic">I</button>
        <button id="prop-underline" class="prop-icon-btn underline ${isUnderline ? "active" : ""}" title="Underline">U</button>
        <button id="prop-strikethrough" class="prop-icon-btn line-through ${isStrike ? "active" : ""}" title="Strikethrough">S</button>
        <button id="prop-subscript" class="prop-icon-btn" title="Subscript (select the characters first)" aria-label="Subscript">X<sub>2</sub></button>
        <button id="prop-superscript" class="prop-icon-btn" title="Superscript (select the characters first)" aria-label="Superscript">X<sup>2</sup></button>
        <button id="prop-clear-format" class="prop-icon-btn" title="Clear formatting"><i class="fa-solid fa-eraser"></i></button>
    `;

  textToolsRow.appendChild(sizeCol);
  textToolsRow.appendChild(colorCol);
  grp.appendChild(textToolsRow);
  grp.appendChild(formatCol);

  const shadowState = _parseTextShadowValue(data.styles?.textShadow);
  const strokeWidth =
    parseFloat(
      _normalizeStrokeWidthValue(data.styles?.textStrokeWidth, "0px"),
    ) || 0;
  const strokeColor = _normalizeColorForInput(
    data.styles?.textStrokeColor,
    "#000000",
  );

  const shadowField = (
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
    )
  );

  const strokeField = (
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
    )
  );

  const effectsField = (
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
    )
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
  // A plain multiple is shown as stored; with none (the theme's), "normal" or pixels, the spacing the text is drawn with.
  const storedLineHeight = String(data.styles.lineHeight ?? "").trim();
  const drawnLineHeight = (() => {
    const host = document.getElementById(data.id)?.querySelector(".text-element-content");
    if (!host) return null;
    const cs = getComputedStyle(host);
    const ratio = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    return Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio * 100) / 100 : null;
  })();
  const lineHeightRaw = /^\d*\.?\d+$/.test(storedLineHeight)
    ? parseFloat(storedLineHeight)
    : drawnLineHeight || 1.2;
  const letterSpacingRaw = parseFloat(data.styles.letterSpacing) || 0;
  spacingRow.innerHTML = `
        <div>
            <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Line spacing</label>
            <input type="number" id="prop-line-height" class="prop-input-sm" value="${lineHeightRaw}" min="0.8" max="4" step="0.05">
        </div>
    `;
  grp.appendChild(spacingRow);

  // Set now and then, not on most edits: folded under one line (the open/closed state survives the panel's rebuilds).
  const letterRow = document.createElement("div");
  letterRow.className = "grid grid-cols-2 gap-2 items-end";
  letterRow.innerHTML = `
        <div>
            <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Letter spacing</label>
            <input type="number" id="prop-letter-spacing" class="prop-input-sm" value="${letterSpacingRaw}" min="-5" max="20" step="0.5">
        </div>
    `;
  grp.appendChild(createMoreSection("Effects and spacing", [letterRow, shadowField, strokeField, effectsField]));

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
  for (const action of ["subscript", "superscript"]) {
    const button = document.getElementById(`prop-${action}`);
    if (!button) continue;
    bindInlineFormattingGuard(button);
    button.onclick = () => applyTextFormatting(action, null, { inlineAction: action });
  }

  const bold = document.getElementById("prop-bold");
  if (bold) {
    bindInlineFormattingGuard(bold);
    bold.onclick = () => {
      const selStyle = typeof getStyleAtSelection === "function" ? getStyleAtSelection() : null;
      const isBoldNow = selStyle ? selStyle.fontWeight === "bold" : data.styles.fontWeight === "bold";
      applyTextFormatting(
        "fontWeight",
        isBoldNow ? "normal" : "bold",
        { inlineAction: "bold" },
      );
    };
    setTextControlActive(bold, data.styles.fontWeight === "bold");
  }

  const italic = document.getElementById("prop-italic");
  if (italic) {
    bindInlineFormattingGuard(italic);
    italic.onclick = () => {
      const selStyle = typeof getStyleAtSelection === "function" ? getStyleAtSelection() : null;
      const isItalicNow = selStyle ? selStyle.fontStyle === "italic" : data.styles.fontStyle === "italic";
      applyTextFormatting(
        "fontStyle",
        isItalicNow ? "normal" : "italic",
        {
          inlineAction: "italic",
        },
      );
    };
    setTextControlActive(italic, data.styles.fontStyle === "italic");
  }

  const underlineBtn = document.getElementById("prop-underline");
  if (underlineBtn) {
    bindInlineFormattingGuard(underlineBtn);
    const _curDecoration = data.styles.textDecoration || "";
    const _hasUnderline = _curDecoration.includes("underline");
    underlineBtn.onclick = () => {
      const curDec = data.styles.textDecoration || "";
      const selStyle = typeof getStyleAtSelection === "function" ? getStyleAtSelection() : null;
      const hasUnderlineNow = selStyle ? Boolean(selStyle.underline) : curDec.includes("underline");
      applyTextFormatting(
        "textDecoration",
        hasUnderlineNow
          ? curDec.replace("underline", "").trim() || "none"
          : [curDec.replace("none", "").trim(), "underline"].filter(Boolean).join(" ").trim(),
        { inlineAction: "underline" },
      );
    };
    setTextControlActive(underlineBtn, _hasUnderline);
  }

  const strikethroughBtn = document.getElementById("prop-strikethrough");
  if (strikethroughBtn) {
    bindInlineFormattingGuard(strikethroughBtn);
    const _curDec2 = data.styles.textDecoration || "";
    const _hasStrike = _curDec2.includes("line-through");
    strikethroughBtn.onclick = () => {
      const curDec = data.styles.textDecoration || "";
      const selStyle = typeof getStyleAtSelection === "function" ? getStyleAtSelection() : null;
      const hasStrikeNow = selStyle ? Boolean(selStyle.strikethrough) : curDec.includes("line-through");
      applyTextFormatting(
        "textDecoration",
        hasStrikeNow
          ? curDec.replace("line-through", "").trim() || "none"
          : [curDec.replace("none", "").trim(), "line-through"].filter(Boolean).join(" ").trim(),
        { inlineAction: "strikethrough" },
      );
    };
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

  const autoFitGrow = document.getElementById("prop-text-autofit-grow");
  if (autoFitGrow && textFitMode) {
    autoFitGrow.onclick = () => {
      textFitMode.value = "autoHeight";
      textFitMode.dispatchEvent(new Event("change"));
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
      const next = String(Math.round(v * 100) / 100);
      // change and blur both land here; applyStyle saves the undo step, so a change is one Ctrl+Z.
      const live = state.slides[currentSlideIndex]?.elements?.find((item) => item.id === data.id) || data;
      // (Unless paragraphs still carry their own, as imported text does: the same number then evens them out.)
      const paragraphsOwnSpacing = /line-height:\s*[\d.]/.test(JSON.stringify(live.content ?? ""));
      if (String(live.styles?.lineHeight ?? "") === next && !paragraphsOwnSpacing) return;
      applyStyle("lineHeight", next);
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

// An icon (a text box holding one Font Awesome glyph) gets its own small panel: which icon, its size and colour.
// It had the whole text panel: an empty text editor, list and fitting settings, and typography for one glyph.
function buildIconPanel(panel, data) {
  const group = createGroup("Icon");
  const size = Math.round(parseFloat(data.styles?.fontSize) || 64);
  group.innerHTML += `
    <div class="prop-icon-panel">
      <div class="prop-icon-preview" aria-hidden="true"><i class="${escapeHtml(data.iconClass || "fa-solid fa-star")}"></i></div>
      <button type="button" id="prop-icon-change" class="prop-action-btn w-full"><i class="fa-solid fa-icons"></i> Change icon…</button>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs font-bold text-slate-600 uppercase tracking-wide">Size</span>
        <input type="number" id="prop-icon-size" class="prop-input-sm" min="12" max="400" step="2" value="${size}">
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs font-bold text-slate-600 uppercase tracking-wide">Colour</span>
        <input type="color" id="prop-icon-color" class="prop-color-input" value="${_normalizeColorForInput(data.styles?.color, "#0f172a")}">
      </label>
    </div>`;
  panel.appendChild(group);
  setTimeout(() => {
    document.getElementById("prop-icon-change")?.addEventListener("click", () => {
      window._iconPickerReplaceId = data.id;
      openIconPicker();
    });
    const sizeInput = document.getElementById("prop-icon-size");
    sizeInput?.addEventListener("change", () => {
      const live = state.slides[currentSlideIndex]?.elements.find((item) => item.id === data.id);
      if (!live) return;
      const next = Math.max(12, Math.min(400, Math.round(Number(sizeInput.value) || 64)));
      const box = Math.round(next * 1.5625);
      const oldW = parseFloat(live.width) || box;
      const oldH = parseFloat(live.height) || box;
      saveStateToUndo();
      // The box grows about its centre, so the icon stays where it was.
      updateElementState(live.id, {
        styles: { ...live.styles, fontSize: `${next}px` },
        width: `${box}px`,
        height: `${box}px`,
        x: Math.round((Number(live.x) || 0) + (oldW - box) / 2),
        y: Math.round((Number(live.y) || 0) + (oldH - box) / 2),
      });
      renderSlidesFromState();
      selectElement(live.id, "replace");
      schedulePresentationAutosave?.(150);
    });
    const colorInput = document.getElementById("prop-icon-color");
    if (colorInput && typeof bindUndoableContinuousInput === "function") {
      bindUndoableContinuousInput(colorInput, (event) => {
        const live = state.slides[currentSlideIndex]?.elements.find((item) => item.id === data.id);
        if (!live) return;
        updateElementState(live.id, { styles: { ...live.styles, color: event.target.value } });
        const node = [...document.querySelectorAll(`[id="${live.id}"]`)].find((n) => !n.closest("#slide-previews"));
        if (node) node.style.color = event.target.value;
        schedulePresentationAutosave?.(150);
      });
    }
  }, 0);
}
