// RDKit runs in this worker, not in the page: RDKit.js compiles WebAssembly and builds functions at run time,
// which the editor page's Content-Security-Policy does not allow (no 'unsafe-eval' or 'wasm-unsafe-eval').
// A worker script served from the app has no policy of its own. Messages: { id, smiles, options } in,
// { id, svg, properties } or { id, error } out.

let rdkit = null;

function ready() {
    if (!rdkit) {
        importScripts("vendor/RDKit_minimal.js");
        rdkit = self.initRDKitModule({ locateFile: file => new URL(`vendor/${file}`, self.location.href).href });
    }
    return rdkit;
}

function formulaOf(mol) {
    try {
        return (mol.get_inchi() || "").split("/")[1] || "";
    } catch (_error) {
        return "";
    }
}

function draw(RDKit, { smiles, options }) {
    const mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) {
        mol?.delete();
        throw new Error(`RDKit could not read “${smiles}” as SMILES`);
    }
    const query = options.highlight ? RDKit.get_qmol(options.highlight) : null;
    try {
        if (options.highlight && (!query || !query.is_valid())) throw new Error(`“${options.highlight}” is not a valid SMARTS pattern`);
        const details = { ...options.draw };
        let matched = 0;
        if (query) {
            // RDKit answers "{}" when nothing matches and may give one match as a bare object, not a list.
            const found = JSON.parse(mol.get_substruct_matches(query) || "[]");
            const matches = Array.isArray(found) ? found : found && Array.isArray(found.atoms) ? [found] : [];
            matched = matches.length;
            details.atoms = [...new Set(matches.flatMap(match => match.atoms || []))];
            details.bonds = [...new Set(matches.flatMap(match => match.bonds || []))];
        }
        const svg = mol.get_svg_with_highlights(JSON.stringify(details));
        const descriptors = JSON.parse(mol.get_descriptors());
        return {
            svg,
            matched,
            properties: {
                formula: formulaOf(mol),
                weight: descriptors.amw,
                logP: descriptors.CrippenClogP,
                tpsa: descriptors.tpsa,
                hbd: descriptors.NumHBD,
                hba: descriptors.NumHBA,
                rotatable: descriptors.NumRotatableBonds,
            },
        };
    } finally {
        query?.delete();
        mol.delete();
    }
}

self.onmessage = async event => {
    const { id } = event.data || {};
    try {
        const RDKit = await ready();
        self.postMessage({ id, ...draw(RDKit, event.data) });
    } catch (error) {
        self.postMessage({ id, error: String(error?.message || error) });
    }
};
