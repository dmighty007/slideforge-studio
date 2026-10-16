function toPxNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
}

// The element's own setting comes first: the node's data-text-fit-mode is from its last drawing, and right after a
// change from "Auto fit" it still said autofit, so the text was fitted once more at the shrunk size.
function isTextAutoHeightEnabled(data, dom) {
    if (data?.textFitMode === "autofit" || (!data?.textFitMode && dom?.dataset?.textFitMode === "autofit")) return false;
    if (data && typeof data.autoHeight === "boolean") return data.autoHeight;
    if (dom?.dataset?.autoHeight) return dom.dataset.autoHeight !== "false";
    return true;
}

function getTextFitMode(data, dom) {
    if (data?.textFitMode === "autofit") return "autofit";
    if (!data?.textFitMode && dom?.dataset?.textFitMode === "autofit") return "autofit";
    if (data?.autoHeight === true || dom?.dataset?.autoHeight === "true") return "autoHeight";
    if (data?.textFitMode === "fixed") return "fixed";
    return isTextAutoHeightEnabled(data, dom) ? "autoHeight" : "fixed";
}

function fitTextContentToBox(dom, data, contentHost) {
    const baseSize = Math.max(6, toPxNumber(data?.styles?.fontSize || window.getComputedStyle(dom).fontSize) || 24);
    const minSize = Math.max(6, Math.min(baseSize, Number(data?.minAutoFitFontSize) || 8));

    contentHost.style.height = "100%";
    contentHost.style.overflow = "hidden";
    contentHost.style.setProperty("font-size", `${baseSize}px`, "important");

    // Fit with 2 px to spare: a size that only just fit could lose its last line when fonts, zoom or rounding
    // moved the text by a pixel (a reopened deck showed two of three title lines). The text's own height is measured
    // with the host at its natural height (scrollHeight is never less than the box's).
    const available = contentHost.clientHeight;
    // A box that is not laid out (its slide is not the one shown) has no height to fit into: measured anyway, nothing
    // fitted and titles fell to the smallest size, which then stayed after reopening, in the show and in the PDF.
    // It keeps its own size and is fitted when its slide is shown.
    if (available <= 0 || !dom.getClientRects().length) {
        dom.dataset.fitPending = "true";
        return baseSize;
    }
    delete dom.dataset.fitPending;
    // The host is a stretched flex item, so it is also kept from growing or stretching while measured.
    const naturalHeight = () => {
        const saved = ["height", "flex", "align-self"].map(name => [name, contentHost.style.getPropertyValue(name), contentHost.style.getPropertyPriority(name)]);
        contentHost.style.setProperty("height", "auto", "important");
        contentHost.style.setProperty("flex", "none", "important");
        contentHost.style.setProperty("align-self", "flex-start", "important");
        const height = contentHost.scrollHeight;
        saved.forEach(([name, value, priority]) => (value ? contentHost.style.setProperty(name, value, priority) : contentHost.style.removeProperty(name)));
        return height;
    };
    const fitsAt = size => {
        contentHost.style.setProperty("font-size", `${size}px`, "important");
        return naturalHeight() <= available - 2 && contentHost.scrollWidth <= contentHost.clientWidth + 1;
    };

    let low = minSize;
    let high = baseSize;
    let best = minSize;
    if (fitsAt(baseSize)) {
        best = baseSize;
    } else {
        for (let i = 0; i < 10; i += 1) {
            const mid = (low + high) / 2;
            if (fitsAt(mid)) {
                best = mid;
                low = mid;
            } else {
                high = mid;
            }
        }
    }

    // Rounded down: rounded up, a size found to fit could no longer leave the room to spare.
    contentHost.style.setProperty("font-size", `${Math.floor(best * 10) / 10}px`, "important");
    while (
        best > minSize &&
        (contentHost.scrollHeight > contentHost.clientHeight + 1 ||
            contentHost.scrollWidth > contentHost.clientWidth + 1)
    ) {
        best = Math.max(minSize, best - 0.5);
        contentHost.style.setProperty("font-size", `${Math.round(best * 10) / 10}px`, "important");
    }
    if (
        contentHost.scrollHeight > contentHost.clientHeight + 1 ||
        contentHost.scrollWidth > contentHost.clientWidth + 1
    ) {
        best = minSize;
        contentHost.style.setProperty("font-size", `${minSize}px`, "important");
    }
    return best;
}

function syncTextBoxLayout(dom, data = null) {
    if (!dom || dom.getAttribute("data-type") !== "text") return null;
    const contentHost = dom.querySelector(".text-element-content");
    if (!contentHost) return null;

    const fitMode = getTextFitMode(data, dom);
    const autoHeight = isTextAutoHeightEnabled(data, dom);
    dom.dataset.autoHeight = autoHeight ? "true" : "false";
    dom.dataset.textFitMode = fitMode;
    // Lets list rows follow the box's alignment (a centred bullet stays beside its text).
    dom.dataset.textAlign = data?.styles?.textAlign || dom.style.textAlign || "left";

    if (fitMode === "autofit") {
        const effectiveFontSize = fitTextContentToBox(dom, data, contentHost);
        return {
            autoHeight: false,
            fitMode,
            height: toPxNumber(dom.style.height),
            effectiveFontSize,
        };
    }

    contentHost.style.overflow = "";
    contentHost.style.removeProperty("font-size");

    if (!autoHeight) {
        contentHost.style.height = "100%";
        return {
            autoHeight,
            fitMode,
            height: toPxNumber(dom.style.height),
        };
    }

    const computed = window.getComputedStyle(dom);
    const verticalInsets =
        toPxNumber(computed.paddingTop) +
        toPxNumber(computed.paddingBottom) +
        toPxNumber(computed.borderTopWidth) +
        toPxNumber(computed.borderBottomWidth);
    const minHeight = Math.max(40, verticalInsets + 24);

    const previousHeight = dom.style.height;
    const previousHostHeight = contentHost.style.height;
    const previousOverflow = contentHost.style.overflow;
    dom.style.height = "auto";
    contentHost.style.height = "auto";
    contentHost.style.overflow = "visible";

    const measured = Math.max(minHeight, Math.ceil(contentHost.scrollHeight + verticalInsets + 8));
    dom.style.height = `${measured}px`;
    contentHost.style.height = "";
    contentHost.style.overflow = previousOverflow || "";

    return {
        autoHeight,
        fitMode,
        height: measured,
        previousHeight,
        previousHostHeight,
    };
}

// Auto-fit boxes are fitted again once the theme's web fonts have loaded, and after the window changes size. Fitted
// before the fonts arrived (as when a deck is opened), the size suited a narrower fallback font, and with the real
// font the last line no longer fitted.
function refitAutofitTextBoxes() {
    if (typeof state === "undefined" || !state?.slides) return;
    const byId = new Map(state.slides.flatMap(slide => slide.elements || []).map(el => [el.id, el]));
    document.querySelectorAll('.canvas-element[data-type="text"][data-text-fit-mode="autofit"]').forEach(node => {
        const data = byId.get(node.id);
        if (data) syncTextBoxLayout(node, data);
    });
}

(() => {
    let timer = null;
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(refitAutofitTextBoxes, 120);
    };
    if (document.fonts) {
        document.fonts.ready.then(later);
        document.fonts.addEventListener?.("loadingdone", later);
    }
    window.addEventListener("resize", later);
    // A slide coming into view: its boxes could not be fitted while it was hidden.
    document.addEventListener("slidechanged", later);
    document.addEventListener("ready", later);
    window.addEventListener("slideforge:render-complete", () => document.fonts?.ready.then(later));
})();
