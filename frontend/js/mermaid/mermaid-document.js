import {
    canUseVisualGraph,
    graphBounds,
    graphToMermaid,
    graphToSvg,
    layoutGraphModel,
    parseMermaidToGraph,
} from "./mermaid-graph.js";

function clone(value) {
    return JSON.parse(JSON.stringify(value || null));
}

function now() {
    return Date.now();
}

export const GRAPH_PIPELINE_VERSION = 1;

export const SCIENTIFIC_WORKFLOW_PRIMITIVES = [
    { id: "simulation-stage", label: "Simulation stage", shape: "scientific", color: "#e0f2fe", icon: "atom" },
    { id: "preprocessing", label: "Preprocessing", shape: "parallelogram", color: "#ecfdf5", icon: "filter" },
    { id: "convergence-analysis", label: "Convergence analysis", shape: "hexagon", color: "#fef3c7", icon: "chart" },
    { id: "scheduler-queue", label: "Scheduler queue", shape: "queue", color: "#ede9fe", icon: "queue" },
    { id: "distributed-worker", label: "Distributed worker", shape: "process", color: "#fce7f3", icon: "worker" },
    { id: "gpu-compute", label: "GPU compute", shape: "database", color: "#dcfce7", icon: "gpu" },
];

export const PRESENTATION_ANIMATION_PRESETS = [
    { id: "branch-reveal", label: "Reveal by branch", strategy: "branch", duration: 650 },
    { id: "edge-draw", label: "Progressive edge drawing", strategy: "edgePath", duration: 720 },
    { id: "node-stagger", label: "Node stagger reveal", strategy: "stagger", duration: 520 },
    { id: "traversal", label: "Traversal highlight", strategy: "walk", duration: 900 },
    { id: "focus-path", label: "Focus path", strategy: "focusPath", duration: 760 },
    { id: "execution-flow", label: "Execution flow simulation", strategy: "pulse", duration: 1100 },
];

export function createGraphDocument(input = {}, options = {}) {
    const source = input.mermaidSource || input.source || "";
    const previousGraph = input.graphModel || input.model || null;
    const nodes = Array.isArray(input.nodes) ? input.nodes : null;
    const edges = Array.isArray(input.edges) ? input.edges : null;
    const graph = nodes && edges
        ? layoutGraphModel({ ...previousGraph, nodes: clone(nodes), edges: clone(edges) }, { preservePositions: true })
        : canUseVisualGraph(source)
            ? parseMermaidToGraph(source, previousGraph)
            : layoutGraphModel(previousGraph || { nodes: [], edges: [] }, { preservePositions: true });
    const document = {
        version: GRAPH_PIPELINE_VERSION,
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        groups: input.groups || graph.groups || [],
        viewport: input.viewport || graph.viewport || { x: 0, y: 0, zoom: 1 },
        animations: normalizeAnimations(input.animations || input.animation || []),
        metadata: {
            sourceFormat: "mermaid",
            updatedAt: now(),
            ...(input.metadata || {}),
        },
        styles: input.styles || input.style || graph.style || {},
        layoutState: {
            direction: graph.direction || input.direction || "TD",
            routingStyle: input.routingStyle || graph.routingStyle || "orthogonal",
            connectionStyle: input.connectionStyle || graph.connectionStyle || "arrow",
            autoLayout: input.autoLayout ?? graph.autoLayout ?? true,
            lockedLayout: Boolean(input.lockedLayout ?? graph.lockedLayout),
            nodePositions: graph.nodePositions || {},
            engine: "slideforge-hierarchical",
            updatedAt: now(),
        },
        presentationState: {
            activePreset: input.presentationState?.activePreset || null,
            revealOrder: input.presentationState?.revealOrder || [],
            focusPath: input.presentationState?.focusPath || [],
            ...(input.presentationState || {}),
        },
    };
    return normalizeGraphDocument(document, options);
}

export function normalizeGraphDocument(document = {}, options = {}) {
    const layoutState = document.layoutState || {};
    const graph = layoutGraphModel({
        version: GRAPH_PIPELINE_VERSION,
        type: "flowchart",
        direction: layoutState.direction || document.direction || "TD",
        nodes: clone(document.nodes || []),
        edges: clone(document.edges || []),
        groups: clone(document.groups || []),
        viewport: clone(document.viewport || { x: 0, y: 0, zoom: 1 }),
        style: clone(document.styles || {}),
        routingStyle: layoutState.routingStyle || document.routingStyle || "orthogonal",
        connectionStyle: layoutState.connectionStyle || document.connectionStyle || "arrow",
        autoLayout: layoutState.autoLayout ?? document.autoLayout ?? true,
        lockedLayout: Boolean(layoutState.lockedLayout ?? document.lockedLayout),
        nodePositions: clone(layoutState.nodePositions || document.nodePositions || {}),
    }, { preservePositions: options.preservePositions !== false });
    return {
        version: GRAPH_PIPELINE_VERSION,
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        groups: document.groups || graph.groups || [],
        viewport: document.viewport || graph.viewport || { x: 0, y: 0, zoom: 1 },
        animations: normalizeAnimations(document.animations || []),
        metadata: { ...(document.metadata || {}), updatedAt: now() },
        styles: document.styles || graph.style || {},
        layoutState: {
            ...layoutState,
            direction: graph.direction || "TD",
            routingStyle: graph.routingStyle || "orthogonal",
            connectionStyle: graph.connectionStyle || "arrow",
            autoLayout: graph.autoLayout !== false,
            lockedLayout: Boolean(graph.lockedLayout),
            nodePositions: graph.nodePositions || {},
            engine: layoutState.engine || "slideforge-hierarchical",
            updatedAt: now(),
        },
        presentationState: document.presentationState || {},
    };
}

export function documentToGraphModel(document = {}) {
    const layoutState = document.layoutState || {};
    return {
        version: GRAPH_PIPELINE_VERSION,
        type: "flowchart",
        direction: layoutState.direction || "TD",
        nodes: document.nodes || [],
        edges: document.edges || [],
        groups: document.groups || [],
        viewport: document.viewport || { x: 0, y: 0, zoom: 1 },
        style: document.styles || {},
        routingStyle: layoutState.routingStyle || "orthogonal",
        connectionStyle: layoutState.connectionStyle || "arrow",
        autoLayout: layoutState.autoLayout !== false,
        lockedLayout: Boolean(layoutState.lockedLayout),
        nodePositions: layoutState.nodePositions || {},
    };
}

export function updateDocumentFromGraphModel(document = {}, graphModel = {}, patch = {}) {
    const graph = layoutGraphModel(graphModel, { preservePositions: patch.preservePositions !== false });
    const styles = patch.styles || graph.style || document.styles || {};
    return normalizeGraphDocument({
        ...document,
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        groups: graph.groups || document.groups || [],
        viewport: graph.viewport || document.viewport || { x: 0, y: 0, zoom: 1 },
        styles,
        layoutState: {
            ...(document.layoutState || {}),
            direction: graph.direction || "TD",
            routingStyle: graph.routingStyle || "orthogonal",
            connectionStyle: graph.connectionStyle || "arrow",
            autoLayout: graph.autoLayout !== false,
            lockedLayout: Boolean(graph.lockedLayout),
            nodePositions: graph.nodePositions || {},
            updatedAt: now(),
        },
        metadata: {
            ...(document.metadata || {}),
            lastInteraction: patch.interaction || document.metadata?.lastInteraction || "graph-update",
        },
    }, { preservePositions: true });
}

export function deriveMermaidFromDocument(document = {}) {
    return graphToMermaid(documentToGraphModel(document));
}

export function buildRenderModel(document = {}, style = {}, options = {}) {
    const graph = layoutGraphModel(documentToGraphModel(document), { preservePositions: true });
    const bounds = graphBounds(graph);
    const visibleNodes = cullNodes(graph.nodes || [], bounds, options.viewport);
    const visibleIds = new Set(visibleNodes.map(node => node.id));
    const visibleEdges = (graph.edges || []).filter(edge => visibleIds.has(edge.from) || visibleIds.has(edge.to));
    return {
        graph,
        bounds,
        visibleNodes,
        visibleEdges,
        selectedIds: options.selectedIds || [],
        style,
        dirty: options.dirty || null,
    };
}

export function renderDocumentToSvg(document = {}, style = {}, options = {}) {
    const renderModel = buildRenderModel(document, style, options);
    return graphToSvg(renderModel.graph, style, {
        selectedIds: renderModel.selectedIds,
        showConnectHandles: options.showConnectHandles,
        showResizeHandles: options.showResizeHandles,
    });
}

export function applyPresentationPreset(document = {}, presetId = "branch-reveal") {
    const preset = PRESENTATION_ANIMATION_PRESETS.find(item => item.id === presetId) || PRESENTATION_ANIMATION_PRESETS[0];
    const nodes = document.nodes || [];
    const edges = document.edges || [];
    const revealOrder = buildRevealOrder(nodes, edges);
    return normalizeGraphDocument({
        ...document,
        animations: [{ ...preset, createdAt: now() }],
        presentationState: {
            ...(document.presentationState || {}),
            activePreset: preset.id,
            revealOrder,
            focusPath: revealOrder.slice(0, 6),
        },
    });
}

function normalizeAnimations(animations) {
    const list = Array.isArray(animations) ? animations : animations ? [animations] : [];
    return list.filter(Boolean).map(item => ({ ...item }));
}

function cullNodes(nodes = [], bounds, viewport) {
    if (!viewport || !Number.isFinite(Number(viewport.width)) || nodes.length <= 80) return nodes;
    const pad = 160;
    const left = Number(viewport.x) - pad;
    const top = Number(viewport.y) - pad;
    const right = left + Number(viewport.width) + pad * 2;
    const bottom = top + Number(viewport.height) + pad * 2;
    const visible = nodes.filter(node => (
        node.x + node.width >= left &&
        node.x <= right &&
        node.y + node.height >= top &&
        node.y <= bottom
    ));
    return visible.length ? visible : nodes.slice(0, Math.min(nodes.length, 80));
}

function buildRevealOrder(nodes = [], edges = []) {
    const indegree = new Map(nodes.map(node => [node.id, 0]));
    edges.forEach(edge => indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1));
    const queue = nodes.filter(node => (indegree.get(node.id) || 0) === 0).map(node => node.id);
    const visited = new Set();
    const order = [];
    while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        order.push(id);
        edges.filter(edge => edge.from === id).forEach(edge => queue.push(edge.to));
    }
    nodes.forEach(node => {
        if (!visited.has(node.id)) order.push(node.id);
    });
    return order;
}
