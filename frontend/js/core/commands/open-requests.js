// Presentations given on the command line (desktop app): `slideforge talk.pptx` puts the file in a queue
// (backend/slideforge/desktop/open_files.py), and this opens each one, as Import on the start screen would: a
// PowerPoint, Keynote, PDF or SlideForge .json file, each into a new project. The queue is read once the editor has
// started, then every few seconds, so a file given while SlideForge is already running opens in this window.

const SF_OPEN_REQUESTS_URL = "/api/desktop/open/";
const SF_OPEN_REQUESTS_EVERY_MS = 2000;
let _sfOpeningRequests = false;
let _sfOpenRequestsTimer = null;

async function _sfOpenQueuedFile(request) {
    const response = await fetch(`${SF_OPEN_REQUESTS_URL}${encodeURIComponent(request.id)}/`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return; // taken already (another window), or the file went away
    const file = new File([await response.blob()], String(request.name || "presentation"));
    window.closeStartScreen?.({ force: true });
    if (request.kind === "pptx" && typeof importPptx === "function") await importPptx(file);
    else if (request.kind === "keynote" && typeof importKeynote === "function") await importKeynote(file);
    else if (request.kind === "pdf" && typeof importPdfSlides === "function") await importPdfSlides(file);
    else if (request.kind === "json" && typeof importPresentationJsonFile === "function") await importPresentationJsonFile(file);
}

// Opens what is waiting, one file after another (an import replaces the open deck, so they never overlap).
async function sfOpenQueuedFiles() {
    // Not in the middle of a slide show: the file opens when the show ends.
    if (_sfOpeningRequests || document.body.classList.contains("play-mode-active")) return;
    _sfOpeningRequests = true;
    try {
        const response = await fetch(SF_OPEN_REQUESTS_URL, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) {
            if (response.status === 404) clearInterval(_sfOpenRequestsTimer); // not the desktop app
            return;
        }
        const { files = [] } = await response.json();
        for (const request of files) {
            try {
                await _sfOpenQueuedFile(request);
            } catch (error) {
                console.warn(`Could not open ${request.name}:`, error);
                setProjectSaveHint?.(`Could not open ${request.name}`, "danger");
            }
        }
    } catch (_error) {
        // the server is restarting, or the page is closing: the next round tries again
    } finally {
        _sfOpeningRequests = false;
    }
}

// Called once the editor has started (main.js): only the desktop app has the queue. Its page is marked
// "desktop-app" (studio/views.py); the web app with sign-in switched off is not, and asking there was a 404.
function sfStartOpenRequests() {
    if (!document.body.classList.contains("desktop-app") || _sfOpenRequestsTimer) return;
    sfOpenQueuedFiles();
    _sfOpenRequestsTimer = setInterval(sfOpenQueuedFiles, SF_OPEN_REQUESTS_EVERY_MS);
}

window.sfOpenQueuedFiles = sfOpenQueuedFiles;
window.sfStartOpenRequests = sfStartOpenRequests;
