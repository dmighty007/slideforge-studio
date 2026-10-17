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
        const fill = selected.length === 1 && plugin?.sizeAware;
        // A table takes the area's width; its height is its rows (a box stretched taller stretched every row). Scaled
        // like a picture, its rows were stretched to twice their height and its words looked tiny.
        if (selected.length === 1 && el.type === "table") {
            const rows = normalizeTableData(el.tableData).rowHeights.reduce((sum, value) => sum + (Number(value) || 44), 0);
            updateElementState(el.id, { x: area.x, y: area.y, width: area.width, height: `${Math.round(rows)}px` });
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
