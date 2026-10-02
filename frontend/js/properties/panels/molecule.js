// Properties panel section for molecule (NGL) elements.

function buildMoleculePanel(panel, data) {
  const moleculeGrp = createGroup("Molecule Viewer");
  const moleculeName = String(data.moleculeName || "Molecule").replace(
    /"/g,
    "&quot;",
  );
  const moleculeBackground =
    typeof normalizeMoleculeBackgroundColor === "function"
      ? normalizeMoleculeBackgroundColor(
          data.styles?.backgroundColor || "#020617",
        )
      : data.styles?.backgroundColor || "#020617";
  const moleculeBackgroundInput = _normalizeColorForInput(
    moleculeBackground,
    "#020617",
  );
  const moleculeBackgroundTransparent =
    moleculeBackground === "transparent";
  const moleculeLayers = (
    Array.isArray(data.moleculeRepresentationLayers)
      ? data.moleculeRepresentationLayers
      : []
  )
    .map((layer) =>
      typeof normalizeMoleculeRepresentationLayer === "function"
        ? normalizeMoleculeRepresentationLayer(layer)
        : layer,
    )
    .slice(0, 12);
  moleculeGrp.innerHTML += `
                <div class="flex flex-col gap-2 mb-3">
                    <input type="text" id="prop-molecule-name" class="w-full text-xs" value="${moleculeName}" placeholder="Molecule name">
                    <button onclick="document.getElementById('molecule-file-upload').click()" class="w-full py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold">
                        Replace PDB / Trajectory
                    </button>
                    ${
                      data.moleculeTrajectory?.url
                        ? `<div class="molecule-layer-row w-full flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                        <i class="fa-solid fa-film text-[11px] text-slate-500"></i>
                        <span class="min-w-0 flex-1 truncate text-[11px] text-slate-700" title="${escapeHtml(data.moleculeTrajectory.name || "Trajectory")}">${escapeHtml(data.moleculeTrajectory.name || "Trajectory")}</span>
                        <button id="prop-molecule-remove-trajectory" class="text-[13px] text-red-500 hover:text-red-600" title="Remove the trajectory" aria-label="Remove the trajectory">×</button>
                    </div>`
                        : `<button id="prop-molecule-add-trajectory" onclick="document.getElementById('molecule-trajectory-upload').click()" class="w-full py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold" title="Play an MD trajectory over this structure (same atoms, same order)">
                        <i class="fa-solid fa-film mr-1"></i> Add trajectory (.xtc, .trr, .dcd, .nc)
                    </button>`
                    }
                </div>
                <button id="prop-molecule-toggle" class="w-full py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold mb-2">
                    ${data.moleculeInteractive ? '<i class="fa-solid fa-cube mr-1"></i> Drag rotates the molecule' : '<i class="fa-solid fa-up-down-left-right mr-1"></i> Drag moves the box'}
                </button>
                <div class="grid grid-cols-[1fr_auto] items-end gap-2 mb-2">
                    <label class="flex flex-col gap-1 text-[11px] text-slate-500">
                        Background
                        <input id="prop-molecule-bg" type="color" class="w-full h-8 rounded bg-transparent" value="${moleculeBackgroundInput}" ${moleculeBackgroundTransparent ? "disabled" : ""}>
                    </label>
                    <label class="flex items-center gap-2 h-8 px-2 rounded border border-slate-300 bg-white text-[11px] text-slate-700">
                        <input id="prop-molecule-bg-transparent" type="checkbox" ${moleculeBackgroundTransparent ? "checked" : ""}>
                        Transparent
                    </label>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <label class="flex flex-col gap-1 text-[11px] text-slate-500">
                        Style
                        <select id="prop-molecule-style" class="w-full text-xs">
                            <option value="cartoon" ${data.moleculeDefaultStyle === "cartoon" ? "selected" : ""}>Cartoon</option>
                            <option value="stick" ${data.moleculeDefaultStyle === "stick" ? "selected" : ""}>Stick</option>
                            <option value="sphere" ${data.moleculeDefaultStyle === "sphere" ? "selected" : ""}>Sphere</option>
                            <option value="line" ${data.moleculeDefaultStyle === "line" ? "selected" : ""}>Line</option>
                            <option value="surface" ${data.moleculeDefaultStyle === "surface" ? "selected" : ""}>Surface</option>
                        </select>
                    </label>
                    <label class="flex flex-col gap-1 text-[11px] text-slate-500">
                        Color
                        <select id="prop-molecule-color" class="w-full text-xs">
                            <option value="spectrum" ${data.moleculeDefaultColor === "spectrum" ? "selected" : ""}>Spectrum</option>
                            <option value="default" ${data.moleculeDefaultColor === "default" ? "selected" : ""}>Element</option>
                            <option value="chain" ${data.moleculeDefaultColor === "chain" ? "selected" : ""}>Chain</option>
                            <option value="amino" ${data.moleculeDefaultColor === "amino" ? "selected" : ""}>Residue</option>
                            <option value="ssJmol" ${data.moleculeDefaultColor === "ssJmol" ? "selected" : ""}>SS Jmol</option>
                        </select>
                    </label>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <label class="flex items-center gap-2 h-8 px-2 rounded border border-slate-300 bg-white text-[11px] text-slate-700" title="Atoms further away fade into the background">
                        <input id="prop-molecule-depth-cue" type="checkbox" ${data.moleculeDepthCue !== false ? "checked" : ""}>
                        Depth cue
                    </label>
                    <button id="prop-molecule-reset-view" class="py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold" title="Fit the whole molecule in the box, as when it was loaded (double-click on the molecule does the same)">
                        <i class="fa-solid fa-arrows-to-dot mr-1"></i> Reset view
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button id="prop-molecule-rotate" class="py-2 rounded border text-xs font-semibold ${data.moleculeAutoRotate ? "bg-primary border-primary text-white" : "border-slate-300 bg-white text-slate-700"}">${data.moleculeAutoRotate ? "Auto-rotate: on" : "Auto-rotate: off"}</button>
                    <button id="prop-molecule-projection" class="py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold">
                        ${data.moleculeProjection === "orthographic" ? "View: orthographic" : "View: perspective"}
                    </button>
                </div>
                <div class="mt-3 pt-3 border-t border-slate-200 space-y-2">
                    <div class="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Representation Layer</div>
                    <input type="hidden" id="prop-molecule-layer-edit-id" value="">
                    <input type="text" id="prop-molecule-layer-selection" class="w-full text-xs" value="all" placeholder="all, protein, ligand, chain A, resi 42">
                    <div class="grid grid-cols-2 gap-2">
                        <select id="prop-molecule-layer-style" class="w-full text-xs">
                            <option value="cartoon">Cartoon</option>
                            <option value="stick">Stick</option>
                            <option value="sphere">Sphere</option>
                            <option value="line">Line</option>
                            <option value="surface">Surface</option>
                            <option value="hidden">Hidden</option>
                        </select>
                        <select id="prop-molecule-layer-color" class="w-full text-xs">
                            <option value="spectrum">Spectrum</option>
                            <option value="default">Element</option>
                            <option value="chain">Chain</option>
                            <option value="amino">Residue</option>
                            <option value="ssJmol">SS Jmol</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <label class="flex flex-col gap-1 text-[11px] text-slate-500">
                            Size
                            <input type="number" id="prop-molecule-layer-radius" class="w-full text-xs" min="0.01" max="5" step="0.05" value="1">
                        </label>
                        <label class="flex flex-col gap-1 text-[11px] text-slate-500">
                            Opacity
                            <input type="number" id="prop-molecule-layer-opacity" class="w-full text-xs" min="0.02" max="1" step="0.01" value="0.68">
                        </label>
                    </div>
                    <input type="color" id="prop-molecule-layer-custom" class="w-full h-8 rounded bg-transparent" value="#6366f1">
                    <div class="grid grid-cols-[1fr_auto] gap-2">
                        <button id="prop-molecule-add-layer" class="py-2 rounded bg-accent/20 border border-accent/40 text-xs text-accent font-semibold">
                            Add Layer
                        </button>
                        <button id="prop-molecule-cancel-layer-edit" class="hidden px-3 py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold">
                            Cancel
                        </button>
                    </div>
                </div>
                <div class="mt-3 space-y-1">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Saved Layers</span>
                        <button id="prop-molecule-clear-layers" class="text-[11px] text-slate-500 hover:text-red-400" ${moleculeLayers.length ? "" : "disabled"}>Clear</button>
                    </div>
                    <div id="prop-molecule-layer-list" class="space-y-1">
                        ${
                          moleculeLayers.length
                            ? moleculeLayers
                                .map((layer) => {
                                  const layerLabel =
                                    typeof escapeHtml === "function"
                                      ? escapeHtml(layer.label || "Layer")
                                      : String(layer.label || "Layer");
                                  const layerTitle = String(
                                    layer.label || "Layer",
                                  ).replace(/"/g, "&quot;");
                                  return `
                            <div class="molecule-layer-row flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                <span class="w-2 h-2 rounded-full shrink-0" style="background:${layer.kind === "hidden" ? "#94a3b8" : layer.colorScheme === "custom" ? layer.customColor : "var(--editor-accent, #6366f1)"}"></span>
                                <span class="min-w-0 flex-1 truncate text-[11px] text-slate-700" title="${layerTitle}">${layerLabel}</span>
                                <button class="prop-molecule-edit-layer text-[11px] font-semibold text-slate-600 hover:text-primary" data-layer-id="${escapeHtml(String(layer.id))}">Edit</button>
                                <button class="prop-molecule-remove-layer text-[13px] text-red-500 hover:text-red-600" title="Remove this layer" aria-label="Remove this layer" data-layer-id="${escapeHtml(String(layer.id))}">×</button>
                            </div>
                        `;
                                })
                                .join("")
                            : `<div class="text-[11px] text-slate-500 italic">No layers: the style above is used for everything</div>`
                        }
                    </div>
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed mt-3">
                    A layer restyles just its selection (a cartoon layer of chain A recolours chain A; Hidden removes it). Layers are kept in exports and presentations.
                </p>
            `;
  panel.appendChild(moleculeGrp);
}

function bindMoleculePanel(data, onCommit) {
  // The molecule on the slide (not its thumbnail copy), changed in place; only a new file reloads the viewer.
  const refreshMoleculeDom = (updates = {}) => {
    const dom = [...document.querySelectorAll(`[id="${data.id}"]`)].find(
      (node) => !node.closest("#slide-previews"),
    );
    if (!dom) return;
    const merged = {
      ...data,
      ...updates,
      styles: { ...(data.styles || {}), ...(updates.styles || {}) },
    };
    const iframe = dom.querySelector(".molecule-embed-frame");
    const needsRebuild = ["content", "moleculeFormat", "moleculeIsTrajectory", "moleculeTrajectory"].some((key) => key in updates);
    if (iframe && needsRebuild) {
      if (iframe._moleculeDataBridgeCleanup) iframe._moleculeDataBridgeCleanup();
      attachMoleculeDataBridge(iframe, merged);
      iframe.srcdoc = buildMoleculeEmbedSrcdoc({ ...merged, moleculeFogColor: moleculeFogColor(state.slides[currentSlideIndex]) });
      return;
    }
    syncMoleculeElementNode(dom, merged, state.slides[currentSlideIndex]);
  };
  const normalizedLayers = () =>
    (Array.isArray(data.moleculeRepresentationLayers)
      ? data.moleculeRepresentationLayers
      : []
    )
      .map((layer) =>
        typeof normalizeMoleculeRepresentationLayer === "function"
          ? normalizeMoleculeRepresentationLayer(layer)
          : layer,
      )
      .slice(0, 12);

  const nameInput = document.getElementById("prop-molecule-name");
  if (nameInput) {
    const commitName = () => {
      onCommit(() => {
        const next = nameInput.value.trim() || "Molecule";
        data.moleculeName = next;
        updateElementState(data.id, { moleculeName: next });
        refreshMoleculeDom({ moleculeName: next });
      });
    };
    nameInput.onchange = commitName;
    nameInput.onblur = commitName;
  }

  const bgInput = document.getElementById("prop-molecule-bg");
  const bgTransparent = document.getElementById(
    "prop-molecule-bg-transparent",
  );
  const applyMoleculeBackground = (next, commit = false) => {
    const normalized =
      typeof normalizeMoleculeBackgroundColor === "function"
        ? normalizeMoleculeBackgroundColor(next)
        : next;
    // Only the background changes: passing { backgroundColor } as the styles dropped the border, corner radius
    // and stacking order.
    const styles = { ...(data.styles || {}), backgroundColor: normalized };
    data.styles = styles;
    if (commit) {
      onCommit(() => updateElementState(data.id, { styles: { ...styles } }));
    } else {
      updateElementState(data.id, { styles: { ...styles } });
    }
    refreshMoleculeDom({ styles: { backgroundColor: normalized } });
  };
  if (bgInput) {
    bgInput.oninput = (event) =>
      applyMoleculeBackground(event.target.value);
    bgInput.onchange = (event) =>
      applyMoleculeBackground(event.target.value, true);
  }
  if (bgTransparent) {
    bgTransparent.onchange = (event) => {
      const transparent = event.target.checked;
      if (bgInput) bgInput.disabled = transparent;
      applyMoleculeBackground(
        transparent ? "transparent" : bgInput?.value || "#020617",
        true,
      );
    };
  }

  const removeTrajectoryBtn = document.getElementById("prop-molecule-remove-trajectory");
  if (removeTrajectoryBtn) removeTrajectoryBtn.onclick = () => removeMoleculeTrajectory(data.id);

  const depthCue = document.getElementById("prop-molecule-depth-cue");
  if (depthCue) {
    depthCue.onchange = () => {
      onCommit(() => {
        data.moleculeDepthCue = depthCue.checked;
        updateElementState(data.id, { moleculeDepthCue: depthCue.checked });
        refreshMoleculeDom({ moleculeDepthCue: depthCue.checked });
      });
    };
  }
  const resetViewBtn = document.getElementById("prop-molecule-reset-view");
  if (resetViewBtn) {
    resetViewBtn.onclick = () => {
      const dom = [...document.querySelectorAll(`[id="${data.id}"]`)].find((node) => !node.closest("#slide-previews"));
      dom?.querySelector(".molecule-embed-frame")?.contentWindow?.postMessage({ type: "pptmaker:molecule:reset-view" }, "*");
    };
  }

  const toggleBtn = document.getElementById("prop-molecule-toggle");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      onCommit(() => {
        const next = !data.moleculeInteractive;
        data.moleculeInteractive = next;
        updateElementState(data.id, { moleculeInteractive: next });
        refreshMoleculeDom({ moleculeInteractive: next });
        buildPropertiesPanel();
      });
    };
  }

  const styleField = document.getElementById("prop-molecule-style");
  if (styleField) {
    styleField.onchange = (e) => {
      onCommit(() => {
        const next = [
          "cartoon",
          "stick",
          "sphere",
          "line",
          "surface",
        ].includes(e.target.value)
          ? e.target.value
          : "cartoon";
        data.moleculeDefaultStyle = next;
        updateElementState(data.id, { moleculeDefaultStyle: next });
        refreshMoleculeDom({ moleculeDefaultStyle: next });
      });
    };
  }

  const colorField = document.getElementById("prop-molecule-color");
  if (colorField) {
    colorField.onchange = (e) => {
      onCommit(() => {
        const next = [
          "default",
          "chain",
          "amino",
          "ssJmol",
          "spectrum",
        ].includes(e.target.value)
          ? e.target.value
          : "spectrum";
        data.moleculeDefaultColor = next;
        updateElementState(data.id, { moleculeDefaultColor: next });
        refreshMoleculeDom({ moleculeDefaultColor: next });
      });
    };
  }

  const rotateBtn = document.getElementById("prop-molecule-rotate");
  if (rotateBtn) {
    rotateBtn.onclick = () => {
      onCommit(() => {
        const next = !data.moleculeAutoRotate;
        data.moleculeAutoRotate = next;
        updateElementState(data.id, { moleculeAutoRotate: next });
        refreshMoleculeDom({ moleculeAutoRotate: next });
        buildPropertiesPanel();
      });
    };
  }

  const projectionBtn = document.getElementById(
    "prop-molecule-projection",
  );
  if (projectionBtn) {
    projectionBtn.onclick = () => {
      onCommit(() => {
        const next =
          data.moleculeProjection === "orthographic"
            ? "perspective"
            : "orthographic";
        data.moleculeProjection = next;
        updateElementState(data.id, { moleculeProjection: next });
        refreshMoleculeDom({ moleculeProjection: next });
        buildPropertiesPanel();
      });
    };
  }

  const layerColorField = document.getElementById(
    "prop-molecule-layer-color",
  );
  const layerCustomField = document.getElementById(
    "prop-molecule-layer-custom",
  );
  const layerStyleField = document.getElementById(
    "prop-molecule-layer-style",
  );
  const layerSelectionField = document.getElementById(
    "prop-molecule-layer-selection",
  );
  const layerRadiusField = document.getElementById(
    "prop-molecule-layer-radius",
  );
  const layerOpacityField = document.getElementById(
    "prop-molecule-layer-opacity",
  );
  const layerEditIdField = document.getElementById(
    "prop-molecule-layer-edit-id",
  );
  const cancelLayerEditBtn = document.getElementById(
    "prop-molecule-cancel-layer-edit",
  );
  const layerSizeLabel = layerRadiusField?.closest("label")?.firstChild;
  if (layerColorField && layerCustomField) {
    const syncCustomVisibility = () => {
      layerCustomField.classList.toggle(
        "hidden",
        layerColorField.value !== "custom",
      );
    };
    layerColorField.onchange = syncCustomVisibility;
    syncCustomVisibility();
  }
  const layerDefaults = {
    cartoon: { radius: 1, opacity: 1, sizeLabel: "Thickness (1 = normal)" },
    stick: { radius: 0.18, opacity: 1, sizeLabel: "Stick Width" },
    sphere: { radius: 0.35, opacity: 1, sizeLabel: "Sphere Radius" },
    line: { radius: 2, opacity: 1, sizeLabel: "Line Width" },
    surface: { radius: 0, opacity: 0.68, sizeLabel: "Size" },
    hidden: { radius: 0, opacity: 1, sizeLabel: "Size" },
  };
  const syncLayerParameterControls = ({ resetValues = false } = {}) => {
    const kind = layerStyleField?.value || "cartoon";
    const defaults = layerDefaults[kind] || layerDefaults.cartoon;
    if (layerSizeLabel) layerSizeLabel.textContent = defaults.sizeLabel;
    if (layerRadiusField) {
      layerRadiusField.disabled = kind === "surface" || kind === "hidden";
      layerRadiusField.classList.toggle(
        "opacity-50",
        layerRadiusField.disabled,
      );
      if (resetValues) layerRadiusField.value = String(defaults.radius);
    }
    if (layerOpacityField) {
      layerOpacityField.disabled = kind !== "surface";
      layerOpacityField.classList.toggle(
        "opacity-50",
        layerOpacityField.disabled,
      );
      if (resetValues) layerOpacityField.value = String(defaults.opacity);
    }
  };
  const resetLayerForm = () => {
    if (layerEditIdField) layerEditIdField.value = "";
    if (layerSelectionField) layerSelectionField.value = "all";
    if (layerStyleField) layerStyleField.value = "cartoon";
    if (layerColorField) layerColorField.value = "spectrum";
    if (layerCustomField) layerCustomField.value = "#6366f1";
    if (addLayerBtn) addLayerBtn.textContent = "Add Layer";
    if (cancelLayerEditBtn) cancelLayerEditBtn.classList.add("hidden");
    if (layerColorField && layerCustomField)
      layerCustomField.classList.add("hidden");
    syncLayerParameterControls({ resetValues: true });
  };
  const populateLayerForm = (layer) => {
    const normalized =
      typeof normalizeMoleculeRepresentationLayer === "function"
        ? normalizeMoleculeRepresentationLayer(layer)
        : layer;
    if (layerEditIdField) layerEditIdField.value = normalized.id || "";
    if (layerSelectionField)
      layerSelectionField.value = normalized.selectionQuery || "all";
    if (layerStyleField)
      layerStyleField.value = normalized.kind || "cartoon";
    if (layerColorField)
      layerColorField.value = normalized.colorScheme || "spectrum";
    if (layerCustomField) {
      layerCustomField.value = normalized.customColor || "#6366f1";
      layerCustomField.classList.toggle(
        "hidden",
        (normalized.colorScheme || "spectrum") !== "custom",
      );
    }
    syncLayerParameterControls({ resetValues: true });
    if (layerRadiusField && normalized.radius != null)
      layerRadiusField.value = String(normalized.radius);
    if (layerOpacityField && normalized.opacity != null)
      layerOpacityField.value = String(normalized.opacity);
    if (addLayerBtn) addLayerBtn.textContent = "Update Layer";
    if (cancelLayerEditBtn) cancelLayerEditBtn.classList.remove("hidden");
  };
  if (layerStyleField) {
    layerStyleField.onchange = () =>
      syncLayerParameterControls({ resetValues: true });
    syncLayerParameterControls({ resetValues: true });
  }
  if (cancelLayerEditBtn) cancelLayerEditBtn.onclick = resetLayerForm;

  const addLayerBtn = document.getElementById("prop-molecule-add-layer");
  if (addLayerBtn) {
    addLayerBtn.onclick = () => {
      onCommit(() => {
        const selectionQuery =
          layerSelectionField?.value?.trim() || "all";
        const kind = layerStyleField?.value || "cartoon";
        const colorScheme = layerColorField?.value || "spectrum";
        const customColor = layerCustomField?.value || "#6366f1";
        const editingId = layerEditIdField?.value || "";
        const radius = Number(layerRadiusField?.value);
        const opacity = Number(layerOpacityField?.value);
        const rawLayer = {
          ...(editingId ? { id: editingId } : {}),
          selectionQuery,
          kind,
          colorScheme,
          customColor,
          ...(Number.isFinite(radius) &&
          !["surface", "hidden"].includes(kind)
            ? { radius }
            : {}),
          ...(Number.isFinite(opacity) && kind === "surface"
            ? { opacity }
            : {}),
        };
        const layer =
          typeof normalizeMoleculeRepresentationLayer === "function"
            ? normalizeMoleculeRepresentationLayer(rawLayer)
            : {
                ...rawLayer,
                id: generateId("mol_layer"),
                label: `${kind} · ${selectionQuery}`,
              };
        const existingLayers = normalizedLayers();
        const nextLayers = editingId
          ? existingLayers.map((item) =>
              String(item.id) === String(editingId) ? layer : item,
            )
          : [...existingLayers, layer].slice(0, 12);
        data.moleculeRepresentationLayers = nextLayers;
        updateElementState(data.id, {
          moleculeRepresentationLayers: nextLayers,
        });
        refreshMoleculeDom({ moleculeRepresentationLayers: nextLayers });
        buildPropertiesPanel();
      });
    };
  }

  document
    .querySelectorAll(".prop-molecule-edit-layer")
    .forEach((btn) => {
      btn.onclick = () => {
        const layerId = btn.dataset.layerId;
        const layer = normalizedLayers().find(
          (item) => String(item.id) === String(layerId),
        );
        if (layer) populateLayerForm(layer);
      };
    });

  document
    .querySelectorAll(".prop-molecule-remove-layer")
    .forEach((btn) => {
      btn.onclick = () => {
        onCommit(() => {
          const layerId = btn.dataset.layerId;
          const nextLayers = normalizedLayers().filter(
            (layer) => String(layer.id) !== String(layerId),
          );
          data.moleculeRepresentationLayers = nextLayers;
          updateElementState(data.id, {
            moleculeRepresentationLayers: nextLayers,
          });
          refreshMoleculeDom({
            moleculeRepresentationLayers: nextLayers,
          });
          buildPropertiesPanel();
        });
      };
    });

  const clearLayersBtn = document.getElementById(
    "prop-molecule-clear-layers",
  );
  if (clearLayersBtn) {
    clearLayersBtn.onclick = () => {
      onCommit(() => {
        data.moleculeRepresentationLayers = [];
        updateElementState(data.id, { moleculeRepresentationLayers: [] });
        refreshMoleculeDom({ moleculeRepresentationLayers: [] });
        buildPropertiesPanel();
      });
    };
  }
}
