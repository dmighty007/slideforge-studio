/**
 * THEME PERFORMANCE & OPTIMIZATION SYSTEM
 * Handles CSS variable caching, lazy loading, and performance optimization
 * for smooth rendering and quick theme switching
 */

/* ─── Theme CSS Variable Generator ──────────────────────────────────────── */

function _generateThemeCSSVariables(theme) {
    if (!theme || !theme.cssVars) return "";

    return Object.entries(theme.cssVars)
        .map(([key, value]) => `${key}: ${value};`)
        .join("\n");
}

function _applyThemeCSSVariables(theme, element = document.documentElement) {
    if (!theme || !theme.cssVars) return;

    Object.entries(theme.cssVars).forEach(([key, value]) => {
        element.style.setProperty(key, value);
    });
}

function _removeThemeCSSVariables(element = document.documentElement) {
    const cssVarKeys = Object.keys(THEME_METADATA).flatMap(themeId => {
        const theme = PRESENTATION_THEMES[themeId];
        return theme && theme.cssVars ? Object.keys(theme.cssVars) : [];
    });

    [...new Set(cssVarKeys)].forEach(key => {
        element.style.removeProperty(key);
    });
}

/* ─── Theme Caching System ──────────────────────────────────────────────── */

const THEME_CACHE = {
    cssVariables: {},
    computedStyles: {},
    fontCache: {},
    colorPalettes: {},
};

function _cacheThemeCSSVariables(themeId, cssVars) {
    THEME_CACHE.cssVariables[themeId] = cssVars;
}

function _getCachedThemeCSSVariables(themeId) {
    return THEME_CACHE.cssVariables[themeId] || null;
}

function _preloadThemeCSSVariables(themeIds = Object.keys(PRESENTATION_THEMES)) {
    themeIds.forEach(themeId => {
        const theme = PRESENTATION_THEMES[themeId];
        if (theme && theme.cssVars) {
            _cacheThemeCSSVariables(themeId, theme.cssVars);
        }
    });
}

function _clearThemeCache(themeId = null) {
    if (themeId) {
        delete THEME_CACHE.cssVariables[themeId];
        delete THEME_CACHE.computedStyles[themeId];
        delete THEME_CACHE.colorPalettes[themeId];
    } else {
        THEME_CACHE.cssVariables = {};
        THEME_CACHE.computedStyles = {};
        THEME_CACHE.colorPalettes = {};
    }
}

/* ─── Font Preloading & Optimization ────────────────────────────────────── */

const FONT_PRELOAD_CONFIG = {
    Inter: { weights: ["400", "500", "700"], display: "swap" },
    Roboto: { weights: ["400", "500", "700"], display: "swap" },
    Poppins: { weights: ["400", "500", "700"], display: "swap" },
    "DM Sans": { weights: ["400", "500", "700"], display: "swap" },
    Manrope: { weights: ["400", "500", "700"], display: "swap" },
    "Space Grotesk": { weights: ["400", "500", "700"], display: "swap" },
    Newsreader: { weights: ["400", "600", "700"], display: "swap" },
    "Playfair Display": { weights: ["400", "600", "700"], display: "swap" },
    Merriweather: { weights: ["400", "700"], display: "swap" },
};

function _generateFontPreloadLinks() {
    return "";
}

function _prefetchThemeFonts(themeIds = Object.keys(PRESENTATION_THEMES)) {
    themeIds.forEach(themeId => {
        const theme = PRESENTATION_THEMES[themeId];
        if (!theme) return;
        [theme.headingFont, theme.bodyFont].filter(Boolean).forEach(fontFamily => {
            const fontName = fontFamily.match(/"?([^",]+)/)?.[1];
            if (fontName) THEME_CACHE.fontCache[fontName] = true;
        });
    });
}

/* ─── Lazy Theme Loading ────────────────────────────────────────────────── */

const LAZY_THEME_LOADER = {
    loaded: new Set(),
    loading: new Set(),
};

async function _lazyLoadTheme(themeId) {
    if (LAZY_THEME_LOADER.loaded.has(themeId)) {
        return PRESENTATION_THEMES[themeId];
    }

    if (LAZY_THEME_LOADER.loading.has(themeId)) {
        // Wait for loading to complete
        return new Promise(resolve => {
            const interval = setInterval(() => {
                if (LAZY_THEME_LOADER.loaded.has(themeId)) {
                    clearInterval(interval);
                    resolve(PRESENTATION_THEMES[themeId]);
                }
            }, 10);
        });
    }

    LAZY_THEME_LOADER.loading.add(themeId);

    const theme = PRESENTATION_THEMES[themeId];
    if (theme && theme.cssVars) {
        _cacheThemeCSSVariables(themeId, theme.cssVars);
        _prefetchThemeFonts([themeId]);
    }

    LAZY_THEME_LOADER.loading.delete(themeId);
    LAZY_THEME_LOADER.loaded.add(themeId);

    return theme;
}

async function _batchLazyLoadThemes(themeIds) {
    return Promise.all(themeIds.map(id => _lazyLoadTheme(id)));
}

function _getLoadedThemes() {
    return Array.from(LAZY_THEME_LOADER.loaded);
}

/* ─── Theme Transition Optimization ────────────────────────────────────── */

function _createThemeTransition(fromTheme, toTheme, duration = 300) {
    return new Promise(resolve => {
        const element = document.documentElement;
        const transition = `all ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;

        element.style.transition = transition;
        _applyThemeCSSVariables(toTheme, element);

        setTimeout(() => {
            element.style.transition = "";
            resolve();
        }, duration);
    });
}

async function _switchThemeSmooth(themeId, duration = 300) {
    const theme = await _lazyLoadTheme(themeId);
    if (!theme) return false;

    const currentTheme = PRESENTATION_THEMES[Object.keys(PRESENTATION_THEMES)[0]];
    await _createThemeTransition(currentTheme, theme, duration);

    return true;
}

/* ─── Theme Prerendering System ────────────────────────────────────────── */

function _prerenderThemeStyles(themeId) {
    const theme = PRESENTATION_THEMES[themeId];
    if (!theme) return null;

    const style = document.createElement("style");
    style.id = `theme-prerender-${themeId}`;
    style.textContent = `
        :root.theme-${themeId} {
            ${_generateThemeCSSVariables(theme)}
        }

        .slide[data-theme="${themeId}"] {
            background: ${theme.cssVars["--slide-bg"]};
            color: ${theme.cssVars["--slide-fg"]};
        }
    `;

    return style;
}

function _prerenderAllThemeStyles() {
    const container = document.createElement("div");
    Object.keys(PRESENTATION_THEMES).forEach(themeId => {
        const style = _prerenderThemeStyles(themeId);
        if (style) container.appendChild(style);
    });
    return container;
}

function _injectPrerenderThemeStyles() {
    const fragment = _prerenderAllThemeStyles();
    document.head.appendChild(fragment);
}

/* ─── Theme Statistics & Analytics ──────────────────────────────────────── */

const THEME_USAGE_STATS = {};

function _recordThemeUsage(themeId) {
    if (!THEME_USAGE_STATS[themeId]) {
        THEME_USAGE_STATS[themeId] = { count: 0, lastUsed: null };
    }
    THEME_USAGE_STATS[themeId].count++;
    THEME_USAGE_STATS[themeId].lastUsed = new Date();
}

function _getMostUsedThemes(limit = 5) {
    return Object.entries(THEME_USAGE_STATS)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, limit)
        .map(([themeId]) => themeId);
}

function _getRecentlyUsedThemes(limit = 5) {
    return Object.entries(THEME_USAGE_STATS)
        .sort(([, a], [, b]) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0))
        .slice(0, limit)
        .map(([themeId]) => themeId);
}

/* ─── CSS Variable Optimization ────────────────────────────────────────── */

function _minifyCSSVariables(theme) {
    const vars = theme.cssVars || {};
    const minified = {};

    // Group related variables
    const groups = {
        "--slide-": ["bg", "fg", "muted", "accent", "accent-2", "grid"],
        "--editor-": ["accent", "accent-soft"],
    };

    Object.entries(vars).forEach(([key, value]) => {
        minified[key] = value;
    });

    return minified;
}

function _validateThemeCSSVariables(theme) {
    if (!theme || !theme.cssVars) return false;

    const requiredVars = ["--slide-bg", "--slide-fg", "--slide-accent"];
    return requiredVars.every(varName => theme.cssVars[varName] !== undefined);
}

/* ─── Export for use in other modules ──────────────────────────────────── */

window.THEME_CACHE = THEME_CACHE;
window.THEME_USAGE_STATS = THEME_USAGE_STATS;

window._generateThemeCSSVariables = _generateThemeCSSVariables;
window._applyThemeCSSVariables = _applyThemeCSSVariables;
window._removeThemeCSSVariables = _removeThemeCSSVariables;
window._cacheThemeCSSVariables = _cacheThemeCSSVariables;
window._getCachedThemeCSSVariables = _getCachedThemeCSSVariables;
window._preloadThemeCSSVariables = _preloadThemeCSSVariables;
window._clearThemeCache = _clearThemeCache;
window._generateFontPreloadLinks = _generateFontPreloadLinks;
window._prefetchThemeFonts = _prefetchThemeFonts;
window._lazyLoadTheme = _lazyLoadTheme;
window._batchLazyLoadThemes = _batchLazyLoadThemes;
window._getLoadedThemes = _getLoadedThemes;
window._createThemeTransition = _createThemeTransition;
window._switchThemeSmooth = _switchThemeSmooth;
window._prerenderThemeStyles = _prerenderThemeStyles;
window._injectPrerenderThemeStyles = _injectPrerenderThemeStyles;
window._recordThemeUsage = _recordThemeUsage;
window._getMostUsedThemes = _getMostUsedThemes;
window._getRecentlyUsedThemes = _getRecentlyUsedThemes;
window._minifyCSSVariables = _minifyCSSVariables;
window._validateThemeCSSVariables = _validateThemeCSSVariables;
