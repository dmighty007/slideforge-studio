// --- Component Registry ---
// This file stores pre-designed JSON templates for complex, multi-element UI blocks.

const ComponentTemplates = {
    'metric-card': {
        name: 'Metric Card',
        elements: [
            {
                type: 'shape',
                shapeType: 'rectangle',
                offsetX: 0, offsetY: 0,
                width: '300px', height: '180px',
                content: '',
                styles: {
                    backgroundColor: '#1e293b',
                    borderRadius: '16px',
                    border: '1px solid #334155',
                    zIndex: 1,
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }
            },
            {
                type: 'text',
                offsetX: 24, offsetY: 24,
                width: '250px', height: 'auto',
                content: 'Quarterly Revenue',
                styles: {
                    color: '#94a3b8',
                    fontSize: '18px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '600',
                    zIndex: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                }
            },
            {
                type: 'text',
                offsetX: 24, offsetY: 64,
                width: '250px', height: 'auto',
                content: '$2.4M',
                styles: {
                    color: '#ffffff',
                    fontSize: '56px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '700',
                    zIndex: 2
                }
            },
            {
                type: 'text',
                offsetX: 24, offsetY: 135,
                width: '250px', height: 'auto',
                content: '<span style="color: #22c55e;">▲ 14%</span> vs last quarter',
                styles: {
                    color: '#64748b',
                    fontSize: '14px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '500',
                    zIndex: 2
                }
            }
        ]
    },

    'hero-title': {
        name: 'Hero Title',
        elements: [
            {
                type: 'text',
                offsetX: 0, offsetY: 0,
                width: '800px', height: 'auto',
                content: 'Next-Gen Presentation Builder',
                styles: {
                    color: '#ffffff',
                    fontSize: '72px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '800',
                    zIndex: 1,
                    lineHeight: '1.1'
                }
            },
            {
                type: 'text',
                offsetX: 0, offsetY: 100,
                width: '600px', height: 'auto',
                content: 'A smart, scalable, and user-guided presentation platform designed for the modern web.',
                styles: {
                    color: '#94a3b8',
                    fontSize: '24px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '400',
                    zIndex: 1,
                    lineHeight: '1.5'
                }
            }
        ]
    },

    'bullet-list': {
        name: 'Bullet List',
        elements: [
            {
                type: 'text',
                offsetX: 0, offsetY: 0,
                width: '600px', height: 'auto',
                content: [
                    { text: 'First key objective', level: 0 },
                    { text: 'Second major milestone', level: 0 },
                    { text: 'Third operational goal', level: 0 }
                ],
                bulletStyle: 'default',
                styles: {
                    color: '#e2e8f0',
                    fontSize: '28px',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: '400',
                    zIndex: 1,
                    lineHeight: '1.6'
                }
            }
        ]
    },

    'beamer-block': {
        name: 'Beamer Block',
        elements: [
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 0, width: '600px', height: '50px',
                content: '', styles: { backgroundColor: '#3b82f6', borderRadius: '8px 8px 0 0', zIndex: 1 }
            },
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 50, width: '600px', height: '200px',
                content: '', styles: { backgroundColor: '#eff6ff', borderRadius: '0 0 8px 8px', zIndex: 1, border: '1px solid #bfdbfe' }
            },
            {
                type: 'text', offsetX: 20, offsetY: 12, width: '560px', height: 'auto',
                content: 'Block Title', styles: { color: '#ffffff', fontSize: '20px', fontFamily: 'Inter, sans-serif', fontWeight: '700', zIndex: 2 }
            },
            {
                type: 'text', offsetX: 20, offsetY: 70, width: '560px', height: 'auto',
                content: 'This is a standard Beamer-style block for important information.',
                styles: { color: '#1e3a8a', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: '400', zIndex: 2, lineHeight: '1.4' }
            }
        ]
    },

    'beamer-alert': {
        name: 'Alert Block',
        elements: [
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 0, width: '600px', height: '50px',
                content: '', styles: { backgroundColor: '#ef4444', borderRadius: '8px 8px 0 0', zIndex: 1 }
            },
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 50, width: '600px', height: '200px',
                content: '', styles: { backgroundColor: '#fef2f2', borderRadius: '0 0 8px 8px', zIndex: 1, border: '1px solid #fecaca' }
            },
            {
                type: 'text', offsetX: 20, offsetY: 12, width: '560px', height: 'auto',
                content: 'Important Alert', styles: { color: '#ffffff', fontSize: '20px', fontFamily: 'Inter, sans-serif', fontWeight: '700', zIndex: 2 }
            },
            {
                type: 'text', offsetX: 20, offsetY: 70, width: '560px', height: 'auto',
                content: 'Use this block to highlight critical warnings or key takeaways.',
                styles: { color: '#7f1d1d', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: '400', zIndex: 2, lineHeight: '1.4' }
            }
        ]
    },

    'beamer-header': {
        name: 'Metro Header',
        elements: [
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: -100, offsetY: -100, width: '1224px', height: '120px',
                content: '', styles: { backgroundColor: '#0f172a', zIndex: 1 }
            },
            {
                type: 'text', offsetX: 50, offsetY: -60, width: '900px', height: 'auto',
                content: 'Presentation Title',
                styles: { color: '#ffffff', fontSize: '36px', fontFamily: 'Oswald, sans-serif', fontWeight: '700', zIndex: 2, textTransform: 'uppercase', letterSpacing: '2px' }
            },
            {
                type: 'text', offsetX: 50, offsetY: -10, width: '900px', height: 'auto',
                content: 'Subtitle or Section Name',
                styles: { color: '#6366f1', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: '500', zIndex: 2 }
            }
        ]
    },

    'beamer-definition': {
        name: 'Definition Block',
        elements: [
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 0, width: '600px', height: '50px',
                content: '', styles: { backgroundColor: '#10b981', borderRadius: '8px 8px 0 0', zIndex: 1 }
            },
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 50, width: '600px', height: '200px',
                content: '', styles: { backgroundColor: '#ecfdf5', borderRadius: '0 0 8px 8px', zIndex: 1, border: '1px solid #a7f3d0' }
            },
            {
                type: 'text', offsetX: 20, offsetY: 12, width: '560px', height: 'auto',
                content: 'Definition', styles: { color: '#ffffff', fontSize: '20px', fontFamily: 'Inter, sans-serif', fontWeight: '700', zIndex: 2 }
            },
            {
                type: 'text', offsetX: 20, offsetY: 70, width: '560px', height: 'auto',
                content: 'A <strong>set</strong> is a collection of distinct objects, considered as an object in its own right.',
                styles: { color: '#064e3b', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: '400', zIndex: 2, lineHeight: '1.4' }
            }
        ]
    },

    'beamer-example': {
        name: 'Example Block',
        elements: [
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 0, width: '600px', height: '50px',
                content: '', styles: { backgroundColor: '#64748b', borderRadius: '8px 8px 0 0', zIndex: 1 }
            },
            {
                type: 'shape', shapeType: 'rectangle',
                offsetX: 0, offsetY: 50, width: '600px', height: '200px',
                content: '', styles: { backgroundColor: '#f8fafc', borderRadius: '0 0 8px 8px', zIndex: 1, border: '1px solid #e2e8f0' }
            },
            {
                type: 'text', offsetX: 20, offsetY: 12, width: '560px', height: 'auto',
                content: 'Example', styles: { color: '#ffffff', fontSize: '20px', fontFamily: 'Inter, sans-serif', fontWeight: '700', zIndex: 2 }
            },
            {
                type: 'text', offsetX: 20, offsetY: 70, width: '560px', height: 'auto',
                content: 'For instance, {1, 2, 3} is a set of three numbers.',
                styles: { color: '#334155', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: '400', zIndex: 2, lineHeight: '1.4' }
            }
        ]
    }
};

function resolveComponentTemplate(templateId, theme) {
    const template = ComponentTemplates[templateId];
    if (!template) return null;

    const accent = theme.cssVars["--slide-accent"] || theme.defaultShapeColor;
    const accent2 = theme.cssVars["--slide-accent-2"] || theme.defaultShapeColor;
    const fg = theme.defaultTextColor;
    const muted = theme.defaultMutedColor;

    const themed = JSON.parse(JSON.stringify(template));
    themed.elements = themed.elements.map(el => {
        const next = { ...el, styles: { ...(el.styles || {}) } };

        if (next.type === "text") {
            if (!next.styles.fontFamily || next.styles.fontFamily === "Inter, sans-serif") {
                next.styles.fontFamily = theme.bodyFont;
            }
            if (templateId === "hero-title" && next.offsetY === 0) {
                next.styles.fontFamily = theme.headingFont;
                next.styles.color = fg;
            } else if (templateId === "hero-title") {
                next.styles.color = muted;
            } else if (templateId === "metric-card" && next.offsetY === 24) {
                next.styles.color = muted;
            } else if (templateId === "metric-card" && next.offsetY === 64) {
                next.styles.color = fg;
                next.styles.fontFamily = theme.headingFont;
            } else if (templateId === "metric-card" && next.offsetY === 135) {
                next.styles.color = muted;
                next.content = `<span style="color: ${accent2};">▲ 14%</span> vs last quarter`;
            } else if (templateId === "bullet-list") {
                next.styles.color = fg;
                next.styles.fontFamily = theme.bodyFont;
            } else if (templateId === "beamer-header" && next.offsetY === -60) {
                next.styles.fontFamily = theme.headingFont;
                next.styles.color = fg;
            } else if (templateId === "beamer-header" && next.offsetY === -10) {
                next.styles.color = accent;
            } else if (templateId.startsWith("beamer-") && next.offsetY === 12) {
                next.styles.color = fg;
            } else if (templateId.startsWith("beamer-")) {
                next.styles.color = fg;
            }
        }

        if (next.type === "shape") {
            if (templateId === "metric-card") {
                next.styles.backgroundColor = "rgba(15, 23, 42, 0.28)";
                next.styles.border = `1px solid color-mix(in srgb, ${muted} 35%, transparent)`;
            } else if (templateId === "beamer-block" && next.offsetY === 0) {
                next.styles.backgroundColor = accent;
            } else if (templateId === "beamer-block" && next.offsetY === 50) {
                next.styles.backgroundColor = "rgba(255,255,255,0.08)";
                next.styles.border = `1px solid color-mix(in srgb, ${accent} 35%, transparent)`;
            } else if (templateId === "beamer-alert" && next.offsetY === 0) {
                next.styles.backgroundColor = accent2;
            } else if (templateId === "beamer-alert" && next.offsetY === 50) {
                next.styles.backgroundColor = "rgba(255,255,255,0.08)";
                next.styles.border = `1px solid color-mix(in srgb, ${accent2} 35%, transparent)`;
            } else if (templateId === "beamer-definition" && next.offsetY === 0) {
                next.styles.backgroundColor = accent;
            } else if (templateId === "beamer-definition" && next.offsetY === 50) {
                next.styles.backgroundColor = "rgba(255,255,255,0.08)";
                next.styles.border = `1px solid color-mix(in srgb, ${accent} 35%, transparent)`;
            } else if (templateId === "beamer-example" && next.offsetY === 0) {
                next.styles.backgroundColor = muted;
            } else if (templateId === "beamer-example" && next.offsetY === 50) {
                next.styles.backgroundColor = "rgba(255,255,255,0.08)";
                next.styles.border = `1px solid color-mix(in srgb, ${muted} 35%, transparent)`;
            } else if (templateId === "beamer-header") {
                next.styles.backgroundColor = "rgba(8, 12, 18, 0.5)";
            }
        }

        return next;
    });

    return themed;
}
