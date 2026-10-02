// Element selection, grouping and syncing the panel to the current selection.

// --- Selection & Property UI ---
function getActiveSlideElementDom(id) {
  if (!id) return null;
  const safeId =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(String(id))
      : String(id).replace(/"/g, '\\"');
  const slide = document.querySelector(
    `.presentation-slide[data-slide-index="${currentSlideIndex}"]`,
  );
  return slide?.querySelector(`.canvas-element#${safeId}`) || null;
}

function clearSelectionVisualState() {
  document
    .querySelectorAll(
      ".canvas-element.selected, .canvas-element.group-member-selected",
    )
    .forEach((el) => el.classList.remove("selected", "group-member-selected"));
}

function selectElement(id, selectionMode = "replace") {
  const elData = state.slides[currentSlideIndex].elements.find(
    (e) => e.id === id,
  );
  if (!elData) return;
  if (
    typeof isPresetBackgroundElement === "function" &&
    isPresetBackgroundElement(elData)
  )
    return;

  // Clicking any group member selects the whole group
  let idsToSelect = [id];
  if (elData.groupId) {
    idsToSelect = state.slides[currentSlideIndex].elements
      .filter((e) => e.groupId === elData.groupId)
      .map((e) => e.id);
  }

  if (selectionMode === "add") {
    idsToSelect.forEach((iid) => {
      if (!state.selectedIds.includes(iid)) {
        state.selectedIds.push(iid);
      }
    });
  } else if (selectionMode === "toggle") {
    const allAlreadySelected = idsToSelect.every((iid) =>
      state.selectedIds.includes(iid),
    );
    idsToSelect.forEach((iid) => {
      if (allAlreadySelected) {
        state.selectedIds = state.selectedIds.filter((x) => x !== iid);
        getActiveSlideElementDom(iid)?.classList.remove(
          "selected",
          "group-member-selected",
        );
      } else if (!state.selectedIds.includes(iid)) {
        state.selectedIds.push(iid);
      }
    });
  } else {
    // Single selection — clear old visual state directly WITHOUT calling
    // clearSelection(), which would trigger an extra buildPropertiesPanel()
    // and updateGroupBound() with empty selectedIds before we've set the new ones.
    state.selectedIds.forEach((prevId) => {
      getActiveSlideElementDom(prevId)?.classList.remove(
        "selected",
        "group-member-selected",
      );
      if (!idsToSelect.includes(prevId)) {
        const prevData = state.slides[currentSlideIndex]?.elements?.find(
          (e) => e.id === prevId,
        );
        if (prevData?.type === "table") {
          const prevTableData = normalizeTableData(prevData.tableData);
          if (prevTableData.selection) {
            prevTableData.selection = null;
            updateElementState(prevId, { tableData: prevTableData });
            prevData.tableData = prevTableData;
          }
        }
      }
    });
    state.selectedIds = idsToSelect;
  }

  // Single render pass with the correct final state
  buildPropertiesPanel();
  updateGroupBound();
}

function clearSelection() {
  if (
    document.activeElement &&
    typeof document.activeElement.blur === "function" &&
    document.activeElement !== document.body
  ) {
    document.activeElement.blur();
  }
  state.selectedIds.forEach((id) => {
    const data = state.slides[currentSlideIndex]?.elements?.find(
      (e) => e.id === id,
    );
    if (data?.type === "table") {
      const tableData = normalizeTableData(data.tableData);
      if (tableData.selection) {
        tableData.selection = null;
        updateElementState(id, { tableData });
        data.tableData = tableData;
      }
    }
  });
  clearTablePartSelections();

  clearSelectionVisualState();
  state.selectedIds = [];
  buildPropertiesPanel();
  updateGroupBound();
}

function updateGroupBound() {
  const bound = document.getElementById("group-bound");
  if (!bound) return;
  if (state.selectedIds.length < 1) {
    bound.classList.add("hidden");
    clearSelectionVisualState();
    return;
  }
  clearSelectionVisualState();

  const scale = getCanvasScale();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // Use the wrapper rect as the positioning origin for the group-bound overlay.
  // The group-bound is a direct child of canvas-wrapper so its translate() is
  // relative to the wrapper's top-left corner.
  const wrapper = document.getElementById("canvas-wrapper");
  if (!wrapper) {
    bound.classList.add("hidden");
    return;
  }
  const wrapperRect = wrapper.getBoundingClientRect();
  const wrapperScrollX = wrapper.scrollLeft || 0;
  const wrapperScrollY = wrapper.scrollTop || 0;

  // The Reveal.js slide section may be centered inside the wrapper.
  // We compute element screen positions relative to the wrapper to keep
  // the group-bound in the same coordinate space it is rendered in.
  let paintedCount = 0;
  state.selectedIds.forEach((id) => {
    const el = getActiveSlideElementDom(id);
    if (!el) return;
    paintedCount += 1;
    const rect = el.getBoundingClientRect();

    minX = Math.min(minX, rect.left - wrapperRect.left + wrapperScrollX);
    minY = Math.min(minY, rect.top - wrapperRect.top + wrapperScrollY);
    maxX = Math.max(maxX, rect.right - wrapperRect.left + wrapperScrollX);
    maxY = Math.max(maxY, rect.bottom - wrapperRect.top + wrapperScrollY);

    if (state.selectedIds.length > 1) {
      el.classList.add("group-member-selected");
      el.classList.remove("selected");
    } else {
      el.classList.remove("group-member-selected");
      el.classList.add("selected");
    }
  });

  if (
    paintedCount < 1 ||
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    bound.classList.add("hidden");
    return;
  }

  if (state.selectedIds.length > 1 && paintedCount > 1) {
    bound.classList.remove("hidden");
    bound.style.width = maxX - minX + "px";
    bound.style.height = maxY - minY + "px";
    bound.style.transform = `translate(${minX}px, ${minY}px)`;

    // Store the slide-section's top-left offset relative to wrapper so
    // the group resize move handler can correctly back-compute logical coords.
    const slideEl = document.querySelector(".reveal .slides section.present");
    const slideRect = slideEl ? slideEl.getBoundingClientRect() : wrapperRect;
    const slideOffsetX =
      (slideRect.left - wrapperRect.left + wrapperScrollX) / scale;
    const slideOffsetY =
      (slideRect.top - wrapperRect.top + wrapperScrollY) / scale;

    // Logical coords = screen offset from wrapper, adjusted for slide offset, then unscaled
    bound.setAttribute("data-logical-x", minX / scale - slideOffsetX);
    bound.setAttribute("data-logical-y", minY / scale - slideOffsetY);
    bound.setAttribute("data-logical-w", (maxX - minX) / scale);
    bound.setAttribute("data-logical-h", (maxY - minY) / scale);
    bound.setAttribute("data-slide-offset-x", slideOffsetX);
    bound.setAttribute("data-slide-offset-y", slideOffsetY);
  } else {
    bound.classList.add("hidden");
  }
}

function getSelectedElementData() {
  if (state.selectedIds.length !== 1) return null;
  return state.slides[currentSlideIndex].elements.find(
    (e) => e.id === state.selectedIds[0],
  );
}

function groupSelected() {
  if (state.selectedIds.length < 2) return;
  saveStateToUndo();
  const groupId = generateId("grp");
  state.selectedIds.forEach((id) => updateElementState(id, { groupId }));
  buildPropertiesPanel();
  updateGroupBound();
}

function ungroupSelected() {
  saveStateToUndo();
  state.selectedIds.forEach((id) => updateElementState(id, { groupId: null }));
  buildPropertiesPanel();
  updateGroupBound();
}

function updateUIFromSelection() {
  const active = document.activeElement;
  if (
    active?.matches?.("input, select, textarea") &&
    (active.closest("#floating-text-toolbar") ||
      active.closest("#properties-panel"))
  ) {
    return;
  }

  const inline = getStyleAtSelection();
  if (!inline) return;
  const defaults = getThemeTextStyleDefaults();

  // Update Font Family
  const fontControls = [
    document.getElementById("prop-font"),
    document.getElementById("floating-text-font"),
  ].filter(Boolean);
  fontControls.forEach((fontSelect) => {
    if (!inline.fontFamily) return;
    const family = inline.fontFamily.replace(/['"]/g, "").split(",")[0].trim();
    // Try to find matching option
    for (let opt of fontSelect.options) {
      if (opt.value.toLowerCase().includes(family.toLowerCase())) {
        fontSelect.value = opt.value;
        break;
      }
    }
    setTextControlActive(
      fontSelect,
      normalizeFontFamily(fontSelect.value) !==
        normalizeFontFamily(defaults.fontFamily),
    );
  });

  // Update Font Size
  const sizeControls = [
    document.getElementById("prop-fs"),
    document.getElementById("floating-text-size"),
  ].filter(Boolean);
  sizeControls.forEach((fsInput) => {
    if (!inline.fontSize) return;
    if (!isControlBeingEdited(fsInput)) {
      fsInput.value = parseInt(inline.fontSize) || 32;
      fsInput.dataset.lastCommittedValue = _normalizePx(fsInput.value, "32px");
    }
    setTextControlActive(
      fsInput,
      _normalizePx(fsInput.value, "32px") !== defaults.fontSize,
    );
  });

  // Update Color
  const colorControls = [
    document.getElementById("prop-tc"),
    document.getElementById("floating-text-color"),
  ].filter(Boolean);
  colorControls.forEach((colorInput) => {
    if (!inline.color) return;
    // Convert rgb(r, g, b) to #rrggbb
    let color = inline.color;
    if (color.startsWith("rgb")) {
      const match = color.match(/\d+/g);
      if (match) {
        color =
          "#" +
          match
            .slice(0, 3)
            .map((x) => parseInt(x).toString(16).padStart(2, "0"))
            .join("");
      }
    }
    colorInput.value = color;
    setTextControlActive(
      colorInput,
      color.toLowerCase() !==
        _normalizeColorForInput(defaults.color, "#000000").toLowerCase(),
    );
  });

  // Update Bold/Italic states
  [
    document.getElementById("prop-bold"),
    document.getElementById("floating-text-bold"),
  ]
    .filter(Boolean)
    .forEach((boldBtn) => {
      boldBtn.classList.toggle("active", inline.fontWeight === "bold");
    });
  [
    document.getElementById("prop-italic"),
    document.getElementById("floating-text-italic"),
  ]
    .filter(Boolean)
    .forEach((italicBtn) => {
      italicBtn.classList.toggle("active", inline.fontStyle === "italic");
    });
}

// Global selection listener
let _selectionSyncTimeout = null;

window.selectElement = selectElement;
