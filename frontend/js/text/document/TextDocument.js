(function () {
    const TEXT_DOCUMENT_VERSION = 1;
    const BLOCK_TAGS = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6"]);
    const INLINE_MARK_STYLE_PROPS = new Set([
        "color",
        "backgroundColor",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "textDecoration",
        "verticalAlign",
    ]);

    function uid(prefix = "txt") {
        return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function kebab(prop) {
        return String(prop || "").replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
    }

    function cssValue(value) {
        const raw = String(value || "");
        return /(?:expression\s*\(|javascript:|data:text\/html|url\s*\()/i.test(raw) ? "" : raw;
    }

    function normalizeMarks(marks = []) {
        const result = [];
        const seen = new Set();
        (Array.isArray(marks) ? marks : []).forEach(mark => {
            if (!mark) return;
            const normalized = typeof mark === "string" ? { type: mark } : { ...mark };
            if (!normalized.type) return;
            const key = JSON.stringify(normalized);
            if (seen.has(key)) return;
            seen.add(key);
            result.push(normalized);
        });
        return result;
    }

    function normalizeRun(run = {}) {
        if (run.type && run.type !== "text") {
            return {
                id: run.id || uid("inline"),
                type: run.type,
                latex: typeof run.latex === "string" ? run.latex : "",
                altText: typeof run.altText === "string" ? run.altText : "",
                text: typeof run.text === "string" ? run.text : "",
                marks: normalizeMarks(run.marks),
            };
        }
        return {
            id: run.id || uid("run"),
            type: "text",
            text: typeof run.text === "string" ? run.text : "",
            marks: normalizeMarks(run.marks),
        };
    }

    function normalizeBlock(block = {}) {
        const type = ["paragraph", "heading", "listItem", "quote", "code", "caption"].includes(block.type)
            ? block.type
            : "paragraph";
        const children = Array.isArray(block.children) && block.children.length
            ? block.children.map(normalizeRun)
            : [normalizeRun({ text: "" })];
        return {
            id: block.id || uid("block"),
            type,
            level: type === "heading" ? Math.max(1, Math.min(6, Number(block.level) || 1)) : undefined,
            align: ["left", "center", "right", "justify"].includes(block.align) ? block.align : undefined,
            list: type === "listItem"
                ? {
                      kind: block.list?.kind === "numbered" ? "numbered" : "bullet",
                      style: block.list?.style || "default",
                      level: Math.max(0, Math.min(8, Number(block.list?.level) || 0)),
                      ordinal: Math.max(1, Number(block.list?.ordinal) || 1),
                  }
                : undefined,
            children,
        };
    }

    function normalizeTextDocument(doc = null) {
        if (!doc || typeof doc !== "object" || doc.type !== "document") {
            return {
                version: TEXT_DOCUMENT_VERSION,
                type: "document",
                blocks: [normalizeBlock({ type: "paragraph", children: [{ text: "" }] })],
            };
        }
        return {
            version: TEXT_DOCUMENT_VERSION,
            type: "document",
            metadata: doc.metadata && typeof doc.metadata === "object" ? { ...doc.metadata } : undefined,
            blocks: Array.isArray(doc.blocks) && doc.blocks.length
                ? doc.blocks.map(normalizeBlock)
                : [normalizeBlock({ type: "paragraph", children: [{ text: "" }] })],
        };
    }

    function markListFromElement(el, inherited = []) {
        const marks = [...inherited];
        const tag = el.tagName;
        const style = el.style || {};
        if (tag === "B" || tag === "STRONG" || style.fontWeight === "bold" || Number(style.fontWeight) >= 600) marks.push({ type: "bold" });
        if (tag === "I" || tag === "EM" || style.fontStyle === "italic") marks.push({ type: "italic" });
        const textDecoration = `${style.textDecoration || ""} ${style.textDecorationLine || ""}`;
        if (tag === "U" || textDecoration.includes("underline")) marks.push({ type: "underline" });
        if (tag === "S" || tag === "STRIKE" || textDecoration.includes("line-through")) marks.push({ type: "strike" });
        if (tag === "SUB" || style.verticalAlign === "sub") marks.push({ type: "subscript" });
        if (tag === "SUP" || style.verticalAlign === "super") marks.push({ type: "superscript" });
        if (tag === "CODE") marks.push({ type: "code" });
        if (tag === "A" && el.getAttribute("href")) marks.push({ type: "link", href: el.getAttribute("href") });

        const styleMark = {};
        INLINE_MARK_STYLE_PROPS.forEach(prop => {
            const cssProp = kebab(prop);
            const value = style.getPropertyValue(cssProp);
            if (value) styleMark[prop] = cssValue(value);
        });
        if (Object.keys(styleMark).length) marks.push({ type: "style", style: styleMark });
        return normalizeMarks(marks);
    }

    function runsFromNode(node, inheritedMarks = []) {
        if (!node) return [];
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent ? [normalizeRun({ text: node.textContent, marks: inheritedMarks })] : [];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return [];
        if (node.tagName === "BR") return [normalizeRun({ text: "\n", marks: inheritedMarks })];
        const marks = markListFromElement(node, inheritedMarks);
        return Array.from(node.childNodes || []).flatMap(child => runsFromNode(child, marks));
    }

    function splitRunsIntoBlocks(runs, base = {}) {
        const blocks = [];
        let current = [];
        runs.forEach(run => {
            const parts = String(run.text || "").split("\n");
            parts.forEach((part, index) => {
                if (index > 0) {
                    blocks.push(normalizeBlock({ ...base, children: current.length ? current : [{ text: "" }] }));
                    current = [];
                }
                if (part) current.push(normalizeRun({ ...run, text: part }));
            });
        });
        blocks.push(normalizeBlock({ ...base, children: current.length ? current : [{ text: "" }] }));
        return blocks;
    }

    function blockFromElement(el, fallbackList = null, ordinal = 1) {
        const tag = el.tagName;
        const align = ["left", "center", "right", "justify"].includes(el.style?.textAlign) ? el.style.textAlign : undefined;
        const headingMatch = tag.match(/^H([1-6])$/);
        const type = headingMatch ? "heading" : fallbackList ? "listItem" : "paragraph";
        const lastChild = el.lastChild;
        if (lastChild && lastChild.nodeType === Node.ELEMENT_NODE && lastChild.tagName === "BR") {
            lastChild.remove();
        }
        const runs = runsFromNode(el);
        const base = {
            type,
            level: headingMatch ? Number(headingMatch[1]) : undefined,
            align,
            list: fallbackList ? { ...fallbackList, ordinal } : undefined,
        };
        return splitRunsIntoBlocks(runs, base);
    }

    function textDocumentFromHtml(html = "", options = {}) {
        const template = document.createElement("template");
        template.innerHTML = typeof sanitizeTextHtml === "function" ? sanitizeTextHtml(String(html || "")) : String(html || "");
        const lastChild = template.content.lastChild;
        if (lastChild && lastChild.nodeType === Node.ELEMENT_NODE && lastChild.tagName === "BR") {
            lastChild.remove();
        }
        const blocks = [];
        let inlineRuns = [];
        const flushInline = () => {
            if (!inlineRuns.length) return;
            blocks.push(...splitRunsIntoBlocks(inlineRuns, { type: "paragraph" }));
            inlineRuns = [];
        };

        Array.from(template.content.childNodes || []).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                inlineRuns.push(normalizeRun({ text: node.textContent || "" }));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.tagName === "BR") {
                inlineRuns.push(normalizeRun({ text: "\n" }));
                return;
            }
            if (node.classList?.contains("ppt-bullet-block")) {
                flushInline();
                Array.from(node.querySelectorAll(".ppt-bullet-row")).forEach((row, index) => {
                    const textNode = row.querySelector(".ppt-bullet-text") || row;
                    const level = Math.max(0, Number(row.dataset.level) || Math.round((parseFloat(row.style.getPropertyValue("--bullet-indent")) || 0) / 20));
                    blocks.push(...blockFromElement(textNode, { kind: "bullet", style: node.dataset.bulletStyle || options.bulletStyle || "default", level }, index + 1));
                });
                return;
            }
            if (node.tagName === "UL" || node.tagName === "OL") {
                flushInline();
                // Nested lists are deeper levels of the same list (their text is not part of the parent item).
                const addListItems = (list, level, inheritedStyle) => {
                    const style = list.style?.listStyleType || inheritedStyle || options.bulletStyle || "default";
                    Array.from(list.children || []).forEach((li, index) => {
                        if (li.tagName !== "LI") return;
                        const nested = Array.from(li.children).filter(child => child.tagName === "UL" || child.tagName === "OL");
                        nested.forEach(child => child.remove());
                        blocks.push(...blockFromElement(li, {
                            kind: list.tagName === "OL" ? "numbered" : "bullet",
                            style,
                            level,
                        }, index + 1));
                        nested.forEach(child => addListItems(child, level + 1, style));
                    });
                };
                addListItems(node, 0, "");
                return;
            }
            if (BLOCK_TAGS.has(node.tagName)) {
                flushInline();
                blocks.push(...blockFromElement(node));
                return;
            }
            inlineRuns.push(...runsFromNode(node));
        });
        flushInline();

        return normalizeTextDocument({
            version: TEXT_DOCUMENT_VERSION,
            type: "document",
            blocks: blocks.length ? blocks : [normalizeBlock({ type: "paragraph", children: [{ text: "" }] })],
        });
    }

    function textDocumentFromLegacyContent(content, options = {}) {
        if (content && typeof content === "object" && content.type === "document") return normalizeTextDocument(content);
        if (
            typeof content === "string" &&
            typeof parseStringifiedStructuredBulletContent === "function"
        ) {
            const parsedStructured = parseStringifiedStructuredBulletContent(content);
            if (parsedStructured) {
                return textDocumentFromLegacyContent(parsedStructured, options);
            }
        }
        if (Array.isArray(content)) {
            return normalizeTextDocument({
                version: TEXT_DOCUMENT_VERSION,
                type: "document",
                blocks: content.map((item, index) => {
                    const html = typeof item?.html === "string" ? item.html : escapeHtml(item?.text || "");
                    const runs = runsFromNode(Object.assign(document.createElement("span"), {
                        innerHTML: typeof sanitizeTextHtml === "function" ? sanitizeTextHtml(html) : html,
                    }));
                    return {
                        type: "listItem",
                        list: {
                            kind: "bullet",
                            style: options.bulletStyle || "default",
                            level: Math.max(0, Number(item?.level) || 0),
                            ordinal: index + 1,
                        },
                        children: runs.length ? runs : [{ text: "" }],
                    };
                }),
            });
        }
        return textDocumentFromHtml(String(content || ""), options);
    }

    function markStyle(mark) {
        if (!mark) return "";
        if (mark.type === "bold") return "font-weight:700;";
        if (mark.type === "italic") return "font-style:italic;";
        if (mark.type === "underline") return "text-decoration:underline;";
        if (mark.type === "strike") return "text-decoration:line-through;";
        if (mark.type === "subscript") return "vertical-align:sub;font-size:0.72em;";
        if (mark.type === "superscript") return "vertical-align:super;font-size:0.72em;";
        if (mark.type === "code") return "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";
        if (mark.type === "style" && mark.style) {
            return Object.entries(mark.style)
                .map(([prop, value]) => `${kebab(prop)}:${cssValue(value)};`)
                .join("");
        }
        return "";
    }

    function renderRunHtml(run = {}) {
        const text = run.type === "inlineEquation" ? run.altText || run.latex || "" : run.text || "";
        let html = escapeHtml(text);
        const style = normalizeMarks(run.marks).map(markStyle).join("");
        if (style) html = `<span style="${escapeHtml(style)}">${html}</span>`;
        const link = normalizeMarks(run.marks).find(mark => mark.type === "link" && mark.href);
        if (link && !/^\s*(?:javascript|vbscript|data):/i.test(String(link.href).replace(/[\u0000-\u001f]/g, ""))) html = `<a href="${escapeHtml(link.href)}">${html}</a>`;
        return html;
    }

    function textDocumentToHtml(doc = null, options = {}) {
        const normalized = normalizeTextDocument(doc);
        const bulletStyle = options.bulletStyle || "default";
        const parts = [];
        let pendingListRows = [];
        let pendingListStyle = "";
        let pendingListKind = "";

        const flushList = () => {
            if (!pendingListRows.length) return;
            if (pendingListKind === "numbered") {
                const listStyle = `list-style-type:${escapeHtml(pendingListStyle || "decimal")};margin:0;padding-left:1.5em;line-height:inherit;`;
                let html = `<ol class="ppt-numbered-block" style="${listStyle}width:100%;text-align:inherit;">`;
                let depth = 0;
                pendingListRows.forEach((row, index) => {
                    const level = Math.min(row.level, depth + 1);
                    if (index > 0 && level > depth) {
                        html += `<ol style="${listStyle}">`;
                    } else {
                        if (index > 0) html += "</li>";
                        for (; depth > level; depth--) html += "</ol></li>";
                    }
                    depth = level;
                    html += `<li style="margin:0;padding:0;line-height:inherit;">${row.inner}`;
                });
                html += "</li>";
                for (; depth > 0; depth--) html += "</ol></li>";
                parts.push(`${html}</ol>`);
            } else {
                parts.push(
                    `<div class="ppt-bullet-block" data-list-kind="bullet" data-bullet-style="${escapeHtml(pendingListStyle || bulletStyle)}">${pendingListRows.join("")}</div>`,
                );
            }
            pendingListRows = [];
            pendingListStyle = "";
            pendingListKind = "";
        };

        normalized.blocks.forEach(block => {
            const inner = block.children.map(renderRunHtml).join("") || "<br>";
            if (block.type === "listItem") {
                const style = block.list?.style || bulletStyle;
                const kind = block.list?.kind === "numbered" ? "numbered" : "bullet";
                const level = Math.max(0, Number(block.list?.level) || 0);
                let glyph = "•";
                let indent = level * 20;
                let color = "inherit";
                let fontSizeScale = 1;
                if (kind === "bullet" && typeof getLevelStyle === "function" && typeof getBulletGlyph === "function") {
                    const levelStyle = getLevelStyle(style, level);
                    glyph = getBulletGlyph(levelStyle) || "•";
                    color = levelStyle.color || "inherit";
                    fontSizeScale = Number(levelStyle.fontSize) || 1;
                    if (typeof getBulletIndent === "function") {
                        indent = getBulletIndent(level, levelStyle);
                    }
                }
                if (pendingListRows.length && (pendingListStyle !== style || pendingListKind !== kind)) {
                    flushList();
                }
                if (!pendingListStyle) pendingListStyle = style;
                if (!pendingListKind) pendingListKind = kind;
                if (kind === "numbered") {
                    pendingListRows.push({ level, inner });
                } else {
                    pendingListRows.push(
                        `<div class="ppt-bullet-row" data-level="${level}" style="--bullet-indent:${indent}px;--bullet-color:${color};--bullet-font-scale:${fontSizeScale};"><span class="ppt-bullet-marker">${escapeHtml(glyph)}</span><span class="ppt-bullet-text">${inner}</span></div>`,
                    );
                }
                return;
            }

            flushList();
            if (block.type === "heading") parts.push(`<h${block.level || 1}>${inner}</h${block.level || 1}>`);
            else if (block.type === "caption") parts.push(`<p class="ppt-caption">${inner}</p>`);
            else if (block.type === "code") parts.push(`<pre><code>${inner}</code></pre>`);
            else parts.push(inner);
        });
        flushList();

        return parts.join("<br>");
    }

    function textDocumentToPlainText(doc = null) {
        return normalizeTextDocument(doc)
            .blocks
            .map(block => block.children.map(run => run.text || run.altText || run.latex || "").join(""))
            .join("\n");
    }

    function runStyle(baseStyle = {}, marks = []) {
        const style = { ...baseStyle };
        normalizeMarks(marks).forEach(mark => {
            if (mark.type === "bold") style.fontWeight = "700";
            if (mark.type === "italic") style.fontStyle = "italic";
            if (mark.type === "underline") style.textDecoration = "underline";
            if (mark.type === "strike") style.textDecoration = "line-through";
            if (mark.type === "style" && mark.style) Object.assign(style, mark.style);
            if (mark.type === "code") style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
        });
        return style;
    }

    function estimateWidth(text, style = {}) {
        const size = parseFloat(style.fontSize) || 24;
        const weightFactor = String(style.fontWeight || "").match(/bold|[6-9]00/) ? 0.61 : 0.56;
        return String(text || "").length * size * weightFactor;
    }

    function layoutTextDocument(doc = null, box = {}, style = {}) {
        const normalized = normalizeTextDocument(doc);
        const fontSize = parseFloat(style.fontSize) || 24;
        const lineHeightPx = fontSize * (parseFloat(style.lineHeight) || 1.2);
        const maxWidth = Math.max(24, Number(box.width) || 240);
        const lines = [];

        normalized.blocks.forEach((block, blockIndex) => {
            let current = { x: 0, y: lines.length * lineHeightPx + fontSize, runs: [], block };
            const pushLine = () => {
                lines.push(current);
                current = { x: 0, y: lines.length * lineHeightPx + fontSize, runs: [], block };
            };
            const bulletIndent = block.type === "listItem" ? (Number(block.list?.level) || 0) * 20 + fontSize * 1.65 : 0;
            current.x = bulletIndent;
            block.children.forEach(run => {
                const effectiveStyle = runStyle(style, run.marks);
                String(run.text || run.altText || run.latex || "")
                    .split(/(\s+)/)
                    .filter(part => part.length)
                    .forEach(part => {
                        const width = estimateWidth(part, effectiveStyle);
                        const used = current.runs.reduce((sum, item) => sum + item.width, 0);
                        if (used + width > maxWidth - current.x && current.runs.length) pushLine();
                        current.runs.push({ text: part, width, style: effectiveStyle, sourceRunId: run.id });
                    });
            });
            if (current.runs.length || blockIndex === normalized.blocks.length - 1) pushLine();
        });

        return {
            type: "textBox",
            version: 1,
            bounds: box,
            fontSize,
            lineHeightPx,
            lines,
            height: Math.max(lineHeightPx, lines.length * lineHeightPx),
        };
    }

    function ensureElementTextDocument(element) {
        if (!element || element.type !== "text" || element.iconMode) return null;
        const contentStr = typeof element.content === "object" ? JSON.stringify(element.content) : String(element.content || "");
        if (!element.textDocument || contentStr !== element._textDocumentSourceContent) {
            element.textDocument = normalizeTextDocument(textDocumentFromLegacyContent(element.content, { bulletStyle: element.bulletStyle }));
            element._textDocumentSourceContent = contentStr;
        } else {
            element.textDocument = normalizeTextDocument(element.textDocument);
        }
        return element.textDocument;
    }

    window.SlideForgeText = {
        TEXT_DOCUMENT_VERSION,
        normalizeTextDocument,
        textDocumentFromHtml,
        textDocumentFromLegacyContent,
        textDocumentToHtml,
        textDocumentToPlainText,
        layoutTextDocument,
        ensureElementTextDocument,
    };
    window.createTextDocumentFromLegacyContent = textDocumentFromLegacyContent;
    window.renderSemanticTextDocumentToHtml = textDocumentToHtml;
    window.textDocumentToPlainText = textDocumentToPlainText;
    window.ensureElementTextDocument = ensureElementTextDocument;
})();
