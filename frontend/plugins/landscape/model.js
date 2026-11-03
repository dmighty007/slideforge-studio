// Bounded, offline landscape calculations. Missing samples stay missing; no scattered-point extrapolation.
(() => {
    const api = window.SlideForgeLandscape = window.SlideForgeLandscape || {};
    const LIMIT = 81;
    const functions = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil };
    // Same precedence as Function Plot: -x^2 = -(x^2), powers associate to the right. No executable JS.
    function expression(source) {
        source = String(source).trim();
        if (!source || source.length > 500) throw Error("Enter an equation of at most 500 characters.");
        const tokens = []; let at = 0;
        const known = ["x", "y", "pi", "e", ...Object.keys(functions)].sort((a, b) => b.length - a.length);
        while (at < source.length) {
            const rest = source.slice(at); let m;
            if (/^\s/.test(rest)) { at++; continue; }
            if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) { tokens.push({ kind: "number", value: Number(m[0]) }); at += m[0].length; }
            else if ((m = /^(?:π|[a-zA-Z][a-zA-Z0-9]*)/.exec(rest))) {
                let word = m[0].toLowerCase().replace("π", "pi");
                while (word) {
                    const name = known.find(k => word.startsWith(k));
                    if (!name) throw Error(`Unknown name near “${word}”. Use x, y, pi, e or a mathematical function.`);
                    tokens.push({ kind: "name", value: name }); word = word.slice(name.length);
                }
                at += m[0].length;
            } else if ("+-*/^()".includes(rest[0])) { tokens.push({ kind: rest[0] }); at++; }
            else throw Error(`Character “${rest[0]}” is not allowed in an equation.`);
        }
        if (tokens.length > 200) throw Error("The equation is too complex (maximum 200 tokens).");
        let pos = 0;
        const peek = () => tokens[pos]?.kind;
        const begins = () => ["number", "name", "("].includes(peek());
        function sum() {
            let left = product();
            while (["+", "-"].includes(peek())) { const op = tokens[pos++].kind, a = left, b = product(); left = op === "+" ? (x, y) => a(x, y) + b(x, y) : (x, y) => a(x, y) - b(x, y); }
            return left;
        }
        function product() {
            let left = unary();
            while (["*", "/"].includes(peek()) || begins()) { const op = ["*", "/"].includes(peek()) ? tokens[pos++].kind : "*", a = left, b = unary(); left = op === "*" ? (x, y) => a(x, y) * b(x, y) : (x, y) => a(x, y) / b(x, y); }
            return left;
        }
        function unary() { if (["+", "-"].includes(peek())) { const negative = tokens[pos++].kind === "-", f = unary(); return negative ? (x, y) => -f(x, y) : f; } return power(); }
        function power() { const a = atom(); if (peek() !== "^") return a; pos++; const b = unary(); return (x, y) => a(x, y) ** b(x, y); }
        function atom() {
            const t = tokens[pos++];
            if (!t) throw Error("The equation ends too early.");
            if (t.kind === "number") return () => t.value;
            if (t.kind === "(") { const f = sum(); if (peek() !== ")") throw Error("Close every parenthesis in the equation."); pos++; return f; }
            if (t.kind === "name") {
                if (t.value === "x") return x => x;
                if (t.value === "y") return (_x, y) => y;
                if (t.value === "pi" || t.value === "e") return () => t.value === "pi" ? Math.PI : Math.E;
                const argument = peek() === "(" ? atom() : unary(), f = functions[t.value];
                return (x, y) => f(argument(x, y));
            }
            throw Error("Expected a number, variable or parenthesized expression.");
        }
        const f = sum(); if (pos !== tokens.length) throw Error("Unexpected closing parenthesis."); return f;
    }
    function numeric(value, label, missing = false) {
        const text = String(value ?? "").trim();
        if (missing && (!text || /^(?:na|nan|null)$/i.test(text))) return NaN;
        if (!text || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1e100) throw Error(`${label} must be a finite number with magnitude at most 1e100.`);
        return Number(text);
    }
    function axis(values, label) {
        if (values.length < 2 || values.length > LIMIT) throw Error(`${label} needs 2–${LIMIT} distinct coordinates.`);
        if (new Set(values).size !== values.length) throw Error(`${label} contains duplicate coordinates.`);
    }
    function model(data, parseTable) {
        let xs, ys, values;
        if (data.input === "equation") {
            const f = expression(data.equation), n = data.resolution;
            if (!(data.xMax > data.xMin && data.yMax > data.yMin)) throw Error("Each axis maximum must exceed its minimum.");
            xs = Array.from({ length: n }, (_, i) => data.xMin + (data.xMax - data.xMin) * i / (n - 1));
            ys = Array.from({ length: n }, (_, i) => data.yMin + (data.yMax - data.yMin) * i / (n - 1));
            values = ys.map(y => xs.map(x => { const v = f(x, y); return Number.isFinite(v) && Math.abs(v) <= 1e100 ? v : NaN; }));
        } else {
            if (String(data.csv).length > 60000) throw Error("CSV data is limited to 60 KB; use a smaller grid.");
            const rows = parseTable(data.csv, { maxRows: LIMIT * LIMIT + 2, maxColumns: LIMIT + 2 });
            if (data.csvFormat === "matrix") {
                if (rows.length < 3 || rows.length > LIMIT + 1) throw Error(`Use a coordinate header and 2–${LIMIT} rows of values.`);
                xs = rows[0].slice(1).map(v => numeric(v, "X coordinate"));
                ys = rows.slice(1).map(r => numeric(r[0], "Y coordinate"));
                axis(xs, "X"); axis(ys, "Y");
                values = rows.slice(1).map((r, i) => { if (r.length !== xs.length + 1) throw Error(`CSV row ${i + 2} has the wrong number of columns.`); return r.slice(1).map(v => numeric(v, "Grid value", true)); });
            } else {
                const first = rows[0];
                // A missing value in the first sample is data, not a header (it may define the grid's extent).
                if (first?.length === 3 && first.slice(0, 2).every(v => String(v).trim() && !/^(?:na|nan|null|[-+]?infinity)$/i.test(v) && !Number.isFinite(Number(v)))) rows.shift();
                if (rows.length < 4 || rows.length > LIMIT * LIMIT) throw Error(`Use 4–${LIMIT * LIMIT} rows of x, y, value.`);
                const points = rows.map((r, i) => { if (r.length !== 3) throw Error(`CSV row ${i + 1} must have exactly three columns: x, y, value.`); return [numeric(r[0], "X coordinate"), numeric(r[1], "Y coordinate"), numeric(r[2], "Grid value", true)]; });
                xs = [...new Set(points.map(p => p[0]))].sort((a, b) => a - b); ys = [...new Set(points.map(p => p[1]))].sort((a, b) => a - b);
                axis(xs, "X"); axis(ys, "Y");
                values = ys.map(() => xs.map(() => NaN)); const occupied = new Set();
                const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, i) => [y, i]));
                points.forEach(([x, y, z]) => { const key = `${xi.get(x)},${yi.get(y)}`; if (occupied.has(key)) throw Error(`Duplicate sample at (${x}, ${y}).`); occupied.add(key); values[yi.get(y)][xi.get(x)] = z; });
            }
            // Retain nonuniform spacing and accept descending input axes without reversing the data incorrectly.
            const orderX = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]), orderY = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
            values = orderY.map(y => orderX.map(x => values[y][x])); xs = orderX.map(i => xs[i]); ys = orderY.map(i => ys[i]);
        }
        const finite = values.flat().filter(Number.isFinite);
        if (!finite.length) throw Error("There are no finite values in this landscape.");
        const rawMin = Math.min(...finite), rawMax = Math.max(...finite), offset = data.subtractMin ? rawMin : 0;
        values = values.map(row => row.map(v => v - offset));
        const low = rawMin - offset, high = rawMax - offset;
        const colorMin = data.colorMin === "" ? low : numeric(data.colorMin, "Color minimum"), colorMax = data.colorMax === "" ? high : numeric(data.colorMax, "Color maximum");
        if (colorMax < colorMin || (colorMax === colorMin && (data.colorMin !== "" || data.colorMax !== ""))) throw Error("Color maximum must exceed color minimum.");
        const cells = [];
        for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
            const vertices = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => ({ x: xs[a], y: ys[b], z: values[b][a] }));
            if (vertices.every(p => Number.isFinite(p.z))) cells.push({ i, j, vertices, value: vertices.reduce((s, p) => s + p.z, 0) / 4 });
        }
        if (!cells.length) throw Error("No complete grid cells remain. Scattered-point interpolation is not supported; supply a matrix or points on a grid.");
        return { xs, ys, values, cells, low, high, colorMin, colorMax, offset, missing: values.flat().length - finite.length };
    }
    // Piecewise-linear contours on two triangles per grid cell: no saddle-case guessing or crossing holes.
    function contours(grid, levels) {
        return levels.map(level => {
            const segments = [];
            for (const cell of grid.cells) for (const ids of [[0, 1, 2], [0, 2, 3]]) {
                const tri = ids.map(i => cell.vertices[i]), hits = [];
                for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3]; if ((a.z < level) === (b.z < level)) continue; const t = (level - a.z) / (b.z - a.z); hits.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }); }
                if (hits.length === 2 && (hits[0].x !== hits[1].x || hits[0].y !== hits[1].y)) segments.push(hits);
            }
            return { level, segments };
        });
    }
    function sample(grid, x, y) {
        const locate = (a, v) => { if (v < a[0] || v > a.at(-1)) return -1; let i = 0; while (i < a.length - 2 && v > a[i + 1]) i++; return i; };
        const i = locate(grid.xs, x), j = locate(grid.ys, y); if (i < 0 || j < 0) return null;
        const z = [grid.values[j][i], grid.values[j][i + 1], grid.values[j + 1][i], grid.values[j + 1][i + 1]];
        if (!z.every(Number.isFinite)) return null;
        const u = (x - grid.xs[i]) / (grid.xs[i + 1] - grid.xs[i]), v = (y - grid.ys[j]) / (grid.ys[j + 1] - grid.ys[j]);
        // Same diagonal and piecewise-linear field as the contours and the surface picker.
        return v <= u ? z[0] * (1 - u) + z[1] * (u - v) + z[3] * v : z[0] * (1 - v) + z[3] * u + z[2] * (v - u);
    }
    Object.assign(api, { expression, model, contours, sample });
})();
