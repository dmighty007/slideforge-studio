// Connector geometry, arrowheads, rendering and endpoint dragging.

function normalizeConnectorType(connectorType = "line") {
  return connectorType === "curve" || connectorType === "poly"
    ? connectorType
    : "line";
}

function normalizeConnectorHead(head = "none") {
  return [
    "none",
    "arrow",
    "triangle",
    "chevron",
    "line",
    "dot",
    "diamond",
    "square",
  ].includes(head)
    ? head
    : "none";
}

function getConnectorPoints(elData) {
  const fallback =
    normalizeConnectorType(elData?.connectorType) === "curve"
      ? [
          { x: 24, y: 96 },
          { x: 140, y: 24 },
          { x: 256, y: 96 },
        ]
      : normalizeConnectorType(elData?.connectorType) === "poly"
        ? [
            { x: 24, y: 110 },
            { x: 140, y: 110 },
            { x: 140, y: 36 },
            { x: 256, y: 36 },
          ]
        : [
            { x: 24, y: 96 },
            { x: 256, y: 36 },
          ];
  const points = Array.isArray(elData?.points) ? elData.points : fallback;
  const normalized = points
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return normalized.length >= 2 ? normalized : fallback;
}

function normalizeConnectorGeometry(elData, absolutePoints = null) {
  if (!elData || elData.type !== "connector") return;
  const strokeWidth = Math.max(1, Number(elData.styles?.strokeWidth) || 4);
  const padding = Math.max(28, strokeWidth * 4 + 12);
  const baseX = Number(elData.x) || 0;
  const baseY = Number(elData.y) || 0;
  const absPoints = (
    absolutePoints ||
    getConnectorPoints(elData).map((point) => ({
      x: baseX + point.x,
      y: baseY + point.y,
    }))
  ).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));

  const minX = Math.min(...absPoints.map((point) => point.x));
  const minY = Math.min(...absPoints.map((point) => point.y));
  const maxX = Math.max(...absPoints.map((point) => point.x));
  const maxY = Math.max(...absPoints.map((point) => point.y));

  elData.x = Math.round(minX - padding);
  elData.y = Math.round(minY - padding);
  elData.width = `${Math.max(60, Math.round(maxX - minX + padding * 2))}px`;
  elData.height = `${Math.max(60, Math.round(maxY - minY + padding * 2))}px`;
  elData.points = absPoints.map((point) => ({
    x: Math.round(point.x - elData.x),
    y: Math.round(point.y - elData.y),
  }));
  elData.connectorType = normalizeConnectorType(elData.connectorType);
  elData.connectorStart = normalizeConnectorHead(elData.connectorStart);
  elData.connectorEnd = normalizeConnectorHead(elData.connectorEnd || "arrow");
}

function buildConnectorPath(elData, startAdj = 0, endAdj = 0) {
  const rawPts = getConnectorPoints(elData);
  const pts = rawPts.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  if (startAdj > 0 && n >= 2) {
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const len = Math.hypot(dx, dy);
    if (len > startAdj) {
      pts[0].x += (dx / len) * startAdj;
      pts[0].y += (dy / len) * startAdj;
    }
  }
  if (endAdj > 0 && n >= 2) {
    const dx = pts[n - 1].x - pts[n - 2].x;
    const dy = pts[n - 1].y - pts[n - 2].y;
    const len = Math.hypot(dx, dy);
    if (len > endAdj) {
      pts[n - 1].x -= (dx / len) * endAdj;
      pts[n - 1].y -= (dy / len) * endAdj;
    }
  }
  if (normalizeConnectorType(elData.connectorType) === "poly") {
    return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
  }
  if (
    normalizeConnectorType(elData.connectorType) === "curve" &&
    pts.length > 2
  ) {
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const next = pts[i + 1];
      const midX = (pts[i].x + next.x) / 2;
      const midY = (pts[i].y + next.y) / 2;
      path += ` Q ${pts[i].x} ${pts[i].y} ${midX} ${midY}`;
    }
    const last = pts[pts.length - 1];
    path += ` T ${last.x} ${last.y}`;
    return path;
  }
  return `M ${pts[0].x} ${pts[0].y} L ${pts[n - 1].x} ${pts[n - 1].y}`;
}

function _arrowheadLineAdjust(head, hw, hl) {
  if (head === "none" || head === "line") return 0;
  if (head === "dot" || head === "square") return hw;
  return hl;
}

function _buildArrowheadEl(
  tipX,
  tipY,
  nx,
  ny,
  hw,
  hl,
  head,
  color,
  strokeWidth,
) {
  if (head === "none") return null;
  const px = -ny;
  const py = nx;
  const bx = tipX - nx * hl;
  const by = tipY - ny * hl;
  const ns = "http://www.w3.org/2000/svg";

  if (head === "arrow" || head === "triangle") {
    const el = document.createElementNS(ns, "path");
    el.setAttribute(
      "d",
      `M ${bx + px * hw} ${by + py * hw} L ${tipX} ${tipY} L ${bx - px * hw} ${by - py * hw} Z`,
    );
    el.setAttribute("fill", color);
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-linejoin", "round");
    return el;
  }
  if (head === "chevron") {
    const el = document.createElementNS(ns, "path");
    el.setAttribute(
      "d",
      `M ${bx + px * hw} ${by + py * hw} L ${tipX} ${tipY} L ${bx - px * hw} ${by - py * hw}`,
    );
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", String(strokeWidth));
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    return el;
  }
  if (head === "line") {
    const el = document.createElementNS(ns, "path");
    el.setAttribute(
      "d",
      `M ${tipX + px * hw} ${tipY + py * hw} L ${tipX - px * hw} ${tipY - py * hw}`,
    );
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", String(strokeWidth));
    el.setAttribute("stroke-linecap", "round");
    return el;
  }
  if (head === "dot") {
    const el = document.createElementNS(ns, "circle");
    el.setAttribute("cx", String(tipX - nx * hw));
    el.setAttribute("cy", String(tipY - ny * hw));
    el.setAttribute("r", String(hw));
    el.setAttribute("fill", color);
    return el;
  }
  if (head === "diamond") {
    const mx = bx + (hl / 2) * nx;
    const my = by + (hl / 2) * ny;
    const el = document.createElementNS(ns, "path");
    el.setAttribute(
      "d",
      `M ${tipX} ${tipY} L ${mx + px * hw} ${my + py * hw} L ${bx} ${by} L ${mx - px * hw} ${my - py * hw} Z`,
    );
    el.setAttribute("fill", color);
    el.setAttribute("stroke-linejoin", "round");
    return el;
  }
  if (head === "square") {
    const cx = tipX - nx * hw;
    const cy = tipY - ny * hw;
    const el = document.createElementNS(ns, "path");
    el.setAttribute(
      "d",
      `M ${cx + px * hw + nx * hw} ${cy + py * hw + ny * hw} L ${cx + px * hw - nx * hw} ${cy + py * hw - ny * hw} L ${cx - px * hw - nx * hw} ${cy - py * hw - ny * hw} L ${cx - px * hw + nx * hw} ${cy - py * hw + ny * hw} Z`,
    );
    el.setAttribute("fill", color);
    el.setAttribute("stroke-linejoin", "round");
    return el;
  }
  return null;
}

function renderConnectorContent(el, elData, { interactive = false } = {}) {
  normalizeConnectorGeometry(elData);
  el.innerHTML = "";
  const points = getConnectorPoints(elData);
  const width = parseFloat(elData.width) || 280;
  const height = parseFloat(elData.height) || 140;
  const stroke = elData.styles?.color || "#2563eb";
  const strokeWidth = Math.max(1, Number(elData.styles?.strokeWidth) || 4);
  const startHead = normalizeConnectorHead(elData.connectorStart);
  const endHead = normalizeConnectorHead(elData.connectorEnd || "arrow");
  const hw = Math.max(2, (Number(elData.connectorHeadWidth) || 14) / 2);
  const hl = Math.max(2, Number(elData.connectorHeadLength) || 14);

  const n = points.length;
  function unitDir(ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay);
    return len < 0.001
      ? { x: 1, y: 0 }
      : { x: (bx - ax) / len, y: (by - ay) / len };
  }
  const endDir = unitDir(
    points[n - 2].x,
    points[n - 2].y,
    points[n - 1].x,
    points[n - 1].y,
  );
  const startDir = unitDir(points[1].x, points[1].y, points[0].x, points[0].y);

  const startAdj = _arrowheadLineAdjust(startHead, hw, hl);
  const endAdj = _arrowheadLineAdjust(endHead, hw, hl);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.classList.add("connector-svg");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", buildConnectorPath(elData, startAdj, endAdj));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", String(strokeWidth));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  const startEl = _buildArrowheadEl(
    points[0].x,
    points[0].y,
    startDir.x,
    startDir.y,
    hw,
    hl,
    startHead,
    stroke,
    strokeWidth,
  );
  const endEl = _buildArrowheadEl(
    points[n - 1].x,
    points[n - 1].y,
    endDir.x,
    endDir.y,
    hw,
    hl,
    endHead,
    stroke,
    strokeWidth,
  );
  if (startEl) svg.appendChild(startEl);
  if (endEl) svg.appendChild(endEl);

  el.appendChild(svg);

  if (interactive && !document.body.classList.contains("play-mode-active")) {
    points.forEach((point, index) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "connector-point-handle";
      handle.style.left = `${point.x}px`;
      handle.style.top = `${point.y}px`;
      handle.setAttribute("data-index", String(index));
      const attachedKey = index === 0 ? "start" : index === points.length - 1 ? "end" : null;
      if (attachedKey && elData.connectorBindings?.[attachedKey]) {
        handle.classList.add("is-attached");
        handle.title = "Attached: moves with its element. Drag away to detach.";
      }
      handle.addEventListener("mousedown", startConnectorPointDrag);
      el.appendChild(handle);
    });
  }
}

function syncConnectorDom(connectorId) {
  const elData = state.slides[currentSlideIndex]?.elements?.find(
    (item) => item.id === connectorId && item.type === "connector",
  );
  const dom = document.getElementById(connectorId);
  if (!elData || !dom) return;
  normalizeConnectorGeometry(elData);
  dom.style.transform = `translate(${elData.x}px, ${elData.y}px)`;
  dom.setAttribute("data-x", elData.x);
  dom.setAttribute("data-y", elData.y);
  dom.style.width = elData.width;
  dom.style.height = elData.height;
  renderConnectorContent(dom, elData, {
    interactive: state.selectedIds.includes(connectorId),
  });
}

// Attached ends. A connector end dropped on an element is attached to it: connectorBindings.start / .end hold
// { id, fx, fy }, the spot as a fraction of the element's box, and the end follows the element when it moves or
// resizes (before, moving the target left the arrow behind). Points stay stored as plain coordinates, so every
// export draws the connector as before.
function _connectorTargetBox(el) {
  const width = parseFloat(el?.width) || 0;
  const height = parseFloat(el?.height) || 0;
  if (!el || width <= 0 || height <= 0) return null;
  return { x: Number(el.x) || 0, y: Number(el.y) || 0, width, height };
}

// The attached spot is kept on the element's box; the end is drawn where the line from the shape's centre to that
// spot meets the shape's outline, so an arrow to a star or circle touches it instead of stopping in the air at the
// corner of its box.
function _connectorOutlinePoint(el, box, x, y) {
  if (!el || el.type !== "shape" || !box) return { x, y };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { x, y };
  if (el.shapeType === "circle" || el.shapeType === "ellipse") {
    const t = 1 / Math.sqrt((dx / (box.width / 2)) ** 2 + (dy / (box.height / 2)) ** 2);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  const clip = typeof getShapeStyle === "function" ? getShapeStyle(el).clipPath : "";
  const outline = typeof _parseShapePolygonPoints === "function" ? _parseShapePolygonPoints(clip) : [];
  if (outline.length < 3) return { x, y };
  const pts = outline.map(([px, py]) => [box.x + (px / 100) * box.width, box.y + (py / 100) * box.height]);
  let nearest = null;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) return;
    const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / denom;
    const u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / denom;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && (nearest === null || t < nearest)) nearest = t;
  });
  return nearest === null ? { x, y } : { x: cx + dx * nearest, y: cy + dy * nearest };
}

// Where an end dragged to `point` attaches: a side's middle when near one, else the nearest spot on an edge
// (within a few pixels, or anywhere over a shape). Null when it is free.
function getConnectorSnapTarget(point, connectorId) {
  const slide = state.slides[currentSlideIndex];
  if (!slide) return null;
  const edgeThreshold = 18;
  const anchorThreshold = 24;
  let best = null;
  const consider = (el, box, x, y, distance, rank) => {
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = {
        x,
        y,
        distance,
        rank,
        id: el.id,
        fx: Math.round(((x - box.x) / box.width) * 1000) / 1000,
        fy: Math.round(((y - box.y) / box.height) * 1000) / 1000,
      };
    }
  };

  [...(slide.elements || [])]
    .sort((a, b) => (Number(b.styles?.zIndex) || 0) - (Number(a.styles?.zIndex) || 0))
    .forEach((el) => {
      if (!el || el.id === connectorId || el.type === "connector" || el.hidden) return;
      const box = _connectorTargetBox(el);
      if (!box) return;
      const left = box.x;
      const top = box.y;
      const right = box.x + box.width;
      const bottom = box.y + box.height;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const anchors = [
        { x: (left + right) / 2, y: top },
        { x: right, y: (top + bottom) / 2 },
        { x: (left + right) / 2, y: bottom },
        { x: left, y: (top + bottom) / 2 },
      ];
      anchors.forEach((anchor) => {
        const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
        if (distance <= anchorThreshold) consider(el, box, anchor.x, anchor.y, distance, 0);
      });
      const inside = point.x > left && point.x < right && point.y > top && point.y < bottom;
      const edges = [
        { x: clamp(point.x, left, right), y: top },
        { x: clamp(point.x, left, right), y: bottom },
        { x: left, y: clamp(point.y, top, bottom) },
        { x: right, y: clamp(point.y, top, bottom) },
      ];
      edges.forEach((edge) => {
        const distance = Math.hypot(edge.x - point.x, edge.y - point.y);
        if (distance <= edgeThreshold) consider(el, box, edge.x, edge.y, distance, 1);
        // Over a shape, the end goes to its nearest edge (text boxes and big pictures are only edge targets,
        // or an end over a content placeholder would always stick to it).
        else if (inside && el.type === "shape") consider(el, box, edge.x, edge.y, distance, 2);
      });
    });
  if (best) {
    const el = slide.elements.find((item) => item?.id === best.id);
    Object.assign(best, _connectorOutlinePoint(el, _connectorTargetBox(el), best.x, best.y));
  }
  return best;
}

function getConnectorSnapPoint(point, connectorId) {
  const target = getConnectorSnapTarget(point, connectorId);
  return target ? { x: target.x, y: target.y } : point;
}

// Re-place the attached ends of the slide's connectors from their elements' boxes. In-between points of a
// curve or elbow are carried along, stretched per axis between the ends. Returns the ids of connectors that moved.
function resolveConnectorBindings(slide, { skipIds = null } = {}) {
  const elements = slide?.elements || [];
  const byId = new Map(elements.map((el) => [el?.id, el]));
  const changed = [];
  elements.forEach((connector) => {
    if (connector?.type !== "connector" || !connector.connectorBindings) return;
    if (skipIds?.has?.(connector.id)) return;
    const bindings = connector.connectorBindings;
    const abs = getConnectorPoints(connector).map((point) => ({
      x: (Number(connector.x) || 0) + point.x,
      y: (Number(connector.y) || 0) + point.y,
    }));
    const last = abs.length - 1;
    const next = abs.map((point) => ({ ...point }));
    ["start", "end"].forEach((key) => {
      const binding = bindings[key];
      if (!binding) return;
      const box = _connectorTargetBox(byId.get(binding.id));
      if (!box || byId.get(binding.id)?.type === "connector") {
        delete bindings[key]; // the element is gone: the end stays where it is, free
        return;
      }
      const index = key === "start" ? 0 : last;
      next[index] = _connectorOutlinePoint(
        byId.get(binding.id),
        box,
        box.x + (Number(binding.fx) || 0) * box.width,
        box.y + (Number(binding.fy) || 0) * box.height,
      );
    });
    if (!bindings.start && !bindings.end) delete connector.connectorBindings;
    const moved = Math.max(
      Math.abs(next[0].x - abs[0].x),
      Math.abs(next[0].y - abs[0].y),
      Math.abs(next[last].x - abs[last].x),
      Math.abs(next[last].y - abs[last].y),
    );
    if (moved < 0.5) return;
    const axis = (key, value) => {
      const from0 = abs[0][key];
      const from1 = abs[last][key];
      const to0 = next[0][key];
      const to1 = next[last][key];
      if (Math.abs(from1 - from0) < 0.5) return value + ((to0 - from0) + (to1 - from1)) / 2;
      return to0 + ((value - from0) * (to1 - to0)) / (from1 - from0);
    };
    for (let index = 1; index < last; index += 1) {
      next[index] = { x: axis("x", abs[index].x), y: axis("y", abs[index].y) };
    }
    normalizeConnectorGeometry(connector, next);
    changed.push(connector.id);
  });
  return changed;
}

// While elements are dragged or resized: bring their connectors along on screen.
function followAttachedConnectors(movingIds = state.selectedIds) {
  const slide = state.slides[currentSlideIndex];
  if (!slide) return;
  const changed = resolveConnectorBindings(slide, { skipIds: new Set(movingIds || []) });
  changed.forEach((id) => syncConnectorDom(id));
}

// After a connector itself was dragged away: ends attached to elements that did not move with it come loose.
function detachMovedConnectors(movedIds = state.selectedIds) {
  const slide = state.slides[currentSlideIndex];
  const moved = new Set(movedIds || []);
  (slide?.elements || []).forEach((el) => {
    if (el?.type !== "connector" || !moved.has(el.id) || !el.connectorBindings) return;
    ["start", "end"].forEach((key) => {
      if (el.connectorBindings[key] && !moved.has(el.connectorBindings[key].id)) delete el.connectorBindings[key];
    });
    if (!el.connectorBindings.start && !el.connectorBindings.end) delete el.connectorBindings;
  });
}

// Copies of elements get new ids: a copied connector stays attached to the copies of its elements, and comes
// loose from elements that were not copied with it.
function remapConnectorBindings(copies, idMap) {
  (copies || []).forEach((copy) => {
    if (copy?.type !== "connector" || !copy.connectorBindings) return;
    ["start", "end"].forEach((key) => {
      const binding = copy.connectorBindings[key];
      if (!binding) return;
      if (idMap[binding.id]) binding.id = idMap[binding.id];
      else delete copy.connectorBindings[key];
    });
    if (!copy.connectorBindings.start && !copy.connectorBindings.end) delete copy.connectorBindings;
  });
}

// While an end is dragged, the element it would attach to is outlined.
function _markConnectorAttachTarget(id) {
  document
    .querySelectorAll(".connector-attach-target")
    .forEach((node) => node.id !== id && node.classList.remove("connector-attach-target"));
  if (!id) return;
  const node = [...document.querySelectorAll(`[id="${id}"]`)].find(
    (candidate) => !candidate.closest("#slide-previews"),
  );
  node?.classList.add("connector-attach-target");
}

function startConnectorPointDrag(event) {
  if (document.body.classList.contains("play-mode-active")) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const connectorEl = handle?.closest?.(
    ".canvas-element[data-type='connector']",
  );
  if (!connectorEl) return;
  const connectorId = connectorEl.id;
  const pointIndex = Number(handle.getAttribute("data-index"));
  const connectorData = state.slides[currentSlideIndex].elements.find(
    (item) => item.id === connectorId,
  );
  if (!connectorData) return;
  const slide = connectorEl.closest(".presentation-slide");
  if (!slide) return;
  const scale = getCanvasScale();
  const slideRect = slide.getBoundingClientRect();
  const absolutePoints = getConnectorPoints(connectorData).map((point) => ({
    x: (Number(connectorData.x) || 0) + point.x,
    y: (Number(connectorData.y) || 0) + point.y,
  }));

  saveStateToUndo();
  selectElement(connectorId, "replace");

  const onMove = (moveEvent) => {
    const slideX = (moveEvent.clientX - slideRect.left) / scale;
    const slideY = (moveEvent.clientY - slideRect.top) / scale;
    const isEnd = pointIndex === 0 || pointIndex === absolutePoints.length - 1;
    const target = isEnd ? getConnectorSnapTarget({ x: slideX, y: slideY }, connectorId) : null;
    absolutePoints[pointIndex] = target ? { x: target.x, y: target.y } : { x: slideX, y: slideY };
    normalizeConnectorGeometry(connectorData, absolutePoints);
    let bindings = connectorData.connectorBindings ? { ...connectorData.connectorBindings } : {};
    if (isEnd) {
      const key = pointIndex === 0 ? "start" : "end";
      if (target) bindings[key] = { id: target.id, fx: target.fx, fy: target.fy };
      else delete bindings[key];
    }
    if (!bindings.start && !bindings.end) bindings = undefined;
    _markConnectorAttachTarget(target?.id || null);
    updateElementState(connectorId, {
      x: connectorData.x,
      y: connectorData.y,
      width: connectorData.width,
      height: connectorData.height,
      points: connectorData.points,
      connectorBindings: bindings,
    });
    if (!bindings) delete connectorData.connectorBindings;
    syncConnectorDom(connectorId);
    updateGroupBound();
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    _markConnectorAttachTarget(null);
    buildPropertiesPanel();
    renderSlidePreviews(currentSlideIndex);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

window.resolveConnectorBindings = resolveConnectorBindings;
window.followAttachedConnectors = followAttachedConnectors;
window.detachMovedConnectors = detachMovedConnectors;
window.remapConnectorBindings = remapConnectorBindings;
window.getConnectorSnapTarget = getConnectorSnapTarget;
