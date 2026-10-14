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

function buildPluginPanel(panel, data) {
  const plugin = typeof getSlidePlugin === "function" ? getSlidePlugin(data.pluginId) : null;
  if (!plugin) {
    const group = createGroup("Plugin");
    group.innerHTML = `<p class="text-xs text-slate-600">The “${escapeHtml(data.pluginId || "unknown")}” plugin is not installed. The object shows its last saved picture and can still be moved, resized and exported.</p>`;
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
  if (!plugin) return;
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
