export const RENDER_SCENE_VERSION = 1;

export function createRenderScene({ state, page, theme, profile }) {
    return {
        schemaVersion: RENDER_SCENE_VERSION,
        createdAt: new Date().toISOString(),
        deck: {
            title: state?.title || "SlideForge Presentation",
            page,
            theme: {
                id: state?.presentationTheme || "default",
                tokens: theme?.cssVars || {},
            },
            profile,
        },
        slides: [],
        assets: [],
        diagnostics: [],
    };
}
