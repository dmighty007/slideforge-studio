// A progress card over the editor for work that takes a while (importing a large PowerPoint or Keynote file,
// saving a large deck, saving before the window closes). Before it, a long import showed only the small save
// hint in the toolbar, and the editor looked frozen.
//
//   const busy = sfBusyStart({ title: "Importing PowerPoint", detail: "Reading the file…" });
//   busy.update({ detail: "Slide 3 of 40", progress: 3 / 40 }); // progress 0..1, or null for "working…"
//   busy.done();
//
// The card appears only once the work has run for `delay` ms, so quick saves never flash it, and once shown it
// stays up for a moment so it does not flicker. Work started while another is running (a save inside an import)
// takes over the card until it is done, then the outer work's text comes back.

const SF_BUSY_MIN_VISIBLE_MS = 350;

const _sfBusyStack = [];
let _sfBusyRoot = null;
let _sfBusyShownAt = 0;
let _sfBusyShowTimer = null;
let _sfBusyHideTimer = null;

function _sfBusyBuild() {
    if (_sfBusyRoot) return _sfBusyRoot;
    const root = document.createElement("div");
    root.className = "sf-busy-overlay";
    root.hidden = true;
    root.innerHTML = `
        <div class="sf-busy" role="status" aria-live="polite">
            <div class="sf-busy__head">
                <span class="sf-busy__spinner" aria-hidden="true"></span>
                <span class="sf-busy__title"></span>
                <span class="sf-busy__percent" aria-hidden="true"></span>
            </div>
            <div class="sf-busy__track" role="progressbar" aria-valuemin="0" aria-valuemax="100">
                <div class="sf-busy__bar"></div>
            </div>
            <div class="sf-busy__detail"></div>
        </div>`;
    document.body.appendChild(root);
    _sfBusyRoot = root;
    return root;
}

function _sfBusyRender() {
    const top = _sfBusyStack[_sfBusyStack.length - 1];
    if (!top || !_sfBusyRoot) return;
    const root = _sfBusyRoot;
    root.querySelector(".sf-busy__title").textContent = top.title;
    root.querySelector(".sf-busy__detail").textContent = top.detail;
    const track = root.querySelector(".sf-busy__track");
    const bar = root.querySelector(".sf-busy__bar");
    const percent = root.querySelector(".sf-busy__percent");
    const known = typeof top.progress === "number" && Number.isFinite(top.progress);
    track.classList.toggle("is-indeterminate", !known);
    track.setAttribute("aria-label", top.title);
    if (known) {
        const value = Math.round(Math.max(0, Math.min(1, top.progress)) * 100);
        bar.style.width = `${value}%`;
        percent.textContent = `${value}%`;
        track.setAttribute("aria-valuenow", String(value));
    } else {
        bar.style.width = "";
        percent.textContent = "";
        track.removeAttribute("aria-valuenow");
    }
}

function _sfBusyShow() {
    _sfBusyShowTimer = null;
    if (!_sfBusyStack.length) return;
    const root = _sfBusyBuild();
    _sfBusyRender();
    if (root.hidden) {
        root.hidden = false;
        _sfBusyShownAt = Date.now();
        document.body.classList.add("sf-busy-open");
    }
}

function _sfBusyHide() {
    _sfBusyHideTimer = null;
    if (_sfBusyStack.length || !_sfBusyRoot) return;
    _sfBusyRoot.hidden = true;
    document.body.classList.remove("sf-busy-open");
}

function sfBusyStart({ title = "Working…", detail = "", progress = null, delay = 250 } = {}) {
    const entry = { title, detail, progress };
    _sfBusyStack.push(entry);
    clearTimeout(_sfBusyHideTimer);
    _sfBusyHideTimer = null;
    if (_sfBusyRoot && !_sfBusyRoot.hidden) {
        _sfBusyRender();
    } else if (!_sfBusyShowTimer) {
        if (delay > 0) _sfBusyShowTimer = setTimeout(_sfBusyShow, delay);
        else _sfBusyShow();
    }
    let finished = false;
    return {
        update(changes = {}) {
            if (finished) return;
            Object.assign(entry, changes);
            if (_sfBusyStack[_sfBusyStack.length - 1] === entry) _sfBusyRender();
        },
        done() {
            if (finished) return;
            finished = true;
            const at = _sfBusyStack.indexOf(entry);
            if (at >= 0) _sfBusyStack.splice(at, 1);
            if (_sfBusyStack.length) {
                _sfBusyRender();
                return;
            }
            clearTimeout(_sfBusyShowTimer);
            _sfBusyShowTimer = null;
            if (!_sfBusyRoot || _sfBusyRoot.hidden) return;
            const wait = Math.max(0, SF_BUSY_MIN_VISIBLE_MS - (Date.now() - _sfBusyShownAt));
            _sfBusyHideTimer = setTimeout(_sfBusyHide, wait);
        },
    };
}

// Long loops call this between steps: a task boundary lets the browser paint the card and its bar. Without it a
// loop of awaits that never leave the microtask queue keeps the page frozen until it ends.
let _sfBusyLastYield = 0;
function sfBusyYield(everyMs = 40) {
    if (Date.now() - _sfBusyLastYield < everyMs) return Promise.resolve();
    return new Promise(resolve =>
        setTimeout(() => {
            _sfBusyLastYield = Date.now();
            resolve();
        }, 0),
    );
}

// Before a long synchronous step (drawing every slide at once): waits for the card to be painted, so it is on
// screen with its latest text while the page is blocked. A hidden tab paints nothing, so it never waits long.
function sfBusyPaint() {
    return new Promise(resolve => {
        const finish = () => {
            clearTimeout(fallback);
            _sfBusyLastYield = Date.now();
            resolve();
        };
        const fallback = setTimeout(finish, 100);
        requestAnimationFrame(() => setTimeout(finish, 0));
    });
}

window.sfBusyStart = sfBusyStart;
window.sfBusyPaint = sfBusyPaint;
window.sfBusyYield = sfBusyYield;
