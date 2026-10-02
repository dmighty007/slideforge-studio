function toPxNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
}

function isTextAutoHeightEnabled(data, dom) {
    if (data?.textFitMode === "autofit" || dom?.dataset?.textFitMode === "autofit") return false;
    if (data && typeof data.autoHeight === "boolean") return data.autoHeight;
    if (dom?.dataset?.autoHeight) return dom.dataset.autoHeight !== "false";
    return true;
}

function getTextFitMode(data, dom) {
    if (data?.textFitMode === "autofit") return "autofit";
    if (dom?.dataset?.textFitMode === "autofit") return "autofit";
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

    const fitsAt = size => {
        contentHost.style.setProperty("font-size", `${size}px`, "important");
        return (
            contentHost.scrollHeight <= contentHost.clientHeight + 1 &&
            contentHost.scrollWidth <= contentHost.clientWidth + 1
        );
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

    contentHost.style.setProperty("font-size", `${Math.round(best * 10) / 10}px`, "important");
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
