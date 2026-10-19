// Function plot plugin: curves y = f(x), one expression per line, with axes, grid and a legend. Expressions are read
// by a small parser of its own (no eval): + - * / ^, unary minus, parentheses, x, pi, e, the usual functions, and
// implicit multiplication (2x, 2sin(x), (x+1)(x-1)). A curve is broken where it jumps or is undefined (tan, 1/x).

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000"];
    const FUNCTIONS = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        asin: Math.asin,
        acos: Math.acos,
        atan: Math.atan,
        sinh: Math.sinh,
        cosh: Math.cosh,
        tanh: Math.tanh,
        exp: Math.exp,
        ln: Math.log,
        log: Math.log10,
        log10: Math.log10,
        sqrt: Math.sqrt,
        abs: Math.abs,
        floor: Math.floor,
        ceil: Math.ceil,
    };
    const CONSTANTS = { pi: Math.PI, e: Math.E };

    // Text → tokens { type: "num" | "name" | "op" | "(" | ")", value, at } (at: 1-based character position).
    function tokenize(text) {
        const tokens = [];
        let i = 0;
        while (i < text.length) {
            const c = text[i];
            if (/\s/.test(c)) {
                i++;
            } else if (/[0-9.]/.test(c)) {
                const match = text.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
                if (!match) throw new Error(`Position ${i + 1}: “${c}” is not a number`);
                tokens.push({ type: "num", value: Number(match[0]), at: i + 1 });
                i += match[0].length;
            } else if (/[A-Za-zπ]/.test(c)) {
                const match = text.slice(i).match(/^(π|[A-Za-z][A-Za-z0-9]*)/);
                tokens.push({ type: "name", value: match[0] === "π" ? "pi" : match[0].toLowerCase(), at: i + 1 });
                i += match[0].length;
            } else if ("+-*/^".includes(c)) {
                tokens.push({ type: "op", value: c, at: i + 1 });
                i++;
            } else if (c === "(" || c === ")") {
                tokens.push({ type: c, value: c, at: i + 1 });
                i++;
            } else {
                throw new Error(`Position ${i + 1}: “${c}” is not allowed`);
            }
        }
        return splitNames(tokens);
    }

    // "xsin" or "2pix" are read as products: a run of letters is split into known names (x, pi, e, functions).
    function splitNames(tokens) {
        const known = ["x", ...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS)].sort((a, b) => b.length - a.length);
        const out = [];
        tokens.forEach(token => {
            if (token.type !== "name" || known.includes(token.value)) {
                out.push(token);
                return;
            }
            let rest = token.value;
            let at = token.at;
            while (rest) {
                const name = known.find(candidate => rest.startsWith(candidate));
                if (!name) throw new Error(`Position ${at}: “${token.value}” is not a known name (use x, pi, e or a function such as sin)`);
                out.push({ type: "name", value: name, at });
                rest = rest.slice(name.length);
                at += name.length;
            }
        });
        return out;
    }

    // Recursive descent: expression := term (+|- term)*; term := unary ((*|/|implicit) unary)*;
    // unary := (+|-) unary | power; power := atom (^ unary)?  (right-associative, binds tighter than unary minus:
    // -x^2 is -(x^2)); atom := number | x | constant | function atom | ( expression ).
    function parse(text) {
        const tokens = tokenize(String(text));
        if (!tokens.length) throw new Error("Type an expression in x, e.g. sin(x)/x");
        let i = 0;
        const peek = () => tokens[i];
        const endAt = () => (tokens.length ? tokens.at(-1).at + 1 : 1);
        const startsAtom = token => token && (token.type === "num" || token.type === "name" || token.type === "(");

        const expression = () => {
            let node = term();
            while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
                const op = tokens[i++].value;
                const right = term();
                const left = node;
                node = op === "+" ? x => left(x) + right(x) : x => left(x) - right(x);
            }
            return node;
        };
        const term = () => {
            let node = unary();
            for (;;) {
                const token = peek();
                if (token?.type === "op" && (token.value === "*" || token.value === "/")) {
                    i++;
                    const right = unary();
                    const left = node;
                    node = token.value === "*" ? x => left(x) * right(x) : x => left(x) / right(x);
                } else if (startsAtom(token)) {
                    const right = power(); // implicit multiplication: 2x, 3(x+1), x sin(x)
                    const left = node;
                    node = x => left(x) * right(x);
                } else {
                    return node;
                }
            }
        };
        const unary = () => {
            const token = peek();
            if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
                i++;
                const inner = unary();
                return token.value === "-" ? x => -inner(x) : inner;
            }
            return power();
        };
        const power = () => {
            const base = atom();
            if (peek()?.type === "op" && peek().value === "^") {
                i++;
                const exponent = unary();
                return x => base(x) ** exponent(x);
            }
            return base;
        };
        const atom = () => {
            const token = tokens[i++];
            if (!token) throw new Error(`Position ${endAt()}: the expression ends too early`);
            if (token.type === "num") return () => token.value;
            if (token.type === "(") {
                const inner = expression();
                if (peek()?.type !== ")") throw new Error(`Position ${peek()?.at ?? endAt()}: a “(” at position ${token.at} is not closed`);
                i++;
                return inner;
            }
            if (token.type === "name") {
                if (token.value === "x") return x => x;
                if (token.value in CONSTANTS) return () => CONSTANTS[token.value];
                const fn = FUNCTIONS[token.value];
                if (!startsAtom(peek()) && !(peek()?.type === "op" && peek().value === "-")) {
                    throw new Error(`Position ${token.at}: ${token.value} needs an argument, e.g. ${token.value}(x)`);
                }
                // Parenthesized arguments end at the closing bracket; a following power belongs to the call.
                const argument = peek()?.type === "(" ? atom() : peek()?.type === "op" ? unary() : power();
                return x => fn(argument(x));
            }
            throw new Error(`Position ${token.at}: unexpected “${token.value}”`);
        };
        const result = expression();
        if (i < tokens.length) throw new Error(`Position ${tokens[i].at}: unexpected “${tokens[i].value}”`);
        return result;
    }

    // "sin(x) ; #ff0000 ; label" → { expression, color, label }
    function readLines(text) {
        return String(text ?? "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#"))
            .slice(0, 8)
            .map((line, index) => {
                const [expression, ...rest] = line.split(";").map(part => part.trim());
                const color = rest.find(part => HEX_COLOR.test(part)) || PALETTE[index % PALETTE.length];
                const label = rest.find(part => part && !HEX_COLOR.test(part)) ?? expression.replace(/^y\s*=\s*/i, "");
                return { expression: expression.replace(/^y\s*=\s*/i, ""), color, label, index };
            });
    }

    const numberOrNull = text => {
        const trimmed = String(text ?? "").trim();
        if (!trimmed) return null;
        try {
            const value = parse(trimmed)(0);
            return Number.isFinite(value) ? value : null;
        } catch (_error) {
            return null;
        }
    };
    const format = value => String(Number(value.toPrecision(6)));

    SlideForgePlugins.register({
        id: "function-plot",
        version: "2",
        name: "Function Plot",
        description: "Curves y = f(x) from expressions, with axes, grid and legend",
        icon: "fa-solid fa-chart-line",
        insert: { fill: true, category: "Physics & maths", label: "Function plot y = f(x)", keywords: "function plot graph curve equation expression sin cos math" },
        defaultSize: { width: 440, height: 300 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            expressions: "sin(x) ; sin x\n0.5x cos(2x) ; ½ x cos 2x",
            xMin: "-2pi",
            xMax: "2pi",
            yMin: "",
            yMax: "",
            grid: true,
            legend: true,
            lineWidth: 2.5,
            fontSize: 16,
            xLabel: "x",
            yLabel: "y",
        },
        fields: [
            {
                key: "expressions",
                label: "Curves (one per line)",
                type: "textarea",
                placeholder: "sin(x)/x ; #d55e00 ; sinc",
                hint: "expression ; colour ; label. Use x, pi, e, + - * / ^, sin cos tan asin acos atan sinh cosh tanh exp ln log sqrt abs floor ceil. 2x means 2*x.",
            },
            { key: "xMin", label: "x from", type: "text", placeholder: "-2pi" },
            { key: "xMax", label: "x to", type: "text", placeholder: "2pi" },
            { key: "yMin", label: "y from", type: "text", placeholder: "Automatic" },
            { key: "yMax", label: "y to", type: "text", placeholder: "Automatic" },
            { key: "xLabel", label: "x axis label", type: "text" },
            { key: "yLabel", label: "y axis label", type: "text" },
            { key: "grid", advanced: true, label: "Grid", checkboxLabel: "Grid lines", type: "checkbox" },
            { key: "legend", advanced: true, label: "Legend", checkboxLabel: "Legend with the labels", type: "checkbox" },
            { key: "lineWidth", advanced: true, label: "Line width (px)", type: "number", min: 0.5, max: 8, step: 0.5 },
            { key: "fontSize", advanced: true, label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            const text = (value, limit) => String(value ?? "").slice(0, limit);
            return {
                expressions: text(data.expressions, 2000),
                xMin: text(data.xMin, 40),
                xMax: text(data.xMax, 40),
                yMin: text(data.yMin, 40),
                yMax: text(data.yMax, 40),
                grid: data.grid !== false,
                legend: data.legend !== false,
                lineWidth: number(data.lineWidth, 2.5, 0.5, 8),
                fontSize: number(data.fontSize, 13, 8, 32),
                xLabel: text(data.xLabel, 60),
                yLabel: text(data.yLabel, 60),
            };
        },

        render(data, context) {
            const curves = readLines(data.expressions);
            if (!curves.length) throw new Error("Type an expression in x, e.g. sin(x)/x");
            curves.forEach(curve => {
                try {
                    curve.fn = parse(curve.expression);
                } catch (error) {
                    throw new Error(`Line ${curve.index + 1} (${curve.expression}): ${error.message}`);
                }
            });
            const xLow = numberOrNull(data.xMin) ?? -10;
            const xHigh = numberOrNull(data.xMax) ?? 10;
            if (!(xHigh > xLow)) throw new Error("“x to” must be greater than “x from” (both may be expressions such as 2pi)");
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const samples = Math.max(200, Math.min(2000, Math.round(width * 2)));
            // Sample each curve; values far beyond the rest (asymptotes) do not set the automatic y range.
            curves.forEach(curve => {
                curve.points = Array.from({ length: samples + 1 }, (_, k) => {
                    const x = xLow + ((xHigh - xLow) * k) / samples;
                    const y = curve.fn(x);
                    return { x, y: Number.isFinite(y) ? y : null };
                });
            });
            const finite = curves.flatMap(curve => curve.points.map(p => p.y).filter(y => y !== null)).sort((a, b) => a - b);
            if (!finite.length) throw new Error("No curve has a value in this x range");
            const pick = q => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
            let autoLow = pick(0.01);
            let autoHigh = pick(0.99);
            if (finite.length < 50 || pick(0) >= autoLow - (autoHigh - autoLow) * 0.5) autoLow = pick(0);
            if (finite.length < 50 || pick(1) <= autoHigh + (autoHigh - autoLow) * 0.5) autoHigh = pick(1);
            const yTicks = context.niceTicks(numberOrNull(data.yMin) ?? autoLow, numberOrNull(data.yMax) ?? autoHigh, Math.max(3, Math.round(height / 55)));
            const yLow = numberOrNull(data.yMin) ?? yTicks.min;
            const yHigh = numberOrNull(data.yMax) ?? yTicks.max;
            if (!(yHigh > yLow)) throw new Error("“y to” must be greater than “y from”");
            const xTicks = context.niceTicks(xLow, xHigh, Math.max(3, Math.round(width / 80)));

            const tickStyle = { size, family: FONT };
            const yTickValues = yTicks.ticks.filter(t => t >= yLow - 1e-9 && t <= yHigh + 1e-9);
            const left = (data.yLabel ? size * 1.5 : 0) + Math.max(...yTickValues.map(t => context.measureText(format(t), tickStyle))) + size * 0.8;
            const bottom = size * (data.xLabel ? 2.9 : 1.9);
            const top = size * 0.7;
            const right = size * 0.8;
            const plotWidth = Math.max(40, width - left - right);
            const plotHeight = Math.max(40, height - top - bottom);
            const px = x => left + ((x - xLow) / (xHigh - xLow)) * plotWidth;
            const py = y => top + plotHeight - ((y - yLow) / (yHigh - yLow)) * plotHeight;
            const parts = [];
            if (data.grid) {
                xTicks.ticks.filter(t => t >= xLow && t <= xHigh).forEach(t => parts.push(`<line x1="${px(t).toFixed(1)}" x2="${px(t).toFixed(1)}" y1="${top}" y2="${top + plotHeight}" stroke="${ink}" stroke-opacity="0.1"/>`));
                yTickValues.forEach(t => parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}" stroke="${ink}" stroke-opacity="0.1"/>`));
            }
            // Axes through zero when zero is in range, else along the plot's edge.
            const axisY = yLow <= 0 && yHigh >= 0 ? py(0) : top + plotHeight;
            const axisX = xLow <= 0 && xHigh >= 0 ? px(0) : left;
            parts.push(`<path d="M${left} ${axisY.toFixed(1)}H${left + plotWidth}M${axisX.toFixed(1)} ${top}V${top + plotHeight}" stroke="${ink}" stroke-width="1.2" fill="none"/>`);
            xTicks.ticks
                .filter(t => t >= xLow - 1e-9 && t <= xHigh + 1e-9)
                .forEach(t => parts.push(`<text x="${px(t).toFixed(1)}" y="${(top + plotHeight + size * 1.15).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${format(t)}</text>`));
            yTickValues.forEach(t => parts.push(`<text x="${(left - size * 0.4).toFixed(1)}" y="${(py(t) + size * 0.3).toFixed(1)}" font-size="${size}" text-anchor="end" fill="${ink}">${format(t)}</text>`));
            if (data.xLabel) parts.push(`<text x="${(left + plotWidth / 2).toFixed(1)}" y="${(height - size * 0.35).toFixed(1)}" font-size="${size}" font-style="italic" text-anchor="middle" fill="${ink}">${context.escapeXml(data.xLabel)}</text>`);
            if (data.yLabel) parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" font-style="italic" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}</text>`);

            // Curves, broken where undefined or where they jump across most of the plot (an asymptote).
            parts.push(`<clipPath id="plot"><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></clipPath><g clip-path="url(#plot)">`);
            const span = yHigh - yLow;
            curves.forEach(curve => {
                let path = "";
                let previous = null;
                curve.points.forEach(point => {
                    if (point.y === null) {
                        previous = null;
                        return;
                    }
                    const jump = previous && Math.abs(point.y - previous.y) > span * 2 && Math.sign(point.y) !== Math.sign(previous.y);
                    const clampedY = Math.max(yLow - span * 3, Math.min(yHigh + span * 3, point.y));
                    path += `${previous && !jump ? "L" : "M"}${px(point.x).toFixed(1)} ${py(clampedY).toFixed(1)}`;
                    previous = point;
                });
                curve.segments = (path.match(/M/g) || []).length;
                if (path) parts.push(`<path d="${path}" fill="none" stroke="${curve.color}" stroke-width="${data.lineWidth}" stroke-linejoin="round" data-curve="${curve.index}" data-segments="${curve.segments}"/>`);
            });
            parts.push("</g>");
            if (data.legend && curves.some(curve => curve.label)) {
                const rowHeight = size * 1.35;
                const labelWidth = Math.max(...curves.map(curve => context.measureText(curve.label, { size, family: FONT })));
                const boxWidth = labelWidth + size * 2.6;
                const boxX = left + plotWidth - boxWidth - size * 0.4;
                const boxY = top + size * 0.4;
                parts.push(`<rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${(curves.length * rowHeight + size * 0.4).toFixed(1)}" rx="4" fill="${context.theme?.surfaceColor || "#ffffff"}" fill-opacity="0.85" stroke="${ink}" stroke-opacity="0.2"/>`);
                curves.forEach((curve, index) => {
                    const y = boxY + size * 0.2 + rowHeight * (index + 0.5);
                    parts.push(`<line x1="${(boxX + size * 0.4).toFixed(1)}" x2="${(boxX + size * 1.7).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${curve.color}" stroke-width="${data.lineWidth}"/>`);
                    parts.push(`<text x="${(boxX + size * 2.1).toFixed(1)}" y="${(y + size * 0.35).toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(curve.label)}</text>`);
                });
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });

    // For tests and other plugins: the parser on its own.
    window.SlideForgeFunctionParser = { parse };
})();
