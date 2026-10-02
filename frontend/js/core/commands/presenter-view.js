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
    const nextSlide = state.slides?.[currentSlideIndex + 1];
    const liveNextSection = nextSlide ? document.getElementById(nextSlide.id) : null;
    const nextSection = liveNextSection || buildPresenterSection(nextSlide);
    const payload = {
        type: "state",
        currentIndex: currentSlideIndex,
        total: state.slides?.length || 0,
        notes: state.slides?.[currentSlideIndex]?.notes || "",
        elapsedMs: Math.max(0, Date.now() - (_presentationRuntimeState.presenterStartTs || Date.now())),
        slideWidth: Number(slideConfig.width) || 1024,
        slideHeight: Number(slideConfig.height) || 768,
        // The theme's colours (slide background, text, accents): the presenter window has the app's stylesheets
        // but not these variables, without which slides were drawn on black.
        cssVars: (typeof getPresentationTheme === "function" && getPresentationTheme()?.cssVars) || {},
        currentHtml: _presenterSectionHtml(currentSection),
        nextHtml: _presenterSectionHtml(nextSection),
    };
    if (_presentationRuntimeState.channel) {
        _presentationRuntimeState.channel.postMessage(payload);
    } else {
        localStorage.setItem(_PRESENTER_SYNC_STORAGE_KEY, JSON.stringify({ ...payload, stamp: Date.now() }));
    }
}

// A slide's markup for the presenter window. Canvases (charts) carry no pixels in markup, so each is sent as a
// picture of what it shows now. Editor-only marks are left out: the presenter window has no rule hiding them,
// so an animation's "⚡ Slide" badge showed on its preview.
function _presenterSectionHtml(section) {
    if (!section) return "";
    const canvases = [...section.querySelectorAll("canvas")];
    const copy = section.cloneNode(true);
    copy.querySelectorAll(".anim-badge, .resize-handle, .crop-handle, .connector-point-handle").forEach(node => node.remove());
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
            if (msg.type === "command") {
                if (msg.action === "next") presentationNextStep();
                if (msg.action === "prev") presentationPrevStep();
                if (msg.action === "jump") presentationGoToSlide(Number(msg.index) || 0);
                if (msg.action === "reset-timer") {
                    _presentationRuntimeState.presenterStartTs = Date.now();
                    _syncPresenterPayload();
                }
            }
        });
    }
    window.addEventListener("storage", event => {
        if (event.key !== _PRESENTER_COMMAND_STORAGE_KEY || !event.newValue) return;
        try {
            const msg = JSON.parse(event.newValue);
            if (msg.action === "next") presentationNextStep();
            if (msg.action === "prev") presentationPrevStep();
            if (msg.action === "jump") presentationGoToSlide(Number(msg.index) || 0);
            if (msg.action === "reset-timer") {
                _presentationRuntimeState.presenterStartTs = Date.now();
                _syncPresenterPayload();
            }
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
</style>
</head>
<body>
<div class="presenter-shell">
  <div class="presenter-main">
    <div class="presenter-head">
      <div><div class="presenter-title">Current Slide</div><div id="presenter-meta" class="presenter-meta">1 / 1</div></div>
      <div><div class="presenter-title">Elapsed</div><div id="presenter-timer" class="presenter-meta">00:00</div></div>
    </div>
    <div class="presenter-card presenter-stage"><div id="presenter-current" class="presenter-slide-frame"></div></div>
    <div class="presenter-controls">
      <button data-action="prev" type="button">Previous</button>
      <button data-action="next" type="button">Next</button>
      <input id="presenter-jump" type="number" min="1" placeholder="Slide #" />
      <button data-action="reset-timer" type="button">Reset Timer</button>
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
const jumpEl = document.getElementById("presenter-jump");
function formatTime(ms){const s=Math.max(0,Math.floor(ms/1000));const m=String(Math.floor(s/60)).padStart(2,"0");const r=String(s%60).padStart(2,"0");return m+":"+r;}
let slideSize = { width: 1024, height: 768 };
let timerBase = { elapsed: 0, at: Date.now() };
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
  timerBase = { elapsed: payload.elapsedMs || 0, at: Date.now() };
  timerEl.textContent = formatTime(timerBase.elapsed);
  fitSlides();
}
window.addEventListener("resize", fitSlides);
setInterval(() => { timerEl.textContent = formatTime(timerBase.elapsed + Date.now() - timerBase.at); }, 1000);
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
  });
}
window.addEventListener("storage", event => {
  if (event.key === syncKey && event.newValue) {
    try { updateFromPayload(JSON.parse(event.newValue)); } catch (_err) {}
  }
});
document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.getAttribute("data-action");
    if (action === "next" || action === "prev" || action === "reset-timer") sendCommand(action);
  });
});
jumpEl.addEventListener("change", () => sendCommand("jump", Math.max(0, (parseInt(jumpEl.value, 10) || 1) - 1)));
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
