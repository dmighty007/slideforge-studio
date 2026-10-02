// Keeping slide media (video, molecule iframes) in sync with the active slide.

function getActiveSlideMediaIndex() {
  if (
    typeof Reveal !== "undefined" &&
    typeof Reveal.getIndices === "function"
  ) {
    const indices = Reveal.getIndices();
    if (Number.isInteger(indices?.h)) return indices.h;
  }
  return currentSlideIndex;
}

function syncActiveSlideMedia() {
  const container = document.getElementById("slides-container");
  if (!container) return;
  const activeIndex = getActiveSlideMediaIndex();
  const pageActive =
    document.visibilityState !== "hidden" && document.hasFocus();
  Array.from(container.children).forEach((section, index) => {
    const isActive = pageActive && index === activeIndex;
    section.toggleAttribute("data-media-active", isActive);

    const threeBackground = section.querySelector(".slide-background-three");
    if (threeBackground) {
      const normalized = normalizeSlideBackground(
        state.slides?.[index]?.background,
      );
      if (normalized?.type === "three") {
        const theme =
          typeof getPresentationTheme === "function"
            ? getPresentationTheme()
            : null;
        if (isActive && threeBackground.dataset.renderer !== "three") {
          _resetThemeThreeBackgroundRenderer(threeBackground, normalized, {
            forPreview: false,
            slideIndex: index,
            theme,
            useThree: true,
          });
        } else if (isActive) {
          _touchThemeMotionWebglWrapper(threeBackground);
          _pruneThemeMotionWebglWrappers(threeBackground);
        }
      }
    }

    section.querySelectorAll("video").forEach((video) => {
      if (!isActive) {
        if (!video.paused) video.pause();
        return;
      }
      const shouldAutoPlay =
        video.autoplay || video.classList.contains("slide-background-video");
      if (shouldAutoPlay) video.play().catch(() => {});
    });

    section.querySelectorAll("iframe").forEach((iframe) => {
      const src = String(iframe.getAttribute("src") || "");
      const isMolecule = iframe.classList.contains("molecule-embed-frame");
      if (isMolecule) {
        iframe.contentWindow?.postMessage(
          { type: "pptmaker:molecule:lifecycle", active: isActive },
          "*",
        );
        return;
      }
      if (/youtube(?:-nocookie)?\.com\/embed\//i.test(src)) {
        const wasActive = iframe.dataset.mediaWasActive === "true";
        const shouldAutoplay = iframe.dataset.autoplay === "true";
        const command =
          isActive && shouldAutoplay
            ? "playVideo"
            : !isActive && wasActive
              ? "pauseVideo"
              : "";
        iframe.dataset.mediaWasActive = isActive ? "true" : "false";
        if (command && iframe.dataset.mediaLoaded === "true") {
          try {
            iframe.contentWindow?.postMessage(
              JSON.stringify({ event: "command", func: command, args: [] }),
              "https://www.youtube-nocookie.com",
            );
          } catch (_) {}
        }
      } else if (/player\.vimeo\.com\/video\//i.test(src)) {
        const wasActive = iframe.dataset.mediaWasActive === "true";
        const shouldAutoplay = iframe.dataset.autoplay === "true";
        const method =
          isActive && shouldAutoplay
            ? "play"
            : !isActive && wasActive
              ? "pause"
              : "";
        iframe.dataset.mediaWasActive = isActive ? "true" : "false";
        if (method && iframe.dataset.mediaLoaded === "true") {
          iframe.contentWindow?.postMessage({ method }, "*");
        }
      }
    });
  });
}

function setMediaIframePermissions(iframe, value) {
  if (!iframe || /firefox/i.test(navigator.userAgent || "")) return;
  iframe.setAttribute("allow", value);
}

function findMoleculeElementDataById(elementId) {
  if (!elementId) return null;
  for (const slide of state.slides || []) {
    const element = (slide.elements || []).find(
      (item) => item?.id === elementId && item.type === "molecule",
    );
    if (element) return element;
  }
  return null;
}

function updateMoleculeViewStateInState(
  elementId,
  viewState,
  { autosave = false } = {},
) {
  const normalized =
    typeof normalizeMoleculeViewState === "function"
      ? normalizeMoleculeViewState(viewState)
      : null;
  if (!elementId || !normalized) return false;
  const element = findMoleculeElementDataById(elementId);
  if (!element) return false;
  const previous = JSON.stringify(element.moleculeViewState || null);
  const next = JSON.stringify(normalized);
  if (previous === next) return false;
  element.moleculeViewState = normalized;
  if (autosave && typeof schedulePresentationAutosave === "function") {
    schedulePresentationAutosave(900);
  }
  return true;
}

function requestMoleculeIframeViewState(iframe, timeoutMs = 350) {
  return new Promise((resolve) => {
    if (!iframe?.contentWindow) {
      resolve(null);
      return;
    }
    const requestId = `mol_view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event) {
      const message = event.data || {};
      if (event.source !== iframe.contentWindow) return;
      if (
        !message ||
        message.type !== "pptmaker:molecule:view-state-response" ||
        message.requestId !== requestId
      )
        return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(message.viewState || null);
    }
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage(
      { type: "pptmaker:molecule:view-state-request", requestId },
      "*",
    );
  });
}

// A PNG (data URL) of what a molecule viewer shows now, or null if it has not loaded in time.
// width/height: the element's size, used when the viewer's slide is hidden and it has no size of its own.
function requestMoleculeSnapshot(iframe, timeoutMs = 6000, { transparent = true, factor = 2, width = 0, height = 0 } = {}) {
  return new Promise((resolve) => {
    if (!iframe?.contentWindow) {
      resolve(null);
      return;
    }
    const requestId = `mol_shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    // Asked again every 300 ms until a picture comes back: a viewer that is still loading either does not answer
    // yet or answers "nothing drawn yet".
    const ask = () => iframe.contentWindow?.postMessage({ type: "pptmaker:molecule:snapshot-request", requestId, transparent, factor, width, height }, "*");
    const repeat = window.setInterval(ask, 300);
    const finish = (value) => {
      window.clearInterval(repeat);
      window.clearTimeout(deadline);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const deadline = window.setTimeout(() => finish(null), timeoutMs);
    function onMessage(event) {
      const message = event.data || {};
      if (event.source !== iframe.contentWindow || message.type !== "pptmaker:molecule:snapshot-response" || message.requestId !== requestId) return;
      if (message.dataUrl) finish(message.dataUrl);
    }
    window.addEventListener("message", onMessage);
    ask();
  });
}

// Thumbnails show a small picture of each molecule as it is drawn now, taken when its viewer reports a change
// (loaded, restyled, turned). Until then they show the molecule's name.
const _moleculeThumbnails = new Map();
const _moleculeThumbnailTimers = new Map();

function _requestMoleculeThumbnail(iframe) {
  return new Promise((resolve) => {
    if (!iframe?.contentWindow) return resolve(null);
    const requestId = `mol_thumb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const finish = (value) => {
      window.clearTimeout(deadline);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const deadline = window.setTimeout(() => finish(null), 1500);
    function onMessage(event) {
      const message = event.data || {};
      if (event.source === iframe.contentWindow && message.type === "pptmaker:molecule:thumbnail-response" && message.requestId === requestId) finish(message.dataUrl || null);
    }
    window.addEventListener("message", onMessage);
    iframe.contentWindow.postMessage({ type: "pptmaker:molecule:thumbnail-request", requestId, width: 320 }, "*");
  });
}

function moleculeThumbnail(elementId) {
  return _moleculeThumbnails.get(elementId) || null;
}

function scheduleMoleculeThumbnail(elementId, delay = 700) {
  if (!elementId) return;
  window.clearTimeout(_moleculeThumbnailTimers.get(elementId));
  _moleculeThumbnailTimers.set(elementId, window.setTimeout(async () => {
    _moleculeThumbnailTimers.delete(elementId);
    const node = [...document.querySelectorAll(`[id="${elementId}"]`)].find((item) => !item.closest("#slide-previews"));
    const element = findMoleculeElementDataById(elementId);
    if (!node || !element) return;
    const dataUrl = await _requestMoleculeThumbnail(node.querySelector(".molecule-embed-frame"));
    if (!dataUrl || _moleculeThumbnails.get(elementId) === dataUrl) return;
    _moleculeThumbnails.set(elementId, dataUrl);
    const slideIndex = (state.slides || []).findIndex((slide) => slide.elements?.some((item) => item.id === elementId));
    if (slideIndex >= 0 && typeof renderSlidePreviews === "function") renderSlidePreviews(slideIndex);
  }, delay));
}

// While a slide is captured (PDF/PNG), each molecule viewer is covered by a picture of its current view: the
// capture cannot see inside the viewer's frame and drew an empty box. Returns a function that removes the pictures.
async function showMoleculesAsPicturesForCapture(slideNode) {
  const frames = Array.from(slideNode?.querySelectorAll(".canvas-element[data-type='molecule'] .molecule-embed-frame") || []);
  const added = [];
  await Promise.all(
    frames.map(async (iframe) => {
      const dataUrl = await requestMoleculeSnapshot(iframe);
      if (!dataUrl) return;
      const img = document.createElement("img");
      img.src = dataUrl;
      img.className = "molecule-capture-picture";
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;z-index:5;";
      await img.decode().catch(() => {});
      const host = iframe.closest(".canvas-element") || iframe.parentElement;
      host.appendChild(img);
      added.push(img);
    }),
  );
  return () => added.forEach((img) => img.remove());
}

// Molecule elements of an export state as pictures of their current view, where a loaded viewer is on the page
// (PowerPoint cannot show the 3D viewer).
async function replaceMoleculesWithPictures(exportState) {
  for (const slide of exportState?.slides || []) {
    for (const [index, el] of (slide.elements || []).entries()) {
      if (el?.type !== "molecule") continue;
      const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find((item) => !item.closest("#slide-previews"));
      // With its background painted in (PowerPoint has no element behind the picture to supply it), unless the
      // molecule has none: then a see-through picture, so the slide shows through as in the editor.
      const transparent = normalizeMoleculeBackgroundColor(el.styles?.backgroundColor || "#020617") === "transparent";
      const dataUrl = await requestMoleculeSnapshot(node?.querySelector(".molecule-embed-frame"), 2500, {
        transparent,
        width: parseFloat(el.width) || 0,
        height: parseFloat(el.height) || 0,
      });
      if (!dataUrl) continue;
      slide.elements[index] = {
        id: el.id,
        type: "image",
        content: dataUrl,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        styles: { zIndex: el.styles?.zIndex, borderRadius: el.styles?.borderRadius || "0px" },
        exportedFrom: "molecule",
      };
    }
  }
}

async function syncMoleculeViewStatesFromDom() {
  const frames = Array.from(
    document.querySelectorAll(
      ".canvas-element[data-type='molecule'] .molecule-embed-frame",
    ),
  );
  if (!frames.length) return false;
  let changed = false;
  await Promise.all(
    frames.map(async (iframe) => {
      const elementId = iframe.closest(".canvas-element")?.id || "";
      const viewState = await requestMoleculeIframeViewState(iframe);
      if (updateMoleculeViewStateInState(elementId, viewState)) changed = true;
    }),
  );
  return changed;
}
