// SMILES plugin: a 2D structure drawing of a molecule from its SMILES string, drawn by SmilesDrawer
// (vendor/smiles-drawer.min.js, MIT licence, loaded the first time a structure is drawn).

(() => {
    const ELEMENT_COLORS = {
        O: "#e74c3c",
        N: "#3498db",
        F: "#27ae60",
        CL: "#16a085",
        BR: "#d35400",
        I: "#8e44ad",
        P: "#d35400",
        S: "#d4a20b",
        B: "#e67e22",
        SI: "#e67e22",
    };
    // On light slides darker versions, readable at 4.5:1 or better (#3498db nitrogen was 2.9:1 on white); the bright
    // set above is for dark slides.
    const ELEMENT_COLORS_ON_LIGHT = {
        O: "#c0392b",
        N: "#1f5fa8",
        F: "#1e7b3c",
        CL: "#0e7561",
        BR: "#a64300",
        I: "#7d3c98",
        P: "#a64300",
        S: "#7a5f00",
        B: "#9a5200",
        SI: "#9a5200",
    };
    const isLightInk = hex => {
        const value = parseInt(hex.slice(1), 16);
        const [r, g, b] = [16, 8, 0].map(shift => (value >> shift) & 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
    };
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

    let drawerLibrary = null;
    function loadDrawer(context) {
        if (!drawerLibrary) {
            drawerLibrary = (window.SmilesDrawer ? Promise.resolve() : context.loadScript("vendor/smiles-drawer.min.js"))
                .then(() => {
                    if (!window.SmilesDrawer?.SvgDrawer) throw new Error("SmilesDrawer did not load");
                    return window.SmilesDrawer;
                })
                .catch(error => {
                    drawerLibrary = null;
                    throw error;
                });
        }
        return drawerLibrary;
    }

    function parseSmiles(SmilesDrawer, smiles) {
        return new Promise((resolve, reject) => {
            SmilesDrawer.parse(smiles, resolve, error =>
                reject(new Error(`Not a valid SMILES string: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 160)}`)),
            );
        });
    }

    // Halfway between a colour and grey, for hydrogens next to a carbon skeleton of that colour.
    function softened(hex) {
        const value = parseInt(hex.slice(1), 16);
        const mix = shift => Math.round(((value >> shift) & 255) * 0.6 + 128 * 0.4);
        return `#${[16, 8, 0].map(shift => mix(shift).toString(16).padStart(2, "0")).join("")}`;
    }

    function parseReaction(SmilesDrawer, smiles) {
        return new Promise((resolve, reject) => {
            SmilesDrawer.parseReaction(smiles, resolve, error =>
                reject(new Error(`Not a valid reaction SMILES: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 160)}`)),
            );
        });
    }

    const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
    const subscriptDigits = formula => String(formula).replace(/\d/g, digit => SUBSCRIPTS[Number(digit)]);
    const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    // A compound by name from PubChem: its SMILES (with stereochemistry), formula, weight and common name.
    async function lookUpName(name, context) {
        const url =
            "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" +
            encodeURIComponent(name) +
            "/property/SMILES,IsomericSMILES,MolecularFormula,MolecularWeight,Title/JSON";
        let answer;
        try {
            answer = await context.fetchJson(url);
        } catch (error) {
            if (error.status === 404 || error.status === 400) throw new Error(`PubChem has no compound called “${name}”`);
            throw error;
        }
        const found = answer?.PropertyTable?.Properties?.[0];
        const smiles = found?.SMILES || found?.IsomericSMILES;
        if (!smiles) throw new Error(`PubChem has no structure for “${name}”`);
        return {
            smiles: String(smiles),
            title: String(found.Title || name),
            formula: String(found.MolecularFormula || ""),
            weight: String(found.MolecularWeight || ""),
        };
    }

    // SmilesDrawer measures its labels, which needs the SVG in the page while it draws.
    function offscreenSvg() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;";
        document.body.appendChild(svg);
        return svg;
    }

    SlideForgePlugins.register({
        id: "smiles",
        version: "2",
        name: "Chemical Structure",
        description: "A 2D structure or reaction from SMILES, or a compound name looked up on PubChem",
        icon: "fa-solid fa-flask",
        insert: { category: "Chemistry", label: "Chemical structure (SMILES)", keywords: "smiles molecule 2d chemistry structure formula reaction pubchem name" },
        defaultSize: { width: 300, height: 220 },
        defaultData: {
            smiles: "CC(=O)Oc1ccccc1C(=O)O",
            lookupName: "",
            title: "",
            formula: "",
            weight: "",
            caption: "none",
            aboveArrow: "",
            belowArrow: "",
            color: "",
            atomColors: true,
            bondThickness: 1.2,
            terminalCarbons: false,
            explicitHydrogens: true,
        },
        fields: [
            {
                key: "smiles",
                label: "SMILES or compound name",
                type: "text",
                primary: true,
                placeholder: "c1ccccc1, caffeine, or A.B>>C for a reaction",
                hint: "A name is looked up on PubChem (needs the internet once). Reactions: reactants>agents>products. Press Enter to redraw.",
            },
            {
                key: "caption",
                label: "Caption",
                type: "select",
                options: [
                    { value: "none", label: "None" },
                    { value: "name", label: "Name" },
                    { value: "formula", label: "Formula" },
                    { value: "name-formula", label: "Name and formula" },
                    { value: "name-formula-weight", label: "Name, formula and molar mass" },
                ],
            },
            { key: "aboveArrow", label: "Above the arrow (reactions)", type: "text", placeholder: "The agents in the SMILES" },
            { key: "belowArrow", label: "Below the arrow (reactions)", type: "text", placeholder: "e.g. reflux, 2 h" },
            { key: "color", label: "Bond colour", type: "color", allowAuto: true },
            { key: "atomColors", label: "Atom colours", checkboxLabel: "Colour O, N, S… labels by element", type: "checkbox" },
            { key: "bondThickness", label: "Bond thickness", type: "number", min: 0.5, max: 4, step: 0.1 },
            { key: "terminalCarbons", label: "Terminal carbons", checkboxLabel: "Label terminal carbons (CH₃)", type: "checkbox" },
            { key: "explicitHydrogens", label: "Hydrogens", checkboxLabel: "Draw hydrogens written in the SMILES", type: "checkbox" },
        ],

        normalize(data) {
            const thickness = Number(data.bondThickness);
            const text = (value, limit) => String(value ?? "").trim().slice(0, limit);
            return {
                smiles: text(data.smiles, 2000),
                lookupName: text(data.lookupName, 200),
                title: text(data.title, 200),
                formula: text(data.formula, 80),
                weight: text(data.weight, 20),
                caption: ["none", "name", "formula", "name-formula", "name-formula-weight"].includes(data.caption) ? data.caption : "none",
                aboveArrow: text(data.aboveArrow, 120),
                belowArrow: text(data.belowArrow, 120),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                atomColors: data.atomColors !== false,
                bondThickness: Number.isFinite(thickness) ? Math.min(4, Math.max(0.5, thickness)) : 1.2,
                terminalCarbons: Boolean(data.terminalCarbons),
                explicitHydrogens: data.explicitHydrogens !== false,
            };
        },

        // After a lookup the field holds the SMILES it found; this says what the name was.
        status(data) {
            if (!data.lookupName || !data.title) return "";
            const formula = data.formula ? ` · ${subscriptDigits(data.formula)}` : "";
            const weight = data.weight ? ` · ${data.weight} g/mol` : "";
            return `Looked up on PubChem: “${data.lookupName}” is ${data.title}${formula}${weight}`;
        },

        // A new SMILES that is not valid SMILES is taken as a compound name and looked up; a valid one replaces
        // what an earlier lookup found. The lookup's answer is kept, so the drawing needs no internet afterwards.
        async prepare(data, previous, context) {
            // "Look up again": the name looked up before, again.
            if (context.refresh) return data.lookupName ? { ...data, ...(await lookUpName(data.lookupName, context)) } : data;
            if (!data.smiles || data.smiles === previous?.smiles || data.smiles.includes(">")) return data;
            const SmilesDrawer = await loadDrawer(context);
            const valid = await parseSmiles(SmilesDrawer, data.smiles).then(
                () => true,
                () => false,
            );
            if (valid) return { ...data, lookupName: "", title: "", formula: "", weight: "" };
            // Only text that reads as a name is looked up: spaces, or lower-case letters SMILES never uses
            // (b, c, n, o, p and s are its aromatic atoms). A broken SMILES such as "C1CC(" keeps its parse error.
            if (!/\s|[adefghijklmqrtuvwxyz]/.test(data.smiles)) return { ...data, lookupName: "", title: "", formula: "", weight: "" };
            const name = data.smiles;
            const found = await lookUpName(name, context).catch(error => {
                throw new Error(`“${name}” is not a SMILES string, and the PubChem lookup failed: ${error.message}`);
            });
            return { ...data, ...found, lookupName: name };
        },

        async render(data, context) {
            if (!data.smiles) throw new Error("Type a SMILES string or a compound name");
            const SmilesDrawer = await loadDrawer(context);
            const ink = HEX_COLOR.test(data.color) ? data.color : HEX_COLOR.test(context.textColor) ? context.textColor : "#222222";
            const palette = { FOREGROUND: ink, BACKGROUND: "transparent", C: ink, H: softened(ink) };
            Object.entries(isLightInk(ink) ? ELEMENT_COLORS : ELEMENT_COLORS_ON_LIGHT).forEach(([symbol, color]) => {
                palette[symbol] = data.atomColors ? color : ink;
            });
            const moleculeOptions = {
                bondThickness: data.bondThickness,
                terminalCarbons: data.terminalCarbons,
                explicitHydrogens: data.explicitHydrogens,
                themes: { slide: palette },
            };
            const isReaction = data.smiles.includes(">");
            const parsed = isReaction ? await parseReaction(SmilesDrawer, data.smiles) : await parseSmiles(SmilesDrawer, data.smiles);
            const svg = offscreenSvg();
            try {
                if (isReaction) {
                    const drawer = new SmilesDrawer.ReactionDrawer({ arrow: { thickness: data.bondThickness } }, moleculeOptions);
                    drawer.draw(parsed, svg, "slide", null, data.aboveArrow || "{reagents}", data.belowArrow || "");
                } else {
                    new SmilesDrawer.SvgDrawer(moleculeOptions).draw(parsed, svg, "slide");
                }
                const caption = [];
                const name = data.title || data.lookupName;
                if (data.caption.includes("name") && name) caption.push(name);
                if (data.caption.includes("formula") && data.formula) caption.push(subscriptDigits(data.formula));
                if (data.caption.includes("weight") && data.weight) caption.push(`${data.weight} g/mol`);
                if (caption.length && !isReaction) {
                    const box = svg.getBBox();
                    const size = Math.max(10, Math.min(18, box.width / 10));
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("x", String(box.x + box.width / 2));
                    text.setAttribute("y", String(box.y + box.height + size * 1.5));
                    text.setAttribute("font-family", "Arial, Helvetica, sans-serif");
                    text.setAttribute("font-size", String(size));
                    text.setAttribute("fill", ink);
                    text.setAttribute("text-anchor", "middle");
                    text.innerHTML = escapeXml(caption.join(" · "));
                    svg.appendChild(text);
                }
                // SmilesDrawer pads the drawing out to a square; crop it to what was drawn so the box fits it.
                const bounds = svg.getBBox();
                if (bounds.width > 0 && bounds.height > 0) {
                    const pad = 4;
                    svg.setAttribute("viewBox", `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`);
                }
                svg.removeAttribute("style");
                ["width", "height"].forEach(attribute => svg.removeAttribute(attribute));
                return new XMLSerializer().serializeToString(svg);
            } catch (error) {
                throw new Error(`Could not draw this ${isReaction ? "reaction" : "structure"}: ${error?.message || error}`);
            } finally {
                svg.remove();
            }
        },
    });
})();
