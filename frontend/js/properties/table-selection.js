// Properties panel: table cell/row/column selection.

// The grid is drawn stretched to fill the table's box, so a 240px-tall box can hold rows stored as 3 x 44px.
// Scale the stored sizes to the box first; refitting the box to the stored grid made the table shrink.
function _matchTableGridToBox(tableData, element) {
  const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
  const boxW = parseFloat(element.width);
  const boxH = parseFloat(element.height);
  const gridW = sum(tableData.colWidths);
  const gridH = sum(tableData.rowHeights);
  if (boxW > 0 && gridW > 0 && Math.abs(boxW - gridW) > 1) {
    tableData.colWidths = tableData.colWidths.map((value) => (Number(value) || 0) * (boxW / gridW));
  }
  if (boxH > 0 && gridH > 0 && Math.abs(boxH - gridH) > 1) {
    tableData.rowHeights = tableData.rowHeights.map((value) => (Number(value) || 0) * (boxH / gridH));
  }
}

// fitElement: after rows or columns are added or removed, the table's box follows its grid (a new column was cut
// off by the old box). A grid that would run off the slide or into the footer is scaled down to fit instead.
function mutateSelectedTableData(mutator, { fitElement = false } = {}) {
  const data = getSelectedElementData();
  if (!data || data.type !== "table") return;
  saveStateToUndo();
  const nextTableData = normalizeTableData(data.tableData);
  if (fitElement) _matchTableGridToBox(nextTableData, data);
  mutator(nextTableData);
  const normalized = normalizeTableData(nextTableData);
  const patch = { tableData: normalized };
  if (fitElement) {
    const page = typeof getPresentationPageSetupConfig === "function" ? getPresentationPageSetupConfig() : {};
    const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
    const maxW = Math.max(120, (Number(page.width) || 1024) - (parseFloat(data.x) || 0) - 40);
    const maxH = Math.max(80, (Number(page.height) || 768) - (parseFloat(data.y) || 0) - 70);
    const scaleW = Math.min(1, maxW / Math.max(1, sum(normalized.colWidths)));
    const scaleH = Math.min(1, maxH / Math.max(1, sum(normalized.rowHeights)));
    normalized.colWidths = normalized.colWidths.map((value) => Math.max(36, Math.floor(value * scaleW)));
    normalized.rowHeights = normalized.rowHeights.map((value) => Math.max(24, Math.floor(value * scaleH)));
    patch.width = `${sum(normalized.colWidths)}px`;
    patch.height = `${sum(normalized.rowHeights)}px`;
    data.width = patch.width;
    data.height = patch.height;
  }
  updateElementState(data.id, patch);
  data.tableData = normalized;
  if (window.renderSlidesFromState) window.renderSlidesFromState();
  buildPropertiesPanel();
}

function setSelectedTablePart(tableId, selection) {
  const data = state.slides[currentSlideIndex]?.elements?.find(
    (e) => e.id === tableId,
  );
  if (!data || data.type !== "table") return;
  const tableData = normalizeTableData(data.tableData);
  tableData.selection = selection || null;
  updateElementState(tableId, { tableData });
  data.tableData = tableData;
  selectElement(tableId, "replace");
  syncTableDomSelection(tableId, tableData.selection);
  buildPropertiesPanel();
}

function syncTableDomSelection(tableId, selection = null) {
  const dom = document.getElementById(tableId);
  if (!dom) return;
  dom.querySelectorAll(".table-element-cell").forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    cell.classList.toggle(
      "is-active",
      selection?.type === "cell" &&
        selection.row === row &&
        selection.col === col,
    );
    cell.classList.toggle(
      "is-row-selected",
      selection?.type === "row" && selection.row === row,
    );
    cell.classList.toggle(
      "is-col-selected",
      selection?.type === "col" && selection.col === col,
    );
  });
}

function clearTablePartSelections() {
  document
    .querySelectorAll(
      ".table-element-cell.is-active, .table-element-cell.is-row-selected, .table-element-cell.is-col-selected",
    )
    .forEach((node) =>
      node.classList.remove("is-active", "is-row-selected", "is-col-selected"),
    );
}
