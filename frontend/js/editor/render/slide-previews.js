// Slide thumbnail strip: rendering, drag-to-reorder and refresh.

let _draggedSlidePreviewIndex = null;

let _slidePreviewDropMarker = null;

let _suppressSlidePreviewClickUntil = 0;

let _slidePreviewStructureSignature = "";

function getSlidePreviewStructureSignature() {
  const slideConfig =
    typeof getPresentationPageSetupConfig === "function"
      ? getPresentationPageSetupConfig()
      : { width: 1024, height: 768 };
  const slideIds = (state.slides || []).map((slide) => slide.id).join("|");
  return `${slideConfig.width}x${slideConfig.height}:${slideIds}`;
}

function reorderSlides(fromIndex, toIndex) {
  const slides = state.slides || [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
  if (fromIndex < 0 || fromIndex >= slides.length) return;
  if (toIndex < 0) toIndex = 0;
  if (toIndex > slides.length) toIndex = slides.length;
  if (fromIndex === toIndex || fromIndex + 1 === toIndex) return;

  saveStateToUndo();
  const activeSlideId = state.slides[currentSlideIndex]?.id;
  const [moved] = state.slides.splice(fromIndex, 1);
  const insertionIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  state.slides.splice(insertionIndex, 0, moved);

  const nextActiveIndex = state.slides.findIndex(
    (slide) => slide.id === activeSlideId,
  );
  if (nextActiveIndex >= 0) {
    setCurrentSlideIndex(nextActiveIndex);
  }
}

// Right-click on a slide thumbnail: the slide commands in one place (it did nothing; Duplicate and Delete only
// showed on hover).
function closeSlidePreviewMenu() {
  document.getElementById("slide-preview-menu")?.remove();
  document.removeEventListener("mousedown", _slidePreviewMenuOutside, true);
  document.removeEventListener("keydown", _slidePreviewMenuKey, true);
}

function _slidePreviewMenuOutside(event) {
  if (!event.target.closest?.("#slide-preview-menu")) closeSlidePreviewMenu();
}

function _slidePreviewMenuKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeSlidePreviewMenu();
  }
}

function openSlidePreviewMenu(index, x, y) {
  closeSlidePreviewMenu();
  const count = state.slides.length;
  const goTo = (slideIndex) => {
    setCurrentSlideIndex(slideIndex);
    renderSlidesFromState();
    if (typeof Reveal !== "undefined") Reveal.slide(slideIndex);
    updateSlideCounter?.();
  };
  const move = (to) => {
    const id = state.slides[index]?.id;
    reorderSlides(index, to);
    const at = state.slides.findIndex((slide) => slide.id === id);
    goTo(at >= 0 ? at : index);
  };
  const items = [
    { label: "New slide after", icon: "fa-plus", run: () => addSlide(index) },
    { label: "Duplicate", icon: "fa-clone", run: () => duplicateCurrentSlide(index) },
    { label: "Move up", icon: "fa-arrow-up", disabled: index === 0, run: () => move(index - 1) },
    { label: "Move down", icon: "fa-arrow-down", disabled: index >= count - 1, run: () => move(index + 2) },
    { label: "Delete", icon: "fa-trash-can", danger: true, disabled: count <= 1, run: () => deleteCurrentSlide(index) },
  ];
  const menu = document.createElement("div");
  menu.id = "slide-preview-menu";
  menu.className = "sf-context-menu";
  menu.setAttribute("role", "menu");
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sf-context-menu__item${item.danger ? " is-danger" : ""}`;
    button.setAttribute("role", "menuitem");
    button.disabled = Boolean(item.disabled);
    button.innerHTML = `<i class="fa-solid ${item.icon}" aria-hidden="true"></i><span></span>`;
    button.querySelector("span").textContent = item.label;
    button.addEventListener("click", () => {
      closeSlidePreviewMenu();
      item.run();
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, x))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, y))}px`;
  document.addEventListener("mousedown", _slidePreviewMenuOutside, true);
  document.addEventListener("keydown", _slidePreviewMenuKey, true);
  menu.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
}

window.openSlidePreviewMenu = openSlidePreviewMenu;

function clearSlidePreviewDropState(
  container = document.getElementById("slide-previews"),
) {
  _slidePreviewDropMarker = null;
  if (!container) return;
  container.querySelectorAll(".slide-preview-card").forEach((card) => {
    card.classList.remove("dragging", "drop-before", "drop-after");
  });
  if (_draggedSlidePreviewIndex != null) {
    container
      .querySelector(
        `.slide-preview-card[data-slide-index="${_draggedSlidePreviewIndex}"]`,
      )
      ?.classList.add("dragging");
  }
}

// Scales a thumbnail's slide to the thumbnail's current width. A rail that is hidden (during a show, or
// collapsed) measures 0 wide; scaling then shrank the slide to nothing and it stayed blank afterwards.
function _fitSlidePreview(thumbnail) {
  const previewSlide = thumbnail?.firstElementChild;
  if (!previewSlide) return;
  const width = thumbnail.getBoundingClientRect().width || thumbnail.clientWidth;
  if (!width) return;
  const slideWidth = Number(previewSlide.dataset.previewWidth) || 1024;
  previewSlide.style.transform = `scale(${width / slideWidth})`;
}

let _slidePreviewResizeObserver = null;

// One observer for all thumbnails: rescale whenever a thumbnail changes size, e.g. when the rail comes back.
function _getSlidePreviewResizeObserver() {
  if (_slidePreviewResizeObserver || typeof ResizeObserver !== "function") return _slidePreviewResizeObserver;
  _slidePreviewResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => _fitSlidePreview(entry.target));
  });
  return _slidePreviewResizeObserver;
}

function renderSlidePreviews(targetIndex = null, options = {}) {
  const container = document.getElementById("slide-previews");
  const theme = getPresentationTheme();
  const slideConfig = getPresentationPageSetupConfig();
  const slideWidth = Number(slideConfig.width) || 1024;
  const slideHeight = Number(slideConfig.height) || 768;
  if (!container) return;

  const buildPreviewSlide = (slide, index) => {
    syncSlideFooterNumber(slide, index);
    const previewSlide = document.createElement("div");
    const previewBg =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--slide-bg")
        .trim() || theme.cssVars["--slide-bg"];
    previewSlide.style.cssText = `width:${slideWidth}px;height:${slideHeight}px;position:relative;transform-origin:top left;background:${previewBg};color:${theme.defaultTextColor};font-family:${theme.bodyFont};`;

    const previewBgNode = createSlideBackgroundNode(slide.background, {
      forPreview: true,
      slideIndex: index,
      theme,
    });
    if (previewBgNode) previewSlide.appendChild(previewBgNode);
    if (typeof buildMasterSlideElements === "function") {
      buildMasterSlideElements(slide, index, theme).forEach((elData) =>
        previewSlide.appendChild(
          _createStaticNode(elData, { master: true, forPreview: true }),
        ),
      );
    }
    slide.elements.forEach((elData) =>
      previewSlide.appendChild(_createStaticNode(elData, { forPreview: true })),
    );
    return previewSlide;
  };

  const scalePreviewSlide = (thumbnail, previewSlide) => {
    previewSlide.dataset.previewWidth = String(slideWidth);
    _fitSlidePreview(thumbnail);
    requestAnimationFrame(() => _fitSlidePreview(thumbnail));
    _getSlidePreviewResizeObserver()?.observe(thumbnail);
  };

  if (targetIndex !== null) {
    // Update only one specific slide thumbnail
    const card = container.querySelector(
      `.slide-preview-card[data-slide-index="${targetIndex}"]`,
    );
    if (!card) return;

    const slide = state.slides[targetIndex];
    const thumbnail = card.querySelector(".slide-thumbnail");
    if (!thumbnail || !slide) return;

    const previewSlide = buildPreviewSlide(slide, targetIndex);

    // Surgical replacement to avoid "abrupt" resets
    const existing = thumbnail.firstElementChild;
    if (existing) {
      thumbnail.replaceChild(previewSlide, existing);
    } else {
      thumbnail.appendChild(previewSlide);
    }
    card.classList.toggle("active", targetIndex === currentSlideIndex);
    const number = card.querySelector(".slide-preview-number");
    if (number) number.innerText = String(targetIndex + 1);
    scalePreviewSlide(thumbnail, previewSlide);
    return;
  }

  const previousScrollTop = container.scrollTop;
  // A slide that was not in the strip before (just added, duplicated or pasted) is scrolled into view;
  // otherwise it could be added below the fold and sit hidden under the Deck panel.
  const previousSlideIds = new Set(
    (_slidePreviewStructureSignature.split(":")[1] || "").split("|"),
  );
  const activeSlideIsNew =
    !!_slidePreviewStructureSignature &&
    !!state.slides[currentSlideIndex] &&
    !previousSlideIds.has(state.slides[currentSlideIndex].id);
  const shouldPreserveScroll = options.preserveScroll !== false && !activeSlideIsNew;
  const shouldScrollActive =
    options.scrollActive === true || !_slidePreviewStructureSignature || activeSlideIsNew;

  container.innerHTML = "";
  container.ondragover = (e) => e.preventDefault();
  container.ondrop = (e) => {
    e.preventDefault();
    if (_draggedSlidePreviewIndex == null) return;
    reorderSlides(_draggedSlidePreviewIndex, state.slides.length);
    _draggedSlidePreviewIndex = null;
    clearSlidePreviewDropState(container);
    renderSlidesFromState();
  };
  container.ondragleave = (e) => {
    if (e.target === container) clearSlidePreviewDropState(container);
  };
  state.slides.forEach((slide, index) => {
    const card = document.createElement("div");
    card.className = `slide-preview-card ${index === currentSlideIndex ? "active" : ""}`;
    card.dataset.slideIndex = String(index);
    card.style.aspectRatio = `${slideWidth} / ${slideHeight}`;
    card.onclick = () => {
      if (Date.now() < _suppressSlidePreviewClickUntil) return;
      setCurrentSlideIndex(index);
      Reveal.slide(index);
    };
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      _draggedSlidePreviewIndex = index;
      _suppressSlidePreviewClickUntil = Date.now() + 250;
      card.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(index));
      }
    });
    card.addEventListener("dragend", () => {
      _suppressSlidePreviewClickUntil = Date.now() + 250;
      _draggedSlidePreviewIndex = null;
      clearSlidePreviewDropState(container);
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (
        _draggedSlidePreviewIndex == null ||
        _draggedSlidePreviewIndex === index
      )
        return;
      const rect = card.getBoundingClientRect();
      const dropAfter = e.clientY > rect.top + rect.height / 2;
      _slidePreviewDropMarker = { index, dropAfter };
      clearSlidePreviewDropState(container);
      card.classList.add(dropAfter ? "drop-after" : "drop-before");
      if (_draggedSlidePreviewIndex === index) {
        card.classList.add("dragging");
      }
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (_draggedSlidePreviewIndex == null) return;
      const rect = card.getBoundingClientRect();
      const dropAfter = e.clientY > rect.top + rect.height / 2;
      reorderSlides(_draggedSlidePreviewIndex, dropAfter ? index + 1 : index);
      _draggedSlidePreviewIndex = null;
      clearSlidePreviewDropState(container);
      renderSlidesFromState();
    });

    const thumbnail = document.createElement("div");
    thumbnail.className = "slide-thumbnail";
    const previewSlide = buildPreviewSlide(slide, index);
    thumbnail.appendChild(previewSlide);
    card.appendChild(thumbnail);

    const num = document.createElement("div");
    num.className = "slide-preview-number";
    num.innerText = index + 1;
    card.appendChild(num);

    const actions = document.createElement("div");
    actions.className =
      "slide-preview-actions absolute top-2 right-2 flex items-center gap-1 z-10";

    const duplicateBtn = document.createElement("button");
    duplicateBtn.type = "button";
    duplicateBtn.className =
      "w-7 h-7 rounded-md bg-white/90 border border-slate-200 text-sky-600 shadow-sm hover:bg-sky-50";
    duplicateBtn.title = "Duplicate slide";
    duplicateBtn.innerHTML = '<i class="fa-regular fa-clone text-[11px]"></i>';
    duplicateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      duplicateCurrentSlide(index);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className =
      "w-7 h-7 rounded-md bg-white/90 border border-slate-200 text-rose-500 shadow-sm hover:bg-rose-50";
    deleteBtn.title = "Delete slide";
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can text-[11px]"></i>';
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteCurrentSlide(index);
    });

    actions.appendChild(duplicateBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSlidePreviewMenu(index, e.clientX, e.clientY);
    });
    container.appendChild(card);
    scalePreviewSlide(thumbnail, previewSlide);
  });

  _slidePreviewStructureSignature = getSlidePreviewStructureSignature();

  if (shouldPreserveScroll) {
    requestAnimationFrame(() => {
      container.scrollTop = previousScrollTop;
    });
  } else if (shouldScrollActive) {
    setTimeout(() => {
      const activeCard = container.querySelector(".slide-preview-card.active");
      if (activeCard) {
        activeCard.scrollIntoView({ behavior: "auto", block: "nearest" });
      }
    }, 0);
  }
  if (shouldPreserveScroll && shouldScrollActive) {
    setTimeout(() => {
      if (container.scrollTop === previousScrollTop) return;
      container.scrollTop = previousScrollTop;
    }, 0);
  }
}

function refreshActiveSlidePreview() {
  const targetIndex = Math.max(
    0,
    Math.min(currentSlideIndex || 0, (state.slides || []).length - 1),
  );
  const nextPreviewSignature = getSlidePreviewStructureSignature();
  if (_slidePreviewStructureSignature === nextPreviewSignature) {
    renderSlidePreviews(targetIndex);
  } else {
    renderSlidePreviews(null, { preserveScroll: true });
  }
}

function updateActiveSlidePreview(index) {
  const container = document.getElementById("slide-previews");
  if (!container) return;

  container.querySelectorAll(".slide-preview-card").forEach((card, i) => {
    const isActive = i === index;
    card.classList.toggle("active", isActive);
    if (isActive) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}
