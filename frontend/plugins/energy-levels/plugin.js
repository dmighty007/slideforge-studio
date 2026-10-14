// Energy diagram plugin, two kinds:
// - Reaction profile: states and transition states along a reaction coordinate (label, energy, optional pathway),
//   level bars joined by dashed lines or a smooth curve, energies written on the bars.
// - Levels: Jablonski or MO-style levels (label, energy, column) with transitions between them (from, to, kind):
//   absorption and emission as solid arrows, non-radiative steps (IC, ISC, relaxation) as dashed ones.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const PATH_COLORS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"];
    const KINDS = {
        absorption: { color: "#2563eb", dashed: false, label: "abs" },
        fluorescence: { color: "#16a34a", dashed: false, label: "fl" },
        phosphorescence: { color: "#dc2626", dashed: false, label: "ph" },
        emission: { color: "#16a34a", dashed: false, label: "em" },
        isc: { color: null, dashed: true, label: "ISC" },
        ic: { color: null, dashed: true, label: "IC" },
        relaxation: { color: null, dashed: true, label: "" },
        transition: { color: null, dashed: false, label: "" },
    };
    const KIND_ALIASES = { abs: "absorption", fl: "fluorescence", fluo: "fluorescence", ph: "phosphorescence", phos: "phosphorescence", em: "emission", vr: "relaxation", nr: "relaxation", "": "transition" };

    const number = cell => {
        const value = Number(String(cell ?? "").trim().replace(",", ".").replace("−", "-"));
        return String(cell ?? "").trim() !== "" && Number.isFinite(value) ? value : null;
    };
    const format = value => {
        const rounded = Number(value.toFixed(2));
        return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + String(Math.abs(rounded));
    };

    function readProfile(rows) {
        const states = [];
        rows.forEach((row, index) => {
            const [label = "", energyText = "", path = ""] = row;
            const energy = number(energyText);
            if (index === 0 && energy === null) return; // a header row
            if (energy === null) throw new Error(`Row ${index + 1}: “${energyText}” is not an energy`);
            states.push({ label, energy, path: path || "main" });
        });
        if (states.length < 2) throw new Error("Add at least two states: label, energy (and a pathway name to compare routes)");
        return states;
    }

    function readLevels(rows) {
        const levels = [];
        rows.forEach((row, index) => {
            const [label = "", energyText = "", columnText = ""] = row;
            const energy = number(energyText);
            if (index === 0 && energy === null) return;
            if (energy === null) throw new Error(`Levels, row ${index + 1}: “${energyText}” is not an energy`);
            const column = number(columnText);
            levels.push({ label, energy, column: column === null ? 1 : Math.max(1, Math.round(column)) });
        });
        if (!levels.length) throw new Error("Add levels: label, energy, column (e.g. S0,0,1)");
        return levels;
    }

    function readTransitions(rows, levels) {
        const find = label => levels.find(level => level.label.toLowerCase() === label.trim().toLowerCase());
        const transitions = [];
        rows.forEach((row, index) => {
            const [fromText = "", toText = "", kindText = ""] = row;
            if (index === 0 && /^from$/i.test(fromText.trim())) return;
            const from = find(fromText);
            const to = find(toText);
            if (!from || !to) throw new Error(`Transitions, row ${index + 1}: “${!from ? fromText : toText}” is not one of the levels`);
            const key = kindText.trim().toLowerCase();
            const kind = KINDS[key] ? key : KIND_ALIASES[key] || "transition";
            transitions.push({ from, to, kind, text: KINDS[key] || KIND_ALIASES[key] !== undefined ? "" : kindText.trim() });
        });
        return transitions;
    }

    SlideForgePlugins.register({
        id: "energy-levels",
        version: "1",
        name: "Energy Diagram",
        description: "A reaction energy profile, or Jablonski/MO energy levels with transitions",
        icon: "fa-solid fa-stairs",
        insert: { label: "Energy diagram (profile, Jablonski)", keywords: "energy level diagram reaction profile coordinate transition state jablonski molecular orbital mo fluorescence" },
        defaultSize: { width: 520, height: 300 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            kind: "profile",
            profile: "State,Energy,Pathway\nReactants,0\nTS1,18.4\nIntermediate,4.2\nTS2,12.7\nProducts,-9.6",
            levels: "Level,Energy,Column\nS0,0,1\nS1,3.1,1\nS2,4.4,1\nT1,2.4,2",
            transitions: "From,To,Kind\nS0,S2,absorption\nS2,S1,IC\nS1,S0,fluorescence\nS1,T1,ISC\nT1,S0,phosphorescence",
            curve: false,
            showValues: true,
            yLabel: "ΔG (kcal/mol)",
            color: "",
            fontSize: 14,
        },
        fields: [
            {
                key: "kind",
                label: "Diagram",
                type: "select",
                options: [
                    { value: "profile", label: "Reaction profile" },
                    { value: "levels", label: "Levels and transitions (Jablonski, MO)" },
                ],
            },
            { key: "profile", label: "Profile states", type: "table", columns: ["State", "Energy", "Pathway (optional)"], rows: 6, hint: "In order along the reaction. Name pathways in the third column to compare routes." },
            { key: "curve", label: "Profile line", checkboxLabel: "Smooth curve instead of dashed connectors", type: "checkbox" },
            { key: "levels", label: "Levels", type: "table", columns: ["Level", "Energy", "Column"], rows: 5, hint: "For the levels diagram; columns place levels side by side (e.g. singlets 1, triplets 2)." },
            { key: "transitions", label: "Transitions", type: "table", columns: ["From", "To", "Kind"], rows: 5, hint: "Kinds: absorption, fluorescence, phosphorescence, emission, IC, ISC, relaxation, or any label." },
            { key: "showValues", label: "Values", checkboxLabel: "Write the energies on the levels", type: "checkbox" },
            { key: "yLabel", label: "Energy axis label", type: "text", placeholder: "e.g. ΔG (kcal/mol) or E (eV)" },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
        ],

        normalize(data) {
            const fontSize = Number(data.fontSize);
            return {
                kind: data.kind === "levels" ? "levels" : "profile",
                profile: String(data.profile ?? ""),
                levels: String(data.levels ?? ""),
                transitions: String(data.transitions ?? ""),
                curve: Boolean(data.curve),
                showValues: data.showValues !== false,
                yLabel: String(data.yLabel ?? "").slice(0, 60),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, fontSize)) : 14,
            };
        },

        render(data, context) {
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const levelsMode = data.kind === "levels";
            const states = levelsMode ? readLevels(context.parseTable(data.levels)) : readProfile(context.parseTable(data.profile));
            const energies = states.map(state => state.energy);
            const span = Math.max(...energies) - Math.min(...energies) || 1;
            const low = Math.min(...energies) - span * 0.08;
            const high = Math.max(...energies) + span * 0.08;
            const left = (data.yLabel ? size * 1.8 : size * 0.6) + size * 0.4;
            const top = size * 2.2;
            const bottom = size * 2.2;
            const plotWidth = Math.max(60, width - left - size * 0.6);
            const plotHeight = Math.max(40, height - top - bottom);
            const y = energy => top + plotHeight - ((energy - low) / (high - low)) * plotHeight;
            const parts = [];
            // The energy axis: an arrow up the left side.
            parts.push(`<path d="M${left} ${top + plotHeight}V${top - size * 0.6}" stroke="${ink}" stroke-width="1.5" fill="none"/><path d="M${left - 4} ${top - size * 0.2}L${left} ${top - size * 0.9}L${left + 4} ${top - size * 0.2}Z" fill="${ink}"/>`);
            if (data.yLabel) {
                parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}</text>`);
            }
            const bar = (x0, x1, energy, color) => parts.push(`<line x1="${x0.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${y(energy).toFixed(1)}" y2="${y(energy).toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`);
            const text = (x, yy, content, extra = "") => parts.push(`<text x="${x.toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}"${extra}>${context.escapeXml(content)}</text>`);

            if (!levelsMode) {
                const paths = [...new Set(states.map(state => state.path))];
                const steps = Math.max(...paths.map(path => states.filter(state => state.path === path).length));
                const slot = plotWidth / steps;
                const barHalf = Math.min(slot * 0.3, size * 2.6);
                const named = new Set();
                paths.forEach((path, pathIndex) => {
                    const color = paths.length > 1 ? PATH_COLORS[pathIndex % PATH_COLORS.length] : ink;
                    const route = states.filter(state => state.path === path).map((state, index) => ({ ...state, x: left + slot * (index + 0.5) }));
                    if (data.curve) {
                        // A smooth line through the level centres (Catmull–Rom as cubic Béziers).
                        let d = `M${route[0].x - barHalf} ${y(route[0].energy)}H${route[0].x}`;
                        route.slice(1).forEach((point, i) => {
                            const p0 = route[Math.max(0, i - 1)];
                            const p1 = route[i];
                            const p3 = route[Math.min(route.length - 1, i + 2)];
                            const c1 = [p1.x + (point.x - p0.x) / 6, y(p1.energy) + (y(point.energy) - y(p0.energy)) / 6];
                            const c2 = [point.x - (p3.x - p1.x) / 6, y(point.energy) - (y(p3.energy) - y(p1.energy)) / 6];
                            d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${point.x.toFixed(1)} ${y(point.energy).toFixed(1)}`;
                        });
                        d += `H${route.at(-1).x + barHalf}`;
                        parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`);
                    } else {
                        route.slice(1).forEach((point, i) => {
                            const previous = route[i];
                            parts.push(`<line x1="${(previous.x + barHalf).toFixed(1)}" y1="${y(previous.energy).toFixed(1)}" x2="${(point.x - barHalf).toFixed(1)}" y2="${y(point.energy).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4"/>`);
                        });
                        route.forEach(point => bar(point.x - barHalf, point.x + barHalf, point.energy, color));
                    }
                    route.forEach(point => {
                        const yy = y(point.energy);
                        // A state shared by several pathways (same place, same name) is named once.
                        const key = `${point.x.toFixed(0)}|${point.label}`;
                        if (!named.has(key)) text(point.x, yy + size * 1.25, point.label);
                        named.add(key);
                        if (data.showValues) text(point.x, yy - size * 0.45, format(point.energy), ' font-weight="700"');
                    });
                });
                if (paths.length > 1) {
                    paths.forEach((path, index) => {
                        const x = left + size + index * (plotWidth / paths.length);
                        parts.push(`<line x1="${x}" x2="${x + size * 1.4}" y1="${size * 0.7}" y2="${size * 0.7}" stroke="${PATH_COLORS[index % PATH_COLORS.length]}" stroke-width="3"/>`);
                        parts.push(`<text x="${x + size * 1.8}" y="${size * 1.05}" font-size="${size * 0.9}" fill="${ink}">${context.escapeXml(path)}</text>`);
                    });
                }
            } else {
                const transitions = readTransitions(context.parseTable(data.transitions), states);
                const columns = Math.max(...states.map(state => state.column));
                const slot = plotWidth / columns;
                const barHalf = slot * 0.36;
                const centre = state => left + slot * (state.column - 0.5);
                states.forEach(state => {
                    bar(centre(state) - barHalf, centre(state) + barHalf, state.energy, ink);
                    parts.push(`<text x="${(centre(state) + barHalf + size * 0.3).toFixed(1)}" y="${(y(state.energy) + size * 0.35).toFixed(1)}" font-size="${size}" font-weight="700" fill="${ink}">${context.escapeXml(state.label)}</text>`);
                    if (data.showValues) parts.push(`<text x="${(centre(state) - barHalf - size * 0.3).toFixed(1)}" y="${(y(state.energy) + size * 0.35).toFixed(1)}" font-size="${(size * 0.8).toFixed(1)}" text-anchor="end" fill="${ink}" fill-opacity="0.75">${Number(state.energy.toFixed(2))}</text>`);
                });
                // Arrows spread across their levels' width so they do not sit on top of each other.
                const lanes = new Map();
                transitions.forEach(transition => {
                    const key = transition.from.column === transition.to.column ? `c${transition.from.column}` : "between";
                    lanes.set(key, (lanes.get(key) || 0) + 1);
                });
                const used = new Map();
                transitions.forEach(transition => {
                    const style = KINDS[transition.kind];
                    const color = style.color || ink;
                    const same = transition.from.column === transition.to.column;
                    const key = same ? `c${transition.from.column}` : "between";
                    const count = lanes.get(key);
                    const index = used.get(key) || 0;
                    used.set(key, index + 1);
                    const offset = (index - (count - 1) / 2) * Math.min(size * 1.6, (barHalf * 1.6) / Math.max(1, count));
                    const x0 = same ? centre(transition.from) + offset : centre(transition.from) + barHalf * 0.5;
                    const x1 = same ? x0 : centre(transition.to) - barHalf * 0.5;
                    const y0 = y(transition.from.energy);
                    const y1 = y(transition.to.energy);
                    const direction = Math.sign(y1 - y0) || 1;
                    const head = size * 0.5;
                    const angle = Math.atan2(y1 - y0, x1 - x0);
                    const tip = [x1, y1 - direction * 2];
                    const back = [tip[0] - Math.cos(angle) * head, tip[1] - Math.sin(angle) * head];
                    const normal = [-Math.sin(angle) * head * 0.45, Math.cos(angle) * head * 0.45];
                    parts.push(`<line x1="${x0.toFixed(1)}" y1="${(y0 + direction * 2).toFixed(1)}" x2="${back[0].toFixed(1)}" y2="${back[1].toFixed(1)}" stroke="${color}" stroke-width="2"${style.dashed ? ' stroke-dasharray="4 3"' : ""}/>`);
                    parts.push(`<path d="M${tip[0].toFixed(1)} ${tip[1].toFixed(1)}L${(back[0] + normal[0]).toFixed(1)} ${(back[1] + normal[1]).toFixed(1)}L${(back[0] - normal[0]).toFixed(1)} ${(back[1] - normal[1]).toFixed(1)}Z" fill="${color}"/>`);
                    const label = transition.text || style.label;
                    if (label) {
                        const mx = (x0 + x1) / 2 + (same ? size * 0.35 : 0);
                        const my = (y0 + y1) / 2;
                        parts.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" font-size="${(size * 0.75).toFixed(1)}" fill="${color}"${same ? "" : ' text-anchor="middle"'}>${context.escapeXml(label)}</text>`);
                    }
                });
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
