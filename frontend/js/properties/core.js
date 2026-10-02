// Properties panel: shared helpers (canvas scale, commits, DOM style writes, value normalizers).

function getCanvasScale() {
  return typeof Reveal !== "undefined" && typeof Reveal.getScale === "function"
    ? Reveal.getScale() || 1
    : 1;
}

function onCommit(cb) {
  saveStateToUndo();
  cb();
  if (window.renderSlidesFromState) window.renderSlidesFromState();
  if (window.refreshPreviews) window.refreshPreviews();
}

function _setElementDomStyleProperty(dom, prop, value, priority = "") {
  if (!dom) return;
  if (prop === "textStrokeWidth") {
    if (!value || value === "0px" || value === "0")
      dom.style.removeProperty("-webkit-text-stroke-width");
    else dom.style.setProperty("-webkit-text-stroke-width", value, priority);
    return;
  }
  if (prop === "textStrokeColor") {
    if (!value || value === "transparent")
      dom.style.removeProperty("-webkit-text-stroke-color");
    else dom.style.setProperty("-webkit-text-stroke-color", value, priority);
    return;
  }
  const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  if (value === undefined || value === null || value === "")
    dom.style.removeProperty(cssProp);
  else dom.style.setProperty(cssProp, value, priority);
}

function isControlBeingEdited(element) {
  return Boolean(
    element &&
    document.activeElement === element &&
    ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName),
  );
}

function getSlideDimensions() {
  const cfg =
    typeof Reveal !== "undefined" && Reveal.getConfig ? Reveal.getConfig() : {};
  return {
    width: Number(cfg.width) || 1024,
    height: Number(cfg.height) || 768,
  };
}

function _normalizePx(value, fallback = "32px") {
  const str = String(value || "").trim();
  if (!str) return fallback;
  if (/^-?\d+(\.\d+)?px$/i.test(str)) return str;
  if (/^-?\d+(\.\d+)?$/.test(str)) return `${str}px`;
  return fallback;
}

function _normalizeColorForInput(value, fallback = "#000000") {
  const str = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(str)) return str;
  if (/^#[0-9a-f]{3}$/i.test(str)) {
    const r = str[1];
    const g = str[2];
    const b = str[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // rgb()/rgba() (theme cards and tints): the swatch shows the colour itself; it showed the black fallback.
  const rgb = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    return `#${rgb.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, "0")).join("")}`;
  }
  return fallback;
}

// Sliders and color pickers fire "input" on every drag tick. Take one undo snapshot per gesture, apply each tick
// live, and refresh slide thumbnails once when the gesture ends ("change").
function bindUndoableContinuousInput(input, apply) {
  let gestureActive = false;
  const run = (event, isFinal) => {
    if (!gestureActive) {
      saveStateToUndo();
      gestureActive = true;
    }
    apply(event);
    if (isFinal) {
      gestureActive = false;
      if (window.refreshPreviews) window.refreshPreviews();
    }
  };
  input.oninput = (event) => run(event, false);
  input.onchange = (event) => run(event, true);
}

