// Properties panel section for equation elements.

function buildEquationPanel(panel, data) {
  const eqGrp = createGroup("Equation");
  eqGrp.innerHTML += `
                <div class="flex flex-col gap-2">
                    <button id="prop-eq-edit" class="w-full py-2 rounded bg-accent/20 border border-accent/40 text-accent text-xs font-semibold hover:bg-accent/30 transition-colors">
                        <i class="fa-solid fa-pen-to-square mr-2"></i>Edit LaTeX
                    </button>
                    <div class="flex gap-2">
                        <div class="flex-1 flex flex-col gap-1">
                            <label class="text-xs text-slate-600 uppercase font-semibold">Size</label>
                            <input type="number" id="prop-eq-fs" class="w-full text-xs" value="${parseInt(data.styles?.fontSize) || 24}">
                        </div>
                        <div class="flex-1 flex flex-col gap-1">
                            <label class="text-xs text-slate-600 uppercase font-semibold">Color</label>
                            <input type="color" id="prop-eq-color" class="w-full h-8 cursor-pointer rounded bg-transparent p-0 border-none" value="${escapeHtml(data.styles?.color || "#ffffff")}">
                        </div>
                    </div>
                </div>
            `;
  panel.appendChild(eqGrp);
}

function bindEquationPanel(data, onCommit) {
  const editBtn = document.getElementById("prop-eq-edit");
  if (editBtn) {
    editBtn.onclick = () => {
      if (typeof openEquationModal === "function") {
        openEquationModal(data.latexSrc, data.id);
      }
    };
  }

  const fontSize = document.getElementById("prop-eq-fs");
  if (fontSize) {
    const commitFontSize = () => {
      onCommit(() => {
        const val = `${fontSize.value}px`;
        updateElementState(data.id, {
          styles: { ...data.styles, fontSize: val },
        });
        data.styles.fontSize = val;
        if (window.renderSlidesFromState) window.renderSlidesFromState();
      });
    };
    fontSize.onchange = commitFontSize;
    fontSize.onblur = commitFontSize;
  }

  const colorPicker = document.getElementById("prop-eq-color");
  if (colorPicker) {
    colorPicker.oninput = (e) => {
      const val = e.target.value;
      updateElementState(data.id, {
        styles: { ...data.styles, color: val },
      });
      data.styles.color = val;
      // Real-time update for better UX
      const dom = document.getElementById(data.id);
      if (dom) {
        const container = dom.querySelector(".equation-container");
        if (container) container.style.color = val;
      }
    };
    colorPicker.onchange = () => {
      onCommit(() => {
        if (window.renderSlidesFromState) window.renderSlidesFromState();
      });
    };
  }
}
