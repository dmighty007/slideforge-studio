// Phylogenetic tree plugin: a rectangular tree drawn from Newick text, as a phylogram (branch lengths to scale, with
// a scale bar) or a cladogram (tips aligned). The tree fills the object's box; labels keep their size.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const MAX_TIPS = 500;

    // Newick → { name, length, children }. Comments in [brackets] are skipped; quoted names keep their spaces;
    // underscores in unquoted names are spaces.
    function parseNewick(text) {
        const source = String(text).replace(/\[[^\]]*\]/g, "").trim();
        if (!source) throw new Error("Paste a tree in Newick format, e.g. ((A:0.1,B:0.2):0.3,C:0.4);");
        let i = 0;
        let tips = 0;
        const fail = message => {
            throw new Error(`Newick, character ${i + 1}: ${message}`);
        };
        const skip = () => {
            while (i < source.length && /\s/.test(source[i])) i++;
        };
        const readName = () => {
            skip();
            if (source[i] === "'") {
                let name = "";
                i++;
                while (i < source.length) {
                    if (source[i] === "'" && source[i + 1] === "'") {
                        name += "'";
                        i += 2;
                    } else if (source[i] === "'") {
                        i++;
                        return name;
                    } else {
                        name += source[i++];
                    }
                }
                fail("a quoted name is not closed");
            }
            // Unquoted names may hold spaces too (strict Newick forbids them, but pasted trees often have them).
            let name = "";
            while (i < source.length && !/[(),:;]/.test(source[i])) name += source[i++];
            return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
        };
        const readLength = () => {
            skip();
            if (source[i] !== ":") return null;
            i++;
            skip();
            const match = source.slice(i).match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
            if (!match) fail("a branch length is not a number");
            i += match[0].length;
            return Number(match[0]);
        };
        const readNode = depth => {
            if (depth > 200) fail("the tree is nested too deeply");
            skip();
            const node = { name: "", length: null, children: [] };
            if (source[i] === "(") {
                i++;
                node.children.push(readNode(depth + 1));
                skip();
                while (source[i] === ",") {
                    i++;
                    node.children.push(readNode(depth + 1));
                    skip();
                }
                if (source[i] !== ")") fail("expected “,” or “)”");
                i++;
            } else {
                tips++;
                if (tips > MAX_TIPS) throw new Error(`Trees of up to ${MAX_TIPS} tips can be drawn`);
            }
            node.name = readName();
            node.length = readLength();
            return node;
        };
        const root = readNode(0);
        skip();
        if (source[i] === ";") i++;
        skip();
        if (i < source.length) fail("unexpected text after the tree");
        return root;
    }

    const tipsOf = node => (node.children.length ? node.children.flatMap(tipsOf) : [node]);
    const heightOf = node => (node.children.length ? 1 + Math.max(...node.children.map(heightOf)) : 0);

    // A round scale-bar length, about a quarter of the deepest branch.
    function scaleLength(maxDepth) {
        const target = maxDepth / 4;
        const magnitude = 10 ** Math.floor(Math.log10(target));
        return [5, 2, 1].map(f => f * magnitude).find(value => value <= target) || magnitude;
    }

    SlideForgePlugins.register({
        id: "phylo-tree",
        version: "1",
        name: "Phylogenetic Tree",
        description: "A tree from Newick text, as a phylogram or cladogram",
        icon: "fa-solid fa-sitemap",
        insert: { category: "Biology", label: "Phylogenetic tree (Newick)", keywords: "phylogenetic tree newick phylogeny evolution clade cladogram dendrogram" },
        defaultSize: { width: 420, height: 260 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            newick: "((Homo sapiens:0.0067,Pan troglodytes:0.0072)100:0.0101,(Gorilla gorilla:0.0085,(Pongo abelii:0.0172,Hylobates lar:0.0230)85:0.0040)92:0.0057);",
            layout: "phylogram",
            support: true,
            italic: true,
            fontSize: 14,
            lineWidth: 2,
            color: "",
        },
        fields: [
            { key: "newick", label: "Tree (Newick)", type: "textarea", placeholder: "((A:0.1,B:0.2):0.3,C:0.4);", hint: "Numbers after a “)” are shown as support values." },
            {
                key: "layout",
                label: "Layout",
                type: "select",
                options: [
                    { value: "phylogram", label: "Phylogram (branch lengths to scale)" },
                    { value: "cladogram", label: "Cladogram (tips aligned)" },
                ],
            },
            { key: "support", label: "Support values", checkboxLabel: "Show support values at nodes", type: "checkbox" },
            { key: "italic", label: "Tip names", checkboxLabel: "Italic (species names)", type: "checkbox" },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 6, max: 40, step: 1 },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 8, step: 0.5 },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                newick: String(data.newick ?? "").slice(0, 60000),
                layout: data.layout === "cladogram" ? "cladogram" : "phylogram",
                support: data.support !== false,
                italic: data.italic !== false,
                fontSize: number(data.fontSize, 14, 6, 40),
                lineWidth: number(data.lineWidth, 2, 0.5, 8),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const root = parseNewick(data.newick);
            const tips = tipsOf(root);
            if (tips.length < 2) throw new Error("A tree needs at least two tips");
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const hasLengths = tips.some(tip => tip.length !== null);
            const phylogram = data.layout === "phylogram" && hasLengths;

            // Depth of each node from the root: summed branch lengths, or levels with the tips aligned.
            const maxHeight = heightOf(root);
            const place = (node, depth) => {
                node.depth = phylogram ? depth : maxHeight - heightOf(node);
                node.children.forEach(child => place(child, phylogram ? depth + Math.max(0, child.length ?? 0) : 0));
            };
            place(root, 0);
            const maxDepth = Math.max(...tips.map(tip => tip.depth)) || 1;

            const labelStyle = { size, italic: data.italic, family: FONT };
            const labelWidth = Math.max(...tips.map(tip => context.measureText(tip.name, labelStyle)));
            const pad = Math.max(4, data.lineWidth);
            const stub = 10; // the root's own short branch
            const scaleBarHeight = phylogram ? size * 2 : 0;
            const plotLeft = pad + stub;
            const plotWidth = Math.max(20, width - plotLeft - labelWidth - size * 0.6 - pad);
            const top = pad + size * 0.6;
            const rowGap = Math.max(4, (height - top - pad - size * 0.6 - scaleBarHeight) / (tips.length - 1));
            const x = depth => plotLeft + (depth / maxDepth) * plotWidth;
            tips.forEach((tip, index) => {
                tip.y = top + index * rowGap;
            });
            const settle = node => {
                if (!node.children.length) return node.y;
                const ys = node.children.map(settle);
                node.y = (ys[0] + ys.at(-1)) / 2;
                return node.y;
            };
            settle(root);

            const lines = [`M${pad} ${root.y}H${x(root.depth)}`];
            const labels = [];
            const walk = node => {
                if (node.children.length) {
                    lines.push(`M${x(node.depth)} ${node.children[0].y}V${node.children.at(-1).y}`);
                    node.children.forEach(child => {
                        lines.push(`M${x(node.depth)} ${child.y}H${x(child.depth)}`);
                        walk(child);
                    });
                    if (data.support && node.name && node !== root) {
                        labels.push(
                            `<text x="${x(node.depth) - 3}" y="${node.y - 4}" font-size="${(size * 0.75).toFixed(1)}" text-anchor="end" fill="${ink}" opacity="0.8">${context.escapeXml(node.name)}</text>`,
                        );
                    }
                } else {
                    labels.push(
                        `<text x="${x(node.depth) + size * 0.4}" y="${node.y + size * 0.35}" font-size="${size}"${data.italic ? ' font-style="italic"' : ""} fill="${ink}">${context.escapeXml(node.name)}</text>`,
                    );
                }
            };
            walk(root);

            let scaleBar = "";
            if (phylogram) {
                const length = scaleLength(maxDepth);
                const y = height - pad - size * 0.9;
                const barWidth = (length / maxDepth) * plotWidth;
                scaleBar =
                    `<path d="M${plotLeft} ${y}H${plotLeft + barWidth}" stroke="${ink}" stroke-width="${data.lineWidth}"/>` +
                    `<text x="${plotLeft + barWidth / 2}" y="${y + size * 1.05}" font-size="${(size * 0.8).toFixed(1)}" text-anchor="middle" fill="${ink}">${length}</text>`;
            }
            return (
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">` +
                `<path d="${lines.join("")}" fill="none" stroke="${ink}" stroke-width="${data.lineWidth}" stroke-linecap="square"/>` +
                labels.join("") +
                scaleBar +
                "</svg>"
            );
        },
    });
})();
