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

    // A WebM copy first when there is one: the desktop app's engine cannot decode the H.264 MP4 every upload is
    // stored as (web browsers take the WebM too). The MP4 stays the file PowerPoint gets.
    const setVideoSource = webm => {
      videoNode.removeAttribute("src");
      videoNode.querySelectorAll("source").forEach(node => node.remove());
      if (webm) {
        const webmSource = document.createElement("source");
        webmSource.src = webm;
        webmSource.type = "video/webm";
        videoNode.appendChild(webmSource);
        const mp4Source = document.createElement("source");
        mp4Source.src = videoInfo.url || elData.content;
        videoNode.appendChild(mp4Source);
        mp4Source.addEventListener("error", () => handleVideoError());
      } else {
        videoNode.src = videoInfo.url || elData.content;
      }
    };
    if (elData.content) setVideoSource(elData.videoWebm || "");
    videoNode.style.objectFit = "cover";

    // An uploaded MP4 this engine cannot decode (the desktop app, H.264): ask the server for a WebM copy once, then
    // play that and keep it on the element.
    let webmRequested = Boolean(elData.videoWebm);
    const tryWebmCopy = () => {
      const url = String(elData.content || "");
      if (webmRequested || !/\/media\/assets\/[0-9a-f]{32}\.(mp4|m4v|mov)(\?|$)/i.test(url)) return false;
      webmRequested = true;
      el.querySelector(".video-error-overlay")?.remove();
      const note = document.createElement("div");
      note.className = "video-convert-overlay absolute inset-0 bg-slate-950/80 rounded-[inherit] flex items-center justify-center gap-2 z-20 text-xs font-semibold text-slate-100";
      note.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[#38bdf8]"></i><span>Converting this video so it can play here…</span>';
      el.appendChild(note);
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
      fetch("/api/assets/video-webm/", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ url }),
      })
        .then(response => (response.ok ? response.json() : response.json().then(json => Promise.reject(new Error(json.error || response.status)))))
        .then(result => {
          note.remove();
          const live = state.slides?.flatMap(slide => slide.elements || []).find(item => item.id === elData.id);
          if (live) live.videoWebm = result.webmUrl;
          elData.videoWebm = result.webmUrl;
          setVideoSource(result.webmUrl);
          videoNode.load();
          schedulePresentationAutosave?.(300);
        })
        .catch(error => {
          note.remove();
          console.warn("No playable copy of the video:", error);
          showVideoError();
        });
      return true;
    };

    const handleVideoError = () => {
      if (tryWebmCopy()) return;
      showVideoError();
    };
    const showVideoError = () => {
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
    // A text node: rewriting innerHTML would rebuild the <source> children and lose their error listener.
    videoNode.appendChild(document.createTextNode("Your browser does not support the video tag or this format."));
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

// A sound on the slide: a small card (play button, name, time and progress) over an <audio>. While presenting the
// button plays and pauses it; one set to play by itself starts when its slide opens (see syncActiveSlideMedia),
// and one hidden while presenting plays without showing. In the editor the card is dragged like any object.
function _audioTimeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function _audioCardNode(elData) {
  const card = document.createElement("div");
  card.className = "sf-audio";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sf-audio__play play-mode-events-auto";
  button.setAttribute("aria-label", "Play");
  button.innerHTML = '<i class="fa-solid fa-play"></i>';
  const body = document.createElement("div");
  body.className = "sf-audio__body";
  const name = document.createElement("div");
  name.className = "sf-audio__name";
  name.textContent = elData.audioName || "Audio";
  const track = document.createElement("div");
  track.className = "sf-audio__track";
  const bar = document.createElement("div");
  bar.className = "sf-audio__bar";
  track.appendChild(bar);
  const time = document.createElement("div");
  time.className = "sf-audio__time";
  time.textContent = "0:00";
  const flags = document.createElement("div");
  flags.className = "sf-audio__flags play-mode-hidden";
  flags.innerHTML = [
    elData.autoplay ? '<span title="Plays when the slide opens"><i class="fa-solid fa-bolt"></i></span>' : "",
    elData.loop ? '<span title="Loops"><i class="fa-solid fa-repeat"></i></span>' : "",
    elData.hideWhilePresenting ? '<span title="Hidden while presenting"><i class="fa-solid fa-eye-slash"></i></span>' : "",
  ].join("");
  body.append(name, track);
  card.append(button, body, time, flags);
  return card;
}

function _applyAudioTypeContent(el, elData) {
  el.classList.toggle("sf-audio-hidden-in-show", !!elData.hideWhilePresenting);
  const card = _audioCardNode(elData);
  el.appendChild(card);
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.loop = !!elData.loop;
  // Not data-autoplay: Reveal.js starts any audio with that attribute (whatever its value) when its slide shows.
  audio.dataset.sfAutoplay = elData.autoplay ? "true" : "false";
  audio.className = "sf-audio__media";
  // The copy the desktop app can play first (its engine has no AAC decoder), the uploaded file after it.
  const setSources = copy => {
    audio.removeAttribute("src");
    audio.querySelectorAll("source").forEach(node => node.remove());
    [copy, elData.content].filter(Boolean).forEach((url, index, list) => {
      const source = document.createElement("source");
      source.src = url;
      if (url === copy) source.type = "audio/webm";
      if (index === list.length - 1) source.addEventListener("error", () => handleError());
      audio.appendChild(source);
    });
  };
  // A file this engine cannot decode (AAC in the desktop app): ask the server once for a copy it can play.
  let copyRequested = Boolean(elData.audioWebm);
  const handleError = () => {
    const url = String(elData.content || "");
    if (copyRequested || !/\/media\/assets\/[0-9a-f]{32}\.\w{2,4}(\?|$)/i.test(url)) {
      card.classList.add("sf-audio--error");
      card.querySelector(".sf-audio__time").textContent = "Cannot play";
      return;
    }
    copyRequested = true;
    card.querySelector(".sf-audio__time").textContent = "Converting…";
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    fetch("/api/assets/video-webm/", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      body: JSON.stringify({ url }),
    })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(result => {
        const live = state.slides?.flatMap(slide => slide.elements || []).find(item => item.id === elData.id);
        if (live) live.audioWebm = result.webmUrl;
        elData.audioWebm = result.webmUrl;
        setSources(result.webmUrl);
        audio.load();
        card.querySelector(".sf-audio__time").textContent = "0:00";
        schedulePresentationAutosave?.(300);
      })
      .catch(() => {
        card.classList.add("sf-audio--error");
        card.querySelector(".sf-audio__time").textContent = "Cannot play";
      });
  };
  if (elData.content) setSources(elData.audioWebm || "");
  el.appendChild(audio);

  const button = card.querySelector(".sf-audio__play");
  const bar = card.querySelector(".sf-audio__bar");
  const time = card.querySelector(".sf-audio__time");
  const refresh = () => {
    const playing = !audio.paused && !audio.ended;
    card.classList.toggle("is-playing", playing);
    button.innerHTML = `<i class="fa-solid fa-${playing ? "pause" : "play"}"></i>`;
    button.setAttribute("aria-label", playing ? "Pause" : "Play");
    const total = audio.duration;
    bar.style.width = Number.isFinite(total) && total > 0 ? `${(audio.currentTime / total) * 100}%` : "0%";
    if (!card.classList.contains("sf-audio--error")) {
      time.textContent = Number.isFinite(total) && total > 0 && (playing || audio.currentTime > 0)
        ? `${_audioTimeLabel(audio.currentTime)} / ${_audioTimeLabel(total)}`
        : _audioTimeLabel(total);
    }
  };
  ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange"].forEach(name => audio.addEventListener(name, refresh));
  button.addEventListener("pointerdown", event => event.stopPropagation());
  button.addEventListener("click", event => {
    event.stopPropagation();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  if (elData.uploading) {
    card.classList.add("sf-audio--uploading");
    time.textContent = `Uploading… ${Math.round(elData.uploadProgress || 0)}%`;
    time.classList.add("upload-progress-badge");
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
