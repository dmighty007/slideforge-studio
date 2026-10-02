export class GraphStepSequencer {
    constructor(steps = []) {
        this.steps = steps;
        this.index = -1;
    }

    next() {
        this.index = Math.min(this.steps.length - 1, this.index + 1);
        return this.steps[this.index] || null;
    }
}
