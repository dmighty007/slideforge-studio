// ─── Snap-to-Grid ─────────────────────────────────────────────────────────────
const SNAP_GRID = 10; // pixels in logical slide coordinates

function _snapVal(val, shiftHeld) {
  if (shiftHeld) return val;
  return Math.round(val / SNAP_GRID) * SNAP_GRID;
}

function _snapXY(x, y, shiftHeld) {
  return [_snapVal(x, shiftHeld), _snapVal(y, shiftHeld)];
}

function isElementInTextEditMode(target) {
  const element = target?.closest?.(".canvas-element[data-type='text']");
  if (!element) return false;
  const editor = element.querySelector(".text-element-content");
  return Boolean(editor && editor.contentEditable === "true");
}

function getInteractCanvasTarget(eventTarget) {
  if (!eventTarget) return null;
  const target = eventTarget.classList?.contains("canvas-element")
    ? eventTarget
    : eventTarget.closest?.(".canvas-element") || null;
  if (!target) return null;
  if (target.dataset?.presetBackground === "true") return null;
  return target;
}

// ─── Interact.js Setup ───────────────────────────────────────────────────────

// Set while a drag moved something, so the drop can free a moved connector's ends (a click is not a move).
let _elementsDragged = false;

function initInteract() {
  _setupElementInteract();
  _setupGroupBoundInteract();
  _setupMarquee();
}

// ─── Per-element drag + resize ───────────────────────────────────────────────

function _setupElementInteract() {
  interact(".canvas-element")
    .draggable({
      ignoreFrom:
        ".resize-handle, .crop-handle, .connector-point-handle, .pdf-annotation-layer, .pdf-annotation-layer *, .canvas-element.cropping img, .editing-text, .editing-text *, .editing-table, .editing-table *, .table-element-cell, .table-element-cell *, .sketch-mode-active, .sketch-mode-active *",
      listeners: {
        start(event) {
          if (document.body.classList.contains("play-mode-active")) return;
          const canvasTarget = getInteractCanvasTarget(event.target);
          if (!canvasTarget) return false;
          if (
            event.target.isContentEditable ||
            isElementInTextEditMode(event.target)
          )
            return false;

          const elementData = state.slides[currentSlideIndex].elements.find(
            (item) => item.id === canvasTarget.id,
          );
          if (elementData?.locked) return false;
          document.body.classList.add("sf-moving-element"); // floating toolbars step aside until the drop

          const sourceEvent = event.sourceEvent || event;
          const isMultiSelect =
            sourceEvent.shiftKey || sourceEvent.metaKey || sourceEvent.ctrlKey;

          const isAlreadySelected = state.selectedIds.includes(canvasTarget.id);
          if (!isAlreadySelected) {
            selectElement(canvasTarget.id, isMultiSelect ? "add" : "replace");
            // If we weren't already selected, we don't start the drag immediately.
            // This allows the marquee logic to take over if the user continues to drag.
            // They can drag the element once it is selected.
            if (!isMultiSelect) {
              event.interaction.stop();
              return;
            }
          }

          saveStateToUndo();
          state.selectedIds.forEach((id) =>
            document
              .getElementById(id)
              ?.classList.add("shadow-2xl", "scale-[1.01]", "z-50"),
          );
        },
        move(event) {
          const canvasTarget = getInteractCanvasTarget(event.target);
          if (!canvasTarget) return;
          const scale = getCanvasScale();
          const shiftHeld = event.shiftKey;
          const dx = event.dx / scale;
          const dy = event.dy / scale;

          state.selectedIds.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;

            const elData = state.slides[currentSlideIndex].elements.find(
              (item) => item.id === id,
            );
            if (elData?.locked) return;

            const rawX = (parseFloat(el.getAttribute("data-x")) || 0) + dx;
            const rawY = (parseFloat(el.getAttribute("data-y")) || 0) + dy;

            let snapX = rawX;
            let snapY = rawY;

            _clearGuides();

            if (!shiftHeld) {
              const slideConfig = getPresentationPageSetupConfig();
              const slideW = Number(slideConfig.width) || 1024;
              const slideH = Number(slideConfig.height) || 768;

              const elW = parseFloat(el.style.width) || 0;
              const elH = parseFloat(el.style.height) || 0;

              // 1. Grid Snap (Fallback)
              snapX = _snapVal(rawX, false);
              snapY = _snapVal(rawY, false);

              // 2. Smart Snap (Alignment with other elements and slide)
              const snapThreshold = 10;
              const slide = state.slides[currentSlideIndex];

              // X-axis targets
              const xTargets = [0, slideW / 2 - elW / 2, slideW - elW];
              slide.elements.forEach((other) => {
                if (state.selectedIds.includes(other.id)) return;
                const otherX = parseFloat(other.x) || 0;
                const otherW = parseFloat(other.width) || 0;
                xTargets.push(
                  otherX,
                  otherX + otherW,
                  otherX + otherW / 2 - elW / 2,
                );
              });

              for (const target of xTargets) {
                if (Math.abs(rawX - target) < snapThreshold) {
                  snapX = target;
                  _drawGuide(snapX, null, true);
                  break;
                }
              }

              // Y-axis targets
              const yTargets = [0, slideH / 2 - elH / 2, slideH - elH];
              slide.elements.forEach((other) => {
                if (state.selectedIds.includes(other.id)) return;
                const otherY = parseFloat(other.y) || 0;
                const otherH = parseFloat(other.height) || 0;
                yTargets.push(
                  otherY,
                  otherY + otherH,
                  otherY + otherH / 2 - elH / 2,
                );
              });

              for (const target of yTargets) {
                if (Math.abs(rawY - target) < snapThreshold) {
                  snapY = target;
                  _drawGuide(null, snapY, false);
                  break;
                }
              }
            }

            el.style.transform = canvasElementTransform(elData, snapX, snapY);
            el.setAttribute("data-x", rawX);
            el.setAttribute("data-y", rawY);
            updateElementState(id, { x: snapX, y: snapY });
          });

          const movingCroppedImage = state.selectedIds.some((id) => {
            const data = state.slides[currentSlideIndex].elements.find(
              (item) => item.id === id,
            );
            return data?.type === "image" && data.cropTransform;
          });

          // Real-time thumbnail update (throttled via requestAnimationFrame)
          if (!movingCroppedImage && !window._thumbnailRaf) {
            window._thumbnailRaf = requestAnimationFrame(() => {
              window._thumbnailRaf = null;
              if (typeof renderSlidePreviews === "function") {
                renderSlidePreviews(currentSlideIndex);
              }
            });
          }

          // Connectors attached to what moves come along; a dragged connector comes loose at the drop.
          _elementsDragged = true;
          window.followAttachedConnectors?.();
          updateGroupBound();
        },
        end(event) {
          document.body.classList.remove("sf-moving-element");
          _clearGuides();
          if (_elementsDragged) window.detachMovedConnectors?.();
          _elementsDragged = false;
          state.selectedIds.forEach((id) => {
            const dom = document.getElementById(id);
            if (dom) {
              const transform = dom.style.transform;
              const match = transform.match(/translate\((.*?)px,\s*(.*?)px\)/);
              if (match) {
                dom.setAttribute("data-x", match[1]);
                dom.setAttribute("data-y", match[2]);
              }
              dom.classList.remove("shadow-2xl", "scale-[1.01]", "z-50");
            }
          });
          updateGroupBound();
          if (typeof renderSlidePreviews === "function")
            renderSlidePreviews(currentSlideIndex);
          updateFloatingToolbars?.();
          buildPropertiesPanel?.();
          if (typeof schedulePresentationAutosave === "function") {
            schedulePresentationAutosave();
          }
        },
      },
    })
    .resizable({
      edges: {
        top: ".resize-handle.tc, .resize-handle.tl, .resize-handle.tr",
        left: ".resize-handle.lc, .resize-handle.tl, .resize-handle.bl",
        bottom: ".resize-handle.bc, .resize-handle.bl, .resize-handle.br",
        right: ".resize-handle.rc, .resize-handle.tr, .resize-handle.br",
      },
      listeners: {
        start(event) {
          if (document.body.classList.contains("play-mode-active")) return;
          const canvasTarget = getInteractCanvasTarget(event.target);
          if (!canvasTarget) return false;
          if (isElementInTextEditMode(event.target)) return false;

          const elementData = state.slides[currentSlideIndex].elements.find(
            (item) => item.id === canvasTarget.id,
          );
          if (elementData?.locked) return false;
          document.body.classList.add("sf-moving-element"); // floating toolbars step aside until the drop

          selectElement(canvasTarget.id, "replace");
          saveStateToUndo();
        },
        move(event) {
          const scale = getCanvasScale();
          const sourceEvent = event.sourceEvent || event;
          const shiftHeld = Boolean(sourceEvent.shiftKey);
          const target = getInteractCanvasTarget(event.target);
          if (!target) return;
          const elementData = state.slides[currentSlideIndex].elements.find(
            (item) => item.id === target.id,
          );
          if (!elementData) return;
          if (elementData.type === "connector") return;

          const isText = elementData.type === "text";
          const isImage = elementData.type === "image";
          const isCroppedImage = isImage && Boolean(elementData.cropTransform);
          const isEquation = elementData.type === "equation";
          const verticalResize = Boolean(
            event.edges?.top || event.edges?.bottom,
          );

          const oldX = parseFloat(target.getAttribute("data-x")) || 0;
          const oldY = parseFloat(target.getAttribute("data-y")) || 0;
          const oldW =
            parseFloat(target.style.width) ||
            parseFloat(elementData.width) ||
            100;
          const oldH =
            parseFloat(target.style.height) ||
            parseFloat(elementData.height) ||
            100;
          let x = oldX;
          let y = oldY;
          const rawW = Math.max(24, event.rect.width / scale);
          const rawH = Math.max(24, event.rect.height / scale);
          let w = isImage ? rawW : Math.max(24, _snapVal(rawW, shiftHeld));
          let h = isImage ? rawH : Math.max(24, _snapVal(rawH, shiftHeld));

          // Handle Aspect Ratio Locking
          if (isImage && elementData.lockAspectRatio) {
            const ratio = isCroppedImage
              ? oldW / Math.max(1, oldH)
              : typeof getImageAspectRatio === "function"
                ? getImageAspectRatio(elementData)
                : oldW / Math.max(1, oldH);

            const horizontalHandle = Boolean(
              event.edges?.left || event.edges?.right,
            );
            const verticalHandle = Boolean(
              event.edges?.top || event.edges?.bottom,
            );
            if (horizontalHandle && !verticalHandle) {
              h = w / ratio;
            } else if (verticalHandle && !horizontalHandle) {
              w = h * ratio;
            } else if (
              Math.abs(rawW - oldW) / Math.max(1, oldW) >=
              Math.abs(rawH - oldH) / Math.max(1, oldH)
            ) {
              h = w / ratio;
            } else {
              w = h * ratio;
            }
            if (w < 24) {
              w = 24;
              h = w / ratio;
            }
            if (h < 24) {
              h = 24;
              w = h * ratio;
            }
            if (event.edges?.left) x = oldX + oldW - w;
            else if (!event.edges?.left && !event.edges?.right)
              x = oldX + (oldW - w) / 2;
            if (event.edges?.top) y = oldY + oldH - h;
            else if (!event.edges?.top && !event.edges?.bottom)
              y = oldY + (oldH - h) / 2;
          } else {
            // Update position for handles that move the origin
            x += event.deltaRect.left / scale;
            y += event.deltaRect.top / scale;
          }

          target.style.width = w + "px";
          target.style.height = h + "px";
          target.style.transform = canvasElementTransform(elementData, x, y);
          target.setAttribute("data-x", x);
          target.setAttribute("data-y", y);

          // Update sidebar if visible
          const inputW = document.getElementById("prop-img-w");
          const inputH = document.getElementById("prop-img-h");
          if (inputW) inputW.value = Math.round(w);
          if (inputH) inputH.value = Math.round(h);

          if (isText && elementData.autoHeight !== false && !verticalResize) {
            const layout = syncTextBoxLayout(target, elementData);
            const nextHeight = layout?.height
              ? `${layout.height}px`
              : target.style.height;
            updateElementState(target.id, {
              x,
              y,
              width: w + "px",
              height: nextHeight,
              autoHeight: true,
            });
            elementData.width = `${w}px`;
            elementData.height = nextHeight;
            elementData.x = x;
            elementData.y = y;
          } else if (isEquation) {
            const oldH = parseFloat(elementData.height) || target.offsetHeight;
            const ratio = h / oldH;
            const oldFs = parseInt(elementData.styles?.fontSize) || 24;
            const nextFs = Math.round(oldFs * ratio);

            updateElementState(target.id, {
              x,
              y,
              width: w + "px",
              height: h + "px",
              styles: { ...elementData.styles, fontSize: `${nextFs}px` },
            });
            elementData.styles.fontSize = `${nextFs}px`;

            // Sync sidebar font size input
            const fsInput = document.getElementById("prop-eq-fs");
            if (fsInput) fsInput.value = nextFs;
          } else {
            updateElementState(target.id, {
              x,
              y,
              width: w + "px",
              height: h + "px",
              ...(isImage
                ? {
                    heightSetManually: true,
                    imageAspectRatio: isCroppedImage
                      ? w / Math.max(1, h)
                      : elementData.imageAspectRatio || w / Math.max(1, h),
                  }
                : {}),
              ...(isText ? { autoHeight: false } : {}),
            });
            if (isText && elementData.textFitMode === "autofit") {
              syncTextBoxLayout(target, elementData);
            }
          }

          // Real-time thumbnail update (throttled via requestAnimationFrame)
          if (!isCroppedImage && !window._thumbnailRaf) {
            window._thumbnailRaf = requestAnimationFrame(() => {
              window._thumbnailRaf = null;
              if (typeof renderSlidePreviews === "function") {
                renderSlidePreviews(currentSlideIndex);
              }
            });
          }

          window.followAttachedConnectors?.();
          updateGroupBound();
        },
        end() {
          document.body.classList.remove("sf-moving-element");
          updateGroupBound();
          renderSlidePreviews(currentSlideIndex);
          updateFloatingToolbars?.();
          if (typeof schedulePresentationAutosave === "function") {
            schedulePresentationAutosave();
          }
        },
      },
    });
}

// ─── Group-bound resize ──────────────────────────────────────────────────────

function _setupGroupBoundInteract() {
  const bound = document.getElementById("group-bound");
  if (!bound) return;

  interact(bound).draggable({
    ignoreFrom: ".resize-handle",
    listeners: {
      start() {
        saveStateToUndo();
        state.selectedIds.forEach((id) =>
          document
            .getElementById(id)
            ?.classList.add("shadow-2xl", "scale-[1.01]", "z-50"),
        );
      },
      move(event) {
        const scale = getCanvasScale();
        const dx = event.dx / scale;
        const dy = event.dy / scale;

        state.selectedIds.forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;

          const elData = state.slides[currentSlideIndex].elements.find(
            (item) => item.id === id,
          );
          if (elData?.locked) return;

          const x = (parseFloat(el.getAttribute("data-x")) || 0) + dx;
          const y = (parseFloat(el.getAttribute("data-y")) || 0) + dy;
          el.style.transform = canvasElementTransform(elData, x, y);
          el.setAttribute("data-x", x);
          el.setAttribute("data-y", y);
          updateElementState(id, { x, y });
        });
        _elementsDragged = true;
        window.followAttachedConnectors?.();

        // Update the bound's own position in real-time using logical coords
        const currentLogicalX =
          parseFloat(bound.getAttribute("data-logical-x")) || 0;
        const currentLogicalY =
          parseFloat(bound.getAttribute("data-logical-y")) || 0;
        const nextLogicalX = currentLogicalX + dx;
        const nextLogicalY = currentLogicalY + dy;

        bound.setAttribute("data-logical-x", nextLogicalX);
        bound.setAttribute("data-logical-y", nextLogicalY);

        const slideOffsetX =
          parseFloat(bound.getAttribute("data-slide-offset-x")) || 0;
        const slideOffsetY =
          parseFloat(bound.getAttribute("data-slide-offset-y")) || 0;

        const nextScreenX = (nextLogicalX + slideOffsetX) * scale;
        const nextScreenY = (nextLogicalY + slideOffsetY) * scale;
        bound.style.transform = `translate(${nextScreenX}px, ${nextScreenY}px)`;
      },
      end() {
        state.selectedIds.forEach((id) =>
          document
            .getElementById(id)
            ?.classList.remove("shadow-2xl", "scale-[1.01]", "z-50"),
        );
        if (_elementsDragged) window.detachMovedConnectors?.();
        _elementsDragged = false;
        updateGroupBound();
        renderSlidePreviews(currentSlideIndex);
        if (typeof schedulePresentationAutosave === "function") {
          schedulePresentationAutosave();
        }
      },
    },
  });

  const handles = Array.from(bound.querySelectorAll(".resize-handle"));
  let active = null;

  const onMove = (e) => {
    if (!active) return;

    const scale = getCanvasScale();
    const dx = (e.clientX - active.startClientX) / scale;
    const dy = (e.clientY - active.startClientY) / scale;

    let newX = active.start.x;
    let newY = active.start.y;
    let newW = active.start.w;
    let newH = active.start.h;

    if (active.edges.right) newW += dx;
    if (active.edges.bottom) newH += dy;
    if (active.edges.left) {
      newX += dx;
      newW -= dx;
    }
    if (active.edges.top) {
      newY += dy;
      newH -= dy;
    }

    const minBound = 24;
    newW = Math.max(minBound, newW);
    newH = Math.max(minBound, newH);

    const ratioW = Math.max(0.05, newW / active.start.w);
    const ratioH = Math.max(0.05, newH / active.start.h);

    const screenX = (newX + active.offsetX) * scale;
    const screenY = (newY + active.offsetY) * scale;
    bound.style.width = `${newW * scale}px`;
    bound.style.height = `${newH * scale}px`;
    bound.style.transform = `translate(${screenX}px, ${screenY}px)`;

    active.elementStarts.forEach((s) => {
      const target = document.getElementById(s.id);
      if (!target || s.locked) return;
      const fx = newX + (s.x - active.start.x) * ratioW;
      const fy = newY + (s.y - active.start.y) * ratioH;
      const fw = Math.max(24, parseFloat(s.width) * ratioW);
      const fh = Math.max(24, parseFloat(s.height) * ratioH);

      target.style.transform = canvasElementTransform(state.slides[currentSlideIndex].elements.find((item) => item.id === s.id) || s, fx, fy);
      target.style.width = `${fw}px`;
      target.style.height = `${fh}px`;
      target.setAttribute("data-x", fx);
      target.setAttribute("data-y", fy);
      updateElementState(s.id, {
        x: fx,
        y: fy,
        width: `${fw}px`,
        height: `${fh}px`,
      });
    });
    window.followAttachedConnectors?.();
  };

  const onUp = () => {
    if (!active) return;
    active = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    renderSlidePreviews(currentSlideIndex);
    updateGroupBound();
    if (typeof schedulePresentationAutosave === "function") {
      schedulePresentationAutosave();
    }
  };

  handles.forEach((handle) => {
    handle.addEventListener("mousedown", (e) => {
      if (document.body.classList.contains("play-mode-active")) return;
      if (state.selectedIds.length < 2) return;

      const start = {
        x: parseFloat(bound.getAttribute("data-logical-x")),
        y: parseFloat(bound.getAttribute("data-logical-y")),
        w: parseFloat(bound.getAttribute("data-logical-w")),
        h: parseFloat(bound.getAttribute("data-logical-h")),
      };
      if (
        !Number.isFinite(start.x) ||
        !Number.isFinite(start.y) ||
        !Number.isFinite(start.w) ||
        !Number.isFinite(start.h)
      ) {
        return;
      }

      saveStateToUndo();

      const scale = getCanvasScale();
      const elementStarts = state.selectedIds
        .map((id) => {
          const el = state.slides[currentSlideIndex].elements.find(
            (item) => item.id === id,
          );
          const dom = document.getElementById(id);
          if (!el || !dom) return null;
          const rect = dom.getBoundingClientRect();
          const width = Number.isFinite(parseFloat(el.width))
            ? parseFloat(el.width)
            : rect.width / scale;
          const height = Number.isFinite(parseFloat(el.height))
            ? parseFloat(el.height)
            : rect.height / scale;
          return { id, ...JSON.parse(JSON.stringify(el)), width, height };
        })
        .filter(Boolean);

      active = {
        start,
        offsetX: parseFloat(bound.getAttribute("data-slide-offset-x")) || 0,
        offsetY: parseFloat(bound.getAttribute("data-slide-offset-y")) || 0,
        startClientX: e.clientX,
        startClientY: e.clientY,
        elementStarts,
        edges: {
          top:
            handle.classList.contains("tl") ||
            handle.classList.contains("tc") ||
            handle.classList.contains("tr"),
          right:
            handle.classList.contains("tr") ||
            handle.classList.contains("rc") ||
            handle.classList.contains("br"),
          bottom:
            handle.classList.contains("bl") ||
            handle.classList.contains("bc") ||
            handle.classList.contains("br"),
          left:
            handle.classList.contains("tl") ||
            handle.classList.contains("lc") ||
            handle.classList.contains("bl"),
        },
      };

      e.preventDefault();
      e.stopPropagation();
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

// ─── Marquee selection ───────────────────────────────────────────────────────

function _setupMarquee() {
  const canvasWrapper = document.getElementById("canvas-wrapper");
  if (!canvasWrapper) return;

  const dragThreshold = 4;
  let marqueeStart = null;
  let marqueeActive = false;

  const getActiveSlideElements = () => {
    const activeSlide = document.querySelector(
      ".reveal .slides section.present",
    );
    return Array.from(
      activeSlide?.querySelectorAll(":scope > .canvas-element") || [],
    ).filter((el) => el.dataset?.presetBackground !== "true");
  };

  const getSelectionRect = (event) => ({
    left: Math.min(event.clientX, marqueeStart.x),
    right: Math.max(event.clientX, marqueeStart.x),
    top: Math.min(event.clientY, marqueeStart.y),
    bottom: Math.max(event.clientY, marqueeStart.y),
  });

  const isElementInsideRect = (el, rect) => {
    const elementRect = el.getBoundingClientRect();
    return (
      elementRect.left >= rect.left &&
      elementRect.right <= rect.right &&
      elementRect.top >= rect.top &&
      elementRect.bottom <= rect.bottom
    );
  };

  const updateMarqueeBox = (event) => {
    const marquee = document.getElementById("marquee");
    if (!marquee) return;
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const left =
      Math.min(event.clientX, marqueeStart.x) -
      wrapperRect.left +
      canvasWrapper.scrollLeft;
    const top =
      Math.min(event.clientY, marqueeStart.y) -
      wrapperRect.top +
      canvasWrapper.scrollTop;
    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${Math.abs(event.clientX - marqueeStart.x)}px`;
    marquee.style.height = `${Math.abs(event.clientY - marqueeStart.y)}px`;
  };

  const resetMarquee = () => {
    document.getElementById("marquee")?.classList.add("hidden");
    getActiveSlideElements().forEach((el) =>
      el.classList.remove("marquee-hover"),
    );
    marqueeStart = null;
    marqueeActive = false;
  };

  canvasWrapper.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("#group-bound")) return;
    // Any floating toolbar (text, image, shape): pressing its buttons must not first deselect the element.
    if (e.target.closest(".floating-text-toolbar")) return;
    if (e.target.closest(".canvas-element")) return;
    if (document.body.classList.contains("play-mode-active")) return;

    marqueeStart = {
      x: e.clientX,
      y: e.clientY,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    };
    const marquee = document.getElementById("marquee");
    if (marquee) {
      marquee.classList.add("hidden");
      marquee.style.width = "0px";
      marquee.style.height = "0px";
      updateMarqueeBox(e);
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!marqueeStart) return;
    const marquee = document.getElementById("marquee");
    if (!marquee) return;

    const dx = Math.abs(e.clientX - marqueeStart.x);
    const dy = Math.abs(e.clientY - marqueeStart.y);
    if (!marqueeActive && Math.max(dx, dy) < dragThreshold) return;

    if (!marqueeActive) {
      marqueeActive = true;
      marquee.classList.remove("hidden");
      if (!marqueeStart.additive) clearSelection();
    }

    updateMarqueeBox(e);
    const selectionRect = getSelectionRect(e);
    getActiveSlideElements().forEach((el) => {
      el.classList.toggle(
        "marquee-hover",
        isElementInsideRect(el, selectionRect),
      );
    });
  });

  window.addEventListener("mouseup", (e) => {
    if (!marqueeStart) return;
    if (!marqueeActive) {
      resetMarquee();
      return;
    }

    const selectionRect = getSelectionRect(e);
    const newlySelected = [];
    getActiveSlideElements().forEach((el) => {
      el.classList.remove("marquee-hover");
      if (isElementInsideRect(el, selectionRect)) {
        newlySelected.push(el.id);
      }
    });

    if (newlySelected.length > 0) {
      let combined = newlySelected;
      if (marqueeStart.additive) {
        const toggled = new Set(state.selectedIds);
        newlySelected.forEach((id) => {
          if (toggled.has(id)) toggled.delete(id);
          else toggled.add(id);
        });
        combined = Array.from(toggled);
      }
      setSelectedIds(combined);
      buildPropertiesPanel();
      updateGroupBound();
    } else if (!marqueeStart.additive) {
      clearSelection();
    }
    resetMarquee();
  });
}

// ─── Snap guides ─────────────────────────────────────────────────────────────

let _guides = [];
function _clearGuides() {
  _guides.forEach((g) => g.remove());
  _guides = [];
}

function _drawGuide(x, y, isVertical) {
  const g = document.createElement("div");
  g.className = `snap-guide ${isVertical ? "snap-guide-v" : "snap-guide-h"}`;
  if (isVertical) g.style.left = `${x}px`;
  else g.style.top = `${y}px`;
  document.getElementById(state.slides[currentSlideIndex].id)?.appendChild(g);
  _guides.push(g);
}

// ─── Links in text ───────────────────────────────────────────────────────────

// A link in a text box opens (in a new tab) only while presenting; in the editor a click on it is a click on the box.
document.addEventListener(
  "click",
  (event) => {
    const link = event.target?.closest?.(".presentation-slide a[href]");
    if (!link) return;
    event.preventDefault();
    if (!document.body.classList.contains("play-mode-active")) return;
    const href = link.getAttribute("href") || "";
    if (/^(https?:|mailto:)/i.test(href.trim())) window.open(href, "_blank", "noopener");
  },
  true,
);
