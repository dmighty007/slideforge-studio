import { sanitizeMermaidSvg } from "./mermaid-engine.js";

const DEFAULT_NODE_WIDTH = 138;
const DEFAULT_NODE_HEIGHT = 58;
const MAX_NODE_WIDTH = 520;
const SAFE_ID_RE = /^[A-Za-z_][\w-]*$/;

function escapeHtml(value = "") {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(value = "") {
    return escapeHtml(value).replace(/'/g, "&#39;");
}

function sanitizeId(value = "N") {
    const clean = String(value || "N")
        .trim()
        .replace(/[^\w-]+/g, "_")
        .replace(/^[-\d]+/, "N$&");
    return clean && SAFE_ID_RE.test(clean) ? clean : `N_${Math.abs(hashCode(clean || value || "node"))}`;
}

function hashCode(value) {
    let hash = 0;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value || null));
}

export function createEmptyGraphModel(source = "") {
    return {
        version: 1,
        type: "flowchart",
        direction: "TD",
        nodes: [],
        edges: [],
        groups: [],
        mermaidSource: source,
        layoutMetadata: { algorithm: "hierarchical", updatedAt: Date.now() },
        viewport: { x: 0, y: 0, zoom: 1 },
        style: {},
    };
}

export function extractGraphMetadata(source = "") {
    const match = String(source || "").match(/^\s*%%\s*sf:graph\s+({.*})\s*%%\s*$/m);
    if (!match) return {};
    try {
        const parsed = JSON.parse(match[1]);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
        return {};
    }
}

export function stripGraphMetadata(source = "") {
    return String(source || "")
        .split(/\r?\n/)
        .filter(line => !/^\s*%%\s*sf:graph\s+{.*}\s*%%\s*$/.test(line))
        .join("\n")
        .trim();
}

// Node syntax per shape, longest opener first. Each shape has its own Mermaid spelling so shapes survive a
// save and reopen; "(" and "{{"-less variants read as the nearest shape.
const NODE_SYNTAX = [
    ["database", "[(", ")]"],
    ["cloud", "((", "))"],
    ["hexagon", "{{", "}}"],
    ["queue", "[[", "]]"],
    ["scientific", "([", "])"],
    ["parallelogram", "[/", "/]"],
    ["document", "[\\", "\\]"],
    ["decision", "{", "}"],
    ["process", "[", "]"],
    ["process", "(", ")"],
    ["actor", ">", "]"],
];
const NODE_ID_RE = /^([A-Za-z_][\w-]*)/;

function decodeMermaidLabel(text = "") {
    let label = String(text).trim();
    if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) label = label.slice(1, -1);
    return label.replace(/#quot;/g, '"').replace(/#35;/g, "#");
}

// { id, label, shape } for a node token; shape is null for a bare reference ("B"), which must not change the
// shape the node was declared with. Unreadable tokens return { error }.
function readNodeToken(token = "") {
    const text = token.trim();
    const idMatch = text.match(NODE_ID_RE);
    if (!idMatch) return { error: `"${text}" is not a node` };
    const id = sanitizeId(idMatch[1]);
    const rest = text.slice(idMatch[1].length).trim();
    if (!rest) return { id, label: idMatch[1], shape: null };
    for (const [shape, open, close] of NODE_SYNTAX) {
        if (rest.startsWith(open) && rest.endsWith(close) && rest.length >= open.length + close.length) {
            return { id, label: decodeMermaidLabel(rest.slice(open.length, rest.length - close.length)), shape };
        }
    }
    return { error: `"${text}" is not a node` };
}

// A link starting at line[index] (outside brackets and quotes): "-->", "---", "--o", "--x", "-.->", "==>",
// "<-->", with an optional "|label|" or inline text ("-- yes -->"). Single dashes (in ids and labels) are not links.
function matchLink(line, index) {
    const rest = line.slice(index);
    const inline = rest.match(/^\s*(--|==|-\.)\s+([^|>]+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+|-{2,}[ox](?![\w]))\s*/);
    const plain = inline ? null : rest.match(/^\s*(<?)(-{2,}>|-{2,}[ox](?![\w])|-{3,}|-\.+->|-\.+-|={2,}>|={3,})\s*/);
    const match = inline || plain;
    if (!match) return null;
    const token = inline ? `${inline[1]}${inline[3]}` : `${plain[1]}${plain[2]}`;
    let label = inline ? inline[2].trim() : "";
    let consumed = match[0].length;
    const pipe = line.slice(index + consumed).match(/^\|([^|]*)\|\s*/);
    if (pipe) {
        label = pipe[1].trim();
        consumed += pipe[0].length;
    }
    const head = token.endsWith(">") ? "arrow" : /o$/.test(token) ? "circle" : /x$/.test(token) ? "cross" : "none";
    const lineStyle = token.includes(".") ? "dotted" : token.includes("=") ? "thick" : "solid";
    return { end: index + consumed, link: { label: decodeMermaidLabel(label), arrow: head, lineStyle, bidirectional: token.startsWith("<") } };
}

// Splits a statement into node segments and links, ignoring link-like text inside [], (), {}, quotes.
function splitFlowStatement(line) {
    const parts = [];
    let current = "";
    let depth = 0;
    let quoted = false;
    for (let i = 0; i < line.length; ) {
        const ch = line[i];
        if (quoted) {
            current += ch;
            if (ch === '"') quoted = false;
            i += 1;
            continue;
        }
        if (ch === '"') quoted = true;
        else if ("[({".includes(ch)) depth += 1;
        else if ("])}".includes(ch)) depth = Math.max(0, depth - 1);
        else if (ch === ">" && depth === 0 && NODE_ID_RE.test(current.trim()) && /^[A-Za-z_][\w-]*$/.test(current.trim())) depth += 1; // A>flag]
        else if (depth === 0) {
            const link = matchLink(line, i);
            if (link) {
                parts.push(current.trim(), link.link);
                current = "";
                i = link.end;
                continue;
            }
        }
        current += ch;
        i += 1;
    }
    parts.push(current.trim());
    return parts;
}

function splitAmpersands(segment) {
    const out = [];
    let depth = 0;
    let current = "";
    for (const ch of segment) {
        if ("[({".includes(ch)) depth += 1;
        else if ("])}".includes(ch)) depth = Math.max(0, depth - 1);
        if (ch === "&" && depth === 0) {
            out.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    out.push(current.trim());
    return out;
}

const IGNORED_STATEMENTS = /^(flowchart|graph|subgraph|end\b|direction|classDef|class\s|style\s|linkStyle|click\s|%%)/i;

// Reads one flowchart statement into node tokens and links: { nodes: [[token...]...], links: [...] } or { error }.
function parseFlowStatement(line) {
    const parts = splitFlowStatement(line);
    const groups = [];
    const links = [];
    for (let k = 0; k < parts.length; k += 1) {
        if (k % 2) {
            links.push(parts[k]);
            continue;
        }
        if (!parts[k]) return { error: parts.length > 1 ? "an arrow needs a node on both sides" : "empty statement" };
        const tokens = splitAmpersands(parts[k]).map(readNodeToken);
        const bad = tokens.find(token => token.error);
        if (bad) return { error: bad.error };
        groups.push(tokens);
    }
    return { nodes: groups, links };
}

// Problems in flowchart source, for the editor: [{ line, message }].
export function diagnoseFlowchart(source = "") {
    const problems = [];
    String(stripGraphMetadata(source) || "")
        .split(/\r?\n/)
        .forEach((raw, index) => {
            const line = raw.trim();
            if (!line || IGNORED_STATEMENTS.test(line)) return;
            const parsed = parseFlowStatement(line.replace(/;\s*$/, ""));
            if (parsed.error) problems.push({ line: index + 1, message: parsed.error });
        });
    return problems;
}

function ensureNode(model, node, metadata = {}, previous = null) {
    let existing = model.nodes.find(item => item.id === node.id);
    if (!existing) {
        const previousNode = previous?.nodes?.find(item => item.id === node.id);
        const metaPos = metadata.positions?.[node.id] || metadata.nodePositions?.[node.id] || {};
        existing = {
            id: node.id,
            label: node.label || node.id,
            shape: node.shape || previousNode?.shape || "process",
            x: Number.isFinite(Number(metaPos.x)) ? Number(metaPos.x) : Number(previousNode?.x),
            y: Number.isFinite(Number(metaPos.y)) ? Number(metaPos.y) : Number(previousNode?.y),
            width: Number(previousNode?.width) || DEFAULT_NODE_WIDTH,
            height: Number(previousNode?.height) || DEFAULT_NODE_HEIGHT,
            locked: Boolean(previousNode?.locked),
            style: previousNode?.style || {},
            ...(previousNode?.autoPlacedAt ? { autoPlacedAt: previousNode.autoPlacedAt } : {}),
        };
        model.nodes.push(existing);
    } else {
        const nextLabel = node.label || "";
        const isDescriptiveLabel = nextLabel && nextLabel !== node.id;
        if (isDescriptiveLabel || !existing.label || existing.label === existing.id) {
            existing.label = nextLabel || existing.label;
        }
        if (node.shape) existing.shape = node.shape; // a bare reference keeps the declared shape
    }
    return existing;
}

export function parseMermaidToGraph(source = "", previousGraph = null) {
    const raw = stripGraphMetadata(source);
    const metadata = extractGraphMetadata(source);
    const model = createEmptyGraphModel(source);
    const lines = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const header = lines.find(line => /^(flowchart|graph)\s+/i.test(line));
    if (header) {
        const match = header.match(/^(?:flowchart|graph)\s+([A-Z]{2})/i);
        model.direction = (match?.[1] || previousGraph?.direction || "TD").toUpperCase();
    }

    lines.forEach(line => {
        if (IGNORED_STATEMENTS.test(line)) return;
        const parsed = parseFlowStatement(line.replace(/;\s*$/, ""));
        if (parsed.error) return; // reported by diagnoseFlowchart; a broken line adds nothing
        const groups = parsed.nodes.map(tokens => tokens.map(token => ensureNode(model, token, metadata, previousGraph)));
        parsed.links.forEach((link, index) => {
            groups[index].forEach(from => {
                groups[index + 1].forEach(to => {
                    const id = `e_${from.id}_${to.id}_${model.edges.length}`;
                    const previousEdge = previousGraph?.edges?.find(
                        edge => edge.from === from.id && edge.to === to.id && edge.label === link.label,
                    );
                    model.edges.push({
                        id: previousEdge?.id || id,
                        from: from.id,
                        to: to.id,
                        label: link.label,
                        arrow: link.arrow,
                        lineStyle: link.lineStyle,
                        routingStyle: previousEdge?.routingStyle || metadata.routingStyle || "orthogonal",
                        waypoints: Array.isArray(previousEdge?.waypoints) ? previousEdge.waypoints : [],
                        labelOffset: previousEdge?.labelOffset ||
                            metadata.edgeLabels?.[previousEdge?.id || id] || { x: 0, y: 0 },
                        style: previousEdge?.style || {},
                    });
                });
            });
        });
    });

    const previousPositions = previousGraph?.nodePositions || metadata.positions || {};
    model.nodePositions = {};
    model.nodes.forEach(node => {
        const pos = previousPositions[node.id] || {};
        if (!Number.isFinite(node.x) && Number.isFinite(Number(pos.x))) node.x = Number(pos.x);
        if (!Number.isFinite(node.y) && Number.isFinite(Number(pos.y))) node.y = Number(pos.y);
        if (Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))) {
            model.nodePositions[node.id] = { x: Number(node.x), y: Number(node.y) };
        }
    });
    model.lockedLayout = Boolean(previousGraph?.lockedLayout || metadata.lockedLayout);
    model.autoLayout = previousGraph?.autoLayout ?? metadata.autoLayout ?? true;
    model.routingStyle = previousGraph?.routingStyle || metadata.routingStyle || "orthogonal";
    model.connectionStyle = previousGraph?.connectionStyle || metadata.connectionStyle || "arrow";
    return layoutGraphModel(model, { preservePositions: true });
}

// Hierarchical layout sized by the nodes themselves: ranks follow the edges (longest path, loops tolerated),
// each rank is as deep as its largest node, siblings sit side by side with their real widths, and ranks are
// centred on each other. A node keeps its position only if the user placed it: the layout remembers where it
// put each node (autoPlacedAt), and a node still there is laid out again, so a bad automatic spot never sticks.
export function layoutGraphModel(graph, options = {}) {
    const model = clone(graph) || createEmptyGraphModel();
    const preserve = options.preservePositions !== false;
    const rankGap = 64;
    const nodeGap = 44;
    const margin = 48;
    const horizontal = model.direction === "LR" || model.direction === "RL";
    const fontSize = Number(model.style?.fontSize) || 16;

    model.nodes.forEach(node => {
        const measured = measureNode(node, fontSize);
        const explicitWidth = Number(node.width);
        const explicitHeight = Number(node.height);
        node.width = Math.max(72, Math.min(MAX_NODE_WIDTH, explicitWidth > 0 ? Math.max(explicitWidth, measured.width) : measured.width));
        node.height = Math.max(42, Math.min(320, explicitHeight > 0 ? Math.max(explicitHeight, measured.height) : measured.height));
    });

    const ids = new Set(model.nodes.map(node => node.id));
    const edges = model.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
    // Ranks by longest path, with the links that close a loop set aside (found by a depth-first walk from the
    // nodes nothing points to, in source order). Ranking through a loop pushed its first step to the end: the
    // CI/CD template's "Commit" came out after "Fix failures".
    const indegree = new Map(model.nodes.map(node => [node.id, 0]));
    edges.forEach(edge => indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1));
    const outgoing = new Map(model.nodes.map(node => [node.id, []]));
    edges.forEach(edge => outgoing.get(edge.from)?.push(edge));
    const backEdges = new Set();
    const walkState = new Map(); // 1 while on the current path, 2 when finished
    const starts = [...model.nodes.filter(node => !indegree.get(node.id)), ...model.nodes].map(node => node.id);
    starts.forEach(startId => {
        if (walkState.has(startId)) return;
        const stack = [{ id: startId, next: 0 }];
        walkState.set(startId, 1);
        while (stack.length) {
            const top = stack[stack.length - 1];
            const edge = outgoing.get(top.id)[top.next++];
            if (!edge) {
                walkState.set(top.id, 2);
                stack.pop();
            } else if (walkState.get(edge.to) === 1) {
                backEdges.add(edge);
            } else if (!walkState.has(edge.to)) {
                walkState.set(edge.to, 1);
                stack.push({ id: edge.to, next: 0 });
            }
        }
    });
    const forward = edges.filter(edge => !backEdges.has(edge));
    const remaining = new Map(model.nodes.map(node => [node.id, 0]));
    forward.forEach(edge => remaining.set(edge.to, remaining.get(edge.to) + 1));
    const ranks = new Map();
    const queue = model.nodes.filter(node => !remaining.get(node.id)).map(node => node.id);
    queue.forEach(id => ranks.set(id, 0));
    while (queue.length) {
        const id = queue.shift();
        forward
            .filter(edge => edge.from === id)
            .forEach(edge => {
                ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(id) || 0) + 1));
                remaining.set(edge.to, remaining.get(edge.to) - 1);
                if (!remaining.get(edge.to)) queue.push(edge.to);
            });
    }
    model.nodes.forEach(node => {
        if (!ranks.has(node.id)) ranks.set(node.id, 0);
    });

    const rankList = [...new Set(model.nodes.map(node => ranks.get(node.id)))].sort((a, b) => a - b);
    const byRank = rankList.map(rank => model.nodes.filter(node => ranks.get(node.id) === rank));
    // Order each rank under its parents (average parent position), which untangles most crossings.
    const order = new Map();
    byRank.forEach((nodes, level) => {
        if (level > 0) {
            const parentsOf = node => edges.filter(edge => edge.to === node.id).map(edge => order.get(edge.from)).filter(Number.isFinite);
            nodes.sort((a, b) => {
                const pa = parentsOf(a);
                const pb = parentsOf(b);
                const ka = pa.length ? pa.reduce((x, y) => x + y, 0) / pa.length : Infinity;
                const kb = pb.length ? pb.reduce((x, y) => x + y, 0) / pb.length : Infinity;
                return ka - kb;
            });
        }
        nodes.forEach((node, index) => order.set(node.id, index));
    });

    const along = node => (horizontal ? node.width : node.height); // depth of a rank
    const across = node => (horizontal ? node.height : node.width); // room a node takes beside its siblings
    const rankSpan = nodes => nodes.reduce((sum, node) => sum + across(node), 0) + nodeGap * Math.max(0, nodes.length - 1);
    const widest = Math.max(0, ...byRank.map(rankSpan));
    let major = margin;
    byRank.forEach(nodes => {
        const depth = Math.max(...nodes.map(along));
        let minor = margin + (widest - rankSpan(nodes)) / 2;
        nodes.forEach(node => {
            const hasPosition = Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y)) && node.x !== null && node.y !== null;
            const stillAutoPlaced =
                node.autoPlacedAt && Number(node.autoPlacedAt.x) === Number(node.x) && Number(node.autoPlacedAt.y) === Number(node.y);
            const keep = preserve && hasPosition && !stillAutoPlaced && (node.autoPlacedAt || options.trustPositions !== false);
            if (!keep) {
                const offset = (depth - along(node)) / 2;
                const x = horizontal ? major + offset : minor;
                const y = horizontal ? minor : major + offset;
                node.x = Math.round(x);
                node.y = Math.round(y);
                node.autoPlacedAt = { x: node.x, y: node.y };
            }
            minor += across(node) + nodeGap;
        });
        major += depth + rankGap;
    });

    model.nodePositions = {};
    model.nodes.forEach(node => {
        node.x = Math.round(Number(node.x) || margin);
        node.y = Math.round(Number(node.y) || margin);
        model.nodePositions[node.id] = { x: node.x, y: node.y };
    });
    model.layoutMetadata = { ...(model.layoutMetadata || {}), algorithm: "hierarchical", updatedAt: Date.now() };
    return model;
}

export function graphToMermaid(graph) {
    const model = graph || createEmptyGraphModel();
    const lines = [`flowchart ${model.direction || "TD"}`];
    const metadata = {
        positions: Object.fromEntries(
            (model.nodes || []).map(node => [node.id, { x: Math.round(node.x || 0), y: Math.round(node.y || 0) }]),
        ),
        routingStyle: model.routingStyle || "orthogonal",
        connectionStyle: model.connectionStyle || "arrow",
        lockedLayout: Boolean(model.lockedLayout),
        autoLayout: model.autoLayout !== false,
        edgeLabels: Object.fromEntries(
            (model.edges || [])
                .filter(edge => edge.labelOffset)
                .map(edge => [
                    edge.id,
                    {
                        x: Math.round(Number(edge.labelOffset?.x) || 0),
                        y: Math.round(Number(edge.labelOffset?.y) || 0),
                    },
                ]),
        ),
    };
    lines.push(`%% sf:graph ${JSON.stringify(metadata)} %%`);
    (model.edges || []).forEach(edge => {
        const from = model.nodes.find(node => node.id === edge.from);
        const to = model.nodes.find(node => node.id === edge.to);
        if (!from || !to) return;
        const label = edge.label ? `|${String(edge.label).replace(/\|/g, "/").replace(/"/g, "#quot;")}| ` : "";
        lines.push(`    ${nodeToMermaid(from)} ${linkToMermaid(edge)} ${label}${nodeToMermaid(to)}`);
    });
    const connected = new Set((model.edges || []).flatMap(edge => [edge.from, edge.to]));
    (model.nodes || [])
        .filter(node => !connected.has(node.id))
        .forEach(node => {
            lines.push(`    ${nodeToMermaid(node)}`);
        });
    return lines.join("\n");
}

// Quoted when the label holds characters that would end or confuse the node syntax.
function labelToMermaid(label) {
    const text = String(label ?? "");
    if (!/[\[\]{}()|<>"#;]/.test(text) && text === text.trim()) return text;
    return `"${text.replace(/#/g, "#35;").replace(/"/g, "#quot;")}"`;
}

function nodeToMermaid(node) {
    const id = sanitizeId(node.id);
    const [, open, close] = NODE_SYNTAX.find(([shape]) => shape === node.shape) || NODE_SYNTAX.find(([shape]) => shape === "process");
    return `${id}${open}${labelToMermaid(node.label || id)}${close}`;
}

function linkToMermaid(edge) {
    const dotted = edge.lineStyle === "dotted";
    const thick = edge.lineStyle === "thick";
    const body = dotted ? "-.-" : thick ? "==" : "--";
    const head = { arrow: ">", circle: "o", cross: "x", none: dotted ? "" : thick ? "=" : "-" }[edge.arrow || "arrow"] ?? ">";
    return `${body}${head}`;
}

function nodeCenter(node) {
    return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function edgeLabelPoint(edge, model) {
    const from = model.nodes.find(node => node.id === edge.from);
    const to = model.nodes.find(node => node.id === edge.to);
    if (!from || !to) return { x: 80, y: 80 };
    const a = nodeCenter(from);
    const b = nodeCenter(to);
    const offset = edge.labelOffset || {};
    const detour = edgeRoute(edge, model).label;
    return {
        x: (detour ? detour.x : (a.x + b.x) / 2) + (Number(offset.x) || 0),
        y: (detour ? detour.y : (a.y + b.y) / 2 - 8) + (Number(offset.y) || 0),
    };
}

function splitLabelLines(label = "") {
    const rawLines = String(label || "").split(/\n/);
    const lines = [];
    rawLines.forEach(raw => {
        const line = raw.trim();
        if (!line) {
            lines.push("");
            return;
        }
        const words = line.split(/\s+/);
        let current = "";
        words.forEach(word => {
            if ((current + " " + word).trim().length > 22 && current) {
                lines.push(current);
                current = word;
            } else {
                current = `${current} ${word}`.trim();
            }
        });
        if (current) lines.push(current);
    });
    return lines.slice(0, 8);
}

// Approximate box size for a label at the diagram's font size (about 0.56em per character).
function measureNode(node, fontSize = 16) {
    const lines = splitLabelLines(node.label || node.id);
    const longest = Math.max(8, ...lines.map(line => line.replace(/[*_`]/g, "").length));
    const size = Number(node.style?.fontSize) || fontSize;
    const extra = ["decision", "hexagon", "cloud"].includes(node.shape) ? 1.35 : 1; // slanted/round shapes need room
    return {
        width: Math.max(DEFAULT_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, (longest * size * 0.56 + 42) * extra)),
        height: Math.max(DEFAULT_NODE_HEIGHT, lines.length * size * 1.25 + 30) * (node.shape === "decision" ? 1.25 : 1),
    };
}

function labelChunks(line = "") {
    const chunks = [];
    const re = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;
    let index = 0;
    let match;
    while ((match = re.exec(line))) {
        if (match.index > index) chunks.push({ text: line.slice(index, match.index) });
        if (match[2]) chunks.push({ text: match[2], weight: "800" });
        else if (match[3]) chunks.push({ text: match[3], style: "italic" });
        else if (match[4]) chunks.push({ text: match[4], code: true });
        index = match.index + match[0].length;
    }
    if (index < line.length) chunks.push({ text: line.slice(index) });
    return chunks.length ? chunks : [{ text: line }];
}

function labelToSvg(node, textColor, defaultFontSize = 16, defaultFontFamily = "Inter, Arial, sans-serif") {
    const lines = splitLabelLines(node.label || node.id);
    const cx = node.x + node.width / 2;
    const fontSize = node.style?.fontSize || defaultFontSize;
    const fontFamily = node.style?.fontFamily || defaultFontFamily;
    const lineHeight = fontSize * 1.25;
    const startY = node.y + node.height / 2 - (lines.length - 1) * (lineHeight / 2);
    return lines
        .map((line, lineIndex) => {
            const bullet = /^\s*[-*]\s+/.test(line);
            const clean = bullet ? line.replace(/^\s*[-*]\s+/, "") : line;
            const chunks = labelChunks(clean);
            const tspans = [];
            if (bullet) tspans.push(`<tspan fill="${textColor}">&#8226; </tspan>`);
            chunks.forEach(chunk => {
                const attrs = [
                    chunk.weight ? `font-weight="${chunk.weight}"` : "",
                    chunk.style ? `font-style="${chunk.style}"` : "",
                    chunk.code ? `font-family="'SFMono-Regular', Consolas, monospace"` : "",
                    chunk.code ? `fill="#334155"` : "",
                ]
                    .filter(Boolean)
                    .join(" ");
                tspans.push(`<tspan ${attrs}>${escapeHtml(chunk.text)}</tspan>`);
            });
            return `<text x="${cx}" y="${startY + lineIndex * lineHeight}" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" class="mermaid-graph-node-label" style="font-family:${fontFamily};font-size:${fontSize}px;fill:${textColor}">${tspans.join("")}</text>`;
        })
        .join("");
}

// An edge leaves and enters its nodes at their borders (not their centres), so the arrowhead is drawn beside
// the target instead of underneath it. It runs sideways when the nodes are side by side, otherwise up/down.
function edgePath(edge, model) {
    return edgeRoute(edge, model).d;
}

// Whether an axis-aligned segment passes through a node's box.
function segmentCrossesNode(p, q, node, pad = 4) {
    const left = node.x - pad;
    const right = node.x + node.width + pad;
    const top = node.y - pad;
    const bottom = node.y + node.height + pad;
    if (p.y === q.y) return p.y > top && p.y < bottom && Math.max(p.x, q.x) > left && Math.min(p.x, q.x) < right;
    return p.x > left && p.x < right && Math.max(p.y, q.y) > top && Math.min(p.y, q.y) < bottom;
}

// A link that would run through other boxes (typically a loop back to an earlier step: D --> A in a row
// A -> B -> C -> D) goes around them instead: below the row in a left-right chart, to the right of the column in
// a top-down one. Drawn straight, it ran behind B and C and looked like a two-way arrow between A and B.
function detourRoute(from, to, model, horizontal) {
    const others = model.nodes.filter(node => node !== from && node !== to);
    if (horizontal) {
        const span = [from, to, ...others.filter(node => node.x + node.width > Math.min(from.x, to.x) && node.x < Math.max(from.x + from.width, to.x + to.width))];
        const lane = Math.max(...span.map(node => node.y + node.height)) + 30;
        const start = { x: from.x + from.width / 2, y: from.y + from.height };
        const end = { x: to.x + to.width / 2, y: to.y + to.height };
        return { d: `M ${start.x} ${start.y} L ${start.x} ${lane} L ${end.x} ${lane} L ${end.x} ${end.y}`, end, dir: { x: 0, y: -1 }, label: { x: (start.x + end.x) / 2, y: lane - 8 } };
    }
    const span = [from, to, ...others.filter(node => node.y + node.height > Math.min(from.y, to.y) && node.y < Math.max(from.y + from.height, to.y + to.height))];
    const lane = Math.max(...span.map(node => node.x + node.width)) + 30;
    const start = { x: from.x + from.width, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width, y: to.y + to.height / 2 };
    return { d: `M ${start.x} ${start.y} L ${lane} ${start.y} L ${lane} ${end.y} L ${end.x} ${end.y}`, end, dir: { x: -1, y: 0 }, label: { x: lane + 8, y: (start.y + end.y) / 2 } };
}

// The edge's path and where/which way it arrives, so the end (arrowhead, circle, cross) can be drawn inline.
function edgeRoute(edge, model) {
    const from = model.nodes.find(node => node.id === edge.from);
    const to = model.nodes.find(node => node.id === edge.to);
    if (!from || !to) return { d: "", end: null, dir: null };
    const route = straightEdgeRoute(from, to, edge);
    const others = model.nodes.filter(node => node !== from && node !== to);
    const blocked = route.points.some((point, index) => index > 0 && others.some(node => segmentCrossesNode(route.points[index - 1], point, node)));
    if (!blocked) return route;
    return detourRoute(from, to, model, route.dir.y === 0);
}

function straightEdgeRoute(from, to, edge) {
    const a = nodeCenter(from);
    const b = nodeCenter(to);
    const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
    const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
    const sideways = gapX > 0 && (gapX >= gapY || gapY <= 0);
    if (sideways) {
        const right = b.x > a.x;
        const start = { x: right ? from.x + from.width : from.x, y: a.y };
        const endPoint = { x: right ? to.x : to.x + to.width, y: b.y };
        const dir = { x: right ? 1 : -1, y: 0 };
        const midX = Math.round((start.x + endPoint.x) / 2);
        const points = [start, { x: midX, y: start.y }, { x: midX, y: endPoint.y }, endPoint];
        if (edge.routingStyle === "curved") {
            const mx = (start.x + endPoint.x) / 2;
            return { d: `M ${start.x} ${start.y} C ${mx} ${start.y}, ${mx} ${endPoint.y}, ${endPoint.x} ${endPoint.y}`, end: endPoint, dir, points };
        }
        return { d: `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${endPoint.y} L ${endPoint.x} ${endPoint.y}`, end: endPoint, dir, points };
    }
    const down = b.y > a.y;
    const start = { x: a.x, y: down ? from.y + from.height : from.y };
    const endPoint = { x: b.x, y: down ? to.y : to.y + to.height };
    const dir = { x: 0, y: down ? 1 : -1 };
    const midY = Math.round((start.y + endPoint.y) / 2);
    const points = [start, { x: start.x, y: midY }, { x: endPoint.x, y: midY }, endPoint];
    if (edge.routingStyle === "curved") {
        const my = (start.y + endPoint.y) / 2;
        return { d: `M ${start.x} ${start.y} C ${start.x} ${my}, ${endPoint.x} ${my}, ${endPoint.x} ${endPoint.y}`, end: endPoint, dir, points };
    }
    return { d: `M ${start.x} ${start.y} L ${start.x} ${midY} L ${endPoint.x} ${midY} L ${endPoint.x} ${endPoint.y}`, end: endPoint, dir, points };
}

// An edge's end drawn as its own shape (not an SVG marker, whose id reference breaks when the same diagram is on
// the page twice, e.g. slide and thumbnail, and which some export renderers ignore).
function edgeEndShape(kind, end, dir, color) {
    if (!end || !dir || kind === "none") return "";
    const px = -dir.y;
    const py = dir.x;
    const at = (along, side) => `${Math.round((end.x - dir.x * along + px * side) * 10) / 10},${Math.round((end.y - dir.y * along + py * side) * 10) / 10}`;
    if (kind === "circle") {
        const cx = end.x - dir.x * 5;
        const cy = end.y - dir.y * 5;
        return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#ffffff" stroke="${color}" stroke-width="1.8" />`;
    }
    if (kind === "cross") {
        return `<path d="M ${at(9, 4.5)} L ${at(1, -4.5)} M ${at(9, -4.5)} L ${at(1, 4.5)}" stroke="${color}" stroke-width="2" fill="none" />`;
    }
    return `<polygon points="${at(0, 0)} ${at(11, 5.5)} ${at(11, -5.5)}" fill="${color}" />`;
}

function roughPoints(points, seed = "") {
    let hash = Math.abs(hashCode(seed));
    return points
        .map((point, index) => {
            hash = (hash * 1664525 + 1013904223 + index) >>> 0;
            const dx = ((hash % 100) / 100 - 0.5) * 5;
            hash = (hash * 1664525 + 1013904223 + index + 7) >>> 0;
            const dy = ((hash % 100) / 100 - 0.5) * 5;
            return `${Math.round(point[0] + dx)},${Math.round(point[1] + dy)}`;
        })
        .join(" ");
}

function roughRectPath(x, y, w, h, r = 10, seed = "") {
    const points = [
        [x + r, y],
        [x + w - r, y],
        [x + w, y + r],
        [x + w, y + h - r],
        [x + w - r, y + h],
        [x + r, y + h],
        [x, y + h - r],
        [x, y + r],
    ];
    return `M ${roughPoints(points, seed).replaceAll(" ", " L ")} Z`;
}

function roughPathD(d, seed = "") {
    if (!d || !seed) return d;
    let hash = Math.abs(hashCode(seed));
    return d.replace(/-?\d+(?:\.\d+)?/g, value => {
        hash = (hash * 1103515245 + 12345) >>> 0;
        const jitter = ((hash % 100) / 100 - 0.5) * 4;
        return String(Math.round((Number(value) + jitter) * 10) / 10);
    });
}

function isDarkColor(color) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
    if (!match) return false;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
}

// Sketch is Draw with a second, lighter pencil stroke along a slightly different wobble, the way a quick sketch
// goes over its lines twice. Draw and Sketch were drawn identically (the sketch flag was never used).
function nodeShape(node, style) {
    const first = nodeShapeOnce(node, style);
    if ((style.renderMode || (style.handDrawn ? "sketch" : "real")) !== "sketch") return first;
    const second = nodeShapeOnce({ ...node, id: `${node.id}~pencil` }, { ...style, renderMode: "draw" })
        .replace(/data-node-id="[^"]*"/, 'aria-hidden="true" pointer-events="none"')
        .replace(/fill="[^"]*"/g, 'fill="none"')
        .replace(/class="mermaid-graph-node-shape/, 'stroke-width="1.3" stroke-opacity="0.7" class="mermaid-graph-node-shape mermaid-graph-sketch-pass');
    return first + second;
}

function nodeShapeOnce(node, style) {
    const common = `data-node-id="${escapeAttr(node.id)}"`;
    const fill = node.style?.fill || style.primaryColor || "#eef2ff";
    const stroke = node.style?.stroke || style.lineColor || "#4f46e5";
    const renderMode = style.renderMode || (style.handDrawn ? "sketch" : "real");
    const hand = renderMode !== "real";
    const sketch = renderMode === "sketch";
    const pathAttrs = `${common} class="mermaid-graph-node-shape ${hand ? "is-drawn" : ""} ${sketch ? "is-sketch" : ""}" fill="${fill}" stroke="${stroke}"`;
    if (
        hand &&
        !["decision", "cloud", "actor", "queue", "hexagon", "parallelogram", "document", "scientific"].includes(
            node.shape,
        )
    ) {
        return `<path ${pathAttrs} d="${roughRectPath(node.x, node.y, node.width, node.height, node.shape === "database" ? 24 : 10, node.id)}" />`;
    }
    if (node.shape === "decision") {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const points = hand
            ? roughPoints(
                  [
                      [cx, node.y],
                      [node.x + node.width, cy],
                      [cx, node.y + node.height],
                      [node.x, cy],
                  ],
                  node.id,
              )
            : `${cx},${node.y} ${node.x + node.width},${cy} ${cx},${node.y + node.height} ${node.x},${cy}`;
        return `<polygon ${common} class="mermaid-graph-node-shape ${hand ? "is-drawn" : ""} ${sketch ? "is-sketch" : ""}" points="${points}" fill="${fill}" stroke="${stroke}" />`;
    }
    if (node.shape === "database") {
        return `<rect ${common} class="mermaid-graph-node-shape ${hand ? "is-drawn" : ""} ${sketch ? "is-sketch" : ""}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="24" fill="${fill}" stroke="${stroke}" />`;
    }
    if (node.shape === "cloud") {
        const x = node.x,
            y = node.y,
            w = node.width,
            h = node.height;
        const d = `M ${x + w * 0.24} ${y + h * 0.72} C ${x + w * 0.05} ${y + h * 0.72}, ${x + w * 0.06} ${y + h * 0.42}, ${x + w * 0.28} ${y + h * 0.44} C ${x + w * 0.32} ${y + h * 0.18}, ${x + w * 0.62} ${y + h * 0.16}, ${x + w * 0.7} ${y + h * 0.42} C ${x + w * 0.92} ${y + h * 0.4}, ${x + w * 0.96} ${y + h * 0.72}, ${x + w * 0.74} ${y + h * 0.72} Z`;
        return `<path ${pathAttrs} d="${hand ? roughPathD(d, node.id) : d}" />`;
    }
    if (node.shape === "actor") {
        const cx = node.x + node.width / 2,
            top = node.y + 8;
        return `<g ${common} class="mermaid-graph-node-shape ${hand ? "is-drawn" : ""} ${sketch ? "is-sketch" : ""}" fill="none" stroke="${stroke}" stroke-width="2.2">
            <circle cx="${cx}" cy="${top + 12}" r="11" fill="${fill}" />
            <path d="${roughPathD(`M ${cx} ${top + 24} L ${cx} ${top + 48} M ${cx - 28} ${top + 34} L ${cx + 28} ${top + 34} M ${cx} ${top + 48} L ${cx - 24} ${top + 72} M ${cx} ${top + 48} L ${cx + 24} ${top + 72}`, node.id)}" />
        </g>`;
    }
    if (node.shape === "queue") {
        return `<path ${pathAttrs} d="${roughPathD(`M ${node.x + 16} ${node.y} H ${node.x + node.width} V ${node.y + node.height} H ${node.x + 16} C ${node.x - 6} ${node.y + node.height}, ${node.x - 6} ${node.y}, ${node.x + 16} ${node.y} Z`, node.id)}" />`;
    }
    if (node.shape === "hexagon") {
        const x = node.x,
            y = node.y,
            w = node.width,
            h = node.height;
        const points = hand
            ? roughPoints(
                  [
                      [x + 24, y],
                      [x + w - 24, y],
                      [x + w, y + h / 2],
                      [x + w - 24, y + h],
                      [x + 24, y + h],
                      [x, y + h / 2],
                  ],
                  node.id,
              )
            : `${x + 24},${y} ${x + w - 24},${y} ${x + w},${y + h / 2} ${x + w - 24},${y + h} ${x + 24},${y + h} ${x},${y + h / 2}`;
        return `<polygon ${pathAttrs} points="${points}" />`;
    }
    if (node.shape === "parallelogram") {
        const x = node.x,
            y = node.y,
            w = node.width,
            h = node.height;
        const points = hand
            ? roughPoints(
                  [
                      [x + 22, y],
                      [x + w, y],
                      [x + w - 22, y + h],
                      [x, y + h],
                  ],
                  node.id,
              )
            : `${x + 22},${y} ${x + w},${y} ${x + w - 22},${y + h} ${x},${y + h}`;
        return `<polygon ${pathAttrs} points="${points}" />`;
    }
    if (node.shape === "document") {
        const x = node.x,
            y = node.y,
            w = node.width,
            h = node.height;
        const d = `M ${x} ${y} H ${x + w} V ${y + h - 10} C ${x + w * 0.68} ${y + h + 8}, ${x + w * 0.34} ${y + h - 24}, ${x} ${y + h - 8} Z`;
        return `<path ${pathAttrs} d="${hand ? roughPathD(d, node.id) : d}" />`;
    }
    if (node.shape === "scientific") {
        const x = node.x,
            y = node.y,
            w = node.width,
            h = node.height;
        const d = `M ${x + 18} ${y} H ${x + w - 18} L ${x + w} ${y + 18} V ${y + h - 18} L ${x + w - 18} ${y + h} H ${x + 18} L ${x} ${y + h - 18} V ${y + 18} Z`;
        return `<path ${pathAttrs} d="${hand ? roughPathD(d, node.id) : d}" />`;
    }
    return `<rect ${common} class="mermaid-graph-node-shape ${hand ? "is-drawn" : ""} ${sketch ? "is-sketch" : ""}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.shape === "terminal" ? 28 : 10}" fill="${fill}" stroke="${stroke}" />`;
}

export function graphToSvg(graph, style = {}, options = {}) {
    const model = layoutGraphModel(graph, { preservePositions: true });
    const bounds = graphBounds(model);
    const selectedIds = new Set(options.selectedIds || (options.selectedId ? [options.selectedId] : []));
    const showConnectHandles = options.showConnectHandles === true;
    const showResizeHandles = options.showResizeHandles === true;
    const lineColor = style.lineColor || "#4f46e5";
    const textColor = style.primaryTextColor || "#0f172a";
    const fontFamily = style.fontFamily || "Inter, Arial, sans-serif";
    const fontSize = Number(style.fontSize) || 16;
    const edgeLabels = [];
    const renderMode = style.renderMode || (style.handDrawn ? "sketch" : "real");
    const handDrawn = renderMode !== "real";
    const sketch = renderMode === "sketch";
    const interactionStyles = [
        showConnectHandles ? `.mermaid-graph-connect-handle{fill:#ffffff;stroke:${lineColor};stroke-width:2;opacity:.92}` : "",
        showResizeHandles ? `.mermaid-graph-resize-handle{fill:#ffffff;stroke:#f59e0b;stroke-width:2;cursor:nwse-resize}` : "",
    ].filter(Boolean).join("\n                ");
    const edges = model.edges
        .map(edge => {
            const from = model.nodes.find(node => node.id === edge.from);
            const to = model.nodes.find(node => node.id === edge.to);
            if (!from || !to) return "";
            const labelPoint = edgeLabelPoint(edge, model);
            const active = selectedIds.has(edge.id) ? " is-selected" : "";
            if (edge.label) {
                const edgeTextColor = edge.style?.text || textColor;
                const edgeFontSize = edge.style?.fontSize ? edge.style.fontSize - 2 : Math.max(11, fontSize - 2);
                const edgeFontFamily = edge.style?.fontFamily || fontFamily;
                // A small rounded label behind the words, as Mermaid draws edge labels: readable over the line and on
                // any slide. (A white text halo looked like a blotchy outline on dark slides.) Width estimated from the
                // text, since the label is built as markup before it is laid out.
                const labelFont = `font-family:${edgeFontFamily};font-size:${edgeFontSize}px`;
                const labelWidth = Math.round(String(edge.label).length * edgeFontSize * 0.62 + 12);
                const labelHeight = Math.round(edgeFontSize * 1.25 + 6);
                const labelTop = Math.round(labelPoint.y - edgeFontSize * 0.86 - 3);
                // On a dark fill the label sits on that fill (a white label with light text was unreadable).
                const labelFill = style.edgeLabelBackground || (isDarkColor(style.primaryColor) ? style.primaryColor : "#ffffff");
                edgeLabels.push(
                    `<rect x="${Math.round(labelPoint.x - labelWidth / 2)}" y="${labelTop}" width="${labelWidth}" height="${labelHeight}" rx="${Math.round(labelHeight / 2)}" class="mermaid-graph-edge-halo" data-edge-id="${escapeAttr(edge.id)}" aria-hidden="true" fill="${escapeAttr(labelFill)}" fill-opacity="0.94" stroke="${escapeAttr(lineColor)}" stroke-opacity="0.35" stroke-width="1"/>` +
                    `<text x="${labelPoint.x}" y="${labelPoint.y}" text-anchor="middle" class="mermaid-graph-edge-label${active}" data-edge-id="${escapeAttr(edge.id)}" style="${labelFont};fill:${edgeTextColor}">${escapeHtml(edge.label)}</text>`,
                );
            }
            const route = edgeRoute(edge, model);
            const stroke = edge.style?.stroke || lineColor;
            return `
            <g class="mermaid-graph-edge${active}" data-edge-id="${escapeAttr(edge.id)}">
                <path d="${handDrawn ? roughPathD(route.d, edge.id) : route.d}" fill="none" stroke="${stroke}" stroke-width="${(handDrawn ? 2.4 : 2.2) * (edge.lineStyle === "thick" ? 1.7 : 1)}"${edge.lineStyle === "dotted" ? ' stroke-dasharray="3 5"' : ""} />
                ${sketch ? `<path d="${roughPathD(route.d, `${edge.id}~pencil`)}" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-opacity="0.7" pointer-events="none"${edge.lineStyle === "dotted" ? ' stroke-dasharray="3 5"' : ""} />` : ""}
                ${edgeEndShape(edge.arrow || "arrow", route.end, route.dir, stroke)}
            </g>
        `;
        })
        .join("");
    const nodes = model.nodes
        .map(node => {
            const active = selectedIds.has(node.id) ? " is-selected" : "";
            const cy = node.y + node.height / 2;
            const handles = [];
            if (showConnectHandles) {
                handles.push(`<circle class="mermaid-graph-connect-handle" data-node-id="${escapeAttr(node.id)}" cx="${node.x + node.width + 9}" cy="${cy}" r="6" />`);
            }
            if (showResizeHandles && selectedIds.has(node.id)) {
                handles.push(`<rect class="mermaid-graph-resize-handle" data-node-id="${escapeAttr(node.id)}" data-resize-handle="br" x="${node.x + node.width - 5}" y="${node.y + node.height - 5}" width="10" height="10" rx="3" />`);
                handles.push(`<rect class="mermaid-graph-resize-handle" data-node-id="${escapeAttr(node.id)}" data-resize-handle="r" x="${node.x + node.width - 4}" y="${node.y + node.height / 2 - 5}" width="8" height="10" rx="3" />`);
            }
            return `
            <g class="mermaid-graph-node${active}" data-node-id="${escapeAttr(node.id)}">
                ${nodeShape(node, { ...style, lineColor })}
                ${labelToSvg(node, node.style?.text || textColor, fontSize, fontFamily)}
                ${handles.join("")}
            </g>
        `;
        })
        .join("");
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" preserveAspectRatio="xMidYMid meet" role="img">
            <!-- No ids or url(#...) references: the same diagram can be on the page several times (slide,
                 thumbnails, editor), and references resolve to the first copy, which may be hidden. The
                 hand-drawn look comes from the rough outlines themselves. -->
            <style>
                .mermaid-graph-node-label{font-family:${fontFamily};font-size:${fontSize}px;fill:${textColor};pointer-events:none}
                .mermaid-graph-edge-label{font-family:${fontFamily};font-size:${Math.max(11, fontSize - 2)}px;font-weight:800;fill:${textColor};cursor:grab;pointer-events:visiblePainted}
                .mermaid-graph-edge-halo{font-weight:800;pointer-events:none}
                .mermaid-graph-node-shape{stroke-width:${handDrawn ? 2.4 : 2.2};stroke-linecap:round;stroke-linejoin:round}
                .mermaid-graph-node.is-selected .mermaid-graph-node-shape,.mermaid-graph-edge.is-selected path{stroke:#f59e0b;stroke-width:3}
                .mermaid-graph-edge-label.is-selected{fill:#92400e;stroke:#fffbeb}
                ${interactionStyles}
            </style>
            <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="transparent" />
            <g class="mermaid-graph-edges">${edges}</g>
            <g class="mermaid-graph-nodes">${nodes}</g>
            <g class="mermaid-graph-edge-labels">${edgeLabels.join("")}</g>
        </svg>
    `;
    return sanitizeMermaidSvg(svg);
}

export function graphBounds(graph) {
    const nodes = graph?.nodes || [];
    if (!nodes.length) return { x: 0, y: 0, width: 640, height: 360 };
    const minX = Math.min(...nodes.map(node => node.x)) - 48;
    const minY = Math.min(...nodes.map(node => node.y)) - 48;
    const maxX = Math.max(...nodes.map(node => node.x + node.width)) + 72;
    const maxY = Math.max(...nodes.map(node => node.y + node.height)) + 72;
    return {
        x: Math.floor(minX),
        y: Math.floor(minY),
        width: Math.max(320, Math.ceil(maxX - minX)),
        height: Math.max(220, Math.ceil(maxY - minY)),
    };
}

export function canUseVisualGraph(source = "") {
    const stripped = stripGraphMetadata(source);
    return (
        /^(flowchart|graph)\s+/im.test(stripped) &&
        !/(sequenceDiagram|stateDiagram|classDiagram|erDiagram|gantt|journey|mindmap)/i.test(stripped)
    );
}

export function makeNode(label = "Node", x = 80, y = 80, shape = "process", existingIds = new Set()) {
    let base = sanitizeId(label || "Node");
    if (!base || existingIds.has(base)) base = "Node";
    let id = base;
    let index = 2;
    while (existingIds.has(id)) {
        id = `${base}${index}`;
        index += 1;
    }
    return {
        id,
        label: label || id,
        shape,
        x,
        y,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
        locked: false,
        style: {},
    };
}
