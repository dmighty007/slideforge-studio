// QR code plugin: a QR code for a link (paper, dataset, code, poster PDF), drawn by qrcode-generator
// (vendor/qrcode.js, MIT licence, loaded the first time a code is drawn).

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const LEVELS = ["L", "M", "Q", "H"];

    let library = null;
    function loadLibrary(context) {
        if (!library) {
            library = (typeof window.qrcode === "function" ? Promise.resolve() : context.loadScript("vendor/qrcode.js"))
                .then(() => {
                    if (typeof window.qrcode !== "function") throw new Error("The QR code library did not load");
                    // Links and captions may hold any character: encode text as UTF-8, which phones expect.
                    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
                    return window.qrcode;
                })
                .catch(error => {
                    library = null;
                    throw error;
                });
        }
        return library;
    }

    // A web link with letters outside ASCII is written percent-encoded (what browsers send anyway): codes carry no
    // character-set marker, and some scanners read UTF-8 bytes as Shift-JIS ("?ä=ü" came out as "?瓣=羹").
    function encodedText(text) {
        if (!/^https?:\/\//i.test(text) || /^[\x20-\x7e]*$/.test(text)) return text;
        try {
            return new URL(text).href;
        } catch (_error) {
            return text;
        }
    }

    const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    SlideForgePlugins.register({
        id: "qr-code",
        version: "2",
        name: "QR Code",
        description: "A QR code for a link to a paper, dataset, code or poster",
        icon: "fa-solid fa-qrcode",
        insert: { category: "Figures & references", label: "QR code", keywords: "qr code link url doi paper dataset scan poster" },
        defaultSize: { width: 180, height: 180 },
        defaultData: { text: "https://doi.org/", caption: "", level: "M", color: "#000000", background: "white", margin: 4 },
        fields: [
            { key: "text", label: "Link or text", type: "text", primary: true, placeholder: "https://doi.org/10.…", hint: "Press Enter to redraw." },
            { key: "caption", label: "Caption", type: "text", placeholder: "e.g. Scan for the paper" },
            {
                key: "level", advanced: true,
                label: "Error correction",
                type: "select",
                options: [
                    { value: "L", label: "Low (7%): smallest code" },
                    { value: "M", label: "Medium (15%)" },
                    { value: "Q", label: "Quartile (25%)" },
                    { value: "H", label: "High (30%): survives a logo or damage" },
                ],
            },
            { key: "color", advanced: true, label: "Code colour", type: "color" },
            {
                key: "background", advanced: true,
                label: "Background",
                type: "select",
                options: [
                    { value: "white", label: "White (scans best)" },
                    { value: "transparent", label: "None" },
                ],
            },
            { key: "margin", advanced: true, label: "Quiet zone (modules)", type: "number", min: 1, max: 8, step: 1, hint: "Scanners need a clear border; 4 is the standard." },
        ],

        normalize(data) {
            const margin = Math.round(Number(data.margin));
            return {
                text: String(data.text ?? "").slice(0, 2900),
                caption: String(data.caption ?? "").trim().slice(0, 80),
                level: LEVELS.includes(data.level) ? data.level : "M",
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "#000000",
                background: data.background === "transparent" ? "transparent" : "white",
                margin: Number.isFinite(margin) ? Math.min(8, Math.max(1, margin)) : 4,
            };
        },

        async render(data, context) {
            if (!data.text.trim()) throw new Error("Type the link or text the code should hold");
            const qrcode = await loadLibrary(context);
            const qr = qrcode(0, data.level); // 0: the smallest version that holds the text
            qr.addData(encodedText(data.text.trim()));
            try {
                qr.make();
            } catch (_error) {
                throw new Error("Too long for a QR code at this error correction; shorten the link or choose a lower level");
            }
            const count = qr.getModuleCount();
            const side = count + 2 * data.margin;
            // One path, with runs of dark modules along each row merged into a single rectangle.
            let path = "";
            for (let row = 0; row < count; row++) {
                for (let col = 0; col < count; col++) {
                    if (!qr.isDark(row, col)) continue;
                    let run = 1;
                    while (col + run < count && qr.isDark(row, col + run)) run++;
                    path += `M${col + data.margin} ${row + data.margin}h${run}v1h-${run}z`;
                    col += run - 1;
                }
            }
            // Drawn in units of a tenth of a module: text a few units high was laid out wider than it measures.
            const unit = 10;
            const width = side * unit;
            // The caption at about an eighth of the code's width (it was 9%: 8 pt under a code 144 px wide), smaller
            // only when a long caption would not fit across.
            let captionSize = width * 0.13;
            if (data.caption && typeof context?.measureText === "function") {
                const wide = context.measureText(data.caption, { size: captionSize, family: "Arial, Helvetica, sans-serif", weight: 600 });
                if (wide > width * 0.94) captionSize *= (width * 0.94) / wide;
            }
            const captionHeight = data.caption ? Math.max(40, captionSize * 1.6) : 0;
            const height = width + captionHeight;
            const background = data.background === "white" ? `<rect width="${width}" height="${height}" fill="#ffffff"/>` : "";
            const caption = data.caption
                ? `<text x="${width / 2}" y="${(width + captionHeight * 0.5).toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${captionSize.toFixed(1)}" font-weight="600" fill="${data.color}" text-anchor="middle" dominant-baseline="middle">${escapeXml(data.caption)}</text>`
                : "";
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${background}<path d="${path}" fill="${data.color}" transform="scale(${unit})"/>${caption}</svg>`;
        },
    });
})();
