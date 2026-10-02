// Slide presets: the preset picker palette UI.

// A small picture of the preset itself, in the current theme and slide size: its boxes in their colours and its
// text as bars of its size and colour. The cards showed five generic sketches handed out by position in the list.
const _presetPreviewCache = new Map();

function _presetPreviewText(content) {
    if (Array.isArray(content)) return content.map(item => item?.text || "").join(" ");
    return String(content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function _presetPreviewEscape(value) {
    return String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function presetPreviewSvg(presetId, theme = getPresentationTheme()) {
    const page = typeof getPresentationPageSetupConfig === "function" ? getPresentationPageSetupConfig() : { width: 1024, height: 768 };
    const key = `${presetId}|${theme?.label || ""}|${page.width}x${page.height}`;
    if (_presetPreviewCache.has(key)) return _presetPreviewCache.get(key);
    let slide = null;
    try {
        slide = buildPresetSlideState(presetId, theme, { slideId: "preview" });
    } catch (error) {
        slide = null;
    }
    const W = Number(page.width) || 1024;
    const H = Number(page.height) || 768;
    const palette = typeof _modernPalette === "function" ? _modernPalette(theme) : { canvas: "#F8FAFC" };
    const parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="${_presetPreviewEscape(palette.canvas)}"/>`];
    const px = value => parseFloat(value) || 0;
    [...(slide?.elements || [])]
        .filter(el => !el.footerRole && !el.presetBackground)
        .sort((a, b) => (Number(a.styles?.zIndex) || 0) - (Number(b.styles?.zIndex) || 0))
        .forEach(el => {
            const x = Number(el.x) || 0;
            const y = Number(el.y) || 0;
            const w = px(el.width);
            const h = px(el.height);
            const st = el.styles || {};
            if (el.type === "shape" || el.type === "image" || el.type === "chart") {
                const fill = el.type === "image" ? (palette.isLight ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.08)") : st.backgroundColor || "transparent";
                const border = String(st.border || "").match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i);
                const radius = Math.min(px(st.borderRadius), Math.min(w, h) / 2);
                parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${_presetPreviewEscape(fill)}"${border ? ` stroke="${_presetPreviewEscape(border[1])}" stroke-width="2"` : ""}/>`);
                return;
            }
            if (el.type === "table" && el.tableData) {
                const t = el.tableData;
                const rows = Math.max(1, Number(t.rows) || 1);
                const rowH = h / rows;
                parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${_presetPreviewEscape(t.bodyFill || "transparent")}" stroke="${_presetPreviewEscape(t.borderColor || "#cbd5e1")}" stroke-width="2"/>`);
                if (t.headerRow !== false) parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${rowH}" fill="${_presetPreviewEscape(t.headerFill || "#e2e8f0")}"/>`);
                for (let r = 1; r < rows; r += 1) parts.push(`<line x1="${x}" y1="${y + r * rowH}" x2="${x + w}" y2="${y + r * rowH}" stroke="${_presetPreviewEscape(t.borderColor || "#cbd5e1")}" stroke-width="2"/>`);
                return;
            }
            if (el.type === "text") {
                const text = _presetPreviewText(el.content);
                if (!text) return;
                const size = Math.max(10, px(st.fontSize) || 18);
                const perLine = Math.max(4, Math.floor(w / (size * 0.55)));
                const lines = Math.min(4, Math.ceil(text.length / perLine));
                const color = _presetPreviewEscape(st.color || "#334155");
                for (let line = 0; line < lines; line += 1) {
                    const chars = line === lines - 1 ? text.length - perLine * (lines - 1) : perLine;
                    const barW = Math.min(w, Math.max(size, chars * size * 0.5));
                    const align = st.textAlign === "center" ? (w - barW) / 2 : st.textAlign === "right" ? w - barW : 0;
                    parts.push(`<rect x="${x + align}" y="${y + line * size * 1.3 + size * 0.2}" width="${barW}" height="${size * 0.62}" rx="${size * 0.2}" fill="${color}" opacity="0.85"/>`);
                }
            }
        });
    const svg = `<svg class="preset-preview-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${parts.join("")}</svg>`;
    _presetPreviewCache.set(key, svg);
    return svg;
}

function renderPresetSlidePalette() {
    const container = document.getElementById("preset-slides-list");
    if (!container) return;
    const query = String(document.getElementById("preset-search-input")?.value || "").trim().toLowerCase();
    const categoryFilter = String(document.getElementById("preset-category-filter")?.value || "recommended");
    const activeTheme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    const activePalette = activeTheme ? _modernPalette(activeTheme) : null;
    const palette = activePalette
        ? activePalette.accents.map((accent, index) => ({
              tint: activePalette.pastels[index % activePalette.pastels.length],
              accent,
              chip: activePalette.isLight ? "rgba(255,255,255,0.82)" : activePalette.raisedPanel,
          }))
        : [
              { tint: "#DBEAFE", accent: "#2563EB", chip: "#EFF6FF" },
              { tint: "#CCFBF1", accent: "#0F766E", chip: "#F0FDFA" },
              { tint: "#DCFCE7", accent: "#15803D", chip: "#F0FDF4" },
              { tint: "#E0E7FF", accent: "#4F46E5", chip: "#EEF2FF" },
          ];
    const recommendations = recommendSlidePresets();
    const recommendedIds = new Set(recommendations.map(item => item.id));
    const entries = Object.entries(SLIDE_PRESETS).filter(([id, preset]) => {
        if (preset.hiddenInPalette) return false;
        const meta = preset.metadata || {};
        const searchable = [id, preset.name, meta.category, meta.narrativeRole, ...(meta.keywords || []), ...(meta.contentTypes || [])]
            .join(" ")
            .toLowerCase();
        if (query && !searchable.includes(query)) return false;
        if (categoryFilter === "recommended") return recommendedIds.has(id);
        if (categoryFilter === "recent") return getPresetRecentList().includes(id);
        if (categoryFilter && categoryFilter !== "all") return meta.category === categoryFilter;
        return true;
    });
    const grouped = entries.reduce((groups, entry) => {
        const category = entry[1].metadata?.category || "narrative";
        if (!groups[category]) groups[category] = [];
        groups[category].push(entry);
        return groups;
    }, {});
    const html = value => (typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? ""));
    const renderCard = ([id, preset], index) => {
            const theme = palette[index % palette.length];
            const shortName = preset.name.length > 17 ? preset.name.slice(0, 16) + "..." : preset.name;
            const meta = preset.metadata || {};
            const recommended = recommendedIds.has(id);
            return `
            <button onclick="insertPresetSlide('${id}')" class="preset-card ${recommended ? "preset-card-recommended" : ""}" title="${html(preset.name)}" data-category="${html(meta.category || "narrative")}" style="--preset-tint:${theme.tint}; --preset-accent:${theme.accent}; --preset-chip:${theme.chip};">
                <span class="preset-preview preset-preview--live" aria-hidden="true">${presetPreviewSvg(id, activeTheme)}</span>
                <span class="preset-card-footer">
                    <span class="preset-card-icon"><i class="${preset.icon}"></i></span>
                    <span class="preset-card-copy">
                        <span class="preset-card-name">${html(shortName)}</span>
                        <span class="preset-card-meta">${html(PRESET_CATEGORY_LABELS[meta.category] || meta.category || "Layout")} - ${html(meta.narrativeRole || "context")}</span>
                    </span>
                </span>
            </button>
        `;
    };
    if (!entries.length) {
        container.innerHTML = `<div class="preset-empty-state">No matching presets. Try a broader search or switch to All.</div>`;
        return;
    }
    container.innerHTML = Object.entries(grouped)
        .map(([category, groupEntries]) => {
            const label = categoryFilter === "recommended" ? "Recommended for this slide" : PRESET_CATEGORY_LABELS[category] || category;
            return `
                <section class="preset-group" data-preset-group="${category}">
                    <div class="preset-group-header">
                        <span>${escapeHtml(label)}</span>
                        <small>${groupEntries.length}</small>
                    </div>
                    <div class="preset-palette">
                        ${groupEntries.map((entry, index) => renderCard(entry, index)).join("")}
                    </div>
                </section>
            `;
        })
        .join("");
}

window.renderPresetSlidePalette = renderPresetSlidePalette;
