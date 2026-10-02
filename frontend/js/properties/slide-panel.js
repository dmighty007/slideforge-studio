// Properties panel: slide workspace panel (shown when no element is selected) and slide notes.

function updateCurrentSlideNotes(value) {
  const slide = state.slides[currentSlideIndex];
  if (!slide) return;
  slide.notes = String(value || "");
  schedulePresentationAutosave?.(150);
}

function _buildSlideWorkspacePanel(panel) {
  const createGroup = (title) => {
    const wrap = document.createElement("div");
    wrap.className = "prop-group";
    wrap.dataset.slidePropertyGroup = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

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
    wrap.appendChild(header);

    const content = document.createElement("div");
    content.className = "space-y-3 pt-1 pb-2";
    wrap.appendChild(content);

    const collapsedByDefault = new Set(["Master Slide"]).has(title);
    if (collapsedByDefault) {
      content.style.display = "none";
      chevron.style.transform = "rotate(-90deg)";
    }

    header.onclick = () => {
      const isHidden = content.style.display === "none";
      content.style.display = isHidden ? "block" : "none";
      chevron.style.transform = isHidden ? "rotate(0deg)" : "rotate(-90deg)";
    };

    // Redirect innerHTML operations to the content div so backward-compatible append works flawlessly
    Object.defineProperty(wrap, "innerHTML", {
      get() {
        return content.innerHTML;
      },
      set(val) {
        content.innerHTML = val;
      },
      configurable: true,
    });

    return wrap;
  };

  const slide = state.slides[currentSlideIndex] || {
    layoutId: "blank-titled",
    notes: "",
  };
  const background = normalizeSlideBackground(slide.background);
  const currentSlideTransition = slide.presentationTransition || "none";

  const activeThemeSystem =
    typeof getPresentationThemeSystem === "function"
      ? getPresentationThemeSystem(state.presentationTheme)
      : null;
  const globalGrp = createGroup("Global Settings");
  globalGrp.innerHTML += `
        <div class="space-y-3">
            <div class="flex flex-col gap-1">
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Theme</label>
                <select id="prop-global-theme" class="prop-select">
                    ${Object.entries(
                      typeof PRESENTATION_THEMES !== "undefined"
                        ? PRESENTATION_THEMES
                        : {},
                    )
                      .map(
                        ([themeId, theme]) =>
                          `<option value="${escapeHtml(themeId)}" ${state.presentationTheme === themeId ? "selected" : ""}>${escapeHtml(theme.label || themeId)}</option>`,
                      )
                      .join("")}
                </select>
                <div class="sf-theme-gallery" role="list" aria-label="Themes">
                    ${Object.entries(typeof PRESENTATION_THEMES !== "undefined" ? PRESENTATION_THEMES : {})
                      .map(([themeId, theme]) => {
                        const bg = theme.cssVars?.["--slide-bg"] || "#fff";
                        const fg = theme.cssVars?.["--slide-fg"] || theme.defaultTextColor || "#0f172a";
                        const accent = theme.cssVars?.["--slide-accent"] || theme.accentStrong || "#4f46e5";
                        return `<button type="button" role="listitem" class="sf-theme-swatch ${state.presentationTheme === themeId ? "is-active" : ""}" data-theme-id="${escapeHtml(themeId)}" title="${escapeHtml(theme.label || themeId)}" aria-pressed="${state.presentationTheme === themeId}">
                            <span class="sf-theme-swatch__cover" style="background:${escapeHtml(bg)};color:${escapeHtml(fg)};--swatch-accent:${escapeHtml(accent)};font-family:${escapeHtml(theme.headingFont || "inherit")}">Aa</span>
                            <span class="sf-theme-swatch__name">${escapeHtml(theme.label || themeId)}</span>
                        </button>`;
                      })
                      .join("")}
                </div>
                ${
                  activeThemeSystem
                    ? `<div class="sf-theme-intel">
                            ${[
                              // Family and tone are often the same word ("Cinematic Cinematic"): each shown once.
                              ...new Set(
                                [
                                  activeThemeSystem.family,
                                  activeThemeSystem.intent?.tone || "presentation",
                                  activeThemeSystem.tokens?.density?.default || "standard",
                                ].map((value) => String(value || "").toLowerCase()).filter(Boolean),
                              ),
                            ]
                              .map((value) => `<span>${escapeHtml(value)}</span>`)
                              .join("")}
                        </div>
                        <div class="sf-theme-guidance">${escapeHtml(activeThemeSystem.aiGuidance?.densityAdvice || "")}</div>`
                    : ""
                }
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Slide Size</label>
                <select id="prop-global-size" class="prop-select">
                    ${Object.entries(typeof PRESENTATION_PAGE_SETUPS !== "undefined" ? PRESENTATION_PAGE_SETUPS : {})
                      .map(
                        ([setupId, setup]) =>
                          `<option value="${escapeHtml(setupId)}" ${getPresentationPageSetupId(state) === setupId ? "selected" : ""}>${escapeHtml(setup.label || setupId)}</option>`,
                      )
                      .join("")}
                </select>
            </div>
        </div>
    `;
  panel.appendChild(globalGrp);

  const layoutGrp = createGroup("Slide Layout");
  // Thirty presets, grouped by what they are for (a flat list of names was hard to scan).
  const categoryLabels = typeof PRESET_CATEGORY_LABELS !== "undefined" ? PRESET_CATEGORY_LABELS : {};
  const visiblePresets = Object.entries(window.SLIDE_PRESETS || {}).filter(([, preset]) => !preset.hiddenInPalette);
  const usedCategories = Object.keys(categoryLabels).filter(
    (category) => category !== "recommended" && visiblePresets.some(([, preset]) => (preset.metadata?.category || "narrative") === category),
  );
  const presetOptions = usedCategories
    .map((category) => {
      const options = visiblePresets
        .filter(([, preset]) => (preset.metadata?.category || "narrative") === category)
        .map(([id, preset]) => `<option value="${id}" ${slide.layoutId === id ? "selected" : ""}>${preset.name}</option>`)
        .join("");
      return `<optgroup label="${categoryLabels[category] || category}">${options}</optgroup>`;
    })
    .join("");
  const presetCategories = [
    ["recommended", "Recommended"],
    ["recent", "Recent"],
    ["all", "All"],
    ...usedCategories.map((category) => [category, categoryLabels[category] || category]),
  ];
  layoutGrp.innerHTML += `
        <div class="sf-slide-layout-inspector">
            <div class="sf-inspector-subsection">
                <div class="sf-inspector-subtitle">
                    <span>Transition</span>
                    <small>Active slide</small>
                </div>
                <div class="sf-inline-control">
                    <select id="prop-slide-transition" class="prop-select">
                        <option value="none" ${currentSlideTransition === "none" ? "selected" : ""}>None</option>
                        <option value="fade" ${currentSlideTransition === "fade" ? "selected" : ""}>Fade</option>
                        <option value="diffuse" ${currentSlideTransition === "diffuse" ? "selected" : ""}>Diffuse</option>
                        <option value="slide" ${currentSlideTransition === "slide" ? "selected" : ""}>Slide</option>
                        <option value="convex" ${currentSlideTransition === "convex" ? "selected" : ""}>Convex</option>
                        <option value="concave" ${currentSlideTransition === "concave" ? "selected" : ""}>Concave</option>
                        <option value="zoom" ${currentSlideTransition === "zoom" ? "selected" : ""}>Zoom</option>
                    </select>
                    <button id="prop-apply-transition-all" class="prop-action-btn prop-action-secondary" type="button">All</button>
                </div>
            </div>
            <div class="sf-inspector-subsection">
                <div class="sf-inspector-subtitle">
                    <span>Layout</span>
                    <small>Preset</small>
                </div>
                <select id="prop-slide-layout" class="w-full text-xs">${presetOptions}</select>
                <div class="grid grid-cols-2 gap-2">
                    <button id="prop-apply-layout" class="prop-action-btn prop-action-primary">Apply</button>
                    <button id="prop-insert-layout-slide" class="prop-action-btn prop-action-secondary">New</button>
                </div>
            </div>
            <details class="sf-inspector-subsection sf-preset-browser-shell">
                <summary class="sf-inspector-subtitle">
                    <span>Suggested layouts</span>
                    <small>Browse</small>
                </summary>
                <div class="sf-preset-tools">
                    <input id="preset-search-input" type="search" placeholder="Search presets..." autocomplete="off">
                    <select id="preset-category-filter">
                        ${presetCategories.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}
                    </select>
                </div>
                <div id="preset-slides-list" class="sf-preset-results"></div>
            </details>
        </div>
    `;
  panel.appendChild(layoutGrp);

  const masterId =
    typeof resolveSlideMasterId === "function"
      ? resolveSlideMasterId(slide)
      : slide.masterId || "content";
  const masterConfig = state.masterSlides?.[masterId] || {};
  const masterOptions = Object.entries(
    typeof getMasterSlideOptions === "function"
      ? getMasterSlideOptions()
      : typeof MASTER_SLIDE_DEFINITIONS !== "undefined"
        ? MASTER_SLIDE_DEFINITIONS
        : {},
  )
    .map(
      ([id, master]) =>
        `<option value="${escapeHtml(id)}" ${masterId === id ? "selected" : ""}>${escapeHtml(master.name || id)}</option>`,
    )
    .join("");
  const masterGrp = createGroup("Master Slide");
  masterGrp.innerHTML += `
        <div class="space-y-2">
            <select id="prop-slide-master" class="w-full text-xs">${masterOptions}</select>
            <label class="prop-label">Footer</label>
            <div class="grid grid-cols-2 gap-2">
                <input id="prop-master-logo" class="w-full text-xs" type="text" value="${escapeHtml(masterConfig.logoText || "")}" placeholder="Logo / label" ${masterId === "none" ? "disabled" : ""}>
                <input id="prop-master-footer" class="w-full text-xs" type="text" value="${escapeHtml(masterConfig.footerText || "")}" placeholder="Footer text" ${masterId === "none" ? "disabled" : ""}>
            </div>
            <label class="flex items-center gap-2 text-xs text-slate-600">
                <input id="prop-master-slide-number" type="checkbox" class="prop-native-checkbox" ${masterConfig.showSlideNumber !== false ? "checked" : ""} ${masterId === "none" ? "disabled" : ""}>
                Show slide number
            </label>
            <div class="text-xs text-slate-600">Master elements are theme-aware and shared by slides using the same master.</div>
        </div>
    `;
  panel.appendChild(masterGrp);

  const bgGrp = createGroup("Slide Background");
  const bgIsThree = background?.type === "three";
  bgGrp.innerHTML += `
        <div class="space-y-2">
            <input id="prop-slide-bg-url" class="w-full text-xs" type="text" value="${bgIsThree ? "" : escapeHtml(background?.content || "")}" placeholder="Paste image/GIF/MP4 URL">
            <select id="prop-slide-bg-fit" class="w-full text-xs" ${bgIsThree ? "disabled" : ""}>
                <option value="cover" ${(background?.fit || "cover") === "cover" ? "selected" : ""}>Fit: Cover</option>
                <option value="contain" ${background?.fit === "contain" ? "selected" : ""}>Fit: Contain</option>
                <option value="fill" ${background?.fit === "fill" ? "selected" : ""}>Fit: Stretch</option>
            </select>
            <div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <button id="prop-slide-bg-three" class="w-full py-2 rounded-lg ${bgIsThree ? "bg-primary text-white" : "border border-slate-300 bg-white text-slate-700"} text-xs font-semibold" type="button">${bgIsThree ? '<i class="fa-solid fa-check mr-1"></i> 3D background on (click to turn off)' : "Use the theme's 3D background"}</button>
                <select id="prop-slide-bg-three-style" class="w-full text-xs">
                    <option value="orbital" ${(background?.style || "orbital") === "orbital" ? "selected" : ""}>Orbital field</option>
                    <option value="mesh" ${background?.style === "mesh" ? "selected" : ""}>Connected mesh</option>
                    <option value="particles" ${background?.style === "particles" ? "selected" : ""}>Soft spheres</option>
                    <option value="lattice" ${background?.style === "lattice" ? "selected" : ""}>Depth lattice</option>
                    <option value="wave" ${background?.style === "wave" ? "selected" : ""}>Wave surface</option>
                    <option value="vortex" ${background?.style === "vortex" ? "selected" : ""}>Vortex spiral</option>
                </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Opacity</label>
                        <span id="prop-slide-bg-opacity-label" class="text-[10px] font-mono text-slate-500">${Math.round((background?.opacity ?? 1) * 100)}%</span>
                    </div>
                    <input id="prop-slide-bg-opacity" type="range" min="0" max="100" value="${Math.round((background?.opacity ?? 1) * 100)}" class="h-1.5 accent-primary cursor-pointer" ${background ? "" : "disabled"}>
                </div>
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Blur</label>
                        <span id="prop-slide-bg-blur-label" class="text-[10px] font-mono text-slate-500">${Math.round(background?.blur || 0)}px</span>
                    </div>
                    <input id="prop-slide-bg-blur" type="range" min="0" max="40" value="${Math.round(background?.blur || 0)}" class="h-1.5 accent-primary cursor-pointer" ${background ? "" : "disabled"}>
                </div>
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Brightness</label>
                        <span id="prop-slide-bg-brightness-label" class="text-[10px] font-mono text-slate-500">${Math.round(background?.brightness ?? 100)}%</span>
                    </div>
                    <input id="prop-slide-bg-brightness" type="range" min="10" max="200" value="${Math.round(background?.brightness ?? 100)}" class="h-1.5 accent-primary cursor-pointer" ${background ? "" : "disabled"}>
                </div>
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-bold text-slate-600 uppercase tracking-wide">Saturation</label>
                        <span id="prop-slide-bg-saturate-label" class="text-[10px] font-mono text-slate-500">${Math.round(background?.saturate ?? 100)}%</span>
                    </div>
                    <input id="prop-slide-bg-saturate" type="range" min="0" max="250" value="${Math.round(background?.saturate ?? 100)}" class="h-1.5 accent-primary cursor-pointer" ${background ? "" : "disabled"}>
                </div>
            </div>
            ${background ? "" : '<div class="text-xs text-slate-500">Opacity, blur, brightness and saturation apply once the slide has a background: turn on the 3D background, paste a link or upload a picture or video.</div>'}
            <div class="grid grid-cols-3 gap-2">
                <button id="prop-slide-bg-apply" class="py-2 rounded-lg bg-primary text-white text-xs font-semibold">Apply URL</button>
                <button id="prop-slide-bg-upload" class="py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold">Upload</button>
                <button id="prop-slide-bg-clear" class="py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold">Clear</button>
            </div>
            <div class="text-xs text-slate-600">Supports PNG, GIF, MP4/WebM, and theme-adaptive 3D motion backgrounds.</div>
        </div>
    `;
  panel.appendChild(bgGrp);

  const notesGrp = createGroup("Slide Notes");
  notesGrp.innerHTML += `
        <div class="space-y-2">
            <textarea id="prop-slide-notes" class="w-full min-h-[140px] text-xs leading-5" placeholder="Presenter notes for this slide...">${escapeHtml(slide.notes || "")}</textarea>
            <div class="text-xs text-slate-600">Notes are visible in presenter view and hidden from the audience.</div>
        </div>
    `;
  panel.appendChild(notesGrp);

  setTimeout(() => {
    const layoutSelect = document.getElementById("prop-slide-layout");
    const applyBtn = document.getElementById("prop-apply-layout");
    const insertBtn = document.getElementById("prop-insert-layout-slide");
    const presetSearchInput = document.getElementById("preset-search-input");
    const presetCategoryFilter = document.getElementById(
      "preset-category-filter",
    );
    const masterSelect = document.getElementById("prop-slide-master");
    const masterLogoInput = document.getElementById("prop-master-logo");
    const masterFooterInput = document.getElementById("prop-master-footer");
    const masterSlideNumberInput = document.getElementById(
      "prop-master-slide-number",
    );
    const bgUrlInput = document.getElementById("prop-slide-bg-url");
    const bgFitInput = document.getElementById("prop-slide-bg-fit");
    const bgApplyBtn = document.getElementById("prop-slide-bg-apply");
    const bgUploadBtn = document.getElementById("prop-slide-bg-upload");
    const bgClearBtn = document.getElementById("prop-slide-bg-clear");
    const bgThreeBtn = document.getElementById("prop-slide-bg-three");
    const bgThreeStyleInput = document.getElementById(
      "prop-slide-bg-three-style",
    );
    const bgAdjustmentInputs = [
      [
        "prop-slide-bg-opacity",
        "prop-slide-bg-opacity-label",
        "opacity",
        (value) => Math.max(0, Math.min(100, Number(value) || 0)) / 100,
        (value) => `${Math.round(value)}%`,
      ],
      [
        "prop-slide-bg-blur",
        "prop-slide-bg-blur-label",
        "blur",
        (value) => Math.max(0, Math.min(40, Number(value) || 0)),
        (value) => `${Math.round(value)}px`,
      ],
      [
        "prop-slide-bg-brightness",
        "prop-slide-bg-brightness-label",
        "brightness",
        (value) => Math.max(10, Math.min(200, Number(value) || 100)),
        (value) => `${Math.round(value)}%`,
      ],
      [
        "prop-slide-bg-saturate",
        "prop-slide-bg-saturate-label",
        "saturate",
        (value) => Math.max(0, Math.min(250, Number.isFinite(Number(value)) ? Number(value) : 100)), // 0 = grey
        (value) => `${Math.round(value)}%`,
      ],
    ];
    const globalTheme = document.getElementById("prop-global-theme");
    const slideTransitionInput = document.getElementById(
      "prop-slide-transition",
    );
    const applyTransitionAllBtn = document.getElementById(
      "prop-apply-transition-all",
    );
    const globalSize = document.getElementById("prop-global-size");
    const notesInput = document.getElementById("prop-slide-notes");

    // The theme gallery: every theme as a small cover (the dropdown only listed names).
    document.querySelectorAll(".sf-theme-swatch").forEach((swatch) => {
      swatch.onclick = () => {
        if (typeof changePresentationTheme === "function") changePresentationTheme(swatch.dataset.themeId);
        else applyPresentationTheme(swatch.dataset.themeId);
      };
    });
    if (globalTheme) {
      globalTheme.onchange = (e) => {
        if (typeof changePresentationTheme === "function")
          changePresentationTheme(e.target.value);
        else applyPresentationTheme(e.target.value);
      };
    }
    if (slideTransitionInput) {
      slideTransitionInput.onchange = (e) => {
        const activeSlide = state.slides[currentSlideIndex];
        if (!activeSlide) return;
        saveStateToUndo?.();
        activeSlide.presentationTransition = e.target.value;
        if (typeof schedulePresentationAutosave === "function")
          schedulePresentationAutosave();
        buildPropertiesPanel?.();
        if (
          typeof Reveal !== "undefined" &&
          document.body.classList.contains("play-mode-active")
        ) {
          const activeTransition = activeSlide.presentationTransition || "none";
          Reveal.configure({
            transition: activeTransition,
            backgroundTransition: activeTransition,
          });
        }
      };
    }
    if (applyTransitionAllBtn) {
      applyTransitionAllBtn.onclick = () => {
        const activeSlide = state.slides[currentSlideIndex];
        if (!activeSlide) return;
        const transition = activeSlide.presentationTransition || "none";
        saveStateToUndo?.();
        state.presentationTransition = transition;
        state.slides.forEach((targetSlide) => {
          targetSlide.presentationTransition = transition;
        });
        if (typeof schedulePresentationAutosave === "function")
          schedulePresentationAutosave();
        buildPropertiesPanel?.();
      };
    }
    if (globalSize) {
      globalSize.onchange = (e) => applyPresentationPageSetup(e.target.value);
    }

    if (layoutSelect) {
      layoutSelect.onchange = (e) => {
        e.target.dataset.pendingLayout = e.target.value || "blank-titled";
        if (applyBtn) {
          applyBtn.dataset.pendingLayout = e.target.dataset.pendingLayout;
          applyBtn.classList.add("ring-2", "ring-indigo-200");
        }
      };
    }
    if (typeof renderPresetSlidePalette === "function") {
      renderPresetSlidePalette();
    }
    if (presetSearchInput) {
      presetSearchInput.oninput = () => renderPresetSlidePalette?.();
    }
    if (presetCategoryFilter) {
      presetCategoryFilter.onchange = () => renderPresetSlidePalette?.();
    }

    if (applyBtn) {
      applyBtn.onclick = () => {
        const layoutId =
          applyBtn.dataset.pendingLayout ||
          layoutSelect?.value ||
          "blank-titled";
        applyPresetLayoutToCurrentSlide?.(layoutId);
      };
    }
    if (insertBtn) {
      insertBtn.onclick = () => {
        const layoutId = layoutSelect?.value || "blank-titled";
        insertPresetSlide?.(layoutId);
      };
    }
    if (masterSelect) {
      masterSelect.onchange = (e) => setCurrentSlideMaster?.(e.target.value);
    }
    const updateCurrentMaster = () => {
      const nextMasterId = masterSelect?.value || masterId;
      if (nextMasterId === "none") return;
      updateMasterSlide?.(nextMasterId, {
        logoText: masterLogoInput?.value || "",
        footerText: masterFooterInput?.value || "",
        showSlideNumber: masterSlideNumberInput?.checked !== false,
      });
    };
    if (masterLogoInput) masterLogoInput.onchange = updateCurrentMaster;
    if (masterFooterInput) masterFooterInput.onchange = updateCurrentMaster;
    if (masterSlideNumberInput)
      masterSlideNumberInput.onchange = updateCurrentMaster;
    if (bgApplyBtn) {
      bgApplyBtn.onclick = () => {
        setCurrentSlideBackgroundFromUrl?.(bgUrlInput?.value || "");
      };
    }
    if (bgFitInput) {
      bgFitInput.onchange = (e) => {
        setCurrentSlideBackgroundFit?.(e.target.value || "cover");
      };
    }
    if (bgUploadBtn) {
      bgUploadBtn.onclick = () => {
        pickCurrentSlideBackgroundFile?.();
      };
    }
    if (bgThreeBtn) {
      // A real toggle: on again turns it off (it used to read "Active" and do nothing visible).
      bgThreeBtn.onclick = () => {
        const active = normalizeSlideBackground(state.slides[currentSlideIndex]?.background)?.type === "three";
        if (active) clearCurrentSlideBackground?.();
        else setCurrentSlideBackgroundThree?.(bgThreeStyleInput?.value || "orbital");
      };
    }
    if (bgThreeStyleInput) {
      bgThreeStyleInput.onchange = (e) => {
        setCurrentSlideBackgroundThree?.(e.target.value || "orbital");
      };
    }
    if (bgClearBtn) {
      bgClearBtn.onclick = () => {
        clearCurrentSlideBackground?.();
      };
    }
    bgAdjustmentInputs.forEach(([inputId, labelId, key, normalize, format]) => {
      const input = document.getElementById(inputId);
      const label = document.getElementById(labelId);
      if (!input) return;
      input.oninput = (e) => {
        const value = Number(e.target.value);
        if (label) label.textContent = format(value);
        const normalized = normalize(value);
        const bgNode = document.querySelector(
          ".reveal .slides section.present .slide-background-media",
        );
        if (!bgNode) return;
        if (key === "opacity") bgNode.style.opacity = String(normalized);
        else {
          const currentBackground = normalizeSlideBackground(
            state.slides[currentSlideIndex]?.background,
          );
          const nextBackground = { ...currentBackground, [key]: normalized };
          applySlideBackgroundAdjustments(bgNode, nextBackground);
        }
      };
      input.onchange = (e) => {
        setCurrentSlideBackgroundAdjustments?.({
          [key]: normalize(e.target.value),
        });
      };
    });
    if (notesInput) {
      let lastValue = notesInput.value;
      notesInput.oninput = (e) => updateCurrentSlideNotes(e.target.value);
      notesInput.onchange = (e) => {
        if (e.target.value === lastValue) return;
        saveStateToUndo();
        updateCurrentSlideNotes(e.target.value);
        lastValue = e.target.value;
      };
    }
  });
}
