const EMBED_STYLE_ID = "pptmaker-embed-style";
const EMBED_SCRIPT_ID = "pptmaker-embed-script";
const AUTOFIT_ROOT_ID = "pptmaker-autofit-root";
const HTML_EMBED_SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads";

function getHtmlEmbedSandbox() {
    return HTML_EMBED_SANDBOX;
}

function applyHtmlEmbedSandbox(iframe) {
    if (!iframe) return;
    iframe.setAttribute("sandbox", getHtmlEmbedSandbox());
    iframe.setAttribute("referrerpolicy", "no-referrer");
}

function ensureDocumentShell(content) {
    const raw = String(content || "");
    if (/<html[\s>]/i.test(raw)) {
        return raw;
    }
    return `<!doctype html><html><head></head><body>${raw}</body></html>`;
}

function ensureHead(doc) {
    if (/<head[\s>]/i.test(doc)) {
        return doc;
    }
    return doc.replace(/<html([^>]*)>/i, "<html$1><head></head>");
}

function ensureBody(doc) {
    if (/<body[\s>]/i.test(doc)) {
        return doc;
    }
    if (/<\/head>/i.test(doc)) {
        return doc.replace(/<\/head>/i, "</head><body></body>");
    }
    return doc.replace(/<\/html>/i, "<body></body></html>");
}

function injectIntoHead(doc, markup) {
    if (/<\/head>/i.test(doc)) {
        return doc.replace(/<\/head>/i, `${markup}</head>`);
    }
    return doc.replace(/<html([^>]*)>/i, `<html$1><head>${markup}</head>`);
}

function injectIntoBodyEnd(doc, markup) {
    if (/<\/body>/i.test(doc)) {
        return doc.replace(/<\/body>/i, `${markup}</body>`);
    }
    return doc.replace(/<\/html>/i, `<body>${markup}</body></html>`);
}

function buildResponsiveStyles(mode) {
    const isAutofit = mode === "autofit";
    return `
        <style id="${EMBED_STYLE_ID}">
            html, body {
                width: 100%;
                height: 100%;
                margin: 0;
                padding: 0;
                background: transparent;
            }

            body {
                position: relative;
                overflow: ${isAutofit ? "hidden" : "auto"};
            }

            img, svg, video, canvas, iframe {
                max-width: 100%;
            }

            #${AUTOFIT_ROOT_ID} {
                position: absolute;
                top: 0;
                left: 0;
                transform-origin: top left;
            }
        </style>
    `;
}

function buildAutofitScript(mode) {
    return `
        <script id="${EMBED_SCRIPT_ID}">
            (() => {
                const mode = ${JSON.stringify(mode)};
                const rootId = ${JSON.stringify(AUTOFIT_ROOT_ID)};
                let rafId = 0;
                let timers = [];
                let resizeObserver = null;
                let mutationObserver = null;

                function scheduleApply() {
                    if (rafId) return;
                    rafId = window.requestAnimationFrame(() => {
                        rafId = 0;
                        applyResponsiveMode();
                    });
                }

                function wrapBodyChildren() {
                    if (mode !== "autofit") return null;
                    const body = document.body;
                    if (!body) return null;

                    let root = document.getElementById(rootId);
                    if (root) return root;

                    root = document.createElement("div");
                    root.id = rootId;
                    const nodes = Array.from(body.childNodes);
                    nodes.forEach(node => {
                        if (node !== root) root.appendChild(node);
                    });
                    body.appendChild(root);
                    return root;
                }

                function applyResponsiveMode() {
                    const body = document.body;
                    if (!body) return;

                    document.documentElement.style.overflow = mode === "autofit" ? "hidden" : "auto";
                    body.style.overflow = mode === "autofit" ? "hidden" : "auto";

                    if (mode !== "autofit") return;

                    const root = wrapBodyChildren();
                    if (!root) return;

                    root.style.transform = "scale(1)";
                    root.style.left = "0px";
                    root.style.top = "0px";

                    const rawWidth = Math.max(root.scrollWidth, root.offsetWidth, root.getBoundingClientRect().width, 1);
                    const rawHeight = Math.max(root.scrollHeight, root.offsetHeight, root.getBoundingClientRect().height, 1);
                    const scale = window.innerWidth / rawWidth;
                    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
                    const fittedWidth = rawWidth * safeScale;
                    const fittedHeight = rawHeight * safeScale;

                    root.style.transform = "scale(" + safeScale + ")";
                    root.style.left = Math.max(0, (window.innerWidth - fittedWidth) / 2) + "px";
                    root.style.top = "0px";
                    body.style.overflowY = fittedHeight > window.innerHeight ? "auto" : "hidden";
                }

                function cleanup() {
                    if (rafId) {
                        window.cancelAnimationFrame(rafId);
                        rafId = 0;
                    }
                    timers.forEach(timer => clearTimeout(timer));
                    timers = [];

                    if (resizeObserver) {
                        resizeObserver.disconnect();
                        resizeObserver = null;
                    }
                    if (mutationObserver) {
                        mutationObserver.disconnect();
                        mutationObserver = null;
                    }

                    window.removeEventListener("load", scheduleApply);
                    window.removeEventListener("resize", scheduleApply);
                }

                function boot() {
                    scheduleApply();

                    window.addEventListener("load", scheduleApply);
                    window.addEventListener("resize", scheduleApply);

                    if (mode !== "autofit") return;

                    if (window.ResizeObserver) {
                        resizeObserver = new ResizeObserver(() => scheduleApply());
                        resizeObserver.observe(document.documentElement);
                        if (document.body) resizeObserver.observe(document.body);
                    }

                    mutationObserver = new MutationObserver(() => scheduleApply());
                    mutationObserver.observe(document.documentElement, {
                        childList: true,
                        subtree: true,
                    });

                    timers.push(setTimeout(scheduleApply, 0));
                    timers.push(setTimeout(scheduleApply, 120));
                }

                if (document.readyState === "loading") {
                    document.addEventListener("DOMContentLoaded", boot, { once: true });
                } else {
                    boot();
                }

                // Cleanup on page unload
                window.addEventListener("beforeunload", cleanup);
                window.addEventListener("unload", cleanup);
            })();
        </script>
    `;
}

function normalizeHtmlMode(elData) {
    return elData?.htmlMode === "autofit" ? "autofit" : "responsive";
}

function buildHtmlEmbedSrcdoc(content, elData = {}) {
    let doc = ensureDocumentShell(content);
    doc = ensureHead(doc);
    doc = ensureBody(doc);

    if (!/name=["']viewport["']/i.test(doc)) {
        doc = injectIntoHead(doc, '<meta name="viewport" content="width=device-width, initial-scale=1" />');
    }

    const mode = normalizeHtmlMode(elData);
    doc = injectIntoHead(doc, buildResponsiveStyles(mode));
    doc = injectIntoBodyEnd(doc, buildAutofitScript(mode));
    doc = injectIntoBodyEnd(doc, buildSnapshotResponderScript());
    return doc;
}

// Exports need a picture of the embed: the PDF capture cannot see inside an iframe (it came out blank) and
// PowerPoint cannot run HTML (it got a placeholder). The sandboxed page cannot be read from outside, so on request
// it sends a copy of itself as it looks now: canvases as pictures, typed values kept, scripts left out.
function buildSnapshotResponderScript() {
    return `
        <script id="pptmaker-embed-snapshot">
            (() => {
                window.addEventListener("message", event => {
                    const message = event.data || {};
                    if (event.source !== window.parent || message.type !== "pptmaker:html:snapshot-request") return;
                    let html = null;
                    try {
                        const liveCanvases = Array.from(document.querySelectorAll("canvas"));
                        const liveFields = Array.from(document.querySelectorAll("input, textarea, select"));
                        const copy = document.documentElement.cloneNode(true);
                        Array.from(copy.querySelectorAll("canvas")).forEach((canvas, index) => {
                            const img = document.createElement("img");
                            try { img.src = liveCanvases[index].toDataURL("image/png"); } catch (_error) {}
                            img.setAttribute("style", canvas.getAttribute("style") || "");
                            img.width = liveCanvases[index]?.clientWidth || canvas.width;
                            img.height = liveCanvases[index]?.clientHeight || canvas.height;
                            canvas.replaceWith(img);
                        });
                        Array.from(copy.querySelectorAll("input, textarea, select")).forEach((field, index) => {
                            const live = liveFields[index];
                            if (!live) return;
                            if (field.tagName === "TEXTAREA") field.textContent = live.value;
                            else if (field.tagName === "SELECT") Array.from(field.options).forEach((option, i) => option.toggleAttribute("selected", i === live.selectedIndex));
                            else if (live.type === "checkbox" || live.type === "radio") field.toggleAttribute("checked", live.checked);
                            else field.setAttribute("value", live.value);
                        });
                        Array.from(copy.querySelectorAll("script, meta[http-equiv], iframe, object, embed")).forEach(node => node.remove());
                        html = "<!doctype html>" + copy.outerHTML;
                    } catch (_error) {
                        html = null;
                    }
                    window.parent.postMessage({ type: "pptmaker:html:snapshot-response", requestId: message.requestId, html, width: window.innerWidth, height: window.innerHeight }, "*");
                });
            })();
        </script>
    `;
}

// Draws a copy sent by an embed in a frame that cannot run anything (sandboxed without allow-scripts), which the
// app can therefore read. The live embed is never same-origin; this copy is also cleaned of handlers.
const HTML_EMBED_CAPTURE_SANDBOX = "allow-same-origin";

async function _renderHtmlEmbedCopy(html, width, height) {
    if (typeof html2canvas !== "function" || !html || width < 8 || height < 8) return null;
    if (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function") {
        html = "<!doctype html>" + DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ADD_TAGS: ["style"], FORBID_TAGS: ["script", "iframe", "object", "embed", "meta", "base", "form"] });
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", HTML_EMBED_CAPTURE_SANDBOX);
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-1;`;
    frame.setAttribute("aria-hidden", "true");
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = html;
    document.body.appendChild(frame);
    try {
        await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 4000))]);
        const doc = frame.contentDocument;
        if (!doc?.documentElement) return null;
        await doc.fonts?.ready?.catch?.(() => {});
        await Promise.all(Array.from(doc.images).map((img) => (img.complete ? null : img.decode().catch(() => null))));
        const canvas = await html2canvas(doc.documentElement, {
            backgroundColor: null,
            scale: 2,
            width,
            height,
            windowWidth: width,
            windowHeight: height,
            logging: false,
            useCORS: true,
        });
        return canvas.toDataURL("image/png");
    } catch (_error) {
        return null;
    } finally {
        frame.remove();
    }
}

// A picture of a live embed iframe, or null if it does not answer in time.
function requestHtmlEmbedSnapshot(iframe, timeoutMs = 5000) {
    return new Promise((resolve) => {
        if (!iframe?.contentWindow) {
            resolve(null);
            return;
        }
        const requestId = `html_shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        const finish = (value) => {
            window.clearTimeout(deadline);
            window.removeEventListener("message", onMessage);
            resolve(value);
        };
        const deadline = window.setTimeout(() => finish(null), timeoutMs);
        function onMessage(event) {
            const message = event.data || {};
            if (event.source !== iframe.contentWindow || message.type !== "pptmaker:html:snapshot-response" || message.requestId !== requestId) return;
            if (typeof message.html !== "string") {
                finish(null);
                return;
            }
            const width = Math.round(Number(message.width) || iframe.clientWidth || 0);
            const height = Math.round(Number(message.height) || iframe.clientHeight || 0);
            _renderHtmlEmbedCopy(message.html, width, height).then(finish, () => finish(null));
        }
        window.addEventListener("message", onMessage);
        iframe.contentWindow.postMessage({ type: "pptmaker:html:snapshot-request", requestId }, "*");
    });
}

// A picture of an HTML element: from its live iframe when that is on screen, otherwise from a hidden copy
// drawn at the element's size (a slide Reveal is not showing has a 0 x 0 iframe).
async function captureHtmlEmbedPicture(elData, liveIframe = null) {
    const width = Math.round(parseFloat(elData?.width) || 0);
    const height = Math.round(parseFloat(elData?.height) || 0);
    if (liveIframe && liveIframe.clientWidth >= 8 && liveIframe.clientHeight >= 8) {
        const live = await requestHtmlEmbedSnapshot(liveIframe);
        if (live) return live;
    }
    if (width < 8 || height < 8) return null;
    const frame = document.createElement("iframe");
    applyHtmlEmbedSandbox(frame);
    // In view but invisible, so the browser lays it out and runs it at full speed.
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;z-index:-1;`;
    frame.setAttribute("aria-hidden", "true");
    const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.srcdoc = buildHtmlEmbedSrcdoc(elData.content || "", elData);
    document.body.appendChild(frame);
    try {
        await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 4000))]);
        // Its scripts and the fit-to-box step get a moment to draw.
        await new Promise((resolve) => setTimeout(resolve, 600));
        return await requestHtmlEmbedSnapshot(frame);
    } finally {
        frame.remove();
    }
}

// For the PDF and PNG capture: each HTML embed on the slide is covered by a picture of itself while captured.
async function showHtmlEmbedsAsPicturesForCapture(slideNode) {
    const added = [];
    const slideData = state.slides?.[currentSlideIndex];
    await Promise.all(
        (slideData?.elements || []).filter((el) => el?.type === "html").map(async (el) => {
            const host = slideNode?.querySelector(`[id="${el.id}"]`);
            if (!host) return;
            const dataUrl = await captureHtmlEmbedPicture(el, host.querySelector("iframe"));
            if (!dataUrl) return;
            const img = document.createElement("img");
            img.src = dataUrl;
            try {
                await img.decode();
            } catch (_error) {
                return;
            }
            img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:5;border-radius:inherit;";
            host.appendChild(img);
            added.push(img);
        }),
    );
    return () => added.forEach((img) => img.remove());
}

// For PowerPoint: HTML elements of an export state become pictures of themselves.
async function replaceHtmlEmbedsWithPictures(exportState) {
    for (const slide of exportState?.slides || []) {
        for (const [index, el] of (slide.elements || []).entries()) {
            if (el?.type !== "html") continue;
            const live = [...document.querySelectorAll(`[id="${el.id}"]`)].find((node) => !node.closest("#slide-previews"));
            const dataUrl = await captureHtmlEmbedPicture(el, live?.querySelector("iframe"));
            if (!dataUrl) continue;
            slide.elements[index] = {
                id: el.id,
                type: "image",
                content: dataUrl,
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation: el.rotation,
                styles: { zIndex: el.styles?.zIndex, borderRadius: el.styles?.borderRadius || "0px" },
                exportedFrom: "html",
            };
        }
    }
}
