// In-app lists for <select> dropdowns. In the desktop app the browser's own list is a native Qt popup that opened
// slowly and flickered. Each dropdown keeps its real <select> (its value and "change" events, which all the panels
// rely on); only the list that opens is drawn here. Opt out with data-native-select on the select or an ancestor.

let _sfSelectMenu = null;

function _sfSelectEligible(select) {
    return (
        select instanceof HTMLSelectElement &&
        !select.multiple &&
        (select.size || 0) <= 1 &&
        !select.disabled &&
        !select.closest("[data-native-select], .excalidraw")
    );
}

function closeSelectMenu({ refocus = false } = {}) {
    const open = _sfSelectMenu;
    if (!open) return;
    _sfSelectMenu = null;
    open.menu.remove();
    window.removeEventListener("resize", open.onViewportChange);
    document.removeEventListener("scroll", open.onScroll, true);
    open.select.removeAttribute("aria-expanded");
    if (refocus) open.select.focus({ preventScroll: true });
}

function _sfSelectChoose(select, value) {
    closeSelectMenu({ refocus: true });
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
}

function _sfSelectPlace(menu, select) {
    const rect = select.getBoundingClientRect();
    const margin = 6;
    menu.style.minWidth = `${Math.round(rect.width)}px`;
    menu.style.maxHeight = "";
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const natural = menu.scrollHeight;
    const openUp = natural > below && above > below;
    const room = Math.max(120, openUp ? above : below) - 4;
    menu.style.maxHeight = `${Math.min(natural, room, 360)}px`;
    const height = menu.getBoundingClientRect().height;
    const width = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.round(Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left)))}px`;
    menu.style.top = `${Math.round(openUp ? rect.top - height - 4 : rect.bottom + 4)}px`;
}

function openSelectMenu(select) {
    if (_sfSelectMenu?.select === select) {
        closeSelectMenu({ refocus: true });
        return;
    }
    closeSelectMenu();
    const menu = document.createElement("div");
    menu.className = "sf-select-menu";
    menu.setAttribute("role", "listbox");
    const items = [];
    const addOption = (option, parent) => {
        const item = document.createElement("div");
        item.className = "sf-select-menu__option";
        item.setAttribute("role", "option");
        item.textContent = option.textContent;
        item.dataset.value = option.value;
        if (option.disabled) item.setAttribute("aria-disabled", "true");
        if (option.value === select.value) {
            item.setAttribute("aria-selected", "true");
            item.classList.add("is-selected");
        }
        parent.appendChild(item);
        if (!option.disabled) items.push(item);
    };
    [...select.children].forEach(child => {
        if (child.tagName === "OPTGROUP") {
            const label = document.createElement("div");
            label.className = "sf-select-menu__group";
            label.textContent = child.label;
            menu.appendChild(label);
            [...child.children].forEach(option => addOption(option, menu));
        } else if (child.tagName === "OPTION") {
            addOption(child, menu);
        }
    });
    if (!items.length) return;

    let active = Math.max(0, items.findIndex(item => item.dataset.value === select.value));
    const setActive = index => {
        items[active]?.classList.remove("is-active");
        active = Math.max(0, Math.min(items.length - 1, index));
        items[active].classList.add("is-active");
        items[active].scrollIntoView({ block: "nearest" });
    };
    menu.addEventListener("mousedown", event => event.preventDefault()); // focus stays on the select
    menu.addEventListener("click", event => {
        const item = event.target.closest(".sf-select-menu__option");
        if (item && item.getAttribute("aria-disabled") !== "true") _sfSelectChoose(select, item.dataset.value);
    });
    menu.addEventListener("mousemove", event => {
        const index = items.indexOf(event.target.closest(".sf-select-menu__option"));
        if (index >= 0 && index !== active) setActive(index);
    });

    document.body.appendChild(menu);
    _sfSelectPlace(menu, select);
    setActive(active);
    select.setAttribute("aria-expanded", "true");
    const onViewportChange = () => closeSelectMenu();
    // Scrolling the page or a panel under the list closes it (the list would be left behind); scrolling the list does not.
    const onScroll = event => {
        if (!menu.contains(event.target)) closeSelectMenu();
    };
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("scroll", onScroll, true);
    _sfSelectMenu = { select, menu, items, onViewportChange, onScroll, get active() { return active; }, setActive };
}

document.addEventListener(
    "mousedown",
    event => {
        const select = event.target.closest?.("select");
        if (_sfSelectMenu && !_sfSelectMenu.menu.contains(event.target) && select !== _sfSelectMenu.select) closeSelectMenu();
        if (event.button !== 0 || !_sfSelectEligible(select)) return;
        event.preventDefault(); // no native popup
        select.focus({ preventScroll: true });
        openSelectMenu(select);
    },
    true,
);

document.addEventListener(
    "keydown",
    event => {
        const open = _sfSelectMenu;
        if (open && event.target === open.select) {
            const keys = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
            if (keys[event.key]) {
                event.preventDefault();
                open.setActive(open.active + keys[event.key]);
            } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                open.setActive(event.key === "Home" ? 0 : open.items.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                _sfSelectChoose(open.select, open.items[open.active].dataset.value);
            } else if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                }
                closeSelectMenu({ refocus: event.key === "Escape" });
            } else if (event.key.length === 1) {
                const start = open.active + 1;
                const key = event.key.toLowerCase();
                const order = [...open.items.slice(start), ...open.items.slice(0, start)];
                const match = order.find(item => item.textContent.trim().toLowerCase().startsWith(key));
                if (match) open.setActive(open.items.indexOf(match));
                event.preventDefault();
            }
            return;
        }
        // A closed dropdown opens with Alt+Down, Enter or Space; plain Up/Down step to the previous or next option
        // here (browsers differ: some opened their native list on an arrow key).
        const select = event.target;
        if (!_sfSelectEligible(select)) return;
        if ((event.altKey && event.key === "ArrowDown") || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openSelectMenu(select);
        } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey) {
            event.preventDefault();
            const options = [...select.options].filter(option => !option.disabled);
            const index = options.findIndex(option => option.value === select.value);
            const next = options[Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
            if (next && next.value !== select.value) {
                select.value = next.value;
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }
    },
    true,
);

document.addEventListener("focusout", event => {
    if (_sfSelectMenu && event.target === _sfSelectMenu.select) {
        // Clicking a list item keeps focus (mousedown is cancelled); anything else closes the list.
        setTimeout(() => {
            if (_sfSelectMenu && document.activeElement !== _sfSelectMenu.select) closeSelectMenu();
        }, 0);
    }
});

window.openSelectMenu = openSelectMenu;
window.closeSelectMenu = closeSelectMenu;
