// Properties panel section for table elements.

function buildTablePanel(panel, data) {
  const tableData = normalizeTableData(data.tableData);
  const tableSelection = tableData.selection;
  const selectedRow =
    tableSelection?.type === "row" || tableSelection?.type === "cell"
      ? tableSelection.row
      : null;
  const selectedCol =
    tableSelection?.type === "col" || tableSelection?.type === "cell"
      ? tableSelection.col
      : null;
  const selectedCell =
    tableSelection?.type === "cell" &&
    selectedRow !== null &&
    selectedCol !== null
      ? tableData.cells[selectedRow]?.[selectedCol]
      : null;
  const selectedStyles = selectedCell?.styles || {};
  const effectiveTableFontFamily =
    selectedStyles.fontFamily ||
    tableData.fontFamily ||
    '"Manrope", sans-serif';
  const effectiveTableFontSize =
    selectedStyles.fontSize || tableData.fontSize || "16px";
  const effectiveTableTextColor =
    selectedStyles.color || tableData.textColor || "#172033";
  const effectiveTableFontWeight =
    selectedStyles.fontWeight || tableData.fontWeight || "400";
  const effectiveTableFontStyle =
    selectedStyles.fontStyle || tableData.fontStyle || "normal";
  const effectiveTableTextAlign =
    selectedStyles.textAlign || tableData.textAlign || "left";
  const tableGrp = createGroup("Table Layout");
  tableGrp.innerHTML += `
                <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Table Width</label>
                        <input type="number" id="prop-table-element-width" class="prop-input-sm" min="80" value="${Math.round(parseFloat(data.width) || 420)}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Table Height</label>
                        <input type="number" id="prop-table-element-height" class="prop-input-sm" min="60" value="${Math.round(parseFloat(data.height) || 220)}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Row height</label>
                        <input type="number" id="prop-table-row-height" class="prop-input-sm" min="24" value="${selectedRow !== null ? Math.round(tableData.rowHeights[selectedRow] || 44) : ""}" placeholder="Select row">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Column width</label>
                        <input type="number" id="prop-table-col-width" class="prop-input-sm" min="36" value="${selectedCol !== null ? Math.round(_tableColumnBoxWidth(tableData, data, selectedCol)) : ""}" placeholder="Select column">
                    </div>
                </div>
                <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                    <span>${tableSelection ? `Selected ${tableSelection.type}${selectedRow !== null ? ` R${selectedRow + 1}` : ""}${selectedCol !== null ? ` C${selectedCol + 1}` : ""}` : "No row, column, or cell selected"}</span>
                    <button id="prop-table-clear-selection" class="font-semibold text-primary">Clear</button>
                </div>
                <div class="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div class="flex items-center justify-between">
                        <span class="text-xs text-slate-600 uppercase font-semibold">Text Style</span>
                        <span class="text-[10px] text-slate-400">${tableSelection ? "Applies to selection" : "Applies to table default"}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Font</span>
                            <select id="prop-table-font" class="prop-select">${buildFontOptions(effectiveTableFontFamily)}</select>
                        </label>
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Size</span>
                            <input type="text" id="prop-table-font-size" class="prop-input-sm" value="${escapeHtml(effectiveTableFontSize)}">
                        </label>
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Color</span>
                            <input type="color" id="prop-table-cell-text-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(effectiveTableTextColor, "#172033")}">
                        </label>
                        <label class="flex flex-col gap-1">
                            <span class="text-xs text-slate-600 uppercase font-semibold">Align</span>
                            <select id="prop-table-text-align" class="prop-select">
                                ${["left", "center", "right"].map((align) => `<option value="${align}" ${effectiveTableTextAlign === align ? "selected" : ""}>${align[0].toUpperCase() + align.slice(1)}</option>`).join("")}
                            </select>
                        </label>
                    </div>
                    <div class="flex gap-2">
                        <button id="prop-table-bold" class="prop-icon-btn ${effectiveTableFontWeight === "700" || effectiveTableFontWeight === "bold" ? "active" : ""}" title="Bold">B</button>
                        <button id="prop-table-italic" class="prop-icon-btn italic ${effectiveTableFontStyle === "italic" ? "active" : ""}" title="Italic">I</button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Rows</label>
                        <div class="flex gap-2">
                            <button id="prop-table-add-row" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50">Add</button>
                            <button id="prop-table-remove-row" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50" ${tableData.rows <= 1 ? "disabled" : ""}>Remove</button>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Columns</label>
                        <div class="flex gap-2">
                            <button id="prop-table-add-col" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50">Add</button>
                            <button id="prop-table-remove-col" class="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-50" ${tableData.cols <= 1 ? "disabled" : ""}>Remove</button>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Border</label>
                        <input type="color" id="prop-table-border-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.borderColor, "#cbd5e1")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Border W</label>
                        <input type="number" id="prop-table-border-width" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" min="0" max="8" value="${tableData.borderWidth}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Header Fill</label>
                        <input type="color" id="prop-table-header-fill" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.headerFill, "#e2e8f0")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Body Fill</label>
                        <input type="color" id="prop-table-body-fill" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.bodyFill, "#ffffff")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Alt Fill</label>
                        <input type="color" id="prop-table-alt-fill" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.altFill, "#f8fafc")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Padding</label>
                        <input type="number" id="prop-table-padding" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" min="2" max="24" value="${tableData.cellPadding}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Text</label>
                        <input type="color" id="prop-table-text-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.textColor, "#172033")}">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs text-slate-600 uppercase font-semibold">Header Text</label>
                        <input type="color" id="prop-table-header-text-color" class="w-full h-8 cursor-pointer rounded-md p-0" value="${_normalizeColorForInput(tableData.headerTextColor, "#172033")}">
                    </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer group/chk mt-3">
                    <input type="checkbox" id="prop-table-header-row" ${tableData.headerRow ? "checked" : ""} class="hidden">
                    <div class="w-4 h-4 rounded border border-gray-600 flex items-center justify-center group-hover/chk:border-accent transition-colors">
                        <div class="w-2.5 h-2.5 rounded-sm bg-accent transition-opacity ${tableData.headerRow ? "opacity-100" : "opacity-0"}"></div>
                    </div>
                    <span class="text-xs text-gray-400">Header Row</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer group/chk mt-2">
                    <input type="checkbox" id="prop-table-zebra" ${tableData.zebra ? "checked" : ""} class="hidden">
                    <div class="w-4 h-4 rounded border border-gray-600 flex items-center justify-center group-hover/chk:border-accent transition-colors">
                        <div class="w-2.5 h-2.5 rounded-sm bg-accent transition-opacity ${tableData.zebra ? "opacity-100" : "opacity-0"}"></div>
                    </div>
                    <span class="text-xs text-gray-400">Zebra Rows</span>
                </label>
                <p class="text-xs text-slate-600 leading-snug mt-2">Double click a cell on the slide to edit it.</p>
            `;
  panel.appendChild(tableGrp);
  const tableContent = tableGrp.children[1];
  const tableRows = tableContent ? Array.from(tableContent.children) : [];
  if (tableRows.length >= 4) {
    const tableTextGrp = createGroup("Table Text");
    const tableStyleGrp = createGroup("Table Style");
    tableTextGrp.appendChild(tableRows[2]);
    // Adding and removing rows and columns is about the table's content, so it stays on the Content tab with the
    // sizes; the colours and borders beside it go to Style.
    const styleGrid = tableRows[3];
    const structure = document.createElement("div");
    structure.className = "grid grid-cols-2 gap-3";
    Array.from(styleGrid?.children || []).slice(0, 2).forEach((node) => structure.appendChild(node));
    tableContent.insertBefore(structure, tableRows[1]);
    tableRows.slice(3).forEach((node) => tableStyleGrp.appendChild(node));
    panel.appendChild(tableTextGrp);
    panel.appendChild(tableStyleGrp);
  }
}

function bindTablePanel(data) {
  const commitTableElementDimension = (inputId, key, min) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const commit = () => {
      const next = Math.max(min, Number(input.value) || min);
      saveStateToUndo();
      updateElementState(data.id, { [key]: `${next}px` });
      data[key] = `${next}px`;
      const dom = document.getElementById(data.id);
      if (dom) dom.style[key] = `${next}px`;
      updateGroupBound();
      refreshPreviews?.();
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  };
  commitTableElementDimension("prop-table-element-width", "width", 80);
  commitTableElementDimension("prop-table-element-height", "height", 60);

  const rowHeightInput = document.getElementById("prop-table-row-height");
  if (rowHeightInput) {
    const commit = () => {
      const tableData = normalizeTableData(data.tableData);
      const row =
        tableData.selection?.type === "row" ||
        tableData.selection?.type === "cell"
          ? tableData.selection.row
          : null;
      if (row === null || row === undefined) return;
      mutateSelectedTableData((nextTableData) => {
        nextTableData.rowHeights[row] = Math.max(
          24,
          Number(rowHeightInput.value) || 24,
        );
        nextTableData.selection = tableData.selection;
      });
    };
    rowHeightInput.addEventListener("change", commit);
    rowHeightInput.addEventListener("blur", commit);
  }

  const colWidthInput = document.getElementById("prop-table-col-width");
  if (colWidthInput) {
    const commit = () => {
      const tableData = normalizeTableData(data.tableData);
      const col =
        tableData.selection?.type === "col" ||
        tableData.selection?.type === "cell"
          ? tableData.selection.col
          : null;
      if (col === null || col === undefined) return;
      // In the box's pixels, and the box follows (the columns are shares of the box).
      mutateSelectedTableData((nextTableData) => {
        nextTableData.colWidths[col] = Math.max(
          36,
          Number(colWidthInput.value) || 36,
        );
        nextTableData.selection = tableData.selection;
      }, { fitElement: true });
    };
    colWidthInput.addEventListener("change", commit);
    colWidthInput.addEventListener("blur", commit);
  }

  document
    .getElementById("prop-table-clear-selection")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        tableData.selection = null;
      });
      clearTablePartSelections();
    });

  const mutateTableTextStyle = (prop, value) => {
    mutateSelectedTableData((tableData) => {
      const selection = tableData.selection;
      const applyToCell = (row, col) => {
        const cell = tableData.cells[row]?.[col];
        if (!cell) return;
        cell.styles = { ...(cell.styles || {}), [prop]: value };
      };

      if (selection?.type === "cell") {
        applyToCell(selection.row, selection.col);
      } else if (selection?.type === "row") {
        for (let col = 0; col < tableData.cols; col += 1)
          applyToCell(selection.row, col);
      } else if (selection?.type === "col") {
        for (let row = 0; row < tableData.rows; row += 1)
          applyToCell(row, selection.col);
      } else {
        tableData[prop] = value;
      }
    });
  };

  const tableFont = document.getElementById("prop-table-font");
  if (tableFont) {
    tableFont.onchange = (e) =>
      mutateTableTextStyle("fontFamily", e.target.value);
  }
  const tableFontSize = document.getElementById("prop-table-font-size");
  if (tableFontSize) {
    const commit = () => {
      const nextValue = _normalizePx(tableFontSize.value, "16px");
      tableFontSize.value = nextValue;
      mutateTableTextStyle("fontSize", nextValue);
    };
    tableFontSize.addEventListener("change", commit);
    tableFontSize.addEventListener("blur", commit);
    tableFontSize.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commit();
      tableFontSize.blur();
    });
  }
  const tableCellTextColor = document.getElementById(
    "prop-table-cell-text-color",
  );
  if (tableCellTextColor) {
    tableCellTextColor.oninput = (e) =>
      mutateTableTextStyle(
        "color",
        _normalizeColorForInput(e.target.value, "#172033"),
      );
  }
  const tableTextAlign = document.getElementById("prop-table-text-align");
  if (tableTextAlign) {
    tableTextAlign.onchange = (e) =>
      mutateTableTextStyle("textAlign", e.target.value);
  }
  document
    .getElementById("prop-table-bold")
    ?.addEventListener("click", () => {
      const current = normalizeTableData(data.tableData);
      const selection = current.selection;
      const selected =
        selection?.type === "cell"
          ? current.cells[selection.row]?.[selection.col]?.styles
              ?.fontWeight
          : null;
      const effective = selected || current.fontWeight || "400";
      mutateTableTextStyle(
        "fontWeight",
        effective === "700" || effective === "bold" ? "400" : "700",
      );
    });
  document
    .getElementById("prop-table-italic")
    ?.addEventListener("click", () => {
      const current = normalizeTableData(data.tableData);
      const selection = current.selection;
      const selected =
        selection?.type === "cell"
          ? current.cells[selection.row]?.[selection.col]?.styles
              ?.fontStyle
          : null;
      const effective = selected || current.fontStyle || "normal";
      mutateTableTextStyle(
        "fontStyle",
        effective === "italic" ? "normal" : "italic",
      );
    });

  document
    .getElementById("prop-table-add-row")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        tableData.rows += 1;
        // Same height as the last row, so the new row matches the ones above it.
        tableData.rowHeights.push(tableData.rowHeights[tableData.rowHeights.length - 1] || 44);
        tableData.cells.push(
          Array.from({ length: tableData.cols }, () => ({
            text: "",
            styles: {},
          })),
        );
      }, { fitElement: true });
    });
  document
    .getElementById("prop-table-remove-row")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        if (tableData.rows <= 1) return;
        tableData.rows -= 1;
        tableData.cells = tableData.cells.slice(0, tableData.rows);
        tableData.rowHeights = tableData.rowHeights.slice(
          0,
          tableData.rows,
        );
        tableData.selection = null;
      }, { fitElement: true });
    });
  document
    .getElementById("prop-table-add-col")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        tableData.cols += 1;
        tableData.colWidths.push(tableData.colWidths[tableData.colWidths.length - 1] || 140);
        tableData.cells.forEach((row, rowIndex) => {
          row.push({
            text: rowIndex === 0 ? `Header ${tableData.cols}` : "",
            styles: {},
          });
        });
      }, { fitElement: true });
    });
  document
    .getElementById("prop-table-remove-col")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        if (tableData.cols <= 1) return;
        tableData.cols -= 1;
        tableData.cells = tableData.cells.map((row) =>
          row.slice(0, tableData.cols),
        );
        tableData.colWidths = tableData.colWidths.slice(
          0,
          tableData.cols,
        );
        tableData.selection = null;
      }, { fitElement: true });
    });
  const bindTableValue = (id, key, normalize = (value) => value) => {
    const input = document.getElementById(id);
    if (!input) return;
    const commit = () =>
      mutateSelectedTableData((tableData) => {
        tableData[key] = normalize(input.value);
      });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  };
  bindTableValue("prop-table-border-color", "borderColor", (value) =>
    _normalizeColorForInput(value, "#cbd5e1"),
  );
  bindTableValue("prop-table-border-width", "borderWidth", (value) =>
    Math.max(0, Number(value) || 0),
  );
  bindTableValue("prop-table-header-fill", "headerFill", (value) =>
    _normalizeColorForInput(value, "#e2e8f0"),
  );
  bindTableValue("prop-table-body-fill", "bodyFill", (value) =>
    _normalizeColorForInput(value, "#ffffff"),
  );
  bindTableValue("prop-table-alt-fill", "altFill", (value) =>
    _normalizeColorForInput(value, "#f8fafc"),
  );
  bindTableValue("prop-table-padding", "cellPadding", (value) =>
    Math.max(2, Number(value) || 2),
  );
  bindTableValue("prop-table-text-color", "textColor", (value) =>
    _normalizeColorForInput(value, "#172033"),
  );
  bindTableValue(
    "prop-table-header-text-color",
    "headerTextColor",
    (value) => _normalizeColorForInput(value, "#172033"),
  );
  document
    .getElementById("prop-table-header-row")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        tableData.headerRow = !tableData.headerRow;
      });
    });
  document
    .getElementById("prop-table-zebra")
    ?.addEventListener("click", () => {
      mutateSelectedTableData((tableData) => {
        tableData.zebra = !tableData.zebra;
      });
    });
}

// A column's width as drawn: the stored widths are shares of the table's box.
function _tableColumnBoxWidth(tableData, element, col) {
  const widths = tableData.colWidths.map((width) => Math.max(36, Number(width) || 140));
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  const box = parseFloat(element?.width) || total;
  return (widths[col] || 0) * (box / total);
}
