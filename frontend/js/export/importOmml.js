// Office equations (OMML, <m:oMath>) from PowerPoint text boxes, for the PowerPoint import (importPptx.js).
// PowerPoint keeps such a box twice (mc:AlternateContent): as text with its equations, and as a picture of it for
// readers that cannot draw equations. The picture came in, so the words were neither editable nor searchable, and
// were blurred when enlarged. These turn the equations into LaTeX (an equation object, drawn by KaTeX) or, when the
// mathematics is plain (letters, sub- and superscripts, brackets), into styled text runs in the box's own words.

// Tags of plain mathematics: runs, scripts, brackets and boxes. Anything else (fractions, radicals, sums and
// integrals, accents, matrices) needs LaTeX to look right.
const OMML_PLAIN_TAGS = new Set([
    "m:oMathPara", "m:oMathParaPr", "m:oMath", "m:r", "m:t", "m:rPr", "m:sty", "m:scr", "m:nor", "m:lit", "m:brk", "m:aln",
    "m:sSub", "m:sSubPr", "m:sSup", "m:sSupPr", "m:sSubSup", "m:sSubSupPr", "m:alnScr", "m:sub", "m:sup", "m:e",
    "m:d", "m:dPr", "m:begChr", "m:endChr", "m:sepChr", "m:grow", "m:shp", "m:box", "m:boxPr", "m:opEmu", "m:noBreak",
    "m:diff", "m:argPr", "m:argSz", "m:ctrlPr", "m:jc",
]);

// Characters with a LaTeX command. Letters, digits and most operators KaTeX reads as they are.
const OMML_LATEX_SYMBOLS = {
    "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ϵ": "\\epsilon", "ζ": "\\zeta", "η": "\\eta",
    "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "µ": "\\mu", "ν": "\\nu", "ξ": "\\xi",
    "π": "\\pi", "ϖ": "\\varpi", "ρ": "\\rho", "ϱ": "\\varrho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon",
    "φ": "\\varphi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega", "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta",
    "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Υ": "\\Upsilon", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
    "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot", "∙": "\\cdot", "∗": "\\ast", "∘": "\\circ",
    "∞": "\\infty", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≅": "\\cong", "≡": "\\equiv", "∼": "\\sim", "≃": "\\simeq",
    "∝": "\\propto", "≪": "\\ll", "≫": "\\gg", "≔": "\\coloneqq", "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow",
    "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "⟶": "\\longrightarrow", "⟵": "\\longleftarrow",
    "⇌": "\\rightleftharpoons", "↑": "\\uparrow", "↓": "\\downarrow", "↦": "\\mapsto", "∂": "\\partial", "∇": "\\nabla",
    "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup",
    "∩": "\\cap", "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists", "∅": "\\emptyset", "¬": "\\neg", "∧": "\\wedge", "∨": "\\vee",
    "⊗": "\\otimes", "⊕": "\\oplus", "⊥": "\\perp", "∥": "\\parallel", "†": "\\dagger", "‡": "\\ddagger", "ℏ": "\\hbar", "ℓ": "\\ell",
    "ℜ": "\\Re", "ℑ": "\\Im", "℘": "\\wp", "ℵ": "\\aleph", "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots",
    "′": "'", "″": "''", "‴": "'''", "°": "^{\\circ}", "∠": "\\angle", "△": "\\triangle", "□": "\\square", "∴": "\\therefore",
    "∵": "\\because", "⟨": "\\langle", "⟩": "\\rangle", "‖": "\\|", "∣": "\\mid", "−": "-", "–": "-", "√": "\\surd",
    "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap",
    "Å": "\\text{Å}", "℃": "{}^{\\circ}\\mathrm{C}", " ": "\\ ", " ": "\\ ", " ": "\\,", " ": "\\:", " ": "\\quad",
    "#": "\\#", "$": "\\$", "%": "\\%", "&": "\\&", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\sim", "^": "\\hat{}", "\\": "\\backslash",
};
// Big operators (m:nary chr): the LaTeX command; ∫ when the equation sets none.
const OMML_NARY = { "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "∯": "\\oiint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge", "⨁": "\\bigoplus", "⨂": "\\bigotimes" };
// Accents (m:acc chr, combining characters): the circumflex when the equation sets none.
const OMML_ACCENTS = { "̂": "\\hat", "̃": "\\tilde", "̄": "\\bar", "̅": "\\bar", "̇": "\\dot", "̈": "\\ddot", "⃛": "\\dddot", "⃗": "\\vec", "⃖": "\\overleftarrow", "̆": "\\breve", "̌": "\\check", "́": "\\acute", "̀": "\\grave", "ˆ": "\\hat", "˜": "\\tilde", "¯": "\\bar", "→": "\\vec" };
// Brackets (m:d begChr / endChr).
const OMML_BRACKETS = { "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "⟨": "\\langle", "⟩": "\\rangle", "〈": "\\langle", "〉": "\\rangle", "|": "|", "‖": "\\|", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": "." };
// Function names (m:func) LaTeX knows.
const OMML_FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth", "arcsin", "arccos", "arctan", "log", "ln", "lg", "exp", "lim", "liminf", "limsup", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "arg", "gcd", "hom", "Pr"]);

function _ommlChildren(node, tag) {
    return Array.from(node?.children || []).filter(child => !tag || child.tagName === tag);
}
function _ommlChild(node, tag) {
    return _ommlChildren(node, tag)[0] || null;
}
function _ommlVal(props, tag, fallback = null) {
    const node = _ommlChild(props, tag);
    if (!node) return fallback;
    return node.hasAttribute("m:val") ? node.getAttribute("m:val") : fallback;
}
// Mathematical letters (U+1D400 onwards: 𝑥 italic, 𝐑 bold, 𝑹 bold italic, 𝒜 script...) as the plain letter and
// its style. Office stores bold vectors this way; flattened to plain letters, R came in thin.
const OMML_ALPHABETS = [
    [0x1d400, 0x1d433, "bf"], [0x1d434, 0x1d467, "it"], [0x1d468, 0x1d49b, "bi"], [0x1d49c, 0x1d4cf, "cal"], [0x1d4d0, 0x1d503, "cal"],
    [0x1d504, 0x1d537, "frak"], [0x1d538, 0x1d56b, "bb"], [0x1d56c, 0x1d59f, "frak"], [0x1d5a0, 0x1d5d3, "sf"], [0x1d5d4, 0x1d607, "sfbf"],
    [0x1d608, 0x1d63b, "sf"], [0x1d63c, 0x1d66f, "sfbf"], [0x1d670, 0x1d6a3, "tt"], [0x1d6a4, 0x1d6a5, "it"],
    [0x1d6a8, 0x1d6e1, "bf"], [0x1d6e2, 0x1d71b, "it"], [0x1d71c, 0x1d755, "bi"], [0x1d756, 0x1d78f, "sfbf"], [0x1d790, 0x1d7c9, "sfbf"],
    [0x1d7ca, 0x1d7cb, "bf"], [0x1d7ce, 0x1d7d7, "bf"], [0x1d7d8, 0x1d7e1, "bb"], [0x1d7e2, 0x1d7eb, "sf"], [0x1d7ec, 0x1d7f5, "sfbf"], [0x1d7f6, 0x1d7ff, "tt"],
];
function _ommlLetter(char) {
    const code = char.codePointAt(0);
    if (code === 0x210e) return { char: "h", style: "it" }; // Planck's ℎ: an italic h
    if (code < 0x1d400 || code > 0x1d7ff) return { char, style: null };
    const range = OMML_ALPHABETS.find(([lo, hi]) => code >= lo && code <= hi);
    return { char: char.normalize("NFKC"), style: range ? range[2] : null };
}
function _ommlPlainChar(char) {
    return _ommlLetter(char).char;
}
const OMML_STYLE_COMMANDS = { bf: "\\mathbf", bi: "\\boldsymbol", cal: "\\mathcal", frak: "\\mathfrak", bb: "\\mathbb", sf: "\\mathsf", sfbf: "\\boldsymbol", tt: "\\mathtt" };

// Whether an equation needs LaTeX (fractions, radicals, sums...) or reads as styled text.
function ommlIsPlain(math) {
    const all = math.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
        const tag = all[i].tagName;
        if (tag.startsWith("m:") && !OMML_PLAIN_TAGS.has(tag)) return false;
    }
    return true;
}

// ── LaTeX ───────────────────────────────────────────────────────────────────

function _ommlRunLatex(run, context) {
    const props = _ommlChild(run, "m:rPr");
    const text = _ommlChildren(run, "m:t").map(t => t.textContent).join("");
    if (!text) return "";
    // Ordinary text inside the equation (Normal text): as text.
    if (props && _ommlChild(props, "m:nor")) return `\\text{${text.replace(/[\\{}]/g, c => `\\${c === "\\" ? "backslash " : c}`)}}`;
    let latex = "";
    for (const raw of Array.from(text)) {
        const { char, style } = _ommlLetter(raw);
        // "&" lines up the rows of an equation array.
        if (char === "&" && context.align) { latex += "&"; continue; }
        // An italic capital Greek letter (𝛯) is \varXi; LaTeX sets capital Greek upright.
        const symbol = style === "it" && /[ΓΔΘΛΞΠΣΥΦΨΩ]/.test(char) ? OMML_LATEX_SYMBOLS[char].replace("\\", "\\var") : OMML_LATEX_SYMBOLS[char];
        const plain = symbol ? `${symbol}${/^\\[a-zA-Z]+$/.test(symbol) ? " " : ""}` : char;
        latex += style && OMML_STYLE_COMMANDS[style] ? `${OMML_STYLE_COMMANDS[style]}{${plain.trim()}}` : plain;
    }
    // Commands keep the space after them ("\\mu N", not "\\muN"), and a spacer ("\\ ") its space.
    const style = _ommlVal(props, "m:sty");
    const script = _ommlVal(props, "m:scr");
    if (script === "double-struck") return `\\mathbb{${latex}}`;
    if (script === "script") return `\\mathcal{${latex}}`;
    if (script === "fraktur") return `\\mathfrak{${latex}}`;
    // Upright ("p", plain) letters: units, chemical symbols, names. Default is italic, as LaTeX's.
    // Bold set on the run's text properties (<a:rPr b="1">), as PowerPoint's Bold button sets it.
    const runBold = _ommlChild(run, "a:rPr")?.getAttribute("b") === "1";
    if (style === "p" && /[A-Za-z]/.test(latex)) latex = runBold ? `\\mathbf{${latex}}` : `\\mathrm{${latex}}`;
    else
    if (style === "b") latex = `\\mathbf{${latex}}`;
    else if (style === "bi" || runBold) latex = `\\boldsymbol{${latex}}`;
    // A run in another colour than the equation's (a green k_off in a black equation).
    const color = context.color?.(_ommlChild(run, "a:rPr"));
    return color && context.baseColor && color.toLowerCase() !== context.baseColor.toLowerCase() && /^#[0-9a-f]{6}$/i.test(color) ? `\\textcolor{${color}}{${latex}}` : latex;
}

// The children of a container (m:e, m:num, m:sub...) one after the other.
function _ommlSequence(node, context) {
    return _ommlChildren(node).map(child => _ommlLatex(child, context)).join("");
}
const _ommlGroup = latex => `{${latex}}`;

function _ommlLatex(node, context = {}) {
    if (!node) return "";
    const tag = node.tagName;
    const part = name => _ommlSequence(_ommlChild(node, name), context);
    const props = _ommlChild(node, `${tag}Pr`);
    switch (tag) {
        case "m:r": return _ommlRunLatex(node, context);
        case "m:sSub": return `${_ommlGroup(part("m:e"))}_${_ommlGroup(part("m:sub"))}`;
        case "m:sSup": return `${_ommlGroup(part("m:e"))}^${_ommlGroup(part("m:sup"))}`;
        case "m:sSubSup": return `${_ommlGroup(part("m:e"))}_${_ommlGroup(part("m:sub"))}^${_ommlGroup(part("m:sup"))}`;
        case "m:sPre": return `{}_${_ommlGroup(part("m:sub"))}^${_ommlGroup(part("m:sup"))}${_ommlGroup(part("m:e"))}`;
        case "m:f": {
            const type = _ommlVal(props, "m:type", "bar");
            const num = part("m:num"), den = part("m:den");
            if (type === "lin") return `${_ommlGroup(num)}/${_ommlGroup(den)}`;
            if (type === "skw") return `{}^{${num}}\\!/\\!{}_{${den}}`;
            if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
            return `\\frac{${num}}{${den}}`;
        }
        case "m:rad": {
            const degree = part("m:deg");
            return _ommlVal(props, "m:degHide") === "1" || _ommlVal(props, "m:degHide") === "on" || !degree ? `\\sqrt{${part("m:e")}}` : `\\sqrt[${degree}]{${part("m:e")}}`;
        }
        case "m:nary": {
            const chr = _ommlVal(props, "m:chr", "∫");
            const op = OMML_NARY[chr] || `\\mathop{${OMML_LATEX_SYMBOLS[chr] || chr}}`;
            const hidden = name => ["1", "on", "true"].includes(_ommlVal(props, name));
            // Limits above and below, or beside: as the equation says, else as Office draws them (integrals beside;
            // sums under and over in a displayed equation, beside in one set in a line, as a text box's is).
            const location = _ommlVal(props, "m:limLoc") || (/int/.test(op) || context.inline ? "subSup" : "undOvr");
            const limits = location === "undOvr" ? (/int/.test(op) ? "\\limits" : "") : /int/.test(op) ? "" : "\\nolimits";
            const sub = hidden("m:subHide") ? "" : `_${_ommlGroup(part("m:sub"))}`;
            const sup = hidden("m:supHide") ? "" : `^${_ommlGroup(part("m:sup"))}`;
            return `${op}${limits}${sub}${sup}${_ommlGroup(part("m:e"))}`;
        }
        case "m:d": {
            const open = _ommlVal(props, "m:begChr", "("), close = _ommlVal(props, "m:endChr", ")"), sep = _ommlVal(props, "m:sepChr", "|");
            const bracket = (char, side) => (char in OMML_BRACKETS ? OMML_BRACKETS[char] : OMML_LATEX_SYMBOLS[char] || char) || ".";
            const inner = _ommlChildren(node, "m:e").map(e => _ommlSequence(e, context)).join(` ${sep === "|" ? "\\mid" : OMML_LATEX_SYMBOLS[sep] || sep} `);
            return `\\left${bracket(open, "left")} ${inner} \\right${bracket(close, "right")}`;
        }
        case "m:func": {
            const name = part("m:fName");
            const bare = name.replace(/\\mathrm\{([A-Za-z]+)\}/g, "$1");
            const head = /^[A-Za-z]+$/.test(bare) ? (OMML_FUNCTIONS.has(bare) ? `\\${bare}` : `\\operatorname{${bare}}`) : name.replace(/^\\mathrm\{(lim|max|min|sup|inf)\}/, "\\$1");
            return `${head} ${_ommlGroup(part("m:e"))}`;
        }
        case "m:limLow": {
            const base = part("m:e"), limit = part("m:lim");
            const plain = base.replace(/\\mathrm\{([A-Za-z]+)\}/, "$1");
            return OMML_FUNCTIONS.has(plain) ? `\\${plain}_${_ommlGroup(limit)}` : `\\underset{${limit}}{${base}}`;
        }
        case "m:limUpp": return `\\overset{${part("m:lim")}}{${part("m:e")}}`;
        case "m:acc": {
            const chr = _ommlVal(props, "m:chr", "̂");
            return `${OMML_ACCENTS[chr] || "\\hat"}{${part("m:e")}}`;
        }
        case "m:bar": return _ommlVal(props, "m:pos", "bot") === "top" ? `\\overline{${part("m:e")}}` : `\\underline{${part("m:e")}}`;
        case "m:groupChr": {
            const chr = _ommlVal(props, "m:chr", "⏟"), top = _ommlVal(props, "m:pos", "bot") === "top";
            if (chr === "⏟" || chr === "⏞") return chr === "⏞" || top ? `\\overbrace{${part("m:e")}}` : `\\underbrace{${part("m:e")}}`;
            const symbol = OMML_LATEX_SYMBOLS[chr] || chr;
            return top ? `\\overset{${symbol}}{${part("m:e")}}` : `\\underset{${symbol}}{${part("m:e")}}`;
        }
        case "m:borderBox": return `\\boxed{${part("m:e")}}`;
        case "m:box": return part("m:e");
        case "m:phant": return `\\phantom{${part("m:e")}}`;
        case "m:eqArr": {
            // Rows line up at their "&" marks; without any, they start at the same place, as Office sets them.
            const rows = _ommlChildren(node, "m:e").map(e => _ommlSequence(e, { ...context, align: true }));
            const marked = rows.some(row => /(^|[^\\])&/.test(row));
            return `\\begin{aligned}${rows.map(row => (marked ? row : `&${row}`)).join(" \\\\ ")}\\end{aligned}`;
        }
        case "m:m": return `\\begin{matrix}${_ommlChildren(node, "m:mr").map(row => _ommlChildren(row, "m:e").map(e => _ommlSequence(e, context)).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
        case "m:oMathPara": return _ommlChildren(node, "m:oMath").map(math => _ommlSequence(math, { ...context, inline: false })).join(" \\\\ ");
        default:
            // Properties and control marks carry no content; containers (m:e, m:oMath...) their children's.
            if (tag.endsWith("Pr") || tag === "m:ctrlPr") return "";
            return _ommlSequence(node, context);
    }
}

// One <m:oMath> or <m:oMathPara> as LaTeX.
function ommlToLatex(math, options = {}) {
    // An equation outside <m:oMathPara> is set in its line: big operators take their limits beside them.
    // Spacers at either end add nothing to an equation drawn on its own.
    // A prime straight after a group (G^{′}′, x_{i}′) would be a second superscript: it goes on an empty group.
    return _ommlLatex(math, { ...options, inline: math.tagName === "m:oMath" }).replace(/\}('+)/g, "}{}$1").replace(/\s+/g, " ").replace(/^(?:\\[ ,:;]\s*|\s)+|(?:\s|\\[ ,:;])+$/g, "").trim();
}

// ── Plain mathematics as text runs ─────────────────────────────────────────

// Runs ({ text, italic, baseline, rPr }) for plain mathematics: letters in italic as Office draws them (unless set
// upright), scripts raised or lowered, brackets as characters. makeRun(text, rPr, extra) builds each run as the
// paragraph's own runs are built.
function ommlToRuns(math, makeRun) {
    const runs = [];
    const visit = (node, baseline) => {
        const tag = node.tagName;
        if (tag === "m:r") {
            const props = _ommlChild(node, "m:rPr");
            const rPr = _ommlChild(node, "a:rPr");
            const raw = _ommlChildren(node, "m:t").map(t => t.textContent).join("");
            if (!raw) return;
            const style = _ommlVal(props, "m:sty");
            const normal = !!_ommlChild(props, "m:nor");
            const runBold = style === "b" || style === "bi";
            const upright = normal || style === "p" || style === "b";
            // Office sets letters in italic and digits and signs upright, within one run ("5 ns"); a bold letter
            // (𝐑, 𝑹) is bold. Relations, and signs between terms, get a little space each side, as Office sets them.
            const pieces = [];
            Array.from(raw).forEach((rawChar, index) => {
                const { char, style: letterStyle } = _ommlLetter(rawChar);
                const letter = /\p{L}/u.test(char);
                const italic = !normal && (letterStyle === "it" || letterStyle === "bi" || (letter && !upright && !letterStyle));
                const bold = runBold || letterStyle === "bf" || letterStyle === "bi" || letterStyle === "sfbf";
                let text = char;
                const before = pieces.at(-1)?.text || runs.at(-1)?.text || "";
                if (!normal && /[=<>≤≥≈≠≡∝→←⇌⇒⇔∼≃]/.test(char)) text = ` ${char} `;
                else if (!normal && /[+\-−±∓×]/.test(char) && (index > 0 || runs.length) && !/[(\[{= ]$/.test(before)) text = ` ${char === "-" ? "−" : char} `;
                const last = pieces.at(-1);
                if (last && last.italic === italic && last.bold === bold) last.text += text;
                else pieces.push({ text, italic, bold });
            });
            // Bold set on the run itself (b="1") stays: only a bold letter makes a run bold here, never the reverse.
            pieces.forEach(piece => runs.push(makeRun(piece.text, rPr, { italic: piece.italic, baseline, bold: piece.bold || undefined })));
            return;
        }
        const props = _ommlChild(node, `${tag}Pr`);
        const lower = baseline < 0 ? baseline : -25000, upper = baseline > 0 ? baseline : 30000;
        const each = (child, shift) => child && _ommlChildren(child).forEach(c => visit(c, shift));
        if (tag === "m:sSub") { each(_ommlChild(node, "m:e"), baseline); each(_ommlChild(node, "m:sub"), lower); return; }
        if (tag === "m:sSup") { each(_ommlChild(node, "m:e"), baseline); each(_ommlChild(node, "m:sup"), upper); return; }
        if (tag === "m:sSubSup") { each(_ommlChild(node, "m:e"), baseline); each(_ommlChild(node, "m:sub"), lower); each(_ommlChild(node, "m:sup"), upper); return; }
        if (tag === "m:d") {
            const rPr = node.getElementsByTagName("a:rPr")[0] || null;
            const open = _ommlVal(props, "m:begChr", "("), close = _ommlVal(props, "m:endChr", ")"), sep = _ommlVal(props, "m:sepChr", "|");
            if (open) runs.push(makeRun(open, rPr, { italic: false, baseline }));
            _ommlChildren(node, "m:e").forEach((e, i) => {
                if (i && sep) runs.push(makeRun(sep, rPr, { italic: false, baseline }));
                each(e, baseline);
            });
            if (close) runs.push(makeRun(close, rPr, { italic: false, baseline }));
            return;
        }
        if (tag.endsWith("Pr") || tag === "m:ctrlPr") return;
        _ommlChildren(node).forEach(child => visit(child, baseline));
    };
    visit(math, 0);
    return runs;
}

// What to make of a PowerPoint shape that holds equations (the mc:Choice of an mc:AlternateContent):
//   "text"     its equations are plain: the box comes in as text, the equations as styled runs;
//   "equation" its text is all equations, some not plain: one equation object (LaTeX) in its place;
//   "picture"  words and equations that are not plain: the picture PowerPoint keeps of it, as before.
// null when it holds no equations (ink, newer shapes): the picture, as before.
function ommlShapePlan(choice) {
    const shapes = _ommlChildren(choice).filter(child => child.tagName === "p:sp");
    if (shapes.length !== 1 || _ommlChildren(choice).length !== 1) return null;
    const shape = shapes[0];
    const maths = Array.from(shape.getElementsByTagName("a14:m"));
    if (!maths.length) return null;
    if (maths.every(ommlIsPlain)) return { mode: "text", shape };
    const paragraphs = Array.from(shape.getElementsByTagName("a:p"));
    const words = paragraphs.some(p => _ommlChildren(p).some(child => (child.tagName === "a:r" || child.tagName === "a:fld") && /\S/.test(child.textContent)));
    if (words) return { mode: "picture", shape };
    const latex = ommlShapeLatex(shape);
    return latex ? { mode: "equation", shape, latex } : null;
}

// The equations of a shape as one piece of LaTeX: a line per paragraph that holds one. options.color(rPr) and
// options.baseColor colour the runs that differ from the equation's colour.
function ommlShapeLatex(shape, options = {}) {
    // An equation set in its line (<m:oMath> outside <m:oMathPara>) is \textstyle: fractions at text size, as
    // PowerPoint draws it (display-size fractions made such an equation a third larger than its box).
    const lines = Array.from(shape.getElementsByTagName("a:p"))
        .map(p => _ommlChildren(p, "a14:m").map(m => _ommlChildren(m).map(math => {
            const latex = ommlToLatex(math, options);
            return latex && math.tagName === "m:oMath" ? `\\textstyle ${latex}` : latex;
        }).join(" ")).join(" ").trim())
        .filter(Boolean);
    if (!lines.length) return "";
    return lines.length > 1 ? `\\begin{gathered}${lines.join(" \\\\ ")}\\end{gathered}` : lines[0];
}

if (typeof module !== "undefined") module.exports = { ommlToLatex, ommlToRuns, ommlShapePlan, ommlShapeLatex, ommlIsPlain };
