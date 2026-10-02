// Properties panel section for shape elements.

function buildShapePanel(panel, data) {
  const shapeGrp = createGroup("Shape");
  const isArrowShape =
    typeof isBlockArrowShape === "function" &&
    isBlockArrowShape(data.shapeType);
  const arrowHeadSize = Math.max(
    12,
    Math.min(80, Number(data.arrowHeadSize) || 38),
  );
  const arrowShaftSize = Math.max(
    12,
    Math.min(90, Number(data.arrowShaftSize) || 36),
  );
  shapeGrp.innerHTML += `
                <div class="space-y-3">
                    <div class="grid grid-cols-[1fr_auto] gap-2 items-end">
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Type</span>
                            <select id="prop-shape-type" class="prop-select">
                                ${(typeof SHAPE_CATALOG !== "undefined" ? SHAPE_CATALOG : [])
                                  .filter((shape) => !shape.insertAs)
                                  .map((shape) => `<option value="${shape.type}" ${data.shapeType === shape.type ? "selected" : ""}>${shape.group === "arrow" ? `Arrow ${shape.label}` : shape.label}</option>`)
                                  .join("")}
                            </select>
                        </label>
                        <span class="shape-type-chip">${isArrowShape ? "Block arrow" : "Shape"}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Width</span>
                            <input type="number" id="prop-shape-width" class="prop-input-sm" min="12" max="3000" step="1" value="${Math.round(parseFloat(data.width) || 150)}">
                        </label>
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Height</span>
                            <input type="number" id="prop-shape-height" class="prop-input-sm" min="12" max="3000" step="1" value="${Math.round(parseFloat(data.height) || 150)}">
                        </label>
                    </div>
                    ${
                      isArrowShape
                        ? `
                    <div class="shape-arrow-controls">
                        <label class="shape-range-row">
                            <span>Head</span>
                            <input type="range" id="prop-shape-arrow-head-range" min="12" max="80" step="1" value="${arrowHeadSize}">
                            <input type="number" id="prop-shape-arrow-head" class="prop-input-sm" min="12" max="80" step="1" value="${arrowHeadSize}">
                        </label>
                        <label class="shape-range-row">
                            <span>Shaft</span>
                            <input type="range" id="prop-shape-arrow-shaft-range" min="12" max="90" step="1" value="${arrowShaftSize}">
                            <input type="number" id="prop-shape-arrow-shaft" class="prop-input-sm" min="12" max="90" step="1" value="${arrowShaftSize}">
                        </label>
                    </div>
                    `
                        : ""
                    }
                </div>
            `;
  panel.appendChild(shapeGrp);
  panel.appendChild(_buildShapeTextGroup(data));
}

// Words in the shape and how they look (double-clicking the shape types in it too).
function _buildShapeTextGroup(data) {
  const group = createGroup("Shape Text");
  const style = typeof getShapeTextStyle === "function" ? getShapeTextStyle(data) : {};
  const toHex = (value) => (typeof _normalizeColorForInput === "function" ? _normalizeColorForInput(value, "#172033") : value);
  const segment = (id, options, current) =>
    `<div class="prop-btn-group" id="${id}">${options
      .map(([value, icon, label]) => `<button type="button" data-value="${value}" class="${current === value ? "active" : ""}" title="${label}" aria-label="${label}"><i class="fa-solid ${icon}"></i></button>`)
      .join("")}</div>`;
  group.innerHTML += `
    <div class="space-y-3">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-600 uppercase font-semibold">Text</span>
        <textarea id="prop-shape-text" class="w-full text-sm" rows="2" placeholder="Type here, or double-click the shape">${escapeHtml(data.shapeText || "")}</textarea>
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-600 uppercase font-semibold">Size</span>
          <input type="number" id="prop-shape-text-size" class="prop-input-sm" min="6" max="200" value="${parseFloat(style.fontSize) || 20}">
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-600 uppercase font-semibold">Colour</span>
          <input type="color" id="prop-shape-text-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${toHex(style.color)}">
        </label>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        ${segment("prop-shape-text-weight", [["700", "fa-bold", "Bold"]], style.fontWeight === "700" || style.fontWeight === "bold" ? "700" : "")}
        ${segment("prop-shape-text-italic", [["italic", "fa-italic", "Italic"]], style.fontStyle)}
        ${segment("prop-shape-text-align", [["left", "fa-align-left", "Align left"], ["center", "fa-align-center", "Centre"], ["right", "fa-align-right", "Align right"]], style.textAlign)}
        ${segment("prop-shape-text-valign", [["top", "fa-arrow-up-long", "Top"], ["middle", "fa-grip-lines", "Middle"], ["bottom", "fa-arrow-down-long", "Bottom"]], style.verticalAlign)}
      </div>
    </div>`;
  return group;
}

function _bindShapeTextGroup(data) {
  const commitStyle = (key, value) => {
    saveStateToUndo();
    const live = getSelectedElementData() || data;
    const next = { ...(live.shapeTextStyle || {}), [key]: value };
    updateElementState(live.id, { shapeTextStyle: next });
    live.shapeTextStyle = next;
    renderSlidesFromState();
    refreshPreviews?.();
    schedulePresentationAutosave?.(150);
    buildPropertiesPanel();
  };
  const text = document.getElementById("prop-shape-text");
  if (text) {
    text.addEventListener("change", () => {
      saveStateToUndo();
      updateElementState(data.id, { shapeText: text.value });
      data.shapeText = text.value;
      renderSlidesFromState();
      refreshPreviews?.();
      schedulePresentationAutosave?.(150);
    });
  }
  document.getElementById("prop-shape-text-size")?.addEventListener("change", (event) => {
    const size = Math.max(6, Math.min(200, Number(event.target.value) || 20));
    commitStyle("fontSize", `${size}px`);
  });
  document.getElementById("prop-shape-text-color")?.addEventListener("change", (event) => commitStyle("color", event.target.value));
  const bindSegment = (id, key, toggleValue = null, offValue = null) => {
    document.querySelectorAll(`#${id} button`).forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.value;
        if (toggleValue) commitStyle(key, button.classList.contains("active") ? offValue : toggleValue);
        else commitStyle(key, value);
      });
    });
  };
  bindSegment("prop-shape-text-weight", "fontWeight", "700", "400");
  bindSegment("prop-shape-text-italic", "fontStyle", "italic", "normal");
  bindSegment("prop-shape-text-align", "textAlign");
  bindSegment("prop-shape-text-valign", "verticalAlign");
}

function bindShapePanel(data, onCommit) {
  _bindShapeTextGroup(data);
  const shapeType = document.getElementById("prop-shape-type");
  const shapeWidth = document.getElementById("prop-shape-width");
  const shapeHeight = document.getElementById("prop-shape-height");
  const arrowHead = document.getElementById("prop-shape-arrow-head");
  const arrowHeadRange = document.getElementById(
    "prop-shape-arrow-head-range",
  );
  const arrowShaft = document.getElementById("prop-shape-arrow-shaft");
  const arrowShaftRange = document.getElementById(
    "prop-shape-arrow-shaft-range",
  );
  const syncShapeVisual = () => {
    const dom = document.getElementById(data.id);
    if (!dom || typeof getShapeStyle !== "function") return;
    const visual = getShapeStyle(data);
    if (typeof renderShapeContent === "function") {
      renderShapeContent(dom, data);
    } else {
      dom.style.clipPath = visual.clipPath;
      dom.style.borderRadius = visual.borderRadius;
    }
    updateElementStyleState(data.id, {
      borderRadius: visual.borderRadius,
    });
  };
  const bindShapeDimension = (input, key) => {
    if (!input) return;
    const commit = () => {
      const next = Math.max(
        12,
        Math.min(3000, Number(input.value) || 12),
      );
      onCommit(() => {
        updateElementState(data.id, { [key]: `${next}px` });
        data[key] = `${next}px`;
        const dom = document.getElementById(data.id);
        if (dom) dom.style[key] = `${next}px`;
        updateGroupBound?.();
      });
    };
    input.onchange = commit;
    input.onblur = commit;
  };
  const bindShapeArrowPercent = (
    numberInput,
    rangeInput,
    key,
    min,
    max,
    fallback,
  ) => {
    const clamp = (value) =>
      Math.max(min, Math.min(max, Number(value) || fallback));
    const apply = (source) => {
      const next = clamp(source.value);
      if (numberInput) numberInput.value = next;
      if (rangeInput) rangeInput.value = next;
      updateElementState(data.id, { [key]: next });
      data[key] = next;
      syncShapeVisual();
    };
    if (numberInput) {
      numberInput.onchange = () => onCommit(() => apply(numberInput));
      numberInput.onblur = () => onCommit(() => apply(numberInput));
    }
    if (rangeInput) {
      bindUndoableContinuousInput(rangeInput, () => apply(rangeInput));
    }
  };

  if (shapeType) {
    shapeType.onchange = (e) => {
      onCommit(() => {
        const value = e.target.value;
        const patch = { shapeType: value };
        if (
          typeof isBlockArrowShape === "function" &&
          isBlockArrowShape(value)
        ) {
          patch.arrowHeadSize = Number(data.arrowHeadSize) || 38;
          patch.arrowShaftSize = Number(data.arrowShaftSize) || 36;
          data.arrowHeadSize = patch.arrowHeadSize;
          data.arrowShaftSize = patch.arrowShaftSize;
        }
        updateElementState(data.id, patch);
        data.shapeType = value;
        syncShapeVisual();
        buildPropertiesPanel();
      });
    };
  }
  bindShapeDimension(shapeWidth, "width");
  bindShapeDimension(shapeHeight, "height");
  bindShapeArrowPercent(
    arrowHead,
    arrowHeadRange,
    "arrowHeadSize",
    12,
    80,
    38,
  );
  bindShapeArrowPercent(
    arrowShaft,
    arrowShaftRange,
    "arrowShaftSize",
    12,
    90,
    36,
  );
}
