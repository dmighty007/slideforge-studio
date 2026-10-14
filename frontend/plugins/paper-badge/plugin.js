// Paper badge plugin: a small corner badge for a paper or preprint ("arXiv:2401.01234", a DOI or a link) with an
// optional QR code. It shows what you typed; nothing is looked up.
// The QR code library is the QR code plugin's (../qr-code/vendor/qrcode.js): this plugin needs that folder.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";

    let library = null;
    function loadQr(context) {
        if (!library) {
            library = (typeof window.qrcode === "function" ? Promise.resolve() : context.loadScript("../qr-code/vendor/qrcode.js"))
                .then(() => {
                    if (typeof window.qrcode !== "function") throw new Error("The QR code library did not load (it comes with the QR code plugin)");
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

    // What the badge shows and where its code leads: arXiv ids, DOIs and web links.
    function identify(text) {
        const value = String(text ?? "").trim();
        const arxiv = value.match(/^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?$/i);
        if (arxiv) return { kind: "arXiv", shown: `arXiv:${arxiv[1]}`, link: `https://arxiv.org/abs/${arxiv[1]}` };
        const doi = value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
        if (/^10\.\d{4,9}\/\S+$/.test(doi)) return { kind: "DOI", shown: `doi:${doi}`, link: `https://doi.org/${doi}` };
        if (/^https?:\/\/\S+$/i.test(value)) return { kind: "Link", shown: value.replace(/^https?:\/\//i, "").replace(/\/$/, ""), link: value };
        return null;
    }

    // The longest start of `text` (with "…") that fits `width`.
    function fit(text, width, style, context) {
        if (context.measureText(text, style) <= width) return text;
        let low = 0;
        let high = text.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (context.measureText(`${text.slice(0, mid)}…`, style) <= width) low = mid;
            else high = mid - 1;
        }
        return `${text.slice(0, low)}…`;
    }

    SlideForgePlugins.register({
        id: "paper-badge",
        version: "1",
        name: "Paper Badge",
        description: "A corner badge for a paper or preprint (arXiv id, DOI or link) with an optional QR code",
        icon: "fa-solid fa-certificate",
        insert: { label: "Paper badge (arXiv, DOI)", keywords: "badge arxiv doi preprint paper qr corner reference link" },
        defaultSize: { width: 300, height: 76 },
        sizeAware: true,
        defaultData: { id: "arXiv:2401.01234", title: "Preprint", qr: true, accent: "#b31b1b", style: "card" },
        fields: [
            { key: "id", label: "arXiv id, DOI or link", type: "text", primary: true, placeholder: "2401.01234, 10.1038/… or https://…" },
            { key: "title", label: "Heading", type: "text", placeholder: "e.g. Preprint, Nature 2024" },
            { key: "qr", label: "QR code", checkboxLabel: "Show a QR code to the paper", type: "checkbox" },
            { key: "accent", label: "Accent colour", type: "color" },
            {
                key: "style",
                label: "Look",
                type: "select",
                options: [
                    { value: "card", label: "Card (white, accent edge)" },
                    { value: "filled", label: "Filled with the accent colour" },
                ],
            },
        ],

        normalize(data) {
            return {
                id: String(data.id ?? "").trim().slice(0, 300),
                title: String(data.title ?? "").slice(0, 60),
                qr: data.qr !== false,
                accent: HEX_COLOR.test(String(data.accent || "")) ? data.accent : "#b31b1b",
                style: data.style === "filled" ? "filled" : "card",
            };
        },

        async render(data, context) {
            const found = identify(data.id);
            if (!found) throw new Error("Type an arXiv id (2401.01234), a DOI (10.…) or a web link");
            const { width, height } = context;
            const pad = Math.max(4, Math.round(height * 0.1));
            const filled = data.style === "filled";
            const background = filled ? data.accent : "#ffffff";
            const ink = filled ? "#ffffff" : "#111827";
            const parts = [`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${Math.min(10, height / 5)}" fill="${background}" stroke="${data.accent}" stroke-width="1"/>`];
            if (!filled) parts.push(`<rect x="0.5" y="0.5" width="${Math.max(4, height * 0.07).toFixed(1)}" height="${height - 1}" rx="2" fill="${data.accent}"/>`);
            const textLeft = filled ? pad * 1.5 : pad * 1.5 + height * 0.07;
            if (data.qr) {
                const qrcode = await loadQr(context);
                const qr = qrcode(0, "M");
                qr.addData(found.link);
                qr.make();
                const count = qr.getModuleCount();
                const side = height - 2 * pad;
                // Quiet zone of two modules on the code's own white square, so it scans on a filled badge too.
                const module = side / (count + 4);
                const qx = width - pad - side;
                parts.push(`<rect x="${qx.toFixed(2)}" y="${pad}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" fill="#ffffff"/>`);
                let path = "";
                for (let row = 0; row < count; row++) {
                    for (let col = 0; col < count; col++) {
                        if (!qr.isDark(row, col)) continue;
                        let run = 1;
                        while (col + run < count && qr.isDark(row, col + run)) run++;
                        path += `M${(qx + (col + 2) * module).toFixed(2)} ${(pad + (row + 2) * module).toFixed(2)}h${(run * module).toFixed(2)}v${module.toFixed(2)}h${(-run * module).toFixed(2)}z`;
                        col += run - 1;
                    }
                }
                parts.push(`<path d="${path}" fill="#000000" shape-rendering="crispEdges"/>`);
            }
            const textRight = data.qr ? width - (height - 2 * pad) - pad * 2 : width - pad * 1.5;
            const room = Math.max(10, textRight - textLeft);
            const heading = data.title || found.kind;
            const headingSize = Math.min(height * 0.3, 20);
            const idSize = Math.min(height * 0.24, 16);
            const headingStyle = { size: headingSize, weight: 700, family: FONT };
            const idStyle = { size: idSize, family: FONT };
            parts.push(`<text x="${textLeft.toFixed(1)}" y="${(height / 2 - headingSize * 0.15).toFixed(1)}" font-size="${headingSize.toFixed(1)}" font-weight="700" fill="${filled ? "#ffffff" : data.accent}">${context.escapeXml(fit(heading, room, headingStyle, context))}</text>`);
            parts.push(`<text x="${textLeft.toFixed(1)}" y="${(height / 2 + idSize * 1.05).toFixed(1)}" font-size="${idSize.toFixed(1)}" fill="${ink}">${context.escapeXml(fit(found.shown, room, idStyle, context))}</text>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
