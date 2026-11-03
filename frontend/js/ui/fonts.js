// Fonts for imported presentations: a deck made elsewhere names fonts this computer may not have, and the browser then
// draws a substitute (lines break differently, titles no longer fit). After an import, the fonts the deck uses are
// checked; for missing ones a card offers to download them from Google Fonts (backend/slideforge/studio/
// google_fonts.py). Downloaded fonts are kept on the server and loaded each time the app starts.
// "Download Fonts for This Presentation…" in the command palette runs the same check on the open deck.
// Fonts Google does not have (Cambria Math, a company's font) can be added from a file the user has ("Add Font
// Files…"), and fonts a PowerPoint file carries are added at import: both are kept for this user only
// (backend/slideforge/studio/font_files.py) and served from /api/fonts/own/.

const SF_FONTS_URL = "/api/fonts/";
const SF_GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial"]);
const _sfLoadedFontSheets = new Set();

function _sfFontsRequest(body) {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    return fetch(SF_FONTS_URL, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) } : {},
        body: body ? JSON.stringify(body) : undefined,
    }).then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))));
}

// The stylesheets of the downloaded families, added to the page once each.
function _sfAddFontSheets(fonts) {
    Object.values(fonts || {}).forEach(font => {
        const href = String(font?.css || "");
        const allowed = /^\/media\/fonts\/[a-z0-9-]+\/font\.css$/.test(href) || /^\/api\/fonts\/own\/fonts\.css\?v=\d+$/.test(href);
        if (!href || _sfLoadedFontSheets.has(href) || !allowed) return;
        _sfLoadedFontSheets.add(href);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.userFont = "true";
        document.head.appendChild(link);
    });
}

async function sfLoadDownloadedFonts() {
    try {
        const { fonts } = await _sfFontsRequest(null);
        _sfAddFontSheets(fonts);
        return fonts || {};
    } catch (_error) {
        return {}; // no server (offline), or not signed in
    }
}

// The first family of a CSS font stack ('"Instrument Serif", "Tinos", serif' -> Instrument Serif).
function _sfFirstFamily(stack) {
    const first = String(stack || "").split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
    return first && !SF_GENERIC_FONTS.has(first.toLowerCase()) ? first : "";
}

// Every font family the deck's text names: each box's own font and the fonts set inside its text.
function sfDeckFontFamilies(slides = state.slides) {
    const families = new Map();
    const add = (stack, weight = 1) => {
        const family = _sfFirstFamily(stack);
        if (family && /^[A-Za-z0-9][A-Za-z0-9 \-]{0,62}$/.test(family)) families.set(family, (families.get(family) || 0) + weight);
    };
    (slides || []).forEach(slide =>
        (slide?.elements || []).forEach(el => {
            add(el?.styles?.fontFamily);
            add(el?.shapeTextStyle?.fontFamily);
            const html = typeof el?.content === "string" ? el.content : JSON.stringify(el?.content || "");
            for (const match of html.matchAll(/font-family:\s*([^;"<>]+)/gi)) add(match[1].replace(/&quot;|&#39;|\\"/g, '"'));
        }),
    );
    return [...families.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
}

// Whether the browser has the family (installed, bundled with SlideForge, or downloaded): text measured in it differs
// from text in the fallbacks. Bundled and downloaded web fonts are loaded first so they count.
const _sfFontCanvas = document.createElement("canvas").getContext("2d");
async function sfFontAvailable(family) {
    try {
        await document.fonts.load(`16px "${family}"`);
    } catch (_error) {}
    const sample = "mmmmmmmmmmlliWW@#0123456789 The quick brown fox";
    return ["monospace", "serif", "sans-serif"].some(fallback => {
        _sfFontCanvas.font = `72px ${fallback}`;
        const plain = _sfFontCanvas.measureText(sample).width;
        _sfFontCanvas.font = `72px "${family}", ${fallback}`;
        return Math.abs(_sfFontCanvas.measureText(sample).width - plain) > 0.5;
    });
}

async function sfMissingFonts(slides = state.slides) {
    const missing = [];
    for (const family of sfDeckFontFamilies(slides)) {
        if (!(await sfFontAvailable(family))) missing.push(family);
    }
    return missing;
}

function _sfFontsCard() {
    let card = document.getElementById("sf-fonts-card");
    if (!card) {
        card = document.createElement("div");
        card.id = "sf-fonts-card";
        card.className = "sf-update sf-fonts";
        card.setAttribute("role", "status");
        card.setAttribute("aria-live", "polite");
        document.body.appendChild(card);
    }
    // Above the update card when both show.
    const update = document.getElementById("sf-update-card");
    card.style.bottom = update ? `${update.offsetHeight + 28}px` : "";
    return card;
}

function _sfFontsEscape(text) {
    return String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// The card stays only while it concerns what is on screen: one about a deck goes when another deck (or the start
// screen) is opened, and a report that needs nothing more ("Fonts added") goes by itself after a few seconds,
// unless the pointer or keyboard is on it. It stayed over everything until Close was pressed, from one deck to
// the next and over the start screen.
const SF_FONTS_REPORT_MS = 8000;
function _sfFontsShow({ icon, title, text, buttons = [], autoClose = false }) {
    const card = _sfFontsCard();
    clearTimeout(card._sfCloseTimer);
    clearInterval(card._sfWatch);
    const deck = String(typeof currentPresentationId !== "undefined" && currentPresentationId ? currentPresentationId : "");
    card._sfWatch = setInterval(() => {
        const elsewhere = String(typeof currentPresentationId !== "undefined" && currentPresentationId ? currentPresentationId : "") !== deck;
        if (!card.isConnected || elsewhere || document.body.classList.contains("start-screen-open")) {
            clearInterval(card._sfWatch);
            clearTimeout(card._sfCloseTimer);
            card.remove();
        }
    }, 1000);
    if (autoClose) {
        const closeLater = delay => {
            card._sfCloseTimer = setTimeout(() => {
                if (card.matches(":hover, :focus-within")) closeLater(2000);
                else {
                    clearInterval(card._sfWatch);
                    card.remove();
                }
            }, delay);
        };
        closeLater(SF_FONTS_REPORT_MS);
    }
    card.innerHTML = `
        <i class="fa-solid ${icon} sf-update__icon" aria-hidden="true"></i>
        <div class="sf-update__body">
            <div class="sf-update__title">${title}</div>
            <div class="sf-update__text">${text}</div>
            ${buttons.length ? `<div class="sf-update__actions">${buttons.join("")}</div>` : ""}
        </div>`;
    return card;
}

// Families Google Fonts does not have (a commercial font, a font made for one company): not offered again after an
// import, where the offer could only fail again. The manual check still lists them.
const SF_NOT_ON_GOOGLE_KEY = "sf-fonts-not-on-google";
function _sfNotOnGoogle() {
    try {
        return new Set(JSON.parse(localStorage.getItem(SF_NOT_ON_GOOGLE_KEY) || "[]"));
    } catch (_error) {
        return new Set();
    }
}
function _sfRememberNotOnGoogle(families) {
    try {
        const known = _sfNotOnGoogle();
        families.forEach(family => known.add(family));
        localStorage.setItem(SF_NOT_ON_GOOGLE_KEY, JSON.stringify([...known].slice(-200)));
    } catch (_error) {}
}

// Checks the open deck's fonts; offers to download the missing ones. auto: after an import (quiet when all are here).
async function sfOfferMissingFonts({ auto = false } = {}) {
    if (auto && sessionStorage.getItem("sf-fonts-not-now") === String(currentPresentationId || "")) return;
    let missing = await sfMissingFonts();
    if (auto) {
        const notOnGoogle = _sfNotOnGoogle();
        missing = missing.filter(family => !notOnGoogle.has(family));
    }
    if (!missing.length) {
        if (!auto) {
            const card = _sfFontsShow({ icon: "fa-circle-check", title: "All fonts are available", text: "Every font this presentation uses is on this computer.", buttons: ['<button type="button" class="sf-update__btn" data-fonts="close">Close</button>'], autoClose: true });
            card.onclick = event => event.target.closest?.("[data-fonts]") && card.remove();
        }
        return;
    }
    const list = missing.map(name => `<b>${_sfFontsEscape(name)}</b>`).join(", ");
    const card = _sfFontsShow({
        icon: "fa-font",
        title: missing.length === 1 ? "A font is missing" : `${missing.length} fonts are missing`,
        text: `This presentation uses ${list}, not on this computer: a similar font is drawn instead. Free fonts can be downloaded from Google Fonts; others can be added from font files you have.`,
        buttons: [
            '<button type="button" class="sf-update__btn sf-update__btn--primary" data-fonts="download">Download from Google Fonts</button>',
            '<button type="button" class="sf-update__btn" data-fonts="files">Add Font Files…</button>',
            '<button type="button" class="sf-update__btn" data-fonts="later">Not now</button>',
        ],
    });
    card.onclick = async event => {
        const action = event.target.closest?.("[data-fonts]")?.dataset.fonts;
        if (action === "later" || action === "close") {
            if (action === "later") sessionStorage.setItem("sf-fonts-not-now", String(currentPresentationId || ""));
            card.remove();
        } else if (action === "download") {
            await _sfDownloadFonts(missing);
        } else if (action === "files") {
            sfAddFontFiles();
        }
    };
}

async function _sfDownloadFonts(families) {
    _sfFontsShow({ icon: "fa-spinner fa-spin", title: "Downloading fonts…", text: _sfFontsEscape(families.join(", ")) });
    let reply;
    try {
        reply = await _sfFontsRequest({ families: families.slice(0, 12) });
    } catch (_error) {
        const card = _sfFontsShow({ icon: "fa-wifi", title: "Could not download the fonts", text: "Check the internet connection and try again.", buttons: ['<button type="button" class="sf-update__btn" data-fonts="close">Close</button>'] });
        card.onclick = event => event.target.closest?.("[data-fonts]") && card.remove();
        return;
    }
    _sfAddFontSheets(reply.fonts);
    const got = (reply.results || []).filter(r => r.status === "installed" || r.status === "already").map(r => r.family);
    const absent = (reply.results || []).filter(r => r.status === "not-found").map(r => r.family);
    const failed = (reply.results || []).filter(r => r.status === "failed").map(r => r.family);
    _sfRememberNotOnGoogle(absent);
    // Redrawn in the real fonts once they have loaded (shrink-to-fit and line breaks depend on them).
    await Promise.all(got.map(family => document.fonts.load(`16px "${family}"`).catch(() => {})));
    await document.fonts.ready;
    renderSlidesFromState?.();
    window.refreshPreviews?.();
    const lines = [];
    if (got.length) lines.push(`Now drawn in ${got.map(_sfFontsEscape).join(", ")}.`);
    if (absent.length) lines.push(`${absent.map(_sfFontsEscape).join(", ")} ${absent.length === 1 ? "is" : "are"} not on Google Fonts (often a commercial font): the closest installed font is used.`);
    if (failed.length) lines.push(`${failed.map(_sfFontsEscape).join(", ")} could not be downloaded.`);
    const card = _sfFontsShow({
        icon: got.length ? "fa-circle-check" : "fa-circle-info",
        title: got.length ? (got.length === 1 ? "Font downloaded" : "Fonts downloaded") : "No fonts downloaded",
        text: lines.join(" "),
        autoClose: got.length > 0 && !absent.length && !failed.length,
        buttons: [
            ...(absent.length ? ['<button type="button" class="sf-update__btn" data-fonts="files">Add Font Files…</button>'] : []),
            '<button type="button" class="sf-update__btn" data-fonts="close">Close</button>',
        ],
    });
    card.onclick = event => {
        const action = event.target.closest?.("[data-fonts]")?.dataset.fonts;
        if (action === "files") sfAddFontFiles();
        else if (action) card.remove();
    };
}

// Sends one font file to this user's fonts. family/style: the name and slot a presentation gives it (embedded fonts).
async function sfUploadFontFile(file, { family = "", style = "" } = {}) {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    const form = new FormData();
    form.append("file", file, file.name || "font");
    if (family) form.append("family", family);
    if (style) form.append("style", style);
    const response = await fetch(`${SF_FONTS_URL}files/`, { method: "POST", credentials: "same-origin", headers: csrf ? { "X-CSRFToken": csrf } : {}, body: form });
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(reply.error || `The font could not be added (${response.status})`);
    _sfAddFontSheets(reply.fonts);
    return reply;
}

// Loads the families just added and redraws the slides in them (shrink-to-fit and line breaks depend on them).
async function _sfRedrawInFonts(families) {
    await Promise.all(families.map(family => document.fonts.load(`16px "${family}"`).catch(() => {})));
    await document.fonts.ready;
    renderSlidesFromState?.();
    window.refreshPreviews?.();
}

// "Add Font Files…": TrueType, OpenType, collections, WOFF or EOT files the user has, or .zip files of them (Cambria Math from Office, a
// company font). Kept for this user only, for every later session.
function sfAddFontFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    // A .zip of fonts (as font sites and Microsoft give them out) is read on the server: every font file in it.
    input.accept = ".ttf,.otf,.ttc,.woff,.eot,.fntdata,.zip,font/ttf,font/otf,font/collection,font/woff,application/zip";
    input.onchange = async () => {
        const files = [...(input.files || [])].slice(0, 40);
        if (!files.length) return;
        _sfFontsShow({ icon: "fa-spinner fa-spin", title: "Adding fonts…", text: _sfFontsEscape(files.map(f => f.name).join(", ")) });
        const added = new Set();
        const failed = [];
        for (const file of files) {
            try {
                const reply = await sfUploadFontFile(file);
                (reply.faces || []).forEach(face => (face.names || [face.family]).forEach(name => added.add(name)));
            } catch (error) {
                failed.push(`${file.name}: ${error.message}`);
            }
        }
        await _sfRedrawInFonts([...added]);
        const missing = await sfMissingFonts();
        const lines = [];
        if (added.size) lines.push(`Added ${[...added].map(_sfFontsEscape).join(", ")}.`);
        if (failed.length) lines.push(`Not added: ${failed.map(_sfFontsEscape).join("; ")}.`);
        if (missing.length) lines.push(`Still missing: ${missing.map(_sfFontsEscape).join(", ")}.`);
        const card = _sfFontsShow({
            icon: added.size && !failed.length ? "fa-circle-check" : "fa-circle-info",
            title: added.size ? (added.size === 1 ? "Font added" : "Fonts added") : "No fonts added",
            text: lines.join(" "),
            autoClose: added.size > 0 && !failed.length && !missing.length,
            buttons: ['<button type="button" class="sf-update__btn" data-fonts="close">Close</button>'],
        });
        card.onclick = event => event.target.closest?.("[data-fonts]") && card.remove();
    };
    input.click();
}

// "Download Fonts for This Presentation…"
function downloadPresentationFonts() {
    sfOfferMissingFonts({ auto: false });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sfLoadDownloadedFonts);
else sfLoadDownloadedFonts();

window.sfOfferMissingFonts = sfOfferMissingFonts;
window.sfMissingFonts = sfMissingFonts;
window.downloadPresentationFonts = downloadPresentationFonts;
window.sfAddFontFiles = sfAddFontFiles;
window.sfUploadFontFile = sfUploadFontFile;
