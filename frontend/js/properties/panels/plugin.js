// Properties panel section for plugin objects: built from the fields the plugin declares.

function _pluginFieldId(key) {
  return `prop-plugin-${key}`;
}

function _pluginFieldInput(field, value) {
  const id = _pluginFieldId(field.key);
  const placeholder = escapeHtml(field.placeholder || "");
  if (field.type === "textarea") {
    return `<textarea id="${id}" rows="3" class="w-full text-xs font-mono" spellcheck="false" placeholder="${placeholder}">${escapeHtml(value ?? "")}</textarea>`;
  }
  if (field.type === "table") {
    const columns = field.columns.length
      ? `<div class="plugin-table-columns">${field.columns.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
      : "";
    return `${columns}<textarea id="${id}" rows="${field.rows || 6}" class="w-full text-xs font-mono plugin-table-input" spellcheck="false" wrap="off" placeholder="${placeholder}">${escapeHtml(value ?? "")}</textarea>
      <div class="plugin-table-footer">
        <span id="${id}-summary" class="plugin-table-summary">${escapeHtml(_pluginTableSummary(value))}</span>
        <button type="button" id="${id}-load" class="plugin-table-load"><i class="fa-solid fa-file-csv"></i> Load CSV…</button>
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

// "3 rows × 2 columns" for a table field.
function _pluginTableSummary(text) {
  const rows = typeof parsePluginTable === "function" ? parsePluginTable(text) : [];
  if (!rows.length) return "No rows yet";
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
  plugin.fields.forEach((field) => {
    if (field.type === "checkbox") {
      const row = document.createElement("div");
      row.innerHTML = _pluginFieldInput(field, values[field.key]);
      wrap.appendChild(row);
    } else {
      wrap.appendChild(createField(escapeHtml(field.label), _pluginFieldInput(field, values[field.key])));
    }
    if (field.hint) {
      const hint = document.createElement("p");
      hint.className = "text-[11px] text-slate-500 -mt-2";
      hint.textContent = field.hint;
      wrap.appendChild(hint);
    }
  });
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
  const errorNote = document.createElement("p");
  errorNote.id = "prop-plugin-error";
  errorNote.className = "plugin-panel-error";
  errorNote.textContent = error;
  errorNote.hidden = !error;
  wrap.appendChild(errorNote);
  group.appendChild(wrap);
  panel.appendChild(group);
}

function bindPluginPanel(data) {
  const plugin = typeof getSlidePlugin === "function" ? getSlidePlugin(data.pluginId) : null;
  if (!plugin) {
    const manage = document.getElementById("prop-plugin-manage");
    if (manage) manage.onclick = () => window.openPluginManager?.();
    return;
  }
  const commit = (key, value) => {
    const current = normalizePluginData(plugin, data.pluginData);
    if (current[key] === value) return;
    updatePluginElementData(data.id, { [key]: value });
  };
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
        if (event.key !== "Tab" || event.shiftKey) return;
        event.preventDefault();
        input.setRangeText("\t", input.selectionStart, input.selectionEnd, "end");
      };
      input.oninput = () => {
        if (summary) summary.textContent = _pluginTableSummary(input.value);
      };
      input.onchange = () => commit(field.key, input.value.replace(/\s+$/, ""));
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
