// Citation plugin: a formatted reference from a DOI. The details come from Crossref once, when the DOI is entered,
// and are kept with the deck, so the citation needs no internet afterwards. The text wraps to the box's width and
// the box takes the height of the text.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const STYLES = ["short", "nature", "apa", "acs"];
    const FONT = "Arial, Helvetica, sans-serif";

    // "https://doi.org/10.1/x", "doi:10.1/x" or "10.1/x" → "10.1/x"; anything else → null.
    function cleanDoi(value) {
        const text = String(value ?? "")
            .trim()
            .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
            .replace(/^doi:\s*/i, "");
        return /^10\.\d{4,9}\/\S+$/.test(text) ? text : null;
    }

    function fromCrossref(message) {
        const year = (message.issued || message["published-print"] || message["published-online"] || {})["date-parts"]?.[0]?.[0];
        const first = list => (Array.isArray(list) ? String(list[0] || "") : "");
        return {
            title: first(message.title).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
            journal: first(message["container-title"]),
            journalShort: first(message["short-container-title"]),
            year: year ? String(year) : "",
            volume: String(message.volume || ""),
            issue: String(message.issue || ""),
            pages: String(message.page || message["article-number"] || ""),
            authors: (message.author || []).slice(0, 60).map(author => ({
                given: String(author.given || ""),
                family: String(author.family || author.name || ""),
            })),
        };
    }

    const initials = (given, { spaced = true } = {}) =>
        given
            .split(/[\s-]+/)
            .filter(Boolean)
            .map(part => `${part[0].toUpperCase()}.`)
            .join(spaced ? " " : "");

    // Rich text as runs: { text, italic, bold }.
    function citationRuns(meta, doi, data) {
        const runs = [];
        const add = (text, style = {}) => text && runs.push({ text, ...style });
        const authors = meta.authors || [];
        const cut = data.maxAuthors > 0 && authors.length > data.maxAuthors;
        const shown = cut ? authors.slice(0, data.maxAuthors) : authors;
        const pages = meta.pages.replace(/-/g, "–");
        const journal = (data.style === "short" || data.style === "nature") && meta.journalShort ? meta.journalShort : meta.journal;
        if (data.style === "short") {
            const lead = authors[0]?.family || "";
            add(authors.length > 2 ? `${lead} et al., ` : authors.length === 2 ? `${lead} & ${authors[1].family}, ` : lead ? `${lead}, ` : "");
            add(journal, { italic: true });
            add(meta.volume ? ` ${meta.volume}` : "", { bold: true });
            add(pages ? `, ${pages.split("–")[0]}` : "");
            add(meta.year ? ` (${meta.year})` : "");
        } else if (data.style === "nature") {
            // Nature's rule: more than five authors → the first author et al.; otherwise all of them.
            const many = authors.length > 5;
            const names = (many ? authors.slice(0, 1) : authors).map(a => `${a.family}, ${initials(a.given)}`);
            add(names.length ? `${names.join(", ")}${many ? " et al." : ""} ` : "");
            add(meta.title ? `${meta.title}. ` : "");
            add(journal, { italic: true });
            add(meta.volume ? ` ${meta.volume}` : "", { bold: true });
            add(pages ? `, ${pages}` : "");
            add(meta.year ? ` (${meta.year}).` : ".");
        } else if (data.style === "acs") {
            const names = shown.map(a => `${a.family}, ${initials(a.given)}`);
            add(names.length ? `${names.join("; ")}${cut ? "; et al." : ""} ` : "");
            add(meta.title ? `${meta.title}. ` : "");
            add(journal, { italic: true });
            add(meta.year ? ` ${meta.year}` : "", { bold: true });
            add(meta.volume ? `, ` : "");
            add(meta.volume, { italic: true });
            add(pages ? `, ${pages}.` : ".");
        } else {
            // APA 7
            const names = shown.map(a => `${a.family}, ${initials(a.given)}`);
            const last = authors.at(-1);
            let list = names.join(", ");
            if (cut && last) list += `, … ${last.family}, ${initials(last.given)}`;
            else if (names.length > 1) list = `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
            add(list ? `${list} ` : "");
            add(meta.year ? `(${meta.year}). ` : "");
            add(meta.title ? `${meta.title}. ` : "");
            add(journal, { italic: true });
            add(meta.volume ? ", " : "");
            add(meta.volume, { italic: true });
            add(meta.issue ? `(${meta.issue})` : "");
            add(pages ? `, ${pages}.` : ".");
        }
        if (data.showDoi) add(` https://doi.org/${doi}`);
        return runs;
    }

    // Words placed on lines no wider than `width`, each word keeping its run's style.
    function layout(runs, width, size, context) {
        const lines = [[]];
        let x = 0;
        const space = context.measureText(" ", { size, family: FONT });
        runs.forEach(run => {
            const words = run.text.split(/(\s+)/);
            words.forEach(word => {
                if (!word) return;
                if (/^\s+$/.test(word)) {
                    if (x > 0) x += space;
                    return;
                }
                const style = { size, family: FONT, italic: Boolean(run.italic), weight: run.bold ? 700 : 400 };
                const wordWidth = context.measureText(word, style);
                if (x > 0 && x + wordWidth > width) {
                    lines.push([]);
                    x = 0;
                }
                lines.at(-1).push({ word, x, ...style });
                x += wordWidth;
            });
        });
        return lines.filter(line => line.length);
    }

    SlideForgePlugins.register({
        id: "citation",
        version: "2",
        name: "Citation",
        description: "A formatted reference from a DOI (details from Crossref)",
        icon: "fa-solid fa-book-open",
        insert: { category: "Figures & references", label: "Citation from DOI", keywords: "citation reference doi paper crossref bibliography footnote" },
        defaultSize: { width: 460, height: 60 },
        sizeAware: true,
        autoHeight: true,
        // 18 px: at 14 a reference was hard to read on a slide shown whole.
        footnote: true,
        defaultData: { doi: "", style: "nature", maxAuthors: 3, showDoi: false, fontSize: 18, color: "", meta: null },
        fields: [
            { key: "doi", label: "DOI", type: "text", primary: true, placeholder: "10.1038/… or https://doi.org/10.1038/…", hint: "Looked up on Crossref (needs the internet once). Press Enter to update." },
            {
                key: "style",
                label: "Style",
                type: "select",
                options: [
                    { value: "short", label: "Short (Jumper et al., Nature 596, 583 (2021))" },
                    { value: "nature", label: "Nature" },
                    { value: "apa", label: "APA" },
                    { value: "acs", label: "ACS" },
                ],
            },
            { key: "maxAuthors", label: "Authors listed before “et al.”", hint: "Nature style always follows its own rule: all authors up to five, else the first author et al.", type: "number", min: 1, max: 50, step: 1 },
            { key: "showDoi", label: "Link", checkboxLabel: "Add the doi.org link", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 48, step: 1 },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            const meta = data.meta && typeof data.meta === "object" ? data.meta : null;
            return {
                doi: String(data.doi ?? "").trim().slice(0, 300),
                style: STYLES.includes(data.style) ? data.style : "nature",
                maxAuthors: Math.round(number(data.maxAuthors, 3, 1, 50)),
                showDoi: Boolean(data.showDoi),
                fontSize: number(data.fontSize, 14, 8, 48),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                meta,
                metaDoi: meta ? String(data.metaDoi || "") : "",
            };
        },

        status(data) {
            if (!data.meta || !data.metaDoi) return "";
            const lead = data.meta.authors?.[0]?.family;
            return `From Crossref: ${lead ? `${lead}${data.meta.authors.length > 1 ? " et al." : ""}, ` : ""}${data.meta.year || ""} · ${data.meta.title || "untitled"}`;
        },

        async prepare(data, previous, context) {
            const doi = cleanDoi(data.doi);
            if (!data.doi) return { ...data, meta: null, metaDoi: "" };
            if (!doi) throw new Error("That does not look like a DOI (they start with 10.)");
            if (doi === data.metaDoi && data.meta && !context.refresh) return data;
            let answer;
            try {
                answer = await context.fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
            } catch (error) {
                if (error.status === 404) throw new Error(`Crossref does not know the DOI ${doi}`);
                throw error;
            }
            return { ...data, meta: fromCrossref(answer.message || {}), metaDoi: doi };
        },

        // In PowerPoint the reference is text a co-author can correct, not a picture.
        exportText(data) {
            const doi = cleanDoi(data.doi);
            if (!doi || !data.meta || data.metaDoi !== doi) return null;
            return { runs: citationRuns(data.meta, doi, data), fontSize: data.fontSize, color: data.color };
        },

        render(data, context) {
            const doi = cleanDoi(data.doi);
            if (!doi) throw new Error("Type the paper's DOI");
            if (!data.meta || data.metaDoi !== doi) throw new Error("The details for this DOI have not been looked up yet");
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const lineHeight = Math.round(size * 1.35);
            const lines = layout(citationRuns(data.meta, doi, data), Math.max(40, context.width), size, context);
            const height = Math.max(lineHeight, lines.length * lineHeight + Math.round(size * 0.35));
            const tspans = lines
                .map((line, index) =>
                    line
                        .map(
                            word =>
                                `<tspan x="${word.x.toFixed(1)}" y="${(index * lineHeight + size).toFixed(1)}"${word.italic ? ' font-style="italic"' : ""}${word.weight === 700 ? ' font-weight="700"' : ""}>${context.escapeXml(word.word)}</tspan>`,
                        )
                        .join(""),
                )
                .join("");
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${context.width} ${height}"><text font-family="${FONT}" font-size="${size}" fill="${ink}">${tspans}</text></svg>`;
        },
    });
})();
