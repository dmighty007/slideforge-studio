// Properties panel section for plugin objects: built from the fields the plugin declares.

function _pluginFieldId(key) {
  return `prop-plugin-${key}`;
}

function _pluginFieldInput(field, value, { example = false } = {}) {
  const id = _pluginFieldId(field.key);
  const placeholder = escapeHtml(field.placeholder || "");
  if (field.type === "textarea") {
    return `<textarea id="${id}" rows="3" class="w-full text-xs font-mono" spellcheck="false" placeholder="${placeholder}">${escapeHtml(value ?? "")}</textarea>`;
  }
  if (field.type === "table") {
    const columns = field.columns.length
      ? `<div class="plugin-table-columns">${field.columns.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
      : "";
    // The plugin's sample data is labelled as such, with a way to clear it before pasting real data.
    const exampleTag = example
      ? `<div class="plugin-table-example"><span>Example data</span><button type="button" id="${id}-clear" class="plugin-table-load">Clear</button></div>`
      : "";
    return `${columns}${exampleTag}<textarea id="${id}" rows="${field.rows || 6}" class="w-full text-xs font-mono plugin-table-input" spellcheck="false" wrap="off" placeholder="${placeholder}">${escapeHtml(value ?? "")}</textarea>
      <div class="plugin-table-footer">
        <span id="${id}-summary" class="plugin-table-summary">${escapeHtml(_pluginTableSummary(value, field))} · applied when you leave the box (Ctrl+Enter)</span>
        <span class="plugin-table-actions">
          <button type="button" id="${id}-expand" class="plugin-table-load" title="Edit the data in a larger box"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Expand</button>
          <button type="button" id="${id}-load" class="plugin-table-load" title="Load CSV or TSV from a file"><i class="fa-solid fa-file-csv"></i> Load CSV…</button>
        </span>
        <input type="file" id="${id}-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden>
      </div>`;
  }
  if (field.type === "number") {
    const attrs = ["min", "max", "step"]
      .filter((name) => field[name] !== undefined)
      .map((name) => `${name}="${escapeHtml(field[name])}"`)
      .join(" ");
    return `<input type="number" id="${id}" class="w-full text-xs" ${attrs} value="${escapeHtml(value ?? "")}">`;
  }
  if (field.type === "color") {
    // An empty colour means "follow the theme": the swatch then shows the theme colour it follows.
    const auto = !value;
    const shown = auto && typeof _pluginThemeColor === "function" ? _pluginThemeColor() : value;
    return `<div class="flex items-center gap-2">
        <input type="color" id="${id}" class="h-8 w-12 cursor-pointer rounded bg-transparent p-0 border-none" value="${escapeHtml(shown || "#000000")}">
        ${
          field.allowAuto
            ? `<label class="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" id="${id}-auto" ${auto ? "checked" : ""}> Theme colour</label>`
            : ""
        }
      </div>`;
  }
  if (field.type === "checkbox") {
    return `<label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" id="${id}" ${value ? "checked" : ""}> ${escapeHtml(field.checkboxLabel || field.label)}</label>`;
  }
  if (field.type === "select") {
    const options = field.options
      .map((option) => `<option value="${escapeHtml(option.value)}" ${String(value) === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
      .join("");
    return `<select id="${id}" class="w-full">${options}</select>`;
  }
  return `<input type="text" id="${id}" class="w-full text-xs font-mono" spellcheck="false" autocomplete="off" placeholder="${placeholder}" value="${escapeHtml(value ?? "")}">`;
}

// "3 rows × 2 columns" for a table field, or the plugin's own account of the data ("5 genes × 4 samples, 1 missing
// value"; field.summarize(rows) may throw, as for data it cannot read).
function _pluginTableSummary(text, field = null) {
  const rows = typeof parsePluginTable === "function" ? parsePluginTable(text) : [];
  if (!rows.length) return "No rows yet";
  if (typeof field?.summarize === "function") {
    try {
      const own = field.summarize(rows);
      if (own) return String(own);
    } catch (_error) {}
  }
  const columns = Math.max(...rows.map((row) => row.length));
  return `${rows.length} ${rows.length === 1 ? "row" : "rows"} × ${columns} ${columns === 1 ? "column" : "columns"}`;
}

// Matches what a table field may hold (plugins.js SF_PLUGIN_MAX_TABLE_LENGTH), so a file is never cut short.
const SF_PLUGIN_TABLE_FILE_LIMIT = 60000;

function buildPluginPanel(panel, data) {
  const plugin = typeof getSlidePlugin === "function" ? getSlidePlugin(data.pluginId) : null;
  if (!plugin) {
    const group = createGroup("Plugin");
    group.innerHTML = `<p class="text-xs text-slate-600">${escapeHtml(pluginUnavailableReason(data.pluginId || "unknown"))} The object shows its last saved picture and can still be moved, resized and exported.</p>
      <button type="button" id="prop-plugin-manage" class="w-full py-2 rounded bg-accent/20 border border-accent/40 text-accent text-xs font-semibold"><i class="fa-solid fa-puzzle-piece mr-2"></i>Manage plugins</button>`;
    panel.appendChild(group);
    return;
  }
  const values = normalizePluginData(plugin, data.pluginData);
  const group = createGroup(plugin.name);
  const error = getPluginElementError(data.id);
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-3 plugin-panel";
  wrap.dataset.pluginId = plugin.id;
  // The data and its main choices first; settings the plugin marks advanced (text size, colours, display details)
  // fold under "More options": some plugins' panels were 1,400px of settings, most of them seldom changed.
  const advanced = document.createElement("div");
  advanced.className = "flex flex-col gap-3";
  // A setting for another mode stays out of the way (an energy diagram's level tables while it draws a profile).
  const applies = (field) => !field.when || Object.entries(field.when).every(([key, wanted]) =>
    (Array.isArray(wanted) ? wanted.map(String) : [String(wanted)]).includes(String(values[key])));
  // Named sections (a box plot's comparisons): open when one of their settings is in use, otherwise folded.
  const sections = new Map();
  const sectionFor = (name) => {
    if (!sections.has(name)) {
      const body = document.createElement("div");
      body.className = "flex flex-col gap-3";
      sections.set(name, body);
    }
    return sections.get(name);
  };
  plugin.fields.forEach((field) => {
    if (!applies(field)) return;
    const target = field.section ? sectionFor(field.section) : field.advanced ? advanced : wrap;
    if (field.type === "checkbox") {
      const row = document.createElement("div");
      row.innerHTML = _pluginFieldInput(field, values[field.key]);
      target.appendChild(row);
    } else {
      const example = field.type === "table" && String(values[field.key] ?? "") !== "" && String(values[field.key]) === String(plugin.defaultData?.[field.key] ?? "");
      target.appendChild(createField(escapeHtml(field.label), _pluginFieldInput(field, values[field.key], { example })));
    }
    if (field.hint) {
      const hint = document.createElement("p");
      hint.className = "text-[11px] text-slate-500 -mt-2";
      hint.textContent = field.hint;
      target.appendChild(hint);
    }
  });
  sections.forEach((body, name) => {
    const key = `plugin:${plugin.id}:section:${name}`;
    // In use (a field differs from the plugin's default): the section is shown open the first time.
    const used = plugin.fields.some((f) => f.section === name && String(values[f.key] ?? "") !== String(plugin.defaultData?.[f.key] ?? ""));
    if (used && typeof _openPropertySections !== "undefined" && !_openPropertySections.has(`${key}:seen`)) {
      _openPropertySections.add(key);
      _openPropertySections.add(`${key}:seen`);
    }
    wrap.appendChild(createMoreSection(name, [body], key));
  });
  if (advanced.children.length) wrap.appendChild(createMoreSection("More options", [advanced], `plugin:${plugin.id}:more`));
  // What the plugin can say about the settings, such as what a lookup found ("Looked up on PubChem: Caffeine").
  const status = typeof plugin.status === "function" ? String(plugin.status(values) || "") : "";
  if (status) {
    const statusNote = document.createElement("p");
    statusNote.id = "prop-plugin-status";
    statusNote.className = "plugin-panel-status";
    statusNote.textContent = status;
    wrap.insertBefore(statusNote, wrap.children[2] || null);
  }
  // A lookup in progress, or why the last one failed (the object keeps what it showed before).
  const notice = typeof getPluginElementNotice === "function" ? getPluginElementNotice(data.id) : "";
  const noticeNote = document.createElement("p");
  noticeNote.id = "prop-plugin-notice";
  noticeNote.className = notice === "Looking up…" ? "plugin-panel-notice" : "plugin-panel-error";
  noticeNote.textContent = notice;
  noticeNote.hidden = !notice;
  wrap.appendChild(noticeNote);
  // Look up again: after a failed lookup, or to refresh what a saved deck holds.
  // Also when the object cannot be drawn: its details may never have been looked up.
  if (typeof plugin.prepare === "function" && ((notice && notice !== "Looking up…") || status || error)) {
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.id = "prop-plugin-refresh";
    refresh.className = "plugin-panel-refresh";
    refresh.innerHTML = '<i class="fa-solid fa-rotate"></i> Look up again';
    wrap.appendChild(refresh);
  }
  const errorNote = document.createElement("p");
  errorNote.id = "prop-plugin-error";
  errorNote.className = "plugin-panel-error";
  errorNote.textContent = error;
  // A failed lookup that also stops the drawing is one problem: say it once (the notice above already does).
  errorNote.hidden = !error || error === notice;
  const fit = document.createElement("button");
  fit.type = "button";
  fit.className = "plugin-panel-refresh";
  if (plugin.footnote) {
    // A reference goes at the foot of the slide, not across its content area.
    fit.id = "prop-plugin-footnote";
    fit.innerHTML = '<i class="fa-solid fa-arrow-down-wide-short"></i> Place as footnote';
    fit.title = "Across the slide, just above the footer";
  } else {
    fit.id = "prop-plugin-fit";
    fit.innerHTML = '<i class="fa-solid fa-expand"></i> Fill content area';
    fit.title = "Use the slide's width, from under the title to the footer";
  }
  wrap.appendChild(errorNote);
  wrap.appendChild(fit);
  if (plugin.fields.some(field => field.key === "fontSize" && field.type === "number")) {
    const readable = document.createElement("button");
    readable.type = "button";
    readable.id = "prop-plugin-readable";
    readable.className = "plugin-panel-refresh";
    readable.textContent = "Readable labels (at least 18 px)";
    wrap.appendChild(readable);
  }
  group.appendChild(wrap);
  panel.appendChild(group);
  const surface = createGroup("Plot Surface");
  const mode = data.pluginSurfaceMode || "custom";
  surface.innerHTML = `<label class="prop-field-hint" for="prop-plugin-surface">Background</label>
    <select id="prop-plugin-surface" class="w-full">
      ${[["theme", "Theme surface"], ["transparent", "Transparent"], ["custom", "Custom colour"]].map(([value, label]) => `<option value="${value}" ${mode === value ? "selected" : ""}>${label}</option>`).join("")}
    </select>
    <input type="color" id="prop-plugin-surface-color" aria-label="Plot background colour" class="w-full h-8 mt-2" value="${_normalizeColorForInput(data.styles?.backgroundColor, "#ffffff")}" ${mode === "custom" ? "" : "disabled"}>`;
  panel.appendChild(surface);
}

function bindPluginPanel(data) {
  const plugin = typeof getSlidePlugin === "function" ? getSlidePlugin(data.pluginId) : null;
  if (!plugin) {
    const manage = document.getElementById("prop-plugin-manage");
    if (manage) manage.onclick = () => window.openPluginManager?.();
    return;
  }
  const surfaceMode = document.getElementById("prop-plugin-surface");
  const surfaceColor = document.getElementById("prop-plugin-surface-color");
  const setSurface = (mode, color) => {
    saveStateToUndo();
    const styles = { ...data.styles, ...(color ? { backgroundColor: color } : {}) };
    updateElementState(data.id, { pluginSurfaceMode: mode, styles });
    renderSlidesFromState();
    buildPropertiesPanel();
    schedulePresentationAutosave?.(150);
  };
  if (surfaceMode) surfaceMode.onchange = () => setSurface(surfaceMode.value,
      surfaceMode.value === "custom" ? surfaceColor.value : null);
  if (surfaceColor) surfaceColor.onchange = () => setSurface("custom", surfaceColor.value);
  const commit = (key, value) => {
    const current = normalizePluginData(plugin, data.pluginData);
    if (current[key] === value) return;
    updatePluginElementData(data.id, { [key]: value });
  };
  const readable = document.getElementById("prop-plugin-readable");
  if (readable) readable.onclick = () => commit("fontSize", Math.max(18, Number(data.pluginData?.fontSize) || 18));
  const refresh = document.getElementById("prop-plugin-refresh");
  if (refresh) refresh.onclick = () => refreshPluginElement(data.id);
  const fit = document.getElementById("prop-plugin-fit");
  if (fit) fit.onclick = () => fitPluginElementToContentArea(data.id);
  const footnote = document.getElementById("prop-plugin-footnote");
  if (footnote) footnote.onclick = () => placePluginElementAsFootnote(data.id);
  plugin.fields.forEach((field) => {
    const input = document.getElementById(_pluginFieldId(field.key));
    if (!input) return;
    if (field.type === "checkbox") {
      input.onchange = () => commit(field.key, input.checked);
    } else if (field.type === "number") {
      input.onchange = () => {
        const value = parseFloat(input.value);
        if (Number.isFinite(value)) commit(field.key, value);
      };
    } else if (field.type === "color") {
      const auto = document.getElementById(`${_pluginFieldId(field.key)}-auto`);
      input.onchange = () => commit(field.key, input.value);
      if (auto) auto.onchange = () => commit(field.key, auto.checked ? "" : input.value);
    } else if (field.type === "select") {
      input.onchange = () => commit(field.key, input.value);
    } else if (field.type === "table") {
      const id = _pluginFieldId(field.key);
      const summary = document.getElementById(`${id}-summary`);
      const file = document.getElementById(`${id}-file`);
      // Pasted cells keep their tabs: Tab in the box types one instead of leaving the field.
      input.onkeydown = (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commit(field.key, input.value.replace(/\s+$/, ""));
          // The panel is not rebuilt while the box has focus, so say here that the data is in use now.
          if (summary) summary.textContent = `${_pluginTableSummary(input.value, field)} · applied`;
          return;
        }
        if (event.key !== "Tab" || event.shiftKey) return;
        event.preventDefault();
        input.setRangeText("\t", input.selectionStart, input.selectionEnd, "end");
      };
      const clear = document.getElementById(`${id}-clear`);
      // The "Example data" tag goes once the box holds something else (the panel is not rebuilt while it has focus,
      // so the tag stayed over the user's own data).
      const exampleText = input.value;
      input.oninput = () => {
        if (summary) summary.textContent = `${_pluginTableSummary(input.value, field)} · not applied yet: leave the box or press Ctrl+Enter`;
        const tag = clear?.closest(".plugin-table-example");
        if (tag) tag.style.display = input.value === exampleText ? "" : "none";
      };
      if (clear) clear.onclick = () => commit(field.key, "");
      input.onchange = () => commit(field.key, input.value.replace(/\s+$/, ""));
      const expand = document.getElementById(`${id}-expand`);
      if (expand) expand.onclick = () => openPluginTableEditor(field, input.value, (text) => commit(field.key, text.replace(/\s+$/, "")));
      const load = document.getElementById(`${id}-load`);
      if (load && file) {
        load.onclick = () => file.click();
        file.onchange = async () => {
          const chosen = file.files?.[0];
          file.value = "";
          if (!chosen) return;
          if (chosen.size > SF_PLUGIN_TABLE_FILE_LIMIT) {
            if (summary) summary.textContent = "That file is larger than 60 KB";
            return;
          }
          commit(field.key, (await chosen.text()).replace(/\s+$/, ""));
        };
      }
    } else {
      // Text is applied on Enter or when leaving the field; a textarea only when leaving it.
      input.onchange = () => commit(field.key, input.value.trim());
      if (field.type === "text") {
        input.onkeydown = (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        };
      }
    }
  });
}

// A larger box for a table field's data (the panel's box shows six or seven rows of a narrow column): a dialog
// most of the window's size, with the column names above, Tab typing a tab, Apply and Cancel.
function openPluginTableEditor(field, text, apply) {
  document.getElementById("plugin-table-editor")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "plugin-table-editor";
  dialog.className = "plugin-table-editor";
  dialog.setAttribute("aria-label", `${field.label}: data`);
  const columns = field.columns?.length
    ? `<div class="plugin-table-columns">${field.columns.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
    : "";
  dialog.innerHTML = `
    <form method="dialog" class="plugin-table-editor__body">
      <h2 class="plugin-table-editor__title"></h2>
      ${columns}
      <textarea class="plugin-table-editor__input font-mono" spellcheck="false" wrap="off"></textarea>
      <div class="plugin-table-editor__footer">
        <span class="plugin-table-editor__summary"></span>
        <button type="button" class="plugin-table-editor__cancel">Cancel</button>
        <button type="submit" value="apply" class="plugin-table-editor__apply">Apply</button>
      </div>
    </form>`;
  dialog.querySelector(".plugin-table-editor__title").textContent = field.label;
  const box = dialog.querySelector("textarea");
  const summary = dialog.querySelector(".plugin-table-editor__summary");
  box.value = text || "";
  box.placeholder = field.placeholder || "";
  const update = () => { summary.textContent = `${_pluginTableSummary(box.value, field)} · Ctrl+Enter applies`; };
  update();
  box.addEventListener("input", update);
  box.addEventListener("keydown", (event) => {
    event.stopPropagation(); // the editor's shortcuts stay out of the box
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      dialog.querySelector(".plugin-table-editor__apply").click();
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      box.setRangeText("\t", box.selectionStart, box.selectionEnd, "end");
      update();
    }
  });
  // The keyboard stays in the dialog: Shift+Tab from the box (and Tab from the last button) go round its own
  // controls instead of leaving the focus on the page behind it.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    if (event.target === box && !event.shiftKey) return; // types a tab (above)
    const stops = [box, dialog.querySelector(".plugin-table-editor__cancel"), dialog.querySelector(".plugin-table-editor__apply")];
    const at = stops.indexOf(document.activeElement);
    event.preventDefault();
    event.stopPropagation();
    stops[(at + (event.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
  }, true); // on the way down: the box stops its keys from reaching the dialog
  dialog.querySelector(".plugin-table-editor__cancel").onclick = () => dialog.close("cancel");
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "apply") apply(box.value);
    dialog.remove();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  box.focus();
  return dialog;
}
window.openPluginTableEditor = openPluginTableEditor;
