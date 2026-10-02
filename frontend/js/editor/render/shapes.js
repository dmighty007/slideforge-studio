// Shape styles, polygons and shape rendering.

function isBlockArrowShape(shapeType = "") {
  return ["arrow-right", "arrow-left", "arrow-up", "arrow-down"].includes(
    shapeType,
  );
}

function _clampShapePercent(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function getShapeStyle(shape = "rectangle") {
  const shapeType =
    typeof shape === "string" ? shape : shape?.shapeType || "rectangle";
  const arrowHeadSize = _clampShapePercent(
    typeof shape === "string" ? undefined : shape?.arrowHeadSize,
    38,
    12,
    80,
  );
  const arrowShaftSize = _clampShapePercent(
    typeof shape === "string" ? undefined : shape?.arrowShaftSize,
    36,
    12,
    90,
  );
  const shaftStart = (100 - arrowShaftSize) / 2;
  const shaftEnd = 100 - shaftStart;
  const headStart = 100 - arrowHeadSize;
  const headEnd = arrowHeadSize;
  switch (shapeType) {
    case "triangle":
      return {
        clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
        borderRadius: "0px",
      };
    case "diamond":
      return {
        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        borderRadius: "0px",
      };
    case "hexagon":
      return {
        clipPath:
          "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
        borderRadius: "0px",
      };
    case "parallelogram":
      return {
        clipPath: "polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)",
        borderRadius: "0px",
      };
    case "arrow-right":
      return {
        clipPath: `polygon(0% ${shaftStart}%, ${headStart}% ${shaftStart}%, ${headStart}% 0%, 100% 50%, ${headStart}% 100%, ${headStart}% ${shaftEnd}%, 0% ${shaftEnd}%)`,
        borderRadius: "0px",
      };
    case "arrow-left":
      return {
        clipPath: `polygon(${headEnd}% 0%, ${headEnd}% ${shaftStart}%, 100% ${shaftStart}%, 100% ${shaftEnd}%, ${headEnd}% ${shaftEnd}%, ${headEnd}% 100%, 0% 50%)`,
        borderRadius: "0px",
      };
    case "arrow-up":
      return {
        clipPath: `polygon(50% 0%, 100% ${headEnd}%, ${shaftEnd}% ${headEnd}%, ${shaftEnd}% 100%, ${shaftStart}% 100%, ${shaftStart}% ${headEnd}%, 0% ${headEnd}%)`,
        borderRadius: "0px",
      };
    case "arrow-down":
      return {
        clipPath: `polygon(${shaftStart}% 0%, ${shaftEnd}% 0%, ${shaftEnd}% ${headStart}%, 100% ${headStart}%, 50% 100%, 0% ${headStart}%, ${shaftStart}% ${headStart}%)`,
        borderRadius: "0px",
      };
    case "circle":
      // 50%: an ellipse in a box that is not square (9999px drew a stadium), as PowerPoint draws it.
      return { clipPath: "none", borderRadius: "50%" };
    default:
      // Shapes with a fixed outline from the catalog (star, pentagon, callout…).
      if (typeof SHAPE_POLYGONS !== "undefined" && SHAPE_POLYGONS[shapeType]) {
        return {
          clipPath: `polygon(${SHAPE_POLYGONS[shapeType].map(([x, y]) => `${x}% ${y}%`).join(", ")})`,
          borderRadius: "0px",
        };
      }
      return {
        clipPath: "none",
        borderRadius:
          typeof shape === "string"
            ? "0px"
            : shape?.styles?.borderRadius || "0px",
      };
  }
}

function _parseShapePolygonPoints(clipPath = "") {
  const match = String(clipPath).match(/^polygon\((.*)\)$/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((pair) => {
      const values = pair.trim().split(/\s+/);
      if (values.length < 2) return null;
      const x = parseFloat(values[0]);
      const y = parseFloat(values[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    })
    .filter(Boolean);
}

function _parseBorderShorthand(border = "") {
  const text = String(border || "").trim();
  if (!text) return {};
  const widthMatch = text.match(/(?:^|\s)(\d*\.?\d+)px(?:\s|$)/i);
  const styleMatch = text.match(/\b(solid|dashed|dotted|double|none)\b/i);
  let color = text
    .replace(widthMatch?.[0] || "", " ")
    .replace(styleMatch?.[0] || "", " ")
    .trim();
  if (!color || color === "0") color = "";
  return {
    width: widthMatch ? Number(widthMatch[1]) : undefined,
    style: styleMatch ? styleMatch[1].toLowerCase() : undefined,
    color,
  };
}

function _getShapePaint(elData = {}) {
  const styles = elData.styles || {};
  const border = _parseBorderShorthand(styles.border);
  const borderWidth = Math.max(
    0,
    parseFloat(styles.borderWidth ?? border.width ?? 0) || 0,
  );
  const borderStyle = String(
    styles.borderStyle || border.style || "solid",
  ).toLowerCase();
  const borderColor = String(
    styles.borderColor || border.color || "transparent",
  ).trim();
  return {
    fill: styles.backgroundColor || "transparent",
    strokeWidth: borderWidth,
    strokeStyle: borderStyle,
    strokeColor: borderColor,
    hasStroke:
      borderWidth > 0 &&
      borderStyle !== "none" &&
      borderColor &&
      !/^transparent$/i.test(borderColor) &&
      !/^rgba?\([^)]*,\s*0(?:\.0+)?\)$/i.test(borderColor),
  };
}

function renderShapeContent(el, elData = {}) {
  if (!el || elData.type !== "shape") return;
  el.querySelectorAll(":scope > .sf-shape-visual-svg").forEach((node) =>
    node.remove(),
  );
  renderShapeText(el, elData);
  // Double-click types in the shape (not in thumbnails or the shown presentation).
  el.ondblclick = (event) => {
    if (el.closest("#slide-previews") || document.body.classList.contains("play-mode-active")) return;
    const live = state.slides?.[currentSlideIndex]?.elements.find((item) => item.id === elData.id) || elData;
    event.stopPropagation();
    beginShapeTextEdit(el, live);
  };

  const visual = getShapeStyle(elData);
  const points = _parseShapePolygonPoints(visual.clipPath);
  const paint = _getShapePaint(elData);

  if (!points.length) {
    el.style.clipPath = visual.clipPath;
    if (!elData.styles?.borderRadius || elData.shapeType === "circle") {
      el.style.borderRadius = visual.borderRadius;
    }
    el.style.removeProperty("--sf-shape-fill");
    return;
  }

  el.style.clipPath = "none";
  el.style.borderRadius = "0px";
  el.style.backgroundColor = "transparent";
  el.style.border = "0";
  el.style.overflow = "visible";
  el.style.setProperty("--sf-shape-fill", paint.fill);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("sf-shape-visual-svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";

  const polygon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon",
  );
  polygon.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
  polygon.setAttribute("fill", "var(--sf-shape-fill, transparent)");
  polygon.setAttribute("stroke", paint.hasStroke ? paint.strokeColor : "none");
  polygon.setAttribute(
    "stroke-width",
    paint.hasStroke ? String(paint.strokeWidth) : "0",
  );
  polygon.setAttribute("vector-effect", "non-scaling-stroke");
  polygon.setAttribute("stroke-linejoin", "round");
  if (paint.strokeStyle === "dashed") {
    polygon.setAttribute(
      "stroke-dasharray",
      `${paint.strokeWidth * 3} ${paint.strokeWidth * 2}`,
    );
  } else if (paint.strokeStyle === "dotted") {
    polygon.setAttribute(
      "stroke-dasharray",
      `${paint.strokeWidth} ${paint.strokeWidth * 2}`,
    );
    polygon.setAttribute("stroke-linecap", "round");
  }
  svg.appendChild(polygon);
  el.insertBefore(svg, el.firstChild);
}

// ── Text inside shapes ────────────────────────────────────────────────────────────────────────────────────────
// A shape can hold words (shapeText), centred in it by default, like a PowerPoint shape. Shapes had no text at all:
// labelled boxes needed a separate text box laid over each one.

function _shapeFillLuminance(fill) {
  const probe = String(fill || "").trim();
  let r, g, b;
  const hex = probe.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  } else {
    const rgb = probe.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/i);
    if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < 0.4)) return null;
    [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
  }
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// The text style of a shape, with defaults: white words on a dark fill, dark ones on a light fill (or the theme's
// text colour on an unfilled shape), centred both ways.
function getShapeTextStyle(elData = {}) {
  const own = elData.shapeTextStyle || {};
  const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : {};
  const lum = _shapeFillLuminance(elData.styles?.backgroundColor);
  const autoColor = lum === null ? theme.defaultTextColor || "#172033" : lum < 0.4 ? "#ffffff" : "#172033";
  return {
    color: own.color || autoColor,
    fontSize: own.fontSize || "20px",
    fontFamily: own.fontFamily || theme.bodyFont || '"Manrope", sans-serif',
    fontWeight: own.fontWeight || "600",
    fontStyle: own.fontStyle || "normal",
    textAlign: own.textAlign || "center",
    verticalAlign: own.verticalAlign || "middle",
  };
}

// Inset of the text box inside a shape: the outlines of triangles, callouts and arrows leave less usable room.
function _shapeTextInset(shapeType = "rectangle") {
  const insets = {
    triangle: [42, 18, 6, 18],
    "right-triangle": [40, 40, 6, 6],
    diamond: [22, 22, 22, 22],
    star: [30, 26, 22, 26],
    callout: [6, 8, 30, 8],
    pentagon: [18, 14, 8, 14],
    chevron: [8, 26, 8, 26],
    parallelogram: [8, 22, 8, 22],
    trapezoid: [8, 22, 8, 22],
  };
  return insets[shapeType] || [8, 10, 8, 10]; // top, right, bottom, left in percent / px mix below
}

function renderShapeText(el, elData = {}) {
  if (!el) return;
  let host = el.querySelector(":scope > .sf-shape-text");
  const text = String(elData.shapeText || "");
  if (!text && !el.classList.contains("editing-shape-text")) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.className = "sf-shape-text";
    el.appendChild(host);
  }
  const style = getShapeTextStyle(elData);
  const [top, right, bottom, left] = _shapeTextInset(elData.shapeType);
  host.style.cssText = [
    "position:absolute",
    `inset:${top}% ${right}% ${bottom}% ${left}%`,
    "display:flex",
    "flex-direction:column",
    `justify-content:${style.verticalAlign === "top" ? "flex-start" : style.verticalAlign === "bottom" ? "flex-end" : "center"}`,
    "overflow:hidden",
    "pointer-events:none",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "line-height:1.2",
    `color:${style.color}`,
    `font-size:${style.fontSize}`,
    `font-family:${style.fontFamily}`,
    `font-weight:${style.fontWeight}`,
    `font-style:${style.fontStyle}`,
    `text-align:${style.textAlign}`,
    "z-index:1",
  ].join(";");
  if (host.dataset.editing !== "true") {
    host.textContent = "";
    const line = document.createElement("div");
    line.className = "sf-shape-text__content";
    line.textContent = text;
    host.appendChild(line);
  }
}

// Double-click a shape to type in it; Escape or a click outside ends the edit (Escape keeps what was typed, as in
// PowerPoint). An empty edit leaves the shape without text.
function beginShapeTextEdit(el, elData) {
  if (!el || !elData || elData.locked) return;
  if (document.body.classList.contains("play-mode-active")) return;
  el.classList.add("editing-shape-text");
  renderShapeText(el, elData);
  const host = el.querySelector(":scope > .sf-shape-text");
  if (!host) return;
  const line = host.querySelector(".sf-shape-text__content") || host.appendChild(document.createElement("div"));
  line.className = "sf-shape-text__content";
  host.dataset.editing = "true";
  host.style.pointerEvents = "auto";
  line.contentEditable = "plaintext-only";
  if (line.contentEditable !== "plaintext-only") line.contentEditable = "true";
  line.spellcheck = true;
  line.style.outline = "none";
  line.style.cursor = "text";
  line.style.minHeight = "1.2em";
  if (typeof interact === "function") interact(el).draggable(false);
  line.focus();
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const finish = () => {
    if (host.dataset.editing !== "true") return;
    host.dataset.editing = "false";
    line.removeEventListener("blur", finish);
    line.removeEventListener("keydown", onKey);
    const next = (line.innerText || "").replace(/\n$/, "");
    el.classList.remove("editing-shape-text");
    if (typeof interact === "function") interact(el).draggable(true);
    const live = state.slides?.[currentSlideIndex]?.elements.find((item) => item.id === elData.id);
    if (live && next !== String(live.shapeText || "")) {
      saveStateToUndo();
      updateElementState(live.id, { shapeText: next });
      schedulePresentationAutosave?.(150);
    }
    renderSlidesFromState();
    selectElement?.(elData.id, "replace");
    refreshPreviews?.();
  };
  const onKey = (event) => {
    event.stopPropagation(); // typing must not trigger the editor's shortcuts (Delete, arrows, letters)
    if (event.key === "Escape") {
      event.preventDefault();
      line.blur();
    }
  };
  line.addEventListener("blur", finish);
  line.addEventListener("keydown", onKey);
}

window.getShapeTextStyle = getShapeTextStyle;
window.renderShapeText = renderShapeText;
window.beginShapeTextEdit = beginShapeTextEdit;
