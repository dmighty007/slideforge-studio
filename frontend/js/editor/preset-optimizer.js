/**
 * PRESET OPTIMIZATION & ORGANIZATION SYSTEM
 * Organizes slide presets and provides smart recommendations
 * for smooth and professional user experience
 */

/* ─── Preset Categorization ────────────────────────────────────────────── */

const PRESET_CATEGORIES = {
    opening: {
        name: "Opening Slides",
        description: "Start your presentation with impact",
        icon: "fa-solid fa-play",
        order: 1,
        presets: ["title-page"],
    },
    content: {
        name: "Content Slides",
        description: "Main presentation content layouts",
        icon: "fa-solid fa-file-lines",
        order: 2,
        presets: ["content-slide", "blank-titled", "two-column"],
    },
    data: {
        name: "Data & Metrics",
        description: "Showcase numbers, charts, and data",
        icon: "fa-solid fa-chart-bar",
        order: 3,
        presets: ["results-data", "big-number", "comparison-table"],
    },
    visual: {
        name: "Visual Content",
        description: "Layouts optimized for images and visuals",
        icon: "fa-solid fa-image",
        order: 4,
        presets: ["image-grid", "figure-caption"],
    },
    narrative: {
        name: "Narrative Elements",
        description: "Tell your story with compelling layouts",
        icon: "fa-solid fa-book",
        order: 5,
        presets: ["quote-slide", "problem-solution", "timeline-slide"],
    },
    structure: {
        name: "Section Dividers",
        description: "Organize sections and transitions",
        icon: "fa-solid fa-bars",
        order: 6,
        presets: ["section-divider"],
    },
    closing: {
        name: "Closing Slides",
        description: "End with a strong impression",
        icon: "fa-solid fa-flag-checkered",
        order: 7,
        presets: ["thank-you"],
    },
};

const PRESET_DIFFICULTY = {
    "title-page": "beginner",
    "content-slide": "beginner",
    "blank-titled": "beginner",
    "thank-you": "beginner",
    "section-divider": "beginner",
    "quote-slide": "beginner",
    "two-column": "beginner",
    "big-number": "intermediate",
    "figure-caption": "intermediate",
    "image-grid": "intermediate",
    "results-data": "intermediate",
    "comparison-table": "intermediate",
    "problem-solution": "intermediate",
    "timeline-slide": "advanced",
    "cards-grid": "advanced",
};

const PRESET_USE_CASES = {
    "title-page": ["corporate", "academic", "creative", "educational"],
    "content-slide": ["corporate", "academic", "educational"],
    "blank-titled": ["creative", "portfolio", "minimal"],
    "two-column": ["corporate", "academic", "comparison"],
    "big-number": ["corporate", "data-focused", "metric-showcase"],
    "figure-caption": ["academic", "research", "visual"],
    "image-grid": ["creative", "portfolio", "visual"],
    "results-data": ["corporate", "academic", "research"],
    "comparison-table": ["corporate", "academic", "decision-making"],
    "problem-solution": ["corporate", "consulting", "educational"],
    "quote-slide": ["corporate", "creative", "motivational"],
    "timeline-slide": ["corporate", "academic", "historical", "process"],
    "section-divider": ["corporate", "academic", "all"],
    "thank-you": ["corporate", "academic", "all"],
    "cards-grid": ["creative", "portfolio", "gallery"],
};

/* ─── Preset Recommendations Engine ────────────────────────────────────── */

function _getRecommendedPresets(theme, useCase, difficulty = "all") {
    const candidates = Object.entries(PRESET_CATEGORIES).flatMap(([, category]) => category.presets);

    return candidates.filter(presetId => {
        const presetUC = PRESET_USE_CASES[presetId] || [];
        const presetDiff = PRESET_DIFFICULTY[presetId];

        const useCaseMatch = presetUC.includes(useCase);
        const difficultyMatch = difficulty === "all" || presetDiff === difficulty;

        return useCaseMatch && difficultyMatch;
    });
}

function _getPresetsByCategory(categoryId) {
    return PRESET_CATEGORIES[categoryId]?.presets || [];
}

function _getCategoryByPreset(presetId) {
    return Object.entries(PRESET_CATEGORIES).find(([, cat]) => cat.presets.includes(presetId))?.[0] || null;
}

function _getAllPresetsOrganized() {
    return Object.entries(PRESET_CATEGORIES).map(([id, category]) => ({
        ...category,
        id,
        presets: category.presets.map(presetId => ({
            id: presetId,
            difficulty: PRESET_DIFFICULTY[presetId],
            useCases: PRESET_USE_CASES[presetId],
        })),
    }));
}

/* ─── Preset Quality Metrics ────────────────────────────────────────────── */

const PRESET_QUALITY_METRICS = {
    "title-page": { versatility: 0.95, impact: 1.0, usability: 0.95 },
    "content-slide": { versatility: 1.0, impact: 0.7, usability: 1.0 },
    "blank-titled": { versatility: 0.8, impact: 0.5, usability: 0.9 },
    "two-column": { versatility: 0.9, impact: 0.8, usability: 0.85 },
    "big-number": { versatility: 0.7, impact: 0.95, usability: 0.8 },
    "figure-caption": { versatility: 0.8, impact: 0.9, usability: 0.85 },
    "image-grid": { versatility: 0.85, impact: 0.95, usability: 0.8 },
    "results-data": { versatility: 0.8, impact: 0.9, usability: 0.75 },
    "comparison-table": { versatility: 0.75, impact: 0.85, usability: 0.8 },
    "problem-solution": { versatility: 0.85, impact: 0.9, usability: 0.8 },
    "quote-slide": { versatility: 0.7, impact: 0.95, usability: 0.9 },
    "timeline-slide": { versatility: 0.7, impact: 0.9, usability: 0.7 },
    "section-divider": { versatility: 0.6, impact: 0.9, usability: 0.95 },
    "thank-you": { versatility: 0.8, impact: 0.85, usability: 0.95 },
    "cards-grid": { versatility: 0.75, impact: 0.85, usability: 0.7 },
};

function _getPresetQualityScore(presetId) {
    const metrics = PRESET_QUALITY_METRICS[presetId] || { versatility: 0.7, impact: 0.7, usability: 0.7 };
    return (metrics.versatility + metrics.impact + metrics.usability) / 3;
}

function _rankPresetsByQuality(presetIds) {
    return presetIds.sort((a, b) => _getPresetQualityScore(b) - _getPresetQualityScore(a));
}

/* ─── Smart Preset Suggestions ──────────────────────────────────────────── */

function _suggestNextPreset(currentPresetId, theme, useCase) {
    const category = _getCategoryByPreset(currentPresetId);
    const categoryOrder = PRESET_CATEGORIES[category]?.order || 0;

    // Find next category
    const nextCategory = Object.entries(PRESET_CATEGORIES)
        .filter(([, c]) => c.order > categoryOrder)
        .sort(([, a], [, b]) => a.order - b.order)[0];

    if (!nextCategory) return null;

    const candidates = nextCategory[1].presets;
    const recommended = candidates.filter(p => {
        const useCases = PRESET_USE_CASES[p] || [];
        return useCases.includes(useCase);
    });

    return _rankPresetsByQuality(recommended.length > 0 ? recommended : candidates)[0] || null;
}

function _getPresetSequence(firstPreset, theme, useCase, count = 5) {
    const sequence = [firstPreset];
    let current = firstPreset;

    for (let i = 1; i < count; i++) {
        const next = _suggestNextPreset(current, theme, useCase);
        if (next && !sequence.includes(next)) {
            sequence.push(next);
            current = next;
        }
    }

    return sequence;
}

/* ─── Preset Variant Management ────────────────────────────────────────── */

const PRESET_VARIANTS = {
    modern: {
        name: "Modern",
        description: "Contemporary style with clean layouts",
        icon: "fa-solid fa-sparkles",
    },
    science: {
        name: "Scientific",
        description: "Academic and research-focused style",
        icon: "fa-solid fa-flask",
    },
    classic: {
        name: "Classic",
        description: "Traditional, timeless style",
        icon: "fa-solid fa-book-open",
    },
};

function _getPresetVariants(presetId) {
    return Object.keys(PRESET_VARIANTS).map(variantId => ({
        id: variantId,
        ...PRESET_VARIANTS[variantId],
        presetId,
    }));
}

/* ─── Presentation Structure Generator ──────────────────────────────────── */

function _generatePresentationStructure(theme, useCase, pageCount = 10) {
    const structure = [];
    const recommended = _getRecommendedPresets(theme, useCase);

    // Opening
    structure.push({ preset: "title-page", title: "Title", notes: "Presentation title and authors" });

    // Content (distribute based on recommended presets)
    const contentPresets = recommended.filter(p => !["title-page", "thank-you", "section-divider"].includes(p));

    for (let i = 1; i < pageCount - 1; i++) {
        if (i % 4 === 0 && i > 0) {
            // Add section divider every 4 slides
            structure.push({ preset: "section-divider", title: "Section", notes: "Section break" });
        } else {
            const preset = contentPresets[i % contentPresets.length] || "content-slide";
            structure.push({
                preset,
                title: `Slide ${i}`,
                notes: `Add your content here`,
            });
        }
    }

    // Closing
    structure.push({ preset: "thank-you", title: "Thank You", notes: "Thank you slide" });

    return structure;
}

/* ─── Preset Performance Optimization ──────────────────────────────────── */

const PRESET_OPTIMIZATION_CACHE = {};

function _cachePresetRecommendation(theme, useCase, difficulty, presets) {
    const key = `${theme}:${useCase}:${difficulty}`;
    PRESET_OPTIMIZATION_CACHE[key] = presets;
}

function _getCachedPresetRecommendation(theme, useCase, difficulty) {
    const key = `${theme}:${useCase}:${difficulty}`;
    return PRESET_OPTIMIZATION_CACHE[key] || null;
}

function _clearPresetCache() {
    Object.keys(PRESET_OPTIMIZATION_CACHE).forEach(key => {
        delete PRESET_OPTIMIZATION_CACHE[key];
    });
}

/* ─── Export for use in other modules ──────────────────────────────────── */

window.PRESET_CATEGORIES = PRESET_CATEGORIES;
window.PRESET_DIFFICULTY = PRESET_DIFFICULTY;
window.PRESET_USE_CASES = PRESET_USE_CASES;
window.PRESET_QUALITY_METRICS = PRESET_QUALITY_METRICS;
window.PRESET_VARIANTS = PRESET_VARIANTS;

window._getRecommendedPresets = _getRecommendedPresets;
window._getPresetsByCategory = _getPresetsByCategory;
window._getCategoryByPreset = _getCategoryByPreset;
window._getAllPresetsOrganized = _getAllPresetsOrganized;
window._getPresetQualityScore = _getPresetQualityScore;
window._rankPresetsByQuality = _rankPresetsByQuality;
window._suggestNextPreset = _suggestNextPreset;
window._getPresetSequence = _getPresetSequence;
window._getPresetVariants = _getPresetVariants;
window._generatePresentationStructure = _generatePresentationStructure;
window._cachePresetRecommendation = _cachePresetRecommendation;
window._getCachedPresetRecommendation = _getCachedPresetRecommendation;
