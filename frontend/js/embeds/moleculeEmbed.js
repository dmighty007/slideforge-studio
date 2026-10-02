const MOLECULE_EMBED_NGL_SRC = "vendor/ngl/ngl.js";
const MOLECULE_SUPPORTED_FORMATS = new Set(["pdb", "ent", "gro", "mol2", "xyz", "sdf", "cif", "mmcif"]);
const MOLECULE_INLINE_CONTENT_LIMIT = 2 * 1024 * 1024;
const MOLECULE_LARGE_CONTENT_LIMIT = 64 * 1024 * 1024;

function createDefaultMoleculeContent() {
    return [
        "HEADER    SLIDEFORGE MOLECULE PLACEHOLDER",
        "ATOM      1  N   GLY A   1      -1.250   0.000   0.000  1.00 20.00           N",
        "ATOM      2  CA  GLY A   1       0.000   0.000   0.000  1.00 20.00           C",
        "ATOM      3  C   GLY A   1       1.180   0.720   0.000  1.00 20.00           C",
        "ATOM      4  O   GLY A   1       2.280   0.200   0.000  1.00 20.00           O",
        "ATOM      5  N   SER A   2       0.960   2.020   0.000  1.00 20.00           N",
        "ATOM      6  CA  SER A   2       2.020   2.890   0.000  1.00 20.00           C",
        "ATOM      7  C   SER A   2       3.300   2.150   0.000  1.00 20.00           C",
        "ATOM      8  O   SER A   2       4.420   2.640   0.000  1.00 20.00           O",
        "ATOM      9  CB  SER A   2       1.600   4.340   0.000  1.00 20.00           C",
        "TER",
        "END",
    ].join("\n");
}

function normalizeMoleculeFormat(format = "pdb") {
    const value = String(format || "pdb").toLowerCase().replace(/^\./, "");
    const normalized = value === "ent" ? "pdb" : value;
    return MOLECULE_SUPPORTED_FORMATS.has(normalized) ? normalized : "pdb";
}

function normalizeMoleculeBackgroundColor(value = "#020617") {
    const color = String(value || "").trim();
    if (!color || color.toLowerCase() === "transparent" || /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(color)) return "transparent";
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return "#020617";
}

function isMoleculeContentUrl(value) {
    const text = String(value || "").trim();
    return /^(?:blob:|https?:\/\/|\/media\/|\/static\/|assets\/|\/assets\/)/i.test(text);
}

function isMoleculeTrajectoryData(data) {
    if (isMoleculeContentUrl(data)) return false;
    const text = String(data || "");
    let modelCount = 0;
    let endCount = 0;
    let atomOneCount = 0;
    const recordPattern = /^(MODEL|ENDMDL)\b/gm;
    let match;
    while ((match = recordPattern.exec(text))) {
        if (match[1] === "MODEL") {
            modelCount += 1;
            if (modelCount > 1) return true;
        } else if (modelCount > 0) return true;
    }
    const framePattern = /^(END|ATOM\s+1\b)/gm;
    while ((match = framePattern.exec(text))) {
        if (match[1] === "END") {
            endCount += 1;
            if (endCount > 1 && atomOneCount > 1) return true;
        } else {
            atomOneCount += 1;
            if (endCount > 0 && atomOneCount > 1) return true;
        }
    }
    return false;
}

function createMoleculeElementData({ data, name = "Molecule", format = "pdb", isTrajectory = false, sourceUrl = "" } = {}) {
    const content = sourceUrl || String(data || createDefaultMoleculeContent());
    return {
        moleculeName: name,
        moleculeFormat: normalizeMoleculeFormat(format),
        moleculeIsTrajectory: Boolean(isTrajectory || (!sourceUrl && isMoleculeTrajectoryData(data))),
        content,
        moleculeSourceType: sourceUrl ? "url" : "inline",
        moleculeInteractive: true,
        moleculeAutoRotate: false,
        moleculeDepthCue: true,
        moleculeProjection: "perspective",
        moleculeDefaultStyle: "cartoon",
        moleculeDefaultColor: "spectrum",
        moleculeRepresentationLayers: [],
        moleculeViewState: null,
    };
}

function normalizeMoleculeRepresentationLayer(layer = {}) {
    const kind = ["cartoon", "stick", "sphere", "line", "surface", "hidden"].includes(layer.kind) ? layer.kind : "cartoon";
    const colorScheme = ["default", "chain", "amino", "ssJmol", "spectrum", "custom"].includes(layer.colorScheme)
        ? layer.colorScheme
        : "spectrum";
    const selectionQuery = String(layer.selectionQuery || "all").trim() || "all";
    const customColor = /^#[0-9a-f]{6}$/i.test(String(layer.customColor || "")) ? layer.customColor : "#6366f1";
    const radius = Number.isFinite(Number(layer.radius)) ? Math.max(0.01, Math.min(5, Number(layer.radius))) : null;
    const opacity = Number.isFinite(Number(layer.opacity)) ? Math.max(0.02, Math.min(1, Number(layer.opacity))) : null;
    const labelParts = [`${kind[0].toUpperCase()}${kind.slice(1)}`, colorScheme, selectionQuery];
    if (radius != null && ["stick", "sphere", "line", "cartoon"].includes(kind)) labelParts.push(`r ${radius}`);
    if (opacity != null && kind === "surface") labelParts.push(`${Math.round(opacity * 100)}%`);
    const label = String(layer.label || labelParts.join(" · "));
    return {
        id: layer.id || (typeof generateId === "function" ? generateId("mol_layer") : `mol_layer_${Date.now()}_${Math.random().toString(36).slice(2)}`),
        kind,
        colorScheme,
        selectionQuery,
        customColor,
        radius,
        opacity,
        label,
    };
}

function normalizeMoleculeViewState(value) {
    if (!value || typeof value !== "object") return null;
    const orientation = Array.isArray(value.orientation) ? value.orientation.map(Number) : [];
    if (orientation.length !== 16 || !orientation.every(Number.isFinite)) return null;
    return { orientation };
}

function _escapeMoleculeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function _serializeMoleculePayload(payload) {
    return JSON.stringify(payload)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

function _moleculeSrcdocScript(payload) {
    return `
(() => {
const payload = ${_serializeMoleculePayload(payload)};
const root = document.getElementById("viewer");
const status = document.getElementById("status");
const framePanel = document.getElementById("trajectory-panel");
const playBtn = document.getElementById("traj-play");
const frameInput = document.getElementById("traj-frame");
const frameLabel = document.getElementById("traj-label");
const speedInput = document.getElementById("traj-speed");
const presentPlayBtn = document.getElementById("present-play");
const presentRotateBtn = document.getElementById("present-rotate");
let stage = null;
let component = null;
let trajectory = null;
let timer = null;
let frameCount = 0;
let currentFrame = 0;
let resizeQueued = false;
let lifecycleActive = payload.active !== false;
let spinRequested = Boolean(payload.autoRotate);
let resumeTrajectoryOnActive = false;
let viewStateBroadcastTimer = null;

// The status line is shown while loading and when loading fails (it used to be hidden always, so a file the
// viewer could not read left an empty black box), and hidden once the molecule is drawn.
function setStatus(text, mode) {
  status.textContent = text;
  status.parentElement.className = "top" + (mode ? " is-" + mode : "");
}
// XYZ files (one or more frames of "count / comment / element x y z" lines) as PDB text, which NGL can read.
function xyzToPdb(text) {
  const lines = String(text || "").split(/\\r?\\n/);
  const frames = [];
  let i = 0;
  while (i < lines.length) {
    const count = Number.parseInt(lines[i], 10);
    if (!Number.isFinite(count) || count <= 0) { i += 1; continue; }
    const atoms = [];
    for (let j = i + 2; j < i + 2 + count && j < lines.length; j += 1) {
      const parts = lines[j].trim().split(/\\s+/);
      const coords = parts.slice(1, 4).map(Number);
      if (parts.length < 4 || coords.some(v => !Number.isFinite(v))) continue;
      const element = (parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()).replace(/[^A-Za-z]/g, "").slice(0, 2);
      const serial = String(atoms.length + 1).padStart(5);
      const name = element.padEnd(4).slice(0, 4);
      atoms.push("HETATM" + serial + " " + name + " MOL A   1    " + coords.map(v => v.toFixed(3).padStart(8)).join("") + "  1.00  0.00          " + element.toUpperCase().padStart(2));
    }
    if (atoms.length) frames.push(atoms);
    i += 2 + count;
  }
  if (!frames.length) return "";
  if (frames.length === 1) return frames[0].join("\\n") + "\\nEND\\n";
  return frames.map((atoms, index) => "MODEL     " + String(index + 1).padStart(4) + "\\n" + atoms.join("\\n") + "\\nENDMDL").join("\\n") + "\\nEND\\n";
}
function hasNgl() { return Boolean(window.NGL && window.NGL.Stage); }
function fmt(value) { return String(value || "pdb").toLowerCase() === "ent" ? "pdb" : String(value || "pdb").toLowerCase(); }
function trajectoryCount(data) {
  let count = 0;
  const text = String(data || "");
  const recordPattern = /^MODEL\\b/gm;
  while (recordPattern.exec(text)) count += 1;
  if (count > 0) return count;
  const endPattern = /^END\\s*$/gm;
  while (endPattern.exec(text)) count += 1;
  return count;
}
function hasModelRecords(data) {
  return /^MODEL\\b/m.test(String(data || ""));
}
function isEndDelimitedPdbTrajectory(data) {
  const text = String(data || "");
  if (hasModelRecords(text)) return false;
  let endCount = 0;
  let atomOneCount = 0;
  const framePattern = /^(END\\s*$|ATOM\\s+1\\b)/gm;
  let match;
  while ((match = framePattern.exec(text))) {
    if (match[1].startsWith("END")) endCount += 1;
    else atomOneCount += 1;
    if (endCount > 1 && atomOneCount > 1) return true;
  }
  return false;
}
function normalizeEndDelimitedPdbTrajectory(data) {
  const lines = String(data || "").split(/\\r?\\n/);
  const header = [];
  const frames = [];
  let current = [];
  let frameStarted = false;
  for (const line of lines) {
    if (/^(ATOM|HETATM)\\b/.test(line)) frameStarted = true;
    if (!frameStarted) {
      if (line.trim()) header.push(line);
      continue;
    }
    if (/^END\\s*$/.test(line)) {
      if (current.length) frames.push(current);
      current = [];
      frameStarted = false;
      continue;
    }
    if (line.trim()) current.push(line);
  }
  if (current.length) frames.push(current);
  if (frames.length <= 1) return String(data || "");
  const output = [];
  frames.forEach((frame, index) => {
    output.push("MODEL     " + String(index + 1).padStart(4, " "));
    if (index === 0) output.push(...header);
    output.push(...frame);
    output.push("ENDMDL");
  });
  output.push("END");
  return output.join("\\n");
}
function requestMoleculeDataFromParent(url, binary = false) {
  return new Promise((resolve, reject) => {
    const requestId = "mol_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out while loading molecule data"));
    }, 30000);
    function onMessage(event) {
      const message = event.data || {};
      if (!message || message.type !== "pptmaker:molecule:data-response" || message.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error));
      else resolve(binary ? message.data : String(message.data || ""));
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "pptmaker:molecule:data-request", requestId, url, binary }, "*");
  });
}
async function resolveMoleculeData() {
  if (!payload.dataUrl) return String(payload.data || "");
  setStatus("Loading molecule data…", "loading");
  try {
    return await requestMoleculeDataFromParent(payload.dataUrl);
  } catch (_parentErr) {
    const response = await fetch(payload.dataUrl, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not fetch molecule file");
    return await response.text();
  }
}
// The frames of a binary trajectory, fetched by the editor (this frame has no access to the app) unless they are
// in the page itself (an exported HTML file).
async function resolveTrajectoryData(url) {
  if (/^data:/i.test(url)) return await (await fetch(url)).arrayBuffer();
  try {
    return await requestMoleculeDataFromParent(url, true);
  } catch (_parentErr) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not fetch the trajectory file");
    return await response.arrayBuffer();
  }
}
let rejectedTrajectoryMessage = "";
async function loadBinaryTrajectory() {
  const source = payload.trajectory;
  setStatus("Loading trajectory…", "loading");
  const buffer = await resolveTrajectoryData(source.url);
  const frames = await window.NGL.autoLoad(new Blob([buffer]), { ext: source.format });
  const coordinates = frames?.coordinates || [];
  if (!coordinates.length) throw new Error("the trajectory has no frames");
  const atoms = structureAtomCount();
  const frameAtoms = Math.round((coordinates[0]?.length || 0) / 3);
  if (frameAtoms !== atoms) {
    throw new Error("the trajectory has " + frameAtoms + " atoms per frame but the structure has " + atoms + ". Use the structure the simulation was run with.");
  }
  trajectory = getTrajectoryFromComponent(component.addTrajectory(frames, { initialFrame: 0 }));
  frameCount = trajectory?.frameCount || coordinates.length;
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch])); }
// NGL's background colour is also the colour distant atoms fade into (depth cue). With a transparent background
// that is the colour of the slide behind, sent by the editor; NGL also paints its canvas element with it, which
// made "transparent" a white box, so the canvas is cleared again here.
function fogColor() {
  return payload.backgroundColor === "transparent" ? (payload.fogColor || "#ffffff") : (payload.backgroundColor || "#020617");
}
function applyBackground(color) {
  const transparent = color === "transparent";
  const bg = transparent ? "transparent" : (color || "#020617");
  document.documentElement.style.background = bg;
  document.body.style.background = bg;
  root.style.background = bg;
  if (stage && stage.setParameters) {
    stage.setParameters({ backgroundColor: fogColor() });
    requestRender();
    announceDrawn();
  }
}
// Depth cue: atoms further away fade into the background, which helps read depth in a still picture.
function applyDepthCue() {
  if (!stage?.setParameters) return;
  stage.setParameters(payload.depthCue === false ? { fogNear: 100, fogFar: 100 } : { fogNear: 50, fogFar: 100 });
  requestRender();
  announceDrawn();
}
// Tells the editor the picture changed, so it can update the slide's thumbnail.
let drawnTimer = null;
function announceDrawn() {
  if (drawnTimer) window.clearTimeout(drawnTimer);
  drawnTimer = window.setTimeout(() => {
    drawnTimer = null;
    if (component) window.parent.postMessage({ type: "pptmaker:molecule:drawn", elementId: payload.elementId || "" }, "*");
  }, 250);
}
function requestRender() {
  if (stage?.viewer?.requestRender) stage.viewer.requestRender();
  else if (stage?.viewer?.render) stage.viewer.render();
}
function normalizeViewMatrix(value) {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(value?.elements)
      ? value.elements
      : (typeof value?.toArray === "function" ? value.toArray() : []);
  const matrix = raw.map(Number);
  return matrix.length === 16 && matrix.every(Number.isFinite) ? matrix : null;
}
function getViewState() {
  const orientation = normalizeViewMatrix(stage?.viewerControls?.getOrientation?.());
  return orientation ? { orientation } : null;
}
function applyViewState(viewState) {
  const orientation = normalizeViewMatrix(viewState?.orientation);
  const controls = stage?.viewerControls;
  if (!orientation || !controls) return false;
  try {
    if (typeof controls.orient === "function") {
      let matrix = orientation;
      const Matrix4 = window.NGL?.Matrix4 || window.THREE?.Matrix4;
      if (Matrix4) {
        matrix = new Matrix4();
        if (typeof matrix.fromArray === "function") matrix.fromArray(orientation);
        else matrix.elements = orientation.slice();
      }
      controls.orient(matrix);
    } else if (typeof controls.setOrientation === "function") {
      controls.setOrientation(orientation);
    } else {
      return false;
    }
    requestRender();
    return true;
  } catch (_err) {
    return false;
  }
}
function scheduleViewStateBroadcast() {
  if (viewStateBroadcastTimer) window.clearTimeout(viewStateBroadcastTimer);
  viewStateBroadcastTimer = window.setTimeout(() => {
    viewStateBroadcastTimer = null;
    window.parent.postMessage({
      type: "pptmaker:molecule:view-state-changed",
      elementId: payload.elementId || "",
      viewState: getViewState(),
    }, "*");
  }, 180);
}
function resizeViewer() {
  if (!stage || resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (stage.handleResize) stage.handleResize();
    refitIfFittedCollapsed();
    requestRender();
  });
}
// The first view: fitted to the molecule, then the saved turn and zoom on top.
let fittedWhileCollapsed = false;
function fitInitialView() {
  if (!component) return;
  component.autoView(0);
  initialOrientation = stage.viewerControls?.getOrientation?.()?.clone?.() || null;
  if (applyViewState(payload.viewState)) {
    setTimeout(() => applyViewState(payload.viewState), 80);
  }
  // Fitted on a hidden slide (0 x 0): the fit is wrong for the real size, so fit again once there is one.
  fittedWhileCollapsed = (stage.viewer?.width || 0) < 8 || (stage.viewer?.height || 0) < 8;
}
function refitIfFittedCollapsed() {
  if (!fittedWhileCollapsed || (stage.viewer?.width || 0) < 8 || (stage.viewer?.height || 0) < 8) return;
  fittedWhileCollapsed = false;
  fitInitialView();
}
function normalizeSelectionItems(value) {
  const items = String(value || "").split(/[,;|]/).map(item => item.trim()).filter(Boolean);
  return items.flatMap(item => {
    const range = item.match(/^(-?\\d+)\\s*-\\s*(-?\\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      const values = [];
      for (let next = start; step > 0 ? next <= end : next >= end; next += step) values.push(String(next));
      return values;
    }
    return [item];
  }).filter(Boolean);
}
function parseSelection(query) {
  const q = String(query || "").trim();
  if (!q || /^all$/i.test(q)) return "all";
  const lower = q.toLowerCase();
  if (lower === "protein") return "protein";
  if (lower === "ligand") return "ligand";
  if (lower === "water" || lower === "solvent") return "water";
  if (lower === "backbone") return "backbone";
  if (lower === "sidechain") return "sidechainAttached";
  const selectors = [];
  const parts = q.split(/\\s+(?:and|&)\\s+/i).map(part => part.trim()).filter(Boolean);
  for (const part of parts.length ? parts : [q]) {
    let m = part.match(/^(?:chain|ch)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const chains = normalizeSelectionItems(m[1]).map(value => ":" + value.replace(/^:/, ""));
      if (chains.length) selectors.push(chains.length === 1 ? chains[0] : "(" + chains.join(" or ") + ")");
      continue;
    }
    m = part.match(/^(?:resi|residue|resid)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const residues = normalizeSelectionItems(m[1]);
      if (residues.length) selectors.push(residues.length === 1 ? residues[0] : "(" + residues.join(" or ") + ")");
      continue;
    }
    m = part.match(/^(?:resn|resname|residue\\s+name)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const names = normalizeSelectionItems(m[1]).map(value => value.toUpperCase());
      if (names.length) selectors.push(names.length === 1 ? names[0] : "(" + names.join(" or ") + ")");
      continue;
    }
    m = part.match(/^(?:atom|name)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const atoms = normalizeSelectionItems(m[1]).map(value => "." + value.replace(/^\\./, "").toUpperCase());
      if (atoms.length) selectors.push(atoms.length === 1 ? atoms[0] : "(" + atoms.join(" or ") + ")");
      continue;
    }
    m = part.match(/^(?:elem|element)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const elements = normalizeSelectionItems(m[1]).map(value => "_" + value.replace(/^_/, ""));
      if (elements.length) selectors.push(elements.length === 1 ? elements[0] : "(" + elements.join(" or ") + ")");
      continue;
    }
    m = part.match(/^(?:serial|index|atomindex)\\s*[:=]?\\s*(.+)$/i);
    if (m) {
      const indices = normalizeSelectionItems(m[1]);
      if (indices.length) selectors.push(indices.length === 1 ? "@" + indices[0] : "(" + indices.map(value => "@" + value).join(" or ") + ")");
      continue;
    }
    selectors.push(part);
  }
  return selectors.length ? selectors.join(" and ") : "all";
}
function representationKind(kind) {
  if (kind === "stick") return "licorice";
  if (kind === "sphere") return "spacefill";
  if (kind === "surface") return "surface";
  if (kind === "line") return "line";
  return "cartoon";
}
function colorParams(color, customHex) {
  if (color === "custom") return { color: customHex || "#6366f1" };
  if (color === "chain") return { colorScheme: "chainid" };
  if (color === "amino") return { colorScheme: "resname" };
  if (color === "ssJmol") return { colorScheme: "sstruc" };
  if (color === "spectrum") return { colorScheme: "residueindex" };
  return { colorScheme: "element" };
}
function representationParams(kind, color, customHex, selection, layerOptions = {}) {
  const params = { sele: selection || "all", quality: "medium", ...colorParams(color, customHex) };
  const radius = Number.isFinite(Number(layerOptions.radius)) ? Number(layerOptions.radius) : null;
  const opacity = Number.isFinite(Number(layerOptions.opacity)) ? Number(layerOptions.opacity) : null;
  if (kind === "surface") {
    params.opacity = opacity == null ? 0.68 : Math.max(0.02, Math.min(1, opacity));
    params.useWorker = false;
    if (color !== "custom") params.color = "#ffffff";
  }
  if (kind === "sphere") params.radiusScale = radius == null ? 0.35 : Math.max(0.01, Math.min(5, radius));
  if (kind === "stick") params.radius = radius == null ? 0.18 : Math.max(0.01, Math.min(5, radius));
  if (kind === "line") params.linewidth = radius == null ? 2 : Math.max(1, Math.min(20, radius));
  // Cartoon "size" is a thickness relative to the normal one. It used to be NGL's absolute radius, so a new
  // cartoon layer (size 1) came out as a thick tube over the thin default cartoon.
  if (kind === "cartoon") {
    params.radiusScale = 0.7 * (radius == null ? 1 : Math.max(0.1, Math.min(3, radius)));
    params.aspectRatio = 5;
  }
  // Large structures: a lighter mesh, or the first drawing takes seconds and turning the molecule stutters.
  if (structureAtomCount() > 30000) params.quality = "low";
  return params;
}
function structureAtomCount() {
  return Number(component?.structure?.atomCount || 0);
}
function structureResidueCount() {
  return Number(component?.structure?.residueStore?.count || component?.structure?.residueCount || 0);
}
// How many chain positions (protein C-alpha or nucleic-acid P atoms) the structure has: a cartoon needs a chain.
function structureChainLength() {
  try {
    return Number(component.structure.getView(new NGL.Selection("polymer and (.CA or .P)")).atomCount || 0);
  } catch (_err) {
    return 0;
  }
}
function excluding(selection, others) {
  const list = others.filter(Boolean);
  if (!list.length) return selection;
  const out = list.map(item => "(" + item + ")").join(" or ");
  return selection === "all" ? "not (" + out + ")" : "(" + selection + ") and not (" + out + ")";
}
// What to draw: the base style for the whole structure, then each layer for its selection. Where a layer has the
// same style as the base (or a later layer of that style overlaps it), the earlier one leaves those atoms to it,
// so a "cartoon of chain A in red" recolours chain A instead of drawing a second cartoon in the same place.
// Hidden layers take their atoms out of everything.
function representationPlan() {
  let kind = payload.defaultStyle || "cartoon";
  let color = payload.defaultColor || "spectrum";
  const atoms = structureAtomCount();
  // A cartoon of something with no chain (a ligand, a small molecule from an .sdf/.xyz/.mol2 file) draws nothing,
  // which left an empty black box. Those are shown as sticks coloured by element.
  const smallMolecule = kind === "cartoon" && atoms > 0 && (atoms < 20 || structureChainLength() < 4);
  if ((kind === "surface" && atoms > 120000) || smallMolecule) {
    kind = atoms > 120000 ? "line" : "stick";
    if (smallMolecule && color === "spectrum") color = "default";
  }
  const layers = (Array.isArray(payload.layers) ? payload.layers : []).map(layer => ({ ...layer, sele: parseSelection(layer.selectionQuery || "all") }));
  const hidden = layers.filter(layer => layer.kind === "hidden").map(layer => layer.sele);
  const shown = layers.filter(layer => layer.kind !== "hidden");
  const plan = [];
  const base = excluding("all", [...hidden, ...shown.filter(layer => layer.kind === kind).map(layer => layer.sele)]);
  plan.push([representationKind(kind), representationParams(kind, color, null, base)]);
  if (kind === "cartoon") {
    // Ligands and cofactors bound to the chain would otherwise be invisible.
    plan.push(["licorice", { sele: excluding("ligand", hidden), colorScheme: "element", radius: 0.2, quality: "medium" }]);
  }
  if (kind === "line" || kind === "stick") {
    plan.push(["spacefill", { sele: excluding("water", hidden), color: "#38bdf8", opacity: 0.72, radiusScale: 0.18, quality: "medium" }]);
  }
  shown.forEach((layer, index) => {
    const later = shown.slice(index + 1).filter(other => other.kind === layer.kind).map(other => other.sele);
    const sele = excluding(layer.sele, [...hidden, ...later]);
    plan.push([representationKind(layer.kind), { ...representationParams(layer.kind, layer.colorScheme, layer.customColor, sele, layer), sele }]);
  });
  return plan;
}
let drawnPlanKey = "";
let initialOrientation = null;
let representationJob = null;
let representationAgain = false;
// Rebuilds the drawing only when what is drawn changes (a new name or background used to redraw everything),
// one rebuild at a time, and adds the new representations before removing the old ones: no blank frame.
async function applyRepresentations() {
  if (!component) return;
  if (representationJob) {
    representationAgain = true;
    return representationJob;
  }
  representationJob = (async () => {
    do {
      representationAgain = false;
      const plan = representationPlan();
      const key = JSON.stringify(plan);
      if (key === drawnPlanKey) continue;
      // New ones first, then the old ones go, in the same task: the picture never shows nothing in between.
      // (Hidden representations are only built when shown, which made the first drawing of a large file slower.)
      const old = (component.reprList || []).slice();
      plan.forEach(([type, params]) => component.addRepresentation(type, params));
      old.forEach(repr => component.removeRepresentation(repr));
      drawnPlanKey = key;
      requestRender();
      announceDrawn();
      // Frames are not drawn in a viewer on a hidden slide, so do not wait for one there: loading stopped at
      // "Drawing…" and never fitted the camera or applied the saved view.
      await new Promise(resolve => { requestAnimationFrame(resolve); setTimeout(resolve, 100); });
    } while (representationAgain);
  })();
  try {
    await representationJob;
  } finally {
    representationJob = null;
  }
}
// Back to the view the molecule was loaded with: its turn as well as its zoom (autoView alone kept the turn).
function resetView(duration = 400) {
  if (!component) return;
  if (initialOrientation && stage.animationControls?.orient) stage.animationControls.orient(initialOrientation, duration);
  else component.autoView(duration);
  requestRender();
  window.setTimeout(scheduleViewStateBroadcast, duration + 30);
}
function updateStatus() {
  if (!component) return;
  setStatus((payload.name || "Molecule") + " · " + structureAtomCount() + " atoms · " + structureResidueCount() + " residues" + (frameCount > 1 ? " · " + frameCount + " frames" : ""));
}
function applySpin() {
  if (!stage) return;
  stage.setSpin(Boolean(lifecycleActive && spinRequested));
  requestRender();
}
function stop(options = {}) {
  if (timer && options.remember) resumeTrajectoryOnActive = true;
  if (timer) cancelAnimationFrame(timer);
  timer = null;
  if (playBtn) playBtn.textContent = "Play";
  if (presentPlayBtn) presentPlayBtn.textContent = "Play";
}
function setFrame(index) {
  if (!frameCount) return;
  currentFrame = Math.max(0, Math.min(Number(index) || 0, frameCount - 1));
  if (trajectory?.setFrame) trajectory.setFrame(currentFrame, requestRender);
  if (frameInput) frameInput.value = String(currentFrame);
  if (frameLabel) frameLabel.textContent = (currentFrame + 1) + " / " + frameCount;
  requestRender();
}
function play() {
  if (!frameCount || !lifecycleActive) return;
  resumeTrajectoryOnActive = false;
  stop();
  // Paced by the display instead of a timer: a slow frame is not queued up behind the next ones.
  let last = performance.now();
  const tick = now => {
    const delay = 1000 / Math.max(1, Math.min(60, Number(speedInput.value) || 10));
    if (now - last >= delay) {
      last = now - ((now - last) % delay);
      setFrame((currentFrame + 1) % frameCount);
    }
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
  playBtn.textContent = "Pause";
  if (presentPlayBtn) presentPlayBtn.textContent = "Pause";
}
function setLifecycleActive(nextActive) {
  const next = Boolean(nextActive);
  if (next === lifecycleActive) return;
  lifecycleActive = next;
  if (!lifecycleActive) {
    stop({ remember: true });
    if (stage) stage.setSpin(false);
    return;
  }
  applySpin();
  if (resumeTrajectoryOnActive) {
    resumeTrajectoryOnActive = false;
    play();
  } else {
    requestRender();
  }
}
function setupTrajectoryControls() {
  const hasFrames = frameCount > 1;
  framePanel.hidden = !hasFrames;
  if (presentPlayBtn) presentPlayBtn.hidden = !hasFrames;
  if (!hasFrames) return;
  if (frameInput) {
    frameInput.max = String(frameCount - 1);
    frameInput.value = "0";
  }
  if (frameLabel) frameLabel.textContent = "1 / " + frameCount;
}
function getTrajectoryFromComponent(trajComponent) {
  if (trajComponent?.trajectory) return trajComponent.trajectory;
  if (trajComponent?.traj) return trajComponent.traj;
  const list = component?.trajList || component?.trajectoryList || [];
  const first = list[0];
  return first?.trajectory || first?.traj || first || null;
}
async function load() {
  if (!hasNgl()) {
    setStatus("The molecule viewer could not be loaded", "error");
    return;
  }
  applyBackground(payload.backgroundColor);
  try {
    stage = new window.NGL.Stage(root, {
      backgroundColor: fogColor(),
      quality: "medium",
      sampleLevel: 0,
      impostor: true,
      cameraType: payload.projection === "orthographic" ? "orthographic" : "perspective",
    });
    if (stage.mouseControls?.remove) {
      stage.mouseControls.remove("scroll-shift");
      stage.mouseControls.remove("drag-middle");
    }
    applyBackground(payload.backgroundColor);
    applyDepthCue();
    let moleculeData = await resolveMoleculeData();
    if (!moleculeData) throw new Error("Molecule file is empty");
    let format = fmt(payload.format);
    if (format === "xyz") {
      moleculeData = xyzToPdb(moleculeData);
      if (!moleculeData) throw new Error("no atoms found in this XYZ file");
      format = "pdb";
    }
    const endDelimitedTrajectory = format === "pdb" && isEndDelimitedPdbTrajectory(moleculeData);
    if (endDelimitedTrajectory) moleculeData = normalizeEndDelimitedPdbTrajectory(moleculeData);
    const shouldLoadTrajectory = payload.isTrajectory || endDelimitedTrajectory || hasModelRecords(moleculeData);
    frameCount = shouldLoadTrajectory ? trajectoryCount(moleculeData) : 0;
    const blob = new Blob([moleculeData], { type: "text/plain" });
    component = await stage.loadFile(blob, { ext: format === "mmcif" ? "cif" : format, asTrajectory: shouldLoadTrajectory && frameCount > 1 });
    if (!structureAtomCount()) throw new Error("no atoms were found in it");
    if (shouldLoadTrajectory && frameCount > 1 && component?.addTrajectory) {
      trajectory = getTrajectoryFromComponent(component.addTrajectory());
      if (trajectory?.frameCount) frameCount = trajectory.frameCount;
      if (trajectory?.signals?.frameChanged?.add) {
        trajectory.signals.frameChanged.add(index => {
          currentFrame = Number(index) || trajectory.currentFrame || currentFrame;
          if (frameInput) frameInput.value = String(currentFrame);
          if (frameLabel) frameLabel.textContent = (currentFrame + 1) + " / " + frameCount;
        });
      }
    } else if (payload.trajectory?.url) {
      // A trajectory that does not fit the structure is set aside, not fatal: the error used to hide the
      // structure as well. The editor is told, so it can detach the file and say why.
      try {
        await loadBinaryTrajectory();
      } catch (trajectoryError) {
        trajectory = null;
        frameCount = 0;
        rejectedTrajectoryMessage = "Trajectory not used: " + (trajectoryError && trajectoryError.message ? trajectoryError.message : trajectoryError);
      }
    } else {
      frameCount = 0;
    }
    if (trajectory?.signals?.frameChanged?.add && payload.trajectory?.url) {
      trajectory.signals.frameChanged.add(index => {
        currentFrame = Number(index) || 0;
        if (frameInput) frameInput.value = String(currentFrame);
        if (frameLabel) frameLabel.textContent = (currentFrame + 1) + " / " + frameCount;
      });
    }
    setStatus("Drawing " + (payload.name || "molecule") + "…", "loading");
    await applyRepresentations();
    fitInitialView();
    applySpin();
    stage.setParameters({ cameraType: payload.projection === "orthographic" ? "orthographic" : "perspective" });
    requestRender();
    updateStatus();
    setupTrajectoryControls();
    announceDrawn();
    if (rejectedTrajectoryMessage) {
      setStatus(rejectedTrajectoryMessage, "error");
      window.parent.postMessage({ type: "pptmaker:molecule:trajectory-rejected", elementId: payload.elementId, message: rejectedTrajectoryMessage }, "*");
    }
    root.addEventListener("dblclick", () => resetView());
    ["pointerup", "wheel", "touchend"].forEach(type => {
      root.addEventListener(type, scheduleViewStateBroadcast, { passive: true });
    });
    new ResizeObserver(resizeViewer).observe(root);
    setTimeout(resizeViewer, 120);
    setTimeout(resizeViewer, 650);
    setTimeout(resizeViewer, 1400);
  } catch (err) {
    setStatus("Could not show this file: " + (err && err.message ? err.message : err), "error");
  }
}
if (presentRotateBtn) {
  presentRotateBtn.addEventListener("click", event => {
    if (!stage) return;
    const next = event.currentTarget.dataset.on !== "true";
    event.currentTarget.dataset.on = String(next);
    event.currentTarget.textContent = next ? "Rotate On" : "Rotate";
    const rotateBtn = document.getElementById("rotate");
    if (rotateBtn) {
      rotateBtn.dataset.on = String(next);
      rotateBtn.textContent = next ? "Rotate On" : "Rotate";
    }
    stage.setSpin(next);
    requestRender();
  });
}
if (playBtn) playBtn.addEventListener("click", () => timer ? stop() : play());
if (presentPlayBtn) presentPlayBtn.addEventListener("click", () => timer ? stop() : play());
if (frameInput) frameInput.addEventListener("input", () => { stop(); setFrame(frameInput.value); });
if (speedInput) speedInput.addEventListener("input", () => { if (timer) play(); });
window.addEventListener("message", async event => {
  const message = event.data || {};
  if (!message || message.type !== "pptmaker:molecule:update") return;
  if (Object.prototype.hasOwnProperty.call(message, "fogColor")) payload.fogColor = message.fogColor || "";
  if (Object.prototype.hasOwnProperty.call(message, "backgroundColor") || Object.prototype.hasOwnProperty.call(message, "fogColor")) {
    if (Object.prototype.hasOwnProperty.call(message, "backgroundColor")) payload.backgroundColor = message.backgroundColor || "#020617";
    applyBackground(payload.backgroundColor);
  }
  if (Object.prototype.hasOwnProperty.call(message, "depthCue")) {
    payload.depthCue = message.depthCue !== false;
    applyDepthCue();
  }
  if (Object.prototype.hasOwnProperty.call(message, "name")) {
    payload.name = String(message.name || "Molecule");
    updateStatus();
  }
  if (Object.prototype.hasOwnProperty.call(message, "autoRotate") && stage && Boolean(message.autoRotate) !== spinRequested) {
    payload.autoRotate = Boolean(message.autoRotate);
    spinRequested = payload.autoRotate;
    applySpin();
  }
  if (Object.prototype.hasOwnProperty.call(message, "projection") && stage?.setParameters) {
    const projection = message.projection === "orthographic" ? "orthographic" : "perspective";
    if (projection !== payload.projection) {
      payload.projection = projection;
      stage.setParameters({ cameraType: projection });
      requestRender();
    }
  }
  const representationChanged =
    Object.prototype.hasOwnProperty.call(message, "defaultStyle") ||
    Object.prototype.hasOwnProperty.call(message, "defaultColor") ||
    Object.prototype.hasOwnProperty.call(message, "layers");
  if (representationChanged) {
    if (Object.prototype.hasOwnProperty.call(message, "defaultStyle")) payload.defaultStyle = message.defaultStyle || "cartoon";
    if (Object.prototype.hasOwnProperty.call(message, "defaultColor")) payload.defaultColor = message.defaultColor || "spectrum";
    if (Object.prototype.hasOwnProperty.call(message, "layers")) payload.layers = Array.isArray(message.layers) ? message.layers : [];
    await applyRepresentations();
  }
  if (Object.prototype.hasOwnProperty.call(message, "active")) {
    setLifecycleActive(message.active);
  }
});
window.addEventListener("message", event => {
  if (event.data?.type === "pptmaker:molecule:reset-view") resetView();
});
window.addEventListener("message", event => {
  const message = event.data || {};
  if (!message || message.type !== "pptmaker:molecule:lifecycle") return;
  setLifecycleActive(message.active);
});
window.addEventListener("message", event => {
  const message = event.data || {};
  if (!message || message.type !== "pptmaker:molecule:view-state-request") return;
  window.parent.postMessage({
    type: "pptmaker:molecule:view-state-response",
    requestId: message.requestId,
    viewState: getViewState(),
  }, "*");
});
// A small picture for the slide's thumbnail: a copy of what is on screen, scaled down. Unlike makeImage below it
// draws nothing again, so it costs next to nothing even for a large structure.
window.addEventListener("message", event => {
  const message = event.data || {};
  if (message.type !== "pptmaker:molecule:thumbnail-request") return;
  let dataUrl = null;
  try {
    const source = stage?.viewer?.renderer?.domElement;
    if (source && component && source.width && source.height) {
      const width = Math.min(source.width, Math.max(60, Number(message.width) || 320));
      const copy = document.createElement("canvas");
      copy.width = width;
      copy.height = Math.round(source.height * width / source.width);
      const context = copy.getContext("2d");
      if (payload.backgroundColor !== "transparent") {
        context.fillStyle = payload.backgroundColor || "#020617";
        context.fillRect(0, 0, copy.width, copy.height);
      }
      context.drawImage(source, 0, 0, copy.width, copy.height);
      dataUrl = copy.toDataURL("image/png");
    }
  } catch (_err) {
    dataUrl = null;
  }
  window.parent.postMessage({ type: "pptmaker:molecule:thumbnail-response", requestId: message.requestId, dataUrl }, "*");
});
// A picture of the current view, for exports (PDF, PNG, PowerPoint) that cannot look inside this frame.
window.addEventListener("message", async event => {
  const message = event.data || {};
  if (!message || message.type !== "pptmaker:molecule:snapshot-request") return;
  let dataUrl = null;
  try {
    if (stage && component) {
      // Transparent unless a background was asked for: the element's own background shows through on the slide.
      const factor = Math.max(1, Math.min(4, Number(message.factor) || 2));
      // A viewer on a slide Reveal has hidden (display: none) measures 0 x 0, and the picture came out 2 x 2
      // pixels (a black box in PowerPoint). Draw at the element's size for the picture, then fit back.
      const wantWidth = Number(message.width) || 0;
      const wantHeight = Number(message.height) || 0;
      const collapsed = (stage.viewer.width || 0) < 8 || (stage.viewer.height || 0) < 8;
      const resized = collapsed && wantWidth >= 8 && wantHeight >= 8;
      if (resized) {
        stage.viewer.setSize(wantWidth, wantHeight);
        if (fittedWhileCollapsed) {
          component.autoView(0);
          applyViewState(payload.viewState);
        }
      }
      let blob;
      try {
        blob = await stage.makeImage({ factor, antialias: true, trim: false, transparent: message.transparent !== false });
      } finally {
        if (resized) stage.handleResize();
      }
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }
  } catch (_err) {
    dataUrl = null;
  }
  window.parent.postMessage({ type: "pptmaker:molecule:snapshot-response", requestId: message.requestId, dataUrl }, "*");
});
window.addEventListener("resize", resizeViewer);
// For tests and debugging from the browser's console.
window.sfMoleculeViewer = { stage: () => stage, component: () => component, trajectory: () => trajectory, initialOrientation: () => initialOrientation };
load();
})();
`;
}

function buildMoleculeEmbedSrcdoc(elementData = {}) {
    const rawContent = String(elementData.content || "");
    const externalContent = isMoleculeContentUrl(rawContent);
    const payload = {
        data: externalContent ? "" : String(rawContent || createDefaultMoleculeContent()),
        dataUrl: externalContent ? rawContent : "",
        elementId: String(elementData.id || ""),
        format: normalizeMoleculeFormat(elementData.moleculeFormat || "pdb"),
        name: String(elementData.moleculeName || "Molecule"),
        isTrajectory: Boolean(elementData.moleculeIsTrajectory || (!externalContent && isMoleculeTrajectoryData(elementData.content))),
        autoRotate: Boolean(elementData.moleculeAutoRotate),
        projection: elementData.moleculeProjection === "orthographic" ? "orthographic" : "perspective",
        defaultStyle: ["cartoon", "stick", "sphere", "line", "surface"].includes(elementData.moleculeDefaultStyle)
            ? elementData.moleculeDefaultStyle
            : "cartoon",
        defaultColor: ["default", "chain", "amino", "ssJmol", "spectrum", "custom"].includes(elementData.moleculeDefaultColor)
            ? elementData.moleculeDefaultColor
            : "spectrum",
        layers: Array.isArray(elementData.moleculeRepresentationLayers)
            ? elementData.moleculeRepresentationLayers.map(normalizeMoleculeRepresentationLayer).slice(0, 12)
            : [],
        presentationMode: Boolean(elementData.moleculePresentationMode),
        active: elementData.moleculeActive !== false,
        viewState: normalizeMoleculeViewState(elementData.moleculeViewState),
        backgroundColor: normalizeMoleculeBackgroundColor(elementData.styles?.backgroundColor || "#020617"),
        fogColor: String(elementData.moleculeFogColor || ""),
        trajectory: elementData.moleculeTrajectory?.url
            ? { url: String(elementData.moleculeTrajectory.url), format: String(elementData.moleculeTrajectory.format || "xtc").toLowerCase() }
            : null,
        depthCue: elementData.moleculeDepthCue !== false,
    };
    const title = _escapeMoleculeHtml(payload.name);
    const background = payload.backgroundColor === "transparent" ? "transparent" : payload.backgroundColor;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="normal">
<script>
(() => {
  const ignorePatterns = [
    "useLegacyLights has been deprecated",
    "STAGE LOG",
    "EDTSurface fillvoxels",
    "EDTSurface fastdistancemap",
    "EDTSurface.getVolume"
  ];
  const shouldIgnore = args => ignorePatterns.some(pattern => args.map(value => String(value)).join(" ").includes(pattern));
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  console.log = (...args) => { if (!shouldIgnore(args)) originalLog(...args); };
  console.warn = (...args) => { if (!shouldIgnore(args)) originalWarn(...args); };
})();
<\/script>
<script src="${MOLECULE_EMBED_NGL_SRC}"><\/script>
<style>
/* The page paints the background; NGL paints its canvas with its own background colour on every change, which
   turned "transparent" into a filled box. */
#viewer canvas{background-color:transparent !important}
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${background};color:#e2e8f0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#viewer{position:absolute;inset:0;background:${background}}
.hud{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;align-items:end;pointer-events:none}
.panel{pointer-events:auto;border:1px solid rgba(148,163,184,.24);background:rgba(15,23,42,.82);backdrop-filter:blur(12px);border-radius:8px;padding:8px;box-shadow:0 12px 28px rgba(0,0,0,.28)}
.trajectory-controls{display:flex;align-items:center;gap:8px;flex:1 1 300px;min-width:0;max-width:560px}
.trajectory-controls button{min-width:56px}
.trajectory-controls input[type=range]{accent-color:#818cf8}
.trajectory-controls #traj-frame{flex:1;min-width:60px}
/* The trajectory bar has its own Play; a second one beside it pushed the bar out of the frame while presenting. */
body.presentation-mode #present-play{display:none !important}
.trajectory-speed{display:flex;align-items:center;gap:6px;font-size:10px;color:#cbd5e1;white-space:nowrap}
.trajectory-speed input{width:70px}
.trajectory-frame-label{min-width:54px;text-align:right;font-size:11px;color:#e2e8f0;font-variant-numeric:tabular-nums}
.top{display:none;position:absolute;inset:0;align-items:center;justify-content:center;padding:16px;text-align:center;pointer-events:none}
.top.is-loading,.top.is-error{display:flex}
.status{max-width:80%;padding:8px 12px;border-radius:8px;background:rgba(15,23,42,.78);color:#cbd5e1;font-size:12px;line-height:1.4}
.top.is-error .status{color:#fecaca;border:1px solid rgba(248,113,113,.5)}
input,select,button{font:inherit}
button{border:1px solid rgba(99,102,241,.35);background:rgba(79,70,229,.86);color:white;border-radius:6px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer}
button.secondary{background:rgba(30,41,59,.9);border-color:rgba(100,116,139,.55);color:#cbd5e1}
#trajectory-panel[hidden]{display:none}
.presentation-only{display:none}
body.presentation-mode .presentation-only{display:flex}
.presentation-controls{gap:8px;padding:7px;background:rgba(15,23,42,.62)}
body.presentation-mode .presentation-controls button[hidden]{display:none}
@media(max-width:520px){.status{max-width:100%}.trajectory-controls{gap:6px}.trajectory-speed span{display:none}.trajectory-speed input{width:52px}}
</style>
</head>
<body class="${payload.presentationMode ? "presentation-mode" : ""}">
<div id="viewer" aria-label="${title} molecular viewer"></div>
<div class="top is-loading"><div id="status" class="status">Loading ${title}…</div></div>
<div class="hud">
  <div class="panel presentation-controls presentation-only">
    <button id="present-play" type="button" hidden>Play</button>
    <button id="present-rotate" class="secondary" type="button">Rotate</button>
  </div>
  <div id="trajectory-panel" class="panel trajectory-controls" hidden>
    <button id="traj-play" type="button">Play</button>
    <input id="traj-frame" type="range" min="0" max="0" value="0" aria-label="Trajectory frame">
    <span id="traj-label" class="trajectory-frame-label">0 / 0</span>
    <label class="trajectory-speed"><span>Speed</span><input id="traj-speed" type="range" min="1" max="30" step="1" value="10" aria-label="Trajectory speed, frames per second" title="Frames per second"></label>
  </div>
</div>
<script>${_moleculeSrcdocScript(payload)}<\/script>
</body>
</html>`;
}

function applyMoleculeEmbedSandbox(iframe) {
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-downloads");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    // A frame whose colour scheme differs from its page's gets an opaque backdrop: in dark mode a "transparent"
    // molecule sat in a white box. The frame's document says "normal" too.
    iframe.style.colorScheme = "normal";
}

// The colour of the slide behind a molecule, for a transparent viewer's depth cue to fade into: the slide's own
// colour, else the middle of the theme's background.
function moleculeFogColor(slide) {
    const own = String(slide?.backgroundColor || slide?.background?.color || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(own)) return own;
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    const css = String(theme?.cssVars?.["--slide-bg"] || "");
    const colours = (css.match(/#[0-9a-f]{6}\b/gi) || []).map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    if (!colours.length) return "";
    const mean = [0, 1, 2].map(c => Math.round(colours.reduce((sum, rgb) => sum + rgb[c], 0) / colours.length));
    return `#${mean.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// Everything about a molecule's look that its viewer can change in place, as one update message.
function moleculeEmbedSettingsMessage(elData, slide) {
    return {
        type: "pptmaker:molecule:update",
        name: elData.moleculeName || "Molecule",
        backgroundColor: normalizeMoleculeBackgroundColor(elData.styles?.backgroundColor || "#020617"),
        fogColor: moleculeFogColor(slide),
        depthCue: elData.moleculeDepthCue !== false,
        autoRotate: Boolean(elData.moleculeAutoRotate),
        projection: elData.moleculeProjection === "orthographic" ? "orthographic" : "perspective",
        defaultStyle: ["cartoon", "stick", "sphere", "line", "surface"].includes(elData.moleculeDefaultStyle) ? elData.moleculeDefaultStyle : "cartoon",
        defaultColor: ["default", "chain", "amino", "ssJmol", "spectrum", "custom"].includes(elData.moleculeDefaultColor) ? elData.moleculeDefaultColor : "spectrum",
        layers: Array.isArray(elData.moleculeRepresentationLayers)
            ? elData.moleculeRepresentationLayers.map(normalizeMoleculeRepresentationLayer).slice(0, 12)
            : [],
    };
}

// Brings a molecule element already on the page up to date with its data without reloading the viewer: its box,
// background, orbit/select mode and the viewer's settings.
function syncMoleculeElementNode(node, elData, slide) {
    if (!node || !elData) return;
    const background = normalizeMoleculeBackgroundColor(elData.styles?.backgroundColor || "#020617");
    node.style.transform = typeof canvasElementTransform === "function" ? canvasElementTransform(elData) : `translate(${elData.x}px, ${elData.y}px)`;
    node.setAttribute("data-x", elData.x);
    node.setAttribute("data-y", elData.y);
    if (elData.width) node.style.width = elData.width;
    if (elData.height) node.style.height = elData.height;
    node.style.backgroundColor = background;
    const wrapper = node.querySelector(".molecule-embed-wrapper");
    if (wrapper) wrapper.style.backgroundColor = background;
    const interactive = Boolean(elData.moleculeInteractive);
    node.classList.toggle("molecule-interactive", interactive);
    node.setAttribute("data-molecule-interactive", interactive ? "true" : "false");
    const shield = node.querySelector(".molecule-editor-shield");
    if (shield) shield.hidden = interactive;
    const toggle = node.querySelector(".molecule-editor-toggle");
    if (toggle) {
        toggle.classList.toggle("active", interactive);
        toggle.title = interactive ? "Switch to select and resize mode" : "Enable 3D orbit mode";
        toggle.setAttribute("aria-label", interactive ? "Switch molecule to select and resize mode" : "Enable molecule 3D orbit mode");
        const icon = toggle.querySelector("i");
        if (icon) icon.className = `fa-solid ${interactive ? "fa-cube" : "fa-arrow-pointer"}`;
        const label = toggle.querySelector("span");
        if (label) label.textContent = interactive ? "Orbit" : "Select";
    }
    node.querySelector(".molecule-embed-frame")?.contentWindow?.postMessage(moleculeEmbedSettingsMessage(elData, slide), "*");
}

// What a molecule's viewer must be reloaded for (its file); everything else is changed in place.
const MOLECULE_IN_PLACE_KEYS = new Set([
    "x", "y", "width", "height", "moleculeName", "moleculeInteractive", "moleculeAutoRotate", "moleculeProjection",
    "moleculeDefaultStyle", "moleculeDefaultColor", "moleculeRepresentationLayers", "moleculeDepthCue", "moleculeViewState",
]);
function moleculeReloadSignature(elData) {
    const rest = {};
    Object.keys(elData || {}).forEach(key => {
        if (!MOLECULE_IN_PLACE_KEYS.has(key)) rest[key] = elData[key];
    });
    if (rest.styles) {
        const { backgroundColor: _bg, ...styles } = rest.styles;
        rest.styles = styles;
    }
    return rest;
}

// Live bridges by iframe. Slide re-renders replace iframes without telling us, so each new attach sweeps the
// bridges whose iframe has left the page; otherwise every render would leak a window "message" listener.
const _moleculeDataBridges = new Map();

function _sweepDetachedMoleculeBridges() {
    for (const [frame, cleanup] of _moleculeDataBridges) {
        if (!frame.isConnected) {
            cleanup();
            _moleculeDataBridges.delete(frame);
        }
    }
}

function attachMoleculeDataBridge(iframe, elementData = {}) {
    const trajectoryUrl = String(elementData.moleculeTrajectory?.url || "");
    const contentUrl = isMoleculeContentUrl(elementData.content) ? String(elementData.content || "") : "";
    const fetchable = trajectoryUrl && !/^data:/i.test(trajectoryUrl) ? trajectoryUrl : "";
    if (!iframe || (!contentUrl && !fetchable)) return null;
    _sweepDetachedMoleculeBridges();
    _moleculeDataBridges.get(iframe)?.();
    const onMessage = async event => {
        if (!iframe.isConnected && iframe._moleculeDataBridgeAttached) {
            window.removeEventListener("message", onMessage);
            _moleculeDataBridges.delete(iframe);
            return;
        }
        const message = event.data || {};
        if (!message || message.type !== "pptmaker:molecule:data-request") return;
        if (event.source !== iframe.contentWindow) return;
        if (!message.url || (message.url !== contentUrl && message.url !== fetchable)) return;
        try {
            const response = await fetch(message.url, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`Molecule fetch failed (${response.status})`);
            // Binary trajectories go over as a buffer handed to the frame, not copied.
            const data = message.binary ? await response.arrayBuffer() : await response.text();
            iframe.contentWindow?.postMessage({
                type: "pptmaker:molecule:data-response",
                requestId: message.requestId,
                data,
            }, "*", message.binary ? [data] : []);
        } catch (err) {
            iframe.contentWindow?.postMessage({
                type: "pptmaker:molecule:data-response",
                requestId: message.requestId,
                error: err?.message || "Could not load molecule data",
            }, "*");
        }
    };
    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", () => {
        iframe._moleculeDataBridgeAttached = true;
    }, { once: true });
    const cleanup = () => window.removeEventListener("message", onMessage);
    iframe._moleculeDataBridgeCleanup = cleanup;
    _moleculeDataBridges.set(iframe, cleanup);
    return cleanup;
}
