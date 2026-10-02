// Layers list: rendering, visibility and ordering.

// ─── Layer Management ───────────────────────────────────────────────────────

function renderLayersList() {
  const container = document.getElementById("layers-list");
  if (!container) return;

  const slide = state.slides[currentSlideIndex];
  if (!slide || !slide.elements) {
    container.innerHTML =
      '<div class="text-xs text-slate-400 p-2 text-center">No elements on this slide</div>';
    return;
  }

  // Sort elements by z-index descending (top layers first)
  const visibleLayerElements = slide.elements.filter(
    (el) =>
      !(
        typeof isPresetBackgroundElement === "function" &&
        isPresetBackgroundElement(el)
      ),
  );

  const sortedElements = visibleLayerElements.sort((a, b) => {
    const zA = a.styles?.zIndex || 0;
    const zB = b.styles?.zIndex || 0;
    return zB - zA;
  });

  if (sortedElements.length === 0) {
    container.innerHTML =
      '<div class="text-xs text-slate-400 p-2 text-center">No elements on this slide</div>';
    return;
  }

  container.innerHTML = sortedElements
    .map((el) => {
      const isSelected = state.selectedIds.includes(el.id);
      const icon = getElementIcon(el.type);
      const name = getElementDisplayName(el);
      const hiddenClass = el.hidden
        ? "opacity-55 cursor-default"
        : "cursor-pointer";
      const hiddenAttrs = el.hidden
        ? 'aria-disabled="true" title="Hidden layer. Use the eye button to show it before selecting."'
        : "";
      return `
            <div class="layer-list-item flex items-center gap-2 p-2 rounded-lg transition-colors border ${hiddenClass} ${isSelected ? "bg-primary/5 border-primary/20 text-primary" : "bg-white border-transparent text-slate-700 hover:bg-slate-50"}"
                 ${hiddenAttrs}
                 onclick="layerItemClicked('${el.id}', event)">
                <i class="${icon} w-4 text-center ${isSelected ? "text-primary" : "text-slate-400"}"></i>
                <span class="text-[11px] font-medium truncate flex-1">${name}</span>
                <button class="w-5 h-5 rounded hover:bg-slate-200 flex items-center justify-center text-slate-400 transition-colors" onclick="toggleLayerVisibility('${el.id}', event)" title="Toggle Visibility">
                    <i class="fa-regular ${el.hidden ? "fa-eye-slash text-slate-300" : "fa-eye"} text-[10px]"></i>
                </button>
            </div>
        `;
    })
    .join("");
}

function layerItemClicked(id, event) {
  const slide = state.slides[currentSlideIndex];
  const el = slide?.elements?.find((item) => item.id === id);
  if (!el || el.hidden) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return;
  }

  if (event.shiftKey) {
    const newIds = [...state.selectedIds];
    if (newIds.includes(id)) {
      newIds.splice(newIds.indexOf(id), 1);
    } else {
      newIds.push(id);
    }
    setSelectedIds(newIds);
  } else {
    setSelectedIds([id]);
  }
  buildPropertiesPanel();
  updateGroupBound();
  renderLayersList();
}

function getElementIcon(type) {
  switch (type) {
    case "text":
      return "fa-solid fa-t";
    case "image":
      return "fa-regular fa-image";
    case "shape":
      return "fa-regular fa-square";
    case "video":
      return "fa-solid fa-video";
    case "connector":
      return "fa-solid fa-arrow-right-long";
    case "table":
      return "fa-solid fa-table";
    case "chart":
      return "fa-solid fa-chart-pie";
    case "molecule":
      return "fa-solid fa-dna";
    case "pdf":
      return "fa-regular fa-file-pdf";
    case "whiteboard":
      return "fa-solid fa-chalkboard";
    case "sketch":
      return "fa-solid fa-pen-nib";
    default:
      return "fa-solid fa-cube";
  }
}

function getElementDisplayName(el) {
  if (el.type === "text") {
    let text = String(el.content || "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) return "Text Box";
    return text.length > 20 ? text.substring(0, 20) + "..." : text;
  }
  if (el.type === "image") return "Image";
  if (el.type === "shape") {
    const shapeType = el.shapeType || "Rectangle";
    return shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
  }
  if (el.type === "connector") return "Connector";
  if (el.type === "whiteboard") return "Whiteboard";
  if (el.type === "sketch") return "Sketch";
  if (el.type === "video") return "Video";
  if (el.type === "table") return "Table";
  if (el.type === "molecule") return "Molecule";
  return el.type.charAt(0).toUpperCase() + el.type.slice(1);
}

function toggleLayerVisibility(id, event) {
  event.stopPropagation();
  const slide = state.slides[currentSlideIndex];
  if (!slide) return;
  const el = slide.elements.find((e) => e.id === id);
  if (!el) return;

  saveStateToUndo();
  el.hidden = !el.hidden;

  if (el.hidden && state.selectedIds.includes(id)) {
    setSelectedIds(state.selectedIds.filter((selectedId) => selectedId !== id));
    buildPropertiesPanel();
    updateGroupBound();
  }

  const dom = document.getElementById(id);
  if (dom) {
    dom.style.opacity = el.hidden ? "0" : "1";
    dom.style.pointerEvents = el.hidden ? "none" : "auto";
  }

  renderLayersList();
}

function moveSelectedLayer(direction) {
  if (state.selectedIds.length !== 1) return;
  const id = state.selectedIds[0];

  const slide = state.slides[currentSlideIndex];
  if (!slide) return;

  saveStateToUndo();

  // Sort all elements by current Z index
  slide.elements.sort(
    (a, b) => (a.styles?.zIndex || 0) - (b.styles?.zIndex || 0),
  );

  const currentIndex = slide.elements.findIndex((e) => e.id === id);
  if (currentIndex === -1) return;

  if (direction === "up" && currentIndex < slide.elements.length - 1) {
    // Swap with the element immediately above it
    const tempZ = slide.elements[currentIndex].styles.zIndex;
    slide.elements[currentIndex].styles.zIndex =
      slide.elements[currentIndex + 1].styles.zIndex;
    slide.elements[currentIndex + 1].styles.zIndex = tempZ;
  } else if (direction === "down" && currentIndex > 0) {
    // Swap with the element immediately below it
    const tempZ = slide.elements[currentIndex].styles.zIndex;
    slide.elements[currentIndex].styles.zIndex =
      slide.elements[currentIndex - 1].styles.zIndex;
    slide.elements[currentIndex - 1].styles.zIndex = tempZ;
  }

  renderSlidesFromState();
  renderLayersList();
}

window.renderLayersList = renderLayersList;

window.layerItemClicked = layerItemClicked;

window.toggleLayerVisibility = toggleLayerVisibility;

window.moveSelectedLayer = moveSelectedLayer;
