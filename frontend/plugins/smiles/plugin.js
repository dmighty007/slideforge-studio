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

    SlideForgePlugins.register({
        id: "smiles",
        version: "1",
        name: "Chemical Structure",
        description: "Draw a 2D structure from a SMILES string",
        icon: "fa-solid fa-flask",
        insert: { label: "Chemical structure (SMILES)", keywords: "smiles molecule 2d chemistry structure formula" },
        defaultSize: { width: 300, height: 220 },
        defaultData: {
            smiles: "CC(=O)Oc1ccccc1C(=O)O",
            color: "",
            atomColors: true,
            bondThickness: 1.2,
            terminalCarbons: false,
            explicitHydrogens: true,
        },
        fields: [
            {
                key: "smiles",
                label: "SMILES",
                type: "text",
                primary: true,
                placeholder: "e.g. c1ccccc1 (benzene)",
                hint: "Press Enter to redraw.",
            },
            { key: "color", label: "Bond colour", type: "color", allowAuto: true },
            { key: "atomColors", label: "Atom colours", checkboxLabel: "Colour O, N, S… labels by element", type: "checkbox" },
            { key: "bondThickness", label: "Bond thickness", type: "number", min: 0.5, max: 4, step: 0.1 },
            { key: "terminalCarbons", label: "Terminal carbons", checkboxLabel: "Label terminal carbons (CH₃)", type: "checkbox" },
            { key: "explicitHydrogens", label: "Hydrogens", checkboxLabel: "Draw hydrogens written in the SMILES", type: "checkbox" },
        ],

        normalize(data) {
            const thickness = Number(data.bondThickness);
            return {
                smiles: String(data.smiles ?? "").trim().slice(0, 2000),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                atomColors: data.atomColors !== false,
                bondThickness: Number.isFinite(thickness) ? Math.min(4, Math.max(0.5, thickness)) : 1.2,
                terminalCarbons: Boolean(data.terminalCarbons),
                explicitHydrogens: data.explicitHydrogens !== false,
            };
        },

        async render(data, context) {
            if (!data.smiles) throw new Error("Type a SMILES string to draw a structure");
            const SmilesDrawer = await loadDrawer(context);
            const tree = await parseSmiles(SmilesDrawer, data.smiles);
            const ink = HEX_COLOR.test(data.color) ? data.color : HEX_COLOR.test(context.textColor) ? context.textColor : "#222222";
            const palette = { FOREGROUND: ink, BACKGROUND: "transparent", C: ink, H: softened(ink) };
            Object.entries(ELEMENT_COLORS).forEach(([symbol, color]) => {
                palette[symbol] = data.atomColors ? color : ink;
            });
            const drawer = new SmilesDrawer.SvgDrawer({
                bondThickness: data.bondThickness,
                terminalCarbons: data.terminalCarbons,
                explicitHydrogens: data.explicitHydrogens,
                themes: { slide: palette },
            });
            // SmilesDrawer measures its labels, which needs the SVG in the page while it draws.
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;";
            document.body.appendChild(svg);
            try {
                drawer.draw(tree, svg, "slide");
                // SmilesDrawer pads the drawing out to a square; crop it to the molecule so the box fits it.
                const bounds = svg.getBBox();
                if (bounds.width > 0 && bounds.height > 0) {
                    const pad = 4;
                    svg.setAttribute(
                        "viewBox",
                        `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`,
                    );
                }
                svg.removeAttribute("style");
                return new XMLSerializer().serializeToString(svg);
            } catch (error) {
                throw new Error(`Could not draw this structure: ${error?.message || error}`);
            } finally {
                svg.remove();
            }
        },
    });
})();
