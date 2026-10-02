/**
 * 3D Background Integration Module
 * Integrates Canvas3DBackground with SlideForge's existing settings system
 *
 * This module:
 * - Extends normalizeSlideBackground() to support 3D backgrounds
 * - Hooks into createSlideBackgroundNode() for rendering
 * - Adds UI to the properties panel for background selection
 * - Manages 3D background instance lifecycle
 */

// ============================================================================
// 1. EXTEND STATE NORMALIZATION
// ============================================================================

/**
 * Normalize 3D background configuration
 * Called by normalizeSlideBackground() for type === '3d'
 */
function normalizeSlideBackground3D(config) {
  if (!config) return null;
  if (typeof config === "string") {
    // Handle string format: 'particle-float'
    return {
      type: "3d",
      style: config,
      opacity: 1,
      blur: 0,
      brightness: 100,
      saturate: 100,
    };
  }
  if (typeof config === "object") {
    return {
      type: "3d",
      style: String(config.style || "particle-float"),
      opacity: Math.max(0, Math.min(1, Number(config.opacity ?? 1))),
      blur: Math.max(0, Math.min(40, Number(config.blur) || 0)),
      brightness: Math.max(10, Math.min(200, Number(config.brightness ?? 100))),
      saturate: Math.max(0, Math.min(250, Number(config.saturate ?? 100))),
    };
  }
  return null;
}

/**
 * Extended normalizeSlideBackground to support 3D
 * This wraps the original function
 */
const _originalNormalizeSlideBackground =
  typeof normalizeSlideBackground === "function"
    ? normalizeSlideBackground
    : null;

window.normalizeSlideBackground = function (background) {
  if (!background) return null;

  // Handle 3D background format
  if (typeof background === "object" && background.type === "3d") {
    return normalizeSlideBackground3D(background);
  }

  // Check if string looks like a 3D style ID
  if (typeof background === "string") {
    const styleId = String(background).trim();
    if (BACKGROUND_STYLES_3D && BACKGROUND_STYLES_3D[styleId]) {
      return normalizeSlideBackground3D(styleId);
    }
  }

  // Fall back to original implementation
  if (_originalNormalizeSlideBackground) {
    return _originalNormalizeSlideBackground(background);
  }

  return null;
};

// ============================================================================
// 2. RENDERING INTEGRATION
// ============================================================================

/**
 * Create canvas element for 3D background
 * Integrates with existing createSlideBackgroundNode
 */
function createSlideBackground3DNode(
  background,
  { forPreview = false, slideIndex = 0 } = {},
) {
  const normalized = normalizeSlideBackground3D(background);
  if (!normalized) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "slide-background-3d-wrapper";
  wrapper.style.position = "absolute";
  wrapper.style.top = "0";
  wrapper.style.left = "0";
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  wrapper.style.zIndex = "0";
  wrapper.style.opacity = String(normalized.opacity ?? 1);
  wrapper.style.filter = `blur(${normalized.blur || 0}px) brightness(${normalized.brightness || 100}%) saturate(${normalized.saturate ?? 100}%)`;
  if (normalized.blur) {
    wrapper.style.transform = `scale(${1 + Math.min(40, normalized.blur) / 120})`;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "slide-background-3d-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  wrapper.appendChild(canvas);

  // Store reference to manage lifecycle
  wrapper.dataset.backgroundType = "3d";
  wrapper.dataset.backgroundStyle = normalized.style;
  wrapper.dataset.slideIndex = slideIndex;

  // Initialize 3D background asynchronously to avoid blocking
  requestAnimationFrame(() => {
    if (!document.body.contains(wrapper)) return; // Safety check

    try {
      const theme =
        typeof getPresentationTheme === "function"
          ? getPresentationTheme()
          : PRESENTATION_THEMES?.editorial || {};

      const bg = new Canvas3DBackground(canvas, normalized.style, theme);
      wrapper._backgroundInstance = bg;
      wrapper._cleanupHandler = () => {
        if (wrapper._backgroundInstance) {
          wrapper._backgroundInstance.destroy();
        }
      };
    } catch (err) {
      console.warn(
        "[3D Background] Failed to initialize:",
        normalized.style,
        err,
      );
    }
  });

  return wrapper;
}

/**
 * Extend createSlideBackgroundNode to support 3D backgrounds
 * This wraps the original function
 */
const _originalCreateSlideBackgroundNode =
  typeof createSlideBackgroundNode === "function"
    ? createSlideBackgroundNode
    : null;

window.createSlideBackgroundNode = function (background, options = {}) {
  const normalized = normalizeSlideBackground(background);

  if (normalized && normalized.type === "3d") {
    return createSlideBackground3DNode(normalized, options);
  }

  // Fall back to original implementation
  if (_originalCreateSlideBackgroundNode) {
    return _originalCreateSlideBackgroundNode(background, options);
  }

  return null;
};

// ============================================================================
// 3. PROPERTIES PANEL INTEGRATION
// ============================================================================

/**
 * Build 3D background selector for properties panel
 */
function buildSlideBackground3DSelector() {
  const slide =
    typeof currentSlideIndex !== "undefined" && state?.slides
      ? state.slides[currentSlideIndex]
      : null;

  const currentStyle = slide?.background?.style || "none";

  const html = document.createElement("div");
  html.className = "slide-background-3d-selector";
  html.innerHTML = `
        <div class="properties-section">
            <label class="properties-label" for="bg-3d-style-select">3D Background</label>
            <select id="bg-3d-style-select" class="properties-input">
                <option value="none">None</option>
                ${Object.values(BACKGROUND_CATEGORIES || {})
                  .map(
                    (category) => `
                    <optgroup label="${category.name}">
                        ${(category.styles || [])
                          .map(
                            (style) => `
                            <option value="${style.id}" title="${style.description}">
                                ${style.name}
                            </option>
                        `,
                          )
                          .join("")}
                    </optgroup>
                `,
                  )
                  .join("")}
            </select>

            <div id="bg-3d-controls" style="display: none; margin-top: 12px;">
                <div class="properties-slider">
                    <label for="bg-3d-opacity">Opacity</label>
                    <input type="range" id="bg-3d-opacity" min="0" max="1" step="0.1" value="1"
                           class="properties-slider-input">
                </div>

                <div class="properties-slider">
                    <label for="bg-3d-blur">Blur</label>
                    <input type="range" id="bg-3d-blur" min="0" max="40" step="1" value="0"
                           class="properties-slider-input">
                </div>

                <div class="properties-slider">
                    <label for="bg-3d-brightness">Brightness</label>
                    <input type="range" id="bg-3d-brightness" min="10" max="200" step="10" value="100"
                           class="properties-slider-input">
                </div>

                <div class="properties-slider">
                    <label for="bg-3d-saturate">Saturate</label>
                    <input type="range" id="bg-3d-saturate" min="0" max="250" step="10" value="100"
                           class="properties-slider-input">
                </div>
            </div>
        </div>
    `;

  const selectEl = html.querySelector("#bg-3d-style-select");
  const controlsEl = html.querySelector("#bg-3d-controls");
  const opacityEl = html.querySelector("#bg-3d-opacity");
  const blurEl = html.querySelector("#bg-3d-blur");
  const brightnessEl = html.querySelector("#bg-3d-brightness");
  const saturateEl = html.querySelector("#bg-3d-saturate");

  // Set current values
  if (slide?.background?.style) {
    selectEl.value = slide.background.style;
    if (opacityEl) opacityEl.value = slide.background.opacity ?? 1;
    if (blurEl) blurEl.value = slide.background.blur ?? 0;
    if (brightnessEl) brightnessEl.value = slide.background.brightness ?? 100;
    if (saturateEl) saturateEl.value = slide.background.saturate ?? 100;
    if (controlsEl) controlsEl.style.display = "block";
  }

  // Handle style change
  selectEl.addEventListener("change", (e) => {
    const styleId = e.target.value;
    if (styleId === "none") {
      updateSlideBackground(null);
      if (controlsEl) controlsEl.style.display = "none";
    } else {
      updateSlideBackground({
        type: "3d",
        style: styleId,
        opacity: Number(opacityEl?.value ?? 1),
        blur: Number(blurEl?.value ?? 0),
        brightness: Number(brightnessEl?.value ?? 100),
        saturate: Number(saturateEl?.value ?? 100),
      });
      if (controlsEl) controlsEl.style.display = "block";
    }
  });

  // Handle control changes
  [opacityEl, blurEl, brightnessEl, saturateEl].forEach((el, idx) => {
    if (!el) return;
    el.addEventListener("change", () => {
      const styleId = selectEl.value;
      if (styleId !== "none") {
        updateSlideBackground({
          type: "3d",
          style: styleId,
          opacity: Number(opacityEl?.value ?? 1),
          blur: Number(blurEl?.value ?? 0),
          brightness: Number(brightnessEl?.value ?? 100),
          saturate: Number(saturateEl?.value ?? 100),
        });
      }
    });
  });

  return html;
}

/**
 * Update slide background in state
 */
function updateSlideBackground(backgroundConfig) {
  if (typeof currentSlideIndex === "undefined" || !state?.slides) return;

  const slide = state.slides[currentSlideIndex];
  if (!slide) return;

  slide.background = normalizeSlideBackground(backgroundConfig);
  saveStateToUndo();

  if (typeof renderSlidesFromState === "function") {
    renderSlidesFromState();
  }
  if (typeof refreshPreviews === "function") {
    refreshPreviews();
  }
}

// ============================================================================
// 4. PROPERTIES PANEL HOOKS
// ============================================================================

/**
 * Inject 3D background selector into properties panel
 * Called when slide is selected in properties
 */
const _originalRenderPropertiesPanel =
  typeof _renderPropertiesPanel === "function" ? _renderPropertiesPanel : null;

window._renderSlidePropertiesPanel = function () {
  const panel = document.getElementById("properties-content");
  if (!panel) return;

  // Create slide properties section
  const slide =
    typeof currentSlideIndex !== "undefined" && state?.slides
      ? state.slides[currentSlideIndex]
      : null;

  if (!slide) return;

  // Clear and rebuild panel
  panel.innerHTML = "";

  // Add slide properties title
  const title = document.createElement("h3");
  title.className = "properties-title";
  title.textContent = `Slide ${currentSlideIndex + 1}`;
  panel.appendChild(title);

  // Add 3D background selector
  if (typeof BACKGROUND_STYLES_3D !== "undefined") {
    const bgSelector = buildSlideBackground3DSelector();
    panel.appendChild(bgSelector);
  }

  // Add divider
  const divider = document.createElement("hr");
  divider.className = "properties-divider";
  divider.style.margin = "16px 0";
  panel.appendChild(divider);

  // Add other slide properties (layout, transition, notes)
  const layoutSection = document.createElement("div");
  layoutSection.className = "properties-section";
  layoutSection.innerHTML = `
        <label class="properties-label">Slide Transition</label>
        <select id="slide-transition-select" class="properties-input">
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide">Slide</option>
        </select>
    `;
  panel.appendChild(layoutSection);
};

/**
 * Cleanup 3D background instances when slide changes
 */
function cleanupSlideBackground3D(slideElement) {
  if (!slideElement) return;

  const wrapper = slideElement.querySelector(".slide-background-3d-wrapper");
  if (wrapper && wrapper._cleanupHandler) {
    wrapper._cleanupHandler();
  }
}

// ============================================================================
// 5. SLIDE SWITCHING HOOKS
// ============================================================================

/**
 * Add cleanup when changing slides
 */
const _originalChangeSlide =
  typeof changeSlide === "function" ? changeSlide : null;

window.changeSlide = function (index) {
  // Cleanup old slide
  const oldSlide = document.querySelector(
    `.presentation-slide[data-slide-index="${currentSlideIndex}"]`,
  );
  if (oldSlide) {
    cleanupSlideBackground3D(oldSlide);
  }

  // Call original
  if (_originalChangeSlide) {
    _originalChangeSlide(index);
  }
};

// ============================================================================
// 6. INITIALIZATION
// ============================================================================

/**
 * Initialize 3D background integration when document is ready
 */
function init3DBackgroundIntegration() {
  console.log("[3D Background Integration] Initialized");

  // Verify required systems
  if (typeof Canvas3DBackground === "undefined") {
    console.warn("[3D Background Integration] Canvas3DBackground not found");
    return;
  }

  if (typeof BACKGROUND_STYLES_3D === "undefined") {
    console.warn("[3D Background Integration] BACKGROUND_STYLES_3D not found");
    return;
  }

  // Build category data from styles
  if (typeof BACKGROUND_CATEGORIES === "undefined") {
    window.BACKGROUND_CATEGORIES = {};
    Object.entries(BACKGROUND_STYLES_3D).forEach(([id, style]) => {
      const category = style.category || "other";
      if (!BACKGROUND_CATEGORIES[category]) {
        BACKGROUND_CATEGORIES[category] = {
          id: category,
          name: category.charAt(0).toUpperCase() + category.slice(1),
          styles: [],
        };
      }
      BACKGROUND_CATEGORIES[category].styles.push(style);
    });
  }

  console.log("[3D Background Integration] Ready");
  console.log("  Styles:", Object.keys(BACKGROUND_STYLES_3D || {}).length);
  console.log("  Categories:", Object.keys(BACKGROUND_CATEGORIES || {}).length);
}

// Run initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init3DBackgroundIntegration);
} else {
  init3DBackgroundIntegration();
}

// Export for external use
window._updateSlideBackground3D = updateSlideBackground;
window._buildSlideBackground3DSelector = buildSlideBackground3DSelector;
window._createSlideBackground3DNode = createSlideBackground3DNode;
window._normalizeSlideBackground3D = normalizeSlideBackground3D;
