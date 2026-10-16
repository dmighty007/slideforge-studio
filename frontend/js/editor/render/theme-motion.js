// Animated 3D slide backgrounds (drawn by render/motion-engine.js) and slide background nodes.

function _themeMotionColors(themeOverride = null) {
  const theme =
    themeOverride ||
    (typeof getPresentationTheme === "function"
      ? getPresentationTheme()
      : null);
  const vars = theme?.cssVars || {};
  return {
    bg: vars["--slide-bg"] || theme?.surfaceColor || "#ffffff",
    fg: vars["--slide-fg"] || theme?.defaultTextColor || "#172033",
    accent: vars["--slide-accent"] || theme?.accentStrong || "#2563eb",
    accent2: vars["--slide-accent-2"] || theme?.defaultShapeColor || "#0f766e",
  };
}

function _isThemeMotionActive(wrapper, forPreview = false) {
  if (forPreview || !document.contains(wrapper)) return false;
  if (document.visibilityState === "hidden") return false;
  const section = wrapper.closest("section");
  if (!section) return !document.body.classList.contains("play-mode-active");
  return (
    section.hasAttribute("data-media-active") ||
    section.classList.contains("present")
  );
}

function _themeMotionReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Sets up the canvas of one background. Only the slide on screen animates; every other copy (thumbnails, the
// slides next to it) is one still frame, redrawn when its size changes. Leaving a slide pauses its clock, so coming
// back continues where it stopped instead of jumping.
function _startThemeMotion(wrapper, canvas, normalized, { forPreview = false, theme = null } = {}) {
  const engine = typeof THEME_MOTION_ENGINE !== "undefined" ? THEME_MOTION_ENGINE : null;
  if (!engine) return null;
  const canAnimate =
    !forPreview &&
    !_themeMotionReducedMotion() &&
    engine.normalizeOptions(normalized).motion !== "still";
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  const motion = {
    time: 0,
    scene: null,
    aspect: 0,
    frameId: null,
    lastTimestamp: 0,
    width: 0,
    height: 0,
    disposed: false,
  };

  const measure = () => {
    // The slide's own size gives the shape; its size on screen (thumbnails are scaled down) the resolution.
    const layoutWidth = wrapper.offsetWidth || 0;
    const layoutHeight = wrapper.offsetHeight || 0;
    if (!layoutWidth || !layoutHeight) return false;
    const rect = wrapper.getBoundingClientRect();
    const onScreen = rect.width ? rect.width / layoutWidth : 1;
    const ratio = Math.max(0.2, Math.min(2, (window.devicePixelRatio || 1) * onScreen));
    const width = Math.max(1, Math.round(layoutWidth * ratio));
    const height = Math.max(1, Math.round(layoutHeight * ratio));
    const aspect = layoutWidth / layoutHeight;
    if (!motion.scene || Math.abs(aspect - motion.aspect) > 0.001) {
      motion.scene = engine.buildScene(normalized, aspect);
      motion.aspect = aspect;
    }
    // Only when the size really changed: resizing the canvas clears and reallocates it.
    if (width !== motion.width || height !== motion.height) {
      canvas.width = width;
      canvas.height = height;
      motion.width = width;
      motion.height = height;
    }
    return true;
  };

  const drawFrame = () => {
    if (motion.disposed || !measure()) return;
    engine.draw(ctx, motion.scene, motion.width, motion.height, _themeMotionColors(theme), motion.time);
  };

  const tick = timestamp => {
    motion.frameId = null;
    if (motion.disposed) return;
    if (!document.contains(wrapper)) {
      motion.lastTimestamp = 0;
      return;
    }
    if (!_isThemeMotionActive(wrapper, forPreview)) {
      motion.lastTimestamp = 0;
      wrapper.dataset.animating = "false";
      return;
    }
    if (motion.lastTimestamp) {
      motion.time += (Math.min(80, Math.max(0, timestamp - motion.lastTimestamp)) / 1000) * (motion.scene?.speed ?? 1);
    }
    motion.lastTimestamp = timestamp;
    drawFrame();
    motion.frameId = requestAnimationFrame(tick);
  };

  motion.setActive = active => {
    if (motion.disposed || !canAnimate) return;
    if (active && motion.frameId === null) {
      wrapper.dataset.animating = "true";
      motion.frameId = requestAnimationFrame(tick);
    } else if (!active && motion.frameId !== null) {
      cancelAnimationFrame(motion.frameId);
      motion.frameId = null;
      motion.lastTimestamp = 0;
      wrapper.dataset.animating = "false";
    }
  };
  motion.redraw = drawFrame;

  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => {
      if (motion.frameId === null) drawFrame();
    });
    observer.observe(wrapper);
  }
  motion.dispose = () => {
    if (motion.disposed) return;
    motion.disposed = true;
    if (motion.frameId !== null) cancelAnimationFrame(motion.frameId);
    motion.frameId = null;
    observer?.disconnect();
    wrapper._themeMotion = null;
    wrapper._disposeThemeMotion = null;
  };

  wrapper._themeMotion = motion;
  wrapper._disposeThemeMotion = motion.dispose;
  wrapper.dataset.animating = "false";
  // The node is built before it is added to the slide: draw once it has a size.
  requestAnimationFrame(() => {
    drawFrame();
    if (canAnimate && _isThemeMotionActive(wrapper, forPreview)) motion.setActive(true);
  });
  return motion;
}

// Opacity, blur, brightness and saturation of a slide background. With everything at its default no filter is set:
// even a do-nothing filter makes the browser redraw the animated canvas through an extra pass on every frame.
function applySlideBackgroundAdjustments(node, background) {
  if (!node || !background) return;
  const blur = Number(background.blur) || 0;
  const brightness = Number(background.brightness ?? 100);
  const saturate = Number(background.saturate ?? 100);
  node.style.opacity = String(background.opacity ?? 1);
  node.style.filter =
    blur || brightness !== 100 || saturate !== 100 ? `blur(${blur}px) brightness(${brightness}%) saturate(${saturate}%)` : "";
  node.style.transform = blur ? `scale(${1 + Math.min(40, blur) / 120})` : "";
}

function createThemeThreeBackgroundNode(normalized, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "slide-background-media slide-background-three";
  wrapper.dataset.backgroundType = "three";
  wrapper.dataset.threeStyle = normalized.style || "orbital";
  wrapper.dataset.renderer = "canvas";
  wrapper.style.background = _themeMotionColors(options.theme || null).bg;
  const canvas = document.createElement("canvas");
  canvas.className = "slide-background-three-canvas";
  canvas.setAttribute("aria-hidden", "true");
  wrapper.appendChild(canvas);
  _startThemeMotion(wrapper, canvas, normalized, options);
  return wrapper;
}

function cleanupSlideBackground3D(root = document) {
  const wrappers = root.classList?.contains("slide-background-three")
    ? [root]
    : Array.from(root.querySelectorAll?.(".slide-background-three") || []);
  wrappers.forEach((wrapper) => wrapper._disposeThemeMotion?.());
}

// Starts or pauses the background of a slide when it comes on or leaves the screen (render/media-sync.js).
function setThemeMotionActive(wrapper, active) {
  wrapper?._themeMotion?.setActive(Boolean(active));
}

// A still picture of a slide's 3D background (for PowerPoint, which cannot animate it), with the slide's opacity,
// blur, brightness and saturation applied. Transparent where the scene is empty: the slide's own fill shows there.
function renderThemeMotionPicture(background, { width = 1280, height = 720, pixelScale = 1, theme = null } = {}) {
  const engine = typeof THEME_MOTION_ENGINE !== "undefined" ? THEME_MOTION_ENGINE : null;
  const normalized = typeof normalizeSlideBackground === "function" ? normalizeSlideBackground(background) : background;
  if (!engine || normalized?.type !== "three") return "";
  const scene = engine.buildScene(normalized, width / height);
  const drawing = document.createElement("canvas");
  drawing.width = width;
  drawing.height = height;
  engine.draw(drawing.getContext("2d"), scene, width, height, _themeMotionColors(theme), 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const blur = Number(normalized.blur) || 0;
  const brightness = Number(normalized.brightness ?? 100);
  const saturate = Number(normalized.saturate ?? 100);
  if (blur || brightness !== 100 || saturate !== 100) {
    ctx.filter = `blur(${blur * pixelScale}px) brightness(${brightness}%) saturate(${saturate}%)`;
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(normalized.opacity ?? 1)));
  ctx.drawImage(drawing, 0, 0);
  return canvas.toDataURL("image/png");
}

function createSlideBackgroundNode(
  background,
  { forPreview = false, slideIndex = currentSlideIndex, theme = null } = {},
) {
  const normalized = normalizeSlideBackground(background);
  if (!normalized) return null;
  if (normalized.type === "three" || normalized.type === "3d") {
    const node = createThemeThreeBackgroundNode(normalized, {
      forPreview,
      slideIndex,
      theme,
    });
    applySlideBackgroundAdjustments(node, normalized);
    return node;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "slide-background-media";
  applySlideBackgroundAdjustments(wrapper, normalized);
  if (normalized.type === "video") {
    const video = document.createElement("video");
    video.className = "slide-background-video";
    video.src = normalized.content;
    video.style.setProperty(
      "object-fit",
      normalized.fit || "cover",
      "important",
    );
    video.muted = true;
    video.loop = true;
    const initiallyActive =
      !forPreview &&
      document.visibilityState !== "hidden" &&
      document.hasFocus() &&
      Number(slideIndex) === getActiveSlideMediaIndex();
    video.autoplay = initiallyActive;
    video.playsInline = true;
    video.preload = forPreview ? "metadata" : "auto";
    video.setAttribute("playsinline", "true");
    if (initiallyActive) {
      const play = () => video.play().catch(() => {});
      video.addEventListener("loadeddata", play, { once: true });
      requestAnimationFrame(play);
    }
    wrapper.appendChild(video);
  } else {
    const image = document.createElement("img");
    image.className = "slide-background-image";
    image.src = normalized.content;
    image.style.setProperty(
      "object-fit",
      normalized.fit || "cover",
      "important",
    );
    image.alt = "";
    image.draggable = false;
    wrapper.appendChild(image);
  }
  return wrapper;
}
