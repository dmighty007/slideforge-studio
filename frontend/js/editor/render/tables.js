// Table element rendering, selection controls and resize handles.

function _tableColumnPercents(colWidths) {
  const widths = (colWidths || []).map((width) => Math.max(36, Number(width) || 140));
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  return widths.map((width) => Number(((width / total) * 100).toFixed(4)));
}

function _getTableCellDisplayStyles(
  tableData,
  rowIndex,
  colIndex,
  cellStyles = {},
) {
  const isHeader = tableData.headerRow && rowIndex === 0;
  const zebraFill =
    tableData.zebra && !isHeader && rowIndex % 2 === 1
      ? tableData.altFill
      : tableData.bodyFill;
  return {
    backgroundColor:
      cellStyles.backgroundColor ||
      (isHeader ? tableData.headerFill : zebraFill),
    color:
      cellStyles.color ||
      (isHeader ? tableData.headerTextColor : tableData.textColor),
    fontFamily:
      cellStyles.fontFamily || tableData.fontFamily || '"Manrope", sans-serif',
    fontSize: cellStyles.fontSize || tableData.fontSize || "16px",
    fontStyle: cellStyles.fontStyle || tableData.fontStyle || "normal",
    textAlign: cellStyles.textAlign || tableData.textAlign || "left",
    fontWeight:
      cellStyles.fontWeight ||
      (isHeader ? "700" : tableData.fontWeight || "400"),
  };
}

function _renderTableDom(container, elData, { interactive = true } = {}) {
  const tableData = normalizeTableData(elData.tableData);
  elData.tableData = tableData;
  container.innerHTML = "";

  const beginTableCellEdit = (
    cell,
    rowIndex,
    colIndex,
    { preserveSelection = false } = {},
  ) => {
    if (!interactive || document.body.classList.contains("play-mode-active"))
      return;
    const host = container.closest(".canvas-element");
    setSelectedTablePart?.(elData.id, {
      type: "cell",
      row: rowIndex,
      col: colIndex,
    });
    if (cell.contentEditable === "true") {
      if (preserveSelection) {
        requestAnimationFrame(() => cell.focus());
      }
      return;
    }
    cell.dataset.previousText = cell.innerText.replace(/\r/g, "");
    cell.contentEditable = "true";
    cell.spellcheck = true;
    host?.classList.add("editing-table");
    cell.classList.add("is-editing");
    if (host) {
      interact(host).draggable(false);
      interact(host).resizable(false);
    }
    requestAnimationFrame(() => {
      if (preserveSelection) {
        cell.focus();
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      cell.focus();
    });
  };

  const commitTableCellEdit = (
    cell,
    rowIndex,
    colIndex,
    { revert = false } = {},
  ) => {
    if (!cell.isContentEditable) return;
    const host = container.closest(".canvas-element");
    const nextTableData = normalizeTableData(elData.tableData);
    const previousText = nextTableData.cells[rowIndex][colIndex]?.text || "";
    const nextText = revert
      ? cell.dataset.previousText || previousText
      : cell.innerText.replace(/\r/g, "");

    if (nextText !== previousText) {
      saveStateToUndo();
      nextTableData.cells[rowIndex][colIndex].text = nextText;
      updateElementState(elData.id, { tableData: nextTableData });
      elData.tableData = nextTableData;
    }

    cell.textContent = nextText;
    cell.contentEditable = "false";
    cell.removeAttribute("spellcheck");
    cell.classList.remove("is-editing");
    delete cell.dataset.previousText;
    host?.classList.remove("editing-table");
    if (host) {
      interact(host).draggable(true);
      interact(host).resizable(true);
    }
    if (typeof schedulePresentationAutosave === "function") {
      schedulePresentationAutosave();
    }
    if (window.refreshPreviews) {
      window.refreshPreviews();
    }
  };

  const shell = document.createElement("div");
  shell.className = "table-element-shell";
  const scroll = document.createElement("div");
  scroll.className = "table-element-scroll";
  const table = document.createElement("table");
  table.className = "table-element-grid";
  table.style.borderCollapse = "collapse";
  table.style.width = "100%";
  table.style.height = "100%";
  table.style.tableLayout = "fixed";
  // Columns are shares of the table's width, so the grid always fills its box: in pixels, four 140px columns
  // in a 520px box cut the last column off, and resizing the box never resized the columns.
  const colgroup = document.createElement("colgroup");
  _tableColumnPercents(tableData.colWidths).forEach((percent) => {
    const col = document.createElement("col");
    col.style.width = `${percent}%`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement("tbody");
  for (let rowIndex = 0; rowIndex < tableData.rows; rowIndex += 1) {
    const tr = document.createElement("tr");
    tr.style.height = `${Math.max(24, Number(tableData.rowHeights[rowIndex]) || 44)}px`;
    for (let colIndex = 0; colIndex < tableData.cols; colIndex += 1) {
      const cellData = tableData.cells[rowIndex]?.[colIndex] || {
        text: "",
        styles: {},
      };
      const cell = document.createElement(
        rowIndex === 0 && tableData.headerRow ? "th" : "td",
      );
      cell.className = "table-element-cell";
      cell.dataset.row = String(rowIndex);
      cell.dataset.col = String(colIndex);
      const selection = tableData.selection;
      const isSelectedCell =
        selection?.type === "cell" &&
        selection.row === rowIndex &&
        selection.col === colIndex;
      const isSelectedRow =
        selection?.type === "row" && selection.row === rowIndex;
      const isSelectedCol =
        selection?.type === "col" && selection.col === colIndex;
      cell.classList.toggle("is-active", isSelectedCell);
      cell.classList.toggle("is-row-selected", isSelectedRow);
      cell.classList.toggle("is-col-selected", isSelectedCol);
      const cellStyles = _getTableCellDisplayStyles(
        tableData,
        rowIndex,
        colIndex,
        cellData.styles || {},
      );
      cell.style.border = `${tableData.borderWidth}px solid ${tableData.borderColor}`;
      cell.style.padding = `${tableData.cellPadding}px`;
      cell.style.backgroundColor = cellStyles.backgroundColor;
      cell.style.color = cellStyles.color;
      cell.style.fontFamily = cellStyles.fontFamily;
      cell.style.fontSize = cellStyles.fontSize;
      cell.style.fontStyle = cellStyles.fontStyle;
      cell.style.textAlign = cellStyles.textAlign;
      cell.style.fontWeight = cellStyles.fontWeight;
      cell.style.verticalAlign = "top";
      cell.style.whiteSpace = "pre-wrap";
      cell.textContent = cellData.text || "";

      if (interactive) {
        cell.addEventListener("mousedown", (e) => {
          if (cell.isContentEditable) {
            e.stopPropagation();
          }
        });
        cell.addEventListener("click", (e) => {
          if (document.body.classList.contains("play-mode-active")) return;
          e.stopPropagation();
          const alreadySelected =
            tableData.selection?.type === "cell" &&
            tableData.selection.row === rowIndex &&
            tableData.selection.col === colIndex;
          setSelectedTablePart?.(elData.id, {
            type: "cell",
            row: rowIndex,
            col: colIndex,
          });
          if (alreadySelected && cell.contentEditable !== "true") {
            beginTableCellEdit(cell, rowIndex, colIndex, {
              preserveSelection: true,
            });
          }
        });
        cell.addEventListener("dblclick", (e) => {
          if (document.body.classList.contains("play-mode-active")) return;
          if (cell.contentEditable === "true") return;
          e.preventDefault();
          e.stopPropagation();
          beginTableCellEdit(cell, rowIndex, colIndex, {
            preserveSelection: true,
          });
        });
        cell.addEventListener("beforeinput", (e) => {
          if (!cell.isContentEditable) return;
          if (e.inputType === "insertParagraph") {
            e.preventDefault();
            document.execCommand?.("insertLineBreak");
          }
        });
        cell.addEventListener("paste", (e) => {
          if (!cell.isContentEditable) return;
          const plainText = e.clipboardData?.getData("text/plain");
          if (typeof plainText !== "string") return;
          e.preventDefault();
          const normalizedText = plainText.replace(/\r\n?/g, "\n");
          const inserted = document.execCommand?.(
            "insertText",
            false,
            normalizedText,
          );
          if (!inserted) {
            const selection = window.getSelection?.();
            if (selection && selection.rangeCount) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              const node = document.createTextNode(normalizedText);
              range.insertNode(node);
              range.setStartAfter(node);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        });
        cell.addEventListener("keydown", (e) => {
          if (!cell.isContentEditable) return;
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "enter") {
            e.preventDefault();
            commitTableCellEdit(cell, rowIndex, colIndex);
          } else if (e.key === "Escape") {
            // Keeps what was typed, like text boxes (and PowerPoint); Ctrl+Z takes it back.
            e.preventDefault();
            commitTableCellEdit(cell, rowIndex, colIndex);
          } else if (e.key === "Tab") {
            // Next or previous cell, row by row, as in PowerPoint and Word. Left to the browser, Tab moved focus
            // out of the table and the next words typed were lost.
            e.preventDefault();
            const rows = tableData.cells.length;
            const cols = tableData.cells[0]?.length || 1;
            const next = rowIndex * cols + colIndex + (e.shiftKey ? -1 : 1);
            commitTableCellEdit(cell, rowIndex, colIndex);
            if (next < 0 || next >= rows * cols) return;
            _editTableCellAt(elData.id, Math.floor(next / cols), next % cols);
          }
        });
        cell.addEventListener("blur", () => {
          commitTableCellEdit(cell, rowIndex, colIndex);
        });
      }

      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  shell.appendChild(scroll);
  container.appendChild(shell);
  if (interactive) {
    requestAnimationFrame(() =>
      _renderTableSelectionControls(shell, table, elData),
    );
  }
}

// Starts editing a cell of the table on the canvas with its text selected, so typing replaces it. Done at once, not
// on the next frame: keys typed straight after Tab would otherwise land nowhere.
function _editTableCellAt(elementId, row, col) {
  const host = [...document.querySelectorAll(`[id="${elementId}"]`)].find(
    (node) => !node.closest("#slide-previews"),
  );
  const cell = host?.querySelector(`.table-element-cell[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;
  cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  if (!cell.isContentEditable) return;
  cell.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function _renderTableSelectionControls(shell, table, elData) {
  if (!shell || !table || !elData) return;
  shell.querySelector(".table-selection-layer")?.remove();
  const tableData = normalizeTableData(elData.tableData);
  const layer = document.createElement("div");
  layer.className = "table-selection-layer";
  const shellRect = shell.getBoundingClientRect();
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const firstRowCells = Array.from(
    table.querySelectorAll(
      "tbody tr:first-child > th, tbody tr:first-child > td",
    ),
  );

  firstRowCells.forEach((cell, colIndex) => {
    const rect = cell.getBoundingClientRect();
    const left = rect.left - shellRect.left;
    const width = rect.width;
    const selector = document.createElement("button");
    selector.className = "table-col-selector";
    selector.style.left = `${left}px`;
    selector.style.width = `${width}px`;
    selector.title = `Select column ${colIndex + 1}`;
    selector.addEventListener("mousedown", (event) => event.stopPropagation());
    selector.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedTablePart?.(elData.id, { type: "col", col: colIndex });
    });
    layer.appendChild(selector);

    if (colIndex < firstRowCells.length - 1) {
      const resizer = document.createElement("div");
      resizer.className = "table-col-resizer";
      resizer.style.left = `${left + width}px`;
      resizer.title = "Resize column";
      _bindTableResizeHandle(resizer, "col", colIndex, table, elData);
      layer.appendChild(resizer);
    }
  });

  rows.forEach((row, rowIndex) => {
    const rect = row.getBoundingClientRect();
    const top = rect.top - shellRect.top;
    const height = rect.height;
    const selector = document.createElement("button");
    selector.className = "table-row-selector";
    selector.style.top = `${top}px`;
    selector.style.height = `${height}px`;
    selector.title = `Select row ${rowIndex + 1}`;
    selector.addEventListener("mousedown", (event) => event.stopPropagation());
    selector.addEventListener("click", (event) => {
      event.stopPropagation();
      setSelectedTablePart?.(elData.id, { type: "row", row: rowIndex });
    });
    layer.appendChild(selector);

    if (rowIndex < rows.length - 1) {
      const resizer = document.createElement("div");
      resizer.className = "table-row-resizer";
      resizer.style.top = `${top + height}px`;
      resizer.title = "Resize row";
      _bindTableResizeHandle(resizer, "row", rowIndex, table, elData);
      layer.appendChild(resizer);
    }
  });

  shell.appendChild(layer);
}

function _bindTableResizeHandle(handle, axis, index, table, elData) {
  handle.addEventListener("mousedown", (event) => {
    if (document.body.classList.contains("play-mode-active")) return;
    event.preventDefault();
    event.stopPropagation();
    const tableData = normalizeTableData(elData.tableData);
    const start = axis === "col" ? event.clientX : event.clientY;
    const initial =
      axis === "col" ? tableData.colWidths[index] : tableData.rowHeights[index];
    const host = table.closest(".canvas-element");
    host?.classList.add("editing-table");
    if (host) {
      interact(host).draggable(false);
      interact(host).resizable(false);
    }

    // A column is dragged in the box's own pixels (the stored widths are shares of the box), and the box grows or
    // shrinks with it, so the other columns keep their size.
    const scale = typeof getCanvasScale === "function" ? getCanvasScale() || 1 : 1;
    const boxWidth = parseFloat(elData.width) || 0;
    const storedTotal = tableData.colWidths.reduce((sum, width) => sum + Math.max(36, Number(width) || 140), 0) || 1;
    const boxColumns = tableData.colWidths.map((width) => (Math.max(36, Number(width) || 140) * (boxWidth || storedTotal)) / storedTotal);
    const columnsFor = (delta) => {
      const columns = [...boxColumns];
      columns[index] = Math.max(36, Math.round(boxColumns[index] + delta / scale));
      return columns.map((width) => Math.round(width));
    };

    const onMove = (moveEvent) => {
      const delta =
        (axis === "col" ? moveEvent.clientX : moveEvent.clientY) - start;
      if (axis === "col") {
        const columns = columnsFor(delta);
        table.querySelectorAll("col").forEach((col, i) => (col.style.width = `${_tableColumnPercents(columns)[i]}%`));
        if (host) host.style.width = `${columns.reduce((sum, width) => sum + width, 0)}px`;
      } else {
        const next = Math.max(24, Math.round(initial + delta));
        table.querySelectorAll("tbody tr")[index].style.height = `${next}px`;
      }
    };
    const onUp = (upEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const delta =
        (axis === "col" ? upEvent.clientX : upEvent.clientY) - start;
      const next = Math.max(
        axis === "col" ? 36 : 24,
        Math.round(initial + delta),
      );
      saveStateToUndo();
      const nextTableData = normalizeTableData(elData.tableData);
      if (axis === "col") {
        nextTableData.colWidths = columnsFor(delta);
        nextTableData.selection = { type: "col", col: index };
        const width = `${nextTableData.colWidths.reduce((sum, value) => sum + value, 0)}px`;
        updateElementState(elData.id, { width });
        elData.width = width;
      } else {
        nextTableData.rowHeights[index] = next;
        nextTableData.selection = { type: "row", row: index };
      }
      updateElementState(elData.id, { tableData: nextTableData });
      elData.tableData = nextTableData;
      host?.classList.remove("editing-table");
      if (host) {
        interact(host).draggable(true);
        interact(host).resizable(true);
      }
      renderSlidesFromState?.();
      buildPropertiesPanel?.();
      refreshPreviews?.();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
