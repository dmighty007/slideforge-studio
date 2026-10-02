export class LaserPointer {
    static createTrail(points = []) {
        return {
            kind: "laserTrail",
            role: "laser-pointer",
            geometry: { points },
            presentation: { mode: "temporary", audienceVisible: true },
            export: { includeInPdf: false, includeInPng: false, includeInSvg: false, flatten: false },
        };
    }
}
