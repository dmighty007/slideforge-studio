// Content for image, video, HTML, molecule, equation, Mermaid, whiteboard, sketch and connector elements.

function _applyImageTypeContent(el, elData) {
  const imageNode = _createImageContentNode(elData, { interactive: true });
  el.appendChild(imageNode);

  if (!elData.cropTransform) {
    const img =
      imageNode.tagName === "IMG"
        ? imageNode
        : imageNode.querySelector("img");
    if (img) {
      // Auto-adjust height to natural aspect ratio if not explicitly cropped
      img.onload = () => {
        const naturalRatio =
          img.naturalWidth / Math.max(1, img.naturalHeight);
        const hasNaturalRatio =
          Number.isFinite(naturalRatio) && naturalRatio > 0;
        if (hasNaturalRatio && !elData.imageAspectRatio) {
          elData.imageAspectRatio = naturalRatio;
          updateElementState(elData.id, {
            imageAspectRatio: naturalRatio,
            lockAspectRatio: elData.lockAspectRatio ?? true,
          });
        }
        if (
          hasNaturalRatio &&
          !elData.cropTransform &&
          !elData.heightSetManually
        ) {
          const currentWidth = parseFloat(el.style.width) || el.offsetWidth;
          const newHeight = currentWidth / naturalRatio;
          el.style.height = `${newHeight}px`;
          updateElementState(elData.id, {
            height: `${newHeight}px`,
            imageAspectRatio: naturalRatio,
            lockAspectRatio: elData.lockAspectRatio ?? true,
          });
          if (state.selectedIds.includes(elData.id)) updateGroupBound();
        }
      };
    }
  }

  el.addEventListener("dblclick", () => {
    if (document.body.classList.contains("play-mode-active")) return;
    // A drawing reopens in Excalidraw; other pictures go to crop mode.
    if (elData.excalidraw && typeof editDrawing === "function") editDrawing(elData.id);
    else if (typeof enterCropMode === "function") enterCropMode(elData.id);
  });
}

function _applyVideoTypeContent(el, elData, options) {
  const videoInfo = _parseVideoUrl(elData.content);
  const mediaInitiallyActive =
    document.visibilityState !== "hidden" &&
    document.hasFocus() &&
    Number(options.slideIndex) === getActiveSlideMediaIndex();
  let videoNode;
  if (videoInfo.type === "youtube") {
    videoNode = document.createElement("iframe");
    const params = new URLSearchParams({
      autoplay: elData.autoplay && mediaInitiallyActive ? 1 : 0,
      mute: elData.muted ? 1 : 0,
      loop: elData.loop ? 1 : 0,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
    });
    if (window.location.origin && window.location.origin !== "null")
      params.set("origin", window.location.origin);
    if (elData.loop) params.set("playlist", videoInfo.id);
    videoNode.src = `https://www.youtube-nocookie.com/embed/${videoInfo.id}?${params.toString()}`;
    setMediaIframePermissions(
      videoNode,
      "autoplay; encrypted-media; picture-in-picture",
    );
    videoNode.setAttribute("allowfullscreen", "true");
    videoNode.setAttribute(
      "referrerpolicy",
      "strict-origin-when-cross-origin",
    );
    videoNode.setAttribute("title", "YouTube video player");
  } else if (videoInfo.type === "vimeo") {
    videoNode = document.createElement("iframe");
    videoNode.src = `https://player.vimeo.com/video/${videoInfo.id}?autoplay=${elData.autoplay && mediaInitiallyActive ? 1 : 0}&muted=${elData.muted ? 1 : 0}&loop=${elData.loop ? 1 : 0}&api=1`;
    setMediaIframePermissions(
      videoNode,
      "autoplay; fullscreen; picture-in-picture",
    );
    videoNode.setAttribute("allowfullscreen", "true");
  } else {
    videoNode = document.createElement("video");
    videoNode.controls = true;
    videoNode.muted = elData.muted !== false;
    videoNode.autoplay = Boolean(elData.autoplay && mediaInitiallyActive);
    videoNode.loop = elData.loop || false;
    videoNode.setAttribute("playsinline", "true");
    videoNode.setAttribute("preload", "metadata");

    if (elData.content) {
      videoNode.src = videoInfo.url || elData.content;
    }
    videoNode.style.objectFit = "cover";

    const handleVideoError = () => {
      console.error(
        "Video element error for ID:",
        elData.id,
        videoNode.error,
      );
      const progressOverlay = el.querySelector(".upload-progress-overlay");
      if (progressOverlay) progressOverlay.remove();

      let errOverlay = el.querySelector(".video-error-overlay");
      if (!errOverlay) {
        errOverlay = document.createElement("div");
        errOverlay.className =
          "video-error-overlay absolute inset-0 bg-slate-950/85 backdrop-blur-[4px] rounded-[inherit] flex flex-col items-center justify-center p-4 gap-2.5 z-20 text-center text-slate-300 font-medium";
        errOverlay.innerHTML = `
                        <i class="fa-solid fa-circle-exclamation text-rose-500 text-lg"></i>
                        <span class="text-xs font-semibold text-slate-100">Unsupported Format or Corrupted Video</span>
                        <span class="text-[10px] text-slate-400 max-w-[220px] leading-relaxed">The browser failed to decode this video file (demuxer or codec error).</span>
                        <button type="button" class="mt-1 px-3 py-1 bg-white/10 hover:bg-white/15 active:bg-white/20 text-[9px] font-bold uppercase tracking-wider rounded border border-white/10 transition-colors pointer-events-auto" onclick="document.getElementById('video-file-upload').click()">Try another file</button>
                    `;
        el.appendChild(errOverlay);
      }
    };

    videoNode.onerror = handleVideoError;
    videoNode.innerHTML +=
      "Your browser does not support the video tag or this format.";
  }
  videoNode.className =
    "w-full h-full rounded-[inherit] pointer-events-none play-mode-events-auto";
  videoNode.style.position = "absolute";
  videoNode.style.inset = "0";
  videoNode.dataset.autoplay = elData.autoplay ? "true" : "false";
  if (videoNode.tagName === "IFRAME") {
    videoNode.addEventListener("load", () => {
      videoNode.dataset.mediaLoaded = "true";
      requestAnimationFrame(syncActiveSlideMedia);
    });
  }
  videoNode.style.border = "0";
  el.appendChild(videoNode);

  // Add a presentation overlay to handle clicks in editor
  const overlay = document.createElement("div");
  overlay.className = "absolute inset-0 z-10 cursor-move play-mode-hidden";
  el.appendChild(overlay);
  const badge = document.createElement("span");
  badge.innerHTML = `<i class="fa-solid fa-film mr-1"></i> Video`;
  badge.className =
    "absolute top-2 left-2 px-2 py-1 bg-gray-900/80 text-white text-[10px] rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none";
  el.appendChild(badge);

  if (elData.uploading) {
    const progressOverlay = document.createElement("div");
    progressOverlay.className =
      "upload-progress-overlay absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] rounded-[inherit] flex flex-col items-center justify-center gap-2.5 z-20 text-white font-medium transition-all duration-300";
    progressOverlay.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-spinner fa-spin text-[#38bdf8] text-sm"></i>
                    <span class="upload-progress-badge text-[11px] font-semibold tracking-wider text-slate-100">Uploading... ${Math.round(elData.uploadProgress || 0)}%</span>
                </div>
                <div class="w-1/2 h-1 bg-white/20 rounded-full overflow-hidden">
                    <div class="upload-progress-bar h-full bg-[#38bdf8] transition-all duration-200" style="width: ${Number(elData.uploadProgress) || 0}%"></div>
                </div>
            `;
    el.appendChild(progressOverlay);
  }
}

function _applyHtmlTypeContent(el, elData) {
  el.classList.toggle("html-interactive", Boolean(elData.htmlInteractive));
  el.setAttribute("data-html-mode", normalizeHtmlMode(elData));

  const wrapper = document.createElement("div");
  wrapper.className = "html-embed-wrapper";

  const iframe = document.createElement("iframe");
  iframe.srcdoc = buildHtmlEmbedSrcdoc(elData.content || "", elData);
  applyHtmlEmbedSandbox(iframe);
  iframe.className = "w-full h-full html-embed-frame";
  iframe.style.border = "0";
  wrapper.appendChild(iframe);
  el.appendChild(wrapper);

  const badge = document.createElement("span");
  badge.innerHTML = `<i class="fa-solid fa-code mr-1"></i> HTML`;
  badge.className =
    "html-embed-badge absolute top-2 left-2 px-2 py-1 bg-gray-900/80 text-white text-[10px] rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity";
  el.appendChild(badge);
}

function _applyMoleculeTypeContent(el, elData, options) {
  el.classList.toggle(
    "molecule-interactive",
    Boolean(elData.moleculeInteractive),
  );
  el.setAttribute(
    "data-molecule-interactive",
    elData.moleculeInteractive ? "true" : "false",
  );

  const wrapper = document.createElement("div");
  wrapper.className = "molecule-embed-wrapper";
  wrapper.style.backgroundColor =
    typeof normalizeMoleculeBackgroundColor === "function"
      ? normalizeMoleculeBackgroundColor(
          elData.styles?.backgroundColor || "#020617",
        )
      : elData.styles?.backgroundColor || "#020617";

  const iframe = document.createElement("iframe");
  const moleculeActive =
    document.visibilityState !== "hidden" &&
    document.hasFocus() &&
    Number(options.slideIndex) === getActiveSlideMediaIndex();
  iframe.srcdoc =
    typeof buildMoleculeEmbedSrcdoc === "function"
      ? buildMoleculeEmbedSrcdoc({
          ...elData,
          moleculePresentationMode:
            document.body.classList.contains("play-mode-active"),
          moleculeActive,
          moleculeFogColor:
            typeof moleculeFogColor === "function"
              ? moleculeFogColor(state.slides?.[Number(options.slideIndex)])
              : "",
        })
      : "";
  if (typeof applyMoleculeEmbedSandbox === "function")
    applyMoleculeEmbedSandbox(iframe);
  iframe.className = "w-full h-full molecule-embed-frame";
  iframe.style.border = "0";
  iframe.setAttribute(
    "title",
    elData.moleculeIsTrajectory
      ? "Molecular trajectory viewer"
      : "Molecular structure viewer",
  );
  iframe.addEventListener("load", () =>
    requestAnimationFrame(syncActiveSlideMedia),
  );
  if (typeof attachMoleculeDataBridge === "function")
    attachMoleculeDataBridge(iframe, elData);
  wrapper.appendChild(iframe);
  el.appendChild(wrapper);

  const shield = document.createElement("div");
  shield.className = "molecule-editor-shield play-mode-hidden";
  shield.hidden = Boolean(elData.moleculeInteractive);
  shield.innerHTML = `<div class="molecule-editor-hint"><i class="fa-solid fa-up-down-left-right"></i><span>Select / move</span></div>`;
  el.appendChild(shield);

  const controls = document.createElement("div");
  controls.className = "molecule-editor-controls play-mode-hidden";
  const orbitActive = Boolean(elData.moleculeInteractive);
  controls.innerHTML = `
            <button type="button" class="molecule-editor-toggle${orbitActive ? " active" : ""}" title="${orbitActive ? "Switch to select and resize mode" : "Enable 3D orbit mode"}" aria-label="${orbitActive ? "Switch molecule to select and resize mode" : "Enable molecule 3D orbit mode"}">
                <i class="fa-solid ${orbitActive ? "fa-cube" : "fa-arrow-pointer"}"></i>
                <span>${orbitActive ? "Orbit" : "Select"}</span>
            </button>
            <span class="molecule-editor-grip" title="Drag to move"><i class="fa-solid fa-up-down-left-right"></i></span>
        `;
  const toggle = controls.querySelector(".molecule-editor-toggle");
  if (toggle) {
    toggle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = !el.classList.contains("molecule-interactive");
      if (typeof saveStateToUndo === "function") saveStateToUndo();
      elData.moleculeInteractive = next;
      if (typeof updateElementState === "function")
        updateElementState(elData.id, { moleculeInteractive: next });
      el.classList.toggle("molecule-interactive", next);
      el.setAttribute("data-molecule-interactive", next ? "true" : "false");
      shield.hidden = next;
      toggle.classList.toggle("active", next);
      toggle.title = next
        ? "Switch to select and resize mode"
        : "Enable 3D orbit mode";
      toggle.setAttribute(
        "aria-label",
        next
          ? "Switch molecule to select and resize mode"
          : "Enable molecule 3D orbit mode",
      );
      const icon = toggle.querySelector("i");
      if (icon)
        icon.className = `fa-solid ${next ? "fa-cube" : "fa-arrow-pointer"}`;
      const label = toggle.querySelector("span");
      if (label) label.textContent = next ? "Orbit" : "Select";
      if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
    });
  }
  el.appendChild(controls);

  const badge = document.createElement("span");
  badge.innerHTML = `<i class="fa-solid fa-atom mr-1"></i> ${elData.moleculeIsTrajectory ? "Trajectory" : "PDB"}`;
  badge.className =
    "molecule-embed-badge absolute top-2 left-2 px-2 py-1 bg-gray-900/80 text-white text-[10px] rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none";
  el.appendChild(badge);
}

function _applyEquationTypeContent(el, elData) {
  const container = document.createElement("div");
  container.className = "equation-container";

  const color = elData.styles?.color || "#ffffff";
  const fontSize = elData.styles?.fontSize || "24px";

  container.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;color:${color};font-size:${fontSize};line-height:1;`;
  container.innerHTML = DOMPurify.sanitize(
    elData.content || elData.latexSrc || "",
  );
  el.appendChild(container);

  // Double-click to re-edit equation
  el.addEventListener("dblclick", () => {
    if (document.body.classList.contains("play-mode-active")) return;
    if (typeof openEquationModal === "function") {
      openEquationModal(elData.latexSrc || "", elData.id);
    }
  });
}

function _applyMermaidTypeContent(el, elData) {
  if (typeof window.renderMermaidElement === "function") {
    window.renderMermaidElement(el, elData);
  } else {
    const surface = document.createElement("div");
    surface.className = "mermaid-object-surface";
    const svgHost = document.createElement("div");
    svgHost.className = "mermaid-svg-host";
    svgHost.innerHTML =
      DOMPurify.sanitize(elData.svgContent) ||
      `<div class="mermaid-render-status"><i class="fa-solid fa-diagram-project"></i><span>Diagram</span></div>`;
    surface.appendChild(svgHost);
    el.appendChild(surface);
    requestAnimationFrame(() => window.renderMermaidElement?.(el, elData));
  }
  el.addEventListener("dblclick", (event) => {
    if (document.body.classList.contains("play-mode-active")) return;
    event.preventDefault();
    event.stopPropagation();
    window.openMermaidDialog?.(elData.id);
  });
}

function _applyWhiteboardTypeContent(el, elData) {
  const selectWhiteboardElement = (event) => {
    if (document.body.classList.contains("play-mode-active")) return;
    if (document.body.classList.contains("whiteboard-mode-active")) return;
    if (typeof window.selectElement !== "function") return;
    const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey;
    window.selectElement(elData.id, isMultiSelect ? "add" : "replace");
    // Not stopping propagation: the drag handler needs this press too, or the drawing cannot be moved.
  };
  el.addEventListener("pointerdown", selectWhiteboardElement);
  el.addEventListener("mousedown", selectWhiteboardElement);
  const canvas = document.createElement("canvas");
  canvas.className = "whiteboard-object-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  el.appendChild(canvas);
  const renderWhiteboardObject = (attempt = 0) => {
    if (typeof window.renderWhiteboardDrawingElement === "function") {
      window.renderWhiteboardDrawingElement(canvas, elData);
    } else if (attempt < 8) {
      requestAnimationFrame(() => renderWhiteboardObject(attempt + 1));
    }
  };
  requestAnimationFrame(renderWhiteboardObject);
}

function _applySketchTypeContent(el, elData) {
  const canvas = document.createElement("canvas");
  canvas.className = "sketch-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.tabIndex = 0;
  el.appendChild(canvas);
  el.addEventListener("dblclick", (event) => {
    if (document.body.classList.contains("play-mode-active")) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof initSketchMode === "function") initSketchMode(elData.id);
  });

  // Render strokes to canvas
  requestAnimationFrame(() => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      renderSketchStrokes(ctx, elData.strokes || [], rect.width, rect.height);
    }
  });
}

function _applyConnectorTypeContent(el, elData) {
  renderConnectorContent(el, elData, { interactive: true });
}

function _parseVideoUrl(url) {
  if (!url) return { type: "none" };
  const value = String(url).trim();
  const isRelativeOrInline = /^(\/|\.\/|\.\.\/|data:|blob:)/i.test(value);
  const parseableValue =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || isRelativeOrInline
      ? value
      : `https://${value}`;
  let parsed = null;
  try {
    parsed = new URL(parseableValue);
  } catch (_err) {}
  const host = parsed?.hostname.replace(/^www\./, "") || "";
  if (
    host === "youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be"
  ) {
    let videoId = "";
    if (host === "youtu.be")
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    else if (parsed?.searchParams.has("v"))
      videoId = parsed.searchParams.get("v") || "";
    else if (parsed?.pathname.includes("/embed/"))
      videoId = parsed.pathname.split("/embed/")[1].split("/")[0];
    else if (parsed?.pathname.includes("/shorts/"))
      videoId = parsed.pathname.split("/shorts/")[1].split("/")[0];
    else videoId = parsed?.pathname.split("/").filter(Boolean)[0] || "";
    return { type: "youtube", id: videoId };
  }
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
    const videoId = parsed?.pathname.split("/").filter(Boolean)[0] || "";
    return { type: "vimeo", id: videoId };
  }
  return { type: "direct", url: parseableValue };
}
