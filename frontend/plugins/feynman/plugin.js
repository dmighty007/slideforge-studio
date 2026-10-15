// Feynman diagram plugin: points, vertices and propagators from a few lines of text (see the field's hint and
// docs/PLUGINS.md), or one of the presets. Fermion lines carry an arrow, photons and W/Z are wavy, gluons curly,
// scalars dashed, ghosts dotted. Lines may bend into arcs (loops). The diagram is scaled to fit the box.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Times New Roman, Times, serif";
    const LINE_TYPES = ["fermion", "antifermion", "photon", "boson", "gluon", "scalar", "ghost", "plain"];

    const PRESETS = {
        "ee-mumu": `# e⁺e⁻ → μ⁺μ⁻ (s-channel photon)
point a -2 1.2
point b -2 -1.2
vertex v1 -0.8 0
vertex v2 0.8 0
point c 2 1.2
point d 2 -1.2
fermion b v1 e-
antifermion a v1 e+
photon v1 v2 gamma
fermion v2 c mu-
antifermion v2 d mu+`,
        compton: `# Compton scattering e⁻γ → e⁻γ
point i -2.2 -0.6
vertex v1 -0.7 -0.6
vertex v2 0.7 -0.6
point o 2.2 -0.6
point gin -1.8 1
point gout 1.8 1
fermion i v1 e-
fermion v1 v2 e-
fermion v2 o e-
photon gin v1 gamma
photon v2 gout gamma`,
        "gluon-exchange": `# Quark scattering by gluon exchange (t-channel)
point a -2 1
vertex v1 0 1
point b 2 1
point c -2 -1
vertex v2 0 -1
point d 2 -1
fermion a v1 q
fermion v1 b q
fermion c v2 q
fermion v2 d q
gluon v1 v2 g side=right`,
        "higgs-ggf": `# Higgs production by gluon fusion (top-quark loop)
point g1 -2.2 1.1
point g2 -2.2 -1.1
vertex t1 -0.8 0.7
vertex t2 -0.8 -0.7
vertex t3 0.4 0
point h 2.2 0
gluon g1 t1 g
gluon g2 t2 g
fermion t1 t2 t side=right
fermion t2 t3 t side=right
fermion t3 t1 t side=right
scalar t3 h H`,
        "beta-decay": `# Neutron β decay at quark level (d → u W⁻, W⁻ → e⁻ ν̄ₑ)
point din -2.2 -1
vertex v1 -0.4 -1
point uout 2.2 -1
vertex v2 0.8 0.5
point e 2.2 1.4
point nu 2.2 0.1
fermion din v1 d
fermion v1 uout u
boson v1 v2 W-
fermion v2 e e-
antifermion v2 nu nubar_e`,
    };

    // Particle names typed in ASCII → symbols: gamma → γ, mu- → μ⁻, nubar_e → ν̄ₑ, e+ → e⁺.
    function prettyLabel(text) {
        const words = { gamma: "γ", mu: "μ", nu: "ν", tau: "τ", pi: "π", eta: "η", rho: "ρ", phi: "φ", psi: "ψ", chi: "χ", alpha: "α", beta: "β", Delta: "Δ", Lambda: "Λ", Sigma: "Σ", Upsilon: "Υ" };
        let label = String(text);
        label = label.replace(/^([A-Za-z]+)bar/, (_, name) => `${words[name] || name}̄`);
        label = label.replace(/^[A-Za-z]+/, word => words[word] || word);
        label = label.replace(/_([a-zA-Zμτ0-9])$/, (_, sub) => ({ e: "ₑ", mu: "μ", t: "ₜ", 0: "₀", 1: "₁", 2: "₂" })[sub] || `_${sub}`);
        label = label.replace(/\+$/, "⁺").replace(/-$/, "⁻").replace(/0$/, "⁰");
        return label;
    }

    function readSpec(text) {
        const points = new Map();
        const lines = [];
        String(text ?? "")
            .split(/\r?\n/)
            .forEach((raw, index) => {
                const line = raw.replace(/#.*$/, "").trim();
                if (!line) return;
                const where = `Line ${index + 1}`;
                const [word, ...rest] = line.split(/\s+/);
                const keyword = word.toLowerCase();
                if (keyword === "point" || keyword === "vertex") {
                    const [name, xText, yText] = rest;
                    const x = Number(xText);
                    const y = Number(yText);
                    if (!name || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${where}: write “${keyword} name x y”, e.g. ${keyword} v1 0 0`);
                    points.set(name, { name, x, y, vertex: keyword === "vertex" });
                    return;
                }
                if (!LINE_TYPES.includes(keyword)) throw new Error(`${where}: “${word}” is not point, vertex or a line type (${LINE_TYPES.join(", ")})`);
                const [from, to, ...more] = rest;
                if (!from || !to) throw new Error(`${where}: write “${keyword} from to label”`);
                const options = {};
                const labelWords = [];
                more.forEach(part => {
                    const match = part.match(/^(bend|side|color)=(.+)$/i);
                    if (match) options[match[1].toLowerCase()] = match[2];
                    else labelWords.push(part);
                });
                const bend = Number(options.bend ?? 0);
                lines.push({
                    type: keyword,
                    from,
                    to,
                    label: labelWords.join(" "),
                    bend: Number.isFinite(bend) ? Math.max(-2, Math.min(2, bend)) : 0,
                    side: options.side === "right" ? -1 : 1,
                    color: HEX_COLOR.test(options.color || "") ? options.color : null,
                    where,
                });
            });
        lines.forEach(line => {
            [line.from, line.to].forEach(name => {
                if (!points.has(name)) throw new Error(`${line.where}: no point or vertex called “${name}”`);
            });
        });
        if (!lines.length) throw new Error("Add points, vertices and lines, or choose a preset");
        return { points, lines };
    }

    // A line's path in screen space as a function s ∈ [0, 1] → { x, y, tx, ty } (position and unit tangent). A bent
    // line is a quadratic curve whose middle sits `bend × length` to the left of a → b (negative: to the right).
    function pathOf(a, b, bend) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const chord = Math.hypot(dx, dy) || 1;
        // Left of a → b on screen (y down) is (dy, −dx) / chord.
        const control = { x: (a.x + b.x) / 2 + (dy / chord) * 2 * bend * chord, y: (a.y + b.y) / 2 - (dx / chord) * 2 * bend * chord };
        const at = s => {
            const u = 1 - s;
            const x = u * u * a.x + 2 * u * s * control.x + s * s * b.x;
            const y = u * u * a.y + 2 * u * s * control.y + s * s * b.y;
            const tx = 2 * u * (control.x - a.x) + 2 * s * (b.x - control.x);
            const ty = 2 * u * (control.y - a.y) + 2 * s * (b.y - control.y);
            const norm = Math.hypot(tx, ty) || 1;
            return { x, y, tx: tx / norm, ty: ty / norm };
        };
        let length = 0;
        let last = at(0);
        for (let k = 1; k <= 32; k++) {
            const next = at(k / 32);
            length += Math.hypot(next.x - last.x, next.y - last.y);
            last = next;
        }
        return { length, at };
    }

    // Points along a path, offset sideways by offset(s, θ) (θ: the wave's phase) and along it by shift.
    function sample(path, steps, offset) {
        const points = [];
        for (let k = 0; k <= steps; k++) {
            const s = k / steps;
            const p = path.at(s);
            const { normal, along } = offset(s);
            const nx = -p.ty;
            const ny = p.tx;
            points.push(`${(p.x + nx * normal + p.tx * along).toFixed(2)} ${(p.y + ny * normal + p.ty * along).toFixed(2)}`);
        }
        return `M${points.join("L")}`;
    }

    SlideForgePlugins.register({
        id: "feynman",
        version: "1",
        name: "Feynman Diagram",
        description: "Feynman diagrams from a short text description, or from presets",
        icon: "fa-solid fa-atom",
        insert: { category: "Physics & maths", label: "Feynman diagram", keywords: "feynman diagram particle physics qed qcd photon gluon fermion propagator vertex" },
        defaultSize: { width: 420, height: 260 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: { preset: "ee-mumu", spec: PRESETS["ee-mumu"], lineWidth: 2, fontSize: 18, color: "" },
        fields: [
            {
                key: "preset",
                label: "Preset",
                type: "select",
                options: [
                    { value: "custom", label: "My own (the text below)" },
                    { value: "ee-mumu", label: "e⁺e⁻ → μ⁺μ⁻" },
                    { value: "compton", label: "Compton scattering" },
                    { value: "gluon-exchange", label: "Gluon exchange (qq → qq)" },
                    { value: "higgs-ggf", label: "Higgs production, gluon fusion" },
                    { value: "beta-decay", label: "β decay (d → u e⁻ ν̄ₑ)" },
                ],
                hint: "Choosing a preset replaces the text below; editing the text makes it your own.",
            },
            {
                key: "spec",
                label: "Diagram",
                type: "textarea",
                placeholder: "vertex v1 0 0\npoint a -2 1\nfermion a v1 e-\nphoton v1 v2 gamma",
                hint: "One item per line. “point name x y” or “vertex name x y” (vertex: with a dot; y points up). Lines: fermion, antifermion, photon, boson (W/Z), gluon, scalar, ghost, plain — “photon a b label”, optional bend=0.5, side=right, color=#hex. Labels: gamma → γ, mu- → μ⁻, e+ → e⁺, nubar_e → ν̄ₑ. # starts a comment.",
            },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 6, step: 0.5 },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 8, max: 40, step: 1 },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                preset: data.preset === "custom" || Object.hasOwn(PRESETS, data.preset) ? data.preset : "custom",
                spec: String(data.spec ?? "").slice(0, 8000),
                lineWidth: number(data.lineWidth, 2, 0.5, 6),
                fontSize: number(data.fontSize, 18, 8, 40),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        // A newly chosen preset fills the text; text edited by hand makes the diagram "custom".
        prepare(data, previous) {
            if (data.preset !== "custom" && data.preset !== previous?.preset) return { ...data, spec: PRESETS[data.preset] };
            if (previous && data.spec !== previous.spec && data.preset !== "custom" && data.spec !== PRESETS[data.preset]) return { ...data, preset: "custom" };
            return data;
        },

        render(data, context) {
            const { points, lines } = readSpec(data.spec);
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            // Fit the coordinates (y up) into the box, the same scale both ways, leaving room for labels.
            const all = [...points.values()];
            const minX = Math.min(...all.map(p => p.x));
            const maxX = Math.max(...all.map(p => p.x));
            const minY = Math.min(...all.map(p => p.y));
            const maxY = Math.max(...all.map(p => p.y));
            const margin = size * 1.6;
            const scale = Math.min((width - 2 * margin) / Math.max(maxX - minX, 1e-6), (height - 2 * margin) / Math.max(maxY - minY, 1e-6));
            const offsetX = (width - (maxX - minX) * scale) / 2;
            const offsetY = (height - (maxY - minY) * scale) / 2;
            const screen = p => ({ x: offsetX + (p.x - minX) * scale, y: height - offsetY - (p.y - minY) * scale });
            const wave = Math.max(5, size * 0.42); // amplitude/size of wiggles, tied to the text size
            const parts = [];
            const labels = [];
            lines.forEach(line => {
                const a = screen(points.get(line.from));
                const b = screen(points.get(line.to));
                const path = pathOf(a, b, line.bend);
                const color = line.color || ink;
                const stroke = `fill="none" stroke="${color}" stroke-width="${data.lineWidth}" stroke-linecap="round" stroke-linejoin="round"`;
                const steps = Math.max(24, Math.round(path.length / 2));
                if (line.type === "photon" || line.type === "boson") {
                    const cycles = Math.max(2, Math.round(path.length / (wave * 2.6)));
                    parts.push(`<path d="${sample(path, steps * 2, s => ({ normal: wave * 0.7 * Math.sin(2 * Math.PI * cycles * s), along: 0 }))}" ${stroke} data-line="${line.type}"/>`);
                } else if (line.type === "gluon") {
                    // Loops: a prolate cycloid along the line (radius r, loop size d > r).
                    const loops = Math.max(3, Math.round(path.length / (wave * 1.5)));
                    const r = path.length / (2 * Math.PI * loops);
                    const d = wave * 0.85;
                    parts.push(
                        `<path d="${sample(path, loops * 24, s => {
                            const theta = 2 * Math.PI * loops * s;
                            const fade = Math.min(1, s * loops * 2, (1 - s) * loops * 2); // ends meet the vertices
                            return { normal: -d * (1 - Math.cos(theta)) * 0.9 * fade, along: -d * Math.sin(theta) * fade + r * 0 };
                        })}" ${stroke} data-line="gluon"/>`,
                    );
                } else {
                    const dash = line.type === "scalar" ? ` stroke-dasharray="${(data.lineWidth * 4).toFixed(1)} ${(data.lineWidth * 3).toFixed(1)}"` : line.type === "ghost" ? ` stroke-dasharray="0.1 ${(data.lineWidth * 3).toFixed(1)}"` : "";
                    parts.push(`<path d="${sample(path, line.bend ? steps : 1, () => ({ normal: 0, along: 0 }))}" ${stroke}${dash} data-line="${line.type}"/>`);
                    if (line.type === "fermion" || line.type === "antifermion") {
                        const middle = path.at(0.5);
                        const direction = line.type === "fermion" ? 1 : -1;
                        const tx = middle.tx * direction;
                        const ty = middle.ty * direction;
                        const head = Math.max(6, data.lineWidth * 4.5);
                        const tip = { x: middle.x + tx * head * 0.6, y: middle.y + ty * head * 0.6 };
                        const back = { x: middle.x - tx * head * 0.6, y: middle.y - ty * head * 0.6 };
                        parts.push(`<path d="M${tip.x.toFixed(1)} ${tip.y.toFixed(1)}L${(back.x - ty * head * 0.55).toFixed(1)} ${(back.y + tx * head * 0.55).toFixed(1)}L${(back.x + ty * head * 0.55).toFixed(1)} ${(back.y - tx * head * 0.55).toFixed(1)}Z" fill="${color}" data-arrow="${line.type}"/>`);
                    }
                }
                if (line.label) {
                    // Beside the middle of the line, on its left (side=right: the other side), clear of any wiggle.
                    const middle = path.at(0.5);
                    const away = (line.type === "photon" || line.type === "boson" || line.type === "gluon" ? wave * 1.8 : size * 0.45) + size * 0.55;
                    const nx = middle.ty * line.side;
                    const ny = -middle.tx * line.side;
                    labels.push(`<text x="${(middle.x + nx * away).toFixed(1)}" y="${(middle.y + ny * away + size * 0.35).toFixed(1)}" font-size="${size}" font-style="italic" text-anchor="middle" fill="${color}">${context.escapeXml(prettyLabel(line.label))}</text>`);
                }
            });
            all.filter(p => p.vertex).forEach(p => {
                const s = screen(p);
                parts.push(`<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${Math.max(2.5, data.lineWidth * 1.6).toFixed(1)}" fill="${ink}"/>`);
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}${labels.join("")}</svg>`;
        },
    });
})();
