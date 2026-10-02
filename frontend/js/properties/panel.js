// Properties panel shell: groups, fields, tabs and buildPropertiesPanel (per-type sections live in panels/).

let _propertiesPanelSelectionSignature = "";

let _propertiesPanelScrollTop = 0;

function createGroup(title) {
  const wrap = document.createElement("div");
  wrap.className = "prop-group";
  const header = document.createElement("div");
  header.className = "flex items-center justify-between cursor-pointer py-2";
  const titleEl = document.createElement("h3");
  titleEl.className = "prop-group-title m-0";
  titleEl.textContent = title;
  const chevron = document.createElement("i");
  chevron.className =
    "fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200";
  header.appendChild(titleEl);
  header.appendChild(chevron);
  const content = document.createElement("div");
  content.className = "space-y-3 pt-1 pb-2";

  header.onclick = () => {
    const isHidden = content.style.display === "none";
    content.style.display = isHidden ? "block" : "none";
    chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
  };

  wrap.appendChild(header);
  wrap.appendChild(content);

  // We override appendChild and innerHTML on 'wrap' so existing code seamlessly adds to 'content' instead of 'wrap'
  wrap._originalAppendChild = wrap.appendChild;
  wrap.appendChild = function (node) {
    if (node === header || node === content)
      return wrap._originalAppendChild(node);
    return content.appendChild(node);
  };
  Object.defineProperty(wrap, "innerHTML", {
    get() {
      return content.innerHTML;
    },
    set(html) {
      content.innerHTML = html;
    },
  });

  return wrap;
}

function createField(label, inputHTML) {
  const div = document.createElement("div");
  div.className = "flex flex-col gap-1";
  div.innerHTML = `<label class="text-xs font-bold text-slate-600 uppercase tracking-wide">${label}</label>${inputHTML}`;
  return div;
}

const PROPERTY_PANEL_TABS = [
  {
    id: "overview",
    label: "Base",
    icon: "fa-sliders",
    titles: new Set([
      "Selection",
      "Global Settings",
      "Master Slide",
    ]),
  },
  {
    id: "layout",
    label: "Layout",
    icon: "fa-table-cells-large",
    titles: new Set(["Slide Layout"]),
  },
  {
    id: "content",
    label: "Content",
    icon: "fa-pen-to-square",
    titles: new Set([
      "Text Content",
      "Lists",
      "Text Box",
      "Table",
      "Table Layout",
      "Video Settings",
      "Image",
      "Drawing",
      "HTML Embed",
      "Mermaid Diagram",
      "PDF Embed",
      "Molecule Viewer",
      "Equation",
      "Sketch Tools",
    ]),
  },
  {
    id: "style",
    label: "Style",
    icon: "fa-palette",
    titles: new Set([
      "Layers & Appearance",
      "Shared Style",
      "Shared Text Style",
      "Shared Text Styles",
      "Typography",
      "Table Text",
      "Table Style",
      "Chart Style",
      "Shape",
      "Connector",
      "Appearance",
      "Slide Background",
    ]),
  },
  {
    id: "motion",
    label: "Motion",
    icon: "fa-play",
    match: (title) => /animation|motion|timeline|transition/i.test(title),
  },
  {
    id: "notes",
    label: "Notes",
    icon: "fa-note-sticky",
    titles: new Set(["Slide Notes"]),
  },
];

let _propertiesPanelActiveTab = "overview";

function getPropertyGroupTitle(group) {
  return (
    group
      ?.querySelector?.(".prop-group-title")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() || ""
  );
}

function getPropertyTabForGroup(group) {
  const title = getPropertyGroupTitle(group);
  return (
    PROPERTY_PANEL_TABS.find((tab) => tab.titles?.has(title) || tab.match?.(title))
      ?.id || "content"
  );
}

function organizePropertiesPanelTabs(panel) {
  if (!panel || panel.dataset.tabularProperties === "true") return;
  const groups = Array.from(panel.children).filter((child) =>
    child.classList?.contains("prop-group"),
  );
  if (groups.length < 2) return;

  const populatedTabs = PROPERTY_PANEL_TABS.map((tab) => ({
    ...tab,
    groups: groups.filter((group) => getPropertyTabForGroup(group) === tab.id),
  })).filter((tab) => tab.groups.length);

  if (!populatedTabs.length) return;
  if (!populatedTabs.some((tab) => tab.id === _propertiesPanelActiveTab)) {
    _propertiesPanelActiveTab = populatedTabs[0].id;
  }

  const tabs = document.createElement("div");
  tabs.className = "properties-tabbar";
  tabs.setAttribute("role", "tablist");

  const body = document.createElement("div");
  body.className = "properties-tabbody";

  populatedTabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "properties-tab";
    button.dataset.propertiesTab = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute(
      "aria-selected",
      tab.id === _propertiesPanelActiveTab ? "true" : "false",
    );
    button.innerHTML = `
      <i class="fa-solid ${tab.icon}" aria-hidden="true"></i>
      <span>${tab.label}</span>
    `;
    button.onclick = () => {
      _propertiesPanelActiveTab = tab.id;
      _propertiesPanelScrollTop = 0;
      buildPropertiesPanel();
      requestAnimationFrame(() => {
        const content = document.getElementById("properties-content");
        if (content) content.scrollTop = 0;
      });
    };
    tabs.appendChild(button);

    const pane = document.createElement("div");
    pane.className = "properties-tabpane";
    pane.dataset.propertiesPane = tab.id;
    pane.hidden = tab.id !== _propertiesPanelActiveTab;
    pane.setAttribute("role", "tabpanel");
    tab.groups.forEach((group) => pane.appendChild(group));
    body.appendChild(pane);
  });

  panel.innerHTML = "";
  panel.dataset.tabularProperties = "true";
  panel.appendChild(tabs);
  panel.appendChild(body);
}

// Position, size and turn of one object, typed in exactly (they could only be set by dragging).
function _buildGeometryFields(el) {
  if (!el) return "";
  const isConnector = el.type === "connector";
  const autoHeight = String(el.height).trim() === "auto";
  const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find((n) => !n.closest("#slide-previews"));
  const shownHeight = autoHeight ? Math.round(node?.offsetHeight || 0) : Math.round(parseFloat(el.height) || 0);
  const field = (id, label, value, extra = "", wide = false) =>
    `<label class="prop-geometry-field${wide ? " prop-geometry-field-wide" : ""}"><span>${label}</span><input type="number" id="${id}" class="prop-input-sm" value="${value}" step="1" ${extra}></label>`;
  return `
        <div class="prop-geometry-grid mb-3">
            ${field("prop-geom-x", "X", Math.round(Number(el.x) || 0))}
            ${field("prop-geom-y", "Y", Math.round(Number(el.y) || 0))}
            ${isConnector ? "" : field("prop-geom-w", "W", Math.round(parseFloat(el.width) || 0), 'min="4"')}
            ${isConnector ? "" : field("prop-geom-h", "H", shownHeight, autoHeight ? 'min="4" disabled title="Grows with its text"' : 'min="4"')}
            ${isConnector ? "" : field("prop-geom-rot", "Rotation °", Math.round(Number(el.rotation) || 0), 'min="-360" max="360"', true)}
        </div>`;
}

function _bindGeometryFields() {
  const id = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
  if (!id) return;
  const apply = () => {
    const el = state.slides[currentSlideIndex]?.elements.find((e) => e.id === id);
    if (!el) return;
    const read = (fieldId) => {
      const input = document.getElementById(fieldId);
      if (!input || input.disabled || input.value === "") return null;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : null;
    };
    const updates = {};
    const x = read("prop-geom-x");
    const y = read("prop-geom-y");
    const w = read("prop-geom-w");
    const h = read("prop-geom-h");
    const rot = read("prop-geom-rot");
    if (x !== null && x !== Number(el.x)) updates.x = x;
    if (y !== null && y !== Number(el.y)) updates.y = y;
    if (w !== null && w >= 4 && w !== Math.round(parseFloat(el.width))) {
      updates.width = `${w}px`;
      // A picture that keeps its proportions follows a new width with its height.
      if (el.lockAspectRatio && parseFloat(el.width) > 0 && parseFloat(el.height) > 0) {
        updates.height = `${Math.round((w * parseFloat(el.height)) / parseFloat(el.width))}px`;
      }
    }
    if (h !== null && h >= 4 && h !== Math.round(parseFloat(el.height)) && !updates.height) updates.height = `${h}px`;
    if (rot !== null && rot !== (Number(el.rotation) || 0)) updates.rotation = rot;
    if (!Object.keys(updates).length) return;
    saveStateToUndo();
    updateElementState(id, updates);
    renderSlidesFromState();
    updateGroupBound?.();
    refreshPreviews?.();
    schedulePresentationAutosave?.(150);
  };
  ["prop-geom-x", "prop-geom-y", "prop-geom-w", "prop-geom-h", "prop-geom-rot"].forEach((fieldId) => {
    const input = document.getElementById(fieldId);
    if (!input) return;
    input.addEventListener("change", apply);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });
}

let _propertiesPanelBuildGeneration = 0;

// A choice in a panel dropdown rebuilds the panel; the control that had focus keeps it (same id in the new panel),
// so the arrow keys and Tab carry on from it. Focus fell to the page, and the dropdown seemed to reset.
let _propertiesPanelHadSelection = null; // whether the last build showed a selection (null before the first)

function buildPropertiesPanel() {
  const panel = document.getElementById("properties-content");
  const active = document.activeElement;
  const focusedId = panel && active && active !== panel && panel.contains(active) && active.id ? active.id : "";
  _buildPropertiesPanelNow();
  if (!focusedId || document.activeElement === active) return;
  const again = document.getElementById(focusedId);
  if (again && panel.contains(again) && again.offsetParent !== null) again.focus({ preventScroll: true });
}

function _buildPropertiesPanelNow() {
  if (typeof renderLayersList === "function") renderLayersList();
  const panel = document.getElementById("properties-content");
  if (!panel) return;

  // Attach a persistent scroll tracker the first time — avoids reading a
  // stale scrollTop of 0 after innerHTML has already been cleared.
  if (!panel._sfScrollTracked) {
    panel._sfScrollTracked = true;
    panel.addEventListener(
      "scroll",
      () => {
        _propertiesPanelScrollTop = panel.scrollTop;
      },
      { passive: true },
    );
  }

  // Skip full rebuild while the user is actively typing or dragging a panel
  // control (INPUT or TEXTAREA). SELECT changes are discrete commits and
  // should always trigger a rebuild so the panel reflects the new choice.
  const active = document.activeElement;
  const isInteractingWithPanelControl =
    active &&
    panel.contains(active) &&
    (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
  if (isInteractingWithPanelControl) return;

  const selectionSignature = `${currentSlideIndex}:${state.selectedIds.join("|")}`;
  const shouldRestoreScroll =
    _propertiesPanelSelectionSignature === selectionSignature;
  _propertiesPanelSelectionSignature = selectionSignature;
  // Going from one slide to another with nothing selected keeps the tab (Layout stays Layout while slides are
  // added from it); it used to jump back to Base on every new slide.
  const hadSelection = _propertiesPanelHadSelection;
  _propertiesPanelHadSelection = state.selectedIds.length > 0;
  if (!shouldRestoreScroll) {
    if (!state.selectedIds.length) {
      if (hadSelection !== false) _propertiesPanelActiveTab = "overview";
    } else if (_propertiesPanelActiveTab === "overview") {
      _propertiesPanelActiveTab = "content";
    }
  }
  // Use the persistently-tracked value — never the DOM value, which may
  // already be 0 if a prior rebuild has already cleared innerHTML.
  const scrollToRestore = shouldRestoreScroll ? _propertiesPanelScrollTop : 0;
  if (!shouldRestoreScroll) _propertiesPanelScrollTop = 0;

  const restorePropertiesScroll = () => {
    if (!shouldRestoreScroll || scrollToRestore <= 0) return;
    // Double-RAF: first frame for DOM paint, second for layout settle.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.scrollTop = scrollToRestore;
      });
    });
  };

  panel.innerHTML = "";
  delete panel.dataset.tabularProperties;
  updateFloatingToolbars();

  if (
    document.body.classList.contains("whiteboard-mode-active") &&
    typeof window.renderWhiteboardPropertiesPanel === "function"
  ) {
    window.renderWhiteboardPropertiesPanel(panel);
    restorePropertiesScroll();
    return;
  }

  if (state.selectedIds.length === 0) {
    _buildSlideWorkspacePanel(panel);
    organizePropertiesPanelTabs(panel);
    restorePropertiesScroll();
    return;
  }

  const onCommit = (cb) => {
    saveStateToUndo();
    cb();
    if (window.refreshPreviews) window.refreshPreviews();
  };

  // Selection / Grouping Section
  const selGrp = createGroup("Selection");
  const isGrouped =
    state.selectedIds.length > 1 &&
    state.slides[currentSlideIndex].elements
      .filter((e) => state.selectedIds.includes(e.id))
      .every(
        (e) =>
          e.groupId &&
          e.groupId ===
            state.slides[currentSlideIndex].elements.find(
              (x) => x.id === state.selectedIds[0],
            ).groupId,
      );

  const isSingle = state.selectedIds.length === 1;
  const selectedElements = state.slides[currentSlideIndex].elements.filter((e) => state.selectedIds.includes(e.id));
  // Grouping needs two or more objects that are not already one group; ungrouping needs a group.
  const canGroup = state.selectedIds.length > 1 && !isGrouped;
  const canUngroup = selectedElements.some((e) => e.groupId);
  selGrp.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-bold text-slate-700 uppercase tracking-widest">${state.selectedIds.length} Object${isSingle ? "" : "s"}</h3>
            ${!isSingle ? `<span class="text-[10px] text-accent font-bold px-2 py-0.5 rounded bg-accent/10 border border-accent/20">${isGrouped ? "GROUPED" : "MULTIPLE"}</span>` : ""}
        </div>
        ${
          !isSingle
            ? `
        <div class="grid grid-cols-6 gap-1 mb-3 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <button class="prop-align-btn" onclick="alignSelection('left')" title="Align Left"><i class="fa-solid fa-align-left text-xs"></i></button>
            <button class="prop-align-btn" onclick="alignSelection('center')" title="Align Center"><i class="fa-solid fa-align-center text-xs"></i></button>
            <button class="prop-align-btn" onclick="alignSelection('right')" title="Align Right"><i class="fa-solid fa-align-right text-xs"></i></button>
            <button class="prop-align-btn" onclick="alignSelection('top')" title="Align Top"><i class="fa-solid fa-align-left rotate-90 text-xs"></i></button>
            <button class="prop-align-btn" onclick="alignSelection('middle')" title="Align Middle"><i class="fa-solid fa-align-center rotate-90 text-xs"></i></button>
            <button class="prop-align-btn" onclick="alignSelection('bottom')" title="Align Bottom"><i class="fa-solid fa-align-right rotate-90 text-xs"></i></button>
        </div>
        `
            : ""
        }
        ${isSingle ? _buildGeometryFields(state.slides[currentSlideIndex].elements.find((e) => e.id === state.selectedIds[0])) : ""}
        <div class="flex gap-2">
            <button id="prop-group" class="prop-action-btn prop-action-primary flex-1" ${canGroup ? "" : "disabled"} title="${canGroup ? "Group the selected objects" : "Select two or more objects to group them"}">
                <i class="fa-solid fa-object-group"></i> GROUP
            </button>
            <button id="prop-ungroup" class="prop-action-btn prop-action-secondary flex-1" ${canUngroup ? "" : "disabled"}>
                <i class="fa-solid fa-object-ungroup"></i> UNGROUP
            </button>
        </div>
    `;
  panel.appendChild(selGrp);

  const data = getSelectedElementData();

  // ── LAYERS & APPEARANCE (Common to all) ──────────────────────────
  if (data) {
    const layerGrp = createGroup("Layers & Appearance");

    // Flex row for Background and Opacity Label
    const bgOpacityRow = document.createElement("div");
    bgOpacityRow.className = "flex items-end gap-3";

    // Background Color (if not image)
    if (data.type !== "image") {
      const bgField = createField(
        "Fill",
        `<input type="color" id="prop-bg" class="w-12 h-7 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(data.styles.backgroundColor, "#000000")}">`,
      );
      bgOpacityRow.appendChild(bgField);
    }

    // Opacity Slider (More compact)
    const opacityVal = Math.round(parseFloat(data.styles.opacity ?? 1) * 100);
    const opField = document.createElement("div");
    opField.className = "flex-1 flex flex-col gap-1";
    opField.innerHTML = `
            <div class="flex items-center justify-between">
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Opacity</label>
                <span id="prop-op-label" class="text-[10px] font-mono text-slate-500">${opacityVal}%</span>
            </div>
            <input type="range" id="prop-op" min="0" max="100" step="1" value="${opacityVal}" class="h-1.5 accent-primary cursor-pointer">
        `;
    bgOpacityRow.appendChild(opField);
    layerGrp.appendChild(bgOpacityRow);

    appendElementOutlineControls(layerGrp, data);

    // Z-Index Row
    const zVal = data.styles?.zIndex ?? 1;
    const zRow = document.createElement("div");
    zRow.className = "flex items-center gap-2 mt-2";
    zRow.innerHTML = `
            <div class="flex-1">
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1 block">Layer Order (Z)</label>
                <input type="number" id="prop-zindex" class="w-full text-xs" value="${escapeHtml(String(zVal))}" min="0" max="9999">
            </div>
            <div class="flex gap-1 pt-4">
                <button id="prop-zindex-front" class="p-2 rounded bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200" title="Bring to Front">
                    <i class="fa-solid fa-angles-up text-[10px]"></i>
                </button>
                <button id="prop-zindex-back" class="p-2 rounded bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200" title="Send to Back">
                    <i class="fa-solid fa-angles-down text-[10px]"></i>
                </button>
            </div>
        `;
    layerGrp.appendChild(zRow);
    panel.appendChild(layerGrp);
  }

  if (!data && state.selectedIds.length > 1) {
    buildMultiSelectionPanel(panel);
  }

  if (data) {
    if (data.type === "text") {
      buildTextPanel(panel, data);
    }

    if (data.type === "shape") {
      buildShapePanel(panel, data);
    }

    if (data.type === "table") {
      buildTablePanel(panel, data);
    }

    if (data.type === "connector") {
      buildConnectorPanel(panel, data);
    }

    const appGrp = createGroup("Appearance");
    // We moved most of this to the top "Layers & Appearance" group.
    // This group can be used for type-specific appearance if needed, or removed.
    // For now, keep this group for type-specific controls.
    if (data.type === "video") {
      buildVideoPanel(panel, data);
    }

    if (data.type === "image") {
      buildImagePanel(panel, data);
    }

    if (data.type === "html") {
      const embedGrp = createGroup("HTML Embed");
      embedGrp.innerHTML += `
                <button id="prop-html-toggle" class="w-full py-2 rounded bg-gray-900 border border-gray-700 text-xs text-gray-200 mb-2">
                    ${data.htmlInteractive ? "Disable Editor Interaction" : "Enable Editor Interaction"}
                </button>
                <div class="flex flex-col gap-1.5 mb-2">
                    <label class="text-xs font-medium text-gray-400">Mode</label>
                    <select id="prop-html-mode" class="w-full">
                        <option value="responsive" ${normalizeHtmlMode(data) === "responsive" ? "selected" : ""}>Responsive</option>
                        <option value="autofit" ${normalizeHtmlMode(data) === "autofit" ? "selected" : ""}>Autofit Content</option>
                    </select>
                </div>
                <button id="prop-html-fit" class="w-full py-2 rounded bg-accent/20 border border-accent/40 text-xs text-accent font-semibold">
                    Autofit To Full Slide
                </button>
            `;
      panel.appendChild(embedGrp);
    }

    if (data.type === "mermaid") {
      buildMermaidPanel(panel, data);
    }

    if (data.type === "pdf") {
      buildPdfPanel(panel, data);
    }

    if (data.type === "molecule") {
      buildMoleculePanel(panel, data);
    }

    if (data.type === "equation") {
      buildEquationPanel(panel, data);
    }

    if (data.type === "chart" && typeof buildChartPanel === "function") {
      buildChartPanel(panel, data);
    }

    if (data.type === "sketch") {
      buildSketchPanel(panel, data);
    }

    if (typeof buildAnimationInspectorPanel === "function") {
      // A titled group, so it gets the Motion tab: loose markup was dropped when the panel was split into tabs,
      // which left objects with no way to add an animation from the panel.
      const animationGroup = createGroup("Animation");
      animationGroup.innerHTML = buildAnimationInspectorPanel(data);
      panel.appendChild(animationGroup);
    }
  }

  {
    const slide = state.slides[currentSlideIndex] || {
      notes: "",
      elements: [],
    };
    const notesGrp = createGroup("Slide Notes");
    notesGrp.innerHTML += `
            <div class="space-y-2">
                <textarea id="prop-slide-notes" class="w-full min-h-[120px] text-xs leading-5" placeholder="Presenter notes for this slide...">${escapeHtml(slide.notes || "")}</textarea>
                <div class="text-xs text-slate-600">Notes are saved with the slide and used in presenter view only.</div>
            </div>
        `;
    panel.appendChild(notesGrp);
  }

  organizePropertiesPanelTabs(panel);

  // Listeners. Only the latest build binds: several builds in a row each queued a bind on the same final DOM,
  // so addEventListener handlers ran once per build (one "Add row" click added three rows).
  const buildGeneration = ++_propertiesPanelBuildGeneration;
  setTimeout(() => {
    if (buildGeneration !== _propertiesPanelBuildGeneration) return;
    const btnGroup = document.getElementById("prop-group");
    const btnUngroup = document.getElementById("prop-ungroup");
    if (btnGroup) btnGroup.onclick = groupSelected;
    if (btnUngroup) btnUngroup.onclick = ungroupSelected;
    _bindGeometryFields();

    const sharedColor = document.getElementById("prop-shared-color");
    if (sharedColor) {
      bindUndoableContinuousInput(sharedColor, (e) => {
        state.selectedIds.forEach((id) => {
          updateElementStyleState(id, { backgroundColor: e.target.value });
          document.getElementById(id).style.backgroundColor = e.target.value;
        });
      });
    }

    document
      .querySelectorAll("#prop-shared-text-align [data-align]")
      .forEach((button) => {
        button.onclick = () =>
          applyTextAlignmentToSelection(button.dataset.align);
      });

    const sharedTextFont = document.getElementById("prop-shared-text-font");
    if (sharedTextFont) {
      sharedTextFont.onchange = (e) => {
        if (!e.target.value) return;
        applyStyleAndRefresh("fontFamily", e.target.value);
      };
    }

    const sharedTextSize = document.getElementById("prop-shared-text-size");
    if (sharedTextSize) {
      const commitSharedTextSize = () => {
        const raw = String(sharedTextSize.value || "").trim();
        if (!raw) return;
        const next = _normalizePx(raw, "32px");
        applyStyleAndRefresh("fontSize", next);
      };
      sharedTextSize.onchange = commitSharedTextSize;
      sharedTextSize.onblur = commitSharedTextSize;
    }

    const sharedTextColor = document.getElementById("prop-shared-text-color");
    if (sharedTextColor) {
      sharedTextColor.oninput = (e) => applyStyle("color", e.target.value);
      sharedTextColor.onchange = () => buildPropertiesPanel();
    }

    document
      .querySelectorAll("#prop-shared-text-style [data-prop]")
      .forEach((button) => {
        button.onclick = () => {
          const prop = button.dataset.prop;
          const active = button.dataset.active === "true";
          const value =
            prop === "fontWeight"
              ? active
                ? "400"
                : "700"
              : prop === "fontStyle"
                ? active
                  ? "normal"
                  : "italic"
                : active
                  ? "none"
                  : "underline";
          applyStyleAndRefresh(prop, value);
        };
      });

    const slideNotes = document.getElementById("prop-slide-notes");
    if (slideNotes) {
      let lastNotesValue = slideNotes.value;
      slideNotes.oninput = (e) => {
        updateCurrentSlideNotes(e.target.value);
      };
      slideNotes.onchange = (e) => {
        if (e.target.value === lastNotesValue) return;
        saveStateToUndo();
        updateCurrentSlideNotes(e.target.value);
        lastNotesValue = e.target.value;
      };
    }

    if (data) {
      const bg = document.getElementById("prop-bg");
      if (bg) bg.oninput = (e) => applyStyle("backgroundColor", e.target.value);

      const op = document.getElementById("prop-op");
      const opLabel = document.getElementById("prop-op-label");
      if (op) {
        op.oninput = (e) => {
          const pct = Number(e.target.value);
          const val = Math.max(0, Math.min(100, pct)) / 100;
          if (opLabel) opLabel.textContent = `${Math.round(pct)}%`;
          applyStyle("opacity", String(val));
        };
      }

      const zIndexInput = document.getElementById("prop-zindex");
      if (zIndexInput) {
        const applyZIndex = () => {
          const val = parseInt(zIndexInput.value) || 0;
          applyStyle("zIndex", String(val));
          const dom = document.getElementById(data.id);
          if (dom) dom.style.zIndex = val;
        };
        zIndexInput.onchange = applyZIndex;
        zIndexInput.onblur = applyZIndex;
      }

      const frontBtn = document.getElementById("prop-zindex-front");
      if (frontBtn) {
        frontBtn.onclick = () => {
          // Find max zIndex on this slide and go one above
          const els = state.slides[currentSlideIndex]?.elements || [];
          const maxZ = els.reduce(
            (m, e) => Math.max(m, e.styles?.zIndex || 0),
            0,
          );
          const newZ = maxZ + 1;
          applyStyle("zIndex", String(newZ));
          const dom = document.getElementById(data.id);
          if (dom) dom.style.zIndex = newZ;
          if (zIndexInput) zIndexInput.value = newZ;
        };
      }

      const backBtn = document.getElementById("prop-zindex-back");
      if (backBtn) {
        backBtn.onclick = () => {
          applyStyle("zIndex", "0");
          const dom = document.getElementById(data.id);
          if (dom) dom.style.zIndex = 0;
          if (zIndexInput) zIndexInput.value = 0;
        };
      }

      bindElementOutlineControls(data);

      if (data.type === "text") {
        // Listeners are now handled within buildTextPanel(panel, data)
        // in js/properties/panels/text.js
      }

      if (data.type === "shape") {
        bindShapePanel(data, onCommit);
      }

      if (data.type === "table") {
        bindTablePanel(data);
      }

      if (data.type === "connector") {
        bindConnectorPanel(data, onCommit);
      }

      if (data.type === "image") {
        bindImagePanel(data, onCommit);
      }

      if (data.type === "html") {
        bindHtmlPanel(data, onCommit);
      }

      if (data.type === "mermaid") {
        bindMermaidPanel(data, onCommit);
      }

      if (data.type === "molecule") {
        bindMoleculePanel(data, onCommit);
      }

      if (data.type === "equation") {
        bindEquationPanel(data, onCommit);
      }

      if (data.type === "sketch") {
        bindSketchPanel(data);
      }

      if (data.type === "pdf") {
        bindPdfPanel(data, onCommit);
      }

      if (typeof bindAnimationPanelListeners === "function") {
        bindAnimationPanelListeners(data);
      }

      if (data.type === "video") {
        bindVideoPanel(data, onCommit);
      }
    }
  }, 0);

  restorePropertiesScroll();
  requestAnimationFrame(updateFloatingToolbars);
}

function buildMultiSelectionPanel(panel) {
  const elements = state.selectedIds
    .map((id) =>
      state.slides[currentSlideIndex].elements.find((e) => e.id === id),
    )
    .filter(Boolean);
  const allShapes = elements.every((e) => e.type === "shape");
  const allText = elements.every((e) => e.type === "text");
  const textElements = elements.filter((e) => e.type === "text");
  if (allShapes || allText) {
    const firstColor = _normalizeColorForInput(
      elements[0]?.styles?.backgroundColor,
      "#6366f1",
    );
    const styleGrp = createGroup("Shared Style");
    styleGrp.appendChild(
      createField(
        "Color",
        `<input type="color" id="prop-shared-color" class="w-full h-8 rounded border border-slate-300 cursor-pointer" value="${firstColor}">`,
      ),
    );
    panel.appendChild(styleGrp);
  }

  if (textElements.length) {
    const firstAlign = textElements[0]?.styles?.textAlign || "left";
    const sharedAlign = textElements.every(
      (e) => (e.styles?.textAlign || "left") === firstAlign,
    )
      ? firstAlign
      : "";
    const firstFont =
      textElements[0]?.styles?.fontFamily ||
      getThemeTextStyleDefaults().fontFamily;
    const sharedFont = textElements.every(
      (e) =>
        normalizeFontFamily(e.styles?.fontFamily) ===
        normalizeFontFamily(firstFont),
    )
      ? firstFont
      : "";
    const firstSize =
      textElements[0]?.styles?.fontSize ||
      getThemeTextStyleDefaults().fontSize;
    const sharedSize = textElements.every(
      (e) =>
        (e.styles?.fontSize || getThemeTextStyleDefaults().fontSize) ===
        firstSize,
    )
      ? firstSize
      : "";
    const firstTextColor =
      textElements[0]?.styles?.color || getThemeTextStyleDefaults().color;
    const sharedTextColor = textElements.every(
      (e) =>
        _normalizeColorForInput(e.styles?.color, "#000000").toLowerCase() ===
        _normalizeColorForInput(firstTextColor, "#000000").toLowerCase(),
    )
      ? firstTextColor
      : "#172033";
    const allBold = textElements.every((e) =>
      ["700", "bold"].includes(
        String(e.styles?.fontWeight || "").toLowerCase(),
      ),
    );
    const allItalic = textElements.every(
      (e) => e.styles?.fontStyle === "italic",
    );
    const allUnderline = textElements.every((e) =>
      String(e.styles?.textDecoration || "").includes("underline"),
    );
    const textStyleGrp = createGroup(
      textElements.length === elements.length
        ? "Shared Text Style"
        : "Text in Group",
    );
    textStyleGrp.appendChild(
      createField(
        "Font",
        `<select id="prop-shared-text-font" class="prop-select">
                        <option value="" ${sharedFont ? "" : "selected"}>Mixed</option>
                        ${buildFontOptions(sharedFont || firstFont)}
                    </select>`,
      ),
    );
    textStyleGrp.appendChild(
      createField(
        "Size / Color",
        `<div class="grid grid-cols-[1fr_44px] gap-2">
                        <input type="text" id="prop-shared-text-size" class="prop-input-sm" value="${sharedSize ? parseInt(sharedSize) || "" : ""}" placeholder="Mixed">
                        <input type="color" id="prop-shared-text-color" class="w-11 h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(sharedTextColor, "#172033")}">
                    </div>`,
      ),
    );
    textStyleGrp.appendChild(
      createField(
        "Style",
        `<div class="prop-btn-group" id="prop-shared-text-style">
                        <button type="button" class="prop-btn ${allBold ? "active" : ""}" data-prop="fontWeight" data-active="${allBold}" title="Bold"><i class="fa-solid fa-bold"></i></button>
                        <button type="button" class="prop-btn ${allItalic ? "active" : ""}" data-prop="fontStyle" data-active="${allItalic}" title="Italic"><i class="fa-solid fa-italic"></i></button>
                        <button type="button" class="prop-btn ${allUnderline ? "active" : ""}" data-prop="textDecoration" data-active="${allUnderline}" title="Underline"><i class="fa-solid fa-underline"></i></button>
                    </div>`,
      ),
    );
    textStyleGrp.appendChild(
      createField(
        "Alignment",
        `<div class="prop-btn-group" id="prop-shared-text-align">
                        ${["left", "center", "right", "justify"]
                          .map(
                            (
                              align,
                            ) => `<button type="button" class="prop-btn ${sharedAlign === align ? "active" : ""}" data-align="${align}" title="${align.charAt(0).toUpperCase() + align.slice(1)}">
                                    <i class="fa-solid fa-align-${align === "justify" ? "justify" : align}"></i>
                                </button>`,
                          )
                          .join("")}
                    </div>`,
      ),
    );
    panel.appendChild(textStyleGrp);
  }
}

window.buildPropertiesPanel = buildPropertiesPanel;
