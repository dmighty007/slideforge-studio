// Document import: building text, image, equation and shape elements for generated slides.

function _makeTextElement({
    x,
    y,
    width,
    height = null,
    content,
    fontSize,
    fontWeight = "400",
    color = "#172033",
    fontFamily = '"Manrope", sans-serif',
    lineHeight = "1.4",
    textAlign = "left",
    autoHeight = true,
}) {
    return {
        id: generateId("el"),
        type: "text",
        x,
        y,
        width: `${width}px`,
        height: height == null ? "auto" : `${height}px`,
        autoHeight,
        textFitMode: autoHeight ? "autoHeight" : "fixed",
        content,
        styles: {
            color,
            fontSize: `${fontSize}px`,
            fontFamily,
            fontWeight,
            lineHeight,
            textAlign,
            zIndex: 2,
            backgroundColor: "transparent",
        },
    };
}

function _makeImageElement({ x, y, width, height, content }) {
    return {
        id: generateId("el"),
        type: "image",
        x,
        y,
        width: `${width}px`,
        height: `${height}px`,
        lockAspectRatio: true,
        imageAspectRatio: Math.max(0.01, width / Math.max(1, height)),
        content,
        styles: {
            zIndex: 2,
            borderRadius: "12px",
        },
    };
}

function _makeEquationElement({ x, y, width = 320, height = 88, latexSrc }) {
    let renderedHtml = latexSrc;
    try {
        if (typeof katex !== "undefined") {
            renderedHtml = katex.renderToString(latexSrc, { throwOnError: false, displayMode: true });
        }
    } catch (err) {
        renderedHtml = latexSrc;
    }
    return {
        id: generateId("el"),
        type: "equation",
        latexSrc,
        x,
        y,
        width: `${width}px`,
        height: `${height}px`,
        content: renderedHtml,
        styles: {
            color: "#172033",
            fontSize: "20px",
            zIndex: 3,
            backgroundColor: "rgba(255,255,255,0.9)",
            borderRadius: "12px",
            border: "1px solid rgba(148,163,184,0.22)",
        },
    };
}

function _makeShapeElement({
    x,
    y,
    width,
    height,
    backgroundColor,
    border = null,
    borderRadius = "0px",
    opacity = null,
    zIndex = 1,
}) {
    return {
        id: generateId("el"),
        type: "shape",
        shapeType: "rectangle",
        x,
        y,
        width: `${width}px`,
        height: `${height}px`,
        content: "",
        styles: {
            backgroundColor,
            ...(border ? { border } : {}),
            ...(opacity !== null ? { opacity: String(opacity) } : {}),
            borderRadius,
            zIndex,
        },
    };
}

function _normalizeImportedImagePath(rawPath) {
    const value = String(rawPath || "").trim();
    if (!value) return "";
    if (/^(data:|https?:\/\/|blob:|\/(?:assets|media|extracted_figures)\/|assets\/)/i.test(value)) {
        return value;
    }

    const normalized = value.replace(/\\/g, "/");
    const mediaIdx = normalized.lastIndexOf("/media/");
    if (mediaIdx !== -1) {
        return normalized.slice(mediaIdx);
    }
    const extractedIdx = normalized.lastIndexOf("/extracted_figures/");
    if (extractedIdx !== -1) {
        return normalized.slice(extractedIdx);
    }
    const fileName = normalized.split("/").pop();
    return fileName ? `/extracted_figures/${fileName}` : value;
}

function _buildBulletContent(points) {
    const rows = [];
    (Array.isArray(points) ? points : []).forEach(point => {
        const heading = _bridgeWordClamp(point?.heading, 7);
        const bullets = Array.isArray(point?.content) ? point.content : [point?.content];
        if (heading) {
            rows.push({ html: `<strong>${heading}</strong>`, level: 0 });
        }
        bullets
            .map(item => _bridgeWordClamp(item, 22))
            .filter(Boolean)
            .forEach(item => rows.push({ html: item, level: heading ? 1 : 0 }));
    });
    return rows.length ? rows : [{ html: "Imported content", level: 0 }];
}
