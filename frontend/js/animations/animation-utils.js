/**
 * Animation Utilities
 * Easing functions, interpolation, and helper methods for animation engine
 */

// Standard easing functions
const EASING_FUNCTIONS = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => 1 - (1 - t) * (1 - t),
    easeInOut: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    easeInQuad: t => t * t,
    easeOutQuad: t => 1 - (1 - t) * (1 - t),
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - (1 - t) * (1 - t) * (1 - t),
    easeInQuart: t => t * t * t * t,
    easeOutQuart: t => 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t),
    easeInQuint: t => t * t * t * t * t,
    easeOutQuint: t => 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t) * (1 - t),
    easeInExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInCirc: t => 1 - Math.sqrt(1 - t * t),
    easeOutCirc: t => Math.sqrt(1 - (t - 1) * (t - 1)),
    easeInBack: t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return c3 * t * t * t - c1 * t * t;
    },
    easeOutBack: t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * (t - 1) * (t - 1) * (t - 1) + c1 * (t - 1) * (t - 1);
    },
    easeInElastic: t => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
    },
    easeOutElastic: t => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
};

// Spring physics easing
function createSpringEasing(stiffness = 100, damping = 30, mass = 1) {
    return t => {
        if (t === 0) return 0;
        if (t === 1) return 1;

        const w0 = Math.sqrt(stiffness / mass);
        const zeta = damping / (2 * Math.sqrt(stiffness * mass));

        if (zeta < 1) {
            const wd = w0 * Math.sqrt(1 - zeta * zeta);
            const exp = Math.exp(-zeta * w0 * t);
            return 1 - exp * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
        } else if (zeta === 1) {
            return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
        } else {
            const wd = w0 * Math.sqrt(zeta * zeta - 1);
            const exp = Math.exp(-zeta * w0 * t);
            return 1 - exp * (Math.cosh(wd * t) + ((zeta * w0) / wd) * Math.sinh(wd * t));
        }
    };
}

// Cubic bezier easing
function createCubicBezierEasing(p1x, p1y, p2x, p2y) {
    const epsilon = 1e-7;

    function calcBezier(t, p1, p2) {
        return ((1 - 3 * p2 + 3 * p1) * t + (3 * p2 - 6 * p1)) * t * t + 3 * p1 * t;
    }

    function calcDerivative(t, p1, p2) {
        return 3 * (1 - 3 * p2 + 3 * p1) * t * t + 2 * (3 * p2 - 6 * p1) * t + 3 * p1;
    }

    return t => {
        if (t === 0) return 0;
        if (t === 1) return 1;

        let lo = 0,
            hi = 1,
            x = t;

        for (let i = 0; i < 8; i++) {
            const fx = calcBezier(x, p1x, p2x) - t;
            if (Math.abs(fx) < epsilon) break;

            const dfx = calcDerivative(x, p1x, p2x);
            x = dfx === 0 ? lo + (hi - lo) / 2 : x - fx / dfx;

            if (x < lo) x = lo;
            if (x > hi) x = hi;
        }

        return calcBezier(x, p1y, p2y);
    };
}

function getEasingFunction(easing) {
    if (typeof easing === "function") return easing;
    if (typeof easing === "string") {
        return EASING_FUNCTIONS[easing] || EASING_FUNCTIONS.easeOut;
    }
    if (easing && typeof easing === "object") {
        if (easing.type === "spring") {
            return createSpringEasing(easing.stiffness, easing.damping, easing.mass);
        }
        if (easing.type === "cubic-bezier") {
            return createCubicBezierEasing(easing.x1, easing.y1, easing.x2, easing.y2);
        }
    }
    return EASING_FUNCTIONS.easeOut;
}

// Interpolation functions
function interpolate(from, to, progress) {
    if (typeof from === "number" && typeof to === "number") {
        return from + (to - from) * progress;
    }
    return progress < 0.5 ? from : to;
}

function interpolateColor(from, to, progress) {
    const fromRGB = hexToRGB(from);
    const toRGB = hexToRGB(to);

    const r = Math.round(interpolate(fromRGB[0], toRGB[0], progress));
    const g = Math.round(interpolate(fromRGB[1], toRGB[1], progress));
    const b = Math.round(interpolate(fromRGB[2], toRGB[2], progress));

    return rgbToHex(r, g, b);
}

function hexToRGB(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Transform interpolation
function interpolateTransform(fromTransform, toTransform, progress) {
    const from = parseTransform(fromTransform);
    const to = parseTransform(toTransform);

    return {
        x: interpolate(from.x, to.x, progress),
        y: interpolate(from.y, to.y, progress),
        scaleX: interpolate(from.scaleX, to.scaleX, progress),
        scaleY: interpolate(from.scaleY, to.scaleY, progress),
        rotation: interpolate(from.rotation, to.rotation, progress),
    };
}

function parseTransform(transformStr) {
    const transform = {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
    };

    if (!transformStr) return transform;

    const translateMatch = transformStr.match(/translate[XY]?\(([^)]+)\)/g) || [];
    const scaleMatch = transformStr.match(/scale[XY]?\(([^)]+)\)/g) || [];
    const rotateMatch = transformStr.match(/rotate\(([^)]+)\)/);

    translateMatch.forEach(match => {
        if (match.includes("translateX")) {
            transform.x = parseFloat(match.match(/\(([^)]+)\)/)[1]);
        } else if (match.includes("translateY")) {
            transform.y = parseFloat(match.match(/\(([^)]+)\)/)[1]);
        }
    });

    scaleMatch.forEach(match => {
        if (match.includes("scaleX")) {
            transform.scaleX = parseFloat(match.match(/\(([^)]+)\)/)[1]);
        } else if (match.includes("scaleY")) {
            transform.scaleY = parseFloat(match.match(/\(([^)]+)\)/)[1]);
        }
    });

    if (rotateMatch) {
        transform.rotation = parseFloat(rotateMatch[1]);
    }

    return transform;
}

function buildTransform(transform) {
    const parts = [];
    if (transform.x !== 0 || transform.y !== 0) {
        parts.push(`translate3d(${transform.x}px, ${transform.y}px, 0)`);
    }
    if (transform.scaleX !== 1 || transform.scaleY !== 1) {
        parts.push(`scale3d(${transform.scaleX}, ${transform.scaleY}, 1)`);
    }
    if (transform.rotation !== 0) {
        parts.push(`rotate(${transform.rotation}deg)`);
    }
    return parts.join(" ");
}

// SVG path interpolation
function interpolateSVGPath(fromPath, toPath, progress) {
    // Simple implementation: if paths have same structure, interpolate points
    if (!fromPath || !toPath) return fromPath || toPath;

    const fromPoints = extractPathPoints(fromPath);
    const toPoints = extractPathPoints(toPath);

    if (fromPoints.length !== toPoints.length) {
        return progress < 0.5 ? fromPath : toPath;
    }

    const interpolated = fromPoints.map((point, i) => ({
        ...point,
        x: interpolate(point.x, toPoints[i].x, progress),
        y: interpolate(point.y, toPoints[i].y, progress),
    }));

    return buildPath(interpolated);
}

function extractPathPoints(pathStr) {
    if (!pathStr) return [];
    const points = [];
    const commands = pathStr.match(/[a-zA-Z][^a-zA-Z]*/g) || [];

    commands.forEach(cmd => {
        const type = cmd[0];
        const coords = cmd
            .slice(1)
            .trim()
            .split(/[\s,]+/)
            .map(Number);

        switch (type) {
            case "M":
            case "m":
                points.push({ type: type, x: coords[0], y: coords[1] });
                break;
            case "L":
            case "l":
                points.push({ type: type, x: coords[0], y: coords[1] });
                break;
            case "H":
            case "h":
                points.push({ type: type, x: coords[0], y: 0 });
                break;
            case "V":
            case "v":
                points.push({ type: type, x: 0, y: coords[0] });
                break;
            case "C":
            case "c":
                points.push({
                    type: type,
                    x: coords[4],
                    y: coords[5],
                    cp1x: coords[0],
                    cp1y: coords[1],
                    cp2x: coords[2],
                    cp2y: coords[3],
                });
                break;
        }
    });

    return points;
}

function buildPath(points) {
    if (!points.length) return "";
    return points
        .map((p, i) => {
            const cmd = i === 0 ? "M" : p.type === "M" || p.type === "m" ? "M" : "L";
            if (p.type === "C") {
                return `${cmd}${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`;
            }
            return `${cmd}${p.x} ${p.y}`;
        })
        .join(" ");
}

// Clamp value to range
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Ease out function for scrubbing
function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
}

// Export all utilities
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        EASING_FUNCTIONS,
        getEasingFunction,
        createSpringEasing,
        createCubicBezierEasing,
        interpolate,
        interpolateColor,
        interpolateTransform,
        interpolateSVGPath,
        hexToRGB,
        rgbToHex,
        parseTransform,
        buildTransform,
        clamp,
        easeOutQuad,
    };
}
