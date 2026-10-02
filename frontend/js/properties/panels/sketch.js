// Properties panel section for sketch elements.

function buildSketchPanel(panel, data) {
  const sketchGrp = createGroup("Sketch Tools");
  sketchGrp.innerHTML += `
                <div class="flex flex-col gap-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">Stroke Color</label>
                        <input type="color" id="prop-sketch-color" class="w-full h-8 cursor-pointer rounded bg-transparent p-0 border-none" value="${escapeHtml(data.sketchStrokeColor || "#000000")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">Stroke Width</label>
                        <select id="prop-sketch-width" class="w-full text-xs">
                            <option value="1" ${(data.sketchStrokeWidth || 2) === 1 ? "selected" : ""}>1px</option>
                            <option value="2" ${(data.sketchStrokeWidth || 2) === 2 ? "selected" : ""}>2px</option>
                            <option value="3" ${(data.sketchStrokeWidth || 2) === 3 ? "selected" : ""}>3px</option>
                            <option value="4" ${(data.sketchStrokeWidth || 2) === 4 ? "selected" : ""}>4px</option>
                            <option value="6" ${(data.sketchStrokeWidth || 2) === 6 ? "selected" : ""}>6px</option>
                            <option value="8" ${(data.sketchStrokeWidth || 2) === 8 ? "selected" : ""}>8px</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button id="prop-sketch-clear" class="py-2 rounded bg-red-50 border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors">
                            <i class="fa-solid fa-trash mr-1"></i>Clear
                        </button>
                        <button id="prop-sketch-activate" class="py-2 rounded bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors">
                            <i class="fa-solid fa-pen-nib mr-1"></i>Draw
                        </button>
                    </div>
                    <div class="text-xs text-slate-500 text-center py-2 border-t border-slate-200">
                        Click "Draw" to sketch, or select element and draw directly.
                    </div>
                </div>
            `;
  panel.appendChild(sketchGrp);
}

function bindSketchPanel(data) {
  const colorPicker = document.getElementById("prop-sketch-color");
  if (colorPicker) {
    bindUndoableContinuousInput(colorPicker, (e) => {
      updateElementState(data.id, { sketchStrokeColor: e.target.value });
      data.sketchStrokeColor = e.target.value;
    });
  }

  const widthSelect = document.getElementById("prop-sketch-width");
  if (widthSelect) {
    widthSelect.onchange = (e) => {
      saveStateToUndo();
      updateElementState(data.id, {
        sketchStrokeWidth: Number(e.target.value),
      });
      data.sketchStrokeWidth = Number(e.target.value);
    };
  }

  const clearBtn = document.getElementById("prop-sketch-clear");
  if (clearBtn) {
    clearBtn.onclick = () => {
      saveStateToUndo();
      updateElementState(data.id, { strokes: [] });
      data.strokes = [];
      if (window.renderSlidesFromState) window.renderSlidesFromState();
    };
  }

  const activateBtn = document.getElementById("prop-sketch-activate");
  if (activateBtn) {
    activateBtn.onclick = () => {
      if (typeof initSketchMode === "function") {
        initSketchMode(data.id);
      }
    };
  }
}
