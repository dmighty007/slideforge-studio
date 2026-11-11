// Presenter view: the notes/next-slide window and its sync channel.

const _PRESENTER_SYNC_STORAGE_KEY = "slideforge_presenter_sync";

const _PRESENTER_COMMAND_STORAGE_KEY = "slideforge_presenter_command";

function _syncPresenterPayload() {
    const slideConfig = getPresentationPageSetupConfig();
    const buildPresenterSection = slide => {
        if (!slide || typeof createElementNode !== "function") return null;
        const section = document.createElement("section");
        section.id = slide.id || generateId("presenter-slide");
        section.className = "presentation-slide present";
        section.style.width = `${Number(slideConfig.width) || 1024}px`;
        section.style.height = `${Number(slideConfig.height) || 768}px`;
        const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
        if (theme) {
            section.style.color = theme.defaultTextColor;
            section.style.fontFamily = theme.bodyFont;
        }
        const bgNode =
            typeof createSlideBackgroundNode === "function"
                ? createSlideBackgroundNode(slide.background, { slideIndex: currentSlideIndex })
                : null;
        if (bgNode) section.appendChild(bgNode);
        (slide.elements || []).forEach(element =>
            section.appendChild(createElementNode(element, { slideIndex: currentSlideIndex })),
        );
        return section;
    };
    const currentSlide = state.slides?.[currentSlideIndex];
    const liveCurrentSection = document.getElementById(currentSlide?.id || "");
    const currentSection = liveCurrentSection || buildPresenterSection(currentSlide);
    // The slide that comes next when presenting: hidden slides are stepped over.
    const nextSlide = state.slides?.[presentationShownSlideFrom(currentSlideIndex, 1)];
    const liveNextSection = nextSlide ? document.getElementById(nextSlide.id) : null;
    const nextSection = liveNextSection || buildPresenterSection(nextSlide);
    const nextIndex = nextSlide ? state.slides.indexOf(nextSlide) : -1;
    const payload = {
        type: "state",
        currentIndex: currentSlideIndex,
        total: state.slides?.length || 0,
        notes: state.slides?.[currentSlideIndex]?.notes || "",
        elapsedMs: Math.max(0, Date.now() - (_presentationRuntimeState.presenterStartTs || Date.now())),
        // The show timer and the recording (show-recorder.js): the presenter window shows the same clock.
        ...(typeof showTimerPayload === "function" ? showTimerPayload() : {}),
        slideWidth: Number(slideConfig.width) || 1024,
        slideHeight: Number(slideConfig.height) || 768,
        // The theme's colours (slide background, text, accents): the presenter window has the app's stylesheets
        // but not these variables, without which slides were drawn on black.
        cssVars: (typeof getPresentationTheme === "function" && getPresentationTheme()?.cssVars) || {},
        currentHtml: _presenterSectionHtml(currentSection),
        nextHtml: _presenterSectionHtml(nextSection, { arrivalOf: nextIndex }),
    };
    _postPresenterMessage(payload);
}

function _postPresenterMessage(payload) {
    if (_presentationRuntimeState.channel) {
        _presentationRuntimeState.channel.postMessage(payload);
    } else if (_presentationRuntimeState.presenterBound) {
        try {
            localStorage.setItem(_PRESENTER_SYNC_STORAGE_KEY, JSON.stringify({ ...payload, stamp: Date.now() }));
        } catch (_error) {
            // storage full or blocked: the presenter window catches up with the next slide
        }
    }
}

// A command from the presenter window (buttons and keys there).
function _handlePresenterCommand(msg) {
    if (msg.action === "next") presentationNextStep();
    if (msg.action === "prev") presentationPrevStep();
    if (msg.action === "jump") presentationGoToSlide(Number(msg.index) || 0);
    if (msg.action === "ready") _syncPresenterPayload();
    if (msg.action === "reset-timer") {
        _presentationRuntimeState.presenterStartTs = Date.now();
        if (typeof resetShowTimer === "function") resetShowTimer();
        _syncPresenterPayload();
    }
    if (msg.action === "toggle-timer" && typeof toggleShowTimerRunning === "function") toggleShowTimerRunning();
    if (msg.action === "toggle-recording" && typeof toggleShowRecordingPaused === "function") toggleShowRecordingPaused();
    if (msg.action === "stop-recording" && typeof stopShowRecording === "function") stopShowRecording();
}

// A slide's markup for the presenter window. Canvases (charts) carry no pixels in markup, so each is sent as a
// picture of what it shows now. Editor-only marks are left out: the presenter window has no rule hiding them,
// so an animation's "⚡ Slide" badge showed on its preview.
// The next slide as the audience will first see it: a slide's markup holds every build already in, so the "Next
// Slide" preview showed bullets and click-in elements that only appear on later clicks. This mirrors what
// _preparePresentationSlideAnimations does on arrival, on the copy only (the live slides are left alone).
function _applyPresenterArrivalState(copy, slideIndex) {
    const slide = state.slides?.[slideIndex];
    if (!slide) return;
    const find = id => (id ? copy.querySelector(`[id="${CSS.escape(String(id))}"]`) : null);
    const hide = node => node?.style.setProperty("visibility", "hidden", "important");
    // Simple effects: each on-click one waits for its click; on-slide ones play on arrival and end shown.
    if (typeof _getAnimatedSlideEntries === "function") {
        _getAnimatedSlideEntries(slideIndex).forEach(entry => {
            const node = find(entry.el.id);
            if (!node) return;
            node.classList.remove("sf-anim-hidden", "sf-anim-visible", "sf-anim-playing", "sf-anim-done");
            if (entry.animation.trigger === "on-click") hide(node);
        });
    }
    // "Reveal bullets one by one" and a diagram's branch reveal: every step is still to come.
    (slide.elements || []).forEach(el => {
        const node = find(el.id);
        if (!node) return;
        if (el.type === "text" && el.revealBullets) {
            let rows = [...node.querySelectorAll(".ppt-bullet-row")];
            if (!rows.length) rows = [...node.querySelectorAll(".text-element-content > p")].filter(p => p.textContent.trim());
            rows.forEach(hide);
        } else if (el.type === "mermaid" && el.graphDocument?.presentationState?.activePreset === "branch-reveal") {
            node.querySelectorAll(".mermaid-graph-node, [data-edge-id]").forEach(hide);
        }
    });
    // Timeline animations (PowerPoint's): each on-click one starts from its own first frame, in the show's order.
    const engine = typeof getAnimationEngine === "function" ? getAnimationEngine() : null;
    if (engine && typeof engine._applyAnimationInitial === "function" && typeof _getAdvancedAnimationClickGroups === "function") {
        _getAdvancedAnimationClickGroups(slideIndex).forEach(group =>
            (group.entries || []).forEach(entry => {
                const node = find(entry.el?.id);
                if (!node || !entry.animation) return;
                try {
                    engine._applyAnimationInitial(node, entry.animation);
                } catch (_error) {
                    // an effect the preview cannot set up: the element shows as authored
                }
            }),
        );
    }
}

function _presenterSectionHtml(section, { arrivalOf = -1 } = {}) {
    if (!section) return "";
    // Charts on a slide not shown yet are drawn now, for their pictures below.
    if (typeof loadDeferredCharts === "function") loadDeferredCharts(section);
    const canvases = [...section.querySelectorAll("canvas")];
    const frames = [...section.querySelectorAll("iframe")];
    const copy = section.cloneNode(true);
    // Embeds on a slide not opened yet (the next one, usually) have no document in the editor; the copy gets the
    // one they will show, and the editor's own frames stay unloaded.
    [...copy.querySelectorAll("iframe")].forEach((frame, index) => {
        if (frame.hasAttribute("srcdoc") || typeof deferredIframeSrcdoc !== "function") return;
        const srcdoc = deferredIframeSrcdoc(frames[index]);
        if (srcdoc) frame.setAttribute("srcdoc", srcdoc);
    });
    copy.querySelectorAll(".anim-badge, .resize-handle, .crop-handle, .connector-point-handle").forEach(node => node.remove());
    // "Click to add title" and an empty list's first bullet are editing prompts: hidden while presenting and in
    // exports by body classes (base.css) this window does not have, so the speaker saw them.
    copy.querySelectorAll(".text-element-content[data-placeholder]").forEach(node => {
        if (node.classList.contains("is-empty")) node.replaceChildren();
        node.removeAttribute("data-placeholder");
    });
    if (arrivalOf >= 0) _applyPresenterArrivalState(copy, arrivalOf);
    [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
        const img = document.createElement("img");
        try {
            img.src = canvases[index].toDataURL("image/png");
        } catch (_error) {
            return;
        }
        img.style.cssText = "width:100%;height:100%;display:block;";
        canvas.replaceWith(img);
    });
    return copy.outerHTML;
}

function _ensurePresenterMessaging() {
    if (_presentationRuntimeState.presenterBound) return;
    _presentationRuntimeState.presenterBound = true;
    if (typeof BroadcastChannel !== "undefined") {
        _presentationRuntimeState.channel = new BroadcastChannel("slideforge-presenter");
        _presentationRuntimeState.channel.addEventListener("message", event => {
            const msg = event.data || {};
            if (msg.type === "command") _handlePresenterCommand(msg);
        });
    }
    window.addEventListener("storage", event => {
        if (event.key !== _PRESENTER_COMMAND_STORAGE_KEY || !event.newValue) return;
        try {
            _handlePresenterCommand(JSON.parse(event.newValue));
        } catch (_err) {
            return;
        }
    });
}

function _presenterWindowHtml() {
    const stylesheetMarkup = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map(node => node.outerHTML)
        .join("\n");
    const purifySrc = new URL("vendor/dompurify/purify.min.js", document.baseURI).href;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Presenter View</title>
${stylesheetMarkup}
<style>
html,body{margin:0 !important;height:100% !important;overflow:hidden !important;background:#0b1220 !important;color:#e2e8f0 !important;font-family:Inter,system-ui,sans-serif}
.presenter-shell{display:grid;grid-template-columns:minmax(0,1fr) clamp(300px,30vw,460px);height:100vh;background:#0b1220}
.presenter-main{padding:18px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px;min-height:0}
.presenter-side{padding:18px;border-left:1px solid rgba(148,163,184,.24);background:#0f172a !important;display:flex;flex-direction:column;gap:14px;min-height:0}
.presenter-card{background:#111c30;border:1px solid rgba(148,163,184,.2);border-radius:14px;padding:12px}
.presenter-notes-card{flex:1;min-height:0;display:flex;flex-direction:column}
.presenter-stage,.presenter-next{position:relative;overflow:hidden;border-radius:10px;background:#020617}
.presenter-stage{min-height:0;padding:0}
.presenter-next{margin-top:8px}
.presenter-slide-frame{position:absolute;inset:0;overflow:hidden}
.presenter-slide-frame > section{position:absolute !important;left:50% !important;top:50% !important;right:auto !important;bottom:auto !important;margin:0 !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:none !important;transform-origin:center center !important;background:var(--slide-bg,#ffffff);color:var(--slide-fg,#0f172a);overflow:hidden}
.presenter-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.presenter-title{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
.presenter-meta{font-size:26px;font-weight:800;color:#f1f5f9}
.presenter-notes{white-space:pre-wrap;font-size:18px;line-height:1.55;color:#e2e8f0;overflow-y:auto;margin-top:8px;flex:1}
.presenter-notes.is-empty{color:#64748b;font-size:14px}
.presenter-controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.presenter-controls button,.presenter-controls input{border-radius:10px !important;border:1px solid rgba(148,163,184,.28) !important;background:#16223a !important;color:#e2e8f0 !important;padding:10px 12px !important;font-size:13px !important}
.presenter-controls button{cursor:pointer;font-weight:700}
.presenter-controls button:hover{background:#22314f}
.presenter-end{display:grid;place-items:center;height:100%;color:#64748b;font-size:14px}
.presenter-clock{display:flex;gap:18px;align-items:flex-end}
.presenter-clock .presenter-meta[data-phase="warn"]{color:#fbbf24}
.presenter-clock .presenter-meta[data-phase="over"]{color:#f87171}
.presenter-clock .is-paused{opacity:.55}
.presenter-rec{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(239,68,68,.16);color:#fca5a5;font-size:13px;font-weight:800;letter-spacing:.04em}
.presenter-rec::before{content:"";width:9px;height:9px;border-radius:50%;background:#ef4444}
.presenter-rec[hidden]{display:none}
.presenter-rec.is-paused{background:rgba(245,158,11,.16);color:#fcd34d}
.presenter-rec.is-paused::before{background:#f59e0b}
.presenter-controls.presenter-controls-wide{grid-template-columns:repeat(6,minmax(0,1fr))}
.presenter-controls button[hidden]{display:none}
</style>
</head>
<body>
<div class="presenter-shell">
  <div class="presenter-main">
    <div class="presenter-head">
      <div><div class="presenter-title">Current Slide</div><div id="presenter-meta" class="presenter-meta">1 / 1</div></div>
      <span id="presenter-rec" class="presenter-rec" hidden>REC</span>
      <div class="presenter-clock">
        <div><div id="presenter-timer-label" class="presenter-title">Elapsed</div><div id="presenter-timer" class="presenter-meta">00:00</div></div>
        <div><div class="presenter-title">This slide</div><div id="presenter-slide-timer" class="presenter-meta">00:00</div></div>
      </div>
    </div>
    <div class="presenter-card presenter-stage"><div id="presenter-current" class="presenter-slide-frame"></div></div>
    <div class="presenter-controls presenter-controls-wide">
      <button data-action="prev" type="button">Previous</button>
      <button data-action="next" type="button">Next</button>
      <input id="presenter-jump" type="number" min="1" placeholder="Slide #" />
      <button data-action="toggle-timer" id="presenter-timer-toggle" type="button">Pause Timer</button>
      <button data-action="reset-timer" type="button">Reset Timer</button>
      <button data-action="toggle-recording" id="presenter-rec-toggle" type="button" hidden>Pause Recording</button>
    </div>
  </div>
  <aside class="presenter-side">
    <div class="presenter-card">
      <div class="presenter-title">Next Slide</div>
      <div class="presenter-next"><div id="presenter-next" class="presenter-slide-frame"></div></div>
    </div>
    <div class="presenter-card presenter-notes-card">
      <div class="presenter-title">Notes</div>
      <div id="presenter-notes" class="presenter-notes is-empty">No notes for this slide.</div>
    </div>
  </aside>
</div>
<script src="${purifySrc}"></script>
<script>
const syncKey = "${_PRESENTER_SYNC_STORAGE_KEY}";
const commandKey = "${_PRESENTER_COMMAND_STORAGE_KEY}";
function sanitizeHtmlForPresenter(html) {
    if (typeof html !== 'string') return '';
    // Same default profile the editor uses for slide markup (keeps images, SVG shapes and styles).
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html);
    }
    // Fallback if DOMPurify failed to load: show the markup as text rather than render it unsanitized.
    const temp = document.createElement('div');
    temp.textContent = html; // Use textContent to avoid parsing
    return temp.innerHTML;
}

const currentEl = document.getElementById("presenter-current");
const nextEl = document.getElementById("presenter-next");
const notesEl = document.getElementById("presenter-notes");
const metaEl = document.getElementById("presenter-meta");
const timerEl = document.getElementById("presenter-timer");
const timerLabelEl = document.getElementById("presenter-timer-label");
const slideTimerEl = document.getElementById("presenter-slide-timer");
const timerToggleEl = document.getElementById("presenter-timer-toggle");
const recEl = document.getElementById("presenter-rec");
const recToggleEl = document.getElementById("presenter-rec-toggle");
const jumpEl = document.getElementById("presenter-jump");
function formatTime(ms){const s=Math.floor(Math.abs(ms)/1000);const h=Math.floor(s/3600);const m=Math.floor((s%3600)/60);const r=String(s%60).padStart(2,"0");return h?h+":"+String(m).padStart(2,"0")+":"+r:String(m).padStart(2,"0")+":"+r;}
let slideSize = { width: 1024, height: 768 };
// The show timer as the main window last sent it; it runs on here between messages.
let clock = { totalMs: 0, slideMs: 0, running: true, targetMs: 0, at: Date.now() };
let recording = { state: "idle", ms: 0, at: Date.now() };
function warnMs(target){return Math.min(Math.max(target*0.2,120000),target*0.5);}
function renderClock(){
  const passed = clock.running ? Date.now() - clock.at : 0;
  const total = clock.totalMs + passed;
  const slide = clock.slideMs + passed;
  let phase = "normal";
  if (clock.targetMs) {
    const left = clock.targetMs - total;
    phase = left <= 0 ? "over" : left <= warnMs(clock.targetMs) ? "warn" : "normal";
    timerLabelEl.textContent = left >= 0 ? "Time left" : "Over time";
    timerEl.textContent = (left < 0 ? "+" : "") + formatTime(left);
  } else {
    timerLabelEl.textContent = "Elapsed";
    timerEl.textContent = formatTime(total);
  }
  timerEl.dataset.phase = phase;
  timerEl.classList.toggle("is-paused", !clock.running);
  slideTimerEl.textContent = formatTime(slide);
  slideTimerEl.classList.toggle("is-paused", !clock.running);
  timerToggleEl.textContent = clock.running ? "Pause Timer" : "Resume Timer";
  const active = recording.state === "recording" || recording.state === "paused";
  recEl.hidden = !active;
  recToggleEl.hidden = !active;
  if (active) {
    const recMs = recording.ms + (recording.state === "recording" ? Date.now() - recording.at : 0);
    recEl.classList.toggle("is-paused", recording.state === "paused");
    recEl.textContent = (recording.state === "paused" ? "PAUSED " : "REC ") + formatTime(recMs);
    recToggleEl.textContent = recording.state === "paused" ? "Resume Recording" : "Pause Recording";
  }
}
function updateClock(payload){
  if (payload.timer) clock = { ...payload.timer, at: Date.now() };
  else if (typeof payload.elapsedMs === "number") clock = { totalMs: payload.elapsedMs, slideMs: 0, running: true, targetMs: 0, at: Date.now() };
  if (payload.recording) recording = { ...payload.recording, at: Date.now() };
  renderClock();
}
// Scales each slide to fit its frame (the slide keeps its real size and is shrunk as a whole).
function fitSlides(){
  document.querySelector(".presenter-next").style.aspectRatio = slideSize.width + " / " + slideSize.height;
  document.querySelectorAll(".presenter-slide-frame").forEach(frame => {
    const section = frame.querySelector(":scope > section");
    if (!section) return;
    const scale = Math.min(frame.clientWidth / slideSize.width, frame.clientHeight / slideSize.height) || 1;
    section.style.setProperty("width", slideSize.width + "px", "important");
    section.style.setProperty("height", slideSize.height + "px", "important");
    section.style.setProperty("transform", "translate(-50%, -50%) scale(" + scale + ")", "important");
  });
}
function updateFromPayload(payload){
  slideSize = { width: payload.slideWidth || 1024, height: payload.slideHeight || 768 };
  Object.entries(payload.cssVars || {}).forEach(([name, value]) => {
    if (/^--[\w-]+$/.test(name)) document.documentElement.style.setProperty(name, String(value));
  });
  currentEl.innerHTML = sanitizeHtmlForPresenter(payload.currentHtml || "");
  nextEl.innerHTML = sanitizeHtmlForPresenter(payload.nextHtml || "") || '<div class="presenter-end">End of presentation</div>';
  notesEl.textContent = payload.notes || "No notes for this slide.";
  notesEl.classList.toggle("is-empty", !payload.notes);
  metaEl.textContent = (payload.currentIndex + 1) + " / " + Math.max(1, payload.total || 1);
  updateClock(payload);
  fitSlides();
}
window.addEventListener("resize", fitSlides);
setInterval(renderClock, 250);
document.addEventListener("keydown", event => {
  if (event.target === jumpEl) return;
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); sendCommand("next"); }
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); sendCommand("prev"); }
});
function sendCommand(action, index){
  const msg = { type: "command", action, index, stamp: Date.now() };
  if (window.presenterChannel) window.presenterChannel.postMessage(msg);
  else localStorage.setItem(commandKey, JSON.stringify(msg));
}
if (typeof BroadcastChannel !== "undefined") {
  window.presenterChannel = new BroadcastChannel("slideforge-presenter");
  window.presenterChannel.addEventListener("message", event => {
    const payload = event.data || {};
    if (payload.type === "state") updateFromPayload(payload);
    if (payload.type === "timer") updateClock(payload);
  });
}
window.addEventListener("storage", event => {
  if (event.key === syncKey && event.newValue) {
    try {
      const payload = JSON.parse(event.newValue);
      if (payload.type === "timer") updateClock(payload); else updateFromPayload(payload);
    } catch (_err) {}
  }
});
document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.getAttribute("data-action");
    if (["next", "prev", "reset-timer", "toggle-timer", "toggle-recording"].includes(action)) sendCommand(action);
  });
});
jumpEl.addEventListener("change", () => sendCommand("jump", Math.max(0, (parseInt(jumpEl.value, 10) || 1) - 1)));
// Ask for the slide now that this window listens: this script runs only once the copied stylesheets have loaded,
// and a slide sent before that was missed (the window stayed blank until the next slide).
sendCommand("ready");
</script>
</body>
</html>`;
}

function openPresenterView() {
    _ensurePresenterMessaging();
    const existing = _presentationRuntimeState.presenterWindow;
    if (existing && !existing.closed) {
        existing.focus();
        _syncPresenterPayload();
        return existing;
    }
    // Opening a window makes the browser leave fullscreen. That must not end the presentation (which would also
    // close this window again): play-mode.js ignores the fullscreen exit for a moment. F returns to fullscreen.
    _presentationRuntimeState.fullscreenExitExpectedUntil = Date.now() + 2500;
    const presenterWindow = window.open("", "slideforge-presenter", "popup=yes,width=1400,height=900");
    if (!presenterWindow) return null;
    presenterWindow.document.open();
    presenterWindow.document.write(_presenterWindowHtml());
    presenterWindow.document.close();
    _presentationRuntimeState.presenterWindow = presenterWindow;
    setTimeout(() => _syncPresenterPayload(), 300);
    return presenterWindow;
}
