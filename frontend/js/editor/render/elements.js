// An object's place and turn on the slide. Every code path that moves an object writes its transform through
// this: the Rotation field stored a value that nothing drew, because each wrote "translate(...)" alone.
function canvasElementTransform(elData, x = elData?.x, y = elData?.y) {
  const turn = Number(elData?.rotation) || 0;
  return `translate(${Number(x) || 0}px, ${Number(y) || 0}px)${turn ? ` rotate(${turn}deg)` : ""}`;
}

// Creating element DOM nodes: shared styles, static nodes, master text, and per-type dispatch (_applyTypeContent).

const RENDER_REVEAL_FRAGMENT_CLASSES = [
  "fade-in",
  "fade-in-then-out",
  "fade-in-then-semi-out",
  "fade-up",
  "fade-down",
  "fade-left",
  "fade-right",
  "grow",
  "fade-out",
  "shrink",
  "semi-fade-out",
  "highlight-red",
  "highlight-green",
  "highlight-blue",
  "highlight-current-red",
  "highlight-current-green",
  "highlight-current-blue",
  "current-visible",
];

function _shouldAnimateBulletsIndividually(elData) {
  return Boolean(
    document.body.classList.contains("play-mode-active") &&
    elData?.type === "text" &&
    isStructuredBulletContent(elData.content) &&
    elData.fragmentAnimation &&
    elData.fragmentAnimation !== "none",
  );
}

function _applyBulletFragmentAnimation(contentHost, elData) {
  if (!contentHost || !_shouldAnimateBulletsIndividually(elData)) return;
  const rows = Array.from(contentHost.querySelectorAll(".ppt-bullet-row"));
  let fragmentIndex = Number.isFinite(Number(elData.fragmentIndex))
    ? Number(elData.fragmentIndex)
    : 0;
  rows.forEach((row) => {
    row.classList.add("fragment", elData.fragmentAnimation);
    row.setAttribute("data-fragment-index", fragmentIndex);
    fragmentIndex += 1;
  });
}

function _applyStylesToElement(el, styles) {
  if (!styles) return;
  const textProps = [
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "textDecoration",
    "textAlign",
    "lineHeight",
    "textShadow",
  ];
  const mediaTypesWithoutPadding = new Set(["image", "video"]);
  const paddingProps = new Set([
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ]);
  const suppressPadding = mediaTypesWithoutPadding.has(el?.dataset?.type);
  Object.entries(styles).forEach(([prop, value]) => {
    if (value === undefined || value === null) return;
    if (suppressPadding && paddingProps.has(prop)) return;
    if (prop === "textStrokeWidth") {
      if (String(value) === "0" || String(value) === "0px") {
        el.style.removeProperty("-webkit-text-stroke-width");
      } else {
        el.style.setProperty("-webkit-text-stroke-width", value, "important");
      }
      return;
    }
    if (prop === "textStrokeColor") {
      if (!value || value === "transparent") {
        el.style.removeProperty("-webkit-text-stroke-color");
      } else {
        el.style.setProperty("-webkit-text-stroke-color", value, "important");
      }
      return;
    }
    if (prop === "borderWidth") {
      const normalized =
        typeof value === "number" || /^\d*\.?\d+$/.test(String(value))
          ? `${value}px`
          : String(value);
      el.style.setProperty("border-width", normalized);
      return;
    }
    const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
    const priority = textProps.includes(prop) ? "important" : "";
    el.style.setProperty(cssProp, value, priority);
  });
  if (suppressPadding) {
    el.style.setProperty("padding", "0", "important");
    // No overflow clipping here: it cut the resize handles in half. The picture clips itself (components.css).
    ["padding-top", "padding-right", "padding-bottom", "padding-left"].forEach(
      (prop) => {
        el.style.removeProperty(prop);
      },
    );
  }
}

function _renderChartDom(container, elData) {
  container.innerHTML = "";
  // Double-click opens the chart's data in the Properties panel (not in slide thumbnails).
  container.ondblclick = (event) => {
    if (container.closest("#slide-previews") || typeof openChartEditor !== "function") return;
    event.stopPropagation();
    openChartEditor(elData.id);
  };
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);

  if (container._chartInstance) {
    container._chartInstance.destroy();
  }

  try {
    container._chartInstance = new Chart(canvas, buildChartJsConfig(elData));
  } catch (err) {
    console.error("Chart.js Error:", err);
    container.innerHTML = `<div class="flex items-center justify-center h-full text-xs text-red-400">Chart Error</div>`;
  }
}

function _normalizeRenderCropTransform(elData) {
  if (!elData?.cropTransform) return null;
  const crop =
    typeof normalizeImageCropTransform === "function"
      ? normalizeImageCropTransform(elData.cropTransform)
      : elData.cropTransform;
  if (!crop) return null;
  if (JSON.stringify(crop) !== JSON.stringify(elData.cropTransform)) {
    elData.cropTransform = crop;
    if (elData.id && typeof updateElementState === "function") {
      updateElementState(elData.id, { cropTransform: crop });
    }
  }
  return crop;
}

function _createImageContentNode(elData, { interactive = false } = {}) {
  const crop = _normalizeRenderCropTransform(elData);
  if (crop) {
    const wrapper = document.createElement("div");
    wrapper.className = "w-full h-full rounded-[inherit]";
    wrapper.style.overflow = "hidden";
    wrapper.style.position = "relative";

    const img = document.createElement("img");
    img.src = elData.content;
    img.className = "pointer-events-none";
    img.draggable = false;
    img.style.position = "absolute";
    img.style.inset = "0";
    img.style.left = `${crop.leftPercent}%`;
    img.style.top = `${crop.topPercent}%`;
    img.style.width = `${crop.widthPercent}%`;
    img.style.height = `${crop.heightPercent}%`;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "fill";
    img.style.display = "block";
    img.style.setProperty("margin", "0", "important");
    wrapper.appendChild(img);
    return wrapper;
  }

  const img = document.createElement("img");
  img.src = elData.content;
  img.className = interactive
    ? "w-full h-full object-cover rounded-[inherit] pointer-events-none"
    : "w-full h-full object-cover rounded-[inherit]";
  img.draggable = false;
  img.style.position = "absolute";
  img.style.inset = "0";
  img.style.display = "block";
  img.style.setProperty("margin", "0", "important");
  return img;
}

function _getEditableMasterUpdate(elData, value) {
  if (elData.masterRole === "footer") return { footerText: value };
  if (elData.masterRole === "logo") return { logoText: value };
  return null;
}

function _setMasterEditorSelection(host, atEnd = false) {
  if (!host) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(host);
  range.collapse(atEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function _bindEditableMasterText(el, contentHost, elData) {
  if (!el || !contentHost || !elData) return;
  const roleLabel = elData.masterRole === "logo" ? "logo" : "footer";
  el.classList.add("editable-master-element");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Edit slide ${roleLabel}`);
  el.tabIndex = 0;
  el.title = `Double-click to edit slide ${roleLabel}`;

  const beginEdit = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (document.body.classList.contains("play-mode-active")) return;
    contentHost.dataset.originalText = contentHost.textContent || "";
    contentHost.contentEditable = "true";
    contentHost.spellcheck = true;
    el.classList.add("editing-master-text");
    contentHost.focus();
    _setMasterEditorSelection(contentHost, false);
  };

  contentHost.addEventListener("blur", () => {
    if (contentHost.contentEditable !== "true") return;
    const previousText = contentHost.dataset.originalText || "";
    const nextText = (contentHost.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    contentHost.contentEditable = "false";
    contentHost.removeAttribute("spellcheck");
    el.classList.remove("editing-master-text");
    if (contentHost.dataset.cancelEdit === "true") {
      contentHost.dataset.cancelEdit = "false";
      contentHost.textContent = previousText;
      return;
    }
    if (nextText === previousText) return;
    const updates = _getEditableMasterUpdate(elData, nextText);
    const masterId =
      elData.masterId ||
      state.slides?.[currentSlideIndex]?.masterId ||
      "content";
    if (updates && typeof updateMasterSlide === "function") {
      updateMasterSlide(masterId, updates);
      buildPropertiesPanel?.();
    }
  });

  contentHost.addEventListener("keydown", (event) => {
    if (contentHost.contentEditable !== "true") return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      contentHost.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      contentHost.dataset.cancelEdit = "true";
      contentHost.blur();
    }
  });

  el.addEventListener("dblclick", beginEdit);
  el.addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      contentHost.contentEditable !== "true"
    ) {
      beginEdit(event);
    }
  });
}

function _createStaticNode(elData, options = {}) {
  const el = document.createElement("div");
  el.className = `canvas-element${options.master ? " master-slide-element" : ""}`;
  el.setAttribute("data-type", elData.type);
  const editableMaster = Boolean(
    options.master &&
    !options.forPreview &&
    elData.type === "text" &&
    ["footer", "logo"].includes(elData.masterRole),
  );
  if (options.master) {
    el.setAttribute("data-master-element", "true");
    if (elData.masterRole)
      el.setAttribute("data-master-role", elData.masterRole);
    if (elData.masterId) el.setAttribute("data-master-id", elData.masterId);
    if (editableMaster) {
      el.style.pointerEvents = "auto";
    } else {
      el.style.pointerEvents = "none";
      el.setAttribute("aria-hidden", "true");
    }
  }
  el.style.position = "absolute";
  el.style.transform = canvasElementTransform(elData);
  if (elData.width) el.style.width = elData.width;
  if (elData.height) el.style.height = elData.height;
  _applyStylesToElement(el, elData.styles);
  if (elData.type === "text") {
    el.dataset.autoHeight = elData.autoHeight === false ? "false" : "true";
    el.dataset.textFitMode =
      elData.textFitMode ||
      (elData.autoHeight === false ? "fixed" : "autoHeight");
    const contentHost = document.createElement("div");
    contentHost.className = "text-element-content";
    contentHost.innerHTML = DOMPurify.sanitize(renderTextContent(elData));
    el.appendChild(contentHost);
    if (editableMaster) {
      _bindEditableMasterText(el, contentHost, elData);
    }
    requestAnimationFrame(() => syncTextBoxLayout(el, elData));
  } else if (elData.type === "connector") {
    renderConnectorContent(el, elData, { interactive: false });
  } else if (elData.type === "image") {
    el.appendChild(_createImageContentNode(elData, { interactive: false }));
  } else if (elData.type === "table") {
    _renderTableDom(el, elData, { interactive: false });
  } else if (elData.type === "chart") {
    _renderChartDom(el, elData);
  } else if (elData.type === "html") {
    const chip = document.createElement("div");
    chip.innerText =
      normalizeHtmlMode(elData) === "autofit" ? "HTML AUTOFIT" : "HTML LIVE";
    chip.style.cssText =
      "position:absolute;top:4px;left:4px;padding:2px 6px;font-size:10px;border-radius:4px;background:#111827;color:#cbd5e1;z-index:2;";
    const frame = document.createElement("iframe");
    frame.srcdoc = buildHtmlEmbedSrcdoc(elData.content || "", elData);
    applyHtmlEmbedSandbox(frame);
    frame.className = "w-full h-full html-embed-frame";
    frame.style.border = "0";
    frame.style.pointerEvents = "none";
    el.appendChild(frame);
    el.appendChild(chip);
  } else if (elData.type === "shape") {
    renderShapeContent(el, elData);
  } else if (elData.type === "mermaid") {
    const host = document.createElement("div");
    host.className = "mermaid-object-surface";
    const svgHost = document.createElement("div");
    svgHost.className = "mermaid-svg-host";
    if (elData.svgContent)
      svgHost.innerHTML = DOMPurify.sanitize(elData.svgContent);
    else
      svgHost.innerHTML = `<div class="mermaid-render-status"><i class="fa-solid fa-diagram-project"></i><span>Diagram</span></div>`;
    host.appendChild(svgHost);
    el.appendChild(host);
    const renderMermaidObject = (attempt = 0) => {
      if (typeof window.renderMermaidElement === "function") {
        window.renderMermaidElement(el, elData);
      } else if (attempt < 8) {
        requestAnimationFrame(() => renderMermaidObject(attempt + 1));
      }
    };
    requestAnimationFrame(renderMermaidObject);
  } else if (elData.type === "whiteboard") {
    const selectWhiteboardElement = (event) => {
      if (document.body.classList.contains("play-mode-active")) return;
      if (document.body.classList.contains("whiteboard-mode-active")) return;
      if (typeof window.selectElement !== "function") return;
      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;
      window.selectElement(elData.id, isMultiSelect ? "add" : "replace");
      // Not stopping propagation here: the drag handler needs this press too, or the object cannot be moved.
    };
    el.addEventListener("pointerdown", selectWhiteboardElement);
    el.addEventListener("mousedown", selectWhiteboardElement);
    const canvas = document.createElement("canvas");
    canvas.className = "whiteboard-object-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    el.appendChild(canvas);
    const renderWhiteboardObject = (attempt = 0) => {
      if (typeof window.renderWhiteboardDrawingElement === "function") {
        window.renderWhiteboardDrawingElement(canvas, elData);
      } else if (attempt < 8) {
        requestAnimationFrame(() => renderWhiteboardObject(attempt + 1));
      }
    };
    requestAnimationFrame(renderWhiteboardObject);
  } else if (elData.type === "sketch") {
    const canvas = document.createElement("canvas");
    canvas.className = "sketch-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    el.appendChild(canvas);
    const renderSketchObject = (attempt = 0) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx && typeof renderSketchStrokes === "function") {
          ctx.scale(dpr, dpr);
          renderSketchStrokes(
            ctx,
            elData.strokes || [],
            rect.width,
            rect.height,
          );
        }
      } else if (attempt < 8) {
        requestAnimationFrame(() => renderSketchObject(attempt + 1));
      }
    };
    requestAnimationFrame(() => renderSketchObject(0));
  } else if (elData.type === "video") {
    const placeholder = document.createElement("div");
    placeholder.style.cssText =
      "width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f172a;color:#94a3b8;gap:6px;border-radius:inherit;";
    placeholder.innerHTML = `<i class="fa-solid fa-film" style="font-size:24px;"></i><span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Video</span>`;
    el.appendChild(placeholder);
  } else if (elData.type === "molecule") {
    // A picture of the molecule as drawn on its slide when there is one (see scheduleMoleculeThumbnail), on the
    // molecule's own background (none, if it is transparent).
    const background =
      typeof normalizeMoleculeBackgroundColor === "function"
        ? normalizeMoleculeBackgroundColor(elData.styles?.backgroundColor || "#020617")
        : "#020617";
    el.style.backgroundColor = background;
    const picture = typeof moleculeThumbnail === "function" ? moleculeThumbnail(elData.id) : null;
    const placeholder = document.createElement("div");
    placeholder.style.cssText = `width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${background};color:#94a3b8;gap:6px;border-radius:inherit;overflow:hidden;`;
    if (picture) {
      placeholder.innerHTML = `<img src="${picture}" alt="" style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      placeholder.innerHTML = `<i class="fa-solid fa-atom" style="font-size:24px;color:#38bdf8;"></i><span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(elData.moleculeName || "Molecule")}</span>`;
    }
    el.appendChild(placeholder);
  } else if (elData.type === "pdf") {
    const placeholder = document.createElement("div");
    placeholder.style.cssText =
      "width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f172a;color:#f87171;gap:6px;border-radius:inherit;";
    placeholder.innerHTML = `<i class="fa-regular fa-file-pdf" style="font-size:24px;"></i><span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;">PDF Document</span>`;
    // The first page as the thumbnail, when the server can render it (uploaded PDFs).
    const pageUrl = typeof pdfPageImageUrl === "function" ? pdfPageImageUrl(elData, 500) : null;
    if (pageUrl) {
      const page = new Image();
      page.onload = () => {
        placeholder.innerHTML = "";
        placeholder.style.background = `#ffffff url("${pageUrl}") center top / contain no-repeat`;
      };
      page.src = pageUrl;
    }
    el.appendChild(placeholder);
  } else if (elData.type === "equation" || elData.type === "latex") {
    const container = document.createElement("div");
    container.className = "equation-container";
    const color = elData.styles?.color || "#ffffff";
    const fontSize = elData.styles?.fontSize || "24px";
    container.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;color:${color};font-size:${fontSize};line-height:1;`;
    container.innerHTML = DOMPurify.sanitize(
      elData.content || elData.latexSrc || "",
    );
    el.appendChild(container);
  }
  return el;
}

// ─── Interactive Element Node ────────────────────────────────────────────────

function createElementNode(elData, options = {}) {
  const preserveState = Boolean(options.preserveState);
  const el = document.createElement("div");
  const animation = normalizeElementAnimation(elData);
  const timelineAnimationConfig =
    typeof normalizeElementAnimationConfig === "function"
      ? normalizeElementAnimationConfig(elData)
      : null;
  const hasTimelineAnimations = Boolean(
    timelineAnimationConfig?.timelines?.some(
      (timeline) => (timeline.animations || []).length > 0,
    ),
  );
  el.id = elData.id;
  el.className = "canvas-element";
  el.setAttribute("data-id", elData.id);
  el.setAttribute("data-type", elData.type);
  if (elData.footerRole) el.setAttribute("data-footer-role", elData.footerRole);
  el.style.transform = canvasElementTransform(elData);
  el.setAttribute("data-x", elData.x);
  el.setAttribute("data-y", elData.y);
  if (elData.width) el.style.width = elData.width;
  if (elData.height) el.style.height = elData.height;
  if (elData.type === "text") {
    el.dataset.autoHeight = elData.autoHeight === false ? "false" : "true";
    el.dataset.textFitMode =
      elData.textFitMode ||
      (elData.autoHeight === false ? "fixed" : "autoHeight");
  }
  _applyStylesToElement(el, elData.styles);

  const isPresetBackground =
    typeof isPresetBackgroundElement === "function"
      ? isPresetBackgroundElement(elData)
      : elData.presetBackground === true || elData.backgroundRole === "preset";
  if (isPresetBackground) {
    el.classList.add("preset-background-element");
    el.dataset.presetBackground = "true";
    el.setAttribute("aria-hidden", "true");
    el.style.pointerEvents = "none";
    el.style.userSelect = "none";
  }

  if (elData.hidden) {
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
  }

  // ── Fragment animations (Reveal.js) ──────────────────────────────────
  const isPlayMode = document.body.classList.contains("play-mode-active");

  let fragmentAnimation = elData.fragmentAnimation;
  let fragmentIndex = elData.fragmentIndex;
  if (fragmentAnimation && fragmentAnimation !== "none") {
    if (!RENDER_REVEAL_FRAGMENT_CLASSES.includes(fragmentAnimation)) {
      fragmentAnimation = "none";
      fragmentIndex = null;
    }
    if (!preserveState && fragmentAnimation !== elData.fragmentAnimation) {
      elData.fragmentAnimation = "none";
      elData.fragmentIndex = null;
    }
  }

  if (
    isPlayMode &&
    fragmentAnimation &&
    fragmentAnimation !== "none" &&
    !_shouldAnimateBulletsIndividually(elData)
  ) {
    el.classList.add("fragment", fragmentAnimation);
    if (fragmentIndex != null) {
      el.setAttribute("data-fragment-index", fragmentIndex);
    }
  }

  if (fragmentAnimation && fragmentAnimation !== "none") {
    const badge = document.createElement("div");
    badge.className = "anim-badge";
    badge.innerHTML = `<i class="fa-solid fa-wand-sparkles"></i> ${escapeHtml(String(fragmentIndex ?? 0))}`;
    el.appendChild(badge);
  } else if (animation || hasTimelineAnimations) {
    const badge = document.createElement("div");
    badge.className = "anim-badge";
    badge.innerHTML = `<i class="fa-solid fa-bolt"></i> ${animation?.trigger === "on-click" ? `#${escapeHtml(String(animation.order))}` : "Slide"}`;
    el.appendChild(badge);
  }

  _applyTypeContent(el, elData, options);
  _applyTimelineInitialStateForPlayMode(el, elData, timelineAnimationConfig);
  if (elData.type === "connector") {
    el.style.transform = canvasElementTransform(elData);
    el.setAttribute("data-x", elData.x);
    el.setAttribute("data-y", elData.y);
    if (elData.width) el.style.width = elData.width;
    if (elData.height) el.style.height = elData.height;
  } else if (!isPresetBackground) {
    _addResizeHandles(el);
  }

  // Selection on click
  el.addEventListener("mousedown", (e) => {
    if (document.body.classList.contains("play-mode-active")) return;
    if (isPresetBackground) return;
    if (el.classList.contains("editing-text")) {
      e.stopPropagation();
      if (e.target === el) {
        e.preventDefault();
      }
      return;
    }
    e.stopPropagation();
    const mode = e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace";
    selectElement(el.id, mode);
  });

  return el;
}

function _applyTimelineInitialStateForPlayMode(
  el,
  elData,
  timelineAnimationConfig = null,
) {
  if (!document.body.classList.contains("play-mode-active")) return;
  if (
    !el ||
    !timelineAnimationConfig ||
    !Array.isArray(timelineAnimationConfig.timelines)
  )
    return;
  if (typeof getAnimationEngine !== "function") return;
  const animations = timelineAnimationConfig.timelines
    .flatMap((timeline) => timeline.animations || [])
    .filter(
      (animation) =>
        animation &&
        (animation.trigger === "on-click" || animation.trigger === "on-slide"),
    )
    .sort((a, b) => {
      const aStart = Number(a.startTime ?? a.delay) || 0;
      const bStart = Number(b.startTime ?? b.delay) || 0;
      if (aStart !== bStart) return aStart - bStart;
      return (Number(a.duration) || 0) - (Number(b.duration) || 0);
    });
  const firstAnimation = animations[0];
  if (!firstAnimation) return;
  const engine = getAnimationEngine();
  if (typeof engine._applyAnimationInitial === "function") {
    engine._applyAnimationInitial(el, firstAnimation);
  }
}

function getIconClassFromElementData(elData) {
  const raw = String(elData?.iconClass || elData?.content || "");
  const classMatch =
    raw.match(/class\s*=\s*["']([^"']+)["']/i) ||
    raw.match(/class\s*=\s*&quot;([^&]+)&quot;/i);
  const classSource = classMatch ? classMatch[1] : raw;
  const safeClasses = classSource
    .split(/\s+/)
    .map((cls) => cls.trim())
    .filter((cls) => /^fa-/.test(cls) || /^fa[srltdbk]?$/.test(cls));
  return safeClasses.length ? safeClasses.join(" ") : "fa-solid fa-icons";
}

function renderIconContentHost(contentHost, elData) {
  const iconClass = getIconClassFromElementData(elData);
  elData.iconClass = iconClass;
  elData.content = `<i class="${iconClass}"></i>`;
  contentHost.innerHTML = "";
  const icon = document.createElement("i");
  icon.className = iconClass;
  icon.setAttribute("aria-hidden", "true");
  contentHost.appendChild(icon);
}

function _applyTypeContent(el, elData, options = {}) {
  if (elData.type === "text") {
    _applyTextTypeContent(el, elData, options);
  } else if (elData.type === "table") {
    _renderTableDom(el, elData, { interactive: true });
  } else if (elData.type === "chart") {
    _renderChartDom(el, elData);
  } else if (elData.type === "image") {
    _applyImageTypeContent(el, elData);
  } else if (elData.type === "video") {
    _applyVideoTypeContent(el, elData, options);
  } else if (elData.type === "html") {
    _applyHtmlTypeContent(el, elData);
  } else if (elData.type === "molecule") {
    _applyMoleculeTypeContent(el, elData, options);
  } else if (elData.type === "pdf") {
    _applyPdfTypeContent(el, elData);
  } else if (elData.type === "equation") {
    _applyEquationTypeContent(el, elData);
  } else if (elData.type === "shape") {
    renderShapeContent(el, elData);
  } else if (elData.type === "mermaid") {
    _applyMermaidTypeContent(el, elData);
  } else if (elData.type === "whiteboard") {
    _applyWhiteboardTypeContent(el, elData);
  } else if (elData.type === "sketch") {
    _applySketchTypeContent(el, elData);
  } else if (elData.type === "connector") {
    _applyConnectorTypeContent(el, elData);
  }
}

function _addResizeHandles(el) {
  ["tl", "tr", "bl", "br", "tc", "bc", "lc", "rc"].forEach((edge) => {
    el.appendChild(
      Object.assign(document.createElement("span"), {
        className: `resize-handle ${edge}`,
      }),
    );
  });
}
