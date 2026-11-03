// Recording a slide show and timing it, as PowerPoint's "Record Slide Show" and "Rehearse Timings" (and WPS's
// screen recorder) do.
//
// - The timer counts the whole talk and the current slide, or down from a talk length kept with the deck
//   (state.showSettings.targetMinutes). T shows or hides it, Shift+T pauses it. The presenter view shows it too.
// - The recorder makes one video of the show (this tab, through getDisplayMedia) with the microphone and the
//   slides' own sound. R pauses and resumes it (one file, the pauses left out), Shift+R stops it. Where the browser
//   has Element Capture, only the slide stage (#presentation-stage) is in the video, not the timer or menus.
//   Without screen capture it records the sound alone. The result is downloaded; nothing goes to the server.

const SF_SHOW_TIMER_PREFS_KEY = "slideforge_show_timer";
const SF_RECORDING_WARN_BYTES = 1024 * 1024 * 1024;

// ─── Timer ─────────────────────────────────────────────────────────────────────────────────────────────────────

// The talk's clock. Pure (the clock is passed in) so it can be tested with a fake one.
class ShowTimer {
    constructor(now = () => performance.now()) {
        this.now = now;
        this.targetMs = 0;
        this.active = false;
        this.running = false;
        this.totalBase = 0;
        this.slideBase = 0;
        this.runningSince = 0;
        this.slideSince = 0;
        this.slideIndex = null;
    }

    start(slideIndex = null) {
        const now = this.now();
        Object.assign(this, { active: true, running: true, totalBase: 0, slideBase: 0, runningSince: now, slideSince: now, slideIndex });
    }

    stop() {
        this.pause();
        this.active = false;
    }

    pause() {
        if (!this.running) return;
        const now = this.now();
        this.totalBase += now - this.runningSince;
        this.slideBase += now - this.slideSince;
        this.running = false;
    }

    resume() {
        if (this.running || !this.active) return;
        const now = this.now();
        this.runningSince = now;
        this.slideSince = now;
        this.running = true;
    }

    reset() {
        const now = this.now();
        this.totalBase = 0;
        this.slideBase = 0;
        this.runningSince = now;
        this.slideSince = now;
    }

    // A new slide starts its own count; stepping through the same slide's builds does not.
    markSlide(index) {
        if (index === this.slideIndex) return;
        this.slideIndex = index;
        this.slideBase = 0;
        this.slideSince = this.now();
    }

    setTarget(minutes) {
        const value = Number(minutes);
        this.targetMs = Number.isFinite(value) && value > 0 ? Math.round(value * 60000) : 0;
    }

    // Amber for the last fifth of the talk (at least two minutes, at most half of it), red once time is up.
    static warnMs(targetMs) {
        return Math.min(Math.max(targetMs * 0.2, 120000), targetMs * 0.5);
    }

    snapshot() {
        const now = this.now();
        const totalMs = this.totalBase + (this.running ? now - this.runningSince : 0);
        const slideMs = this.slideBase + (this.running ? now - this.slideSince : 0);
        const remainingMs = this.targetMs ? this.targetMs - totalMs : null;
        let phase = "normal";
        if (this.targetMs) phase = remainingMs <= 0 ? "over" : remainingMs <= ShowTimer.warnMs(this.targetMs) ? "warn" : "normal";
        return { active: this.active, running: this.running, totalMs, slideMs, targetMs: this.targetMs, remainingMs, phase };
    }
}

// "4:05", "1:02:03"; a negative time is shown without its sign (the label says "left" or "over").
function formatShowTime(ms) {
    const seconds = Math.floor(Math.abs(ms) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${String(m).padStart(2, "0")}:${s}`;
}

const showTimer = new ShowTimer();

function _readShowTimerPrefs() {
    try {
        const prefs = JSON.parse(localStorage.getItem(SF_SHOW_TIMER_PREFS_KEY) || "{}");
        return { visible: prefs.visible === true };
    } catch (_error) {
        return { visible: false };
    }
}

function _writeShowTimerPrefs(prefs) {
    try {
        localStorage.setItem(SF_SHOW_TIMER_PREFS_KEY, JSON.stringify(prefs));
    } catch (_error) {
        // a private window: the choice lasts for this session only
    }
}

const _showUi = { timerVisible: _readShowTimerPrefs().visible, tick: null, bound: false };

function getShowTargetMinutes() {
    const value = Number(state?.showSettings?.targetMinutes);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function setShowTargetMinutes(minutes) {
    const value = Math.round((Number(minutes) || 0) * 10) / 10;
    if (value > 0 && value <= 24 * 60) state.showSettings = { ...(state.showSettings || {}), targetMinutes: value };
    else if (state.showSettings) delete state.showSettings.targetMinutes;
    if (state.showSettings && !Object.keys(state.showSettings).length) delete state.showSettings;
    showTimer.setTarget(getShowTargetMinutes());
    if (typeof schedulePresentationAutosave === "function") schedulePresentationAutosave();
    _renderShowHud();
}

// Called by play-mode.js when a show starts and ends, and on every slide change during it.
function showTimerOnShowStart(slideIndex) {
    showTimer.setTarget(getShowTargetMinutes());
    showTimer.start(slideIndex);
    _ensureShowHud();
    _startShowHudTick();
    _renderShowHud();
}

function showTimerOnSlideChange(slideIndex) {
    if (!showTimer.active) return;
    showTimer.markSlide(slideIndex);
    _renderShowHud();
}

function setShowTimerVisible(visible) {
    _showUi.timerVisible = !!visible;
    _writeShowTimerPrefs({ visible: _showUi.timerVisible });
    _renderShowHud();
    _updateShowMenuItems();
}

function toggleShowTimerVisible() {
    setShowTimerVisible(!_showUi.timerVisible);
}

function toggleShowTimerRunning() {
    if (!showTimer.active) return;
    if (showTimer.running) showTimer.pause();
    else showTimer.resume();
    _renderShowHud();
    _updateShowMenuItems();
    _syncPresenterTimer();
}

function resetShowTimer() {
    showTimer.reset();
    _renderShowHud();
    _syncPresenterTimer();
}

// What the presenter window needs to show the same clock.
function showTimerPayload() {
    return {
        timer: showTimer.snapshot(),
        recording: { state: _rec.state, ms: _recordedMs(), audioOnly: _rec.audioOnly },
    };
}

function _syncPresenterTimer() {
    if (typeof _postPresenterMessage === "function") _postPresenterMessage({ type: "timer", ...showTimerPayload() });
}

// ─── Recorder ──────────────────────────────────────────────────────────────────────────────────────────────────

const _rec = {
    state: "idle", // idle | preparing | ready | countdown | recording | paused | stopping
    display: null, // the screen-capture stream
    mic: null,
    micDeviceId: "",
    slideSound: true,
    useMic: true,
    audioOnly: false,
    dest: null, // the mixed sound
    silence: null, // keeps the mix producing sound frames (see _prepareRecordingStreams)
    tabAudio: false,
    stageOnly: false, // Element Capture applied: the video holds the slide stage only
    recorder: null,
    mime: "",
    chunks: [],
    bytes: 0,
    activeSince: 0,
    activeMs: 0,
    pending: null, // { blob, url, durationMs, mime, ext, saved }
    countdownTimer: null,
    stoppedForShowEnd: false,
};

// One AudioContext for the whole session: a media element routed through it (for its sound to be recorded)
// stays tied to it for good, so closing it would silence that element.
let _sfRecAudioContext = null;
const _sfRoutedMedia = new WeakMap(); // element → MediaElementAudioSourceNode

function _recAudioContext() {
    if (!_sfRecAudioContext) _sfRecAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (_sfRecAudioContext.state === "suspended") _sfRecAudioContext.resume().catch(() => {});
    return _sfRecAudioContext;
}

function showRecorderSupported() {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function screenCaptureSupported() {
    return !!navigator.mediaDevices?.getDisplayMedia;
}

// Element Capture: the video holds the slide stage only (Chromium 132+).
function elementCaptureSupported() {
    return typeof RestrictionTarget !== "undefined" && typeof RestrictionTarget.fromElement === "function";
}

function isShowRecording() {
    return _rec.state === "recording" || _rec.state === "paused";
}

function _recordedMs() {
    return _rec.activeMs + (_rec.state === "recording" ? performance.now() - _rec.activeSince : 0);
}

async function _openMic(deviceId = "") {
    _rec.mic?.getTracks().forEach(track => track.stop());
    _rec.mic = null;
    _rec.mic = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return _rec.mic;
}

function _releaseRecordingStreams() {
    _rec.display?.getTracks().forEach(track => track.stop());
    _rec.mic?.getTracks().forEach(track => track.stop());
    _rec.display = null;
    _rec.mic = null;
    _rec.tabAudio = false;
    _rec.stageOnly = false;
    if (_rec.dest) {
        // Slide media stay routed to the speakers; only their branch into the recording is cut.
        document.querySelectorAll("audio, video").forEach(media => {
            try {
                _sfRoutedMedia.get(media)?.disconnect(_rec.dest);
            } catch (_error) {
                // was not connected to this recording
            }
        });
    }
    try {
        _rec.silence?.stop();
    } catch (_error) {
        // already stopped
    }
    _rec.silence = null;
    _rec.dest = null;
}

// Asks for the screen (the browser shows its picker) and builds the mixed sound. Throws with a readable message.
async function _prepareRecordingStreams({ audioOnly }) {
    _rec.audioOnly = !!audioOnly;
    const ctx = _recAudioContext();
    _rec.dest = ctx.createMediaStreamDestination();
    // A mix with nothing playing into it yet (microphone off, no tab sound, the slide with a video still ahead)
    // gives no sound frames, and Chrome's recorder then wrote nothing at all. Silence keeps it going.
    _rec.silence = ctx.createConstantSource();
    _rec.silence.offset.value = 0;
    _rec.silence.connect(_rec.dest);
    _rec.silence.start();
    if (!audioOnly) {
        if (!screenCaptureSupported()) throw new Error("This browser cannot record the screen.");
        let display;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser", frameRate: { ideal: 30 } },
                audio: _rec.slideSound ? { suppressLocalAudioPlayback: false } : false,
                preferCurrentTab: true,
                selfBrowserSurface: "include",
                surfaceSwitching: "exclude",
                systemAudio: "exclude",
            });
        } catch (error) {
            if (error?.name === "NotAllowedError") throw new Error("Screen sharing was not allowed.");
            throw new Error(`The screen could not be shared (${error?.message || error}).`);
        }
        _rec.display = display;
        const video = display.getVideoTracks()[0];
        if (video) {
            video.contentHint = "detail";
            const stage = document.getElementById("presentation-stage");
            if (stage && elementCaptureSupported() && typeof video.restrictTo === "function") {
                try {
                    await video.restrictTo(await RestrictionTarget.fromElement(stage));
                    _rec.stageOnly = true;
                } catch (error) {
                    console.warn("Recording the whole tab: Element Capture failed", error);
                }
            }
            // "Stop sharing" in the browser's bar ends the recording.
            video.addEventListener("ended", () => {
                if (isShowRecording()) stopShowRecording();
            });
        }
        const tabAudio = display.getAudioTracks()[0];
        if (tabAudio) {
            ctx.createMediaStreamSource(new MediaStream([tabAudio])).connect(_rec.dest);
            _rec.tabAudio = true;
        }
    }
    if (_rec.useMic) {
        const mic = _rec.mic?.getAudioTracks().some(track => track.readyState === "live") ? _rec.mic : await _openMic(_rec.micDeviceId);
        ctx.createMediaStreamSource(mic).connect(_rec.dest);
    }
    if (_rec.slideSound && !_rec.tabAudio) _routePlayingSlideMedia();
}

// The slides' sound when the browser gave no tab audio (Firefox, the desktop app): a slide's audio or video is
// sent through the AudioContext, to the speakers as before and into the recording. Media from another site are
// left alone (routing them without CORS would silence them).
function _routeSlideMedia(media) {
    if (!_rec.dest || !_rec.slideSound || _rec.tabAudio || !(media instanceof HTMLMediaElement)) return;
    const src = media.currentSrc || media.src || "";
    let sameOrigin = false;
    try {
        sameOrigin = src.startsWith("blob:") || src.startsWith("data:") || new URL(src, location.href).origin === location.origin;
    } catch (_error) {
        sameOrigin = false;
    }
    if (!sameOrigin) return;
    const ctx = _recAudioContext();
    let source = _sfRoutedMedia.get(media);
    try {
        if (!source) {
            source = ctx.createMediaElementSource(media);
            source.connect(ctx.destination);
            _sfRoutedMedia.set(media, source);
        }
        source.connect(_rec.dest);
    } catch (error) {
        console.warn("A slide's sound could not be recorded", error);
    }
}

function _routePlayingSlideMedia() {
    document.querySelectorAll("#slides-container audio, #slides-container video").forEach(media => {
        if (!media.paused) _routeSlideMedia(media);
    });
}

function _pickRecordingMime(audioOnly) {
    const candidates = audioOnly
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function _startMediaRecorder() {
    const tracks = [
        ...(_rec.display?.getVideoTracks() || []),
        ...(_rec.dest?.stream.getAudioTracks() || []),
    ];
    _rec.mime = _pickRecordingMime(_rec.audioOnly);
    const recorder = new MediaRecorder(new MediaStream(tracks), {
        ...(_rec.mime ? { mimeType: _rec.mime } : {}),
        ...(_rec.audioOnly ? { audioBitsPerSecond: 128000 } : { videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 }),
    });
    _rec.mime = recorder.mimeType || _rec.mime || (_rec.audioOnly ? "audio/webm" : "video/webm");
    _rec.chunks = [];
    _rec.bytes = 0;
    _rec.activeMs = 0;
    recorder.addEventListener("dataavailable", event => {
        if (!event.data?.size) return;
        _rec.chunks.push(event.data);
        _rec.bytes += event.data.size;
    });
    recorder.addEventListener("error", event => {
        console.error("Recording failed", event.error || event);
        stopShowRecording();
    });
    recorder.start(1000);
    _rec.recorder = recorder;
    _rec.activeSince = performance.now();
    _rec.state = "recording";
}

function pauseShowRecording() {
    if (_rec.state !== "recording") return;
    _rec.recorder?.pause();
    _rec.activeMs += performance.now() - _rec.activeSince;
    _rec.state = "paused";
    _afterRecordingStateChange();
}

function resumeShowRecording() {
    if (_rec.state !== "paused") return;
    _rec.recorder?.resume();
    _rec.activeSince = performance.now();
    _rec.state = "recording";
    _afterRecordingStateChange();
}

function toggleShowRecordingPaused() {
    if (_rec.state === "recording") pauseShowRecording();
    else if (_rec.state === "paused") resumeShowRecording();
}

// Stops and offers the file. Resolves once the save dialog is open (or nothing was recorded).
async function stopShowRecording() {
    if (!isShowRecording()) return;
    const recorder = _rec.recorder;
    if (_rec.state === "recording") _rec.activeMs += performance.now() - _rec.activeSince;
    _rec.state = "stopping";
    _afterRecordingStateChange();
    if (recorder && recorder.state !== "inactive") {
        await new Promise(resolve => {
            recorder.addEventListener("stop", resolve, { once: true });
            recorder.stop();
        });
    }
    _rec.recorder = null;
    _releaseRecordingStreams();
    const durationMs = Math.round(_rec.activeMs);
    let blob = new Blob(_rec.chunks, { type: _rec.mime });
    _rec.chunks = [];
    // MediaRecorder's WebM has no duration, so players could not seek it. Very large files are left as they are
    // (the fix reads the whole file into memory once more).
    if (blob.size && blob.size < SF_RECORDING_WARN_BYTES && typeof window.ysFixWebmDuration === "function" && /webm/.test(_rec.mime)) {
        try {
            blob = await window.ysFixWebmDuration(blob, durationMs, { logger: false });
        } catch (error) {
            console.warn("The recording's length could not be written", error);
        }
    }
    _rec.state = "idle";
    _rec.audioOnly = _rec.audioOnly && blob.size > 0;
    _afterRecordingStateChange();
    if (!blob.size) {
        await _whenShowUiSettled();
        _showRecordingProblem("Nothing was recorded: the browser sent no picture or sound. Try again, or record the sound only.");
        return;
    }
    _rec.pending = {
        blob,
        url: URL.createObjectURL(blob),
        durationMs,
        mime: blob.type || _rec.mime,
        ext: /^audio\//.test(blob.type || _rec.mime) ? "weba" : "webm",
        saved: false,
    };
    await _whenShowUiSettled();
    openShowRecordingSaveDialog();
}

// After a show has ended, the save dialog waits for the editor to come back (it would otherwise open in the
// fullscreen stage that is being taken down).
function _whenShowUiSettled() {
    if (!_rec.stoppedForShowEnd) return Promise.resolve();
    return new Promise(resolve => {
        const started = performance.now();
        const check = () => {
            if (!document.body.classList.contains("play-mode-active") || performance.now() - started > 3000) resolve();
            else setTimeout(check, 50);
        };
        check();
    });
}

function _cancelRecordingSetup() {
    clearInterval(_rec.countdownTimer);
    _rec.countdownTimer = null;
    document.getElementById("sf-rec-countdown")?.remove();
    if (_rec.state === "preparing" || _rec.state === "ready" || _rec.state === "countdown") {
        _releaseRecordingStreams();
        _rec.state = "idle";
    }
    _afterRecordingStateChange();
}

// play-mode.js: the show is ending (Esc, Exit, leaving fullscreen).
function showRecorderOnShowEnd() {
    showTimer.stop();
    _stopShowHudTick();
    _closeShowRecorderSetup();
    _cancelRecordingSetup();
    if (isShowRecording()) {
        _rec.stoppedForShowEnd = true;
        stopShowRecording().finally(() => {
            _rec.stoppedForShowEnd = false;
        });
    }
}

function _afterRecordingStateChange() {
    _renderShowHud();
    _updateShowMenuItems();
    _syncPresenterTimer();
}

// R during a show and the menu's Record item: set up a recording, or pause/resume the one running.
function showRecorderPrimaryAction() {
    if (isShowRecording()) toggleShowRecordingPaused();
    else if (_rec.state === "idle") openShowRecorder();
}

// ─── The 3-2-1 countdown and the start ─────────────────────────────────────────────────────────────────────────

function _showStageContainer() {
    return document.body.classList.contains("play-mode-active") ? document.getElementById("canvas-wrapper") || document.body : document.body;
}

// The user's click that starts the show: fullscreen needs it. Then 3-2-1 on the slide, then recording.
function _beginRecordedShow({ fromFirst }) {
    const playing = document.body.classList.contains("play-mode-active");
    _recAudioContext(); // resumes a suspended mix while the click still counts
    _closeShowRecorderSetup({ keepStreams: true });
    if (!playing) {
        if (fromFirst) {
            const first = presentationShownSlideFrom(-1, 1);
            window.switchSlide?.(first >= 0 ? first : 0);
        }
        togglePlayMode();
    } else if (!document.fullscreenElement) {
        _syncBrowserFullscreen(true);
    }
    _rec.state = "countdown";
    _afterRecordingStateChange();
    const card = document.createElement("div");
    card.id = "sf-rec-countdown";
    card.className = "sf-rec-countdown";
    card.setAttribute("data-presentation-ui", "");
    card.setAttribute("role", "status");
    card.innerHTML = `<div class="sf-rec-countdown__number">3</div><div class="sf-rec-countdown__hint">Recording starts… click to start now</div>`;
    // After play mode has moved the stage into fullscreen.
    requestAnimationFrame(() => _showStageContainer().appendChild(card));
    let count = 3;
    const go = () => {
        clearInterval(_rec.countdownTimer);
        _rec.countdownTimer = null;
        card.remove();
        if (_rec.state !== "countdown") return;
        if (_rec.slideSound && !_rec.tabAudio) _routePlayingSlideMedia();
        _startMediaRecorder();
        // A recording made from the editor starts the talk's clock with it.
        if (!playing) {
            showTimer.reset();
            if (!showTimer.running) showTimer.resume();
        }
        _afterRecordingStateChange();
    };
    card.addEventListener("click", event => {
        event.stopPropagation();
        go();
    });
    _rec.countdownTimer = setInterval(() => {
        count -= 1;
        if (count <= 0) go();
        else card.querySelector(".sf-rec-countdown__number").textContent = String(count);
    }, 1000);
}

// ─── Dialogs ───────────────────────────────────────────────────────────────────────────────────────────────────

function _recEscape(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function _showRecorderModal(id) {
    let modal = document.getElementById(id);
    if (!modal) {
        modal = document.createElement("div");
        modal.id = id;
        modal.className = "share-modal sf-rec-modal hidden";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("data-presentation-ui", "");
        modal.innerHTML = `<div class="share-card sf-rec-card"></div>`;
    }
    // In fullscreen only the stage is shown: the dialog goes inside it during a show.
    const container = _showStageContainer();
    if (modal.parentElement !== container) container.appendChild(modal);
    return modal;
}

const _setup = { meterFrame: 0, analyser: null, busy: false, error: "", step: "options" };

function _closeShowRecorderSetup({ keepStreams = false } = {}) {
    cancelAnimationFrame(_setup.meterFrame);
    _setup.analyser = null;
    const modal = document.getElementById("sf-rec-setup");
    _releaseFocusFrom(modal);
    if (modal) modal.classList.add("hidden");
    if (!keepStreams && (_rec.state === "preparing" || _rec.state === "ready")) {
        _releaseRecordingStreams();
        _rec.state = "idle";
        _afterRecordingStateChange();
    } else if (!keepStreams && _rec.state === "idle") {
        // The level meter's microphone.
        _rec.mic?.getTracks().forEach(track => track.stop());
        _rec.mic = null;
    }
}

function isShowRecorderDialogOpen() {
    return [...document.querySelectorAll(".sf-rec-modal")].some(modal => !modal.classList.contains("hidden"));
}

// Keys typed in a recorder dialog are the dialog's, not the show's (typing a talk length moved slides).
function showRecorderOwnsKey(event) {
    return isShowRecorderDialogOpen();
}

// Focus left in a dialog that has closed kept the show's keys from working (Esc did not end the show).
function _releaseFocusFrom(modal) {
    if (modal && modal.contains(document.activeElement)) document.activeElement.blur();
}

async function openShowRecorder() {
    if (!showRecorderSupported()) {
        window.alert("This browser cannot record. Use a current Chrome, Edge or Firefox.");
        return;
    }
    if (isShowRecording() || _rec.state === "countdown") return;
    if (_rec.pending && !_rec.pending.saved) {
        openShowRecordingSaveDialog({ before: true });
        return;
    }
    _setup.error = "";
    _setup.busy = false;
    _setup.step = "options";
    _renderShowRecorderSetup();
    document.getElementById("sf-rec-setup").classList.remove("hidden");
    if (_rec.useMic) _startMicPreview();
}

async function _startMicPreview() {
    try {
        const mic = await _openMic(_rec.micDeviceId);
        const ctx = _recAudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(mic).connect(analyser);
        _setup.analyser = analyser;
        await _fillMicDevices();
        const data = new Uint8Array(analyser.fftSize);
        const draw = () => {
            const bar = document.querySelector("#sf-rec-setup [data-rec-meter] span");
            if (!bar || _setup.analyser !== analyser) return;
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
            bar.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
            _setup.meterFrame = requestAnimationFrame(draw);
        };
        cancelAnimationFrame(_setup.meterFrame);
        draw();
    } catch (error) {
        _setup.error = error?.name === "NotAllowedError"
            ? "The microphone was not allowed. Allow it in the browser's site settings, or record without it."
            : `The microphone could not be opened (${error?.message || error}).`;
        _renderShowRecorderSetup();
    }
}

async function _fillMicDevices() {
    const select = document.querySelector("#sf-rec-setup [data-rec-mic-device]");
    if (!select || !navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput");
    const current = _rec.mic?.getAudioTracks()[0]?.getSettings?.().deviceId || _rec.micDeviceId;
    select.innerHTML = devices
        .map((device, index) => `<option value="${_recEscape(device.deviceId)}" ${device.deviceId === current ? "selected" : ""}>${_recEscape(device.label || `Microphone ${index + 1}`)}</option>`)
        .join("");
    select.disabled = devices.length < 2;
}

function _renderShowRecorderSetup() {
    const modal = _showRecorderModal("sf-rec-setup");
    const card = modal.querySelector(".sf-rec-card");
    const playing = document.body.classList.contains("play-mode-active");
    const screen = screenCaptureSupported();
    const target = getShowTargetMinutes();
    const error = _setup.error ? `<p class="share-error">${_recEscape(_setup.error)}</p>` : "";
    const head = `<div class="share-head"><div><div class="share-title"><i class="fa-solid fa-circle-dot sf-rec-red"></i> Record slide show</div>
        <div class="share-subtitle">A video of the show with your voice, saved to a file when you stop.</div></div>
        <button type="button" class="share-close" data-rec="cancel" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>`;
    if (_setup.step === "ready") {
        const wholeWindow = !_rec.audioOnly && !_rec.stageOnly
            ? `<p class="share-warn"><i class="fa-solid fa-circle-info"></i> The whole window is recorded here, so the timer and the REC badge are in the video. Press <b>T</b> to hide the timer, or keep it in the presenter view (<b>P</b>).</p>`
            : "";
        card.innerHTML = `${head}${error}
            <p class="share-text">${_rec.audioOnly ? "The microphone is ready." : "The screen is shared."} Start the show: it counts down 3-2-1, then records.</p>${wholeWindow}
            <p class="share-hint">During the show: <b>R</b> pauses and resumes the recording, <b>Shift+R</b> stops it, <b>T</b> shows or hides the timer, <b>Shift+T</b> pauses it, <b>Esc</b> ends the show and the recording.</p>
            <div class="share-row share-row-end">
                <button type="button" class="share-btn" data-rec="cancel">Cancel</button>
                <button type="button" class="share-btn share-btn-primary sf-rec-start" data-rec="begin"><i class="fa-solid fa-play"></i> ${playing ? "Start recording" : "Start the show"}</button>
            </div>`;
        return;
    }
    const noScreen = !screen
        ? `<p class="share-warn"><i class="fa-solid fa-triangle-exclamation"></i> This browser cannot record the screen: only the sound will be recorded.</p>`
        : !elementCaptureSupported()
            ? `<p class="share-hint">In this browser the timer and the recording badge are in the video too; press <b>T</b> to hide the timer, or keep it in the presenter view (<b>P</b>).</p>`
            : "";
    card.innerHTML = `${head}${error}${noScreen}
        <div class="sf-rec-options">
            <label class="sf-rec-option"><input type="checkbox" data-rec-opt="mic" ${_rec.useMic ? "checked" : ""}/> <span><i class="fa-solid fa-microphone"></i> Microphone</span></label>
            <div class="sf-rec-mic ${_rec.useMic ? "" : "is-off"}">
                <select class="share-link-input" data-rec-mic-device aria-label="Microphone"><option>Default microphone</option></select>
                <div class="sf-rec-meter" data-rec-meter title="Microphone level"><span></span></div>
            </div>
            <label class="sf-rec-option"><input type="checkbox" data-rec-opt="slideSound" ${_rec.slideSound ? "checked" : ""}/> <span><i class="fa-solid fa-volume-high"></i> Slide sound <small>(videos and sounds on the slides)</small></span></label>
            <label class="sf-rec-option"><input type="checkbox" data-rec-opt="timer" ${_showUi.timerVisible ? "checked" : ""}/> <span><i class="fa-solid fa-stopwatch"></i> Show the timer</span></label>
            <label class="sf-rec-option sf-rec-target"><span>Talk length</span>
                <input type="number" min="0" max="1440" step="1" class="share-link-input" data-rec-target value="${target || ""}" placeholder="—"/> <span>min</span>
                <small>Counts down when set; blank counts up.</small></label>
            ${playing ? "" : `<div class="sf-rec-option sf-rec-from"><span>Start from</span>
                <label><input type="radio" name="sf-rec-from" value="first" checked/> First slide</label>
                <label><input type="radio" name="sf-rec-from" value="current"/> This slide</label></div>`}
        </div>
        <div class="share-row share-row-end">
            <button type="button" class="share-btn" data-rec="cancel">Cancel</button>
            <button type="button" class="share-btn share-btn-primary sf-rec-start" data-rec="prepare" ${_setup.busy ? "disabled" : ""}>
                ${_setup.busy ? '<span class="share-spinner"></span> Waiting for the browser…' : `<i class="fa-solid fa-circle-dot"></i> ${screen ? "Start recording" : "Record sound"}`}</button>
        </div>
        ${screen && _setup.offerAudioOnly ? `<p class="share-hint"><button type="button" class="share-btn" data-rec="audio-only"><i class="fa-solid fa-microphone"></i> Record the sound only</button></p>` : ""}`;
    if (_setup.analyser) _fillMicDevices();
    _bindShowRecorderSetup(modal);
}

function _bindShowRecorderSetup(modal) {
    if (modal.dataset.bound) return;
    modal.dataset.bound = "1";
    modal.addEventListener("click", event => {
        event.stopPropagation(); // a click in the dialog is not "next slide"
        const action = event.target.closest("[data-rec]")?.dataset.rec;
        if (event.target === modal || action === "cancel") _closeShowRecorderSetup();
        else if (action === "prepare") _prepareFromSetup({ audioOnly: !screenCaptureSupported() });
        else if (action === "audio-only") _prepareFromSetup({ audioOnly: true });
        else if (action === "begin") {
            const fromFirst = modal.querySelector('input[name="sf-rec-from"]:checked')?.value !== "current";
            _beginRecordedShow({ fromFirst });
        }
    });
    modal.addEventListener("change", event => {
        const opt = event.target.dataset.recOpt;
        if (opt === "mic") {
            _rec.useMic = event.target.checked;
            modal.querySelector(".sf-rec-mic")?.classList.toggle("is-off", !_rec.useMic);
            if (_rec.useMic) _startMicPreview();
            else {
                cancelAnimationFrame(_setup.meterFrame);
                _setup.analyser = null;
                _rec.mic?.getTracks().forEach(track => track.stop());
                _rec.mic = null;
            }
        } else if (opt === "slideSound") {
            _rec.slideSound = event.target.checked;
        } else if (opt === "timer") {
            setShowTimerVisible(event.target.checked);
        } else if (event.target.matches("[data-rec-mic-device]")) {
            _rec.micDeviceId = event.target.value;
            _startMicPreview();
        } else if (event.target.matches("[data-rec-target]")) {
            setShowTargetMinutes(event.target.value);
        }
    });
    modal.addEventListener("keydown", event => {
        if (modal.classList.contains("hidden")) return;
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            _closeShowRecorderSetup();
        }
    });
}

async function _prepareFromSetup({ audioOnly }) {
    const modal = document.getElementById("sf-rec-setup");
    const target = modal?.querySelector("[data-rec-target]");
    if (target) setShowTargetMinutes(target.value);
    if (audioOnly && !_rec.useMic && !_rec.slideSound) {
        _setup.error = "Switch on the microphone or the slide sound: there is nothing to record.";
        _renderShowRecorderSetup();
        return;
    }
    _setup.busy = true;
    _setup.error = "";
    _rec.state = "preparing";
    _renderShowRecorderSetup();
    // The browser's sharing prompt can take the page out of fullscreen; that must not end the show.
    _presentationRuntimeState.fullscreenExitExpectedUntil = Date.now() + 120000;
    try {
        await _prepareRecordingStreams({ audioOnly });
        _rec.state = "ready";
        _setup.busy = false;
        _setup.offerAudioOnly = false;
        cancelAnimationFrame(_setup.meterFrame);
        _setup.analyser = null;
        // Still the user's click (a quick "Allow"): go straight on, unless the video will show the timer (no
        // Element Capture: other browsers, the desktop app), which the ready step says. Otherwise one more click.
        if (navigator.userActivation?.isActive && (_rec.stageOnly || _rec.audioOnly)) {
            _beginRecordedShow({ fromFirst: modal?.querySelector('input[name="sf-rec-from"]:checked')?.value !== "current" });
        } else {
            _setup.step = "ready";
            _renderShowRecorderSetup();
        }
    } catch (error) {
        _releaseRecordingStreams();
        _rec.state = "idle";
        _setup.busy = false;
        _setup.error = error?.message || String(error);
        _setup.offerAudioOnly = !audioOnly;
        _renderShowRecorderSetup();
        if (_rec.useMic) _startMicPreview();
    } finally {
        _presentationRuntimeState.fullscreenExitExpectedUntil = Date.now() + 1500;
        _afterRecordingStateChange();
    }
}

function _recordingFileName(ext) {
    const title = (typeof _inferPresentationTitle === "function" ? _inferPresentationTitle() : "") || "Presentation";
    const now = new Date();
    const pad = value => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Presentation";
    return `${safe} – recording ${stamp}.${ext}`;
}

function _formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function openShowRecordingSaveDialog({ before = false } = {}) {
    const pending = _rec.pending;
    if (!pending) return;
    const modal = _showRecorderModal("sf-rec-save");
    const card = modal.querySelector(".sf-rec-card");
    const kind = pending.ext === "weba" ? "sound recording" : "recording";
    const media = pending.ext === "weba"
        ? `<audio class="sf-rec-preview" controls src="${pending.url}"></audio>`
        : `<video class="sf-rec-preview" controls playsinline src="${pending.url}"></video>`;
    card.innerHTML = `<div class="share-head"><div><div class="share-title"><i class="fa-solid fa-film"></i> ${before ? `Your last ${kind} is not saved` : `Your ${kind}`}</div>
        <div class="share-subtitle">${formatShowTime(pending.durationMs)} · ${_formatBytes(pending.blob.size)} · WebM</div></div>
        <button type="button" class="share-close" data-rec-save="close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        ${media}
        ${pending.saved ? `<p class="share-success">Saved. You can save another copy, or close this.</p>` : ""}
        <div class="share-row share-row-end">
            <button type="button" class="share-btn ${pending.saved ? "" : "share-btn-danger"}" data-rec-save="discard">${pending.saved ? "Done" : "Discard"}</button>
            <button type="button" class="share-btn share-btn-primary" data-rec-save="save"><i class="fa-solid fa-download"></i> ${pending.saved ? "Save again…" : "Save video…"}</button>
        </div>
        <p class="share-hint">WebM plays in Chrome, Edge, Firefox and VLC, and uploads to YouTube as it is.</p>`;
    _bindSaveDialog(modal);
    modal.classList.remove("hidden");
}

function _bindSaveDialog(modal) {
    if (!modal.dataset.bound) {
        modal.dataset.bound = "1";
        modal.addEventListener("click", event => {
            event.stopPropagation();
            const action = event.target.closest("[data-rec-save]")?.dataset.recSave;
            const current = _rec.pending;
            if (action === "close" && !current) {
                _closeSaveDialog({ keep: false }); // the "nothing was recorded" message
                return;
            }
            if (!action || !current) return;
            if (action === "save") {
                saveAs(current.blob, _recordingFileName(current.ext));
                current.saved = true;
                openShowRecordingSaveDialog();
            } else if (action === "close") {
                _closeSaveDialog({ keep: !current.saved });
            } else if (action === "discard") {
                if (!current.saved && event.target.closest("[data-rec-save]").dataset.confirm !== "1") {
                    const button = event.target.closest("[data-rec-save]");
                    button.dataset.confirm = "1";
                    button.textContent = "Discard: click again";
                    return;
                }
                _closeSaveDialog({ keep: false });
            }
        });
        modal.addEventListener("keydown", event => {
            if (modal.classList.contains("hidden")) return;
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                _closeSaveDialog({ keep: !_rec.pending?.saved });
            }
        });
    }
}

function _showRecordingProblem(message) {
    const modal = _showRecorderModal("sf-rec-save");
    modal.querySelector(".sf-rec-card").innerHTML = `<div class="share-head"><div class="share-title"><i class="fa-solid fa-triangle-exclamation"></i> Recording</div>
        <button type="button" class="share-close" data-rec-save="close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <p class="share-error">${_recEscape(message)}</p>
        <div class="share-row share-row-end"><button type="button" class="share-btn" data-rec-save="close">Close</button></div>`;
    _bindSaveDialog(modal);
    modal.classList.remove("hidden");
}

// Closing without saving keeps the recording until the next one (Record asks about it) or the page is left.
function _closeSaveDialog({ keep }) {
    const modal = document.getElementById("sf-rec-save");
    modal?.querySelector("video, audio")?.pause?.();
    _releaseFocusFrom(modal);
    modal?.classList.add("hidden");
    if (!keep && _rec.pending) {
        URL.revokeObjectURL(_rec.pending.url);
        _rec.pending = null;
    }
}

function getPendingShowRecording() {
    return _rec.pending;
}

// ─── HUD: the timer and the recording badge on the stage ───────────────────────────────────────────────────────

function _ensureShowHud() {
    let hud = document.getElementById("sf-show-hud");
    if (hud) return hud;
    const wrapper = document.getElementById("canvas-wrapper");
    if (!wrapper) return null;
    hud = document.createElement("div");
    hud.id = "sf-show-hud";
    hud.className = "sf-show-hud";
    hud.setAttribute("data-presentation-ui", "");
    hud.setAttribute("aria-live", "off");
    hud.innerHTML = `
        <div class="sf-show-hud__rec" data-hud-rec hidden>
            <span class="sf-show-hud__dot"></span><span data-hud-rec-label>REC</span><strong data-hud-rec-time>00:00</strong>
            <button type="button" data-hud="rec-toggle" title="Pause recording (R)"><i class="fa-solid fa-pause"></i></button>
            <button type="button" data-hud="rec-stop" title="Stop recording and save (Shift+R)"><i class="fa-solid fa-stop"></i></button>
        </div>
        <div class="sf-show-hud__timer" data-hud-timer hidden>
            <span class="sf-show-hud__label" data-hud-total-label>Total</span><strong data-hud-total>00:00</strong>
            <span class="sf-show-hud__sep"></span>
            <span class="sf-show-hud__label">Slide</span><strong data-hud-slide>00:00</strong>
            <button type="button" data-hud="timer-toggle" title="Pause timer (Shift+T)"><i class="fa-solid fa-pause"></i></button>
            <button type="button" data-hud="timer-reset" title="Reset timer"><i class="fa-solid fa-rotate-left"></i></button>
            <button type="button" data-hud="timer-hide" title="Hide timer (T)"><i class="fa-solid fa-eye-slash"></i></button>
        </div>`;
    hud.addEventListener("click", event => {
        event.stopPropagation();
        const action = event.target.closest("[data-hud]")?.dataset.hud;
        if (action === "rec-toggle") toggleShowRecordingPaused();
        else if (action === "rec-stop") stopShowRecording();
        else if (action === "timer-toggle") toggleShowTimerRunning();
        else if (action === "timer-reset") resetShowTimer();
        else if (action === "timer-hide") setShowTimerVisible(false);
    });
    hud.addEventListener("pointerdown", event => event.stopPropagation());
    wrapper.appendChild(hud);
    return hud;
}

function _renderShowHud() {
    const hud = document.getElementById("sf-show-hud");
    if (!hud) return;
    const snap = showTimer.snapshot();
    const recording = isShowRecording();
    const timerShown = _showUi.timerVisible && snap.active;
    hud.hidden = !timerShown && !recording;

    const rec = hud.querySelector("[data-hud-rec]");
    rec.hidden = !recording;
    if (recording) {
        const paused = _rec.state === "paused";
        rec.classList.toggle("is-paused", paused);
        rec.classList.toggle("is-large", _rec.bytes > SF_RECORDING_WARN_BYTES);
        rec.querySelector("[data-hud-rec-label]").textContent = paused ? "PAUSED" : _rec.audioOnly ? "REC (sound)" : "REC";
        rec.querySelector("[data-hud-rec-time]").textContent = formatShowTime(_recordedMs());
        rec.title = `${_formatBytes(_rec.bytes)} recorded${_rec.bytes > SF_RECORDING_WARN_BYTES ? ": a long recording; stop it before the computer runs short of memory" : ""}`;
        const toggle = rec.querySelector('[data-hud="rec-toggle"]');
        toggle.title = paused ? "Resume recording (R)" : "Pause recording (R)";
        toggle.innerHTML = `<i class="fa-solid ${paused ? "fa-circle-dot" : "fa-pause"}"></i>`;
    }

    const timer = hud.querySelector("[data-hud-timer]");
    timer.hidden = !timerShown;
    if (timerShown) {
        timer.dataset.phase = snap.phase;
        timer.classList.toggle("is-paused", !snap.running);
        const label = timer.querySelector("[data-hud-total-label]");
        const total = timer.querySelector("[data-hud-total]");
        if (snap.targetMs) {
            label.textContent = snap.remainingMs >= 0 ? "Left" : "Over";
            total.textContent = `${snap.remainingMs < 0 ? "+" : ""}${formatShowTime(snap.remainingMs)}`;
        } else {
            label.textContent = "Total";
            total.textContent = formatShowTime(snap.totalMs);
        }
        timer.querySelector("[data-hud-slide]").textContent = formatShowTime(snap.slideMs);
        const toggle = timer.querySelector('[data-hud="timer-toggle"]');
        toggle.title = snap.running ? "Pause timer (Shift+T)" : "Resume timer (Shift+T)";
        toggle.innerHTML = `<i class="fa-solid ${snap.running ? "fa-pause" : "fa-play"}"></i>`;
    }
}

function _startShowHudTick() {
    clearInterval(_showUi.tick);
    _showUi.tick = setInterval(_renderShowHud, 250);
}

function _stopShowHudTick() {
    clearInterval(_showUi.tick);
    _showUi.tick = null;
    _renderShowHud();
}

// The show menu's and right-click menu's items follow the state ("Pause recording" while recording).
function _updateShowMenuItems() {
    const recording = isShowRecording();
    const paused = _rec.state === "paused";
    const recordLabel = recording ? (paused ? "Resume Recording (R)" : "Pause Recording (R)") : "Record… (R)";
    const recordIcon = recording ? (paused ? "fa-circle-dot" : "fa-pause") : "fa-circle-dot";
    document.querySelectorAll("[data-show-action='record']").forEach(button => {
        button.innerHTML = `<i class="fa-solid ${recordIcon} sf-rec-red"></i><span>${recordLabel}</span>`;
        button.classList.toggle("is-active", recording && !paused);
    });
    document.querySelectorAll("[data-show-action='record-stop']").forEach(button => {
        button.classList.toggle("hidden", !recording);
    });
    document.querySelectorAll("[data-show-action='timer']").forEach(button => {
        button.innerHTML = `<i class="fa-solid fa-stopwatch"></i><span>${_showUi.timerVisible ? "Hide Timer (T)" : "Show Timer (T)"}</span>`;
        button.classList.toggle("is-active", _showUi.timerVisible);
    });
    document.querySelectorAll("[data-show-action='timer-pause']").forEach(button => {
        button.innerHTML = `<i class="fa-solid ${showTimer.running ? "fa-pause" : "fa-play"}"></i><span>${showTimer.running ? "Pause Timer (Shift+T)" : "Resume Timer (Shift+T)"}</span>`;
    });
}

// Keys during a show (presentation-tools.js asks first). Returns true when the key was the recorder's.
function handleShowRecorderKey(event) {
    const key = String(event.key || "").toLowerCase();
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (key === "r") {
        if (_rec.state === "countdown") return true;
        if (event.shiftKey) stopShowRecording();
        else showRecorderPrimaryAction();
        return true;
    }
    if (key === "t") {
        if (event.shiftKey) toggleShowTimerRunning();
        else toggleShowTimerVisible();
        return true;
    }
    return false;
}

function initShowRecorder() {
    if (_showUi.bound) return;
    _showUi.bound = true;
    document.addEventListener("click", event => {
        const action = event.target.closest?.("[data-show-action]")?.dataset.showAction;
        if (!action) return;
        event.stopPropagation();
        closePresentationMenus?.();
        if (action === "record") showRecorderPrimaryAction();
        else if (action === "record-stop") stopShowRecording();
        else if (action === "timer") toggleShowTimerVisible();
        else if (action === "timer-pause") toggleShowTimerRunning();
    }, true);
    // The slides' own sound, when the browser gave none with the screen: a slide medium that starts playing
    // during a recording joins it.
    document.addEventListener("play", event => {
        if (isShowRecording() || _rec.state === "countdown") _routeSlideMedia(event.target);
    }, true);
    window.addEventListener("beforeunload", event => {
        if (isShowRecording() || (_rec.pending && !_rec.pending.saved)) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    _updateShowMenuItems();
}

window.ShowTimer = ShowTimer;
window.showTimer = showTimer;
window.formatShowTime = formatShowTime;
window.openShowRecorder = openShowRecorder;
window.stopShowRecording = stopShowRecording;
window.toggleShowRecordingPaused = toggleShowRecordingPaused;
window.toggleShowTimerVisible = toggleShowTimerVisible;
window.toggleShowTimerRunning = toggleShowTimerRunning;
window.setShowTargetMinutes = setShowTargetMinutes;
window.getPendingShowRecording = getPendingShowRecording;
window.isShowRecording = isShowRecording;
window.showRecorderState = () => _rec.state;
