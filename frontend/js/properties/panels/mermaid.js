// Properties panel section for Mermaid diagram elements.

function buildMermaidPanel(panel, data) {
  const mermaidGrp = createGroup("Mermaid Diagram");
  const mermaidStyle = {
    fontFamily: data.style?.fontFamily || "Inter, Arial, sans-serif",
    primaryColor: data.style?.primaryColor || "#eef2ff",
    primaryTextColor: data.style?.primaryTextColor || "#0f172a",
    lineColor: data.style?.lineColor || "#4f46e5",
    handDrawn: Boolean(data.style?.handDrawn),
  };
  // Sequence, ER, Gantt, journey and mind map diagrams have no hand-drawn look: the box did nothing for them.
  const canDrawByHand = (window.mermaidRenderModes?.(data.mermaidSource || "") || ["real", "sketch"]).length > 1;
  mermaidGrp.innerHTML += `
                <button id="prop-mermaid-edit" class="w-full py-2 rounded bg-indigo-600 text-xs text-white font-semibold mb-2">
                    <i class="fa-solid fa-diagram-project mr-1"></i> Edit Diagram Source
                </button>
                <div class="flex flex-col gap-1.5 mb-2">
                    <label class="text-xs font-medium text-gray-400">Theme</label>
                    <select id="prop-mermaid-theme" class="w-full">
                        ${["default", "neutral", "dark", "forest", "base"].map((theme) => `<option value="${theme}" ${data.theme === theme ? "selected" : ""}>${theme}</option>`).join("")}
                    </select>
                </div>
                <div class="flex flex-col gap-1.5 mb-2">
                    <label class="text-xs font-medium text-gray-400">Font</label>
                    <select id="prop-mermaid-font" class="w-full">
                        ${[
                          ["Inter, Arial, sans-serif", "Inter"],
                          ["Arial, sans-serif", "Arial"],
                          ["Georgia, serif", "Georgia"],
                          ["'Comic Sans MS', 'Comic Neue', cursive", "Cursive"],
                          ["'Caveat', 'Bradley Hand', cursive", "Handwritten"],
                          [
                            "'Architects Daughter', 'Comic Sans MS', cursive",
                            "XKCD",
                          ],
                          ["Courier New, monospace", "Mono"],
                        ]
                          .map(
                            ([value, label]) =>
                              `<option value="${value}" ${mermaidStyle.fontFamily === value ? "selected" : ""}>${label}</option>`,
                          )
                          .join("")}
                    </select>
                </div>
                <label class="flex items-center justify-between gap-2 mb-2 text-xs font-medium text-gray-400" ${canDrawByHand ? "" : 'title="This diagram type has no hand-drawn look"'}>
                    <span>XKCD hand-drawn</span>
                    <input id="prop-mermaid-hand" type="checkbox" ${mermaidStyle.handDrawn && canDrawByHand ? "checked" : ""} ${canDrawByHand ? "" : "disabled"}>
                </label>
                <div class="grid grid-cols-3 gap-2 mb-2">
                    <label class="flex flex-col gap-1 text-[10px] font-bold text-gray-400 uppercase">Fill<input id="prop-mermaid-fill" type="color" value="${escapeHtml(mermaidStyle.primaryColor)}"></label>
                    <label class="flex flex-col gap-1 text-[10px] font-bold text-gray-400 uppercase">Text<input id="prop-mermaid-text" type="color" value="${escapeHtml(mermaidStyle.primaryTextColor)}"></label>
                    <label class="flex flex-col gap-1 text-[10px] font-bold text-gray-400 uppercase">Line<input id="prop-mermaid-line" type="color" value="${escapeHtml(mermaidStyle.lineColor)}"></label>
                </div>
                <div class="text-[11px] text-gray-500 leading-relaxed">
                    Source is saved with the project JSON. Double-click the object to reopen this editor.
                </div>
            `;
  panel.appendChild(mermaidGrp);
}

function bindMermaidPanel(data, onCommit) {
  const editBtn = document.getElementById("prop-mermaid-edit");
  if (editBtn) {
    editBtn.onclick = () => window.openMermaidDialog?.(data.id);
  }
  const themeField = document.getElementById("prop-mermaid-theme");
  const rerenderMermaid = (updates) => {
    updateElementState(data.id, { ...updates, svgContent: "" });
    Object.assign(data, updates, { svgContent: "" });
    const dom = document.getElementById(data.id);
    if (dom && typeof window.renderMermaidElement === "function") {
      window.renderMermaidElement(dom, data, { force: true });
    }
    buildPropertiesPanel();
  };
  if (themeField) {
    themeField.onchange = (e) => {
      onCommit(() => {
        const theme = e.target.value || "default";
        // The theme's colours too: flowcharts are drawn from them, so the theme alone changed nothing.
        const palette = window.MERMAID_THEME_PALETTES?.[theme];
        rerenderMermaid({ theme, ...(palette ? { style: { ...(data.style || {}), ...palette } } : {}) });
      });
    };
  }
  const styleFieldIds = [
    "prop-mermaid-font",
    "prop-mermaid-fill",
    "prop-mermaid-text",
    "prop-mermaid-line",
    "prop-mermaid-hand",
  ];
  styleFieldIds.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.onchange = () => {
      onCommit(() => {
        rerenderMermaid({
          style: {
            ...(data.style || {}),
            fontFamily:
              document.getElementById("prop-mermaid-font")?.value ||
              "Inter, Arial, sans-serif",
            primaryColor:
              document.getElementById("prop-mermaid-fill")?.value ||
              "#eef2ff",
            primaryTextColor:
              document.getElementById("prop-mermaid-text")?.value ||
              "#0f172a",
            lineColor:
              document.getElementById("prop-mermaid-line")?.value ||
              "#4f46e5",
            handDrawn: Boolean(
              document.getElementById("prop-mermaid-hand")?.checked,
            ),
            // renderMode decides the look when present, so the switch sets it too.
            renderMode: document.getElementById("prop-mermaid-hand")?.checked
              ? data.style?.renderMode && data.style.renderMode !== "real"
                ? data.style.renderMode
                : "sketch"
              : "real",
          },
        });
      });
    };
  });
}
