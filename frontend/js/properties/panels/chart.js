// Properties panel section for charts: type, series name and the data itself (one row per label and value).
// Double-clicking a chart on the slide opens it (see openChartEditor).

// Colours and Chart.js settings live in js/editor/render/chart-config.js.

// The chart's data as the panel edits it: one label per row, one column of values per series.
function _chartTable(data) {
  const labels = (data.chartData?.labels || []).map((label) => String(label ?? ""));
  const datasets = data.chartData?.datasets?.length ? data.chartData.datasets : [{ label: "Series 1", data: [] }];
  const rows = Math.max(labels.length, ...datasets.map((d) => (d.data || []).length), 1);
  return {
    labels: Array.from({ length: rows }, (_, i) => labels[i] ?? ""),
    series: datasets.map((dataset, index) => ({
      name: String(dataset.label ?? `Series ${index + 1}`),
      values: Array.from({ length: rows }, (_, i) => dataset.data?.[i] ?? ""),
    })),
  };
}

function _chartColorInput(value) {
  return typeof _normalizeColorForInput === "function" ? _normalizeColorForInput(value, "#4f7cff") : value;
}

function buildChartPanel(panel, data) {
  const group = createGroup("Chart Data");
  const chartType = data.chartType || "bar";
  const round = chartType === "pie" || chartType === "doughnut";
  const table = _chartTable(data);
  const types = [["bar", "Bar"], ["line", "Line"], ["pie", "Pie"], ["doughnut", "Doughnut"]];
  const palette = typeof chartCategoryPalette === "function" ? chartCategoryPalette() : [];
  const picks = data.chartStyle?.seriesColors || [];
  const columns = `minmax(64px, 1.2fr) repeat(${table.series.length}, minmax(52px, 1fr)) 18px`;
  group.innerHTML += `
    <div class="chart-editor" data-chart-id="${escapeHtml(data.id)}">
      <div class="chart-editor-row">
        <label class="chart-editor-field">
          <span>Type</span>
          <select id="prop-chart-type" class="prop-select">
            ${types.map(([value, label]) => `<option value="${value}" ${value === chartType ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="chart-editor-grid" style="grid-template-columns:${columns}">
        <span class="chart-editor-corner">Label</span>
        ${table.series
          .map(
            (series, index) => `
          <div class="chart-series-head" data-series="${index}">
            <input type="text" class="prop-input-sm chart-series-name" value="${escapeHtml(series.name)}" aria-label="Series ${index + 1} name">
            <div class="chart-series-tools">
              ${round ? "" : `<input type="color" class="chart-series-color" value="${_chartColorInput(picks[index] || palette[index % (palette.length || 1)] || "#4f7cff")}" title="Colour of this series" aria-label="Series ${index + 1} colour">`}
              ${table.series.length > 1 ? `<button type="button" class="chart-series-remove" title="Remove this series" aria-label="Remove series ${index + 1}"><i class="fa-solid fa-xmark"></i></button>` : ""}
            </div>
          </div>`,
          )
          .join("")}
        <span></span>
        ${table.labels
          .map(
            (label, row) => `
          <input type="text" class="prop-input-sm chart-row-label" data-row="${row}" value="${escapeHtml(label)}" aria-label="Label ${row + 1}">
          ${table.series
            .map(
              (series, index) => `<input type="number" step="any" class="prop-input-sm chart-row-value" data-row="${row}" data-series="${index}" value="${escapeHtml(String(series.values[row]))}" aria-label="${escapeHtml(series.name)}, row ${row + 1}">`,
            )
            .join("")}
          <button type="button" class="chart-row-remove" data-row="${row}" tabindex="-1" title="Remove this row" aria-label="Remove row ${row + 1}"><i class="fa-solid fa-xmark"></i></button>`,
          )
          .join("")}
      </div>
      <div class="chart-editor-actions">
        <button type="button" id="prop-chart-add-row" class="chart-editor-add"><i class="fa-solid fa-plus"></i> Row</button>
        ${round ? "" : `<button type="button" id="prop-chart-add-series" class="chart-editor-add"><i class="fa-solid fa-plus"></i> Series</button>`}
      </div>
      <p class="chart-editor-hint">Tip: paste a block copied from a spreadsheet into a label box: the first column becomes the labels, the others the series (a header row names them).</p>
    </div>`;
  panel.appendChild(group);
  panel.appendChild(_buildChartStyleGroup(data, round));
  _bindChartPanel(group, data);
  _bindChartStyleGroup(data);
}

function _buildChartStyleGroup(data, round) {
  const style = data.chartStyle || {};
  const group = createGroup("Chart Style");
  const bg = String(data.styles?.backgroundColor || "");
  const theme = getPresentationTheme();
  const backgroundMode = !bg || bg === "transparent" ? "none" : bg.toLowerCase() === "#ffffff" ? "white" : "theme";
  group.innerHTML += `
    <div class="chart-style-grid">
      <label class="chart-editor-field">
        <span>Legend</span>
        <select id="prop-chart-legend" class="prop-select">
          ${[["top", "Top"], ["bottom", "Bottom"], ["right", "Right"], ["none", "Hidden"]].map(([v, l]) => `<option value="${v}" ${(style.legend || "top") === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </label>
      <label class="chart-editor-field">
        <span>Text size</span>
        <input type="number" id="prop-chart-font-size" class="prop-input-sm" min="8" max="40" value="${Number(style.fontSize) || 12}">
      </label>
      <label class="chart-editor-field chart-style-wide">
        <span>Title</span>
        <input type="text" id="prop-chart-title" class="prop-input-sm" value="${escapeHtml(style.title || "")}" placeholder="None">
      </label>
      ${round ? "" : `
      <label class="chart-editor-field">
        <span>X axis title</span>
        <input type="text" id="prop-chart-x-title" class="prop-input-sm" value="${escapeHtml(style.xTitle || "")}" placeholder="None">
      </label>
      <label class="chart-editor-field">
        <span>Y axis title</span>
        <input type="text" id="prop-chart-y-title" class="prop-input-sm" value="${escapeHtml(style.yTitle || "")}" placeholder="None">
      </label>`}
      <label class="chart-editor-field">
        <span>Background</span>
        <select id="prop-chart-background" class="prop-select">
          <option value="theme" ${backgroundMode === "theme" ? "selected" : ""}>Theme card</option>
          <option value="white" ${backgroundMode === "white" ? "selected" : ""}>White card</option>
          <option value="none" ${backgroundMode === "none" ? "selected" : ""}>None</option>
        </select>
      </label>
      ${round ? "" : `
      <label class="chart-style-check">
        <input type="checkbox" id="prop-chart-grid" ${style.grid === false ? "" : "checked"}>
        <span>Grid lines</span>
      </label>`}
    </div>`;
  group.dataset.themeSurface = theme.surfaceColor || "";
  return group;
}

function _commitChartStyle(data, patch, { stylesPatch = null } = {}) {
  saveStateToUndo();
  const live = getSelectedElementData() || data;
  const chartStyle = { ...(live.chartStyle || {}), ...patch };
  const updates = { chartStyle };
  if (stylesPatch) updates.styles = { ...(live.styles || {}), ...stylesPatch };
  updateElementState(live.id, updates);
  Object.assign(live, updates);
  if (patch.seriesColors) applyChartSeriesColors(live);
  renderSlidesFromState();
  window.refreshPreviews?.();
  schedulePresentationAutosave?.(150);
}

function _bindChartStyleGroup(data) {
  const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);
  on("prop-chart-legend", "change", (e) => _commitChartStyle(data, { legend: e.target.value }));
  on("prop-chart-font-size", "change", (e) => _commitChartStyle(data, { fontSize: Math.max(8, Math.min(40, Number(e.target.value) || 12)) }));
  on("prop-chart-title", "change", (e) => _commitChartStyle(data, { title: e.target.value.trim() }));
  on("prop-chart-x-title", "change", (e) => _commitChartStyle(data, { xTitle: e.target.value.trim() }));
  on("prop-chart-y-title", "change", (e) => _commitChartStyle(data, { yTitle: e.target.value.trim() }));
  on("prop-chart-grid", "change", (e) => _commitChartStyle(data, { grid: e.target.checked }));
  on("prop-chart-background", "change", (e) => {
    const theme = getPresentationTheme();
    const backgroundColor = e.target.value === "white" ? "#ffffff" : e.target.value === "none" ? "transparent" : theme.surfaceColor || "#ffffff";
    _commitChartStyle(data, {}, { stylesPatch: { backgroundColor, boxShadow: e.target.value === "none" ? "none" : "0 4px 12px rgba(0,0,0,0.05)" } });
  });
}

function _bindChartPanel(group, data) {
  const read = () => {
    const labels = [...group.querySelectorAll(".chart-row-label")].map((input) => input.value);
    const names = [...group.querySelectorAll(".chart-series-name")].map((input) => input.value);
    const values = names.map((_, series) =>
      labels.map((_, row) => {
        const input = group.querySelector(`.chart-row-value[data-row="${row}"][data-series="${series}"]`);
        return Number(input?.value) || 0;
      }),
    );
    return { labels, series: names.map((name, index) => ({ name, values: values[index] })) };
  };
  // Writes the panel's table to the chart. The panel is only rebuilt when rows or series are added or removed, so
  // typing in a box never loses the caret.
  const commit = (table = read(), { rebuild = false, seriesColors = null } = {}) => {
    const chartType = group.querySelector("#prop-chart-type").value;
    const previous = data.chartData?.datasets || [];
    const datasets = table.series.map((series, index) => ({
      ...(previous[index] || {}),
      label: series.name,
      data: series.values.map((value) => Number(value) || 0),
      borderWidth: chartType === "line" ? 2 : 1,
    }));
    const chartData = { ...(data.chartData || {}), labels: table.labels, datasets };
    saveStateToUndo();
    const chartStyle = seriesColors ? { ...(data.chartStyle || {}), seriesColors } : data.chartStyle;
    updateElementState(data.id, { chartType, chartData, ...(chartStyle ? { chartStyle } : {}) });
    data.chartType = chartType;
    data.chartData = chartData;
    if (chartStyle) data.chartStyle = chartStyle;
    applyChartSeriesColors(data);
    updateElementState(data.id, { chartData: data.chartData });
    // Only the chart is redrawn: a full slide render rebuilds this panel and takes the caret out of the box.
    const node = [...document.querySelectorAll(`[id="${data.id}"]`)].find((el) => !el.closest("#slide-previews"));
    if (!node || !_redrawChart(node, data)) renderSlidesFromState();
    window.refreshPreviews?.();
    if (typeof schedulePresentationAutosave === "function") schedulePresentationAutosave();
    if (rebuild) buildPropertiesPanel();
  };

  // Ctrl+Z / Ctrl+Y in these boxes undo and redo the chart change itself. The browser's own text undo would put
  // old text back into a box without changing the chart, and leaving the box would then save that old text.
  group.querySelector(".chart-editor").addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || (key !== "z" && key !== "y")) return;
    event.preventDefault();
    event.stopPropagation();
    const field = document.activeElement;
    if (field?.matches?.("input") && field.value !== field.defaultValue) {
      field.dispatchEvent(new Event("change", { bubbles: true })); // keep what is being typed as its own step
    }
    if (key === "y" || event.shiftKey) redo();
    else undo();
    buildPropertiesPanel();
  });

  group.querySelector("#prop-chart-type").addEventListener("change", () => commit(read(), { rebuild: true }));
  group.querySelectorAll(".chart-series-name, .chart-row-label, .chart-row-value").forEach((input) => {
    input.addEventListener("change", () => commit());
  });
  group.querySelectorAll(".chart-row-label, .chart-row-value").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      // Enter goes down the column like a spreadsheet; from the last row it adds one.
      const row = Number(input.dataset.row);
      const selector = input.classList.contains("chart-row-label")
        ? `.chart-row-label[data-row="${row + 1}"]`
        : `.chart-row-value[data-row="${row + 1}"][data-series="${input.dataset.series}"]`;
      const next = group.querySelector(selector);
      if (next) {
        next.focus();
        next.select();
      } else {
        const table = read();
        table.labels.push("");
        table.series.forEach((series) => series.values.push(0));
        commit(table, { rebuild: true });
        _focusChartRow(-1);
      }
    });
  });
  group.querySelectorAll(".chart-series-color").forEach((input, index) => {
    input.addEventListener("change", () => {
      // Only this series becomes the user's colour; the others keep following the theme.
      const picks = [...(data.chartStyle?.seriesColors || [])];
      picks[index] = input.value;
      commit(read(), { seriesColors: Array.from(picks, (pick) => pick || null) });
    });
  });
  group.querySelectorAll(".chart-row-label").forEach((input) => {
    input.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain") || "";
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const cells = lines.map((line) => line.split(/\t|,(?=\s*-?[\d.])/).map((cell) => cell.trim()));
      if (cells.length < 2 || cells[0].length < 2) return; // ordinary text: let it paste into the box
      const numeric = (cell) => cell !== undefined && cell !== "" && Number.isFinite(Number(String(cell).replace(/[%\s]/g, "")));
      const hasHeader = cells[0].slice(1).some((cell) => !numeric(cell));
      const body = hasHeader ? cells.slice(1) : cells;
      const width = Math.max(...body.map((row) => row.length));
      if (!body.length || width < 2 || !body.every((row) => row.slice(1).every((cell) => cell === "" || numeric(cell)))) return;
      event.preventDefault();
      const current = read();
      const seriesCount = width - 1;
      const table = {
        labels: body.map((row) => row[0]),
        series: Array.from({ length: seriesCount }, (_, index) => ({
          name: hasHeader ? cells[0][index + 1] || `Series ${index + 1}` : current.series[index]?.name || `Series ${index + 1}`,
          values: body.map((row) => Number(String(row[index + 1] ?? "0").replace(/[%\s]/g, "")) || 0),
        })),
      };
      commit(table, { rebuild: true });
    });
  });
  group.querySelectorAll(".chart-row-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.row);
      const table = read();
      if (table.labels.length <= 1) return;
      table.labels.splice(index, 1);
      table.series.forEach((series) => series.values.splice(index, 1));
      commit(table, { rebuild: true });
    });
  });
  group.querySelectorAll(".chart-series-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.closest(".chart-series-head").dataset.series);
      const table = read();
      if (table.series.length <= 1) return;
      table.series.splice(index, 1);
      const picks = (data.chartStyle?.seriesColors || []).filter((_, i) => i !== index);
      commit(table, { rebuild: true, seriesColors: picks });
    });
  });
  group.querySelector("#prop-chart-add-row")?.addEventListener("click", () => {
    const table = read();
    table.labels.push("");
    table.series.forEach((series) => series.values.push(0));
    commit(table, { rebuild: true });
    _focusChartRow(-1);
  });
  group.querySelector("#prop-chart-add-series")?.addEventListener("click", () => {
    const table = read();
    table.series.push({ name: `Series ${table.series.length + 1}`, values: table.labels.map(() => 0) });
    commit(table, { rebuild: true });
  });
}

// Draws the chart again in place (new canvas, same element), leaving the element's handles alone.
function _redrawChart(node, data) {
  const canvas = node.querySelector(":scope > canvas");
  if (!canvas || typeof Chart === "undefined") return false;
  node._chartInstance?.destroy();
  const fresh = document.createElement("canvas");
  fresh.style.width = "100%";
  fresh.style.height = "100%";
  canvas.replaceWith(fresh);
  try {
    node._chartInstance = new Chart(fresh, buildChartJsConfig(data));
  } catch (error) {
    console.error("Chart.js Error:", error);
    return false;
  }
  return true;
}

function _focusChartRow(index) {
  requestAnimationFrame(() => {
    const labels = document.querySelectorAll(".chart-editor-grid .chart-row-label");
    labels[index < 0 ? labels.length + index : index]?.focus();
  });
}

// Double-click on a chart: the Properties panel opens on its data.
function openChartEditor(elementId) {
  if (document.body.classList.contains("play-mode-active")) return;
  selectElement(elementId, "replace");
  const panel = document.getElementById("properties-panel");
  if (panel?.classList.contains("hidden") && typeof togglePropertiesPanel === "function") togglePropertiesPanel();
  if (typeof _propertiesPanelActiveTab !== "undefined") _propertiesPanelActiveTab = "content";
  buildPropertiesPanel();
  const opener = document.activeElement;
  requestAnimationFrame(() => {
    // Only if focus is still where it was: a dialog opened in the meantime kept losing its first keystrokes here.
    const current = document.activeElement;
    if (current && current !== opener && current !== document.body) return;
    const first = document.querySelector(".chart-editor-grid .chart-row-label");
    first?.focus();
    first?.select();
  });
}
