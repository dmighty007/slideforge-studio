
const FONT_FAMILIES = [
    '"Times New Roman", Times, serif',
    "Arial, sans-serif",
    '"Fraunces", serif',
    '"Newsreader", serif',
    '"Playfair Display", serif',
    '"Merriweather", serif',
    '"Lora", serif',
    '"Manrope", sans-serif',
    '"DM Sans", sans-serif',
    '"Work Sans", sans-serif',
    '"Space Grotesk", sans-serif',
    '"Montserrat", sans-serif',
    '"Poppins", sans-serif',
    '"Nunito", sans-serif',
    "Inter, sans-serif",
    "Roboto, sans-serif",
    "Oswald, sans-serif",
    '"Fredoka", sans-serif',
    '"Comic Neue", cursive',
    '"Caveat", cursive',
    '"Permanent Marker", cursive',
    '"Bangers", cursive',
    '"Shrikhand", cursive',
];

const FONT_MENU_OPTIONS = [
    { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
    { label: "Arial", value: "Arial, sans-serif" },
    { label: "Inter", value: "Inter, sans-serif" },
    { label: "Manrope", value: '"Manrope", sans-serif' },
    { label: "DM Sans", value: '"DM Sans", sans-serif' },
    { label: "Work Sans", value: '"Work Sans", sans-serif' },
    { label: "Space Grotesk", value: '"Space Grotesk", sans-serif' },
    { label: "Montserrat", value: '"Montserrat", sans-serif' },
    { label: "Poppins", value: '"Poppins", sans-serif' },
    { label: "Nunito", value: '"Nunito", sans-serif' },
    { label: "Fraunces", value: '"Fraunces", serif' },
    { label: "Newsreader", value: '"Newsreader", serif' },
    { label: "Playfair Display", value: '"Playfair Display", serif' },
    { label: "Merriweather", value: '"Merriweather", serif' },
    { label: "Lora", value: '"Lora", serif' },
    { label: "Fredoka", value: '"Fredoka", sans-serif' },
    { label: "Comic Neue", value: '"Comic Neue", cursive' },
    { label: "Caveat", value: '"Caveat", cursive' },
    { label: "Permanent Marker", value: '"Permanent Marker", cursive' },
    { label: "Bangers", value: '"Bangers", cursive' },
    { label: "Shrikhand", value: '"Shrikhand", cursive' },
];

function buildFontOptions(selectedFont = "") {
    const normalizedSelected = normalizeFontFamily(selectedFont);
    return FONT_MENU_OPTIONS.map(font => {
        const selected = normalizeFontFamily(font.value) === normalizedSelected ? "selected" : "";
        return `<option value="${escapeHtml(font.value)}" ${selected}>${escapeHtml(font.label)}</option>`;
    }).join("");
}

const PRESENTATION_THEMES = {
    editorial: {
        label: "Editorial",
        revealTheme: "white",
        headingFont: '"Newsreader", serif',
        bodyFont: '"Manrope", sans-serif',
        defaultTextColor: "#2E2E2E",
        defaultMutedColor: "#6B7280",
        defaultShapeColor: "#A7C7E7",
        accentStrong: "#3B82F6",
        accentSoft: "rgba(59, 130, 246, 0.12)",
        surfaceColor: "rgba(248, 250, 252, 0.88)",
        surfaceBorder: "rgba(209, 213, 219, 0.80)",
        cssVars: {
            "--slide-bg": "linear-gradient(135deg, rgba(59,130,246,0.07) 0 18%, transparent 18% 100%), linear-gradient(180deg, #FFFFFF 0%, #F6F8FB 56%, #EEF2F7 100%)",
            "--slide-fg": "#2E2E2E",
            "--slide-muted": "#6B7280",
            "--slide-accent": "#3B82F6",
            "--slide-accent-2": "#A7C7E7",
            "--slide-grid": "rgba(46,46,46,0.03)",
            "--editor-accent": "#3B82F6",
            "--editor-accent-soft": "rgba(59,130,246,0.12)",
        },
    },
    blueprint: {
        label: "Blueprint",
        revealTheme: "white",
        headingFont: '"Space Grotesk", sans-serif',
        bodyFont: '"DM Sans", sans-serif',
        defaultTextColor: "#10233b",
        defaultMutedColor: "#5f7287",
        defaultShapeColor: "#1d4ed8",
        accentStrong: "#2563eb",
        accentSoft: "rgba(37, 99, 235, 0.12)",
        surfaceColor: "rgba(255, 255, 255, 0.78)",
        surfaceBorder: "rgba(29, 78, 216, 0.12)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(135deg, rgba(37,99,235,0.10) 0 1px, transparent 1px 100%), repeating-linear-gradient(90deg, rgba(37,99,235,0.055) 0 1px, transparent 1px 64px), repeating-linear-gradient(0deg, rgba(37,99,235,0.050) 0 1px, transparent 1px 64px), linear-gradient(180deg, #fcfeff 0%, #f1f7fd 100%)",
            "--slide-fg": "#10233b",
            "--slide-muted": "#5f7287",
            "--slide-accent": "#2563eb",
            "--slide-accent-2": "#0f766e",
            "--slide-grid": "rgba(37,99,235,0.08)",
            "--editor-accent": "#2563eb",
            "--editor-accent-soft": "rgba(37,99,235,0.16)",
        },
    },
    fieldnotes: {
        label: "Field Notes",
        revealTheme: "white",
        headingFont: '"Fraunces", serif',
        bodyFont: '"Work Sans", sans-serif',
        defaultTextColor: "#2f261d",
        defaultMutedColor: "#6f6559",
        defaultShapeColor: "#5f7f52",
        accentStrong: "#7a8f47",
        accentSoft: "rgba(122, 143, 71, 0.12)",
        surfaceColor: "rgba(255, 249, 238, 0.72)",
        surfaceBorder: "rgba(47, 38, 29, 0.10)",
        cssVars: {
            "--slide-bg":
                "repeating-linear-gradient(0deg, rgba(47,38,29,0.035) 0 1px, transparent 1px 34px), linear-gradient(115deg, rgba(122,143,71,0.13) 0 26%, transparent 26% 100%), linear-gradient(180deg, #fbf6ea 0%, #efe4d0 100%)",
            "--slide-fg": "#2f261d",
            "--slide-muted": "#6f6559",
            "--slide-accent": "#7a8f47",
            "--slide-accent-2": "#b48a4a",
            "--slide-grid": "rgba(47,38,29,0.06)",
            "--editor-accent": "#7a8f47",
            "--editor-accent-soft": "rgba(122,143,71,0.16)",
        },
    },
    monograph: {
        label: "Monograph",
        revealTheme: "white",
        headingFont: '"Fraunces", serif',
        bodyFont: '"DM Sans", sans-serif',
        defaultTextColor: "#171717",
        defaultMutedColor: "#6b7280",
        defaultShapeColor: "#374151",
        accentStrong: "#1f2937",
        accentSoft: "rgba(31, 41, 55, 0.08)",
        surfaceColor: "rgba(255, 255, 255, 0.80)",
        surfaceBorder: "rgba(23, 23, 23, 0.10)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(90deg, rgba(23,23,23,0.055) 0 1px, transparent 1px 100%), linear-gradient(180deg, #FFFFFF 0%, #F8F8F7 48%, #ECEFF3 100%)",
            "--slide-fg": "#171717",
            "--slide-muted": "#6b7280",
            "--slide-accent": "#1f2937",
            "--slide-accent-2": "#9ca3af",
            "--slide-grid": "rgba(17,24,39,0.06)",
            "--editor-accent": "#1f2937",
            "--editor-accent-soft": "rgba(31,41,55,0.14)",
        },
    },
    graphite: {
        label: "Graphite",
        revealTheme: "black",
        headingFont: '"Manrope", sans-serif',
        bodyFont: '"Manrope", sans-serif',
        defaultTextColor: "#f5f7fb",
        defaultMutedColor: "#94a3b8",
        defaultShapeColor: "#38bdf8",
        accentStrong: "#22d3ee",
        accentSoft: "rgba(34, 211, 238, 0.14)",
        surfaceColor: "rgba(255, 255, 255, 0.06)",
        surfaceBorder: "rgba(226, 232, 240, 0.14)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(135deg, transparent 0 58%, rgba(34,211,238,0.10) 58% 59%, transparent 59% 100%), repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 72px), linear-gradient(155deg, #090E1A 0%, #111827 52%, #202938 100%)",
            "--slide-fg": "#f5f7fb",
            "--slide-muted": "#94a3b8",
            "--slide-accent": "#22d3ee",
            "--slide-accent-2": "#38bdf8",
            "--slide-grid": "rgba(255,255,255,0.05)",
            "--editor-accent": "#22d3ee",
            "--editor-accent-soft": "rgba(34,211,238,0.16)",
        },
    },
    horizon: {
        label: "Horizon",
        revealTheme: "black",
        headingFont: '"Montserrat", sans-serif',
        bodyFont: '"Space Grotesk", sans-serif',
        defaultTextColor: "#eef4ff",
        defaultMutedColor: "#afbdd6",
        defaultShapeColor: "#4f7cff",
        accentStrong: "#7dd3fc",
        accentSoft: "rgba(125, 211, 252, 0.14)",
        surfaceColor: "rgba(255, 255, 255, 0.07)",
        surfaceBorder: "rgba(238, 244, 255, 0.14)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(120deg, rgba(125,211,252,0.13) 0 1px, transparent 1px 34%), linear-gradient(180deg, #06111F 0%, #0B2442 54%, #153A66 100%)",
            "--slide-fg": "#eef4ff",
            "--slide-muted": "#afbdd6",
            "--slide-accent": "#7dd3fc",
            "--slide-accent-2": "#4f7cff",
            "--slide-grid": "rgba(255,255,255,0.05)",
            "--editor-accent": "#7dd3fc",
            "--editor-accent-soft": "rgba(125,211,252,0.16)",
        },
    },
    chalkboard: {
        label: "Chalkboard",
        revealTheme: "black",
        headingFont: '"Fraunces", serif',
        bodyFont: '"Work Sans", sans-serif',
        defaultTextColor: "#F8F3E7",
        defaultMutedColor: "#D4CBB7",
        defaultShapeColor: "#8ED1C7",
        accentStrong: "#F5D76E",
        accentSoft: "rgba(245, 215, 110, 0.16)",
        surfaceColor: "rgba(248, 243, 231, 0.07)",
        surfaceBorder: "rgba(248, 243, 231, 0.15)",
        cssVars: {
            "--slide-bg":
                "repeating-linear-gradient(-2deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 36px), linear-gradient(115deg, rgba(245,215,110,0.08) 0 24%, transparent 24% 100%), linear-gradient(180deg, #19362D 0%, #10261F 100%)",
            "--slide-fg": "#F8F3E7",
            "--slide-muted": "#D4CBB7",
            "--slide-accent": "#F5D76E",
            "--slide-accent-2": "#8ED1C7",
            "--slide-grid": "rgba(255,255,255,0.045)",
            "--editor-accent": "#F5D76E",
            "--editor-accent-soft": "rgba(245,215,110,0.18)",
        },
    },
    circuit: {
        label: "Circuit",
        revealTheme: "black",
        headingFont: '"Space Grotesk", sans-serif',
        bodyFont: '"DM Sans", sans-serif',
        defaultTextColor: "#ECF7F5",
        defaultMutedColor: "#9AB8B3",
        defaultShapeColor: "#1FB6A6",
        accentStrong: "#63E6D8",
        accentSoft: "rgba(99, 230, 216, 0.16)",
        surfaceColor: "rgba(236, 247, 245, 0.055)",
        surfaceBorder: "rgba(195, 236, 231, 0.14)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(90deg, rgba(99,230,216,0.11) 0 1px, transparent 1px 20%), repeating-linear-gradient(90deg, rgba(99,230,216,0.045) 0 1px, transparent 1px 76px), repeating-linear-gradient(0deg, rgba(99,230,216,0.040) 0 1px, transparent 1px 76px), linear-gradient(160deg, #061716 0%, #0A2320 54%, #123632 100%)",
            "--slide-fg": "#ECF7F5",
            "--slide-muted": "#9AB8B3",
            "--slide-accent": "#63E6D8",
            "--slide-accent-2": "#1FB6A6",
            "--slide-grid": "rgba(99,230,216,0.05)",
            "--editor-accent": "#63E6D8",
            "--editor-accent-soft": "rgba(99,230,216,0.18)",
        },
    },
    afterglow: {
        label: "Afterglow",
        revealTheme: "black",
        headingFont: '"Montserrat", sans-serif',
        bodyFont: '"Manrope", sans-serif',
        defaultTextColor: "#F5F7FF",
        defaultMutedColor: "#BDC4DE",
        defaultShapeColor: "#6E86FF",
        accentStrong: "#F3B76A",
        accentSoft: "rgba(243, 183, 106, 0.16)",
        surfaceColor: "rgba(245, 247, 255, 0.06)",
        surfaceBorder: "rgba(245, 247, 255, 0.14)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(135deg, rgba(243,183,106,0.13) 0 18%, transparent 18% 100%), linear-gradient(28deg, transparent 0 66%, rgba(110,134,255,0.14) 66% 100%), linear-gradient(160deg, #101421 0%, #1A2034 48%, #262542 100%)",
            "--slide-fg": "#F5F7FF",
            "--slide-muted": "#BDC4DE",
            "--slide-accent": "#F3B76A",
            "--slide-accent-2": "#6E86FF",
            "--slide-grid": "rgba(255,255,255,0.04)",
            "--editor-accent": "#F3B76A",
            "--editor-accent-soft": "rgba(243,183,106,0.18)",
        },
    },
    sage: {
        label: "Sage Calm",
        revealTheme: "white",
        headingFont: '"Lora", serif',
        bodyFont: '"Nunito", sans-serif',
        defaultTextColor: "#25342d",
        defaultMutedColor: "#68786e",
        defaultShapeColor: "#9bb89c",
        accentStrong: "#4f7d5a",
        accentSoft: "rgba(79, 125, 90, 0.14)",
        surfaceColor: "rgba(247, 250, 244, 0.78)",
        surfaceBorder: "rgba(79, 125, 90, 0.16)",
        cssVars: {
            "--slide-bg":
                "repeating-linear-gradient(0deg, rgba(79,125,90,0.032) 0 1px, transparent 1px 42px), linear-gradient(130deg, rgba(155,184,156,0.22) 0 24%, transparent 24% 100%), linear-gradient(180deg, #FCFCF4 0%, #EDF4E8 100%)",
            "--slide-fg": "#25342d",
            "--slide-muted": "#68786e",
            "--slide-accent": "#4f7d5a",
            "--slide-accent-2": "#b7a66c",
            "--slide-grid": "rgba(79,125,90,0.06)",
            "--editor-accent": "#4f7d5a",
            "--editor-accent-soft": "rgba(79,125,90,0.16)",
        },
    },
    porcelain: {
        label: "Porcelain",
        revealTheme: "white",
        headingFont: '"Playfair Display", serif',
        bodyFont: '"Poppins", sans-serif',
        defaultTextColor: "#233047",
        defaultMutedColor: "#6c7890",
        defaultShapeColor: "#b8d9e8",
        accentStrong: "#477ca4",
        accentSoft: "rgba(71, 124, 164, 0.13)",
        surfaceColor: "rgba(255, 255, 255, 0.74)",
        surfaceBorder: "rgba(71, 124, 164, 0.14)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(145deg, rgba(184,217,232,0.24) 0 28%, transparent 28% 100%), linear-gradient(35deg, transparent 0 72%, rgba(192,131,147,0.16) 72% 100%), linear-gradient(180deg, #FFFFFF 0%, #EEF7F9 100%)",
            "--slide-fg": "#233047",
            "--slide-muted": "#6c7890",
            "--slide-accent": "#477ca4",
            "--slide-accent-2": "#c08393",
            "--slide-grid": "rgba(71,124,164,0.05)",
            "--editor-accent": "#477ca4",
            "--editor-accent-soft": "rgba(71,124,164,0.16)",
        },
    },
    rosewater: {
        label: "Rosewater",
        revealTheme: "white",
        headingFont: '"Playfair Display", serif',
        bodyFont: '"Manrope", sans-serif',
        defaultTextColor: "#3a2b32",
        defaultMutedColor: "#7f6b72",
        defaultShapeColor: "#e8bdc3",
        accentStrong: "#b76e79",
        accentSoft: "rgba(183, 110, 121, 0.13)",
        surfaceColor: "rgba(255, 247, 247, 0.76)",
        surfaceBorder: "rgba(183, 110, 121, 0.16)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(120deg, rgba(183,110,121,0.12) 0 22%, transparent 22% 100%), linear-gradient(35deg, transparent 0 70%, rgba(170,134,80,0.14) 70% 100%), linear-gradient(180deg, #FFFDFC 0%, #F7E7E4 100%)",
            "--slide-fg": "#3a2b32",
            "--slide-muted": "#7f6b72",
            "--slide-accent": "#b76e79",
            "--slide-accent-2": "#aa8650",
            "--slide-grid": "rgba(183,110,121,0.05)",
            "--editor-accent": "#b76e79",
            "--editor-accent-soft": "rgba(183,110,121,0.16)",
        },
    },
    buttercup: {
        label: "Buttercup",
        revealTheme: "white",
        headingFont: '"Fredoka", sans-serif',
        bodyFont: '"Nunito", sans-serif',
        defaultTextColor: "#332b15",
        defaultMutedColor: "#756c4c",
        defaultShapeColor: "#f6d56f",
        accentStrong: "#d59d20",
        accentSoft: "rgba(213, 157, 32, 0.15)",
        surfaceColor: "rgba(255, 252, 238, 0.78)",
        surfaceBorder: "rgba(213, 157, 32, 0.18)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(135deg, rgba(246,213,111,0.28) 0 24%, transparent 24% 100%), repeating-linear-gradient(90deg, rgba(213,157,32,0.035) 0 1px, transparent 1px 58px), linear-gradient(180deg, #FFFCF0 0%, #F5EBC5 100%)",
            "--slide-fg": "#332b15",
            "--slide-muted": "#756c4c",
            "--slide-accent": "#d59d20",
            "--slide-accent-2": "#5f9f76",
            "--slide-grid": "rgba(213,157,32,0.06)",
            "--editor-accent": "#d59d20",
            "--editor-accent-soft": "rgba(213,157,32,0.18)",
        },
    },
    tidepool: {
        label: "Tidepool",
        revealTheme: "white",
        headingFont: '"Space Grotesk", sans-serif',
        bodyFont: '"DM Sans", sans-serif',
        defaultTextColor: "#17323a",
        defaultMutedColor: "#5f7880",
        defaultShapeColor: "#79c8c5",
        accentStrong: "#168b8b",
        accentSoft: "rgba(22, 139, 139, 0.14)",
        surfaceColor: "rgba(243, 252, 251, 0.76)",
        surfaceBorder: "rgba(22, 139, 139, 0.15)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(140deg, rgba(121,200,197,0.24) 0 25%, transparent 25% 100%), repeating-linear-gradient(0deg, rgba(22,139,139,0.035) 0 1px, transparent 1px 46px), linear-gradient(180deg, #F7FCFC 0%, #E4F4F3 100%)",
            "--slide-fg": "#17323a",
            "--slide-muted": "#5f7880",
            "--slide-accent": "#168b8b",
            "--slide-accent-2": "#4b8fc5",
            "--slide-grid": "rgba(22,139,139,0.06)",
            "--editor-accent": "#168b8b",
            "--editor-accent-soft": "rgba(22,139,139,0.16)",
        },
    },
    lavender: {
        label: "Lavender Mist",
        revealTheme: "white",
        headingFont: '"Merriweather", serif',
        bodyFont: '"Poppins", sans-serif',
        defaultTextColor: "#302c45",
        defaultMutedColor: "#756f8d",
        defaultShapeColor: "#c9bee8",
        accentStrong: "#7d6bb3",
        accentSoft: "rgba(125, 107, 179, 0.14)",
        surfaceColor: "rgba(250, 248, 255, 0.76)",
        surfaceBorder: "rgba(125, 107, 179, 0.15)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(145deg, rgba(201,190,232,0.26) 0 26%, transparent 26% 100%), linear-gradient(35deg, transparent 0 72%, rgba(207,138,114,0.16) 72% 100%), linear-gradient(180deg, #FCFBFF 0%, #EFEAF8 100%)",
            "--slide-fg": "#302c45",
            "--slide-muted": "#756f8d",
            "--slide-accent": "#7d6bb3",
            "--slide-accent-2": "#cf8a72",
            "--slide-grid": "rgba(125,107,179,0.05)",
            "--editor-accent": "#7d6bb3",
            "--editor-accent-soft": "rgba(125,107,179,0.16)",
        },
    },
    midnightGarden: {
        label: "Midnight Garden",
        revealTheme: "black",
        headingFont: '"Lora", serif',
        bodyFont: '"Manrope", sans-serif',
        defaultTextColor: "#eff7ed",
        defaultMutedColor: "#b7c9b7",
        defaultShapeColor: "#5faf79",
        accentStrong: "#9ae6b4",
        accentSoft: "rgba(154, 230, 180, 0.14)",
        surfaceColor: "rgba(239, 247, 237, 0.07)",
        surfaceBorder: "rgba(154, 230, 180, 0.16)",
        cssVars: {
            "--slide-bg":
                "linear-gradient(135deg, rgba(154,230,180,0.12) 0 24%, transparent 24% 100%), repeating-linear-gradient(90deg, rgba(239,247,237,0.030) 0 1px, transparent 1px 62px), linear-gradient(155deg, #07130E 0%, #10231A 52%, #183826 100%)",
            "--slide-fg": "#eff7ed",
            "--slide-muted": "#b7c9b7",
            "--slide-accent": "#9ae6b4",
            "--slide-accent-2": "#5faf79",
            "--slide-grid": "rgba(239,247,237,0.045)",
            "--editor-accent": "#9ae6b4",
            "--editor-accent-soft": "rgba(154,230,180,0.18)",
        },
    },
    retroPop: {
        label: "Retro Pop",
        revealTheme: "white",
        headingFont: '"Bangers", cursive',
        bodyFont: '"Comic Neue", cursive',
        defaultTextColor: "#28212a",
        defaultMutedColor: "#745f76",
        defaultShapeColor: "#ffcf5a",
        accentStrong: "#ef476f",
        accentSoft: "rgba(239, 71, 111, 0.14)",
        surfaceColor: "rgba(255, 250, 240, 0.80)",
        surfaceBorder: "rgba(239, 71, 111, 0.18)",
        cssVars: {
            "--slide-bg":
                "repeating-linear-gradient(-8deg, rgba(239,71,111,0.08) 0 2px, transparent 2px 28px), linear-gradient(135deg, rgba(255,207,90,0.34) 0 28%, transparent 28% 100%), linear-gradient(180deg, #FFF9EA 0%, #FFE7DF 100%)",
            "--slide-fg": "#28212a",
            "--slide-muted": "#745f76",
            "--slide-accent": "#ef476f",
            "--slide-accent-2": "#06d6a0",
            "--slide-grid": "rgba(239,71,111,0.06)",
            "--editor-accent": "#ef476f",
            "--editor-accent-soft": "rgba(239,71,111,0.18)",
        },
    },
};

const THEME_SYSTEM_FAMILIES = {
    editorial: {
        family: "editorial",
        tone: "editorial",
        bestFor: ["narrative decks", "essays", "conference talks"],
        density: "standard",
    },
    blueprint: {
        family: "scientific",
        tone: "technical",
        bestFor: ["technical explainers", "systems diagrams", "engineering talks"],
        density: "expert",
    },
    fieldnotes: {
        family: "editorial",
        tone: "research",
        bestFor: ["field research", "teaching", "qualitative synthesis"],
        density: "standard",
    },
    monograph: {
        family: "editorial",
        tone: "formal",
        bestFor: ["academic essays", "policy decks", "publication-style talks"],
        density: "spacious",
    },
    graphite: {
        family: "corporate",
        tone: "executive",
        bestFor: ["product strategy", "technical roadmaps", "board updates"],
        density: "standard",
    },
    horizon: {
        family: "cinematic",
        tone: "cinematic",
        bestFor: ["keynotes", "launch talks", "vision narratives"],
        density: "spacious",
    },
    chalkboard: {
        family: "teaching",
        tone: "technical",
        bestFor: ["lectures", "derivations", "workshops"],
        density: "standard",
    },
    circuit: {
        family: "scientific",
        tone: "technical",
        bestFor: ["AI/ML", "systems biology", "network diagrams"],
        density: "expert",
    },
    afterglow: {
        family: "cinematic",
        tone: "cinematic",
        bestFor: ["research highlights", "product demos", "closing sections"],
        density: "standard",
    },
    sage: {
        family: "scientific",
        tone: "research",
        bestFor: ["biology", "ecology", "clinical research"],
        density: "standard",
    },
    porcelain: {
        family: "corporate",
        tone: "formal",
        bestFor: ["executive briefings", "consulting decks", "reports"],
        density: "spacious",
    },
    rosewater: {
        family: "editorial",
        tone: "editorial",
        bestFor: ["creative reviews", "brand narratives", "portfolio talks"],
        density: "standard",
    },
    buttercup: {
        family: "conference",
        tone: "warm",
        bestFor: ["teaching", "workshops", "friendly explainers"],
        density: "standard",
    },
    tidepool: {
        family: "scientific",
        tone: "research",
        bestFor: ["ocean science", "biology", "technical storytelling"],
        density: "standard",
    },
    lavender: {
        family: "editorial",
        tone: "calm",
        bestFor: ["research narratives", "portfolio talks", "design reviews"],
        density: "spacious",
    },
    midnightGarden: {
        family: "scientific",
        tone: "technical",
        bestFor: ["molecular science", "simulation", "conference results"],
        density: "expert",
    },
    retroPop: {
        family: "conference",
        tone: "expressive",
        bestFor: ["workshops", "lightning talks", "creative education"],
        density: "compact",
    },
};

function _themeHexToRgb(hex) {
    const raw = String(hex || "").match(/^#([0-9a-f]{6})$/i)?.[1];
    if (!raw) return null;
    return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
    };
}

function _themeRelativeLuminance(hex) {
    const rgb = _themeHexToRgb(hex);
    if (!rgb) return 0.5;
    return ["r", "g", "b"]
        .map(key => rgb[key] / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
        .reduce((sum, v, index) => sum + v * [0.2126, 0.7152, 0.0722][index], 0);
}

function buildThemeDesignSystem(themeId, theme) {
    const profile = THEME_SYSTEM_FAMILIES[themeId] || THEME_SYSTEM_FAMILIES.editorial;
    const isDark = _themeRelativeLuminance(theme.defaultTextColor) > 0.72;
    const densityScale =
        profile.density === "expert"
            ? { slidePadding: 48, regionGap: 18, bodySize: 20, captionSize: 12 }
            : profile.density === "compact"
              ? { slidePadding: 44, regionGap: 16, bodySize: 21, captionSize: 12 }
              : profile.density === "spacious"
                ? { slidePadding: 82, regionGap: 34, bodySize: 23, captionSize: 14 }
                : { slidePadding: 64, regionGap: 24, bodySize: 22, captionSize: 13 };

    return {
        id: themeId,
        label: theme.label || themeId,
        family: profile.family,
        intent: {
            tone: profile.tone,
            bestFor: profile.bestFor,
            audience: profile.family === "scientific" ? ["scientific", "technical"] : ["general", "professional"],
        },
        variants: {
            preferred: isDark ? "dark" : "light",
            light: { contrastFloor: 4.5 },
            dark: { contrastFloor: 4.5 },
            print: { contrastFloor: 7 },
        },
        tokens: {
            color: {
                text: {
                    primary: theme.defaultTextColor,
                    secondary: theme.defaultMutedColor,
                    inverse: isDark ? "#0f172a" : "#ffffff",
                },
                accent: {
                    primary: theme.accentStrong,
                    secondary: theme.cssVars?.["--slide-accent-2"] || theme.defaultShapeColor,
                    soft: theme.accentSoft,
                },
                surface: {
                    canvas: theme.cssVars?.["--slide-bg"],
                    panel: theme.surfaceColor,
                    border: theme.surfaceBorder,
                },
            },
            typography: {
                family: {
                    display: theme.headingFont,
                    body: theme.bodyFont,
                    mono: '"JetBrains Mono", "SFMono-Regular", monospace',
                    equation: '"STIX Two Text", "Times New Roman", serif',
                },
                role: {
                    title: { size: 48, lineHeight: 1.04, weight: 800 },
                    subtitle: { size: 25, lineHeight: 1.22, weight: 600 },
                    body: { size: densityScale.bodySize, lineHeight: 1.4, weight: 500 },
                    caption: { size: densityScale.captionSize, lineHeight: 1.32, weight: 600 },
                    label: { size: 11, lineHeight: 1.1, weight: 800, casing: "uppercase" },
                },
            },
            spacing: {
                base: 8,
                slidePadding: densityScale.slidePadding,
                regionGap: densityScale.regionGap,
                captionGap: 10,
            },
            density: {
                default: profile.density,
                maxTextBlocks: profile.density === "expert" ? 8 : 5,
                whitespaceBias: profile.density === "spacious" ? 0.76 : profile.density === "expert" ? 0.46 : 0.62,
            },
            elevation: {
                slide: isDark ? "0 30px 90px rgba(0,0,0,0.46)" : "0 28px 80px rgba(15,23,42,0.18)",
                panel: isDark ? "0 16px 44px rgba(0,0,0,0.34)" : "0 16px 44px rgba(15,23,42,0.10)",
            },
            motion: {
                personality: profile.family === "cinematic" ? "expressive" : "precise",
                duration: { fast: 120, normal: 220, slow: 420 },
                easing: { standard: [0.2, 0, 0, 1], expressive: [0.16, 1, 0.3, 1] },
            },
            chart: {
                palette: [
                    theme.accentStrong,
                    theme.cssVars?.["--slide-accent-2"] || theme.defaultShapeColor,
                    theme.defaultShapeColor,
                    "#F59E0B",
                    "#EF4444",
                ],
                grid: profile.family === "scientific" ? "technical" : "subtle",
                legend: profile.density === "expert" ? "right" : "bottom",
            },
            science: {
                figureCaption: profile.family === "scientific" ? "journal" : "editorial",
                panelLabels: profile.family === "scientific" ? "A/B/C" : "minimal",
                equationBackground: theme.surfaceColor,
                moleculeBackground: isDark ? "#020617" : "#f8fafc",
            },
            table: {
                headerFill: theme.accentSoft,
                border: theme.surfaceBorder,
                density: profile.density === "expert" ? "compact" : "standard",
            },
        },
        rhythm: {
            sectionBreakInterval: profile.family === "scientific" ? 5 : 7,
            titleFrequency: profile.family === "cinematic" ? "high" : "medium",
            annotationStyle: profile.family === "scientific" ? "technical" : "editorial",
        },
        accessibility: {
            minContrast: 4.5,
            colorBlindSafe: profile.family === "scientific",
            minBodyFontPx: profile.density === "expert" ? 18 : 20,
            minCaptionFontPx: 12,
        },
        aiGuidance: {
            rewriteTone: profile.tone,
            preferredLayouts:
                profile.family === "scientific"
                    ? ["figure-caption", "methodology", "results-data", "comparison-table"]
                    : ["title-page", "content-slide", "two-column", "section-divider"],
            densityAdvice:
                profile.density === "expert"
                    ? "Allow dense evidence, but preserve figure/caption hierarchy."
                    : "Prefer spacious hierarchy and one dominant idea per slide.",
        },
    };
}

function installThemeDesignSystems() {
    Object.entries(PRESENTATION_THEMES).forEach(([themeId, theme]) => {
        theme.system = buildThemeDesignSystem(themeId, theme);
        theme.tokens = theme.system.tokens;
        theme.family = theme.system.family;
        theme.intent = theme.system.intent;
        theme.rhythm = theme.system.rhythm;
        theme.accessibility = theme.system.accessibility;
        theme.aiGuidance = theme.system.aiGuidance;
    });
}

installThemeDesignSystems();

function normalizeFont(fontFamily, weight, size, theme) {
    const numericWeight = Number(weight) || 400;
    const numericSize = parseFloat(size) || 0;
    const isKnown = FONT_FAMILIES.includes(fontFamily);
    if (!isKnown) return fontFamily;
    return numericWeight >= 700 || numericSize >= 42 ? theme.headingFont : theme.bodyFont;
}

function _parseThemeColor(value) {
    const raw = String(value || "").trim();
    let match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (match) {
        let hex = match[1];
        if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: 1,
        };
    }
    match = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!match) return null;
    return {
        r: Math.round(Number(match[1])),
        g: Math.round(Number(match[2])),
        b: Math.round(Number(match[3])),
        a: match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4]))),
    };
}

function _sameThemeRgb(a, b) {
    return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function _themeColorWithAlpha(color, alpha = 1) {
    const parsed = _parseThemeColor(color);
    if (!parsed) return color;
    if (alpha >= 0.995) return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Number(alpha.toFixed(3))})`;
}

function classifyThemeColor(color, theme) {
    const parsed = _parseThemeColor(color);
    const normalized = String(color || "").trim().toLowerCase();
    const candidates = [
        ["text", theme.defaultTextColor],
        ["text", theme.cssVars?.["--slide-fg"]],
        ["muted", theme.defaultMutedColor],
        ["muted", theme.cssVars?.["--slide-muted"]],
        ["accent", theme.accentStrong],
        ["accent", theme.cssVars?.["--slide-accent"]],
        ["accent2", theme.cssVars?.["--slide-accent-2"]],
        ["shape", theme.defaultShapeColor],
        ["surface", theme.surfaceColor],
        ["border", theme.surfaceBorder],
    ];
    for (const [role, candidate] of candidates) {
        if (!candidate) continue;
        if (normalized === String(candidate).trim().toLowerCase()) return { role, alpha: parsed?.a ?? 1 };
        if (_sameThemeRgb(parsed, _parseThemeColor(candidate))) return { role, alpha: parsed?.a ?? 1 };
    }
    return { role: classifyColor(color, theme), alpha: parsed?.a ?? 1 };
}

function resolveThemeColorRole(role, nextTheme, alpha = 1, target = "text") {
    if (role === "text") return nextTheme.defaultTextColor;
    if (role === "muted") return nextTheme.defaultMutedColor;
    if (role === "surface") return nextTheme.surfaceColor;
    if (role === "border") return nextTheme.surfaceBorder;
    if (role === "accent2") return _themeColorWithAlpha(nextTheme.cssVars?.["--slide-accent-2"] || nextTheme.defaultShapeColor, alpha);
    if (role === "shape") return _themeColorWithAlpha(target === "shape" ? nextTheme.defaultShapeColor : nextTheme.accentStrong, alpha);
    if (role === "accent") return _themeColorWithAlpha(target === "shape" ? nextTheme.defaultShapeColor : nextTheme.accentStrong, alpha);
    return null;
}

function _canRefreshPresetThemeStyles(slide) {
    if (!slide || !slide.layoutId || slide.layoutId === "blank-titled") return false;
    if (typeof SLIDE_PRESETS === "undefined" || !SLIDE_PRESETS?.[slide.layoutId]) return false;
    const elements = Array.isArray(slide.elements) ? slide.elements : [];
    return elements.length > 0 && elements.every(element => element?.themeManaged !== false);
}

function _mergeTableTextIntoThemeTable(nextTableData, previousTableData) {
    if (!nextTableData || !previousTableData) return nextTableData;
    const merged = { ...nextTableData };
    const nextCells = Array.isArray(nextTableData.cells) ? nextTableData.cells : [];
    const previousCells = Array.isArray(previousTableData.cells) ? previousTableData.cells : [];
    if (!nextCells.length || !previousCells.length) return merged;
    merged.cells = nextCells.map((row, rowIndex) => {
        const previousRow = previousCells[rowIndex] || [];
        return (Array.isArray(row) ? row : []).map((cell, cellIndex) => {
            const previousCell = previousRow[cellIndex];
            if (!previousCell || typeof previousCell !== "object") return cell;
            return { ...cell, text: previousCell.text ?? cell?.text ?? "" };
        });
    });
    return merged;
}

function _applyPresetThemeStylesToSlide(slide, nextTheme) {
    if (!_canRefreshPresetThemeStyles(slide) || typeof buildPresetSlideState !== "function") return false;
    const themedSlide = buildPresetSlideState(slide.layoutId, nextTheme, {
        slideId: slide.id,
        notes: slide.notes || "",
        background: slide.background || "",
        masterId: slide.masterId || null,
    });
    const themedElements = Array.isArray(themedSlide?.elements) ? themedSlide.elements : [];
    // The slide's footer (added to every slide, not part of the preset) is retinted on its own: counting it made
    // every preset slide look edited, so its background kept the old theme and its text vanished.
    const allElements = Array.isArray(slide.elements) ? slide.elements : [];
    const currentElements = allElements.filter(element => !element?.footerRole);
    if (!themedElements.length || themedElements.length !== currentElements.length) return false;
    if (currentElements.some((element, index) => themedElements[index]?.type !== element?.type)) return false;

    const restyled = new Map(currentElements.map((element, index) => {
        const themed = themedElements[index];
        const next = {
            ...element,
            styles: themed.styles ? { ...themed.styles } : element.styles,
            themeManaged: element.themeManaged ?? true,
        };
        if (themed.shapeType) next.shapeType = themed.shapeType;
        if (themed.bulletStyle && element.type === "text") next.bulletStyle = themed.bulletStyle;
        if (element.type === "table" && themed.tableData) {
            next.tableData = _mergeTableTextIntoThemeTable(themed.tableData, element.tableData);
        }
        return [element, next];
    }));
    slide.elements = allElements.map(element => restyled.get(element) || element);
    return true;
}

function classifyColor(color, theme) {
    const normalized = String(color || "").trim().toLowerCase();
    if (!normalized) return "keep";

    const lightText = new Set([
        "#ffffff",
        "#f8fafc",
        "#f5f7fb",
        "#eef4ff",
        "#f8f3e7",
        "#ecf7f5",
        "#f5f7ff",
        "#172033",
        "#10233b",
        "#2f261d",
        "#171717",
        theme.defaultTextColor.toLowerCase(),
    ]);
    if (lightText.has(normalized)) return "text";

    const mutedText = new Set([
        "#94a3b8",
        "#475569",
        "#64748b",
        "#667085",
        "#5f7287",
        "#6f6559",
        "#6b7280",
        "#afbdd6",
        "#d4cbb7",
        "#9ab8b3",
        "#bdc4de",
        theme.defaultMutedColor.toLowerCase(),
    ]);
    if (mutedText.has(normalized)) return "muted";

    const accentish = new Set([
        "#3b82f6",
        "#2563eb",
        "#1d4ed8",
        "#7a8f47",
        "#1f2937",
        "#22d3ee",
        "#7dd3fc",
        "#f5d76e",
        "#8ed1c7",
        "#63e6d8",
        "#1fb6a6",
        "#f3b76a",
        "#6e86ff",
        "#64748b",
        theme.defaultShapeColor.toLowerCase(),
        theme.accentStrong.toLowerCase(),
        String(theme.cssVars?.["--slide-accent"] || "").toLowerCase(),
        String(theme.cssVars?.["--slide-accent-2"] || "").toLowerCase(),
    ]);
    if (accentish.has(normalized)) return "accent";

    return "keep";
}

function getPresentationTheme(themeId = state.presentationTheme) {
    return PRESENTATION_THEMES[themeId] || PRESENTATION_THEMES.editorial;
}

function getPresentationThemeSystem(themeId = state.presentationTheme) {
    return getPresentationTheme(themeId)?.system || buildThemeDesignSystem("editorial", PRESENTATION_THEMES.editorial);
}

function getPresentationThemeTokens(themeId = state.presentationTheme) {
    return getPresentationThemeSystem(themeId).tokens;
}

function normalizePresentationThemeId(themeId) {
    return PRESENTATION_THEMES[themeId] ? themeId : "editorial";
}

function syncPresentationThemeFromState({ persist = false } = {}) {
    if (typeof state === "undefined" || !state) return "editorial";
    const safeThemeId = normalizePresentationThemeId(state.presentationTheme);
    if (state.presentationTheme !== safeThemeId) {
        state.presentationTheme = safeThemeId;
    }
    applyPresentationTheme(safeThemeId, { persist });
    return safeThemeId;
}

function applyPresentationTheme(themeId, { persist = true } = {}) {
    const safeThemeId = normalizePresentationThemeId(themeId);
    const theme = PRESENTATION_THEMES[safeThemeId];
    const root = document.documentElement;
    const isPresenting = document.body.classList.contains("play-mode-active");

    if (persist) {
        state.presentationTheme = safeThemeId;
    }

    document.body.dataset.presentationTheme = safeThemeId;
    Object.entries(theme.cssVars).forEach(([key, value]) => root.style.setProperty(key, value));

    const revealTheme = document.getElementById("reveal-theme");
    if (revealTheme && !isPresenting) {
        revealTheme.href = `vendor/reveal.js/theme/${theme.revealTheme}.css`;
    }
    if (typeof renderPresetSlidePalette === "function") {
        renderPresetSlidePalette();
    }
}

function changePresentationTheme(themeId) {
    const previousThemeId = state.presentationTheme || "editorial";
    const nextThemeId = PRESENTATION_THEMES[themeId] ? themeId : "editorial";
    if (previousThemeId === nextThemeId) {
        applyPresentationTheme(nextThemeId);
        return false;
    }
    if (typeof saveStateToUndo === "function") saveStateToUndo();
    retintPresentationTheme(previousThemeId, nextThemeId);
    applyPresentationTheme(nextThemeId);
    if (typeof renderSlidesFromState === "function") renderSlidesFromState();
    if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
    // Drawings are pictures: they are redrawn in the new colours once Excalidraw has loaded (in the background).
    if (typeof retintDrawingsForTheme === "function") {
        window.__drawingRetint = retintDrawingsForTheme(getPresentationTheme(previousThemeId), getPresentationTheme(nextThemeId));
    }
    return true;
}

function _themeColorLuminance(parsed) {
    const channel = value => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(parsed.r) + 0.7152 * channel(parsed.g) + 0.0722 * channel(parsed.b);
}

function _themeContrastRatio(a, b) {
    const la = _themeColorLuminance(a);
    const lb = _themeColorLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Text colour for table text on a fill: the theme's text colour when the fill is see-through (the slide shows
// through) or already contrasts, otherwise whichever of the theme text and a dark ink reads better on it.
function _readableTableTextColor(fill, nextTheme) {
    const themeText = nextTheme.defaultTextColor;
    const parsedFill = _parseThemeColor(fill);
    const parsedText = _parseThemeColor(themeText);
    if (!parsedFill || !parsedText || parsedFill.a < 0.5) return themeText;
    if (_themeContrastRatio(parsedFill, parsedText) >= 4.5) return themeText;
    const ink = "#172033";
    return _themeContrastRatio(parsedFill, _parseThemeColor(ink)) > _themeContrastRatio(parsedFill, parsedText) ? ink : themeText;
}

// Fills follow the theme only when they are one of its fill colours; a white cell used to be read as "text
// colour" and turned light along with the text, so dark themes showed light text on light cells.
function _retintTableData(tableData, previousTheme, nextTheme) {
    ["headerFill", "bodyFill", "altFill", "borderColor"].forEach(key => {
        const colorKind = classifyThemeColor(tableData[key], previousTheme);
        if (colorKind.role === "text" || colorKind.role === "muted") return;
        const nextColor = resolveThemeColorRole(colorKind.role, nextTheme, colorKind.alpha, "shape");
        // A solid cell fill must not become a see-through surface: its text was chosen for a solid background.
        const wasSolid = (_parseThemeColor(tableData[key])?.a ?? 1) >= 0.5;
        if (wasSolid && key !== "borderColor" && (_parseThemeColor(nextColor)?.a ?? 1) < 0.5) return;
        if (nextColor) tableData[key] = nextColor;
    });
    [["textColor", "bodyFill"], ["headerTextColor", "headerFill"]].forEach(([key, fillKey]) => {
        const colorKind = classifyThemeColor(tableData[key], previousTheme);
        if (colorKind.role === "keep" && tableData[key]) return;
        tableData[key] = _readableTableTextColor(tableData[fillKey], nextTheme);
    });
}

// A chart on the old theme's card (or the old default white card) moves to the new theme's card, and series the
// user did not colour take the new theme's palette; the chart's words follow from the card (chartInkColor).
function _retintChart(el, previousTheme, nextTheme) {
    const card = String(el.styles.backgroundColor || "").replace(/\s+/g, "").toLowerCase();
    const previousCard = String(previousTheme.surfaceColor || "").replace(/\s+/g, "").toLowerCase();
    if (card === "#ffffff" || card === "#fff" || card === "white" || (previousCard && card === previousCard)) {
        el.styles.backgroundColor = nextTheme.surfaceColor || "#ffffff";
    }
    if (typeof applyChartSeriesColors === "function") applyChartSeriesColors(el, nextTheme);
}

// A new table's colours on a theme. Light themes keep the light grey header and white body; dark themes put the
// table on the theme's card with an accent-tinted header and the theme's text, instead of a white block.
const LIGHT_TABLE_COLORS = { headerFill: "#e2e8f0", bodyFill: "#ffffff", altFill: "#f8fafc", borderColor: "#cbd5e1", textColor: "#172033", headerTextColor: "#172033" };

function themeTableColors(theme = getPresentationTheme()) {
    const isDark = _themeRelativeLuminance(theme.defaultTextColor) > 0.72;
    if (!isDark) return { ...LIGHT_TABLE_COLORS };
    return {
        headerFill: theme.accentSoft,
        bodyFill: theme.surfaceColor,
        altFill: _themeColorWithAlpha(theme.defaultTextColor, 0.1),
        borderColor: theme.surfaceBorder,
        textColor: theme.defaultTextColor,
        headerTextColor: theme.defaultTextColor,
    };
}

function _sameTableColors(tableData, colors) {
    const norm = value => String(value || "").replace(/\s+/g, "").toLowerCase();
    return ["headerFill", "bodyFill", "altFill", "borderColor"].every(key => norm(tableData[key]) === norm(colors[key]));
}

// One element's colours and fonts for the next theme: colours that were the old theme's roles become the new
// theme's, and colours the user picked stay.
function _retintElementForTheme(el, previousTheme, nextTheme) {
    if (!el || !el.styles) return;
    if (el.themeManaged === false) return;

    // A preset slide's background shape is the theme's slide background: an edited preset slide (no longer
    // rebuilt from its preset) kept the old theme's dark gradient under the new theme's text.
    if (el.presetBackground && typeof _modernPalette === "function") {
        const palette = _modernPalette(nextTheme);
        el.styles.backgroundColor = palette.canvas;
        el.styles.background = palette.canvasBackground;
        return;
    }

    if (el.type === "text") {
        el.styles.fontFamily = normalizeFont(el.styles.fontFamily, el.styles.fontWeight, el.styles.fontSize, nextTheme);

        const colorKind = classifyThemeColor(el.styles.color, previousTheme);
        const nextColor = resolveThemeColorRole(colorKind.role, nextTheme, colorKind.alpha, "text");
        if (nextColor) el.styles.color = nextColor;
    }

    // An equation is text too: it kept the old theme's text colour, so a white equation vanished on a
    // light theme.
    if (el.type === "equation") {
        const colorKind = classifyThemeColor(el.styles.color, previousTheme);
        const nextColor = resolveThemeColorRole(colorKind.role, nextTheme, colorKind.alpha, "text");
        if (nextColor) el.styles.color = nextColor;
    }

    if (el.type === "shape") {
        const bgKind = classifyThemeColor(el.styles.backgroundColor, previousTheme);
        const nextBg = resolveThemeColorRole(bgKind.role, nextTheme, bgKind.alpha, "shape");
        if (nextBg) el.styles.backgroundColor = nextBg;
    }

    if (el.type === "connector") {
        const strokeKind = classifyThemeColor(el.styles.color, previousTheme);
        const nextStroke = resolveThemeColorRole(strokeKind.role, nextTheme, strokeKind.alpha, "text");
        if (nextStroke) el.styles.color = nextStroke;
    }

    if (el.type === "table" && el.tableData) {
        // A table still in the default colours (the old theme's, or the white ones every theme used to
        // get) takes the new theme's; one the user coloured is retinted role by role.
        if (_sameTableColors(el.tableData, themeTableColors(previousTheme)) || _sameTableColors(el.tableData, LIGHT_TABLE_COLORS)) {
            Object.assign(el.tableData, themeTableColors(nextTheme));
        } else {
            _retintTableData(el.tableData, previousTheme, nextTheme);
        }
    }

    if (el.type === "chart") _retintChart(el, previousTheme, nextTheme);

    if (el.styles.border) {
        el.styles.border = `1px solid ${nextTheme.surfaceBorder}`;
    }
}

// The slide's footer takes the colours, borders and fonts of a footer built for the new theme (its text, size and
// place stay). Retinted colour by colour, the slide-number pill kept a light theme's white fill under a dark
// theme's light number.
function _restyleFooterForTheme(slide, slideIndex, nextTheme) {
    const done = new Set();
    const footers = (slide.elements || []).filter(el => el?.footerRole && el.themeManaged !== false && el.styles);
    if (!footers.length || typeof buildMasterSlideElements !== "function") return done;
    let fresh = [];
    try {
        fresh = buildMasterSlideElements(slide, slideIndex, nextTheme, { includeEditableFooter: true });
    } catch (error) {
        return done;
    }
    const byRole = new Map(fresh.map(el => [el.masterRole, el]));
    const keys = ["color", "backgroundColor", "background", "border", "borderColor", "boxShadow", "fontFamily", "fontWeight"];
    footers.forEach(el => {
        const source = byRole.get(el.footerRole);
        if (!source?.styles) return;
        keys.forEach(key => {
            if (source.styles[key] !== undefined) el.styles[key] = source.styles[key];
            else if (key === "background") delete el.styles.background;
        });
        done.add(el);
    });
    return done;
}

function retintPresentationTheme(previousThemeId, nextThemeId) {
    const previousTheme = getPresentationTheme(previousThemeId);
    const nextTheme = getPresentationTheme(nextThemeId);

    state.slides.forEach((slide, slideIndex) => {
        const restyledAsPreset = _applyPresetThemeStylesToSlide(slide, nextTheme);
        const restyledFooter = _restyleFooterForTheme(slide, slideIndex, nextTheme);
        (slide.elements || []).forEach(el => {
            // A restyled preset slide is done, except for its footer; a restyled footer element is done too.
            if (restyledAsPreset && !el?.footerRole) return;
            if (restyledFooter.has(el)) return;
            _retintElementForTheme(el, previousTheme, nextTheme);
        });
    });

    state.presentationTheme = nextThemeId;
}

window.changePresentationTheme = changePresentationTheme;
window.themeTableColors = themeTableColors;
window.syncPresentationThemeFromState = syncPresentationThemeFromState;
window.getPresentationTheme = getPresentationTheme;
window.getPresentationThemeSystem = getPresentationThemeSystem;
window.getPresentationThemeTokens = getPresentationThemeTokens;
window.PRESENTATION_THEMES = PRESENTATION_THEMES;
