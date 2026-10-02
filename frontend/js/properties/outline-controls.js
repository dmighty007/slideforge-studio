// Properties panel: element outline (border) controls.

function normalizeBorderWidthValue(value, fallback = "0px") {
  const num = Number.parseFloat(String(value ?? "").replace("px", ""));
  return Number.isFinite(num) && num >= 0 ? `${num}px` : fallback;
}

function getElementOutlineState(data) {
  const width = normalizeBorderWidthValue(data?.styles?.borderWidth, "0px");
  const style =
    data?.styles?.borderStyle || (parseFloat(width) > 0 ? "solid" : "none");
  return {
    width,
    style,
    color: _normalizeColorForInput(data?.styles?.borderColor, "#334155"),
    radius: normalizeBorderWidthValue(data?.styles?.borderRadius, "0px"),
  };
}

function appendElementOutlineControls(group, data) {
  if (!data || !["text", "shape"].includes(data.type)) return;
  const outline = getElementOutlineState(data);
  group.appendChild(
    createField(
      "Outline",
      `
        <div class="grid grid-cols-4 gap-2 items-end">
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Style</label>
                <select id="prop-outline-style" class="prop-input-sm">
                    <option value="none" ${outline.style === "none" ? "selected" : ""}>None</option>
                    <option value="solid" ${outline.style === "solid" ? "selected" : ""}>Solid</option>
                    <option value="dashed" ${outline.style === "dashed" ? "selected" : ""}>Dash</option>
                    <option value="dotted" ${outline.style === "dotted" ? "selected" : ""}>Dot</option>
                </select>
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Width</label>
                <input type="number" id="prop-outline-width" class="prop-input-sm" min="0" max="32" step="1" value="${parseFloat(outline.width) || 0}">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Color</label>
                <input type="color" id="prop-outline-color" class="prop-color-input" value="${outline.color}">
            </div>
            <div>
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Radius</label>
                <input type="number" id="prop-outline-radius" class="prop-input-sm" min="0" max="999" step="1" value="${parseFloat(outline.radius) || 0}">
            </div>
        </div>
    `,
    ),
  );
}

function bindElementOutlineControls(data) {
  if (!data || !["text", "shape"].includes(data.type)) return;
  const styleInput = document.getElementById("prop-outline-style");
  const widthInput = document.getElementById("prop-outline-width");
  const colorInput = document.getElementById("prop-outline-color");
  const radiusInput = document.getElementById("prop-outline-radius");
  if (!styleInput || !widthInput || !colorInput || !radiusInput) return;

  const commit = () => {
    const nextStyle = styleInput.value || "none";
    const nextWidth =
      nextStyle === "none"
        ? "0px"
        : normalizeBorderWidthValue(widthInput.value, "1px");
    const nextColor = _normalizeColorForInput(colorInput.value, "#334155");
    const nextRadius = normalizeBorderWidthValue(radiusInput.value, "0px");

    saveStateToUndo();
    updateElementStyleState(data.id, {
      borderStyle: nextStyle,
      borderWidth: nextWidth,
      borderColor: nextColor,
      borderRadius: nextRadius,
    });
    Object.assign(data.styles, {
      borderStyle: nextStyle,
      borderWidth: nextWidth,
      borderColor: nextColor,
      borderRadius: nextRadius,
    });

    const dom = document.getElementById(data.id);
    if (dom) {
      _setElementDomStyleProperty(dom, "borderStyle", nextStyle);
      _setElementDomStyleProperty(dom, "borderWidth", nextWidth);
      _setElementDomStyleProperty(dom, "borderColor", nextColor);
      _setElementDomStyleProperty(dom, "borderRadius", nextRadius);
      if (data.type === "shape" && typeof renderShapeContent === "function") {
        renderShapeContent(dom, data);
      }
      if (data.type === "text") {
        const layout = syncTextBoxLayout(dom, data);
        if (layout?.autoHeight && Number.isFinite(layout.height)) {
          updateElementState(data.id, { height: `${layout.height}px` });
          data.height = `${layout.height}px`;
        }
      }
    }
    refreshPreviews?.();
    updateGroupBound();
    schedulePresentationAutosave?.(150);
  };

  styleInput.onchange = () => {
    if (styleInput.value !== "none" && Number(widthInput.value) === 0)
      widthInput.value = "1";
    commit();
  };
  widthInput.onchange = commit;
  widthInput.onblur = commit;
  colorInput.oninput = commit;
  colorInput.onchange = commit;
  radiusInput.onchange = commit;
  radiusInput.onblur = commit;
}
