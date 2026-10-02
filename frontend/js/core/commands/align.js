// Commands: element box geometry and aligning the selection.

function _getElementNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function _getElementBox(el) {
    const x = _getElementNumber(el.x);
    const y = _getElementNumber(el.y);
    const width = _getElementNumber(el.width);
    const height = _getElementNumber(el.height);
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

function alignSelection(alignment) {
    if (state.selectedIds.length < 2) return;
    const slide = state.slides[currentSlideIndex];
    if (!slide) return;

    const units = _getSelectionAlignmentUnits(slide);
    if (units.length < 2) return;

    saveStateToUndo();

    const bounds = {
        minX: Math.min(...units.map(unit => unit.minX)),
        minY: Math.min(...units.map(unit => unit.minY)),
        maxX: Math.max(...units.map(unit => unit.maxX)),
        maxY: Math.max(...units.map(unit => unit.maxY)),
    };

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
