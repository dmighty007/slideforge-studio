// Equations as pictures for exports. KaTeX lays formulas out with nested inline boxes and vertical offsets that
// html2canvas (PDF/PNG capture) reproduces badly: fraction bars crossed the numerators and denominators were cut
// off. PowerPoint has no KaTeX at all. Here the browser draws the formula itself, inside an SVG foreignObject with
// KaTeX's styles and fonts inlined, and the result is rasterised to a PNG.

let _katexInlineCssPromise = null;

function _blobToDataUrlForEquation(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read a KaTeX font"));
        reader.readAsDataURL(blob);
    });
}

// katex.min.css with its woff2 fonts as data: URLs (an SVG image may not load anything from outside itself).
function _katexInlineCss() {
    if (!_katexInlineCssPromise) {
        _katexInlineCssPromise = (async () => {
            const base = new URL("vendor/katex/katex.min.css", document.baseURI);
            let css = await (await fetch(base)).text();
            // Only the woff2 sources are kept; the other formats would also have to be inlined for nothing.
            css = css.replace(/src:([^;}]*)/g, (match, sources) => {
                const woff2 = sources.split(",").find(source => /\.woff2/.test(source));
                return woff2 ? `src:${woff2.trim()}` : match;
            });
            const urls = [...new Set([...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map(m => m[1].replace(/["']/g, "")))];
            const inlined = await Promise.all(
                urls.map(async url => {
                    const response = await fetch(new URL(url, base));
                    return [url, response.ok ? await _blobToDataUrlForEquation(await response.blob()) : ""];
                }),
            );
            inlined.forEach(([url, dataUrl]) => {
                if (dataUrl) css = css.split(url).join(dataUrl);
            });
            return css;
        })().catch(error => {
            _katexInlineCssPromise = null;
            throw error;
        });
    }
    return _katexInlineCssPromise;
}

function _equationHtml(el) {
    if (el?.latexSrc && typeof katex !== "undefined") {
        try {
            return katex.renderToString(el.latexSrc, { throwOnError: false, displayMode: true, output: "html" });
        } catch (_error) {}
    }
    const html = String(el?.content || "");
    return typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html;
}

// A PNG of an equation element as it appears on the slide (its box width, colour and size), with its height.
async function renderEquationElementToPng(el, { scale = 3 } = {}) {
    const css = await _katexInlineCss();
    const styles = el?.styles || {};
    const width = Math.max(20, Math.round(parseFloat(el?.width) || 400));
    const probe = document.createElement("div");
    probe.style.cssText = [
        "position:fixed",
        "left:-10000px",
        "top:0",
        `width:${width}px`,
        `font-size:${styles.fontSize || "24px"}`,
        `color:${styles.color || "#0f172a"}`,
        `text-align:${styles.textAlign || "center"}`,
        "line-height:1.2",
        "padding:4px 0",
    ].join(";");
    probe.innerHTML = _equationHtml(el);
    // The formula's own margins (display mode adds 1em above and below) would only add empty space.
    probe.querySelectorAll(".katex-display").forEach(node => {
        node.style.margin = "0";
    });
    document.body.appendChild(probe);
    try {
        await document.fonts?.ready;
        const height = Math.max(10, Math.ceil(probe.getBoundingClientRect().height));
        const content = new XMLSerializer().serializeToString(probe);
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">` +
            `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
            `<style xmlns="http://www.w3.org/1999/xhtml">${css.replace(/<\/style/gi, "")}</style>` +
            content.replace(/position:\s*fixed;\s*left:\s*-10000px;\s*top:\s*0px;?/, "") +
            "</foreignObject></svg>";
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("The equation could not be drawn"));
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return { dataUrl: canvas.toDataURL("image/png"), width, height };
    } finally {
        probe.remove();
    }
}

// Copies of a state's equation elements as pictures (for PowerPoint and the standalone viewer).
async function replaceEquationsWithPictures(exportState) {
    for (const slide of exportState?.slides || []) {
        for (const [index, el] of (slide.elements || []).entries()) {
            if (el?.type !== "equation" || (!el.content && !el.latexSrc)) continue;
            try {
                const { dataUrl, width, height } = await renderEquationElementToPng(el);
                slide.elements[index] = {
                    id: el.id,
                    type: "image",
                    content: dataUrl,
                    x: el.x,
                    y: el.y,
                    width: `${width}px`,
                    height: `${height}px`,
                    rotation: el.rotation,
                    styles: { ...(el.styles || {}), backgroundColor: "transparent" },
                    animation: el.animation || null,
                    ...(el.fragment ? { fragment: el.fragment } : {}),
                    ...(el.fragmentIndex !== undefined ? { fragmentIndex: el.fragmentIndex } : {}),
                    exportedFrom: "equation",
                };
            } catch (error) {
                console.warn("Equation kept as is in the export:", error);
            }
        }
    }
}

// While a slide is captured for PDF/PNG, its equations are shown as pictures; the returned function restores them.
async function showEquationsAsPicturesForCapture(slideNode) {
    const restored = [];
    const slideData = state.slides?.[currentSlideIndex];
    for (const el of slideData?.elements || []) {
        if (el?.type !== "equation") continue;
        const node = slideNode?.querySelector(`[id="${el.id}"]`);
        const host = node?.querySelector(".katex-display, .katex")?.parentElement;
        if (!host) continue;
        try {
            const { dataUrl, height } = await renderEquationElementToPng({ ...el, width: `${node.clientWidth}px` });
            const img = document.createElement("img");
            img.src = dataUrl;
            img.style.cssText = `display:block;width:100%;height:${height}px;`;
            await img.decode().catch(() => {});
            const children = [...host.childNodes];
            children.forEach(child => child.remove());
            host.appendChild(img);
            restored.push(() => {
                img.remove();
                children.forEach(child => host.appendChild(child));
            });
        } catch (error) {
            console.warn("Equation captured as is:", error);
        }
    }
    return () => restored.forEach(restore => restore());
}
