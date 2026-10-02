// Rendering slides from state, footer numbers and canvas-backed element refresh.

function formatSlideFooterNumber(slideIndex) {
  return String(Math.max(0, Number(slideIndex) || 0) + 1).padStart(2, "0");
}

function syncSlideFooterNumber(slide, slideIndex) {
  if (!slide || !Array.isArray(slide.elements)) return false;
  const nextNumber = formatSlideFooterNumber(slideIndex);
  let changed = false;
  slide.elements.forEach((element) => {
    if (!element || element.footerRole !== "slide-number") return;
    if (element.content !== nextNumber) {
      element.content = nextNumber;
      changed = true;
    }
    if (element.type === "text") {
      element.autoHeight = false;
      element.textFitMode = "fixed";
      element.styles = {
        ...(element.styles || {}),
        textAlign: "center",
      };
    }
  });
  return changed;
}

function syncAllSlideFooterNumbers() {
  let changed = false;
  (state.slides || []).forEach((slide, index) => {
    if (syncSlideFooterNumber(slide, index)) changed = true;
  });
  return changed;
}

const REUSABLE_ELEMENT_TYPES = new Set(["molecule", "pdf", "video"]);

// What a heavy element looks like, for deciding whether its node can be kept. The saved camera of a molecule is
// left out: the viewer on the page already shows the current one.
function _reusableElementSignature(elData, mode) {
  // A molecule keeps its viewer through changes it can make in place (see syncMoleculeElementNode).
  const { moleculeViewState: _view, ...rest } =
    elData?.type === "molecule" && typeof moleculeReloadSignature === "function" ? moleculeReloadSignature(elData) : elData || {};
  // Empty fields are ignored: the same element has "animation: null" in one copy of the state and no such field
  // in another (after an undo, for instance).
  return `${mode}|${JSON.stringify(rest, (_key, value) => (value === null ? undefined : value))}`;
}

function _collectReusableSlideNodes(container, { mode }) {
  const canMove = typeof Element.prototype.moveBefore === "function";
  const oldSections = Array.from(container.children);
  const elements = new Map();
  const backgrounds = new Map();
  if (canMove) {
    oldSections.forEach((section) => {
      section.querySelectorAll(":scope > .canvas-element").forEach((node) => {
        if (node.__sfReuseSignature) elements.set(node.id, node);
      });
      const background = section.querySelector(":scope > .slide-background-three");
      if (background?.__sfReuseSignature) backgrounds.set(section.id, background);
    });
  }
  // Everything else in the old slides goes now, so no id exists twice while the new slides are built.
  oldSections.forEach((section) => {
    Array.from(section.children).forEach((child) => {
      if (elements.get(child.id) === child || backgrounds.get(section.id) === child) return;
      if (child.classList?.contains("slide-background-three")) cleanupSlideBackground3D(section);
      child.remove();
    });
    section.removeAttribute("id");
    section.style.display = "none";
  });
  // Opacity, blur, brightness and saturation are styles on the kept node (applied below), not reasons to rebuild.
  const backgroundSignature = (slide, slideIndex) => {
    const { opacity: _o, blur: _b, brightness: _br, saturate: _s, ...rest } = slide.background || {};
    return `${mode}|${slideIndex}|${JSON.stringify(rest)}`;
  };
  const move = (section, node) => {
    try {
      section.moveBefore(node, null);
      return true;
    } catch (_error) {
      return false;
    }
  };
  return {
    takeElement(section, elData) {
      const node = elements.get(elData.id);
      if (!node) return null;
      elements.delete(elData.id);
      if (node.__sfReuseSignature !== _reusableElementSignature(elData, mode) || !move(section, node)) {
        node.remove();
        return null;
      }
      const selected = state.selectedIds.includes(elData.id);
      node.classList.toggle("selected", selected && state.selectedIds.length === 1);
      node.classList.toggle("group-member-selected", selected && state.selectedIds.length > 1);
      const kept = Object.assign(node.__sfReuseData, elData);
      if (elData.type === "molecule" && typeof syncMoleculeElementNode === "function") {
        syncMoleculeElementNode(node, kept, (state.slides || []).find((slide) => slide.id === section.id));
      }
      return kept;
    },
    tagElement(node, elData) {
      if (!canMove || !REUSABLE_ELEMENT_TYPES.has(elData.type)) return;
      node.__sfReuseSignature = _reusableElementSignature(elData, mode);
      node.__sfReuseData = elData;
    },
    takeBackground(section, slide, slideIndex) {
      const node = backgrounds.get(slide.id);
      if (!node) return false;
      backgrounds.delete(slide.id);
      if (node.__sfReuseSignature === backgroundSignature(slide, slideIndex) && move(section, node)) {
        if (typeof applySlideBackgroundAdjustments === "function" && typeof normalizeSlideBackground === "function") {
          applySlideBackgroundAdjustments(node, normalizeSlideBackground(slide.background));
        }
        return true;
      }
      cleanupSlideBackground3D(node.parentElement);
      node.remove();
      return false;
    },
    tagBackground(node, slide, slideIndex) {
      if (canMove && node.classList?.contains("slide-background-three")) {
        node.__sfReuseSignature = backgroundSignature(slide, slideIndex);
      }
    },
    discardOld() {
      oldSections.forEach((section) => {
        cleanupSlideBackground3D(section);
        section.remove();
      });
    },
  };
}

function renderSlidesFromState(options = {}) {
  const preserveState = Boolean(options.preserveState);
  const container = document.getElementById("slides-container");
  const themeId = document.body.classList.contains("play-mode-active")
    ? document.body.dataset.presentationTheme || state.presentationTheme
    : state.presentationTheme;
  const theme = getPresentationTheme(themeId);
  const slideConfig = getPresentationPageSetupConfig();
  const slideWidth = Number(slideConfig.width) || 1024;
  const slideHeight = Number(slideConfig.height) || 768;
  syncAllSlideFooterNumbers();
  // Attached connector ends follow their elements, whatever moved them (fields, align, tidy, undo, nudges).
  if (typeof resolveConnectorBindings === "function") {
    state.slides.forEach((slide) => resolveConnectorBindings(slide));
  }
  if (
    !preserveState &&
    typeof ensureEditableMasterFooterElements === "function"
  ) {
    state.slides.forEach((slide, slideIndex) =>
      ensureEditableMasterFooterElements(slide, slideIndex, theme),
    );
    syncAllSlideFooterNumbers();
  }
  // Heavy parts of a slide (molecule viewers, PDFs, videos, 3D backgrounds) survive a redraw when their own data
  // has not changed: the existing node is moved into the new slide instead of being rebuilt. Rebuilding reloaded
  // the viewer and its file, reset the view and flashed, on every edit anywhere in the deck.
  const reuse = _collectReusableSlideNodes(container, {
    mode: `${themeId}|${slideWidth}x${slideHeight}|${document.body.classList.contains("play-mode-active")}`,
  });
  state.slides.forEach((slide, slideIndex) => {
    const section = document.createElement("section");
    section.id = slide.id;
    section.classList.add("presentation-slide");
    section.dataset.slideIndex = String(slideIndex);
    section.style.width = `${slideWidth}px`;
    section.style.height = `${slideHeight}px`;
    section.style.color = theme.defaultTextColor;
    section.style.fontFamily = theme.bodyFont;
    container.appendChild(section); // connected first: only connected nodes can take a moved one
    const keptBackground = reuse.takeBackground(section, slide, slideIndex);
    if (!keptBackground) {
      const bgNode = createSlideBackgroundNode(slide.background, {
        slideIndex,
        theme,
      });
      if (bgNode) {
        reuse.tagBackground(bgNode, slide, slideIndex);
        section.appendChild(bgNode);
      }
    }
    if (typeof buildMasterSlideElements === "function") {
      buildMasterSlideElements(slide, slideIndex, theme).forEach((elData) =>
        section.appendChild(_createStaticNode(elData, { master: true })),
      );
    }
    slide.elements.forEach((elData, elementIndex) => {
      const kept = reuse.takeElement(section, elData);
      if (kept) {
        // The kept node's handlers hold its own data object; the state uses that object from now on.
        slide.elements[elementIndex] = kept;
        return;
      }
      const node = createElementNode(elData, { slideIndex, preserveState });
      reuse.tagElement(node, elData);
      section.appendChild(node);
    });
    const whiteboardLayer = _createSlideWhiteboardLayer(
      slide,
      slideWidth,
      slideHeight,
    );
    if (whiteboardLayer) section.appendChild(whiteboardLayer);
  });
  reuse.discardOld();
  if (Reveal.isReady()) {
    Reveal.sync();
    const safeIndex = Math.max(
      0,
      Math.min(currentSlideIndex, state.slides.length - 1),
    );
    Reveal.slide(safeIndex, 0, 0);
    Reveal.layout();
  }
  if (
    document.body.classList.contains("play-mode-active") &&
    typeof _resizePresentationChalkboard === "function"
  ) {
    requestAnimationFrame(() => _resizePresentationChalkboard());
  }
  requestAnimationFrame(syncActiveSlideMedia);
  if (typeof updateGroupBound === "function") {
    updateGroupBound();
  }
  const nextPreviewSignature = getSlidePreviewStructureSignature();
  if (_slidePreviewStructureSignature === nextPreviewSignature) {
    renderSlidePreviews(currentSlideIndex);
  } else {
    renderSlidePreviews(null, { preserveScroll: true });
  }
  if (!preserveState && typeof schedulePresentationAutosave === "function") {
    schedulePresentationAutosave();
  }
  if (typeof renderLayersList === "function") {
    renderLayersList();
  }
  window.dispatchEvent(
    new CustomEvent("slideforge:render-complete", {
      detail: { currentSlideIndex },
    }),
  );
}

// Charts on the editor's slides fitted again to their boxes: while a show closes they are drawn while the slides
// are still hidden or scaled down, and a line chart could stay at that size (a blank-looking card after Escape).
function resizeEditorCharts() {
  if (typeof Chart === "undefined") return;
  document.querySelectorAll("#slides-container .canvas-element canvas").forEach((canvas) => {
    if (canvas.closest("#slide-previews")) return;
    const chart = Chart.getChart(canvas);
    const host = canvas.parentElement;
    if (!chart || !host) return;
    // The box's own content size (unzoomed): measured on screen, the chart came out at the editor's zoom.
    const style = getComputedStyle(host);
    const width = host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width > 0 && height > 0 && (Math.abs(chart.width - width) > 1 || Math.abs(chart.height - height) > 1)) chart.resize(width, height);
  });
}

function refreshCanvasBackedElements() {
  resizeEditorCharts();
  const slide = state.slides?.[currentSlideIndex];
  if (!slide) return;
  (slide.elements || []).forEach((elData) => {
    const dom = document.getElementById(elData.id);
    if (!dom) return;
    if (elData.type === "whiteboard") {
      const canvas = dom.querySelector("canvas.whiteboard-object-canvas");
      if (
        canvas &&
        typeof window.renderWhiteboardDrawingElement === "function"
      ) {
        window.renderWhiteboardDrawingElement(canvas, elData);
      }
    } else if (elData.type === "mermaid") {
      if (typeof window.renderMermaidElement === "function") {
        window.renderMermaidElement(dom, elData, { force: true });
      }
    } else if (elData.type === "sketch") {
      const canvas = dom.querySelector("canvas.sketch-canvas");
      if (!canvas || typeof renderSketchStrokes !== "function") return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderSketchStrokes(ctx, elData.strokes || [], rect.width, rect.height);
    }
  });
}

window.refreshCanvasBackedElements = refreshCanvasBackedElements;
