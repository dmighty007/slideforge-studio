// Properties panel section for video elements.

function buildVideoPanel(panel, data) {
  const grp = createGroup("Video Settings");

  // Format nice human-readable source label
  let displaySource = "";
  let isLocal = false;
  if (data.content) {
    if (
      data.content.startsWith("data:") ||
      data.content.startsWith("/media/") ||
      data.content.startsWith("blob:") ||
      data.content.startsWith("/")
    ) {
      isLocal = true;
      const parts = data.content.split("/");
      displaySource = parts[parts.length - 1];
      if (displaySource.length > 25) {
        displaySource =
          displaySource.substring(0, 10) +
          "..." +
          displaySource.substring(displaySource.length - 10);
      }
    } else {
      displaySource = data.content;
    }
  }

  const containerDiv = document.createElement("div");
  containerDiv.className = "flex flex-col gap-3.5 p-1";
  containerDiv.innerHTML = `
                <!-- Video Source Card -->
                <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 shadow-sm flex flex-col gap-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Video Source</span>
                        <span class="px-2 py-0.5 text-[9px] font-semibold rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                            ${isLocal ? '<i class="fa-solid fa-file-video mr-1"></i> Local File' : '<i class="fa-solid fa-globe mr-1"></i> External URL'}
                        </span>
                    </div>

                    <div class="relative">
                        <input type="text" id="prop-video-url"
                            class="w-full text-xs bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all placeholder-slate-400"
                            value="${data.content?.startsWith("data:") ? "Local File (Base64)" : escapeHtml(data.content || "")}"
                            placeholder="Paste URL or absolute local path...">
                        <i class="fa-solid fa-link absolute right-3 top-2.5 text-slate-400 text-xs"></i>
                    </div>

                    <button onclick="const input=document.getElementById('video-file-upload'); input.dataset.targetVideoId='${data.id}'; input.click()"
                        class="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 border border-indigo-500/20">
                        <i class="fa-solid fa-upload"></i> ${data.content ? "Replace Video File" : "Upload Video File"}
                    </button>

                    ${
                      isLocal
                        ? `
                        <button id="prop-video-clear-local" class="w-full py-1.5 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[10px] text-rose-600 hover:text-rose-700 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-trash-can"></i> Clear Local File
                        </button>
                    `
                        : ""
                    }
                </div>

                <!-- Live Preview Controller Card -->
                ${
                  data.content
                    ? `
                <div id="video-live-player" class="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-md flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                        <span class="text-[9px] uppercase font-bold tracking-wider text-slate-500">Live Editor Preview</span>
                        <span id="player-time-display" class="font-mono text-[10px] text-slate-400 tracking-wide">0:00 / 0:00</span>
                    </div>

                    <!-- Timeline scrubber -->
                    <div class="relative flex items-center group/slider">
                        <input type="range" id="player-timeline-scrub" min="0" max="100" value="0" step="0.1"
                            class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all focus:outline-none">
                    </div>

                    <!-- Controls row -->
                    <div class="flex items-center justify-between gap-2 mt-1">
                        <div class="flex items-center gap-2">
                            <button id="player-btn-play" class="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-sm">
                                <i class="fa-solid fa-play text-[10px]"></i>
                            </button>
                            <button id="player-btn-rewind" class="w-6 h-6 rounded-lg bg-slate-850 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer" title="Rewind 5s">
                                <i class="fa-solid fa-backward-step text-[9px]"></i>
                            </button>
                            <button id="player-btn-forward" class="w-6 h-6 rounded-lg bg-slate-850 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer" title="Forward 5s">
                                <i class="fa-solid fa-forward-step text-[9px]"></i>
                            </button>
                        </div>

                        <div class="flex items-center gap-1.5 bg-slate-850 rounded-lg px-2 py-1">
                            <button id="player-btn-mute" class="text-slate-450 hover:text-white transition-colors cursor-pointer">
                                <i class="fa-solid fa-volume-high text-[10px]"></i>
                            </button>
                            <input type="range" id="player-volume-scrub" min="0" max="100" value="100"
                                class="w-12 h-1 bg-slate-750 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none transition-all">
                        </div>
                    </div>
                </div>
                `
                    : ""
                }

                <!-- Playback Options Container -->
                <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 shadow-sm flex flex-col gap-3">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Playback Behavior</span>

                    <div class="flex items-center justify-between py-0.5">
                        <div class="flex items-center gap-2.5">
                            <div class="w-7 h-7 rounded-lg bg-slate-200/60 border border-slate-300/40 flex items-center justify-center text-slate-600">
                                <i id="prop-video-mute-icon" class="fa-solid ${data.muted ? "fa-volume-xmark text-rose-505" : "fa-volume-high"} text-xs"></i>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-xs font-semibold text-slate-700">Muted</span>
                                <span class="text-[10px] text-slate-400">Silence video audio</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="prop-video-mute" ${data.muted ? "checked" : ""} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-250 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 transition-colors"></div>
                        </label>
                    </div>

                    <div class="flex items-center justify-between py-0.5">
                        <div class="flex items-center gap-2.5">
                            <div class="w-7 h-7 rounded-lg bg-slate-200/60 border border-slate-300/40 flex items-center justify-center text-slate-600">
                                <i class="fa-solid fa-play-circle text-xs"></i>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-xs font-semibold text-slate-700">Autoplay</span>
                                <span class="text-[10px] text-slate-400">Start playing on load</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="prop-video-autoplay" ${data.autoplay ? "checked" : ""} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-250 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 transition-colors"></div>
                        </label>
                    </div>

                    <div class="flex items-center justify-between py-0.5">
                        <div class="flex items-center gap-2.5">
                            <div class="w-7 h-7 rounded-lg bg-slate-200/60 border border-slate-300/40 flex items-center justify-center text-slate-600">
                                <i class="fa-solid fa-repeat text-xs"></i>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-xs font-semibold text-slate-700">Loop</span>
                                <span class="text-[10px] text-slate-400">Repeat video infinitely</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="prop-video-loop" ${data.loop ? "checked" : ""} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-250 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 transition-colors"></div>
                        </label>
                    </div>
                </div>
            `;
  grp.appendChild(containerDiv);
  panel.appendChild(grp);
}

function bindVideoPanel(data, onCommit) {
  const videoUrl = document.getElementById("prop-video-url");
  if (videoUrl) {
    const commitVideo = () => {
      const nextUrl = videoUrl.value.trim();
      if (!nextUrl) return;

      // Check if it looks like an absolute local filesystem path on the host computer
      if (nextUrl.startsWith("/") || /^[A-Za-z]:\\/.test(nextUrl)) {
        if (typeof setProjectSaveHint === "function") {
          setProjectSaveHint(
            "Server filesystem import is disabled; use Local Video upload.",
            "warn",
          );
        }

        const formData = new FormData();
        formData.append("local_path", nextUrl);
        if (
          typeof currentPresentationId !== "undefined" &&
          currentPresentationId
        ) {
          formData.append("presentationId", currentPresentationId);
        }

        const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
        const headers = {};
        if (csrfToken) {
          headers["X-CSRFToken"] = csrfToken;
        }

        fetch("/api/assets/upload/", {
          method: "POST",
          body: formData,
          headers: headers,
        })
          .then((response) => {
            if (!response.ok) {
              return response.json().then((json) => {
                throw new Error(
                  json.error || `Failed with status ${response.status}`,
                );
              });
            }
            return response.json();
          })
          .then((dataResponse) => {
            onCommit(() => {
              updateElementState(data.id, {
                content: dataResponse.url,
                videoType: "local",
                localMimeType: dataResponse.contentType || "video/mp4",
              });
              if (window.renderSlidesFromState)
                window.renderSlidesFromState();
              buildPropertiesPanel();
              if (typeof setProjectSaveHint === "function") {
                setProjectSaveHint(
                  "Local file imported successfully",
                  "success",
                );
              }
            });
          })
          .catch((err) => {
            console.error("Local file import failed:", err);
            if (typeof setProjectSaveHint === "function") {
              setProjectSaveHint(
                `Import failed: ${err.message}`,
                "danger",
              );
            }
          });

        return;
      }

      onCommit(() => {
        updateElementState(data.id, {
          content: nextUrl,
          videoType:
            typeof _inferVideoType === "function"
              ? _inferVideoType(nextUrl)
              : data.videoType,
        });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
    videoUrl.onchange = commitVideo;
    videoUrl.onblur = commitVideo;
  }

  const clearLocalBtn = document.getElementById("prop-video-clear-local");
  if (clearLocalBtn) {
    clearLocalBtn.onclick = () => {
      onCommit(() => {
        updateElementState(data.id, { content: "" });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
  }

  // Smooth instant toggles instead of hard re-render!
  [
    [
      "mute",
      "muted",
      "prop-video-mute-icon",
      "fa-volume-xmark text-rose-400",
      "fa-volume-high",
    ],
    ["autoplay", "autoplay"],
    ["loop", "loop"],
  ].forEach(
    ([inputKey, stateKey, iconId, checkedClass, uncheckedClass]) => {
      const chk = document.getElementById(`prop-video-${inputKey}`);
      if (chk) {
        chk.onchange = () => {
          const nextVal = chk.checked;

          // 1. Dynamic UI icon update
          if (iconId) {
            const iconEl = document.getElementById(iconId);
            if (iconEl) {
              iconEl.className = `fa-solid ${nextVal ? checkedClass : uncheckedClass} text-xs`;
            }
          }

          // 2. Direct Canvas update for seamless playback!
          const canvasVideo = document.querySelector(`#${data.id} video`);
          if (canvasVideo) {
            if (stateKey === "muted") canvasVideo.muted = nextVal;
            if (stateKey === "loop") canvasVideo.loop = nextVal;
            if (stateKey === "autoplay") canvasVideo.autoplay = nextVal;
          }

          // 3. Update persistent state
          updateElementState(data.id, { [stateKey]: nextVal });

          // 4. Update the live controllers if mute button is clicked
          if (stateKey === "muted") {
            const liveMuteBtn =
              document.getElementById("player-btn-mute");
            if (liveMuteBtn) {
              liveMuteBtn.innerHTML = nextVal
                ? '<i class="fa-solid fa-volume-xmark text-xs text-rose-400"></i>'
                : '<i class="fa-solid fa-volume-high text-xs"></i>';
            }
            const liveVolScrub = document.getElementById(
              "player-volume-scrub",
            );
            if (liveVolScrub) {
              liveVolScrub.value = nextVal ? 0 : 100;
            }
          }

          if (window.refreshPreviews) window.refreshPreviews();
        };
      }
    },
  );

  // --- LIVE CONTROLLER BINDINGS ---
  const canvasVideo = document.querySelector(`#${data.id} video`);
  const playBtn = document.getElementById("player-btn-play");
  const muteBtn = document.getElementById("player-btn-mute");
  const timeDisplay = document.getElementById("player-time-display");
  const timelineScrub = document.getElementById("player-timeline-scrub");
  const volumeScrub = document.getElementById("player-volume-scrub");
  const rewindBtn = document.getElementById("player-btn-rewind");
  const forwardBtn = document.getElementById("player-btn-forward");

  if (canvasVideo) {
    // Set initial volume/muted states
    if (volumeScrub)
      volumeScrub.value = canvasVideo.muted
        ? 0
        : Math.round(canvasVideo.volume * 100);
    if (muteBtn) {
      muteBtn.innerHTML = canvasVideo.muted
        ? '<i class="fa-solid fa-volume-xmark text-xs text-rose-400"></i>'
        : '<i class="fa-solid fa-volume-high text-xs"></i>';
    }

    // Play/Pause Action
    if (playBtn) {
      playBtn.onclick = () => {
        if (canvasVideo.paused) {
          canvasVideo
            .play()
            .catch((e) => console.log("Play interrupted or blocked:", e));
        } else {
          canvasVideo.pause();
        }
      };
    }

    // Rewind / Forward Actions
    if (rewindBtn) {
      rewindBtn.onclick = () => {
        canvasVideo.currentTime = Math.max(
          0,
          canvasVideo.currentTime - 5,
        );
      };
    }
    if (forwardBtn) {
      forwardBtn.onclick = () => {
        canvasVideo.currentTime = Math.min(
          canvasVideo.duration || 0,
          canvasVideo.currentTime + 5,
        );
      };
    }

    // Timeline scrubbing
    if (timelineScrub) {
      timelineScrub.oninput = () => {
        const pct = parseFloat(timelineScrub.value) / 100;
        canvasVideo.currentTime = pct * (canvasVideo.duration || 0);
      };
    }

    // Volume scrubbing
    if (volumeScrub) {
      volumeScrub.oninput = () => {
        const vol = parseFloat(volumeScrub.value) / 100;
        canvasVideo.volume = vol;
        canvasVideo.muted = vol === 0;

        // Sync state
        updateElementState(data.id, { muted: canvasVideo.muted });
        const muteChk = document.getElementById("prop-video-mute");
        if (muteChk) muteChk.checked = canvasVideo.muted;

        const muteIcon = document.getElementById("prop-video-mute-icon");
        if (muteIcon) {
          muteIcon.className = `fa-solid ${canvasVideo.muted ? "fa-volume-xmark text-rose-400" : "fa-volume-high"} text-xs`;
        }

        if (muteBtn) {
          muteBtn.innerHTML = canvasVideo.muted
            ? '<i class="fa-solid fa-volume-xmark text-xs text-rose-400"></i>'
            : '<i class="fa-solid fa-volume-high text-xs"></i>';
        }
      };
    }

    // Mute Quick toggle
    if (muteBtn) {
      muteBtn.onclick = () => {
        const nextMuted = !canvasVideo.muted;
        canvasVideo.muted = nextMuted;
        if (volumeScrub)
          volumeScrub.value = nextMuted
            ? 0
            : Math.round(canvasVideo.volume * 100);

        // Sync state
        updateElementState(data.id, { muted: nextMuted });
        const muteChk = document.getElementById("prop-video-mute");
        if (muteChk) muteChk.checked = nextMuted;

        const muteIcon = document.getElementById("prop-video-mute-icon");
        if (muteIcon) {
          muteIcon.className = `fa-solid ${nextMuted ? "fa-volume-xmark text-rose-400" : "fa-volume-high"} text-xs`;
        }

        muteBtn.innerHTML = nextMuted
          ? '<i class="fa-solid fa-volume-xmark text-xs text-rose-400"></i>'
          : '<i class="fa-solid fa-volume-high text-xs"></i>';
      };
    }

    // ─── Real-time update loop ───
    const formatTime = (secs) => {
      if (!Number.isFinite(secs) || isNaN(secs)) return "0:00";
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    };

    const updatePlayerDashboard = () => {
      // Check if elements are still in DOM
      if (!document.getElementById("video-live-player")) return;

      // Sync Play/Pause button style
      if (playBtn) {
        playBtn.innerHTML = canvasVideo.paused
          ? '<i class="fa-solid fa-play text-[10px]"></i>'
          : '<i class="fa-solid fa-pause text-[10px]"></i>';
        playBtn.classList.toggle(
          "bg-emerald-600/20",
          !canvasVideo.paused,
        );
        playBtn.classList.toggle("text-emerald-400", !canvasVideo.paused);
        playBtn.classList.toggle(
          "border-emerald-500/20",
          !canvasVideo.paused,
        );
        playBtn.classList.toggle("bg-indigo-600/20", canvasVideo.paused);
        playBtn.classList.toggle("text-indigo-400", canvasVideo.paused);
        playBtn.classList.toggle(
          "border-indigo-500/20",
          canvasVideo.paused,
        );
      }

      // Sync Time display
      if (timeDisplay) {
        timeDisplay.innerText = `${formatTime(canvasVideo.currentTime)} / ${formatTime(canvasVideo.duration)}`;
      }

      // Sync scrubber progress
      if (timelineScrub && document.activeElement !== timelineScrub) {
        const progress = canvasVideo.duration
          ? (canvasVideo.currentTime / canvasVideo.duration) * 100
          : 0;
        timelineScrub.value = progress;
      }

      requestAnimationFrame(updatePlayerDashboard);
    };

    // Start loop
    requestAnimationFrame(updatePlayerDashboard);
  }
}
