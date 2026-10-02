// Properties panel: per-element animation configuration and click order.

function getElementAnimationConfig(el) {
  return normalizeElementAnimation(el);
}

function getSlideAnimationEntries(slide = state.slides[currentSlideIndex]) {
  if (!slide) return [];
  return (slide.elements || [])
    .map((el) => ({ el, animation: getElementAnimationConfig(el) }))
    .filter((entry) => entry.animation)
    .sort((a, b) => {
      const triggerDelta =
        (a.animation.trigger === "on-slide" ? 0 : 1) -
        (b.animation.trigger === "on-slide" ? 0 : 1);
      if (triggerDelta !== 0) return triggerDelta;
      const orderDelta = (a.animation.order || 0) - (b.animation.order || 0);
      if (orderDelta !== 0) return orderDelta;
      return String(a.el.id).localeCompare(String(b.el.id));
    });
}

function getNextClickAnimationOrder(excludeId = "") {
  return (
    getSlideAnimationEntries()
      .filter(
        (entry) =>
          entry.el.id !== excludeId && entry.animation.trigger === "on-click",
      )
      .reduce(
        (maxOrder, entry) =>
          Math.max(maxOrder, Number(entry.animation.order) || 0),
        -1,
      ) + 1
  );
}

function describeAnimationEffect(effect) {
  const labels = {
    "fade-in": "Fade In",
    "slide-up": "Slide Up",
    "slide-down": "Slide Down",
    "slide-left": "Slide Left",
    "slide-right": "Slide Right",
    "zoom-in": "Zoom In",
    "pop-in": "Pop In",
    "wipe-in": "Wipe In",
    pulse: "Pulse",
    glow: "Glow",
  };
  return labels[effect] || effect;
}

function setElementAnimationConfig(id, config, { skipUndo = false } = {}) {
  const data = state.slides[currentSlideIndex]?.elements?.find(
    (e) => e.id === id,
  );
  if (!data) return;
  if (!skipUndo) saveStateToUndo();
  updateElementState(id, {
    animation: config ? createDefaultAnimation(config.effect, config) : null,
    fragmentAnimation: "none",
    fragmentIndex: null,
    animDuration: undefined,
    animDelay: undefined,
  });
  if (window.renderSlidesFromState) window.renderSlidesFromState();
  buildPropertiesPanel();
}

function moveElementAnimationOrder(id, direction) {
  const slide = state.slides[currentSlideIndex];
  if (!slide) return;
  const target = slide.elements.find((el) => el.id === id);
  const targetAnimation = getElementAnimationConfig(target);
  if (!targetAnimation) return;
  const peers = getSlideAnimationEntries(slide)
    .filter((entry) => entry.animation.trigger === targetAnimation.trigger)
    .map((entry) => entry.el.id);
  const currentIndex = peers.indexOf(id);
  const swapIndex = currentIndex + direction;
  if (currentIndex === -1 || swapIndex < 0 || swapIndex >= peers.length) return;
  saveStateToUndo();
  const swapId = peers[swapIndex];
  const swapEl = slide.elements.find((el) => el.id === swapId);
  const swapAnimation = getElementAnimationConfig(swapEl);
  if (!swapAnimation) return;
  updateElementState(id, {
    animation: { ...targetAnimation, order: swapAnimation.order },
  });
  updateElementState(swapId, {
    animation: { ...swapAnimation, order: targetAnimation.order },
  });
  if (window.renderSlidesFromState) window.renderSlidesFromState();
  buildPropertiesPanel();
}

function applyAnimationConfigToSelection(
  config,
  { assignSequentialOrder = false } = {},
) {
  if (!state.selectedIds.length) return;
  saveStateToUndo();
  let nextOrder = 0;
  if (assignSequentialOrder) {
    const entries = getSlideAnimationEntries();
    nextOrder =
      entries
        .filter((entry) => entry.animation.trigger === "on-click")
        .reduce(
          (maxOrder, entry) =>
            Math.max(maxOrder, Number(entry.animation.order) || 0),
          -1,
        ) + 1;
  }
  state.selectedIds.forEach((id, offset) => {
    updateElementState(id, {
      animation: config
        ? createDefaultAnimation(config.effect, {
            ...config,
            order: assignSequentialOrder ? nextOrder + offset : config.order,
          })
        : null,
      fragmentAnimation: "none",
      fragmentIndex: null,
      animDuration: undefined,
      animDelay: undefined,
    });
  });
  if (window.renderSlidesFromState) window.renderSlidesFromState();
  buildPropertiesPanel();
}
