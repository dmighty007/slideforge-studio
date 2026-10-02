/**
 * Animation Export Module
 * Serialize and deserialize animations to/from JSON
 * Provides compact, human-readable animation format
 */

/**
 * Serialize a single animation to JSON object
 * Includes all animation properties, preserves easing functions and type-specific props
 * @param {Object} animation - Animation object to serialize
 * @param {string} elementId - Optional element ID for context
 * @returns {Object} JSON-serializable animation object
 */
function serializeAnimation(animation, elementId = "") {
    if (!animation || typeof animation !== "object") {
        return null;
    }

    // Base animation properties
    const serialized = {
        id: animation.id || "",
        type: animation.type || "fadeIn",
        duration: Number(animation.duration) || 600,
        delay: Number(animation.delay) || 0,
        easing: animation.easing || "easeOut",
    };

    // Optional repeat properties
    if (animation.repeatCount !== undefined && animation.repeatCount > 0) {
        serialized.repeatCount = Number(animation.repeatCount);
    }
    if (animation.repeatDelay !== undefined && animation.repeatDelay > 0) {
        serialized.repeatDelay = Number(animation.repeatDelay);
    }
    if (animation.autoReverse !== undefined && animation.autoReverse) {
        serialized.autoReverse = true;
    }

    // Type-specific properties (only include if non-default)
    const defaults = createAnimation(animation.type || "fadeIn");

    if (animation.startScale !== undefined && animation.startScale !== defaults.startScale) {
        serialized.startScale = Number(animation.startScale);
    }
    if (animation.startOpacity !== undefined && animation.startOpacity !== defaults.startOpacity) {
        serialized.startOpacity = Number(animation.startOpacity);
    }
    if (animation.endScale !== undefined && animation.endScale !== defaults.endScale) {
        serialized.endScale = Number(animation.endScale);
    }
    if (animation.endOpacity !== undefined && animation.endOpacity !== defaults.endOpacity) {
        serialized.endOpacity = Number(animation.endOpacity);
    }
    if (animation.startColor !== undefined && animation.startColor !== defaults.startColor) {
        serialized.startColor = animation.startColor;
    }
    if (animation.endColor !== undefined && animation.endColor !== defaults.endColor) {
        serialized.endColor = animation.endColor;
    }
    if (animation.path !== undefined && animation.path !== defaults.path) {
        serialized.path = String(animation.path);
    }
    if (animation.strokeLength !== undefined && animation.strokeLength !== defaults.strokeLength) {
        serialized.strokeLength = Number(animation.strokeLength);
    }
    if (animation.direction !== undefined && animation.direction !== defaults.direction) {
        serialized.direction = String(animation.direction);
    }
    if (animation.rotation !== undefined && animation.rotation !== defaults.rotation) {
        serialized.rotation = Number(animation.rotation);
    }

    // Keyframes
    if (Array.isArray(animation.keyframes) && animation.keyframes.length > 0) {
        serialized.keyframes = animation.keyframes.map(kf => ({
            time: Number(kf.time) || 0,
            property: String(kf.property),
            value: kf.value,
            easing: kf.easing || "easeOut",
        }));
    }

    // Start time (for timeline context)
    if (animation.startTime !== undefined) {
        serialized.startTime = Number(animation.startTime);
    }

    return serialized;
}

/**
 * Serialize all animations for a single element
 * @param {Object} element - DOM element or slide element object
 * @returns {Array} Array of serialized animations
 */
function serializeElementTimeline(element) {
    if (!element) return [];

    const animations = [];

    // Check if element has animation property (from animation-state.js structure)
    if (element.animation && typeof element.animation === "object") {
        const config = element.animation;

        // Handle timelines structure
        if (Array.isArray(config.timelines)) {
            for (const timeline of config.timelines) {
                if (Array.isArray(timeline.animations)) {
                    for (const anim of timeline.animations) {
                        const serialized = serializeAnimation(anim, element.id);
                        if (serialized) {
                            serialized.startTime = Number(anim.startTime) || 0;
                            animations.push(serialized);
                        }
                    }
                }
            }
        }
    }

    // Sort by start time
    animations.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    return animations;
}

/**
 * Serialize all slides' animations to comprehensive JSON structure
 * @param {Array} slides - Array of slide objects
 * @returns {Object} Complete animation config for all slides
 */
function serializeSlidesAnimations(slides) {
    if (!Array.isArray(slides)) {
        return { slides: [], metadata: { version: "1.0", exportDate: new Date().toISOString() } };
    }

    const slidesData = [];

    for (const slide of slides) {
        const slideData = {
            id: slide.id || `slide-${Date.now()}`,
            animations: [],
        };

        // Add auto-animate config if present
        if (slide.animation && typeof slide.animation === "object") {
            if (slide.animation.autoAnimate !== undefined) {
                slideData.autoAnimate = Boolean(slide.animation.autoAnimate);
            }
            if (slide.animation.laggedStart !== undefined) {
                slideData.laggedStart = Boolean(slide.animation.laggedStart);
            }
            if (slide.animation.laggedStartDelay !== undefined) {
                slideData.laggedStartDelay = Number(slide.animation.laggedStartDelay);
            }
        }

        // Serialize animations for each element in the slide
        if (Array.isArray(slide.elements)) {
            for (const element of slide.elements) {
                const elementAnimations = serializeElementTimeline(element);
                if (elementAnimations.length > 0) {
                    slideData.animations.push({
                        elementId: element.id || "",
                        elementType: element.type || "shape",
                        animations: elementAnimations,
                    });
                }
            }
        }

        slidesData.push(slideData);
    }

    return {
        slides: slidesData,
        metadata: {
            version: "1.0",
            exportDate: new Date().toISOString(),
            totalSlides: slidesData.length,
        },
    };
}

/**
 * Deserialize a single animation from JSON
 * Reconstructs full animation object with defaults
 * @param {Object} jsonObj - Serialized animation JSON
 * @returns {Object} Reconstructed Animation object
 */
function deserializeAnimation(jsonObj) {
    if (!jsonObj || typeof jsonObj !== "object") {
        return null;
    }

    // Create base animation with specified type
    const animation = createAnimation(jsonObj.type || "fadeIn", {
        duration: jsonObj.duration,
        delay: jsonObj.delay,
        easing: jsonObj.easing,
        repeatCount: jsonObj.repeatCount,
        repeatDelay: jsonObj.repeatDelay,
        autoReverse: jsonObj.autoReverse,
        startScale: jsonObj.startScale,
        startOpacity: jsonObj.startOpacity,
        endScale: jsonObj.endScale,
        endOpacity: jsonObj.endOpacity,
        startColor: jsonObj.startColor,
        endColor: jsonObj.endColor,
        path: jsonObj.path,
        strokeLength: jsonObj.strokeLength,
        direction: jsonObj.direction,
        rotation: jsonObj.rotation,
    });

    // Preserve ID if provided
    if (jsonObj.id) {
        animation.id = jsonObj.id;
    }

    // Restore keyframes
    if (Array.isArray(jsonObj.keyframes)) {
        animation.keyframes = jsonObj.keyframes.map(kf => ({
            time: Number(kf.time) || 0,
            property: String(kf.property),
            value: kf.value,
            easing: kf.easing || "easeOut",
        }));
    }

    // Add start time for timeline context
    if (jsonObj.startTime !== undefined) {
        animation.startTime = Number(jsonObj.startTime);
    }

    return animation;
}

/**
 * Deserialize all animations for a single element
 * @param {Array} jsonArray - Array of serialized animations
 * @returns {Array} Array of reconstructed Animation objects
 */
function deserializeElementTimeline(jsonArray) {
    if (!Array.isArray(jsonArray)) {
        return [];
    }

    return jsonArray
        .map(jsonObj => deserializeAnimation(jsonObj))
        .filter(anim => anim !== null);
}

/**
 * Deserialize complete animation config from JSON
 * Restores all slides' animations to proper structure
 * @param {Object} jsonObj - Complete serialized animation config
 * @returns {Object} Animation data ready to apply to slides
 */
function deserializeSlidesAnimations(jsonObj) {
    if (!jsonObj || typeof jsonObj !== "object") {
        return { slides: [] };
    }

    const slidesData = [];

    if (Array.isArray(jsonObj.slides)) {
        for (const slideData of jsonObj.slides) {
            const slide = {
                id: slideData.id || "",
                animations: [],
                autoAnimate: slideData.autoAnimate || false,
                laggedStart: slideData.laggedStart || false,
                laggedStartDelay: slideData.laggedStartDelay || 50,
            };

            // Deserialize element animations
            if (Array.isArray(slideData.animations)) {
                for (const elementAnimData of slideData.animations) {
                    const elementData = {
                        elementId: elementAnimData.elementId || "",
                        elementType: elementAnimData.elementType || "shape",
                        animations: [],
                    };

                    if (Array.isArray(elementAnimData.animations)) {
                        elementData.animations = deserializeElementTimeline(elementAnimData.animations);
                    }

                    slide.animations.push(elementData);
                }
            }

            slidesData.push(slide);
        }
    }

    return { slides: slidesData };
}

/**
 * Export animations to JSON string
 * @param {Array} slides - Array of slide objects
 * @returns {string} JSON string of serialized animations
 */
function exportAnimationsToJSON(slides) {
    const animationData = serializeSlidesAnimations(slides);
    return JSON.stringify(animationData, null, 2);
}

/**
 * Import animations from JSON string
 * Applies to slide structure and returns update data
 * @param {string} jsonString - JSON string of animations
 * @returns {Object} Deserialized animation data
 */
function importAnimationsFromJSON(jsonString) {
    try {
        const jsonObj = JSON.parse(jsonString);
        return deserializeSlidesAnimations(jsonObj);
    } catch (error) {
        console.error("Failed to import animations from JSON:", error);
        return { slides: [], error: error.message };
    }
}

/**
 * Validate animation JSON schema
 * Checks that JSON follows expected structure
 * @param {Object} jsonObj - JSON object to validate
 * @returns {Object} Validation result with isValid and errors array
 */
function validateAnimationJSON(jsonObj) {
    const errors = [];

    if (!jsonObj || typeof jsonObj !== "object") {
        errors.push("Root must be an object");
        return { isValid: false, errors };
    }

    if (jsonObj.metadata && typeof jsonObj.metadata === "object") {
        if (jsonObj.metadata.version && typeof jsonObj.metadata.version !== "string") {
            errors.push("metadata.version must be a string");
        }
    }

    if (!Array.isArray(jsonObj.slides)) {
        errors.push("slides must be an array");
        return { isValid: false, errors };
    }

    for (let i = 0; i < jsonObj.slides.length; i++) {
        const slide = jsonObj.slides[i];

        if (typeof slide !== "object") {
            errors.push(`slides[${i}] must be an object`);
            continue;
        }

        if (!slide.id || typeof slide.id !== "string") {
            errors.push(`slides[${i}].id must be a non-empty string`);
        }

        if (!Array.isArray(slide.animations)) {
            errors.push(`slides[${i}].animations must be an array`);
            continue;
        }

        for (let j = 0; j < slide.animations.length; j++) {
            const elementAnimData = slide.animations[j];

            if (typeof elementAnimData !== "object") {
                errors.push(`slides[${i}].animations[${j}] must be an object`);
                continue;
            }

            if (!Array.isArray(elementAnimData.animations)) {
                errors.push(`slides[${i}].animations[${j}].animations must be an array`);
                continue;
            }

            for (let k = 0; k < elementAnimData.animations.length; k++) {
                const anim = elementAnimData.animations[k];

                if (typeof anim !== "object") {
                    errors.push(
                        `slides[${i}].animations[${j}].animations[${k}] must be an object`
                    );
                    continue;
                }

                if (!anim.type || typeof anim.type !== "string") {
                    errors.push(
                        `slides[${i}].animations[${j}].animations[${k}].type must be a non-empty string`
                    );
                }

                if (anim.duration !== undefined && typeof anim.duration !== "number") {
                    errors.push(
                        `slides[${i}].animations[${j}].animations[${k}].duration must be a number`
                    );
                }

                if (anim.delay !== undefined && typeof anim.delay !== "number") {
                    errors.push(
                        `slides[${i}].animations[${j}].animations[${k}].delay must be a number`
                    );
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Merge imported animations with existing slides
 * Handles conflict resolution (skip, replace, prepend to timeline)
 * @param {Array} slides - Existing slides
 * @param {Object} importedData - Deserialized animation data from import
 * @param {string} conflictStrategy - 'skip' | 'replace' | 'prepend' (default: 'replace')
 * @returns {Array} Updated slides with merged animations
 */
function mergeAnimations(slides, importedData, conflictStrategy = "replace") {
    if (!Array.isArray(slides) || !importedData || !Array.isArray(importedData.slides)) {
        return slides;
    }

    const updatedSlides = JSON.parse(JSON.stringify(slides)); // Deep clone

    const importedMap = new Map(importedData.slides.map(s => [s.id, s]));

    for (let i = 0; i < updatedSlides.length; i++) {
        const slide = updatedSlides[i];
        const importedSlide = importedMap.get(slide.id);

        if (!importedSlide) continue;

        // Merge slide-level animation config
        if (importedSlide.autoAnimate !== undefined) {
            if (!slide.animation) {
                slide.animation = {};
            }
            slide.animation.autoAnimate = importedSlide.autoAnimate;
        }
        if (importedSlide.laggedStart !== undefined) {
            if (!slide.animation) {
                slide.animation = {};
            }
            slide.animation.laggedStart = importedSlide.laggedStart;
        }
        if (importedSlide.laggedStartDelay !== undefined) {
            if (!slide.animation) {
                slide.animation = {};
            }
            slide.animation.laggedStartDelay = importedSlide.laggedStartDelay;
        }

        // Merge element animations
        if (!Array.isArray(slide.elements)) {
            slide.elements = [];
        }

        for (const importedElementData of importedSlide.animations) {
            const element = slide.elements.find(el => el.id === importedElementData.elementId);

            if (!element) {
                console.warn(
                    `Element ${importedElementData.elementId} not found in slide ${slide.id}`
                );
                continue;
            }

            if (!element.animation) {
                element.animation = {};
            }

            // Initialize timelines if needed
            if (!Array.isArray(element.animation.timelines)) {
                element.animation.timelines = [];
            }

            // Handle conflict based on strategy
            if (conflictStrategy === "skip" && element.animation.timelines.length > 0) {
                continue;
            } else if (conflictStrategy === "replace") {
                element.animation.timelines = [];
            }
            // For 'prepend', we'll add to the beginning

            // Create timeline and add animations
            const timeline = {
                elementId: element.id,
                animations: importedElementData.animations,
                totalDuration: importedElementData.animations.length > 0
                    ? Math.max(
                        ...importedElementData.animations.map(a =>
                            (a.startTime || 0) + (a.duration || 0)
                        )
                    )
                    : 0,
            };

            if (conflictStrategy === "prepend") {
                element.animation.timelines.unshift(timeline);
            } else {
                element.animation.timelines.push(timeline);
            }
        }
    }

    return updatedSlides;
}

/**
 * Create preset animation export
 * Exports standard preset animations for quick reference
 * @returns {Object} Preset animations JSON
 */
function createAnimationPresetsExport() {
    return {
        presets: [
            {
                name: "Fade In",
                type: "fadeIn",
                duration: 500,
                delay: 0,
                easing: "easeOut",
            },
            {
                name: "Fade Out",
                type: "fadeOut",
                duration: 500,
                delay: 0,
                easing: "easeOut",
            },
            {
                name: "Scale In",
                type: "scaleInPlace",
                duration: 600,
                delay: 0,
                easing: "easeOut",
                startScale: 0.8,
                endScale: 1,
            },
            {
                name: "Rotate",
                type: "rotate",
                duration: 800,
                delay: 0,
                easing: "easeInOut",
                rotation: 360,
            },
            {
                name: "Create",
                type: "create",
                duration: 1000,
                delay: 0,
                easing: "easeOut",
            },
            {
                name: "Write",
                type: "write",
                duration: 2000,
                delay: 0,
                easing: "linear",
            },
        ],
    };
}

/**
 * Compact JSON export - minimal version with defaults removed
 * Reduces file size while preserving all necessary data
 * @param {Array} slides - Array of slide objects
 * @returns {string} Compact JSON string
 */
function exportAnimationsCompact(slides) {
    const fullData = serializeSlidesAnimations(slides);

    // Remove default values to reduce size
    const compact = {
        slides: fullData.slides.map(slide => {
            const compactSlide = { id: slide.id };

            if (slide.autoAnimate) compactSlide.a = true;
            if (slide.laggedStart) compactSlide.l = true;
            if (slide.laggedStartDelay && slide.laggedStartDelay !== 50) compactSlide.ld = slide.laggedStartDelay;

            if (slide.animations.length > 0) {
                compactSlide.e = slide.animations.map(elemAnimData => {
                    const compactElem = { id: elemAnimData.elementId };

                    if (elemAnimData.animations.length > 0) {
                        compactElem.a = elemAnimData.animations.map(anim => {
                            const compactAnim = {
                                t: anim.type,
                                d: anim.duration || 600,
                            };

                            if (anim.delay) compactAnim.dl = anim.delay;
                            if (anim.easing && anim.easing !== "easeOut") compactAnim.e = anim.easing;
                            if (anim.startTime) compactAnim.s = anim.startTime;
                            if (anim.repeatCount) compactAnim.rc = anim.repeatCount;
                            if (anim.repeatDelay) compactAnim.rd = anim.repeatDelay;
                            if (anim.autoReverse) compactAnim.ar = true;

                            // Type-specific compact props
                            if (anim.startScale !== undefined) compactAnim.ss = anim.startScale;
                            if (anim.startOpacity !== undefined) compactAnim.so = anim.startOpacity;
                            if (anim.endScale !== undefined) compactAnim.es = anim.endScale;
                            if (anim.endOpacity !== undefined) compactAnim.eo = anim.endOpacity;
                            if (anim.rotation !== undefined) compactAnim.r = anim.rotation;
                            if (anim.path) compactAnim.p = anim.path;

                            return compactAnim;
                        });
                    }

                    return compactElem;
                });
            }

            return compactSlide;
        }),
    };

    return JSON.stringify(compact);
}

/**
 * Expand compact JSON back to full format
 * @param {string} compactJson - Compact JSON string
 * @returns {Object} Full animation data
 */
function importAnimationsCompact(compactJson) {
    try {
        const compact = JSON.parse(compactJson);

        const fullData = {
            slides: compact.slides.map(slide => {
                const fullSlide = {
                    id: slide.id,
                    autoAnimate: slide.a || false,
                    laggedStart: slide.l || false,
                    laggedStartDelay: slide.ld || 50,
                    animations: [],
                };

                if (Array.isArray(slide.e)) {
                    fullSlide.animations = slide.e.map(elem => {
                        const fullElem = {
                            elementId: elem.id,
                            elementType: "shape",
                            animations: [],
                        };

                        if (Array.isArray(elem.a)) {
                            fullElem.animations = elem.a.map(anim => {
                                const fullAnim = {
                                    type: anim.t,
                                    duration: anim.d || 600,
                                    delay: anim.dl || 0,
                                    easing: anim.e || "easeOut",
                                    startTime: anim.s || 0,
                                };

                                if (anim.rc) fullAnim.repeatCount = anim.rc;
                                if (anim.rd) fullAnim.repeatDelay = anim.rd;
                                if (anim.ar) fullAnim.autoReverse = true;
                                if (anim.ss !== undefined) fullAnim.startScale = anim.ss;
                                if (anim.so !== undefined) fullAnim.startOpacity = anim.so;
                                if (anim.es !== undefined) fullAnim.endScale = anim.es;
                                if (anim.eo !== undefined) fullAnim.endOpacity = anim.eo;
                                if (anim.r !== undefined) fullAnim.rotation = anim.r;
                                if (anim.p) fullAnim.path = anim.p;

                                return fullAnim;
                            });
                        }

                        return fullElem;
                    });
                }

                return fullSlide;
            }),
        };

        return deserializeSlidesAnimations(fullData);
    } catch (error) {
        console.error("Failed to import compact animations:", error);
        return { slides: [], error: error.message };
    }
}

/**
 * Public API for animation export/import
 */
window.AnimationExporter = {
    // Serialization
    serializeAnimation,
    serializeElementTimeline,
    serializeSlidesAnimations,
    exportAnimationsToJSON,
    exportAnimationsCompact,

    // Deserialization
    deserializeAnimation,
    deserializeElementTimeline,
    deserializeSlidesAnimations,
    importAnimationsFromJSON,
    importAnimationsCompact,

    // Utilities
    validateAnimationJSON,
    mergeAnimations,
    createAnimationPresetsExport,

    // Helper to download JSON file
    downloadAnimationsJSON(slides, filename = "animations.json") {
        const json = this.exportAnimationsToJSON(slides);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // Helper to upload and import JSON file
    uploadAnimationsJSON(callback) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const imported = this.importAnimationsFromJSON(event.target.result);
                    if (callback) {
                        callback(imported);
                    }
                } catch (err) {
                    console.error("Failed to load animations file:", err);
                    if (callback) {
                        callback({ error: err.message });
                    }
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },
};
