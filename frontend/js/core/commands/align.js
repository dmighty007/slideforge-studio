// Commands: element box geometry and aligning the selection.

function _getElementNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function _getElementBox(el) {
    const x = _getElementNumber(el.x);
    const y = _getElementNumber(el.y);
    const node = document.querySelector(`.slides [id="${el.id}"]`);
    const width = _getElementNumber(el.width, node?.offsetWidth || 0);
    const height = _getElementNumber(el.height, node?.offsetHeight || 0);
    return {
        x,
        y,
        width,
        height,
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height,
    };
}

function _getSelectionAlignmentUnits(slide) {
    const selected = slide.elements.filter(el => state.selectedIds.includes(el.id));
    const units = [];
    const grouped = new Map();

    selected.forEach(el => {
        if (!el.groupId) {
            units.push({ id: el.id, elements: [el] });
            return;
        }
        if (!grouped.has(el.groupId)) {
            grouped.set(el.groupId, { id: el.groupId, elements: [] });
            units.push(grouped.get(el.groupId));
        }
        grouped.get(el.groupId).elements.push(el);
    });

    return units
        .map(unit => {
            const boxes = unit.elements.map(_getElementBox);
            const minX = Math.min(...boxes.map(box => box.minX));
            const minY = Math.min(...boxes.map(box => box.minY));
            const maxX = Math.max(...boxes.map(box => box.maxX));
            const maxY = Math.max(...boxes.map(box => box.maxY));
            return {
                ...unit,
                locked: unit.elements.some(el => el.locked),
                minX,
                minY,
                maxX,
                maxY,
                width: maxX - minX,
                height: maxY - minY,
            };
        })
        .filter(unit => unit.elements.length && !unit.locked);
}

let selectionAlignmentReference = "auto";

function alignSelection(alignment, reference = selectionAlignmentReference) {
    if (!state.selectedIds.length) return;
    const slide = state.slides[currentSlideIndex];
    if (!slide) return;

    const units = _getSelectionAlignmentUnits(slide);
    if (!units.length || !["left", "center", "right", "top", "middle", "bottom"].includes(alignment)) return;

    saveStateToUndo();

    const bounds = {
        minX: Math.min(...units.map(unit => unit.minX)),
        minY: Math.min(...units.map(unit => unit.minY)),
        maxX: Math.max(...units.map(unit => unit.maxX)),
        maxY: Math.max(...units.map(unit => unit.maxY)),
    };

    if (reference === "slide" || (reference === "auto" && units.length === 1)) {
        const page = getPresentationPageSetupConfig();
        Object.assign(bounds, { minX: 0, minY: 0, maxX: page.width, maxY: page.height });
    }

    units.forEach(unit => {
        let nextX = unit.minX;
        let nextY = unit.minY;

        switch (alignment) {
            case "left":
                nextX = bounds.minX;
                break;
            case "center":
                nextX = bounds.minX + (bounds.maxX - bounds.minX) / 2 - unit.width / 2;
                break;
            case "right":
                nextX = bounds.maxX - unit.width;
                break;
            case "top":
                nextY = bounds.minY;
                break;
            case "middle":
                nextY = bounds.minY + (bounds.maxY - bounds.minY) / 2 - unit.height / 2;
                break;
            case "bottom":
                nextY = bounds.maxY - unit.height;
                break;
            default:
                return;
        }

        const dx = nextX - unit.minX;
        const dy = nextY - unit.minY;

        unit.elements.forEach(el => {
            const x = _getElementNumber(el.x);
            const y = _getElementNumber(el.y);
            const alignedX = x + dx;
            const alignedY = y + dy;

            // Positions are plain numbers everywhere else; a "px" string was reset to the 100,100 default on redraw.
            updateElementState(el.id, { x: alignedX, y: alignedY });

            const dom = document.getElementById(el.id);
            if (dom) {
                dom.style.transform = `translate(${alignedX}px, ${alignedY}px) rotate(${el.rotation || 0}deg)`;
                dom.setAttribute("data-x", alignedX);
                dom.setAttribute("data-y", alignedY);
            }
        });
    });

    if (window.renderSlidesFromState) window.renderSlidesFromState();
    updateGroupBound?.();
    refreshPreviews?.();
    schedulePresentationAutosave?.(150);
}


function distributeSelection(axis) {
    const slide = state.slides[currentSlideIndex];
    if (!slide || !["horizontal", "vertical"].includes(axis)) return;
    const horizontal = axis === "horizontal";
    const start = horizontal ? "minX" : "minY";
    const end = horizontal ? "maxX" : "maxY";
    const size = horizontal ? "width" : "height";
    const units = _getSelectionAlignmentUnits(slide).sort((a, b) => a[start] - b[start]);
    if (units.length < 3) return;
    saveStateToUndo();
    const low = units[0][start];
    const high = Math.max(...units.map(unit => unit[end]));
    const gap = (high - low - units.reduce((sum, unit) => sum + unit[size], 0)) / (units.length - 1);
    let cursor = low;
    units.forEach(unit => {
        const delta = cursor - unit[start];
        unit.elements.forEach(el => updateElementState(el.id, horizontal
            ? { x: _getElementNumber(el.x) + delta }
            : { y: _getElementNumber(el.y) + delta }));
        cursor += unit[size] + gap;
    });
    renderSlidesFromState();
    schedulePresentationAutosave?.(150);
}

function fitSelectionToContentArea() {
    const slide = state.slides[currentSlideIndex];
    if (!slide) return;
    const units = _getSelectionAlignmentUnits(slide);
    if (!units.length) return;
    const selected = units.flatMap(unit => unit.elements);
    const area = _pluginContentArea(slide, new Set(selected.map(el => el.id)));
    if (!area) return;
    const x = Math.min(...units.map(unit => unit.minX));
    const y = Math.min(...units.map(unit => unit.minY));
    const width = Math.max(...units.map(unit => unit.maxX)) - x;
    const height = Math.max(...units.map(unit => unit.maxY)) - y;
    if (!width || !height) return;
    saveStateToUndo();
    const scale = Math.min(parseFloat(area.width) / width, parseFloat(area.height) / height);
    const left = area.x + (parseFloat(area.width) - width * scale) / 2;
    const top = area.y + (parseFloat(area.height) - height * scale) / 2;
    selected.forEach(el => {
        const box = _getElementBox(el);
        const plugin = el.type === "plugin" && getSlidePlugin(el.pluginId);
        // Size-aware plots and native charts lay themselves out, so they take the whole area.
        const fill = selected.length === 1 && (plugin?.sizeAware || el.type === "chart");
        // A table is fitted by its rows (see _fitTableToContentArea): scaled like a picture, its rows were stretched.
        if (selected.length === 1 && el.type === "table") {
            _fitTableToContentArea(el, area);
            return;
        }
        updateElementState(el.id, fill ? area : {
            x: left + (box.x - x) * scale, y: top + (box.y - y) * scale,
            width: `${box.width * scale}px`, height: `${box.height * scale}px`,
        });
    });
    renderSlidesFromState();
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
}


// After an insert that had to be made smaller (or still covers something): a notice over the canvas offering the
// content area (over what is there) or a new slide with the object alone, at its full size. Gone after a while,
// on the next insert, or when the object is no longer selected.
let _placementNoticeTimer = 0;

function hidePlacementNotice() {
    clearTimeout(_placementNoticeTimer);
    document.getElementById("placement-notice")?.remove();
}

function showPlacementNotice(id, { width, height, covers = false } = {}) {
    hidePlacementNotice();
    const slide = state.slides[currentSlideIndex];
    if (!slide?.elements.some(el => el.id === id)) return;
    const wrapper = document.getElementById("canvas-wrapper");
    if (!wrapper) return;
    const notice = document.createElement("div");
    notice.id = "placement-notice";
    notice.className = "placement-notice";
    notice.setAttribute("role", "status");
    notice.innerHTML = `<span class="placement-notice__text"></span>
        <button type="button" data-placement="fit">Fit to content area</button>
        <button type="button" data-placement="slide">Move to a new slide</button>
        <button type="button" data-placement="close" class="placement-notice__close" aria-label="Dismiss"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    notice.querySelector(".placement-notice__text").textContent = covers
        ? "This slide is full, so the new object overlaps others."
        : "This slide is busy, so the new object came in smaller.";
    notice.addEventListener("click", event => {
        const action = event.target.closest("[data-placement]")?.dataset.placement;
        if (!action) return;
        hidePlacementNotice();
        if (action === "fit") {
            setSelectedIds([id]);
            fitSelectionToContentArea();
            selectElement(id, "replace");
        } else if (action === "slide") {
            moveElementToNewSlide(id, { width, height });
        }
    });
    // Over the bottom of the canvas, clear of the zoom buttons.
    wrapper.parentElement.appendChild(notice);
    _placementNoticeTimer = setTimeout(hidePlacementNotice, 12000);
}

// The object alone on a new slide after this one, given that slide's content area at its requested size.
function moveElementToNewSlide(id, size = {}) {
    const from = currentSlideIndex;
    const element = state.slides[from]?.elements.find(el => el.id === id);
    if (!element) return;
    // addSlide keeps the undo step: one undo puts the object back where it was.
    addSlide();
    const source = state.slides[from];
    source.elements = source.elements.filter(el => el.id !== id);
    const target = state.slides[currentSlideIndex];
    const moved = { ...element, x: 100, y: 100 };
    if (size.width) moved.width = `${size.width}px`;
    if (size.height) moved.height = `${size.height}px`;
    if (!claimContentPlaceholder(target, moved)) placeInContentPlaceholder(target, moved, { anywhere: true });
    target.elements.push(moved);
    renderSlidesFromState();
    selectElement(id, "replace");
    window.renderSlidePreviews?.();
    schedulePresentationAutosave?.(150);
}
window.showPlacementNotice = showPlacementNotice;
window.hidePlacementNotice = hidePlacementNotice;
window.moveElementToNewSlide = moveElementToNewSlide;

const _nextFrames = (count = 2) => new Promise(resolve => {
    const step = left => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(count);
});

// The rows of table `id` as drawn, in slide pixels: wrapped text makes a row taller than its stored height.
function _drawnTableRowHeights(id, tableData) {
    const node = [...document.querySelectorAll(`[id="${id}"]`)].find(n => !n.closest("#slide-previews"));
    const rows = node ? [...node.querySelectorAll("tbody tr")] : [];
    return tableData.rowHeights.map((height, i) => Math.max(Number(height) || 44, rows[i]?.offsetHeight || 0));
}

const _sumHeights = heights => heights.reduce((sum, value) => sum + value, 0);

// Rows of a table (drawn heights) in parts that each fit `available` px with the header row repeated.
function _tableSplitChunks(data, drawn, available) {
    const headerRows = data.headerRow && data.rows > 1 ? [0] : [];
    const headerHeight = _sumHeights(headerRows.map(r => drawn[r]));
    const chunks = [];
    let chunk = [];
    let used = headerHeight;
    for (let row = headerRows.length; row < data.rows; row++) {
        if (chunk.length && used + drawn[row] > available) {
            chunks.push(chunk);
            chunk = [];
            used = headerHeight;
        }
        chunk.push(row);
        used += drawn[row];
    }
    if (chunk.length) chunks.push(chunk);
    return { headerRows, chunks };
}

// The text size, row heights and padding a table had before fitting tightened it (kept on the table so a split can
// go back to them).
const _tableTextSettings = data => ({ fontSize: data.fontSize, rowHeights: [...data.rowHeights], cellPadding: data.cellPadding });

// A table across the content area, below the title and above the footer, as tall as its rows. Rows taller than the
// area are tightened (down to 26 px, words down to the table's smallest fitting size, 12 px unless set in its
// settings). Whenever the words got smaller, or the table is still too tall, the notice offers to split it across
// slides instead, saying into how many and with how many rows each, at its own text size: shrinking to 13 px was
// the only outcome offered before, and the split was hidden in the settings. It used to be scaled like a picture
// (its rows stretched), and a tall one was moved up over the title with its last rows off the slide.
async function _fitTableToContentArea(el, area) {
    const available = parseFloat(area.height);
    let data = normalizeTableData(el.tableData);
    updateElementState(el.id, {
        x: area.x, y: area.y, width: area.width,
        height: `${Math.round(_sumHeights(data.rowHeights))}px`,
        tableHeightGrown: false, tableHeightBeforeGrowth: undefined,
    });
    renderSlidesFromState();
    await _nextFrames();
    const fullSize = _drawnTableRowHeights(el.id, data);
    let needed = _sumHeights(fullSize);
    let shrunk = false;
    if (needed > available + 2) {
        const original = data.fitOriginal || _tableTextSettings(data);
        const smallest = Math.max(8, Number(data.fitMinFontSize) || 12);
        const rowHeight = Math.max(26, Math.floor(available / data.rows));
        const fontSize = Math.max(smallest, Math.min(parseFloat(data.fontSize) || 16, Math.floor(rowHeight / 1.9)));
        shrunk = fontSize < (parseFloat(original.fontSize) || 16);
        data = {
            ...data,
            rowHeights: data.rowHeights.map(() => rowHeight),
            fontSize: `${fontSize}px`,
            cellPadding: Math.min(data.cellPadding, Math.max(3, Math.floor((rowHeight - fontSize * 1.3) / 2))),
            fitOriginal: original,
        };
        updateElementState(el.id, { tableData: data, height: `${rowHeight * data.rows}px` });
        renderSlidesFromState();
        await _nextFrames();
        needed = _sumHeights(_drawnTableRowHeights(el.id, data));
    }
    const tooTall = needed > available + 2;
    if ((tooTall || shrunk) && typeof showNotification === "function") {
        // At the table's own size (as measured before tightening): the parts a split would make.
        const { chunks } = _tableSplitChunks(data, fullSize, available);
        const counts = chunks.map(part => part.length).join(" + ");
        const lead = tooTall ? "This table has more rows than fit on one slide." : `To fit, its text went down to ${data.fontSize}.`;
        if (chunks.length > 1) {
            showNotification(`${lead} Split it into ${chunks.length} slides (${counts} rows, header repeated) at its own text size?`, "info", {
                action: { label: `Split into ${chunks.length} slides`, run: () => splitTableAcrossSlides(el.id) },
            });
        } else if (tooTall) {
            showNotification(`${lead} “Split table across slides” (in the table's settings, or Ctrl+K) continues it on new slides with its header row.`, "info");
        }
    }
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
}

// Splits table `id` of the current slide into slides that each hold what fits below the title: copies of the slide
// follow it, each with the header row again and "(continued)" after its title. A table fitting had shrunk goes back
// to its own text size first, so each part is readable.
async function splitTableAcrossSlides(id = state.selectedIds[0]) {
    const index = currentSlideIndex;
    const slide = state.slides[index];
    const el = slide?.elements.find(item => item.id === id && item.type === "table");
    if (!el || typeof _pluginContentArea !== "function") return 0;
    const area = _pluginContentArea(slide, new Set([el.id]));
    if (!area) return 0;
    const available = parseFloat(area.height);
    let data = normalizeTableData(el.tableData);
    const before = JSON.parse(JSON.stringify(el));
    if (data.fitOriginal) {
        const { fitOriginal, ...rest } = data;
        data = { ...rest, ...fitOriginal, rowHeights: fitOriginal.rowHeights.length === data.rows ? fitOriginal.rowHeights : data.rowHeights };
        el.tableData = data;
        el.height = `${Math.round(_sumHeights(data.rowHeights))}px`;
        renderSlidesFromState();
        await _nextFrames();
    }
    const drawn = _drawnTableRowHeights(el.id, data);
    const { headerRows, chunks } = _tableSplitChunks(data, drawn, available);
    if (chunks.length < 2) {
        Object.assign(el, before); // the fitted size, if it was fitted
        renderSlidesFromState();
        if (typeof showNotification === "function") showNotification("The table already fits on its slide.", "info");
        return 0;
    }
    // One undo step back to the table as it was before the split (its fitted size included).
    const live = el.tableData;
    Object.assign(el, before);
    saveStateToUndo();
    el.tableData = live;
    const rowsOf = part => [...headerRows, ...part];
    const tableFor = part => ({ ...data, rows: rowsOf(part).length, cells: rowsOf(part).map(r => data.cells[r]), rowHeights: rowsOf(part).map(r => data.rowHeights[r]), selection: null });
    const heightFor = part => `${Math.round(_sumHeights(rowsOf(part).map(r => drawn[r])))}px`;
    const fitted = { tableHeightGrown: false, tableHeightBeforeGrowth: undefined, y: area.y };
    Object.assign(el, { tableData: tableFor(chunks[0]), height: heightFor(chunks[0]), ...fitted });
    chunks.slice(1).forEach((part, k) => {
        const copy = JSON.parse(JSON.stringify(slide));
        copy.id = generateId("slide");
        const idMap = {};
        const groupMap = {};
        copy.elements = copy.elements.map(item => {
            const next = { ...item, id: generateId("el") };
            idMap[item.id] = next.id;
            if (next.groupId) next.groupId = groupMap[next.groupId] || (groupMap[next.groupId] = generateId("grp"));
            return next;
        });
        if (typeof remapConnectorBindings === "function") remapConnectorBindings(copy.elements, idMap);
        Object.assign(copy.elements.find(item => item.id === idMap[el.id]), { tableData: tableFor(part), height: heightFor(part), ...fitted });
        const title = copy.elements.find(item => item.placeholder === "Click to add title" || item.placeholderRole === "title");
        if (title && typeof title.content === "string" && title.content.trim()) {
            title.content = `${title.content} (continued)`;
            delete title.textDocument;
            delete title._textDocumentSourceContent;
        }
        state.slides.splice(index + 1 + k, 0, copy);
    });
    renderSlidesFromState();
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
    if (typeof showNotification === "function") showNotification(`The table now continues over ${chunks.length} slides (${chunks.map(part => part.length).join(" + ")} rows), each with its header row.`, "success");
    return chunks.length;
}
