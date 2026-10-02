// Properties panel section for PDF embed elements.

function buildPdfPanel(panel, data) {
  const pdfGrp = createGroup("PDF Embed");
  const hasLocalPdf =
    typeof data.content === "string" &&
    (data.content.startsWith("blob:") ||
      data.content.startsWith("data:") ||
      data.content.startsWith("/media/"));
  pdfGrp.innerHTML += `
                <div class="flex flex-col gap-2 mb-3">
                    <input type="text" id="prop-pdf-url" class="w-full text-xs" value="${hasLocalPdf ? "Local PDF File" : escapeHtml(data.content || "")}" placeholder="https://.../file.pdf" ${hasLocalPdf ? "disabled" : ""}>
                    <button onclick="document.getElementById('pdf-file-upload').click()" class="w-full py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold">
                        ${hasLocalPdf ? "Replace Local PDF" : "Upload Local PDF"}
                    </button>
                </div>
                <button id="prop-pdf-toggle" class="w-full py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold mb-2">
                    ${data.pdfInteractive ? '<i class="fa-solid fa-hand-pointer mr-1"></i> Clicks scroll the PDF' : '<i class="fa-solid fa-up-down-left-right mr-1"></i> Clicks move the box'}
                </button>
                <div class="grid grid-cols-3 gap-2 mb-2">
                    <button id="prop-pdf-mode-nav" class="py-2 rounded border text-xs ${data.pdfEditorMode === "navigate" ? "bg-primary border-primary text-white" : "border-slate-300 bg-white text-slate-700"}">Navigate</button>
                    <button id="prop-pdf-mode-highlight" class="py-2 rounded border text-xs ${data.pdfEditorMode === "highlight" ? "bg-primary border-primary text-white" : "border-slate-300 bg-white text-slate-700"}">Highlight</button>
                    <button id="prop-pdf-mode-note" class="py-2 rounded border text-xs ${data.pdfEditorMode === "note" ? "bg-primary border-primary text-white" : "border-slate-300 bg-white text-slate-700"}">Note</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <button id="prop-pdf-delete-annotation" class="py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold" ${data.pdfSelectedAnnotationId ? "" : "disabled"}>Delete Selected</button>
                    <button id="prop-pdf-clear-annotations" class="py-2 rounded border border-slate-300 bg-white text-xs text-slate-700 font-semibold" ${(data.pdfAnnotations || []).length ? "" : "disabled"}>Clear All</button>
                </div>
                <button id="prop-pdf-fit" class="w-full py-2 rounded bg-accent/20 border border-accent/40 text-xs text-accent font-semibold mt-2">
                    Fit To Full Slide
                </button>
                <p class="text-[11px] text-slate-500 leading-relaxed mt-3">
                    In highlight mode, drag to mark an area. In note mode, click to place a note. Annotations are saved with the element.
                </p>
            `;
  panel.appendChild(pdfGrp);
}

function bindPdfPanel(data, onCommit) {
  const urlField = document.getElementById("prop-pdf-url");
  if (urlField) {
    const commitPdfUrl = () => {
      const nextUrl = urlField.value.trim();
      if (!nextUrl) return;
      if (!_isSafeAssetUrl(nextUrl)) {
        setProjectSaveHint?.("Enter an http(s) link to a PDF", "danger");
        urlField.value = data.content || "";
        return;
      }
      onCommit(() => {
        updateElementState(data.id, { content: nextUrl });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
    urlField.onchange = commitPdfUrl;
    urlField.onblur = commitPdfUrl;
  }

  const toggleBtn = document.getElementById("prop-pdf-toggle");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      onCommit(() => {
        const next = !data.pdfInteractive;
        updateElementState(data.id, { pdfInteractive: next });
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
  }

  const setPdfMode = (nextMode) => {
    onCommit(() => {
      updateElementState(data.id, { pdfEditorMode: nextMode });
      syncPdfEmbedDom({ ...data, pdfEditorMode: nextMode });
      buildPropertiesPanel();
    });
  };

  document
    .getElementById("prop-pdf-mode-nav")
    ?.addEventListener("click", () => setPdfMode("navigate"));
  document
    .getElementById("prop-pdf-mode-highlight")
    ?.addEventListener("click", () => setPdfMode("highlight"));
  document
    .getElementById("prop-pdf-mode-note")
    ?.addEventListener("click", () => setPdfMode("note"));

  const deleteBtn = document.getElementById("prop-pdf-delete-annotation");
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      onCommit(() => {
        const nextAnnotations = (data.pdfAnnotations || []).filter(
          (item) => item.id !== data.pdfSelectedAnnotationId,
        );
        updateElementState(data.id, {
          pdfAnnotations: nextAnnotations,
          pdfSelectedAnnotationId: "",
        });
        schedulePresentationAutosave?.(150);
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
  }

  const clearBtn = document.getElementById("prop-pdf-clear-annotations");
  if (clearBtn) {
    clearBtn.onclick = () => {
      onCommit(() => {
        updateElementState(data.id, {
          pdfAnnotations: [],
          pdfSelectedAnnotationId: "",
        });
        schedulePresentationAutosave?.(150);
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        buildPropertiesPanel();
      });
    };
  }

  const fitBtn = document.getElementById("prop-pdf-fit");
  if (fitBtn) {
    fitBtn.onclick = () => {
      onCommit(() => {
        const { width, height } = getSlideDimensions();
        updateElementState(data.id, {
          x: 0,
          y: 0,
          width: `${width}px`,
          height: `${height}px`,
        });
        const dom = document.getElementById(data.id);
        if (dom) {
          dom.style.transform = "translate(0px, 0px)";
          dom.setAttribute("data-x", 0);
          dom.setAttribute("data-y", 0);
          dom.style.width = `${width}px`;
          dom.style.height = `${height}px`;
        }
        updateGroupBound();
        buildPropertiesPanel();
      });
    };
  }
}
