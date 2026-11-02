// Properties panel section for audio elements: the file (replace it), a preview, and how it plays when presenting.

function _audioToggleRow(id, icon, title, hint, checked) {
  return `
                    <div class="flex items-center justify-between py-0.5">
                        <div class="flex items-center gap-2.5">
                            <div class="w-7 h-7 rounded-lg bg-slate-200/60 border border-slate-300/40 flex items-center justify-center text-slate-600">
                                <i class="fa-solid ${icon} text-xs"></i>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-xs font-semibold text-slate-700">${title}</span>
                                <span class="text-[10px] text-slate-400">${hint}</span>
                            </div>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="${id}" ${checked ? "checked" : ""} class="sr-only peer">
                            <div class="w-9 h-5 bg-slate-250 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 transition-colors"></div>
                        </label>
                    </div>`;
}

function buildAudioPanel(panel, data) {
  const grp = createGroup("Audio");
  const box = document.createElement("div");
  box.className = "flex flex-col gap-3.5 p-1";
  box.innerHTML = `
                <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 shadow-sm flex flex-col gap-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sound</span>
                        <span id="prop-audio-duration" class="font-mono text-[10px] text-slate-400">${data.content ? "" : "No file"}</span>
                    </div>
                    <input type="text" id="prop-audio-name"
                        class="w-full text-xs bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all placeholder-slate-400"
                        value="${escapeHtml(data.audioName || "Audio")}" placeholder="Name shown on the slide" aria-label="Name shown on the slide">
                    <div class="flex items-center gap-2">
                        <button id="prop-audio-preview" ${data.content ? "" : "disabled"}
                            class="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all cursor-pointer shadow-sm" title="Preview" aria-label="Preview">
                            <i class="fa-solid fa-play text-[10px]"></i>
                        </button>
                        <button onclick="const input=document.getElementById('audio-file-upload'); input.dataset.targetAudioId='${data.id}'; input.click()"
                            class="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 border border-indigo-500/20">
                            <i class="fa-solid fa-upload"></i> ${data.content ? "Replace Sound" : "Choose Sound File"}
                        </button>
                    </div>
                </div>
                <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-3 shadow-sm flex flex-col gap-3">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">While presenting</span>
                    ${_audioToggleRow("prop-audio-autoplay", "fa-bolt", "Play automatically", "Starts when the slide opens", data.autoplay)}
                    ${_audioToggleRow("prop-audio-loop", "fa-repeat", "Loop", "Repeats until the slide is left", data.loop)}
                    ${_audioToggleRow("prop-audio-hide", "fa-eye-slash", "Hide while presenting", "Plays without showing the player", data.hideWhilePresenting)}
                </div>`;
  grp.appendChild(box);
  panel.appendChild(grp);
}

function bindAudioPanel(data, onCommit) {
  const name = document.getElementById("prop-audio-name");
  if (name) {
    name.onchange = () => {
      const next = name.value.trim() || "Audio";
      onCommit(() => {
        updateElementState(data.id, { audioName: next });
        const label = document.querySelector(`#${data.id} .sf-audio__name`);
        if (label) label.textContent = next;
      });
    };
  }
  [
    ["prop-audio-autoplay", "autoplay"],
    ["prop-audio-loop", "loop"],
    ["prop-audio-hide", "hideWhilePresenting"],
  ].forEach(([id, key]) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.onchange = () => {
      onCommit(() => {
        updateElementState(data.id, { [key]: box.checked });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
      });
    };
  });

  // Preview: plays the sound on the slide (in the editor its own button only shows; dragging the card moves it).
  const audio = document.querySelector(`#${data.id} audio`);
  const preview = document.getElementById("prop-audio-preview");
  const duration = document.getElementById("prop-audio-duration");
  if (!audio || !preview) return;
  const refresh = () => {
    if (!document.body.contains(preview)) return;
    preview.innerHTML = `<i class="fa-solid fa-${audio.paused ? "play" : "pause"} text-[10px]"></i>`;
    if (duration && Number.isFinite(audio.duration)) duration.textContent = _audioTimeLabel(audio.duration);
  };
  ["play", "pause", "ended", "loadedmetadata"].forEach(event => audio.addEventListener(event, refresh));
  refresh();
  preview.onclick = () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };
}
