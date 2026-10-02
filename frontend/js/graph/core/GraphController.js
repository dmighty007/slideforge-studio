import { ensureSemanticGraphDocument } from "../schema/migrations.js";
import { GraphScene } from "./GraphScene.js";

export class GraphController {
    constructor(document = {}) {
        this.document = ensureSemanticGraphDocument(document);
        this.scene = GraphScene.fromDocument(this.document);
    }

    update(patch = {}) {
        this.document = ensureSemanticGraphDocument({ ...this.document, ...patch });
        this.scene = GraphScene.fromDocument(this.document);
        return this.scene;
    }
}
