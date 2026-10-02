/**
 * Sanitizes HTML content to prevent XSS attacks.
 * Allows only safe HTML tags and attributes for presentation content.
 */
function sanitizeHtml(html) {
  if (typeof html !== "string") return "";

  // Parse into an inert template so nothing (e.g. <img onerror>) runs before sanitizing
  const temp = document.createElement("template");
  temp.innerHTML = html;

  // List of allowed tags for presentation content
  const allowedTags = new Set([
    "DIV",
    "SPAN",
    "P",
    "BR",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "OL",
    "UL",
    "LI",
    "TABLE",
    "TR",
    "TD",
    "TH",
    "TBODY",
    "THEAD",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "CODE",
    "PRE",
    "A",
  ]);

  // List of allowed attributes
  const allowedAttributes = new Set([
    "class",
    "style",
    "data-bullet-style",
    "tabindex",
    "aria-readonly",
  ]);

  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    if (!allowedTags.has(node.tagName)) {
      // Replace disallowed tags with their text content
      const fragment = document.createDocumentFragment();
      for (let child of node.childNodes) {
        const sanitized = sanitizeNode(child);
        if (sanitized) fragment.appendChild(sanitized.cloneNode(true));
      }
      return fragment;
    }

    const newNode = document.createElement(node.tagName);

    // Only copy allowed attributes
    for (let attr of node.attributes) {
      if (allowedAttributes.has(attr.name.toLowerCase())) {
        // Sanitize style attribute to prevent injection
        if (attr.name === "style") {
          const safeCss = attr.value
            .replace(/javascript:/gi, "")
            .replace(/on\w+\s*=/gi, "");
          if (safeCss) newNode.setAttribute(attr.name, safeCss);
        } else {
          newNode.setAttribute(attr.name, attr.value);
        }
      }
    }

    // A link keeps a web or mail address only and opens in a new tab (it would replace the presentation).
    if (node.tagName === "A") {
      const href = String(node.getAttribute("href") || "").trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        newNode.setAttribute("href", href);
        newNode.setAttribute("target", "_blank");
        newNode.setAttribute("rel", "noopener noreferrer");
      }
    }

    // Recursively sanitize child nodes
    for (let child of node.childNodes) {
      const sanitized = sanitizeNode(child);
      if (sanitized) newNode.appendChild(sanitized.cloneNode(true));
    }

    return newNode;
  }

  const fragment = document.createDocumentFragment();
  // A copy of the list: appending a kept text node moves it out of the (live) list, which skipped the node after it
  // (the bold word or link that followed plain text vanished in the viewer).
  for (let child of Array.from(temp.content.childNodes)) {
    const sanitized = sanitizeNode(child);
    if (sanitized) fragment.appendChild(sanitized);
  }

  const result = document.createElement("div");
  result.appendChild(fragment);
  return result.innerHTML;
}

/**
 * Exports the current presentation as a standalone Reveal.js framework in a ZIP file.
 */
async function exportZip() {
  const content = await buildViewerBundle();
  // Named after the project, like the PowerPoint export.
  const title = document.getElementById("project-title-input")?.value.trim() || "presentation";
  saveAs(content, `${title.replace(/[\\/:*?"<>|]+/g, "-")}.zip`);
}

// The standalone viewer (index.html, its scripts, styles and pictures) as a zip. Shared links leave out the app's
// own font, icon and molecule-viewer files (includeVendor: false): the server provides those.
async function buildViewerBundle({ includeVendor = true } = {}) {
  const zip = new JSZip();
  const theme = getPresentationTheme();

  if (typeof syncMoleculeViewStatesFromDom === "function") {
    await syncMoleculeViewStatesFromDom();
  }
  if (typeof ensureEditableMasterFooterElements === "function") {
    const themeForMasters = theme;
    (state.slides || []).forEach((slide, slideIndex) =>
      ensureEditableMasterFooterElements(slide, slideIndex, themeForMasters),
    );
  }

  // 1. Process the same normalized snapshot used by save/PPTX exports.
  const exportState = createZipViewerState(
    typeof getPersistableState === "function"
      ? getPersistableState()
      : JSON.parse(JSON.stringify(state)),
    theme,
  );
  // The slide size itself, not only its name: the viewer knew three old names, so a "Talk 16:9" deck (the default
  // for new decks) was shown in a 4:3 frame with its right side cut off.
  const exportPage = getExportPageSetup();
  exportState.pageSize = { width: exportPage.width, height: exportPage.height };
  await drawChartsAndDiagramsAsPictures(exportState);
  if (typeof replaceEquationsWithPictures === "function") await replaceEquationsWithPictures(exportState);
  // Shape text with its final colours and sizes: the viewer has no theme logic to work out the defaults.
  (exportState.slides || []).forEach((slide) => (slide.elements || []).forEach((el) => {
    if (el?.type === "shape" && el.shapeText && typeof getShapeTextStyle === "function") el.shapeTextStyle = getShapeTextStyle(el);
  }));
  const { processedState, assets } = await processStateAssets(exportState);
  const stateJson = JSON.stringify(processedState);

  // 2. Add Assets
  const assetsFolder = zip.folder("assets");
  for (const [name, data] of Object.entries(assets)) {
    assetsFolder.file(name, data, { base64: true });
  }

  // 3. Generate index.html (Viewer) - Now with embedded state
  const viewerHtml = generateViewerHtml(stateJson, theme);
  zip.file("index.html", viewerHtml);

  // 4. Generate viewer.js
  await addAnimationRuntimeScriptsToZip(zip);
  const viewerJs = generateViewerJs();
  zip.file("js/viewer.js", viewerJs);

  // 5. Generate viewer.css
  const viewerCss = generateViewerCss(theme, await getCurrentAppCssForZip());
  zip.file("css/viewer.css", viewerCss);

  // 6. Add local vendor assets used by the standalone viewer.
  if (includeVendor) await addOfflineViewerVendorAssetsToZip(zip);

  return zip.generateAsync({ type: "blob" });
}

// The standalone viewer has no chart library or diagram renderer: charts and Mermaid diagrams go in as pictures
// (charts drawn at twice their size so they stay sharp). Without this a chart was an empty box and a diagram was
// missing from shared links and the Web ZIP.
async function drawChartsAndDiagramsAsPictures(exportState) {
  for (const slide of exportState.slides || []) {
    for (const [index, el] of (slide.elements || []).entries()) {
      let picture = null;
      if (el?.type === "chart" && typeof Chart !== "undefined") {
        picture = _chartToDataUrl(el);
      } else if (el?.type === "mermaid" && el.svgContent) {
        const svg = String(el.svgContent);
        picture = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      }
      if (!picture) continue;
      slide.elements[index] = {
        id: el.id,
        type: "image",
        content: picture,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        styles: el.styles || {},
        animation: el.animation || null,
        ...(el.fragment ? { fragment: el.fragment } : {}),
        ...(el.fragmentIndex !== undefined ? { fragmentIndex: el.fragmentIndex } : {}),
        exportedFrom: el.type,
      };
    }
  }
}

function _chartToDataUrl(el) {
  const width = Math.max(40, parseFloat(el.width) || 500);
  const height = Math.max(40, parseFloat(el.height) || 350);
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  const canvas = document.createElement("canvas");
  canvas.width = width; // Chart.js doubles these for devicePixelRatio: 2
  canvas.height = height;
  canvas.style.cssText = `width:${width}px;height:${height}px;`;
  host.appendChild(canvas);
  document.body.appendChild(host);
  let chart = null;
  try {
    chart = new Chart(canvas, buildChartJsConfig(el, { forExport: true }));
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.warn("Chart could not be drawn for the viewer:", error);
    return null;
  } finally {
    chart?.destroy();
    host.remove();
  }
}

function createZipViewerState(snapshot, theme) {
  const exportState = JSON.parse(JSON.stringify(snapshot || {}));
  if (!Array.isArray(exportState.slides)) exportState.slides = [];
  // The standalone viewer injects equation markup as-is; sanitize it here like the editor does.
  exportState.slides.forEach((slide) => {
    // Untouched "Click to add ..." boxes are editor-only (an empty list would still draw its bullet).
    if (Array.isArray(slide?.elements) && typeof _isEmptyTextElement === "function") {
      slide.elements = slide.elements.filter((el) => !(el?.placeholder && _isEmptyTextElement(el)));
    }
    (slide?.elements || []).forEach((el) => {
      if (el?.type !== "equation" || typeof DOMPurify === "undefined") return;
      el.content = DOMPurify.sanitize(el.content || el.latexSrc || "");
      if (!el.content) el.latexSrc = "";
    });
  });
  return withRenderedMasterElements(exportState, theme);
}

// Adds each slide's layout decorations exactly as the editor draws them, so exports match the canvas. Slides whose
// footer is already editable content keep that footer and only get the remaining decorations.
function withRenderedMasterElements(exportState, theme) {
  if (typeof buildMasterSlideElements !== "function") return exportState;

  exportState.masterElementsIncluded = true;
  exportState.slides = exportState.slides.map((slide, slideIndex) => {
    const sourceSlide = state.slides?.[slideIndex] || slide;
    const masterElements = buildMasterSlideElements(
      sourceSlide,
      slideIndex,
      theme,
    )
      .filter((el) => el && el.isMasterElement)
      .map((el) => ({
        ...JSON.parse(JSON.stringify(el)),
        id: `zip_${slideIndex}_${el.id}`,
        locked: true,
        hidden: false,
      }));
    if (!masterElements.length) return slide;
    return {
      ...slide,
      elements: [...masterElements, ...(slide.elements || [])],
    };
  });
  return exportState;
}

async function getCurrentAppCssForZip() {
  const stylesheet =
    document.querySelector('link[href^="css/styles.css"]') ||
    document.querySelector('link[href*="/css/styles.css"]');
  const href = stylesheet?.getAttribute("href") || "css/styles.css";
  try {
    const url = new URL(href, window.location.href);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return "";
    return await inlineCssImportsForZip(await response.text(), url);
  } catch (_err) {
    return "";
  }
}

async function inlineCssImportsForZip(css = "", baseUrl, seen = new Set()) {
  const importRegex = /@import\s+(?:url\()?["']?([^"')]+)["']?\)?\s*;/gi;
  let result = "";
  let cursor = 0;
  let match;
  while ((match = importRegex.exec(css))) {
    result += css.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const importHref = match[1];
    try {
      const importUrl = new URL(importHref, baseUrl);
      if (seen.has(importUrl.href)) continue;
      seen.add(importUrl.href);
      const response = await fetch(importUrl.href, { cache: "no-store" });
      if (!response.ok) continue;
      const importedCss = await response.text();
      result += `\n/* inlined ${importHref} */\n`;
      result += await inlineCssImportsForZip(importedCss, importUrl, seen);
      result += "\n";
    } catch (_err) {
      result += `\n/* skipped unresolved import ${importHref} */\n`;
    }
  }
  result += css.slice(cursor);
  return result;
}

async function getCurrentAppScriptForZip(path) {
  try {
    const response = await fetch(
      new URL(path, window.location.href).toString(),
      { cache: "no-store" },
    );
    return response.ok ? await response.text() : "";
  } catch (_err) {
    return "";
  }
}

function zipPathFromUrl(url) {
  const parsed = new URL(url, window.location.href);
  return parsed.pathname.replace(/^\/+/, "");
}

async function fetchLocalAsset(path, asText = false) {
  const url = new URL(path, window.location.href);
  if (url.origin !== window.location.origin) return null;
  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return null;
    return asText ? await response.text() : await response.arrayBuffer();
  } catch (_err) {
    return null;
  }
}

async function addCssWithLocalDependenciesToZip(zip, path, seen = new Set()) {
  const normalizedPath = zipPathFromUrl(path);
  if (seen.has(normalizedPath)) return;
  seen.add(normalizedPath);

  const css = await fetchLocalAsset(normalizedPath, true);
  if (!css) return;
  zip.file(normalizedPath, css);

  const baseUrl = new URL(normalizedPath, window.location.href);
  const importPattern = /@import\s+url\((['"]?)([^'")]+)\1\)/g;
  const assetPattern = /url\((['"]?)([^'")]+)\1\)/g;
  const dependencies = new Set();
  let match;

  while ((match = importPattern.exec(css))) {
    dependencies.add(new URL(match[2], baseUrl).toString());
  }
  while ((match = assetPattern.exec(css))) {
    const value = match[2].trim();
    if (!value || value.startsWith("data:") || /^[a-z]+:/i.test(value)) continue;
    dependencies.add(new URL(value, baseUrl).toString());
  }

  for (const dependency of dependencies) {
    const dependencyPath = zipPathFromUrl(dependency);
    if (/\.css(?:$|\?)/i.test(dependencyPath)) {
      await addCssWithLocalDependenciesToZip(zip, dependencyPath, seen);
      continue;
    }
    const asset = await fetchLocalAsset(dependencyPath);
    if (asset) zip.file(dependencyPath, asset);
  }
}

async function addOfflineViewerVendorAssetsToZip(zip) {
  await addCssWithLocalDependenciesToZip(zip, "vendor/fonts/fonts.css");
  await addCssWithLocalDependenciesToZip(zip, "vendor/fontawesome/css/all.min.css");
  const ngl = await fetchLocalAsset("vendor/ngl/ngl.js", true);
  if (ngl) zip.file("vendor/ngl/ngl.js", ngl);
}

async function addAnimationRuntimeScriptsToZip(zip) {
  const scripts = [
    "js/animations/animation-utils.js",
    "js/animations/animation-state.js",
    "js/animations/animation-engine.js",
  ];
  for (const path of scripts) {
    const source = await getCurrentAppScriptForZip(path);
    if (source) zip.file(path, source);
  }
}

/**
 * Exports the presentation as a PDF using html2canvas and jsPDF.
 */
function getActiveExportSlideElement() {
  return (
    document.querySelector(".reveal .slides section.present") ||
    document.querySelector(".presentation-slide.present") ||
    document.querySelector(".presentation-slide")
  );
}

// html2canvas draws the browser's list numbers (ol markers) above their line. While a slide is captured, each
// numbered item gets its number as real text in the marker's place; restoreListMarkers puts things back.
function _listMarkerText(index, style) {
  const alpha = (n, upper) => {
    let out = "";
    for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(97 + ((v - 1) % 26)) + out;
    return upper ? out.toUpperCase() : out;
  };
  const roman = (n) => {
    const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    let v = n;
    for (const [value, letters] of table) for (; v >= value; v -= value) out += letters;
    return out;
  };
  switch (style) {
    case "decimal-leading-zero": return String(index).padStart(2, "0");
    case "lower-roman": return roman(index);
    case "upper-roman": return roman(index).toUpperCase();
    case "lower-alpha":
    case "lower-latin": return alpha(index, false);
    case "upper-alpha":
    case "upper-latin": return alpha(index, true);
    case "lower-greek": return "αβγδεζηθικλμνξοπρστυφχψω"[(index - 1) % 24];
    default: return String(index);
  }
}

function replaceListMarkersForCapture(root = document) {
  const changed = [];
  root.querySelectorAll(".canvas-element ol").forEach((list) => {
    const style = getComputedStyle(list).listStyleType;
    if (!style || style === "none") return;
    let index = Number(list.getAttribute("start")) || 1;
    Array.from(list.children).forEach((item) => {
      if (item.tagName !== "LI") return;
      const marker = document.createElement("span");
      marker.className = "sf-export-list-marker";
      marker.textContent = `${_listMarkerText(index++, style)}.`;
      changed.push({ item, marker, position: item.style.position });
      if (getComputedStyle(item).position === "static") item.style.position = "relative";
      item.prepend(marker);
    });
    changed.push({ list, listStyle: list.style.listStyleType });
    list.style.listStyleType = "none";
  });
  return () =>
    changed.forEach((entry) => {
      if (entry.marker) {
        entry.marker.remove();
        entry.item.style.position = entry.position;
      } else {
        entry.list.style.listStyleType = entry.listStyle;
      }
    });
}

function hideExportEditorUi() {
  document.body.classList.add("exporting-slides"); // hides placeholder hints in the captured image
  const restoreListMarkers = replaceListMarkersForCapture();
  const hiddenNodes = Array.from(
    document.querySelectorAll(
      ".resize-handle, .crop-handle, .connector-point-handle, #group-bound, .anim-badge",
    ),
  ).map((el) => ({ el, display: el.style.display }));
  hiddenNodes.forEach(({ el }) => {
    el.style.display = "none";
  });

  const selectedNodes = Array.from(
    document.querySelectorAll(
      ".canvas-element.selected, .canvas-element.group-member-selected",
    ),
  ).map((el) => ({
    el,
    selected: el.classList.contains("selected"),
    groupMemberSelected: el.classList.contains("group-member-selected"),
  }));
  selectedNodes.forEach(({ el }) =>
    el.classList.remove("selected", "group-member-selected"),
  );

  return () => {
    document.body.classList.remove("exporting-slides");
    restoreListMarkers();
    hiddenNodes.forEach(({ el, display }) => {
      el.style.display = display;
    });
    selectedNodes.forEach(({ el, selected, groupMemberSelected }) => {
      el.classList.toggle("selected", selected);
      el.classList.toggle("group-member-selected", groupMemberSelected);
    });
    if (typeof updateGroupBound === "function") updateGroupBound();
  };
}

const DEFAULT_EXPORT_PAGE_SIZE = Object.freeze({
  defaultWidth: 1024,
  defaultHeight: 768,
});

function getExportPageSetup() {
  const config =
    typeof getPresentationPageSetupConfig === "function"
      ? getPresentationPageSetupConfig()
      : {};
  const width = Number(config.width) || DEFAULT_EXPORT_PAGE_SIZE.defaultWidth;
  const height =
    Number(config.height) || DEFAULT_EXPORT_PAGE_SIZE.defaultHeight;
  return {
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
  };
}

// The editor shows slides through a CSS zoom; html2canvas measures text inside that transform and misplaces
// words (they ran together in exported PDFs), and the scaled slide did not fill the page. Captures therefore
// run at 100% zoom, restoring the editor's zoom and scroll position afterwards.
async function withUnzoomedSlides(capture) {
  const canZoom = typeof applyZoom === "function" && typeof stateZoom === "number";
  const previousZoom = canZoom ? stateZoom : null;
  const previousMode = typeof zoomMode === "string" ? zoomMode : null;
  const wrapper = document.getElementById("canvas-wrapper");
  const scroll = wrapper ? { left: wrapper.scrollLeft, top: wrapper.scrollTop } : null;
  if (canZoom && stateZoom !== 1) {
    stateZoom = 1;
    applyZoom();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  try {
    return await capture();
  } finally {
    if (canZoom) {
      stateZoom = previousZoom;
      if (previousMode !== null) zoomMode = previousMode;
      applyZoom();
      if (wrapper && scroll) wrapper.scrollTo(scroll.left, scroll.top);
    }
  }
}

// Gives auto-height text elements of an export state their rendered height (in slide pixels), read from the slide
// as drawn in the editor. Exports cannot lay text out to find it.
function fillMeasuredTextHeights(exportState) {
  const { width: slideWidth } = getExportPageSetup();
  const restore = [];
  (exportState?.slides || []).forEach((slide) => {
    (slide.elements || []).forEach((el) => {
      if (el?.type !== "text") return;
      const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find((item) => !item.closest("#slide-previews"));
      const section = node?.closest("section");
      if (!node || !section) return;
      // Slides far from the one on screen are not laid out (display: none) and measure as nothing: lay this one
      // out for the measurement. Nothing is painted in between.
      if (getComputedStyle(section).display === "none") {
        const { display, visibility } = section.style;
        section.style.setProperty("display", "block", "important");
        section.style.visibility = "hidden";
        restore.push(() => {
          section.style.display = display;
          section.style.visibility = visibility;
        });
      }
      // Line spacing as drawn (it comes from the theme and the list styles, not from the element), so lists keep
      // their air in PowerPoint.
      const rows = node.querySelectorAll(".ppt-bullet-row, li");
      const line = getComputedStyle(rows[0] || node.querySelector(".text-element-content") || node);
      const linePx = parseFloat(line.lineHeight);
      const lineHeight = linePx / parseFloat(line.fontSize);
      if (Number.isFinite(lineHeight) && lineHeight > 0) el.exportLineHeight = Math.round(lineHeight * 100) / 100;
      // ...and the space between one list item and the next. A row is taller than its line (the bullet sits on the
      // text's baseline); the shortest row holds a single line, so what it has over the line height is that space.
      const rowHeight = Math.min(...[...rows].map((row) => row.offsetHeight).filter((height) => height > 0));
      const between = rows.length > 1 ? rows[1].offsetTop - (rows[0].offsetTop + rows[0].offsetHeight) : 0;
      const gap = Math.max(0, between) + (Number.isFinite(rowHeight) && linePx > 0 ? Math.max(0, rowHeight - linePx) : 0);
      if (gap > 0) el.exportParagraphGap = Math.round(gap);
      if (Number.isFinite(parseFloat(el.height))) return;
      // The slide may be shown zoomed: its drawn width against its real width gives the scale to undo.
      const scale = section.getBoundingClientRect().width / slideWidth || 1;
      const height = node.getBoundingClientRect().height / scale;
      if (height > 0) el.height = `${Math.round(height)}px`;
    });
  });
  restore.forEach((undo) => undo());
}

// A file name from the project title, like the PowerPoint and HTML exports.
function exportFileName(extension) {
  const title = document.getElementById("project-title-input")?.value.trim() || "presentation";
  return `${title.replace(/[\\/:*?"<>|]+/g, "-")}.${extension}`;
}

// The slide as a picture, for PDF and PNG export.
async function captureSlideCanvas(slide, page, scale) {
  // html2canvas finds each font's baseline with a small image it adds to this page's <body> for a moment. The
  // page's CSS reset makes images display: block, which puts that baseline about 0.4 of the font size too low:
  // a 34px title was drawn 16px lower in the PDF than in the editor. While it captures, such probe images are
  // inline again; nothing in the app is a body > div > img.
  const style = document.createElement("style");
  style.textContent = "body > div > img { display: inline-block !important; }";
  document.head.appendChild(style);
  try {
    return await html2canvas(slide, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      width: page.width,
      height: page.height,
      windowWidth: page.width,
      windowHeight: page.height,
    });
  } finally {
    style.remove();
  }
}

// A PDF whose page is the slide: 1280 x 720 px is 960 x 540 pt, as in the PowerPoint export. Without the
// "px_scaling" fix jsPDF takes a px for 4/3 pt, and the page came out 1707 x 960 pt (23.7 in wide).
function createExportPdf(page) {
  return new jspdf.jsPDF({
    orientation: page.orientation,
    unit: "px",
    format: [page.width, page.height],
    hotfixes: ["px_scaling"],
  });
}

async function exportPDF() {
  const page = getExportPageSetup();
  const pdf = createExportPdf(page);
  const originalIndex = currentSlideIndex;

  try {
    setProjectSaveHint?.("Generating PDF...", "success");

    await withUnzoomedSlides(async () => {
    for (let i = 0; i < state.slides.length; i++) {
      if (typeof window.switchSlide === "function") {
        window.switchSlide(i);
      } else if (typeof Reveal !== "undefined" && Reveal.slide) {
        Reveal.slide(i);
      }
      await new Promise((r) => setTimeout(r, 800));

      const slide = getActiveExportSlideElement();
      if (!slide) throw new Error("Active slide not found for export");
      const restoreEquations =
        typeof showEquationsAsPicturesForCapture === "function" ? await showEquationsAsPicturesForCapture(slide) : () => {};
      const restoreMolecules =
        typeof showMoleculesAsPicturesForCapture === "function" ? await showMoleculesAsPicturesForCapture(slide) : () => {};
      const restorePdfs = typeof showPdfsAsPicturesForCapture === "function" ? await showPdfsAsPicturesForCapture(slide) : () => {};
      const restoreHtml =
        typeof showHtmlEmbedsAsPicturesForCapture === "function" ? await showHtmlEmbedsAsPicturesForCapture(slide) : () => {};
      const restoreUi = hideExportEditorUi();
      let canvas;
      try {
        canvas = await captureSlideCanvas(slide, page, 3);
      } finally {
        restoreUi();
        restoreEquations();
        restoreMolecules();
        restorePdfs();
        restoreHtml();
      }

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage([page.width, page.height], page.orientation);
      pdf.addImage(imgData, "JPEG", 0, 0, page.width, page.height);
      setProjectSaveHint?.(
        `Generated slide ${i + 1}/${state.slides.length}`,
        "success",
      );
    }
    });

    pdf.save(exportFileName("pdf"));
    setProjectSaveHint?.("PDF Exported!", "success");
  } catch (err) {
    console.error(err);
    setProjectSaveHint?.(err?.message || "PDF export failed", "danger");
  } finally {
    if (typeof window.switchSlide === "function") {
      window.switchSlide(originalIndex);
    } else if (typeof Reveal !== "undefined" && Reveal.slide) {
      Reveal.slide(originalIndex);
    }
  }
}

async function exportPNG() {
  try {
    setProjectSaveHint?.("Generating Image...", "success");
    const page = getExportPageSetup();
    const slide = getActiveExportSlideElement();
    if (!slide) throw new Error("Active slide not found for export");

    let restoreEquations = () => {};
    const restoreUi = hideExportEditorUi();
    let canvas;
    try {
      canvas = await withUnzoomedSlides(async () => {
        if (typeof showEquationsAsPicturesForCapture === "function") {
          restoreEquations = await showEquationsAsPicturesForCapture(slide);
        }
        if (typeof showMoleculesAsPicturesForCapture === "function") {
          const restoreMolecules = await showMoleculesAsPicturesForCapture(slide);
          const restoreFirst = restoreEquations;
          restoreEquations = () => {
            restoreFirst();
            restoreMolecules();
          };
        }
        if (typeof showPdfsAsPicturesForCapture === "function") {
          const restorePdfs = await showPdfsAsPicturesForCapture(slide);
          const restoreEarlier = restoreEquations;
          restoreEquations = () => {
            restoreEarlier();
            restorePdfs();
          };
        }
        if (typeof showHtmlEmbedsAsPicturesForCapture === "function") {
          const restoreHtml = await showHtmlEmbedsAsPicturesForCapture(slide);
          const restoreBefore = restoreEquations;
          restoreEquations = () => {
            restoreBefore();
            restoreHtml();
          };
        }
        return captureSlideCanvas(slide, page, 4);
      });
    } finally {
      restoreUi();
      restoreEquations();
    }

    const link = document.createElement("a");
    link.download = exportFileName("png").replace(/\.png$/, ` - slide ${currentSlideIndex + 1}.png`);
    link.href = canvas.toDataURL("image/png");
    link.click();

    setProjectSaveHint?.("PNG Exported!", "success");
  } catch (err) {
    console.error(err);
    setProjectSaveHint?.(err?.message || "Image export failed", "danger");
  }
}

window.exportPresentationPNG = exportPNG;

/**
 * GET CSRF TOKEN helper
 */
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== "") {
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === name + "=") {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

/**
 * Exports the presentation to a native PowerPoint (.pptx) format.
 */
// A diagram as a PNG of its box (the drawing centred and fitted, as on the slide), drawn by the browser. The server
// turned the SVG into a picture itself and ignored Mermaid's CSS, so mind maps came out as black boxes without
// labels and ER relationship labels as black blocks.
async function mermaidSvgToPng(svgText, boxWidth, boxHeight, scale = 3, { stretch = false } = {}) {
  const svg = new DOMParser().parseFromString(String(svgText || ""), "image/svg+xml").documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error("not an SVG");
  const viewBox = String(svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const width = viewBox[2] > 0 ? viewBox[2] : parseFloat(svg.getAttribute("width")) || boxWidth;
  const height = viewBox[3] > 0 ? viewBox[3] : parseFloat(svg.getAttribute("height")) || boxHeight;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.maxWidth = "none";
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(boxWidth * scale));
  canvas.height = Math.max(1, Math.round(boxHeight * scale));
  const ctx = canvas.getContext("2d");
  if (stretch) {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } else {
    const fit = Math.min(boxWidth / width, boxHeight / height) * scale;
    ctx.drawImage(image, (canvas.width - width * fit) / 2, (canvas.height - height * fit) / 2, width * fit, height * fit);
  }
  return canvas.toDataURL("image/png");
}

// SVG pictures likewise: the server turned them into PNGs with CairoSVG, which needs the Cairo library (usually
// missing on Windows and macOS, where the picture was dropped from the PowerPoint file). A picture fills its box, so
// the PNG is drawn stretched to it, at twice its size as the server did.
async function replaceSvgPicturesWithPng(exportState) {
  for (const slide of exportState?.slides || []) {
    for (const el of slide.elements || []) {
      const content = typeof el?.content === "string" ? el.content : "";
      if (el?.type !== "image" || !(content.startsWith("data:image/svg") || /\.svg(\?|#|$)/i.test(content))) continue;
      try {
        // A data URL is decoded here (the page's Content-Security-Policy does not let fetch read data: URLs).
        let svgText;
        if (content.startsWith("data:")) {
          const [head, data = ""] = content.split(",", 2);
          svgText = /;base64/i.test(head) ? decodeURIComponent(escape(atob(data))) : decodeURIComponent(data);
        } else {
          const response = await fetch(content);
          if (!response.ok) continue;
          svgText = await response.text();
        }
        if (!/<svg[\s>]/i.test(svgText)) continue;
        el.content = await mermaidSvgToPng(svgText, parseFloat(el.width) || 320, parseFloat(el.height) || 240, 2, { stretch: true });
      } catch (error) {
        console.warn("SVG picture left for the server to convert:", error);
      }
    }
  }
}

async function replaceMermaidWithPictures(exportState) {
  for (const slide of exportState?.slides || []) {
    for (const [index, el] of (slide.elements || []).entries()) {
      if (el?.type !== "mermaid" || !el.svgContent) continue;
      try {
        const width = parseFloat(el.width) || 560;
        const height = parseFloat(el.height) || 360;
        slide.elements[index] = {
          id: el.id,
          type: "image",
          content: await mermaidSvgToPng(el.svgContent, width, height),
          x: el.x,
          y: el.y,
          width: `${width}px`,
          height: `${height}px`,
          rotation: el.rotation,
          styles: { ...(el.styles || {}), backgroundColor: "transparent" },
          animation: el.animation || null,
          exportedFrom: "mermaid",
        };
      } catch (error) {
        console.warn("Diagram kept as is in the export:", error);
      }
    }
  }
}

async function exportPPTX() {
  try {
    setProjectSaveHint?.("Generating PowerPoint...", "success");
    if (typeof syncMoleculeViewStatesFromDom === "function") {
      await syncMoleculeViewStatesFromDom();
    }

    // Use the same filename as the project title
    const titleInput = document.getElementById("project-title-input");
    const filename =
      (titleInput && titleInput.value.trim()
        ? titleInput.value.trim()
        : "presentation") + ".pptx";
    const snapshot = JSON.parse(
      JSON.stringify(
        typeof getPersistableState === "function" ? getPersistableState() : state,
      ),
    );
    if (!Array.isArray(snapshot.slides)) snapshot.slides = [];
    const exportState = withRenderedMasterElements(
      snapshot,
      getPresentationTheme(),
    );
    // Text boxes that grow with their text are sent with the height they have on the slide, not "auto".
    fillMeasuredTextHeights(exportState);
    // The theme's slide gradient, so PowerPoint slides get the same background instead of one flat colour.
    exportState.themeBackgroundCss = String(getPresentationTheme()?.cssVars?.["--slide-bg"] || "");
    // Shape text with its colours and sizes worked out (the defaults depend on the shape's fill and the theme).
    exportState.slides.forEach(slide => (slide.elements || []).forEach(el => {
        if (el?.type === "shape" && el.shapeText && typeof getShapeTextStyle === "function") el.shapeTextStyle = getShapeTextStyle(el);
    }));
    // PowerPoint cannot show KaTeX: equations go in as pictures instead of an "Equation placeholder" box.
    if (typeof replaceEquationsWithPictures === "function") await replaceEquationsWithPictures(exportState);
    // Likewise molecules: a picture of the view as it is now, instead of a "Molecule placeholder".
    if (typeof replaceMoleculesWithPictures === "function") await replaceMoleculesWithPictures(exportState);
    if (typeof replacePdfsWithPictures === "function") await replacePdfsWithPictures(exportState);
    await replaceMermaidWithPictures(exportState);
    await replaceSvgPicturesWithPng(exportState);
    // And HTML embeds: PowerPoint cannot run them, so a picture of the embed instead of a placeholder.
    if (typeof replaceHtmlEmbedsWithPictures === "function") await replaceHtmlEmbedsWithPictures(exportState);

    const response = await fetch("/api/presentations/export/pptx/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({
        state: exportState,
        filename: filename,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to generate PPTX on server");
    }

    const blob = await response.blob();
    saveAs(blob, filename);
    setProjectSaveHint?.("PPTX Exported!", "success");
  } catch (err) {
    console.error(err);
    setProjectSaveHint?.(err?.message || "PPTX export failed", "danger");
  }
}

/**
 * Scans state for DataURLs (images/videos), extracts them, and updates paths.
 */
// A file extension the server recognises: "image/svg+xml" gave "asset_3.svg+xml", which was served as unknown
// binary and refused by the browser (shared diagrams showed a broken picture).
function _assetExtension(mime) {
  const subtype = String(mime || "").split("/")[1]?.split(";")[0].trim().toLowerCase() || "";
  return { "svg+xml": "svg", jpeg: "jpg", quicktime: "mov", "x-matroska": "mkv" }[subtype] || subtype.replace(/[^a-z0-9]/g, "");
}

async function processStateAssets(originalState) {
  const newState = JSON.parse(JSON.stringify(originalState));
  const assets = {};
  let assetCounter = 0;

  const toBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result || "").split(",", 2)[1] || "");
      reader.onerror = () =>
        reject(reader.error || new Error("Failed to read asset blob"));
      reader.readAsDataURL(blob);
    });

  const isBundlableLocalAsset = (value) => {
    if (typeof value !== "string" || !value) return false;
    if (value.startsWith("/media/")) return true;
    if (value.startsWith("/extracted_figures/")) return true;
    try {
      const url = new URL(value, window.location.href);
      return (
        url.origin === window.location.origin &&
        (url.pathname.startsWith("/media/") ||
          url.pathname.startsWith("/extracted_figures/"))
      );
    } catch (_err) {
      return false;
    }
  };

  for (const slide of newState.slides) {
    if (slide.background?.content) {
      const bg = slide.background;
      if (
        (bg.type === "image" || bg.type === "video") &&
        String(bg.content).startsWith("data:")
      ) {
        const parts = bg.content.split(",");
        if (parts.length >= 2) {
          const meta = parts[0];
          const base64Data = parts[1];
          const mimeMatch = meta.match(/data:(.*?);/);
          const mime = mimeMatch
            ? mimeMatch[1]
            : bg.type === "image"
              ? "image/png"
              : "video/mp4";
          const ext =
            _assetExtension(mime) || (bg.type === "image" ? "png" : "mp4");
          const fileName = `asset_${assetCounter++}.${ext}`;
          assets[fileName] = base64Data;
          slide.background.content = `assets/${fileName}`;
        }
      } else if (
        (bg.type === "image" || bg.type === "video") &&
        (isBundlableLocalAsset(bg.content) ||
          String(bg.content || "").startsWith("blob:"))
      ) {
        const sourceUrl = new URL(bg.content, window.location.href);
        const response = await fetch(sourceUrl.toString());
        if (response.ok) {
          const blob = await response.blob();
          const mime =
            blob.type || (bg.type === "image" ? "image/png" : "video/mp4");
          const ext =
            _assetExtension(mime) || (bg.type === "image" ? "png" : "mp4");
          const fileName = `asset_${assetCounter++}.${ext}`;
          assets[fileName] = await toBase64(blob);
          slide.background.content = `assets/${fileName}`;
        }
      }
    }
    for (const el of slide.elements) {
      // A molecule's binary trajectory goes into the file itself: the exported page cannot reach the app.
      const trajectoryUrl = el.type === "molecule" ? String(el.moleculeTrajectory?.url || "") : "";
      if (trajectoryUrl && (isBundlableLocalAsset(trajectoryUrl) || trajectoryUrl.startsWith("blob:"))) {
        try {
          const response = await fetch(new URL(trajectoryUrl, window.location.href).toString());
          if (response.ok) el.moleculeTrajectory = { ...el.moleculeTrajectory, url: `data:application/octet-stream;base64,${await toBase64(await response.blob())}` };
        } catch (error) {
          console.warn("Could not include the trajectory", error);
        }
      }
      // Extract local media/molecule content if it's a data URL or app asset URL.
      if (
        (el.type === "image" || el.type === "video" || el.type === "pdf") &&
        el.content?.startsWith("data:")
      ) {
        const parts = el.content.split(",");
        if (parts.length < 2) continue;

        const meta = parts[0];
        const base64Data = parts[1];
        const mimeMatch = meta.match(/data:(.*?);/);
        const mime = mimeMatch
          ? mimeMatch[1]
          : el.type === "image"
            ? "image/png"
            : el.type === "pdf"
              ? "application/pdf"
              : "video/mp4";
        const ext =
          mime === "application/pdf"
            ? "pdf"
            : _assetExtension(mime) || (el.type === "image" ? "png" : "mp4");

        const fileName = `asset_${assetCounter++}.${ext}`;
        assets[fileName] = base64Data;
        el.content = `assets/${fileName}`;
      } else if (
        (el.type === "image" ||
          el.type === "video" ||
          el.type === "pdf" ||
          el.type === "molecule") &&
        (isBundlableLocalAsset(el.content) ||
          String(el.content || "").startsWith("blob:"))
      ) {
        const sourceUrl = new URL(el.content, window.location.href);
        const response = await fetch(sourceUrl.toString());
        if (!response.ok) continue;

        const blob = await response.blob();
        if (el.type === "molecule") {
          el.content = await blob.text();
          el.moleculeSourceType = "inline";
          continue;
        }

        const mime =
          blob.type ||
          (el.type === "image"
            ? "image/png"
            : el.type === "pdf"
              ? "application/pdf"
              : el.type === "molecule"
                ? "chemical/x-pdb"
                : "video/mp4");
        const ext =
          mime === "application/pdf"
            ? "pdf"
            : _assetExtension(mime) || (el.type === "image" ? "png" : "mp4");
        const fileName = `asset_${assetCounter++}.${ext}`;
        assets[fileName] = await toBase64(blob);
        el.content = `assets/${fileName}`;
      }
    }
  }

  return { processedState: newState, assets };
}

function generateViewerHtml(stateJson, theme) {
  const safeStateJson = stateJson
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/<\/script/gi, "<\\\\/script");
  // The tab title of a shared link or exported page: the project's name.
  const viewerTitle = (document.getElementById("project-title-input")?.value.trim() || "Presentation").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
  return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${viewerTitle}</title>
    <link rel="stylesheet" href="vendor/fonts/fonts.css" />
    <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css" />
    <link rel="stylesheet" href="css/viewer.css" />
    <script id="presentation-data" type="application/json">${safeStateJson}</script>
</head>
<body>
    <div class="standalone-shell">
        <div class="standalone-stage" id="viewer-stage">
            <div class="standalone-canvas" id="slides-container">
                <!-- Slides injected here -->
            </div>
            <canvas class="presentation-overlay presentation-chalkboard" id="chalkboard-canvas"></canvas>
            <div class="presentation-overlay presentation-laser" id="laser-pointer" aria-hidden="true"></div>
            <div class="standalone-presentation-ui">
                <div id="viewer-chalk-tools" class="presentation-chalk-tools hidden" aria-label="Chalk tools">
                    <div id="viewer-chalk-indicator" class="presentation-chalk-indicator" aria-hidden="true">
                        <span>Chalk</span>
                    </div>
                    <label class="presentation-chalk-color-chip" for="viewer-chalk-color-chip" title="Chalk color">
                        <span class="sr-only">Chalk color</span>
                        <input id="viewer-chalk-color-chip" type="color" value="#fff59d" />
                    </label>
                    <button id="viewer-chalk-eraser" class="presentation-chalk-action" type="button" title="Clear chalkboard">
                        <span>Eraser</span>
                    </button>
                </div>
                <div class="presentation-menu-shell">
                    <button id="viewer-menu-toggle" class="presentation-menu-toggle" type="button" aria-label="Presentation menu">
                        <i class="fa-solid fa-bars"></i>
                    </button>
                    <div id="viewer-menu" class="presentation-menu hidden">
                        <button id="btn-prev" class="presentation-menu-item" type="button"><span>Previous</span></button>
                        <button id="btn-next" class="presentation-menu-item" type="button"><span>Next</span></button>
                        <button id="btn-fullscreen" class="presentation-menu-item" type="button"><span>Fullscreen</span></button>
                        <button id="btn-chalk" class="presentation-menu-item" type="button"><span>Chalkboard</span></button>
                        <label class="presentation-menu-color" for="viewer-chalk-color"><span>Chalk Color</span><input id="viewer-chalk-color" type="color" value="#fff59d" /></label>
                        <button id="btn-clear-chalk" class="presentation-menu-item" type="button"><span>Clear Chalk</span></button>
                        <button id="btn-laser" class="presentation-menu-item" type="button"><span>Laser</span></button>
                        <div class="presentation-menu-hint">Right click for this menu. Keys: F, L, B, X.</div>
                    </div>
                </div>
                <div id="viewer-context-menu" class="presentation-menu presentation-context-menu hidden">
                    <button id="viewer-context-prev" class="presentation-menu-item" type="button"><span>Previous</span></button>
                    <button id="viewer-context-next" class="presentation-menu-item" type="button"><span>Next</span></button>
                    <button id="viewer-context-fullscreen" class="presentation-menu-item" type="button"><span>Fullscreen</span></button>
                    <button id="viewer-context-chalk" class="presentation-menu-item" type="button"><span>Chalkboard</span></button>
                    <button id="viewer-context-clear" class="presentation-menu-item" type="button"><span>Clear Chalk</span></button>
                    <button id="viewer-context-laser" class="presentation-menu-item" type="button"><span>Laser</span></button>
                </div>
                <div class="standalone-status" id="viewer-status">1 / 1</div>
            </div>
        </div>
    </div>

    <script src="js/animations/animation-utils.js"></script>
    <script src="js/animations/animation-state.js"></script>
    <script src="js/animations/animation-engine.js"></script>
    <script src="js/viewer.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const dataEl = document.getElementById('presentation-data');
            if (!dataEl) {
                console.error("Presentation data not found.");
                return;
            }
            try {
                initViewer(JSON.parse(dataEl.textContent || '{}'));
            } catch (err) {
                console.error("Failed to parse presentation data.", err);
            }
        });
    </script>
</body>
</html>`;
}

function generateViewerCss(theme, appCss = "") {
  let vars = "";
  if (theme.cssVars) {
    for (const [key, val] of Object.entries(theme.cssVars)) {
      vars += `${key}: ${val};\n`;
    }
  }

  return `
${appCss}

:root {
    ${vars}
    --slide-width: 1024px;
    --slide-height: 768px;
}

.hidden { display: none !important; }

body {
    background:
        radial-gradient(circle at top, rgba(255,255,255,0.08), transparent 30%),
        linear-gradient(180deg, #111827 0%, #020617 100%);
    margin: 0;
    overflow: hidden;
    color: var(--slide-fg, #fff);
    font-family: system-ui, sans-serif;
}

.standalone-shell {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
}

.standalone-stage {
    flex: 1;
    min-height: 0;
    padding: 20px;
    position: relative;
    touch-action: pinch-zoom; /* swipes change slides (viewer.js) instead of panning the page */
}

@media (max-width: 640px), (max-height: 480px) {
    .standalone-stage {
        padding: 6px;
    }
}

/* Centred by position, not by the grid: a slide wider than a phone screen would otherwise stick out to the right. */
.standalone-canvas {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--slide-width);
    height: var(--slide-height);
    transform: translate(-50%, -50%);
    transform-origin: center center;
}

.presentation-slide {
    position: absolute;
    inset: 0;
    background: var(--slide-bg);
    color: var(--slide-fg);
    overflow: hidden;
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
}

.presentation-slide.is-active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
}

.slide-background-media {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
}

.slide-background-media > .slide-background-image,
.slide-background-media > .slide-background-video,
.slide-background-media > .slide-background-three-canvas {
    position: absolute;
    inset: 0;
    width: 100% !important;
    height: 100% !important;
    min-width: 100%;
    min-height: 100%;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    display: block;
}

.slide-background-three {
    background:
        radial-gradient(circle at 72% 22%, color-mix(in srgb, var(--slide-accent, #2563eb) 18%, transparent), transparent 32%),
        radial-gradient(circle at 22% 78%, color-mix(in srgb, var(--slide-accent-2, #0f766e) 18%, transparent), transparent 34%),
        var(--slide-bg);
}

.standalone-presentation-ui {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 30;
    display: flex;
    align-items: flex-start;
    gap: 10px;
}

.standalone-status {
    min-width: 70px;
    text-align: center;
    color: rgba(255,255,255,0.82);
    padding: 12px 14px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(15,23,42,0.72);
    backdrop-filter: blur(14px);
}

.presentation-menu-shell {
    position: relative;
}

.presentation-chalk-tools {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-right: 10px;
    padding: 8px 10px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(15,23,42,0.8);
    box-shadow: 0 18px 48px rgba(2, 6, 23, 0.35);
    backdrop-filter: blur(16px);
}

.presentation-chalk-indicator,
.presentation-chalk-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 12px;
    border-radius: 12px;
    color: rgba(255,255,255,0.94);
    font-size: 13px;
    font-weight: 700;
}

.presentation-chalk-indicator {
    background: rgba(255,255,255,0.06);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset;
}

.presentation-chalk-action {
    border: 0;
    background: transparent;
}

.presentation-chalk-color-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset;
}

.presentation-chalk-color-chip input[type="color"] {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
}

.presentation-menu-toggle {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(15,23,42,0.72);
    color: white;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(14px);
    transition: background 0.16s ease, transform 0.16s ease;
}

.presentation-menu-toggle:hover,
.presentation-menu-item:hover {
    background: rgba(30,41,59,0.9);
}

.presentation-menu {
    min-width: 200px;
    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(15,23,42,0.86);
    box-shadow: 0 18px 48px rgba(2, 6, 23, 0.45);
    backdrop-filter: blur(16px);
}

.presentation-menu-shell > .presentation-menu {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
}

.presentation-context-menu {
    position: fixed;
    z-index: 35;
}

.presentation-menu-item {
    width: 100%;
    border: 0;
    background: transparent;
    color: rgba(255,255,255,0.94);
    padding: 10px 12px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    transition: background 0.16s ease;
}

.presentation-menu-color {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    color: rgba(255,255,255,0.94);
    font-size: 13px;
    font-weight: 600;
}

.presentation-menu-color input[type="color"] {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    cursor: pointer;
}

.presentation-menu-item.is-active,
.presentation-menu-toggle.is-active {
    background: rgba(14,165,233,0.22);
    border-color: rgba(56,189,248,0.7);
}

.presentation-menu-hint {
    margin-top: 6px;
    padding: 8px 10px 4px;
    color: rgba(226,232,240,0.76);
    font-size: 11px;
    line-height: 1.35;
}

.presentation-overlay {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--slide-width);
    height: var(--slide-height);
    transform-origin: center center;
}

.presentation-chalkboard {
    z-index: 5;
    pointer-events: none;
    background: transparent;
}

.presentation-chalkboard.is-active {
    pointer-events: auto;
}

.presentation-laser {
    z-index: 10050;
    position: fixed;
    inset: auto;
    width: 24px;
    height: 24px;
    margin: 0;
    border-radius: 999px;
    background:
        radial-gradient(circle, #fff 0 6%, #ff1744 7% 20%, rgba(255, 23, 68, 0.72) 21% 38%, rgba(255, 23, 68, 0.26) 39% 58%, transparent 70%),
        radial-gradient(circle, rgba(0, 0, 0, 0.42) 0 46%, transparent 68%);
    border: 1px solid rgba(255, 255, 255, 0.82);
    box-shadow:
        0 0 0 1px rgba(86, 0, 0, 0.62),
        0 0 8px rgba(255, 0, 48, 0.95),
        0 0 18px rgba(255, 0, 48, 0.62),
        0 0 30px rgba(255, 0, 48, 0.28);
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -50%);
    will-change: left, top, opacity;
}

.presentation-laser::before,
.presentation-laser::after {
    content: "";
    position: absolute;
    inset: 50% auto auto 50%;
    pointer-events: none;
    transform: translate(-50%, -50%);
}

.presentation-laser::before {
    width: 30px;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.96) 35%, #ff1744 50%, rgba(255,255,255,0.96) 65%, transparent);
}

.presentation-laser::after {
    width: 2px;
    height: 30px;
    background: linear-gradient(180deg, transparent, rgba(255,255,255,0.96) 35%, #ff1744 50%, rgba(255,255,255,0.96) 65%, transparent);
}

.presentation-laser.is-active {
    opacity: 1;
}

.presentation-cursor-chalk,
.presentation-cursor-chalk * {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Cg transform='rotate(-36 20 20)'%3E%3Crect x='13' y='7' width='14' height='22' rx='4.5' fill='%23fff3b0' stroke='%23655426' stroke-width='1.5'/%3E%3Crect x='13' y='24' width='14' height='6.5' rx='2.8' fill='%23d4c48a' stroke='%23655426' stroke-width='1.2'/%3E%3Cpath d='M13 7h14l-2.6-4h-8.8z' fill='%23ffffff' stroke='%23655426' stroke-width='1.2'/%3E%3Cpath d='M16.5 3h7l-1.1-1.8h-4.8z' fill='%23f8fafc' opacity='0.85'/%3E%3C/g%3E%3C/svg%3E") 13 8, crosshair !important;
}

.presentation-cursor-hidden,
.presentation-cursor-hidden * {
    cursor: none !important;
}

.canvas-element.sf-anim-hidden {
    opacity: 0 !important;
    visibility: hidden !important;
}

.canvas-element.sf-anim-visible {
    opacity: 1;
    visibility: visible;
}

.canvas-element.sf-anim-playing {
    animation-duration: var(--sf-anim-duration, 800ms);
    animation-delay: var(--sf-anim-delay, 0ms);
    animation-timing-function: var(--sf-anim-easing, ease-out);
    animation-fill-mode: both;
}

.canvas-element.sf-anim-playing.sf-anim-effect-fade-in { animation-name: slideforgeFadeIn; }
.canvas-element.sf-anim-playing.sf-anim-effect-slide-up { animation-name: slideforgeSlideUp; }
.canvas-element.sf-anim-playing.sf-anim-effect-slide-down { animation-name: slideforgeSlideDown; }
.canvas-element.sf-anim-playing.sf-anim-effect-slide-left { animation-name: slideforgeSlideLeft; }
.canvas-element.sf-anim-playing.sf-anim-effect-slide-right { animation-name: slideforgeSlideRight; }
.canvas-element.sf-anim-playing.sf-anim-effect-zoom-in { animation-name: slideforgeZoomIn; }
.canvas-element.sf-anim-playing.sf-anim-effect-pop-in { animation-name: slideforgePopIn; }
.canvas-element.sf-anim-playing.sf-anim-effect-wipe-in { animation-name: slideforgeWipeIn; }
.canvas-element.sf-anim-playing.sf-anim-effect-pulse { animation-name: slideforgePulse; }
.canvas-element.sf-anim-playing.sf-anim-effect-glow { animation-name: slideforgeGlow; }

@keyframes slideforgeFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideforgeSlideUp {
    from { opacity: 0; transform: var(--sf-base-transform) translateY(var(--sf-anim-distance, 48px)); }
    to { opacity: 1; transform: var(--sf-base-transform) translateY(0); }
}

@keyframes slideforgeSlideDown {
    from { opacity: 0; transform: var(--sf-base-transform) translateY(calc(var(--sf-anim-distance, 48px) * -1)); }
    to { opacity: 1; transform: var(--sf-base-transform) translateY(0); }
}

@keyframes slideforgeSlideLeft {
    from { opacity: 0; transform: var(--sf-base-transform) translateX(var(--sf-anim-distance, 48px)); }
    to { opacity: 1; transform: var(--sf-base-transform) translateX(0); }
}

@keyframes slideforgeSlideRight {
    from { opacity: 0; transform: var(--sf-base-transform) translateX(calc(var(--sf-anim-distance, 48px) * -1)); }
    to { opacity: 1; transform: var(--sf-base-transform) translateX(0); }
}

@keyframes slideforgeZoomIn {
    from { opacity: 0; transform: var(--sf-base-transform) scale(var(--sf-anim-scale, 0.88)); }
    to { opacity: 1; transform: var(--sf-base-transform) scale(1); }
}

@keyframes slideforgePopIn {
    0% { opacity: 0; transform: var(--sf-base-transform) scale(calc(var(--sf-anim-scale, 0.88) - 0.1)); }
    75% { opacity: 1; transform: var(--sf-base-transform) scale(1.04); }
    100% { opacity: 1; transform: var(--sf-base-transform) scale(1); }
}

@keyframes slideforgeWipeIn {
    from { opacity: 0; clip-path: inset(0 100% 0 0); }
    to { opacity: 1; clip-path: inset(0 0 0 0); }
}

@keyframes slideforgePulse {
    0% { opacity: 1; transform: var(--sf-base-transform) scale(1); }
    50% { opacity: 1; transform: var(--sf-base-transform) scale(1.05); }
    100% { opacity: 1; transform: var(--sf-base-transform) scale(1); }
}

@keyframes slideforgeGlow {
    0% { opacity: 1; filter: drop-shadow(0 0 0 rgba(56, 189, 248, 0)); }
    50% { opacity: 1; filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.65)); }
    100% { opacity: 1; filter: drop-shadow(0 0 0 rgba(56, 189, 248, 0)); }
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.canvas-element {
    position: absolute;
    box-sizing: border-box;
    z-index: 1;
    cursor: default !important;
    outline: none !important;
    box-shadow: none;
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-user-drag: none;
}

.standalone-canvas .canvas-element,
.standalone-canvas .canvas-element *,
.standalone-canvas .text-element-content,
.standalone-canvas .table-element-cell {
    -webkit-user-select: none !important;
    user-select: none !important;
    caret-color: transparent !important;
}

.standalone-canvas .canvas-element::selection,
.standalone-canvas .canvas-element *::selection {
    background: transparent;
    color: inherit;
}

.standalone-canvas .canvas-element.selected,
.standalone-canvas .canvas-element.group-member-selected,
.standalone-canvas .canvas-element:focus,
.standalone-canvas .canvas-element:focus-visible,
.standalone-canvas .text-element-content:focus,
.standalone-canvas .table-element-cell:focus {
    outline: none !important;
    box-shadow: none !important;
    border-color: inherit;
}

/* Nothing in the viewer is editable: no hover frame (the editor's cue, which also stuck after a tap on a phone),
   no text cursor, no tap flash. Links in text keep their pointer. */
.standalone-canvas .canvas-element:hover,
.standalone-canvas .canvas-element:not(.selected):not(.group-member-selected):hover {
    outline: none !important;
    box-shadow: none;
}

.standalone-canvas .canvas-element,
.standalone-canvas .canvas-element * {
    -webkit-tap-highlight-color: transparent;
}

.standalone-canvas .text-element-content,
.standalone-canvas .table-element-cell,
.standalone-canvas .sf-shape-text {
    cursor: default !important;
}

.standalone-canvas .text-element-content a[href] {
    cursor: pointer !important;
}

.standalone-canvas .resize-handle,
.standalone-canvas .crop-handle,
.standalone-canvas .connector-point-handle,
.standalone-canvas .anim-badge,
.standalone-canvas #group-bound {
    display: none !important;
}

.connector-svg {
    overflow: visible;
    pointer-events: none;
}

.pdf-embed-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    position: relative;
    background: #f8fafc;
}

.pdf-embed-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    background: white;
}

.pdf-annotation {
    position: absolute;
}

.pdf-annotation-highlight {
    background: rgba(251, 191, 36, 0.32);
    outline: 1px solid rgba(245, 158, 11, 0.72);
    border-radius: 3px;
}

.pdf-annotation-note {
    transform: translate(-50%, -50%);
}

.pdf-note-dot {
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    display: inline-block;
    background: #0ea5e9;
    border: 2px solid #e0f2fe;
}

.pdf-note-label {
    position: absolute;
    left: 18px;
    top: -2px;
    white-space: nowrap;
    background: rgba(15, 23, 42, 0.88);
    color: white;
    font-size: 10px;
    line-height: 1.2;
    padding: 3px 6px;
    border-radius: 999px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.media-fill {
    width: 100%;
    height: 100%;
    display: block;
    border: none;
}

.table-element-shell,
.table-element-scroll {
    width: 100%;
    height: 100%;
}

.table-element-scroll {
    overflow: auto;
}

.table-element-grid {
    width: 100%;
    height: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    /* Cells paint their own fills; a see-through fill (a dark theme's table) shows the slide, not white. */
    background: transparent;
}

/* "Reveal bullets one by one" in the viewer (the app's rules apply only while presenting in the editor). */
.ppt-bullet-row.sf-bullet-hidden {
    opacity: 0;
    transform: translateY(10px);
}
.ppt-bullet-row.sf-bullet-shown {
    opacity: 1;
    transform: none;
    transition: opacity 380ms ease-out, transform 380ms ease-out;
}
.ppt-bullet-row.sf-bullet-instant {
    transition: none;
}

.table-element-cell {
    min-width: 56px;
    line-height: 1.35;
    word-break: break-word;
    outline: none;
}

.rounded-inherit {
    border-radius: inherit;
}

.text-element-content {
    width: 100%;
    height: 100%;
    outline: none;
    word-wrap: break-word;
    text-align: inherit;
}

.equation-container {
    color: inherit;
    font-size: 1.5em;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    line-height: 1;
}

.equation-container .katex-display {
    margin: 0;
}

.equation-container .katex {
    line-height: 1;
}

/* Bullet List Styles */
.ppt-bullet-block { display: flex; flex-direction: column; gap: 0.35em; width: 100%; text-align: inherit; }
.ppt-bullet-row { display: grid; grid-template-columns: 1.2em minmax(0, 1fr); column-gap: 12px; align-items: start; margin-left: var(--bullet-indent, 0px); }
.ppt-bullet-marker { display: inline-block; min-width: 1.2em; line-height: 1.2; color: var(--bullet-color, currentColor); font-size: calc(1em * var(--bullet-font-scale, 1)); }
.ppt-bullet-text { min-width: 0; line-height: inherit; text-align: inherit; }
.ppt-bullet-spacer { min-height: 1em; }
.ppt-bulleted-block { list-style: none; margin: 0; padding: 0; line-height: inherit; width: 100%; text-align: inherit; }
.ppt-bulleted-block .ppt-bulleted-item { display: grid; grid-template-columns: 1.2em minmax(0, 1fr); column-gap: 12px; align-items: start; margin: 0; padding: 0; line-height: inherit; }
.ppt-bulleted-block .ppt-bulleted-item::before { content: var(--bullet-marker, "•"); display: inline-block; min-width: 1.2em; line-height: 1.2; color: var(--bullet-color, currentColor); font-size: calc(1em * var(--bullet-font-scale, 1)); }
.ppt-numbered-block { margin: 0; padding-left: 1.5em; line-height: inherit; width: 100%; text-align: inherit; }
.ppt-numbered-block li { margin: 0; padding: 0; line-height: inherit; }

/* Animations */
.reveal .fragment.fade-in,
.fragment.fade-up,
.fragment.fade-down,
.fragment.fade-left,
.fragment.fade-right,
.fragment.current-visible,
.fragment.fade-in-then-out,
.fragment.fade-in-then-semi-out,
.fragment.fade-in {
    opacity: 0;
    visibility: hidden;
    transition: opacity 360ms ease, translate 360ms ease, color 240ms ease, scale 300ms ease;
}
.fragment.fade-up { translate: 0 28px; }
.fragment.fade-down { translate: 0 -28px; }
.fragment.fade-left { translate: 32px 0; }
.fragment.fade-right { translate: -32px 0; }
.fragment.fade-in.visible,
.fragment.fade-up.visible,
.fragment.fade-down.visible,
.fragment.fade-left.visible,
.fragment.fade-right.visible,
.fragment.fade-in-then-out.visible,
.fragment.fade-in-then-semi-out.visible {
    opacity: 1;
    visibility: inherit;
    translate: 0 0;
}
.fragment.fade-out,
.fragment.semi-fade-out,
.fragment.grow,
.fragment.shrink,
.fragment.highlight-red,
.fragment.highlight-green,
.fragment.highlight-blue,
.fragment.highlight-current-red,
.fragment.highlight-current-green,
.fragment.highlight-current-blue {
    transition: opacity 320ms ease, color 240ms ease, scale 300ms ease;
}
.fragment.grow { scale: 0.72; }
.fragment.grow.visible { scale: 1; }
.fragment.shrink { scale: 1.25; }
.fragment.shrink.visible { scale: 1; }
.fragment.fade-out.visible { opacity: 0.35; }
.fragment.semi-fade-out.visible { opacity: 0.5; }
.fragment.highlight-red.visible { color: #ef4444; }
.fragment.highlight-green.visible { color: #22c55e; }
.fragment.highlight-blue.visible { color: #3b82f6; }
.fragment.highlight-current-red.current-fragment { color: #ef4444; }
.fragment.highlight-current-green.current-fragment { color: #22c55e; }
.fragment.highlight-current-blue.current-fragment { color: #3b82f6; }
.fragment.current-visible.current-fragment { opacity: 1; visibility: inherit; }
.fragment.fade-in-then-out.current-fragment { opacity: 0; }
.fragment.fade-in-then-semi-out.current-fragment { opacity: 0.5; }
`;
}

function generateViewerJs() {
  return `
${sanitizeHtml.toString()}

const animationEffects = ['fade-in', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom-in', 'pop-in', 'wipe-in', 'pulse', 'glow'];
const MOLECULE_EMBED_NGL_SRC = ${JSON.stringify(typeof MOLECULE_EMBED_NGL_SRC === "string" ? MOLECULE_EMBED_NGL_SRC : "vendor/ngl/ngl.js")};

const BULLET_STYLE_THEMES = {
    default: { levels: [
        { type: 'symbol', value: '\u2022', fontSize: 1.0, color: 'inherit', indent: 0 },
        { type: 'symbol', value: '\u25e6', fontSize: 0.9, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u25aa', fontSize: 0.85, color: 'inherit', indent: 40 },
    ]},
    square: { levels: [
        { type: 'symbol', value: '\u25a0', fontSize: 0.9, color: 'inherit', indent: 0 },
        { type: 'symbol', value: '\u25a1', fontSize: 0.9, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u25aa', fontSize: 0.85, color: 'inherit', indent: 40 },
    ]},
    diamond: { levels: [
        { type: 'symbol', value: '\u25c6', fontSize: 0.9, color: '#f59e0b', indent: 0 },
        { type: 'symbol', value: '\u25c7', fontSize: 0.9, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u25c8', fontSize: 0.85, color: 'inherit', indent: 40 },
    ]},
    modern: { levels: [
        { type: 'icon', value: 'arrow-right', color: '#60a5fa', indent: 0 },
        { type: 'symbol', value: '\u2013', color: 'inherit', indent: 20 },
    ]},
    chevron: { levels: [
        { type: 'symbol', value: '\u00bb', fontSize: 1.0, color: '#38bdf8', indent: 0 },
        { type: 'symbol', value: '\u203a', fontSize: 1.0, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u2013', fontSize: 0.9, color: 'inherit', indent: 40 },
    ]},
    dash: { levels: [
        { type: 'symbol', value: '\u2013', fontSize: 1.0, color: 'inherit', indent: 0 },
        { type: 'symbol', value: '\u2014', fontSize: 1.0, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u00b7', fontSize: 1.0, color: 'inherit', indent: 40 },
    ]},
    checklist: { levels: [{ type: 'icon', value: 'check', color: '#22c55e', indent: 0 }] },
    star: { levels: [
        { type: 'symbol', value: '\u2726', fontSize: 0.95, color: '#f472b6', indent: 0 },
        { type: 'symbol', value: '\u2727', fontSize: 0.95, color: 'inherit', indent: 20 },
        { type: 'symbol', value: '\u2022', fontSize: 0.9, color: 'inherit', indent: 40 },
    ]},
};
const VIEWER_ICON_MAP = { 'arrow-right': '\u2192', 'check': '\u2713', 'circle': '\u25cf', 'square': '\u25a0', 'star': '\u2605', 'diamond': '\u25c6', 'chevron': '\u00bb' };
function _viewerGetLevelStyle(bulletStyle, level) {
    const theme = BULLET_STYLE_THEMES[bulletStyle] || BULLET_STYLE_THEMES.default;
    return theme.levels[Math.min(level, theme.levels.length - 1)] || BULLET_STYLE_THEMES.default.levels[0];
}
function _viewerGetBulletGlyph(levelStyle) {
    if (levelStyle.type === 'icon') return VIEWER_ICON_MAP[levelStyle.value] || '\u2022';
    return levelStyle.value || '\u2022';
}
function _viewerGetBulletIndent(level, levelStyle) {
    const themeIndent = Number(levelStyle.indent) || 0;
    const structuralIndent = Math.max(0, Number(level) || 0) * 20;
    return Math.max(themeIndent, structuralIndent);
}

const VIEWER_SHAPE_POLYGONS = ${JSON.stringify(typeof SHAPE_POLYGONS !== "undefined" ? SHAPE_POLYGONS : {})};
${typeof createDefaultMoleculeContent === "function" ? createDefaultMoleculeContent.toString() : ""}
${typeof MOLECULE_SUPPORTED_FORMATS !== "undefined" ? `const MOLECULE_SUPPORTED_FORMATS = new Set(${JSON.stringify(Array.from(MOLECULE_SUPPORTED_FORMATS))});` : ""}
${typeof MOLECULE_INLINE_CONTENT_LIMIT !== "undefined" ? `const MOLECULE_INLINE_CONTENT_LIMIT = ${Number(MOLECULE_INLINE_CONTENT_LIMIT) || 2097152};` : ""}
${typeof MOLECULE_LARGE_CONTENT_LIMIT !== "undefined" ? `const MOLECULE_LARGE_CONTENT_LIMIT = ${Number(MOLECULE_LARGE_CONTENT_LIMIT) || 26214400};` : ""}
${typeof normalizeMoleculeFormat === "function" ? normalizeMoleculeFormat.toString() : ""}
${typeof normalizeMoleculeBackgroundColor === "function" ? normalizeMoleculeBackgroundColor.toString() : ""}
${typeof isMoleculeContentUrl === "function" ? isMoleculeContentUrl.toString() : ""}
${typeof isMoleculeTrajectoryData === "function" ? isMoleculeTrajectoryData.toString() : ""}
${typeof normalizeMoleculeRepresentationLayer === "function" ? normalizeMoleculeRepresentationLayer.toString() : ""}
${typeof normalizeMoleculeViewState === "function" ? normalizeMoleculeViewState.toString() : ""}
${typeof _escapeMoleculeHtml === "function" ? _escapeMoleculeHtml.toString() : ""}
${typeof _serializeMoleculePayload === "function" ? _serializeMoleculePayload.toString() : ""}
${typeof _moleculeSrcdocScript === "function" ? _moleculeSrcdocScript.toString() : ""}
${typeof buildMoleculeEmbedSrcdoc === "function" ? buildMoleculeEmbedSrcdoc.toString() : ""}
${typeof applyMoleculeEmbedSandbox === "function" ? applyMoleculeEmbedSandbox.toString() : ""}
${typeof attachMoleculeDataBridge === "function" ? attachMoleculeDataBridge.toString() : ""}

function normalizeImageCropTransform(crop) {
    if (!crop || typeof crop !== 'object') return { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 };
    const widthPercent = Math.max(100, Number(crop.widthPercent) || 100);
    const heightPercent = Math.max(100, Number(crop.heightPercent) || 100);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    return {
        widthPercent,
        heightPercent,
        leftPercent: clamp(crop.leftPercent, 100 - widthPercent, 0),
        topPercent: clamp(crop.topPercent, 100 - heightPercent, 0),
    };
}

function normalizeAnimation(el) {
    const legacyValue = typeof el.animation === 'string' ? el.animation.trim() : '';
    const raw = legacyValue ? { effect: legacyValue } : (el.animation && typeof el.animation === 'object' ? el.animation : null);
    if (raw && Array.isArray(raw.timelines)) return null;
    if (!raw || !raw.effect || !animationEffects.includes(raw.effect)) return null;
    return {
        effect: raw.effect,
        trigger: raw.trigger === 'on-click' ? 'on-click' : 'on-slide',
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
        durationMs: Math.max(100, Number(raw.durationMs ?? el.animDuration) || 800),
        delayMs: Math.max(0, Number(raw.delayMs ?? el.animDelay) || 0),
        easing: ['ease-out', 'ease-in-out', 'linear'].includes(raw.easing) ? raw.easing : 'ease-out',
        distancePx: Number.isFinite(Number(raw.distancePx)) ? Number(raw.distancePx) : 48,
        scaleFrom: Number.isFinite(Number(raw.scaleFrom)) ? Number(raw.scaleFrom) : 0.88
    };
}

function initViewer(data) {
    window.state = data;
    const container = document.getElementById('slides-container');
    const stage = document.getElementById('viewer-stage');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    const chalkBtn = document.getElementById('btn-chalk');
    const clearChalkBtn = document.getElementById('btn-clear-chalk');
    const laserBtn = document.getElementById('btn-laser');
    const colorInput = document.getElementById('viewer-chalk-color');
    const colorChip = document.getElementById('viewer-chalk-color-chip');
    const chalkTools = document.getElementById('viewer-chalk-tools');
    const chalkEraser = document.getElementById('viewer-chalk-eraser');
    const status = document.getElementById('viewer-status');
    const chalkboard = document.getElementById('chalkboard-canvas');
    const laserPointer = document.getElementById('laser-pointer');
    const menuToggle = document.getElementById('viewer-menu-toggle');
    const menu = document.getElementById('viewer-menu');
    const contextMenu = document.getElementById('viewer-context-menu');
    const contextPrev = document.getElementById('viewer-context-prev');
    const contextNext = document.getElementById('viewer-context-next');
    const contextFullscreen = document.getElementById('viewer-context-fullscreen');
    const contextChalk = document.getElementById('viewer-context-chalk');
    const contextClear = document.getElementById('viewer-context-clear');
    const contextLaser = document.getElementById('viewer-context-laser');
    const slides = data.slides || [];
    let activeSlideIndex = 0;
    let activeFragmentIndex = -1;
    let viewerScale = 1;
    let chalkEnabled = false;
    let laserEnabled = false;
    let isDrawing = false;
    let lastDrawPoint = null;
    let chalkColor = '#fff59d';
    const chalkCtx = chalkboard ? chalkboard.getContext('2d', { willReadFrequently: true }) : null;
    const pageSetups = {
        'standard-4-3': { width: 1024, height: 768 },
        'widescreen-16-9': { width: 1280, height: 720 },
        'widescreen-16-10': { width: 1280, height: 800 },
        'talk-16-9': { width: 1280, height: 720 },
        'lecture-16-10': { width: 1280, height: 800 },
        'paper-letter': { width: 816, height: 1056 },
        'poster-portrait': { width: 1440, height: 1920 },
    };
    const sized = data.pageSize && Number(data.pageSize.width) > 0 && Number(data.pageSize.height) > 0;
    const page = sized
        ? { width: Number(data.pageSize.width), height: Number(data.pageSize.height) }
        : pageSetups[data.pageSetup] || pageSetups['standard-4-3'];
    const runtime = { clickGroups: [], revealedGroups: 0, slideIndex: -1, advancedGroups: [], revealedAdvanced: 0, bulletSteps: [], revealedBullets: 0 };
    document.documentElement.style.setProperty('--slide-width', page.width + 'px');
    document.documentElement.style.setProperty('--slide-height', page.height + 'px');

    function closeMenus() {
        if (menu) menu.classList.add('hidden');
        if (contextMenu) contextMenu.classList.add('hidden');
    }

    function toggleMenu() {
        if (contextMenu) contextMenu.classList.add('hidden');
        if (menu) menu.classList.toggle('hidden');
    }

    function openContextMenu(x, y) {
        if (!contextMenu) return;
        if (menu) menu.classList.add('hidden');
        contextMenu.classList.remove('hidden');
        const margin = 12;
        const width = contextMenu.offsetWidth || 220;
        const height = contextMenu.offsetHeight || 240;
        contextMenu.style.left = Math.min(window.innerWidth - width - margin, Math.max(margin, x)) + 'px';
        contextMenu.style.top = Math.min(window.innerHeight - height - margin, Math.max(margin, y)) + 'px';
    }

    function syncControlState() {
        const fullscreen = !!document.fullscreenElement;
        if (fullscreenBtn) fullscreenBtn.classList.toggle('is-active', fullscreen);
        if (contextFullscreen) contextFullscreen.classList.toggle('is-active', fullscreen);
        if (chalkBtn) chalkBtn.classList.toggle('is-active', chalkEnabled);
        if (contextChalk) contextChalk.classList.toggle('is-active', chalkEnabled);
        if (laserBtn) laserBtn.classList.toggle('is-active', laserEnabled);
        if (contextLaser) contextLaser.classList.toggle('is-active', laserEnabled);
        if (menuToggle) menuToggle.classList.toggle('is-active', chalkEnabled || laserEnabled);
        if (chalkTools) chalkTools.classList.toggle('hidden', !chalkEnabled);
        if (colorChip) {
            colorChip.value = chalkColor;
            colorChip.style.boxShadow = '0 0 0 2px ' + chalkColor;
        }
        if (stage) {
            stage.classList.toggle('presentation-cursor-hidden', laserEnabled);
            stage.classList.toggle('presentation-cursor-chalk', chalkEnabled && !laserEnabled);
        }
    }

    function getAnimatedEntries(slideIndex) {
        const slide = slides[slideIndex];
        if (!slide) return [];
        return (slide.elements || [])
            .map(el => ({ el, animation: normalizeAnimation(el) }))
            .filter(entry => entry.animation)
            .sort((a, b) => {
                const triggerDelta = (a.animation.trigger === 'on-slide' ? 0 : 1) - (b.animation.trigger === 'on-slide' ? 0 : 1);
                if (triggerDelta !== 0) return triggerDelta;
                const orderDelta = (Number(a.animation.order) || 0) - (Number(b.animation.order) || 0);
                if (orderDelta !== 0) return orderDelta;
                return String(a.el.id).localeCompare(String(b.el.id));
            });
    }

    function clearAnimationClasses(dom) {
        if (!dom) return;
        [
            'sf-anim-hidden', 'sf-anim-visible', 'sf-anim-playing',
            'sf-anim-effect-fade-in', 'sf-anim-effect-slide-up', 'sf-anim-effect-slide-down',
            'sf-anim-effect-slide-left', 'sf-anim-effect-slide-right', 'sf-anim-effect-zoom-in',
            'sf-anim-effect-pop-in', 'sf-anim-effect-wipe-in', 'sf-anim-effect-pulse', 'sf-anim-effect-glow'
        ].forEach(className => dom.classList.remove(className));
        dom.style.removeProperty('--sf-base-transform');
        dom.style.removeProperty('--sf-anim-duration');
        dom.style.removeProperty('--sf-anim-delay');
        dom.style.removeProperty('--sf-anim-easing');
        dom.style.removeProperty('--sf-anim-distance');
        dom.style.removeProperty('--sf-anim-scale');
    }

    function applyAnimationDomState(dom, animation) {
        if (!dom || !animation) return;
        clearAnimationClasses(dom);
        dom.classList.add('sf-anim-effect-' + animation.effect);
        dom.style.setProperty('--sf-base-transform', dom.style.transform || '');
        dom.style.setProperty('--sf-anim-duration', Math.max(100, Number(animation.durationMs) || 800) + 'ms');
        dom.style.setProperty('--sf-anim-delay', Math.max(0, Number(animation.delayMs) || 0) + 'ms');
        dom.style.setProperty('--sf-anim-easing', animation.easing || 'ease-out');
        dom.style.setProperty('--sf-anim-distance', Math.max(8, Number(animation.distancePx) || 48) + 'px');
        dom.style.setProperty('--sf-anim-scale', String(Number(animation.scaleFrom) || 0.88));
    }

    function hideAnimatedEntry(entry) {
        const dom = document.getElementById(entry.el.id);
        if (!dom) return;
        applyAnimationDomState(dom, entry.animation);
        dom.classList.remove('sf-anim-visible', 'sf-anim-playing');
        dom.classList.add('sf-anim-hidden');
    }

    function showAnimatedEntry(entry, animate) {
        const dom = document.getElementById(entry.el.id);
        if (!dom) return;
        applyAnimationDomState(dom, entry.animation);
        dom.classList.remove('sf-anim-hidden');
        dom.classList.add('sf-anim-visible');
        if (!animate) {
            dom.classList.remove('sf-anim-playing');
            return;
        }
        dom.classList.remove('sf-anim-playing');
        void dom.offsetWidth;
        dom.classList.add('sf-anim-playing');
    }

    function prepareSlideAnimations(slideIndex) {
        if (typeof stopSlideAnimations === 'function') stopSlideAnimations();
        runtime.slideIndex = slideIndex;
        const entries = getAnimatedEntries(slideIndex);
        entries.forEach(entry => hideAnimatedEntry(entry));
        entries.filter(entry => entry.animation.trigger === 'on-slide').forEach(entry => showAnimatedEntry(entry, true));
        runtime.clickGroups = [];
        entries.filter(entry => entry.animation.trigger === 'on-click').forEach(entry => {
            const order = Number(entry.animation.order) || 0;
            const current = runtime.clickGroups[runtime.clickGroups.length - 1];
            if (current && current.order === order) current.entries.push(entry);
            else runtime.clickGroups.push({ order, entries: [entry] });
        });
        runtime.revealedGroups = 0;
        // Click animations made from the animation presets (timelines) wait for their click, as in the app: they
        // were left visible from the start. "Reveal bullets one by one" shows a list a bullet per click, the box's
        // own entrance coming in with its first bullet.
        runtime.advancedGroups = getAdvancedClickGroups(slideIndex);
        runtime.revealedAdvanced = 0;
        runtime.bulletSteps = getBulletSteps(slideIndex);
        runtime.revealedBullets = 0;
        attachBulletEntrances();
        runtime.bulletSteps.forEach(step => setBulletStepShown(step, false, false));
        if (typeof playConfiguredSlideAnimations === 'function') {
            playConfiguredSlideAnimations(slideIndex, { trigger: 'on-slide' });
        }
        runtime.advancedGroups.forEach(group => applyAdvancedGroup(group, false));
        runtime.bulletSteps.forEach(step => { if (step.entrance && step.entrance.kind === 'advanced') applyAdvancedGroup(step.entrance.group, false); });
    }

    function getAdvancedClickGroups(slideIndex) {
        const slide = slides[slideIndex];
        const groups = [];
        if (!slide || typeof normalizeElementAnimationConfig !== 'function') return groups;
        (slide.elements || []).forEach(el => {
            const config = normalizeElementAnimationConfig(el);
            if (!config || !Array.isArray(config.timelines)) return;
            config.timelines.forEach((timeline, timelineIndex) => {
                (timeline.animations || []).forEach((animation, animationIndex) => {
                    if ((animation && animation.trigger || 'on-slide') !== 'on-click') return;
                    if (!animation.id) animation.id = 'anim_' + (el.id || 'el') + '_' + timelineIndex + '_' + animationIndex;
                    groups.push({ animationIds: [String(animation.id)], entries: [{ el, animation }] });
                });
            });
        });
        return groups;
    }

    function applyAdvancedGroup(group, final) {
        if (!group || typeof getAnimationEngine !== 'function') return;
        const engine = getAnimationEngine();
        (group.entries || []).forEach(entry => {
            const dom = document.getElementById(entry.el && entry.el.id || '');
            if (!dom || !entry.animation) return;
            if (typeof engine._captureElementSnapshot === 'function') engine._captureElementSnapshot(dom);
            const apply = final ? engine._applyAnimationFinal : engine._applyAnimationInitial;
            if (typeof apply === 'function') apply.call(engine, dom, entry.animation);
        });
    }

    function playAdvancedGroup(group) {
        if (typeof playConfiguredSlideAnimations === 'function') {
            playConfiguredSlideAnimations(runtime.slideIndex, { trigger: 'on-click', animationIds: group.animationIds, restoreBeforePlay: false });
        } else {
            applyAdvancedGroup(group, true);
        }
    }

    function getBulletSteps(slideIndex) {
        const slide = slides[slideIndex];
        const steps = [];
        (slide && slide.elements || []).filter(el => el && el.type === 'text' && el.revealBullets).forEach(el => {
            const node = document.getElementById(el.id);
            let current = null;
            Array.from(node ? node.querySelectorAll('.ppt-bullet-row') : []).forEach(row => {
                // The viewer's rows carry their level as an indent only (a sub-bullet came in on its own click).
                const indent = parseFloat(row.style.getPropertyValue('--bullet-indent')) || 0;
                const level = row.dataset.level !== undefined ? Number(row.dataset.level) || 0 : indent > 0 ? 1 : 0;
                if (level === 0 || !current) {
                    current = { elementId: el.id, rows: [] };
                    steps.push(current);
                }
                current.rows.push(row);
            });
        });
        return steps;
    }

    function attachBulletEntrances() {
        const seen = new Set();
        runtime.bulletSteps.forEach(step => {
            if (seen.has(step.elementId)) return;
            seen.add(step.elementId);
            const onlyFor = group => (group.entries || []).length > 0 && group.entries.every(entry => entry.el && entry.el.id === step.elementId);
            const basic = runtime.clickGroups.findIndex(onlyFor);
            if (basic >= 0) {
                step.entrance = { kind: 'basic', group: runtime.clickGroups.splice(basic, 1)[0] };
                return;
            }
            const advanced = runtime.advancedGroups.findIndex(onlyFor);
            if (advanced >= 0) step.entrance = { kind: 'advanced', group: runtime.advancedGroups.splice(advanced, 1)[0] };
        });
    }

    function setBulletStepShown(step, shown, animate) {
        (step && step.rows || []).forEach(row => {
            row.classList.toggle('sf-bullet-instant', !animate);
            row.classList.toggle('sf-bullet-hidden', !shown);
            row.classList.toggle('sf-bullet-shown', shown);
        });
    }

    function playBulletEntrance(step, show, animate) {
        const entrance = step && step.entrance;
        if (!entrance) return;
        if (entrance.kind === 'basic') {
            entrance.group.entries.forEach(entry => (show ? showAnimatedEntry(entry, animate) : hideAnimatedEntry(entry)));
        } else if (!show) {
            applyAdvancedGroup(entrance.group, false);
        } else if (animate) {
            playAdvancedGroup(entrance.group);
        } else {
            applyAdvancedGroup(entrance.group, true);
        }
    }

    function revealNextBulletStep() {
        const step = runtime.bulletSteps[runtime.revealedBullets];
        if (!step) return false;
        playBulletEntrance(step, true, true);
        setBulletStepShown(step, true, true);
        runtime.revealedBullets += 1;
        return true;
    }

    function hidePreviousBulletStep() {
        const step = runtime.bulletSteps[runtime.revealedBullets - 1];
        if (!step) return false;
        setBulletStepShown(step, false, false);
        playBulletEntrance(step, false, false);
        runtime.revealedBullets -= 1;
        return true;
    }

    function revealNextAdvancedGroup() {
        const group = runtime.advancedGroups[runtime.revealedAdvanced];
        if (!group) return false;
        playAdvancedGroup(group);
        runtime.revealedAdvanced += 1;
        return true;
    }

    function hidePreviousAdvancedGroup() {
        const group = runtime.advancedGroups[runtime.revealedAdvanced - 1];
        if (!group) return false;
        applyAdvancedGroup(group, false);
        runtime.revealedAdvanced -= 1;
        return true;
    }

    function showWholeSlide() {
        runtime.revealedGroups = runtime.clickGroups.length;
        runtime.clickGroups.forEach(group => group.entries.forEach(entry => showAnimatedEntry(entry, false)));
        runtime.revealedAdvanced = runtime.advancedGroups.length;
        runtime.advancedGroups.forEach(group => applyAdvancedGroup(group, true));
        runtime.revealedBullets = runtime.bulletSteps.length;
        runtime.bulletSteps.forEach(step => { playBulletEntrance(step, true, false); setBulletStepShown(step, true, false); });
    }

    function revealNextAnimationGroup() {
        const group = runtime.clickGroups[runtime.revealedGroups];
        if (!group) return false;
        group.entries.forEach(entry => showAnimatedEntry(entry, true));
        runtime.revealedGroups += 1;
        return true;
    }

    function hidePreviousAnimationGroup() {
        const previousIndex = runtime.revealedGroups - 1;
        if (previousIndex < 0) return false;
        const group = runtime.clickGroups[previousIndex];
        if (!group) return false;
        group.entries.forEach(entry => hideAnimatedEntry(entry));
        runtime.revealedGroups = previousIndex;
        return true;
    }

    slides.forEach((slide, slideIndex) => {
        const section = document.createElement('section');
        section.id = slide.id;
        section.className = 'presentation-slide';
        section.style.width = page.width + 'px';
        section.style.height = page.height + 'px';
        const mediaOptions = {
            slideIndex,
            activeSlideIndex,
            onMediaLoad: () => requestAnimationFrame(syncViewerActiveMedia),
        };
        const bgNode = createViewerSlideBackgroundNode(slide.background, mediaOptions);
        if (bgNode) section.appendChild(bgNode);

        (slide.elements || []).forEach(elData => {
            const node = createViewerElement(elData, mediaOptions);
            section.appendChild(node);
        });

        container.appendChild(section);
    });

    const getSlideDom = index => container.children[index];
    const getFragments = slideDom =>
        Array.from(slideDom.querySelectorAll('.fragment'))
            .sort((a, b) => (Number(a.getAttribute('data-fragment-index')) || 0) - (Number(b.getAttribute('data-fragment-index')) || 0));

    function updateScale() {
        const styles = getComputedStyle(stage);
        const width = stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        const height = stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
        viewerScale = Math.max(0.1, Math.min(width / page.width, height / page.height));
        const transform = 'translate(-50%, -50%) scale(' + viewerScale + ')';
        container.style.transform = transform;
        if (chalkboard) chalkboard.style.transform = transform;
    }

    function resizeChalkboard() {
        if (!chalkboard || !chalkCtx) return;
        const snapshot = chalkboard.width > 0 ? chalkCtx.getImageData(0, 0, chalkboard.width, chalkboard.height) : null;
        chalkboard.width = page.width;
        chalkboard.height = page.height;
        chalkCtx.lineCap = 'round';
        chalkCtx.lineJoin = 'round';
        chalkCtx.strokeStyle = chalkColor;
        chalkCtx.lineWidth = 5;
        if (snapshot) chalkCtx.putImageData(snapshot, 0, 0);
    }

    function setChalkActive(enabled) {
        chalkEnabled = !!enabled;
        if (chalkboard) chalkboard.classList.toggle('is-active', chalkEnabled);
        syncControlState();
        if (!chalkEnabled) {
            isDrawing = false;
            lastDrawPoint = null;
        }
    }

    function setLaserActive(enabled) {
        laserEnabled = !!enabled;
        if (laserPointer) {
            laserPointer.classList.toggle('is-active', laserEnabled);
            if (!laserEnabled) {
                laserPointer.style.left = '-100px';
                laserPointer.style.top = '-100px';
            }
        }
        syncControlState();
    }

    function clearChalkboard() {
        if (!chalkboard || !chalkCtx) return;
        chalkCtx.clearRect(0, 0, chalkboard.width, chalkboard.height);
    }

    function getStagePoint(event) {
        if (!chalkboard) return null;
        const rect = chalkboard.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = ((event.clientX - rect.left) / rect.width) * page.width;
        const y = ((event.clientY - rect.top) / rect.height) * page.height;
        return {
            x: Math.max(0, Math.min(page.width, x)),
            y: Math.max(0, Math.min(page.height, y))
        };
    }

    function updateLaserPosition(event) {
        if (!laserEnabled || !laserPointer) return;
        laserPointer.style.left = event.clientX + 'px';
        laserPointer.style.top = event.clientY + 'px';
    }

    function drawSegment(from, to) {
        if (!chalkCtx || !from || !to) return;
        chalkCtx.strokeStyle = chalkColor;
        chalkCtx.beginPath();
        chalkCtx.moveTo(from.x, from.y);
        chalkCtx.lineTo(to.x, to.y);
        chalkCtx.stroke();
    }

    function syncHash() {
            if (window.location.protocol !== 'file:') {
                history.replaceState(null, '', '#slide-' + (activeSlideIndex + 1) + '-' + Math.max(0, activeFragmentIndex + 1));
            }
    }

    function applySlideState() {
        Array.from(container.children).forEach((slideDom, slideIndex) => {
            slideDom.classList.toggle('is-active', slideIndex === activeSlideIndex);
            const fragments = getFragments(slideDom);
            fragments.forEach((fragment, fragmentIndex) => {
                const isVisible = slideIndex < activeSlideIndex || (slideIndex === activeSlideIndex && fragmentIndex <= activeFragmentIndex);
                fragment.classList.toggle('visible', isVisible);
                fragment.classList.toggle('current-fragment', slideIndex === activeSlideIndex && fragmentIndex === activeFragmentIndex);
            });
        });
        if (runtime.slideIndex !== activeSlideIndex) {
            prepareSlideAnimations(activeSlideIndex);
        }
        if (status) status.textContent = (activeSlideIndex + 1) + ' / ' + Math.max(1, slides.length);
        syncViewerActiveMedia();
        syncHash();
    }

    function syncViewerActiveMedia() {
        const pageActive = document.visibilityState !== 'hidden' && document.hasFocus();
        Array.from(container.children).forEach((slideDom, slideIndex) => {
            const isActive = pageActive && slideIndex === activeSlideIndex;
            slideDom.querySelectorAll('video').forEach(video => {
                if (!isActive) {
                    if (!video.paused) video.pause();
                    return;
                }
                if (video.autoplay || video.classList.contains('slide-background-video')) {
                    video.play().catch(() => {});
                }
            });
            slideDom.querySelectorAll('iframe').forEach(iframe => {
                const src = String(iframe.getAttribute('src') || '');
                if (iframe.dataset.molecule === 'true') {
                    iframe.contentWindow?.postMessage({ type: 'pptmaker:molecule:lifecycle', active: isActive }, '*');
                } else if (/youtube(?:-nocookie)?\\.com\\/embed\\//i.test(src)) {
                    const wasActive = iframe.dataset.mediaWasActive === 'true';
                    const shouldAutoplay = iframe.dataset.autoplay === 'true';
                    const command = isActive && shouldAutoplay ? 'playVideo' : !isActive && wasActive ? 'pauseVideo' : '';
                    iframe.dataset.mediaWasActive = isActive ? 'true' : 'false';
                    if (command && iframe.dataset.mediaLoaded === 'true') {
                        try {
                            iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), 'https://www.youtube-nocookie.com');
                        } catch (_) {}
                    }
                } else if (/player\\.vimeo\\.com\\/video\\//i.test(src)) {
                    const wasActive = iframe.dataset.mediaWasActive === 'true';
                    const shouldAutoplay = iframe.dataset.autoplay === 'true';
                    const method = isActive && shouldAutoplay ? 'play' : !isActive && wasActive ? 'pause' : '';
                    iframe.dataset.mediaWasActive = isActive ? 'true' : 'false';
                    if (method && iframe.dataset.mediaLoaded === 'true') {
                        iframe.contentWindow?.postMessage({ method }, '*');
                    }
                }
            });
        });
    }

    document.addEventListener('visibilitychange', () => requestAnimationFrame(syncViewerActiveMedia));
    window.addEventListener('focus', () => requestAnimationFrame(syncViewerActiveMedia));
    window.addEventListener('blur', () => requestAnimationFrame(syncViewerActiveMedia));

    function goToSlide(index, fragmentIndex) {
        activeSlideIndex = Math.max(0, Math.min(index, slides.length - 1));
        const fragments = getFragments(getSlideDom(activeSlideIndex));
        const maxFragment = fragments.length - 1;
        activeFragmentIndex = Math.max(-1, Math.min(fragmentIndex, maxFragment));
        applySlideState();
    }

    function nextStep() {
        const fragments = getFragments(getSlideDom(activeSlideIndex));
        if (revealNextBulletStep()) return;
        if (revealNextAnimationGroup()) return;
        if (revealNextAdvancedGroup()) return;
        if (activeFragmentIndex < fragments.length - 1) {
            activeFragmentIndex += 1;
            applySlideState();
        } else if (activeSlideIndex < slides.length - 1) {
            activeSlideIndex += 1;
            activeFragmentIndex = -1;
            applySlideState();
        }
    }

    function prevStep() {
        if (hidePreviousAdvancedGroup()) return;
        if (hidePreviousAnimationGroup()) return;
        if (hidePreviousBulletStep()) return;
        if (activeFragmentIndex >= 0) {
            activeFragmentIndex -= 1;
            applySlideState();
        } else if (activeSlideIndex > 0) {
            activeSlideIndex -= 1;
            activeFragmentIndex = getFragments(getSlideDom(activeSlideIndex)).length - 1;
            applySlideState();
            showWholeSlide();
        }
    }

    prevBtn && prevBtn.addEventListener('click', () => { prevStep(); closeMenus(); });
    nextBtn && nextBtn.addEventListener('click', () => { nextStep(); closeMenus(); });
    menuToggle && menuToggle.addEventListener('click', event => {
        event.stopPropagation();
        toggleMenu();
    });
    fullscreenBtn && fullscreenBtn.addEventListener('click', async () => {
        const target = document.documentElement;
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (target.requestFullscreen) await target.requestFullscreen();
        } catch (err) {
            console.error('Fullscreen toggle failed.', err);
        }
        syncControlState();
        closeMenus();
    });
    chalkBtn && chalkBtn.addEventListener('click', () => { setChalkActive(!chalkEnabled); closeMenus(); });
    colorInput && colorInput.addEventListener('input', event => { chalkColor = event.target.value || '#fff59d'; closeMenus(); });
    colorChip && colorChip.addEventListener('input', event => {
        chalkColor = event.target.value || '#fff59d';
        if (colorInput) colorInput.value = chalkColor;
        syncControlState();
    });
    clearChalkBtn && clearChalkBtn.addEventListener('click', () => { clearChalkboard(); closeMenus(); });
    chalkEraser && chalkEraser.addEventListener('click', () => { clearChalkboard(); });
    laserBtn && laserBtn.addEventListener('click', () => { setLaserActive(!laserEnabled); closeMenus(); });
    contextPrev && contextPrev.addEventListener('click', () => { prevStep(); closeMenus(); });
    contextNext && contextNext.addEventListener('click', () => { nextStep(); closeMenus(); });
    contextFullscreen && contextFullscreen.addEventListener('click', () => { fullscreenBtn && fullscreenBtn.click(); });
    contextChalk && contextChalk.addEventListener('click', () => { chalkBtn && chalkBtn.click(); });
    contextClear && contextClear.addEventListener('click', () => { clearChalkBtn && clearChalkBtn.click(); });
    contextLaser && contextLaser.addEventListener('click', () => { laserBtn && laserBtn.click(); });
    chalkboard && chalkboard.addEventListener('pointerdown', event => {
        if (laserEnabled) updateLaserPosition(event);
        if (!chalkEnabled) return;
        const point = getStagePoint(event);
        if (!point) return;
        isDrawing = true;
        lastDrawPoint = point;
        drawSegment(point, point);
        chalkboard.setPointerCapture && chalkboard.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    chalkboard && chalkboard.addEventListener('pointermove', event => {
        if (laserEnabled) updateLaserPosition(event);
        if (!chalkEnabled || !isDrawing) return;
        const point = getStagePoint(event);
        if (!point || !lastDrawPoint) return;
        drawSegment(lastDrawPoint, point);
        lastDrawPoint = point;
        event.preventDefault();
    });
    chalkboard && chalkboard.addEventListener('pointerup', event => {
        if (laserEnabled) updateLaserPosition(event);
        isDrawing = false;
        lastDrawPoint = null;
    });
    chalkboard && chalkboard.addEventListener('pointerleave', () => {
        isDrawing = false;
        lastDrawPoint = null;
    });
    stage && stage.addEventListener('pointermove', event => {
        if (laserEnabled) updateLaserPosition(event);
    });
    document.addEventListener('pointermove', updateLaserPosition, true);
    // Touch screens: swipe left or right, or tap the right or left part of the screen, to step through the deck.
    let touchStart = null;
    stage && stage.addEventListener('pointerdown', event => {
        touchStart = event.pointerType === 'touch' && !chalkEnabled ? { x: event.clientX, y: event.clientY } : null;
    });
    stage && stage.addEventListener('pointerup', event => {
        const start = touchStart;
        touchStart = null;
        if (!start || event.pointerType !== 'touch' || chalkEnabled) return;
        if (event.target.closest && event.target.closest('a, button, input, iframe, video, audio, .standalone-presentation-ui')) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            dx < 0 ? nextStep() : prevStep();
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
            event.clientX < window.innerWidth / 3 ? prevStep() : nextStep();
        }
    });
    stage && stage.addEventListener('contextmenu', event => {
        event.preventDefault();
        openContextMenu(event.clientX, event.clientY);
    });
    document.addEventListener('mousedown', event => {
        if (menu?.contains(event.target) || contextMenu?.contains(event.target) || menuToggle?.contains(event.target)) return;
        closeMenus();
    });
    document.addEventListener('fullscreenchange', () => {
        syncControlState();
        updateScale();
    });
    window.addEventListener('resize', () => {
        updateScale();
        resizeChalkboard();
    });
    window.addEventListener('keydown', event => {
        const key = String(event.key || '').toLowerCase();
        if (key === 'f') {
            event.preventDefault();
            fullscreenBtn && fullscreenBtn.click();
            return;
        }
        if (key === 'm') {
            event.preventDefault();
            toggleMenu();
            return;
        }
        if (key === 'b') {
            event.preventDefault();
            setChalkActive(!chalkEnabled);
            return;
        }
        if (key === 'l') {
            event.preventDefault();
            setLaserActive(!laserEnabled);
            return;
        }
        if (key === 'x') {
            event.preventDefault();
            clearChalkboard();
            return;
        }
        if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
            event.preventDefault();
            nextStep();
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault();
            prevStep();
        } else if (event.key === 'Home') {
            event.preventDefault();
            goToSlide(0, -1);
        } else if (event.key === 'End') {
            event.preventDefault();
            const lastIndex = slides.length - 1;
            goToSlide(lastIndex, getFragments(getSlideDom(lastIndex)).length - 1);
        }
    });

    const hashMatch = window.location.hash.match(/slide-(\\d+)(?:-(\\d+))?/);
    if (hashMatch) {
        const slideIdx = Math.max(0, Number(hashMatch[1]) - 1);
        const fragmentIdx = hashMatch[2] ? Number(hashMatch[2]) - 1 : -1;
        goToSlide(slideIdx, fragmentIdx);
    } else {
        goToSlide(0, -1);
    }
    resizeChalkboard();
    updateScale();
    syncControlState();
}

function createViewerElement(elData, mediaOptions = {}) {
    function setMediaIframePermissions(iframe, value) {
        if (!iframe || /firefox/i.test(navigator.userAgent || '')) return;
        iframe.setAttribute('allow', value);
    }
    function ensureViewerDocumentShell(content) {
        const raw = String(content || '');
        if (/<!doctype|<html[\\s>]/i.test(raw)) return raw;
        return '<!doctype html><html><head></head><body>' + raw + '</body></html>';
    }

    function injectViewerIntoHead(doc, html) {
        if (/<\\/head>/i.test(doc)) return doc.replace(/<\\/head>/i, html + '</head>');
        return doc.replace(/<html[^>]*>/i, match => match + '<head>' + html + '</head>');
    }

    function injectViewerIntoBodyEnd(doc, html) {
        if (/<\\/body>/i.test(doc)) return doc.replace(/<\\/body>/i, html + '</body>');
        return doc + html;
    }

    function buildViewerHtmlEmbedSrcdoc(content, elData) {
        let doc = ensureViewerDocumentShell(content);
        if (!/name=["']viewport["']/i.test(doc)) {
            doc = injectViewerIntoHead(doc, '<meta name="viewport" content="width=device-width, initial-scale=1" />');
        }
        const fit = elData?.htmlFit || 'contain';
        const styles =
            '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;}body{box-sizing:border-box;}img,svg,canvas,video{max-width:100%;height:auto;}body[data-fit="fill"]>*:first-child{width:100%;height:100%;}body[data-fit="contain"]{display:flex;align-items:center;justify-content:center;}body[data-fit="contain"]>*:first-child{max-width:100%;max-height:100%;}</style>';
        const script =
            '<script>(function(){document.body.dataset.fit=' + JSON.stringify(fit) + ';})();<\\/script>';
        doc = injectViewerIntoHead(doc, styles);
        doc = injectViewerIntoBodyEnd(doc, script);
        return doc;
    }

    function getViewerHtmlEmbedSandbox() {
        return 'allow-scripts allow-forms allow-popups allow-downloads';
    }

    const normalizeTableDataLocal = tableData => {
        const rows = Math.max(1, Number(tableData?.rows) || 3);
        const cols = Math.max(1, Number(tableData?.cols) || 4);
        const rawCells = Array.isArray(tableData?.cells) ? tableData.cells : [];
        const rawRowHeights = Array.isArray(tableData?.rowHeights) ? tableData.rowHeights : [];
        const rawColWidths = Array.isArray(tableData?.colWidths) ? tableData.colWidths : [];
        return {
            rows,
            cols,
            headerRow: tableData?.headerRow !== false,
            zebra: Boolean(tableData?.zebra),
            borderColor: tableData?.borderColor || '#cbd5e1',
            borderWidth: Math.max(0, Number(tableData?.borderWidth) || 1),
            cellPadding: Math.max(2, Number(tableData?.cellPadding) || 10),
            headerFill: tableData?.headerFill || '#e2e8f0',
            bodyFill: tableData?.bodyFill || '#ffffff',
            altFill: tableData?.altFill || '#f8fafc',
            textColor: tableData?.textColor || '#172033',
            headerTextColor: tableData?.headerTextColor || '#172033',
            rowHeights: Array.from({ length: rows }, (_, rowIndex) => {
                const value = Number(rawRowHeights[rowIndex]);
                return Number.isFinite(value) && value >= 24 ? value : 44;
            }),
            colWidths: Array.from({ length: cols }, (_, colIndex) => {
                const value = Number(rawColWidths[colIndex]);
                return Number.isFinite(value) && value >= 36 ? value : 140;
            }),
            cells: Array.from({ length: rows }, (_, rowIndex) =>
                Array.from({ length: cols }, (_, colIndex) => {
                    const rawCell = rawCells[rowIndex]?.[colIndex];
                    return {
                        text: typeof rawCell?.text === 'string' ? rawCell.text : rowIndex === 0 ? 'Header ' + (colIndex + 1) : '',
                        styles: rawCell?.styles && typeof rawCell.styles === 'object' ? rawCell.styles : {},
                    };
                }),
            ),
        };
    };
    const el = document.createElement('div');
    const animation = normalizeAnimation(elData);
    el.id = elData.id || '';
    el.className = 'canvas-element';
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('draggable', 'false');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('aria-readonly', 'true');
    if (elData.id) el.setAttribute('data-id', elData.id);
    if (elData.type) el.setAttribute('data-type', elData.type);
    if (elData.footerRole) el.setAttribute('data-footer-role', elData.footerRole);
    el.style.transform = 'translate(' + elData.x + 'px, ' + elData.y + 'px)' + (Number(elData.rotation) ? ' rotate(' + Number(elData.rotation) + 'deg)' : '');
    el.setAttribute('data-x', elData.x);
    el.setAttribute('data-y', elData.y);
    if (elData.width) el.style.width = elData.width;
    if (elData.height) el.style.height = elData.height;
    if (elData.type === 'text') {
        el.dataset.autoHeight = elData.autoHeight === false ? 'false' : 'true';
        el.dataset.textFitMode = elData.textFitMode || (elData.autoHeight === false ? 'fixed' : 'autoHeight');
    }
    Object.entries(elData.styles || {}).forEach(([prop, value]) => {
        if (value === undefined || value === null) return;
        if (prop === 'textStrokeWidth') {
            if (String(value) === '0' || String(value) === '0px') el.style.removeProperty('-webkit-text-stroke-width');
            else el.style.setProperty('-webkit-text-stroke-width', value, 'important');
            return;
        }
        if (prop === 'textStrokeColor') {
            if (!value || value === 'transparent') el.style.removeProperty('-webkit-text-stroke-color');
            else el.style.setProperty('-webkit-text-stroke-color', value, 'important');
            return;
        }
        const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        const priority = ['color', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign', 'lineHeight', 'textShadow'].includes(prop)
            ? 'important'
            : '';
        el.style.setProperty(cssProp, value, priority);
    });
    if (elData.fragmentAnimation && elData.fragmentAnimation !== 'none') {
        el.classList.add('fragment', elData.fragmentAnimation);
        if (elData.fragmentIndex != null) {
            el.setAttribute('data-fragment-index', elData.fragmentIndex);
        }
    }
    if (animation) {
        el.classList.add('has-structured-animation');
    }
    if (elData.hidden) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
    }

    if (elData.type === 'text') {
        const content = document.createElement('div');
        content.className = 'text-element-content';
        content.setAttribute('contenteditable', 'false');
        content.setAttribute('draggable', 'false');
        content.setAttribute('tabindex', '-1');
        content.setAttribute('aria-readonly', 'true');
        content.innerHTML = sanitizeHtml(renderTextContent(elData));
        el.appendChild(content);
    } else if (elData.type === 'table') {
        const tableData = normalizeTableDataLocal(elData.tableData);
        const shell = document.createElement('div');
        shell.className = 'table-element-shell';
        const scroll = document.createElement('div');
        scroll.className = 'table-element-scroll';
        const table = document.createElement('table');
        table.className = 'table-element-grid';
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.height = '100%';
        table.style.tableLayout = 'fixed';
        // Shares of the table's width, as in the editor (pixel columns wider than the box were cut off).
        const colgroup = document.createElement('colgroup');
        const colPx = tableData.colWidths.map(width => Math.max(36, Number(width) || 140));
        const colTotal = colPx.reduce((sum, width) => sum + width, 0) || 1;
        colPx.forEach(width => {
            const col = document.createElement('col');
            col.style.width = ((width / colTotal) * 100).toFixed(4) + '%';
            colgroup.appendChild(col);
        });
        table.appendChild(colgroup);
        const tbody = document.createElement('tbody');
        for (let rowIndex = 0; rowIndex < tableData.rows; rowIndex += 1) {
            const tr = document.createElement('tr');
            tr.style.height = Math.max(24, Number(tableData.rowHeights[rowIndex]) || 44) + 'px';
            for (let colIndex = 0; colIndex < tableData.cols; colIndex += 1) {
                const cellData = tableData.cells[rowIndex]?.[colIndex] || { text: '', styles: {} };
                const cell = document.createElement(rowIndex === 0 && tableData.headerRow ? 'th' : 'td');
                const isHeader = tableData.headerRow && rowIndex === 0;
                const zebraFill = tableData.zebra && !isHeader && rowIndex % 2 === 1 ? tableData.altFill : tableData.bodyFill;
                const styles = cellData.styles || {};
                cell.className = 'table-element-cell';
                cell.setAttribute('contenteditable', 'false');
                cell.setAttribute('draggable', 'false');
                cell.setAttribute('tabindex', '-1');
                cell.setAttribute('aria-readonly', 'true');
                cell.style.border = tableData.borderWidth + 'px solid ' + tableData.borderColor;
                cell.style.padding = tableData.cellPadding + 'px';
                cell.style.backgroundColor = styles.backgroundColor || (isHeader ? tableData.headerFill : zebraFill);
                cell.style.color = styles.color || (isHeader ? tableData.headerTextColor : tableData.textColor);
                cell.style.textAlign = styles.textAlign || 'left';
                cell.style.fontWeight = styles.fontWeight || (isHeader ? '700' : '400');
                cell.style.verticalAlign = 'top';
                cell.style.whiteSpace = 'pre-wrap';
                cell.textContent = cellData.text || '';
                tr.appendChild(cell);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        shell.appendChild(scroll);
        el.appendChild(shell);
    } else if (elData.type === 'image') {
        if (elData.cropTransform) {
            const crop = normalizeImageCropTransform(elData.cropTransform);
            const wrapper = document.createElement("div");
            wrapper.style.cssText = "width:100%; height:100%; border-radius:inherit; overflow:hidden; position:relative;";
            const img = document.createElement("img");
            img.src = elData.content;
            img.style.cssText = "position:absolute; display:block; margin:0!important; max-width:none; max-height:none; object-fit:fill; " +
                               "left:" + crop.leftPercent + "%; " +
                               "top:" + crop.topPercent + "%; " +
                               "width:" + crop.widthPercent + "%; " +
                               "height:" + crop.heightPercent + "%;";
            wrapper.appendChild(img);
            el.appendChild(wrapper);
        } else {
            const img = document.createElement('img');
            img.src = elData.content;
            img.className = 'media-fill rounded-inherit';
            img.style.objectFit = 'fill';
            el.appendChild(img);
        }
    } else if (elData.type === 'video') {
        const videoInfo = _parseVideoUrl(elData.content);
        const initiallyActive =
            document.visibilityState !== 'hidden' &&
            document.hasFocus() &&
            Number(mediaOptions.slideIndex) === Number(mediaOptions.activeSlideIndex);
        let videoNode;
        if (videoInfo.type === 'youtube') {
            videoNode = document.createElement('iframe');
            const params = new URLSearchParams({
                autoplay: elData.autoplay && initiallyActive ? 1 : 0,
                mute: elData.muted ? 1 : 0,
                loop: elData.loop ? 1 : 0,
                controls: 1,
                rel: 0,
                modestbranding: 1,
                playsinline: 1,
                enablejsapi: 1
            });
            if (window.location.origin && window.location.origin !== 'null') params.set('origin', window.location.origin);
            if (elData.loop) params.set('playlist', videoInfo.id);
            videoNode.src = 'https://www.youtube-nocookie.com/embed/' + videoInfo.id + '?' + params.toString();
            setMediaIframePermissions(videoNode, 'autoplay; encrypted-media; picture-in-picture');
            videoNode.setAttribute('allowfullscreen', 'true');
            videoNode.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            videoNode.setAttribute('title', 'YouTube video player');
        } else if (videoInfo.type === 'vimeo') {
            videoNode = document.createElement('iframe');
            videoNode.src = 'https://player.vimeo.com/video/' + videoInfo.id +
                           '?autoplay=' + (elData.autoplay && initiallyActive ? 1 : 0) +
                           '&muted=' + (elData.muted ? 1 : 0) +
                           '&loop=' + (elData.loop ? 1 : 0) +
                           '&api=1';
            setMediaIframePermissions(videoNode, 'autoplay; fullscreen');
            videoNode.setAttribute('allowfullscreen', 'true');
        } else {
            videoNode = document.createElement('video');
            videoNode.controls = true;
            videoNode.autoplay = !!elData.autoplay && initiallyActive;
            videoNode.muted = elData.muted !== false;
            videoNode.loop = !!elData.loop;
            videoNode.setAttribute('playsinline', 'true');
            videoNode.setAttribute('preload', 'metadata');

            const source = document.createElement('source');
            source.src = elData.content;
            if (elData.content && elData.content.indexOf('data:video/') === 0) {
                const mime = elData.content.split(';')[0].split(':')[1];
                if (mime) source.type = mime;
            } else {
                const urlLower = String(elData.content || '').toLowerCase();
                if (urlLower.endsWith('.mp4')) source.type = 'video/mp4';
                else if (urlLower.endsWith('.webm')) source.type = 'video/webm';
                else if (urlLower.endsWith('.ogg')) source.type = 'video/ogg';
                else if (urlLower.endsWith('.mov')) source.type = 'video/quicktime';
            }
            videoNode.appendChild(source);
            videoNode.appendChild(document.createTextNode('Your browser does not support the video tag or this format.'));
        }
        videoNode.className = 'media-fill rounded-inherit';
        videoNode.dataset.autoplay = elData.autoplay ? 'true' : 'false';
        if (videoNode.tagName === 'IFRAME') {
            videoNode.addEventListener('load', () => {
                videoNode.dataset.mediaLoaded = 'true';
                if (typeof mediaOptions.onMediaLoad === 'function') mediaOptions.onMediaLoad();
            });
        }
        el.appendChild(videoNode);
    } else if (elData.type === 'shape') {
        applyShapeStyles(el, elData);
    } else if (elData.type === 'connector') {
        renderConnectorElement(el, elData);
    } else if (elData.type === 'html') {
        const iframe = document.createElement('iframe');
        iframe.srcdoc = buildViewerHtmlEmbedSrcdoc(elData.content || '', elData);
        iframe.setAttribute('sandbox', getViewerHtmlEmbedSandbox());
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        iframe.className = 'media-fill rounded-inherit';
        el.appendChild(iframe);
    } else if (elData.type === 'molecule') {
        const iframe = document.createElement('iframe');
        iframe.srcdoc = typeof buildMoleculeEmbedSrcdoc === 'function'
            ? buildMoleculeEmbedSrcdoc({
                ...elData,
                moleculePresentationMode: true,
                moleculeActive:
                    document.visibilityState !== 'hidden' &&
                    document.hasFocus() &&
                    Number(mediaOptions.slideIndex) === Number(mediaOptions.activeSlideIndex)
            })
            : '';
        if (typeof applyMoleculeEmbedSandbox === 'function') applyMoleculeEmbedSandbox(iframe);
        else {
            iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-downloads');
            iframe.setAttribute('referrerpolicy', 'no-referrer');
        }
        iframe.className = 'media-fill rounded-inherit';
        iframe.dataset.molecule = 'true';
        iframe.setAttribute('title', elData.moleculeIsTrajectory ? 'Molecular trajectory viewer' : 'Molecular structure viewer');
        if (typeof mediaOptions.onMediaLoad === 'function') iframe.addEventListener('load', mediaOptions.onMediaLoad);
        if (typeof attachMoleculeDataBridge === 'function') attachMoleculeDataBridge(iframe, elData);
        el.appendChild(iframe);
    } else if (elData.type === 'pdf') {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-embed-wrapper';
        const iframe = document.createElement('iframe');
        iframe.src = (elData.content || '') + ((elData.content || '').includes('#') ? '&' : '#') + 'toolbar=1&navpanes=0&view=FitH';
        iframe.className = 'pdf-embed-frame';
        wrapper.appendChild(iframe);
        el.appendChild(wrapper);
        (elData.pdfAnnotations || []).forEach(annotation => {
            const node = document.createElement('div');
            node.className = annotation.type === 'note' ? 'pdf-annotation pdf-annotation-note' : 'pdf-annotation pdf-annotation-highlight';
            node.style.left = (annotation.x || 0) + '%';
            node.style.top = (annotation.y || 0) + '%';
            node.style.width = (annotation.width || 0) + '%';
            node.style.height = (annotation.height || 0) + '%';
            if (annotation.type === 'note') {
                const safeText = String(annotation.text || 'Note')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                node.innerHTML = '<span class="pdf-note-dot"></span><span class="pdf-note-label">' + safeText + '</span>';
            }
            el.appendChild(node);
        });
    } else if (elData.type === 'equation') {
        const container = document.createElement("div");
        container.className = "equation-container";
        container.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;line-height:1;";
        container.innerHTML = elData.content || elData.latexSrc || "";
        el.appendChild(container);
    }

    return el;
}

function createViewerSlideBackgroundNode(background, mediaOptions = {}) {
    if (!background || (!background.content && background.type !== 'three')) return null;
    const wrapper = document.createElement('div');
    wrapper.className = background.type === 'three' ? 'slide-background-media slide-background-three' : 'slide-background-media';
    const opacity = Math.max(0, Math.min(1, Number(background.opacity ?? 1)));
    const blur = Math.max(0, Math.min(40, Number(background.blur) || 0));
    const brightness = Math.max(10, Math.min(200, Number(background.brightness ?? 100)));
    const saturate = Math.max(0, Math.min(250, Number(background.saturate ?? 100)));
    wrapper.style.opacity = String(opacity);
    wrapper.style.filter = 'blur(' + blur + 'px) brightness(' + brightness + '%) saturate(' + saturate + '%)';
    if (blur) wrapper.style.transform = 'scale(' + (1 + blur / 120) + ')';
    if (background.type === 'three') {
        wrapper.dataset.backgroundType = 'three';
        wrapper.dataset.threeStyle = background.style || 'orbital';
        const canvas = document.createElement('canvas');
        canvas.className = 'slide-background-three-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(canvas);
        requestAnimationFrame(() => {
            const ctx = canvas.getContext('2d');
            const rect = wrapper.getBoundingClientRect();
            const width = Math.max(1, Math.round(rect.width || 1024));
            const height = Math.max(1, Math.round(rect.height || 768));
            const ratio = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            if (!ctx) return;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--slide-bg').trim() || '#ffffff');
            gradient.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--slide-accent').trim() || '#2563eb');
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
            ctx.globalAlpha = 0.42;
            for (let i = 0; i < 56; i += 1) {
                const x = ((i * 73) % 997) / 997 * width;
                const y = ((i * 151) % 761) / 761 * height;
                ctx.beginPath();
                ctx.arc(x, y, 1.5 + (i % 5), 0, Math.PI * 2);
                ctx.fill();
            }
        });
    } else if (background.type === 'video') {
        const video = document.createElement('video');
        video.className = 'slide-background-video';
        video.src = background.content;
        video.style.setProperty('object-fit', background.fit || 'cover', 'important');
        video.muted = true;
        video.loop = true;
        const initiallyActive =
            document.visibilityState !== 'hidden' &&
            document.hasFocus() &&
            Number(mediaOptions.slideIndex) === Number(mediaOptions.activeSlideIndex);
        video.autoplay = initiallyActive;
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        if (initiallyActive) {
            const play = () => video.play().catch(() => {});
            video.addEventListener('loadeddata', play, { once: true });
            requestAnimationFrame(play);
        }
        wrapper.appendChild(video);
    } else {
        const image = document.createElement('img');
        image.className = 'slide-background-image';
        image.src = background.content;
        image.style.setProperty('object-fit', background.fit || 'cover', 'important');
        image.alt = '';
        image.draggable = false;
        wrapper.appendChild(image);
    }
    return wrapper;
}

function _parseVideoUrl(url) {
    if (!url) return { type: 'none' };
    const value = String(url).trim();
    const parseableValue = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value;
    let parsed = null;
    try {
        parsed = new URL(parseableValue);
    } catch (_err) {}
    const host = parsed && parsed.hostname ? parsed.hostname.replace(/^www\./, '') : '';
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
        let videoId = '';
        if (host === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
        else if (parsed && parsed.searchParams.has('v')) videoId = parsed.searchParams.get('v') || '';
        else if (parsed && parsed.pathname.includes('/embed/')) videoId = parsed.pathname.split('/embed/')[1].split('/')[0];
        else videoId = parsed && parsed.pathname ? parsed.pathname.split('/').filter(Boolean)[0] || '' : '';
        return { type: 'youtube', id: videoId };
    }
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
        const videoId = parsed && parsed.pathname ? parsed.pathname.split('/').filter(Boolean)[0] || '' : '';
        return { type: 'vimeo', id: videoId };
    }
    return { type: 'direct', url: value };
}

function normalizeConnectorType(connectorType) {
    return connectorType === 'curve' || connectorType === 'poly' ? connectorType : 'line';
}

function getConnectorPoints(elData) {
    const fallback = normalizeConnectorType(elData.connectorType) === 'curve'
        ? [{ x: 24, y: 96 }, { x: 140, y: 24 }, { x: 256, y: 96 }]
        : normalizeConnectorType(elData.connectorType) === 'poly'
          ? [{ x: 24, y: 110 }, { x: 140, y: 110 }, { x: 140, y: 36 }, { x: 256, y: 36 }]
          : [{ x: 24, y: 96 }, { x: 256, y: 36 }];
    const points = Array.isArray(elData.points) ? elData.points : fallback;
    const normalized = points
        .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    return normalized.length >= 2 ? normalized : fallback;
}

function buildConnectorPath(elData, startAdj, endAdj) {
    startAdj = startAdj || 0;
    endAdj = endAdj || 0;
    const rawPts = getConnectorPoints(elData);
    const pts = rawPts.map(function(p) { return { x: p.x, y: p.y }; });
    const n = pts.length;
    if (startAdj > 0 && n >= 2) {
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > startAdj) { pts[0].x += dx / len * startAdj; pts[0].y += dy / len * startAdj; }
    }
    if (endAdj > 0 && n >= 2) {
        const dx = pts[n - 1].x - pts[n - 2].x, dy = pts[n - 1].y - pts[n - 2].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > endAdj) { pts[n - 1].x -= dx / len * endAdj; pts[n - 1].y -= dy / len * endAdj; }
    }
    if (normalizeConnectorType(elData.connectorType) === 'poly') {
        return 'M ' + pts.map(function(p) { return p.x + ' ' + p.y; }).join(' L ');
    }
    if (normalizeConnectorType(elData.connectorType) === 'curve' && pts.length > 2) {
        let path = 'M ' + pts[0].x + ' ' + pts[0].y;
        for (let i = 1; i < pts.length - 1; i += 1) {
            const next = pts[i + 1];
            const midX = (pts[i].x + next.x) / 2;
            const midY = (pts[i].y + next.y) / 2;
            path += ' Q ' + pts[i].x + ' ' + pts[i].y + ' ' + midX + ' ' + midY;
        }
        const last = pts[pts.length - 1];
        path += ' T ' + last.x + ' ' + last.y;
        return path;
    }
    return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[n - 1].x + ' ' + pts[n - 1].y;
}

function _exportArrowAdj(head, hw, hl) {
    if (head === 'none' || head === 'line') return 0;
    if (head === 'dot' || head === 'square') return hw;
    return hl;
}

function _exportArrowheadSvg(tipX, tipY, nx, ny, hw, hl, head, color, strokeWidth) {
    if (head === 'none') return '';
    const px = -ny, py = nx;
    const bx = tipX - nx * hl, by = tipY - ny * hl;
    const r = function(v) { return Math.round(v * 100) / 100; };
    if (head === 'arrow' || head === 'triangle') {
        return '<path d="M ' + r(bx + px*hw) + ' ' + r(by + py*hw) + ' L ' + r(tipX) + ' ' + r(tipY) + ' L ' + r(bx - px*hw) + ' ' + r(by - py*hw) + ' Z" fill="' + color + '" stroke="' + color + '" stroke-linejoin="round"/>';
    }
    if (head === 'chevron') {
        return '<path d="M ' + r(bx + px*hw) + ' ' + r(by + py*hw) + ' L ' + r(tipX) + ' ' + r(tipY) + ' L ' + r(bx - px*hw) + ' ' + r(by - py*hw) + '" fill="none" stroke="' + color + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (head === 'line') {
        return '<path d="M ' + r(tipX + px*hw) + ' ' + r(tipY + py*hw) + ' L ' + r(tipX - px*hw) + ' ' + r(tipY - py*hw) + '" fill="none" stroke="' + color + '" stroke-width="' + strokeWidth + '" stroke-linecap="round"/>';
    }
    if (head === 'dot') {
        return '<circle cx="' + r(tipX - nx*hw) + '" cy="' + r(tipY - ny*hw) + '" r="' + r(hw) + '" fill="' + color + '"/>';
    }
    if (head === 'diamond') {
        const mx = bx + (hl / 2) * nx, my = by + (hl / 2) * ny;
        return '<path d="M ' + r(tipX) + ' ' + r(tipY) + ' L ' + r(mx + px*hw) + ' ' + r(my + py*hw) + ' L ' + r(bx) + ' ' + r(by) + ' L ' + r(mx - px*hw) + ' ' + r(my - py*hw) + ' Z" fill="' + color + '" stroke-linejoin="round"/>';
    }
    if (head === 'square') {
        const cx = tipX - nx*hw, cy = tipY - ny*hw;
        return '<path d="M ' + r(cx + px*hw + nx*hw) + ' ' + r(cy + py*hw + ny*hw) + ' L ' + r(cx + px*hw - nx*hw) + ' ' + r(cy + py*hw - ny*hw) + ' L ' + r(cx - px*hw - nx*hw) + ' ' + r(cy - py*hw - ny*hw) + ' L ' + r(cx - px*hw + nx*hw) + ' ' + r(cy - py*hw + ny*hw) + ' Z" fill="' + color + '" stroke-linejoin="round"/>';
    }
    return '';
}

function renderConnectorElement(el, elData) {
    const stroke = String(elData.styles && elData.styles.color ? elData.styles.color : '#2563eb')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const strokeWidth = Math.max(1, Number(elData.styles && elData.styles.strokeWidth) || 4);
    const width = parseFloat(elData.width) || 280;
    const height = parseFloat(elData.height) || 140;
    const startHead = ['none', 'arrow', 'triangle', 'chevron', 'line', 'dot', 'diamond', 'square'].includes(elData.connectorStart) ? elData.connectorStart : 'none';
    const endHead = ['none', 'arrow', 'triangle', 'chevron', 'line', 'dot', 'diamond', 'square'].includes(elData.connectorEnd) ? elData.connectorEnd : 'arrow';
    const hw = Math.max(2, (Number(elData.connectorHeadWidth) || 14) / 2);
    const hl = Math.max(2, Number(elData.connectorHeadLength) || 14);

    const pts = getConnectorPoints(elData);
    const n = pts.length;
    function ud(ax, ay, bx, by) {
        const len = Math.sqrt((bx-ax)*(bx-ax) + (by-ay)*(by-ay));
        return len < 0.001 ? { x: 1, y: 0 } : { x: (bx-ax)/len, y: (by-ay)/len };
    }
    const endDir = ud(pts[n-2].x, pts[n-2].y, pts[n-1].x, pts[n-1].y);
    const startDir = ud(pts[1].x, pts[1].y, pts[0].x, pts[0].y);
    const startAdj = _exportArrowAdj(startHead, hw, hl);
    const endAdj = _exportArrowAdj(endHead, hw, hl);

    el.innerHTML =
        '<svg class="connector-svg" viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="100%">' +
        '<path d="' + buildConnectorPath(elData, startAdj, endAdj) + '" fill="none" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round"/>' +
        _exportArrowheadSvg(pts[0].x, pts[0].y, startDir.x, startDir.y, hw, hl, startHead, stroke, strokeWidth) +
        _exportArrowheadSvg(pts[n-1].x, pts[n-1].y, endDir.x, endDir.y, hw, hl, endHead, stroke, strokeWidth) +
        '</svg>';
}

function renderTextContent(elData) {
    if (elData.textDocument && Array.isArray(elData.textDocument.blocks)) {
        const escape = value => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const runHtml = run => {
            let inner = escape(run?.text || run?.altText || run?.latex || '');
            const styles = [];
            (Array.isArray(run?.marks) ? run.marks : []).forEach(mark => {
                if (!mark) return;
                if (mark.type === 'bold') styles.push('font-weight:700');
                if (mark.type === 'italic') styles.push('font-style:italic');
                if (mark.type === 'underline') styles.push('text-decoration:underline');
                if (mark.type === 'strike') styles.push('text-decoration:line-through');
                if (mark.type === 'subscript') styles.push('vertical-align:sub;font-size:0.72em');
                if (mark.type === 'superscript') styles.push('vertical-align:super;font-size:0.72em');
                if (mark.type === 'style' && mark.style) {
                    Object.entries(mark.style).forEach(([prop, value]) => {
                        if (!/(?:expression\\s*\\(|javascript:|data:text\\/html|url\\s*\\()/i.test(String(value || ''))) {
                            styles.push(String(prop).replace(/[A-Z]/g, m => '-' + m.toLowerCase()) + ':' + String(value));
                        }
                    });
                }
            });
            return styles.length ? '<span style="' + styles.join(';') + '">' + inner + '</span>' : inner;
        };
        return elData.textDocument.blocks.map(block => {
            const inner = (block.children || []).map(runHtml).join('') || '<br>';
            if (block.type === 'listItem') {
                const level = Math.max(0, Number(block.list?.level) || 0);
                const style = block.list?.style || elData.bulletStyle || 'default';
                const kind = block.list?.kind === 'numbered' ? 'numbered' : 'bullet';
                const marker = kind === 'numbered' ? String(block.list?.ordinal || 1) + '.' : '•';
                return '<div class="ppt-bullet-block" data-bullet-style="' + escape(style) + '"><div class="ppt-bullet-row" data-list-kind="' + kind + '" style="--bullet-indent:' + (level * 20) + 'px;"><span class="ppt-bullet-marker">' + marker + '</span><span class="ppt-bullet-text">' + inner + '</span></div></div>';
            }
            if (block.type === 'heading') return '<h' + (block.level || 1) + '>' + inner + '</h' + (block.level || 1) + '>';
            return inner;
        }).join('<br>');
    }
    if (Array.isArray(elData.content)) {
        const bulletStyle = (elData.bulletStyle && BULLET_STYLE_THEMES[elData.bulletStyle]) ? elData.bulletStyle : 'default';
        let html = '<div class="ppt-bullet-block" data-bullet-style="' + bulletStyle + '">';
        elData.content.forEach(item => {
            const safeLevel = Math.max(0, Number(item.level) || 0);
            const levelStyle = _viewerGetLevelStyle(bulletStyle, safeLevel);
            const glyph = _viewerGetBulletGlyph(levelStyle);
            const indent = _viewerGetBulletIndent(safeLevel, levelStyle);
            const color = levelStyle.color || 'inherit';
            const fontScale = Number(levelStyle.fontSize) || 1;
            const itemHtml =
                typeof item.html === 'string'
                    ? item.html
                    : String(item.text || '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
            const text = itemHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
            if (!text) {
                html += '<div class="ppt-bullet-spacer"></div>';
                return;
            }
            html += '<div class="ppt-bullet-row" style="--bullet-indent:' + indent + 'px;--bullet-color:' + color + ';--bullet-font-scale:' + fontScale + ';">';
            html += '<span class="ppt-bullet-marker">' + glyph + '</span>';
            html += '<span class="ppt-bullet-text">' + itemHtml + '</span>';
            html += '</div>';
        });
        html += '</div>';
        return html;
    }
    return elData.content || '';
}

function getViewerShapeVisualStyle(elData) {
    const shapeType = elData?.shapeType || 'rectangle';
    const headSize = Math.max(12, Math.min(80, Number(elData?.arrowHeadSize) || 38));
    const shaftSize = Math.max(12, Math.min(90, Number(elData?.arrowShaftSize) || 36));
    const shaftStart = Math.max(0, Math.min(50, 50 - shaftSize / 2));
    const shaftEnd = Math.max(50, Math.min(100, 50 + shaftSize / 2));
    const headStart = Math.max(0, Math.min(92, 100 - headSize));
    const headEnd = Math.max(8, Math.min(100, headSize));
    switch (shapeType) {
        case 'triangle':
            return { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)', borderRadius: '0px' };
        case 'diamond':
            return { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', borderRadius: '0px' };
        case 'hexagon':
            return { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)', borderRadius: '0px' };
        case 'parallelogram':
            return { clipPath: 'polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)', borderRadius: '0px' };
        case 'arrow-right':
            return { clipPath: 'polygon(0% ' + shaftStart + '%, ' + headStart + '% ' + shaftStart + '%, ' + headStart + '% 0%, 100% 50%, ' + headStart + '% 100%, ' + headStart + '% ' + shaftEnd + '%, 0% ' + shaftEnd + '%)', borderRadius: '0px' };
        case 'arrow-left':
            return { clipPath: 'polygon(' + headEnd + '% 0%, ' + headEnd + '% ' + shaftStart + '%, 100% ' + shaftStart + '%, 100% ' + shaftEnd + '%, ' + headEnd + '% ' + shaftEnd + '%, ' + headEnd + '% 100%, 0% 50%)', borderRadius: '0px' };
        case 'arrow-up':
            return { clipPath: 'polygon(50% 0%, 100% ' + headEnd + '%, ' + shaftEnd + '% ' + headEnd + '%, ' + shaftEnd + '% 100%, ' + shaftStart + '% 100%, ' + shaftStart + '% ' + headEnd + '%, 0% ' + headEnd + '%)', borderRadius: '0px' };
        case 'arrow-down':
            return { clipPath: 'polygon(' + shaftStart + '% 0%, ' + shaftEnd + '% 0%, ' + shaftEnd + '% ' + headStart + '%, 100% ' + headStart + '%, 50% 100%, 0% ' + headStart + '%, ' + shaftStart + '% ' + headStart + '%)', borderRadius: '0px' };
        case 'circle':
            return { clipPath: 'none', borderRadius: '50%' };
        default:
            if (VIEWER_SHAPE_POLYGONS[shapeType]) {
                return { clipPath: 'polygon(' + VIEWER_SHAPE_POLYGONS[shapeType].map(p => p[0] + '% ' + p[1] + '%').join(', ') + ')', borderRadius: '0px' };
            }
            return { clipPath: 'none', borderRadius: elData?.styles?.borderRadius || '0px' };
    }
}

function applyShapeStyles(el, elData) {
    const visual = getViewerShapeVisualStyle(elData);
    el.style.clipPath = visual.clipPath;
    if (!elData?.styles?.borderRadius) {
        el.style.borderRadius = visual.borderRadius;
    }
    // Words typed into the shape (their style was worked out at export).
    if (elData?.shapeText) {
        const style = elData.shapeTextStyle || {};
        const text = document.createElement('div');
        const v = style.verticalAlign === 'top' ? 'flex-start' : style.verticalAlign === 'bottom' ? 'flex-end' : 'center';
        text.style.cssText = 'position:absolute;inset:8% 10%;display:flex;flex-direction:column;justify-content:' + v + ';white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.2;overflow:hidden;pointer-events:none;';
        text.style.color = style.color || '#172033';
        text.style.fontSize = style.fontSize || '20px';
        text.style.fontFamily = style.fontFamily || 'inherit';
        text.style.fontWeight = style.fontWeight || '600';
        text.style.fontStyle = style.fontStyle || 'normal';
        text.style.textAlign = style.textAlign || 'center';
        text.textContent = String(elData.shapeText);
        el.appendChild(text);
    }
}

`;
}

// --- Global Aliases for UI Bindings ---
window.exportPresentationZip = exportZip;
window.exportPresentationPDF = exportPDF;
window.exportPresentationPPTX = exportPPTX;
window.exportPresentationJson = function () {
  const dataStr =
    "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "presentation.json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};
