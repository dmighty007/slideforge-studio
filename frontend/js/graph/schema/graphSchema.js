import { GRAPH_DOMAINS, GRAPH_EDGE_ROLES, GRAPH_NODE_ROLES } from "./semanticRoles.js";

export const SEMANTIC_GRAPH_SCHEMA_VERSION = 2;

function clone(value) {
    return JSON.parse(JSON.stringify(value || null));
}

export function createSemanticGraphDocument(input = {}) {
    const layoutState = input.layoutState || input.layout || {};
    const presentationState = input.presentationState || input.presentation || {};
    const mermaid = input.mermaid || {};
    return normalizeSemanticGraphDocument({
        schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
        version: input.version || 1,
        id: input.id || `graph_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        type: input.type || "flowchart",
        title: input.title || input.metadata?.title || "",
        canvas: {
            width: Number(input.canvas?.width) || 1280,
            height: Number(input.canvas?.height) || 720,
            coordinateSpace: input.canvas?.coordinateSpace || "slide-local",
        },
        nodes: clone(input.nodes || []),
        edges: clone(input.edges || []),
        groups: clone(input.groups || []),
        lanes: clone(input.lanes || []),
        sections: clone(input.sections || []),
        annotations: clone(input.annotations || []),
        references: clone(input.references || []),
        embeddedMedia: clone(input.embeddedMedia || []),
        viewport: clone(input.viewport || { x: 0, y: 0, zoom: 1 }),
        styles: clone(input.styles || input.style || {}),
        layoutState: {
            direction: layoutState.direction || input.direction || "TD",
            engine: layoutState.engine || "slideforge-hierarchical",
            routingStyle: layoutState.routingStyle || input.routingStyle || "orthogonal",
            connectionStyle: layoutState.connectionStyle || input.connectionStyle || "arrow",
            autoLayout: layoutState.autoLayout ?? input.autoLayout ?? true,
            lockedLayout: Boolean(layoutState.lockedLayout ?? input.lockedLayout),
            nodePositions: clone(layoutState.nodePositions || input.nodePositions || {}),
            updatedAt: layoutState.updatedAt || Date.now(),
        },
        presentationState: {
            activePreset: presentationState.activePreset || null,
            revealOrder: clone(presentationState.revealOrder || []),
            focusPath: clone(presentationState.focusPath || []),
            steps: clone(presentationState.steps || []),
            ...(presentationState || {}),
        },
        animations: clone(input.animations || []),
        metadata: {
            sourceFormat: input.metadata?.sourceFormat || "semantic-graph",
            domain: input.metadata?.domain || inferGraphDomain(input),
            updatedAt: Date.now(),
            ...(input.metadata || {}),
        },
        mermaid: {
            source: mermaid.source || input.mermaidSource || "",
            importedWith: mermaid.importedWith || "slideforge",
            exportCompatibility: mermaid.exportCompatibility || "best-effort",
            unsupportedBlocks: clone(mermaid.unsupportedBlocks || []),
        },
    });
}

export function normalizeSemanticGraphDocument(document = {}) {
    const nodes = (document.nodes || []).map((node, index) => normalizeNode(node, index));
    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = (document.edges || [])
        .map((edge, index) => normalizeEdge(edge, index))
        .filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    return {
        ...document,
        schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
        nodes,
        edges,
        groups: Array.isArray(document.groups) ? document.groups : [],
        lanes: Array.isArray(document.lanes) ? document.lanes : [],
        sections: Array.isArray(document.sections) ? document.sections : [],
        annotations: Array.isArray(document.annotations) ? document.annotations : [],
        references: Array.isArray(document.references) ? document.references : [],
        embeddedMedia: Array.isArray(document.embeddedMedia) ? document.embeddedMedia : [],
        viewport: document.viewport || { x: 0, y: 0, zoom: 1 },
        styles: document.styles || {},
        layoutState: {
            direction: document.layoutState?.direction || "TD",
            engine: document.layoutState?.engine || "slideforge-hierarchical",
            routingStyle: document.layoutState?.routingStyle || "orthogonal",
            connectionStyle: document.layoutState?.connectionStyle || "arrow",
            autoLayout: document.layoutState?.autoLayout !== false,
            lockedLayout: Boolean(document.layoutState?.lockedLayout),
            nodePositions: document.layoutState?.nodePositions || {},
            updatedAt: document.layoutState?.updatedAt || Date.now(),
        },
        presentationState: document.presentationState || {},
        metadata: { ...(document.metadata || {}), updatedAt: Date.now() },
        mermaid: document.mermaid || { source: document.mermaidSource || "", exportCompatibility: "best-effort" },
    };
}

function normalizeNode(node = {}, index = 0) {
    const id = String(node.id || `node_${index}`).replace(/[^\w-]/g, "_");
    const scientific = node.scientific || node.semantic || {};
    // The flat x/y/width/height are what the editor changes; `geometry` is the copy made at the last
    // normalisation. Preferring the copy put a dragged or resized node back where it was.
    const geometry = {
        x: Number(node.x ?? node.geometry?.x) || 0,
        y: Number(node.y ?? node.geometry?.y) || 0,
        width: Number(node.width ?? node.geometry?.width) || 138,
        height: Number(node.height ?? node.geometry?.height) || 58,
    };
    const shape = node.shape || node.type || "process";
    return {
        id,
        type: node.type || shape,
        shape,
        subtype: node.subtype || scientific.subtype || "",
        label: String(node.label || id),
        semanticRole: node.semanticRole || scientific.role || GRAPH_NODE_ROLES.PROCESS,
        scientific,
        execution: node.execution || {},
        geometry,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        ports: Array.isArray(node.ports) ? node.ports : defaultPorts(),
        style: node.style || {},
        animation: node.animation || {},
        ai: node.ai || { tags: [], confidence: null },
        locked: Boolean(node.locked),
    };
}

function normalizeEdge(edge = {}, index = 0) {
    const from = typeof edge.from === "object" ? edge.from.nodeId : edge.from;
    const to = typeof edge.to === "object" ? edge.to.nodeId : edge.to;
    // Likewise routingStyle and waypoints win over the stored `routing` copy (Curved routing was lost).
    const routing = {
        mode: edge.routingStyle || edge.routing?.mode || "orthogonal",
        waypoints: Array.isArray(edge.waypoints) ? edge.waypoints : edge.routing?.waypoints || [],
    };
    return {
        id: edge.id || `edge_${from}_${to}_${index}`,
        from: String(from || ""),
        to: String(to || ""),
        ports: {
            from: typeof edge.from === "object" ? edge.from.portId || "out" : edge.fromPort || "out",
            to: typeof edge.to === "object" ? edge.to.portId || "in" : edge.toPort || "in",
        },
        type: edge.type || "dependency",
        semanticRole: edge.semanticRole || edge.role || GRAPH_EDGE_ROLES.DEPENDENCY,
        label: edge.label || "",
        routing,
        routingStyle: routing.mode || edge.routingStyle || "orthogonal",
        waypoints: Array.isArray(routing.waypoints) ? routing.waypoints : [],
        arrow: edge.arrow || "arrow",
        lineStyle: edge.lineStyle || "solid",
        labelOffset: edge.labelOffset || { x: 0, y: 0 },
        style: edge.style || {},
        animation: edge.animation || {},
        ai: edge.ai || {},
    };
}

function defaultPorts() {
    return [
        { id: "in", side: "left", kind: "input" },
        { id: "out", side: "right", kind: "output" },
    ];
}

function inferGraphDomain(input = {}) {
    const text = JSON.stringify([input.title, input.mermaidSource, input.nodes?.map(node => node.label)]).toLowerCase();
    if (/md|molecular|trajectory|gromacs|pathcv|msm|free energy|weighted ensemble/.test(text)) return GRAPH_DOMAINS.MOLECULAR_DYNAMICS;
    return GRAPH_DOMAINS.GENERAL;
}
