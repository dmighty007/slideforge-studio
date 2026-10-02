// Per-slide whiteboard drawing layer.

// ─── Slide Rendering ────────────────────────────────────────────────────────

function _escapeWhiteboardAttr(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function _whiteboardStrokeAttrs(el = {}) {
  const width = Number(el.strokeWidth) || 2;
  const opacity = el.opacity ?? 1;
  const dash =
    el.strokeStyle === "dashed"
      ? ` stroke-dasharray="${width * 5} ${width * 4}"`
      : el.strokeStyle === "dotted"
        ? ` stroke-dasharray="${width} ${width * 3}"`
        : "";
  return `stroke="${_escapeWhiteboardAttr(el.strokeColor || "#1f2937")}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${_escapeWhiteboardAttr(opacity)}"${dash}`;
}

function _whiteboardFillAttrs(el = {}) {
  const fill =
    el.fillStyle === "solid" &&
    el.backgroundColor &&
    el.backgroundColor !== "transparent"
      ? el.backgroundColor
      : "none";
  const opacity = fill === "none" ? 1 : 0.58;
  return `fill="${_escapeWhiteboardAttr(fill)}"${fill === "none" ? "" : ` fill-opacity="${opacity}"`}`;
}

function _createSlideWhiteboardLayer(slide, slideWidth, slideHeight) {
  const elements = Array.isArray(slide?.whiteboardElements)
    ? slide.whiteboardElements
    : [];
  if (!elements.length) return null;
  if (
    (slide?.elements || []).some(
      (el) => el.type === "whiteboard" && el.annotationMirror,
    )
  )
    return null;
  const layer = document.createElement("div");
  layer.className = "whiteboard-slide-layer";
  const annotationRenderer = window.SlideForgeAnnotation?.SvgStaticRenderer;
  if (annotationRenderer?.renderSvg) {
    layer.innerHTML = annotationRenderer.renderSvg(
      elements,
      slideWidth,
      slideHeight,
    );
    return layer;
  }
  const nodes = elements
    .map((el) => {
      if (Number(el.schemaVersion) >= 2 && el.kind && el.geometry) {
        const style = el.style || {};
        const geometry = el.geometry || {};
        if (
          [
            "stroke",
            "highlightStroke",
            "freeformPath",
            "laserTrail",
            "gesture",
          ].includes(el.kind)
        ) {
          el = {
            id: el.id,
            type: "freehand",
            points: geometry.points || [],
            strokeColor: style.strokeColor,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            opacity: el.opacity ?? style.opacity,
          };
        } else if (["label", "sticky"].includes(el.kind)) {
          el = {
            id: el.id,
            type: "text",
            x: geometry.x,
            y: geometry.y,
            text: geometry.text,
            strokeColor: style.strokeColor,
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            opacity: el.opacity ?? style.opacity,
          };
        } else {
          el = {
            id: el.id,
            type: "draw_shape",
            shapeType:
              geometry.shapeType ||
              (el.kind === "arrow" ? "arrow" : "rectangle"),
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
            strokeColor: style.strokeColor,
            backgroundColor: style.backgroundColor,
            fillStyle: style.fillStyle,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            opacity: el.opacity ?? style.opacity,
          };
        }
      }
      if (el.type === "freehand") {
        const points = Array.isArray(el.points) ? el.points : [];
        if (!points.length) return "";
        const d = points
          .map(
            (p, i) =>
              `${i ? "L" : "M"} ${Number(p.x) || 0} ${Number(p.y) || 0}`,
          )
          .join(" ");
        return `<path d="${_escapeWhiteboardAttr(d)}" ${_whiteboardStrokeAttrs(el)} fill="none"/>`;
      }
      if (el.type === "text") {
        const fontSize = Number(el.fontSize) || 22;
        const lines = String(el.text || "").split("\n");
        return lines
          .map(
            (line, index) =>
              `<text x="${Number(el.x) || 0}" y="${(Number(el.y) || 0) + index * fontSize * 1.25}" fill="${_escapeWhiteboardAttr(el.strokeColor || "#1f2937")}" font-size="${fontSize}" font-family="Comic Sans MS, Segoe Print, cursive" opacity="${_escapeWhiteboardAttr(el.opacity ?? 1)}">${_escapeWhiteboardAttr(line)}</text>`,
          )
          .join("");
      }
      if (el.type !== "draw_shape") return "";
      const x = Number(el.x) || 0;
      const y = Number(el.y) || 0;
      const w = Number(el.width) || 0;
      const h = Number(el.height) || 0;
      const attrs = `${_whiteboardStrokeAttrs(el)} ${_whiteboardFillAttrs(el)}`;
      if (el.shapeType === "rectangle") {
        const radius = Math.min(Math.abs(w), Math.abs(h), 64) * 0.18;
        return `<rect x="${Math.min(x, x + w)}" y="${Math.min(y, y + h)}" width="${Math.abs(w)}" height="${Math.abs(h)}" rx="${radius}" ${attrs}/>`;
      }
      if (el.shapeType === "ellipse")
        return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.abs(w / 2)}" ry="${Math.abs(h / 2)}" ${attrs}/>`;
      if (el.shapeType === "diamond") {
        const points = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
        return `<polygon points="${points}" ${attrs}/>`;
      }
      if (el.shapeType === "triangle") {
        const points = `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
        return `<polygon points="${points}" ${attrs}/>`;
      }
      if (el.shapeType === "star") {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const outer = Math.min(Math.abs(w), Math.abs(h)) / 2;
        const inner = outer * 0.382;
        const points = Array.from({ length: 10 }, (_, index) => {
          const radius = index % 2 === 0 ? outer : inner;
          const angle = (Math.PI * 2 * index) / 10 - Math.PI / 2;
          return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
        }).join(" ");
        return `<polygon points="${points}" ${attrs}/>`;
      }
      if (el.shapeType === "line")
        return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${_whiteboardStrokeAttrs(el)}/>`;
      if (el.shapeType === "curve" || el.shapeType === "curve_arrow") {
        const x2 = x + w;
        const y2 = y + h;
        const length = Math.max(1, Math.hypot(w, h));
        const cx = (x + x2) / 2 - (h / length) * length * 0.25;
        const cy = (y + y2) / 2 + (w / length) * length * 0.25;
        const stroke = _whiteboardStrokeAttrs(el);
        const path = `<path d="M ${x} ${y} Q ${cx} ${cy} ${x2} ${y2}" ${stroke} fill="none"/>`;
        if (el.shapeType !== "curve_arrow") return path;
        const angle = Math.atan2(y2 - cy, x2 - cx);
        const len = Math.min(24, Math.max(10, Math.hypot(w, h) * 0.22));
        const leftX = x2 - Math.cos(angle - Math.PI / 6) * len;
        const leftY = y2 - Math.sin(angle - Math.PI / 6) * len;
        const rightX = x2 - Math.cos(angle + Math.PI / 6) * len;
        const rightY = y2 - Math.sin(angle + Math.PI / 6) * len;
        return `<g>${path}<line x1="${x2}" y1="${y2}" x2="${leftX}" y2="${leftY}" ${stroke}/><line x1="${x2}" y1="${y2}" x2="${rightX}" y2="${rightY}" ${stroke}/></g>`;
      }
      if (el.shapeType === "arrow") {
        const angle = Math.atan2(h, w);
        const len = Math.min(24, Math.max(10, Math.hypot(w, h) * 0.22));
        const leftX = x + w - Math.cos(angle - Math.PI / 6) * len;
        const leftY = y + h - Math.sin(angle - Math.PI / 6) * len;
        const rightX = x + w - Math.cos(angle + Math.PI / 6) * len;
        const rightY = y + h - Math.sin(angle + Math.PI / 6) * len;
        const stroke = _whiteboardStrokeAttrs(el);
        return `<g><line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${stroke}/><line x1="${x + w}" y1="${y + h}" x2="${leftX}" y2="${leftY}" ${stroke}/><line x1="${x + w}" y1="${y + h}" x2="${rightX}" y2="${rightY}" ${stroke}/></g>`;
      }
      return "";
    })
    .join("");
  layer.innerHTML = `<svg viewBox="0 0 ${slideWidth} ${slideHeight}" aria-hidden="true">${nodes}</svg>`;
  return layer;
}
