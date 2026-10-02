// PDF embed elements and PDF annotations.

function _applyPdfTypeContent(el, elData) {
  el.classList.toggle("pdf-interactive", Boolean(elData.pdfInteractive));
  el.setAttribute("data-pdf-mode", elData.pdfEditorMode || "navigate");

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-embed-wrapper";

  const iframe = document.createElement("iframe");
  iframe.src = buildPdfEmbedSrc(elData.content || "");
  iframe.className = "w-full h-full pdf-embed-frame";
  iframe.style.border = "0";
  wrapper.appendChild(iframe);
  el.appendChild(wrapper);

  _renderPdfAnnotations(el, elData);

  const badge = document.createElement("span");
  badge.innerHTML = `<i class="fa-regular fa-file-pdf mr-1"></i> PDF`;
  badge.className =
    "pdf-embed-badge absolute top-2 left-2 px-2 py-1 bg-gray-900/80 text-white text-[10px] rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity";
  el.appendChild(badge);
}

// In the editor the browser's PDF toolbar is useful (page number, zoom). While presenting, the audience should see
// the page, not download and print buttons; scrolling still turns pages.
function buildPdfEmbedSrc(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  const joiner = value.includes("#") ? "&" : "#";
  const toolbar = document.body.classList.contains("play-mode-active") ? 0 : 1;
  return `${value}${joiner}toolbar=${toolbar}&navpanes=0&view=FitH`;
}

// A picture of one page of an uploaded PDF (rendered by the server), for thumbnails and exports, which cannot look
// into the browser's PDF viewer. Null for PDFs that are not uploads of this app.
function pdfPageImageUrl(elData, width = 1400) {
  const value = String(elData?.content || "").split("#")[0];
  if (!/^\/media\/assets\/[^/?]+\.pdf$/i.test(value)) return null;
  const page = Math.max(1, Number(elData.pdfPage) || 1);
  return `/api/assets/pdf-page/?url=${encodeURIComponent(value)}&page=${page}&width=${Math.round(width)}`;
}

// While a slide is captured (PDF/PNG), each embedded PDF is covered by a picture of its page.
async function showPdfsAsPicturesForCapture(slideNode) {
  const added = [];
  const slideData = state.slides?.[currentSlideIndex];
  await Promise.all(
    (slideData?.elements || []).filter((el) => el?.type === "pdf").map(async (el) => {
      const url = pdfPageImageUrl(el);
      const host = slideNode?.querySelector(`[id="${el.id}"]`);
      if (!url || !host) return;
      const img = document.createElement("img");
      img.src = url;
      try {
        await img.decode();
      } catch (_error) {
        return;
      }
      // Sized by hand to fit inside the box (the capture library ignores object-fit and stretched the page).
      const boxW = host.clientWidth;
      const boxH = host.clientHeight;
      const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
      const cover = document.createElement("div");
      cover.style.cssText = "position:absolute;inset:0;background:#ffffff;border-radius:inherit;z-index:5;overflow:hidden;";
      img.style.cssText = `position:absolute;left:${(boxW - img.naturalWidth * scale) / 2}px;top:${(boxH - img.naturalHeight * scale) / 2}px;width:${img.naturalWidth * scale}px;height:${img.naturalHeight * scale}px;`;
      cover.appendChild(img);
      host.appendChild(cover);
      added.push(cover);
    }),
  );
  return () => added.forEach((img) => img.remove());
}

// Embedded PDFs of an export state as pictures of their page (for PowerPoint), fitted inside the element's box.
async function replacePdfsWithPictures(exportState) {
  for (const slide of exportState?.slides || []) {
    for (const [index, el] of (slide.elements || []).entries()) {
      if (el?.type !== "pdf") continue;
      const url = pdfPageImageUrl(el);
      if (!url) continue;
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) continue;
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const size = await new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
          probe.onerror = () => resolve(null);
          probe.src = dataUrl;
        });
        if (!size) continue;
        const boxW = parseFloat(el.width) || 520;
        const boxH = parseFloat(el.height) || 360;
        const scale = Math.min(boxW / size.w, boxH / size.h);
        const width = size.w * scale;
        const height = size.h * scale;
        slide.elements[index] = {
          id: el.id,
          type: "image",
          content: dataUrl,
          x: (parseFloat(el.x) || 0) + (boxW - width) / 2,
          y: (parseFloat(el.y) || 0) + (boxH - height) / 2,
          width: `${Math.round(width)}px`,
          height: `${Math.round(height)}px`,
          rotation: el.rotation,
          styles: { zIndex: el.styles?.zIndex, borderRadius: "0px" },
          exportedFrom: "pdf",
        };
      } catch (error) {
        console.warn("PDF kept as a placeholder in the export:", error);
      }
    }
  }
}

function _buildPdfAnnotationNode(annotation, isSelected) {
  const node = document.createElement(
    annotation.type === "note" ? "button" : "div",
  );
  if (annotation.type === "note") node.type = "button";
  node.className =
    `pdf-annotation pdf-annotation-${annotation.type || "highlight"} ${isSelected ? "pdf-annotation-selected" : ""}`.trim();
  node.style.left = `${annotation.x || 0}%`;
  node.style.top = `${annotation.y || 0}%`;
  node.style.width = `${annotation.width || 0}%`;
  node.style.height = `${annotation.height || 0}%`;
  node.dataset.annotationId = annotation.id;
  if (annotation.type === "note") {
    node.innerHTML = `<span class="pdf-note-dot"></span><span class="pdf-note-label">${escapeHtml(annotation.text || "Note")}</span>`;
    node.title = annotation.text || "Note";
  }
  return node;
}

function _renderPdfAnnotations(el, elData) {
  const layer = document.createElement("div");
  const mode = elData.pdfEditorMode || "navigate";
  layer.className =
    `pdf-annotation-layer ${mode === "navigate" ? "" : "pdf-annotation-layer-active"}`.trim();

  const applySelectedAnnotationClass = (selectedId) => {
    layer.querySelectorAll(".pdf-annotation").forEach((node) => {
      node.classList.toggle(
        "pdf-annotation-selected",
        node.dataset.annotationId === selectedId,
      );
    });
  };

  (elData.pdfAnnotations || []).forEach((annotation) => {
    const node = _buildPdfAnnotationNode(
      annotation,
      annotation.id === elData.pdfSelectedAnnotationId,
    );
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectElement(elData.id, "replace");
      updateElementState(elData.id, { pdfSelectedAnnotationId: annotation.id });
      applySelectedAnnotationClass(annotation.id);
      buildPropertiesPanel();
    });
    if (annotation.type === "note") {
      node.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (document.body.classList.contains("play-mode-active")) return;
        sfPrompt({ title: "Edit note", value: annotation.text || "", multiline: true, okLabel: "Save", hint: "Ctrl+Enter saves." }).then((nextText) => {
        if (nextText == null) return;
        saveStateToUndo();
        const nextAnnotations = (elData.pdfAnnotations || []).map((item) =>
          item.id === annotation.id ? { ...item, text: nextText } : item,
        );
        updateElementState(elData.id, {
          pdfAnnotations: nextAnnotations,
          pdfSelectedAnnotationId: annotation.id,
        });
        schedulePresentationAutosave?.(150);
        renderSlidesFromState?.();
        buildPropertiesPanel();
        });
      });
    }
    layer.appendChild(node);
  });

  if (!document.body.classList.contains("play-mode-active")) {
    let drawing = null;
    let draft = null;
    // The mode as it is now (the panel changes it without redrawing the slide).
    const liveMode = () => el.getAttribute("data-pdf-mode") || "navigate";
    const pointFor = (event) => {
      const rect = layer.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(
            100,
            ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            100,
            ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100,
          ),
        ),
      };
    };

    layer.addEventListener("mousedown", (event) => {
      if (liveMode() !== "highlight" || event.target !== layer) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(elData.id, "replace");
      drawing = pointFor(event);
      draft = document.createElement("div");
      draft.className =
        "pdf-annotation pdf-annotation-highlight pdf-annotation-draft";
      draft.style.left = `${drawing.x}%`;
      draft.style.top = `${drawing.y}%`;
      draft.style.width = "0%";
      draft.style.height = "0%";
      layer.appendChild(draft);
    });

    layer.addEventListener("mousemove", (event) => {
      if (!drawing || !draft) return;
      const current = pointFor(event);
      draft.style.left = `${Math.min(drawing.x, current.x)}%`;
      draft.style.top = `${Math.min(drawing.y, current.y)}%`;
      draft.style.width = `${Math.abs(current.x - drawing.x)}%`;
      draft.style.height = `${Math.abs(current.y - drawing.y)}%`;
    });

    layer.addEventListener("mouseup", (event) => {
      if (!drawing || !draft) return;
      const current = pointFor(event);
      const annotation = {
        id: generateId("pdfann"),
        type: "highlight",
        x: Math.min(drawing.x, current.x),
        y: Math.min(drawing.y, current.y),
        width: Math.abs(current.x - drawing.x),
        height: Math.abs(current.y - drawing.y),
      };
      draft.remove();
      draft = null;
      drawing = null;
      if (annotation.width < 1 || annotation.height < 1) return;
      saveStateToUndo();
      updateElementState(elData.id, {
        pdfAnnotations: [...(elData.pdfAnnotations || []), annotation],
        pdfSelectedAnnotationId: annotation.id,
      });
      schedulePresentationAutosave?.(150);
      renderSlidesFromState?.();
      buildPropertiesPanel();
    });

    layer.addEventListener("mouseleave", () => {
      if (draft) draft.remove();
      draft = null;
      drawing = null;
    });

    layer.addEventListener("click", (event) => {
      if (liveMode() !== "note" || event.target !== layer) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(elData.id, "replace");
      // Where the note goes is read now; the text comes from the app's dialog (it was the browser's prompt).
      const point = pointFor(event);
      sfPrompt({ title: "New note", label: "Note text", multiline: true, okLabel: "Add note", hint: "Ctrl+Enter adds it." }).then((text) => {
      if (text == null || !text.trim()) return;
      const annotation = {
        id: generateId("pdfann"),
        type: "note",
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        text,
      };
      saveStateToUndo();
      updateElementState(elData.id, {
        pdfAnnotations: [...(elData.pdfAnnotations || []), annotation],
        pdfSelectedAnnotationId: annotation.id,
      });
      schedulePresentationAutosave?.(150);
      renderSlidesFromState?.();
      buildPropertiesPanel();
      });
    });
  }

  el.appendChild(layer);
}
