// Designer Button plugin (inspired by OriginKit https://www.originkit.dev/?cat=button):
// High-craft interactive CTA & micro-interaction buttons with both crisp SVG vector stills (for editor canvas,
// thumbnails, PDF, PowerPoint, PNG, and HTML export) and 60fps interactive live views in Presentation Mode
// and Editor Explore mode.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";

    const STYLE_PRESETS = {
        venom: {
            label: "Venom Symbiote Pill (OriginKit)",
            defaultLabel: "Explore the Data",
            defaultBadge: "LIVE",
            defaultIcon: "sparkles",
            surface: "#07090e",
            accent: "#8b5cf6",
            accent2: "#06b6d4",
            textColor: "#f8fafc",
        },
        "border-beam": {
            label: "Aurora Border Beam",
            defaultLabel: "Get Started",
            defaultBadge: "v2.4",
            defaultIcon: "arrow",
            surface: "#0b0f19",
            accent: "#38bdf8",
            accent2: "#f472b6",
            textColor: "#f8fafc",
        },
        "hold-confirm": {
            label: "Hold to Confirm",
            defaultLabel: "Hold to Deploy",
            defaultBadge: "1.0s",
            defaultIcon: "bolt",
            surface: "#111827",
            accent: "#10b981",
            accent2: "#34d399",
            textColor: "#f8fafc",
        },
        "emoji-burst": {
            label: "Star & Emoji Burst",
            defaultLabel: "Celebrate Launch",
            defaultBadge: "✨",
            defaultIcon: "sparkles",
            surface: "#18181b",
            accent: "#f59e0b",
            accent2: "#ec4899",
            textColor: "#ffffff",
        },
        "pulse-like": {
            label: "Pulse Like Counter",
            defaultLabel: "Upvote Idea",
            defaultBadge: "128",
            defaultIcon: "heart",
            surface: "#0f172a",
            accent: "#f43f5e",
            accent2: "#fb7185",
            textColor: "#f8fafc",
        },
        "liquid-morph": {
            label: "Liquid Wave Fill",
            defaultLabel: "Dive Deeper",
            defaultBadge: "",
            defaultIcon: "arrow",
            surface: "#090d16",
            accent: "#6366f1",
            accent2: "#22d3ee",
            textColor: "#f8fafc",
        },
        "neon-shimmer": {
            label: "Cyber Shimmer CTA",
            defaultLabel: "Open Backup Slide",
            defaultBadge: "PRO",
            defaultIcon: "external",
            surface: "#09090b",
            accent: "#a855f7",
            accent2: "#ec4899",
            textColor: "#ffffff",
        },
        "keycap-3d": {
            label: "Tactile 3D Keycap",
            defaultLabel: "Run Command",
            defaultBadge: "⌘K",
            defaultIcon: "play",
            surface: "#1e293b",
            accent: "#3b82f6",
            accent2: "#60a5fa",
            textColor: "#f8fafc",
        },
    };

    const defaults = {
        style: "venom",
        label: "Explore the Data",
        badge: "LIVE",
        icon: "sparkles",
        iconPosition: "right",
        shape: "pill",
        surface: "#07090e",
        accent: "#8b5cf6",
        accent2: "#06b6d4",
        textColor: "#f8fafc",
        href: "",
        fontSize: 18,
        glowIntensity: 75,
        particles: "✨,🚀,⭐,🔥",
        holdDuration: 1.0,
    };

    function hexToRgb(hex, fallback = [99, 102, 241]) {
        const clean = String(hex || "").replace("#", "");
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
        return [
            parseInt(clean.slice(0, 2), 16),
            parseInt(clean.slice(2, 4), 16),
            parseInt(clean.slice(4, 6), 16),
        ];
    }

    function rgba(hex, alpha) {
        const [r, g, b] = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${Number(alpha).toFixed(3)})`;
    }

    function mixHex(hexA, hexB, t = 0.5) {
        const a = hexToRgb(hexA);
        const b = hexToRgb(hexB);
        const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
        const r = clamp(a[0] + (b[0] - a[0]) * t);
        const g = clamp(a[1] + (b[1] - a[1]) * t);
        const bl = clamp(a[2] + (b[2] - a[2]) * t);
        return `#${[r, g, bl].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    }

    // Vector icon paths centered around (0, 0) with radius ~8px (16x16 box).
    function svgIconMarkup(kind, cx, cy, scale, color) {
        const s = scale.toFixed(2);
        const tx = cx.toFixed(2);
        const ty = cy.toFixed(2);
        const c = color;
        switch (kind) {
            case "arrow":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M-6 0H6M1.5 -4.5L6 0L1.5 4.5"/></g>`;
            case "external":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M-4 4L5 -5M-1 -5H5V1"/></g>`;
            case "play":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="${c}"><path d="M-4 -5.5L6 0L-4 5.5Z"/></g>`;
            case "bolt":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="${c}"><path d="M1 -7L-5.5 1H0L-1 7L5.5 -1H0Z"/></g>`;
            case "heart":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="${c}"><path d="M0 5.8C-0.3 5.8-6.5 1.8-6.5-2.3C-6.5-4.7-4.6-6.4-2.4-6.4C-1.1-6.4 0-5.6 0-4.6C0-5.6 1.1-6.4 2.4-6.4C4.6-6.4 6.5-4.7 6.5-2.3C6.5 1.8 0.3 5.8 0 5.8Z"/></g>`;
            case "star":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="${c}"><path d="M0 -6.8L1.9 -2.1L6.9 -1.6L3.1 1.7L4.3 6.6L0 3.9L-4.3 6.6L-3.1 1.7L-6.9 -1.6L-1.9 -2.1Z"/></g>`;
            case "check":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="0" cy="0" r="6.4" stroke-opacity="0.45"/><path d="M-3 0.2L-0.8 2.4L3.4 -2"/></g>`;
            case "sparkles":
                return `<g transform="translate(${tx},${ty}) scale(${s})" fill="${c}"><path d="M-1 -6.8L0.6 -2.2L5.2 -0.6L0.6 1L-1 5.6L-2.6 1L-7.2 -0.6L-2.6 -2.2Z"/><path d="M5.2 -6.5L5.8 -4.6L7.7 -4L5.8 -3.4L5.2 -1.5L4.6 -3.4L2.7 -4L4.6 -4.6Z"/></g>`;
            default:
                return "";
        }
    }

    function cornerRadiusForShape(shape, btnH) {
        if (shape === "sharp") return Math.min(8, btnH * 0.14);
        if (shape === "rounded") return Math.min(16, btnH * 0.28);
        return btnH / 2;
    }

    function triggerButtonDestination(data, elementId) {
        if (!document.body.classList.contains("play-mode-active")) return;
        let href = String(data.href || "").trim();
        if (!href && elementId && typeof _findPluginElementInState === "function") {
            const el = _findPluginElementInState(elementId);
            if (el?.clickLink) href = String(el.clickLink).trim();
        }
        if (!href) return;
        if (/^(https?:|mailto:)/i.test(href)) {
            window.open(href, "_blank", "noopener");
        } else if (href.startsWith("#slide:") && typeof goToLinkedSlide === "function") {
            goToLinkedSlide(href.slice(7));
        }
    }

    SlideForgePlugins.register({
        id: "designer-button",
        version: "1",
        name: "Designer Button",
        description: "OriginKit-inspired interactive designer buttons (Venom symbiote pill, Aurora border beam, Hold to Confirm, Emoji burst, Pulse Like, Liquid morph, Cyber shimmer, 3D keycap)",
        icon: "fa-solid fa-hand-pointer",
        insert: {
            category: "UI & interactive",
            label: "Designer button (OriginKit)",
            keywords: "button cta originkit venom pill shimmer beam hold confirm burst pulse like keycap interactive link backup",
        },
        askOnInsert: false,
        sizeAware: true,
        defaultSize: { width: 260, height: 84 },
        defaultData: defaults,
        fields: [
            {
                key: "style",
                label: "OriginKit button preset",
                type: "select",
                options: Object.entries(STYLE_PRESETS).map(([value, meta]) => ({ value, label: meta.label })),
                hint: "Interactive in Presentation Mode and via Explore in the editor; exports save a high-res vector still.",
            },
            {
                key: "label",
                label: "Button label",
                type: "text",
                primary: true,
                placeholder: "Explore the Data",
            },
            {
                key: "badge",
                label: "Badge / counter / shortcut",
                type: "text",
                placeholder: "LIVE, ⌘K, 128 (blank to hide)",
            },
            {
                key: "icon",
                label: "Icon",
                type: "select",
                options: [
                    { value: "sparkles", label: "Sparkles (✦)" },
                    { value: "arrow", label: "Arrow right (→)" },
                    { value: "external", label: "External / jump (↗)" },
                    { value: "play", label: "Play (▶)" },
                    { value: "bolt", label: "Bolt / Lightning (⚡)" },
                    { value: "heart", label: "Heart (♥)" },
                    { value: "star", label: "Star (★)" },
                    { value: "check", label: "Check / Verified (✓)" },
                    { value: "none", label: "No icon" },
                ],
            },
            {
                key: "iconPosition",
                label: "Icon placement",
                type: "select",
                when: { icon: ["sparkles", "arrow", "external", "play", "bolt", "heart", "star", "check"] },
                options: [
                    { value: "left", label: "Left of label" },
                    { value: "right", label: "Right of label" },
                ],
            },
            {
                key: "accent",
                label: "Primary accent / glow",
                type: "color",
            },
            {
                key: "accent2",
                label: "Secondary gradient / beam",
                type: "color",
            },
            {
                key: "surface",
                label: "Button surface",
                type: "color",
            },
            {
                key: "textColor",
                label: "Label & icon colour",
                type: "color",
            },
            {
                key: "href",
                label: "Click target (#slide:... or https://...)",
                type: "text",
                placeholder: "#slide:next, #slide:last, or https://...",
                hint: "You can also pick any slide or hidden backup slide in the Link section below.",
            },
            {
                key: "shape",
                label: "Corner shape",
                type: "select",
                advanced: true,
                options: [
                    { value: "pill", label: "Pill (full capsule)" },
                    { value: "rounded", label: "Rounded rectangle" },
                    { value: "sharp", label: "Sharp architectural" },
                ],
            },
            {
                key: "fontSize",
                label: "Label size (px)",
                type: "number",
                min: 11,
                max: 36,
                step: 1,
                advanced: true,
            },
            {
                key: "glowIntensity",
                label: "Aura / tendril intensity (%)",
                type: "number",
                min: 0,
                max: 100,
                step: 5,
                advanced: true,
            },
            {
                key: "particles",
                label: "Burst particles (comma-separated)",
                type: "text",
                when: { style: "emoji-burst" },
                advanced: true,
            },
            {
                key: "holdDuration",
                label: "Hold duration (seconds)",
                type: "number",
                min: 0.4,
                max: 3.0,
                step: 0.1,
                when: { style: "hold-confirm" },
                advanced: true,
            },
        ],

        normalize(raw) {
            const d = { ...defaults, ...raw };
            const style = Object.prototype.hasOwnProperty.call(STYLE_PRESETS, d.style) ? d.style : "venom";
            const preset = STYLE_PRESETS[style];
            const num = (v, min, max, fb) => {
                const n = Number(v);
                return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
            };
            return {
                style,
                label: String(d.label ?? preset.defaultLabel).trim().slice(0, 80) || preset.defaultLabel,
                badge: String(d.badge ?? "").trim().slice(0, 24),
                icon: ["sparkles", "arrow", "external", "play", "bolt", "heart", "star", "check", "none"].includes(d.icon)
                    ? d.icon
                    : preset.defaultIcon,
                iconPosition: d.iconPosition === "left" ? "left" : "right",
                shape: ["pill", "rounded", "sharp"].includes(d.shape) ? d.shape : "pill",
                surface: HEX_COLOR.test(String(d.surface || "")) ? d.surface : preset.surface,
                accent: HEX_COLOR.test(String(d.accent || "")) ? d.accent : preset.accent,
                accent2: HEX_COLOR.test(String(d.accent2 || "")) ? d.accent2 : preset.accent2,
                textColor: HEX_COLOR.test(String(d.textColor || "")) ? d.textColor : preset.textColor,
                href: String(d.href ?? "").trim().slice(0, 300),
                fontSize: Math.round(num(d.fontSize, 11, 36, 18)),
                glowIntensity: Math.round(num(d.glowIntensity, 0, 100, 75)),
                particles: String(d.particles ?? defaults.particles).trim().slice(0, 60) || defaults.particles,
                holdDuration: Number(num(d.holdDuration, 0.4, 3.0, 1.0).toFixed(2)),
            };
        },

        async prepare(data, previous) {
            // When the user switches OriginKit preset style in the dropdown, adopt that preset's curated palette & icon
            // if the previous colors/icon still matched the previous preset's defaults.
            if (!previous || !previous.style || previous.style === data.style) return data;
            const prevPreset = STYLE_PRESETS[previous.style];
            const nextPreset = STYLE_PRESETS[data.style];
            if (!prevPreset || !nextPreset) return data;
            const updates = { ...data };
            if (data.surface === prevPreset.surface) updates.surface = nextPreset.surface;
            if (data.accent === prevPreset.accent) updates.accent = nextPreset.accent;
            if (data.accent2 === prevPreset.accent2) updates.accent2 = nextPreset.accent2;
            if (data.textColor === prevPreset.textColor) updates.textColor = nextPreset.textColor;
            if (data.icon === prevPreset.defaultIcon) updates.icon = nextPreset.defaultIcon;
            if (data.label === prevPreset.defaultLabel) updates.label = nextPreset.defaultLabel;
            if (data.badge === prevPreset.defaultBadge) updates.badge = nextPreset.defaultBadge;
            return updates;
        },

        async render(data, context) {
            const W = Math.max(120, Math.round(Number(context.width) || 260));
            const H = Math.max(44, Math.round(Number(context.height) || 84));
            const padX = Math.max(14, Math.round(W * 0.08));
            const padY = Math.max(10, Math.round(H * 0.16));
            const btnX = padX;
            const btnY = data.style === "keycap-3d" ? Math.max(6, padY - 3) : padY;
            const btnW = Math.max(80, W - padX * 2);
            const btnH = Math.max(32, H - padY * 2);
            const rx = cornerRadiusForShape(data.shape, btnH);
            const glowAlpha = (data.glowIntensity / 100) * 0.55;
            const midColor = mixHex(data.accent, data.accent2, 0.5);

            const defs = [];
            const layers = [];

            // Gradients & filters
            defs.push(`
                <linearGradient id="db-grad-accent" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${data.accent}"/>
                    <stop offset="55%" stop-color="${midColor}"/>
                    <stop offset="100%" stop-color="${data.accent2}"/>
                </linearGradient>
                <linearGradient id="db-grad-surface" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="${mixHex(data.surface, "#ffffff", 0.1)}"/>
                    <stop offset="100%" stop-color="${data.surface}"/>
                </linearGradient>
                <linearGradient id="db-grad-sheen" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
                    <stop offset="45%" stop-color="#ffffff" stop-opacity="0.06"/>
                    <stop offset="52%" stop-color="#ffffff" stop-opacity="0.28"/>
                    <stop offset="60%" stop-color="#ffffff" stop-opacity="0.04"/>
                    <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
                </linearGradient>
                <clipPath id="db-clip-pill">
                    <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}" rx="${rx.toFixed(1)}"/>
                </clipPath>
            `);

            // Soft ambient drop glow (drawn with layered translucent rects for universal SVG export compatibility)
            if (glowAlpha > 0.02) {
                for (let i = 3; i >= 1; i--) {
                    const spread = i * 4.5;
                    const op = (glowAlpha / (i * 1.35)).toFixed(3);
                    layers.push(
                        `<rect x="${(btnX - spread).toFixed(1)}" y="${(btnY - spread * 0.65 + 2).toFixed(1)}" width="${(btnW + spread * 2).toFixed(1)}" height="${(btnH + spread * 1.3).toFixed(1)}" rx="${(rx + spread).toFixed(1)}" fill="url(#db-grad-accent)" fill-opacity="${op}"/>`
                    );
                }
            }

            // Style-specific background & decorative elements outside or behind the button body
            if (data.style === "venom") {
                // Symbiote tendrils & organic metaball droplets reaching from the pill rim
                const cy = btnY + btnH / 2;
                const rX = btnX + btnW;
                const lX = btnX;
                const tendrilColor = data.surface;
                const tendrilRim = data.accent;
                layers.push(`
                    <path d="M ${rX - 8} ${cy - 10} C ${rX + 6} ${cy - 12}, ${rX + 12} ${cy - 18}, ${rX + 18} ${cy - 15} C ${rX + 21} ${cy - 13}, ${rX + 16} ${cy - 7}, ${rX - 4} ${cy - 2} Z" fill="${tendrilColor}" stroke="${tendrilRim}" stroke-opacity="0.55" stroke-width="1"/>
                    <path d="M ${rX - 6} ${cy + 3} C ${rX + 10} ${cy + 5}, ${rX + 15} ${cy + 14}, ${rX + 21} ${cy + 11} C ${rX + 23} ${cy + 9}, ${rX + 14} ${cy + 1}, ${rX - 3} ${cy - 3} Z" fill="${tendrilColor}" stroke="${data.accent2}" stroke-opacity="0.5" stroke-width="1"/>
                    <path d="M ${lX + 7} ${cy + 5} C ${lX - 5} ${cy + 8}, ${lX - 11} ${cy + 15}, ${lX - 15} ${cy + 12} C ${lX - 17} ${cy + 10}, ${lX - 9} ${cy + 2}, ${lX + 4} ${cy - 2} Z" fill="${tendrilColor}" stroke="${tendrilRim}" stroke-opacity="0.45" stroke-width="1"/>
                    <circle cx="${(rX + 23).toFixed(1)}" cy="${(cy - 17).toFixed(1)}" r="2.6" fill="${data.accent}" fill-opacity="0.85"/>
                    <circle cx="${(rX + 25).toFixed(1)}" cy="${(cy + 13).toFixed(1)}" r="2.1" fill="${data.accent2}" fill-opacity="0.8"/>
                    <circle cx="${(lX - 18).toFixed(1)}" cy="${(cy + 13).toFixed(1)}" r="1.9" fill="${data.accent}" fill-opacity="0.7"/>
                `);
            } else if (data.style === "keycap-3d") {
                // 3D physical mechanical keycap base skirt + shadow
                const depth = Math.max(5, Math.round(btnH * 0.13));
                layers.push(`
                    <rect x="${btnX}" y="${btnY + depth + 2}" width="${btnW}" height="${btnH}" rx="${rx.toFixed(1)}" fill="#020617" fill-opacity="0.55"/>
                    <rect x="${btnX}" y="${btnY + depth}" width="${btnW}" height="${btnH}" rx="${rx.toFixed(1)}" fill="${mixHex(data.surface, "#000000", 0.45)}" stroke="${mixHex(data.accent, "#000000", 0.35)}" stroke-width="1.2"/>
                `);
            } else if (data.style === "emoji-burst") {
                // Sparkle stars & celebratory particles orbiting the pill corners
                const sparks = [
                    { x: btnX - 8, y: btnY + 6, s: 0.72, c: data.accent },
                    { x: btnX + btnW + 9, y: btnY + 8, s: 0.85, c: data.accent2 },
                    { x: btnX + btnW + 6, y: btnY + btnH - 6, s: 0.62, c: data.accent },
                    { x: btnX - 6, y: btnY + btnH - 8, s: 0.58, c: data.accent2 },
                ];
                sparks.forEach(sp => {
                    layers.push(svgIconMarkup("star", sp.x, sp.y, sp.s, sp.c));
                });
            }

            // Main button body
            const bodyFill = data.style === "neon-shimmer" ? "url(#db-grad-accent)" : "url(#db-grad-surface)";
            const borderStroke =
                data.style === "border-beam" || data.style === "venom" || data.style === "neon-shimmer"
                    ? "url(#db-grad-accent)"
                    : mixHex(data.accent, "#ffffff", 0.22);
            const borderWidth = data.style === "border-beam" ? 2.2 : 1.5;

            layers.push(
                `<rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}" rx="${rx.toFixed(1)}" fill="${bodyFill}" stroke="${borderStroke}" stroke-width="${borderWidth}"/>`
            );

            // Clipped interior details (liquid wave, hold progress bar, glossy specular arc, shimmer sweep)
            const interior = [];
            if (data.style === "liquid-morph") {
                const waveY = btnY + btnH * 0.52;
                interior.push(`
                    <path d="M ${btnX} ${waveY} Q ${btnX + btnW * 0.25} ${waveY - 8}, ${btnX + btnW * 0.5} ${waveY} T ${btnX + btnW} ${waveY} L ${btnX + btnW} ${btnY + btnH} L ${btnX} ${btnY + btnH} Z" fill="url(#db-grad-accent)" fill-opacity="0.42"/>
                    <path d="M ${btnX} ${waveY + 4} Q ${btnX + btnW * 0.3} ${waveY + 11}, ${btnX + btnW * 0.6} ${waveY + 3} T ${btnX + btnW} ${waveY + 5} L ${btnX + btnW} ${btnY + btnH} L ${btnX} ${btnY + btnH} Z" fill="${data.accent}" fill-opacity="0.35"/>
                `);
            } else if (data.style === "hold-confirm") {
                const fillW = Math.round(btnW * 0.34);
                interior.push(`
                    <rect x="${btnX}" y="${btnY}" width="${fillW}" height="${btnH}" fill="url(#db-grad-accent)" fill-opacity="0.28"/>
                    <line x1="${btnX + fillW}" y1="${btnY}" x2="${btnX + fillW}" y2="${btnY + btnH}" stroke="${data.accent}" stroke-width="1.5" stroke-opacity="0.7"/>
                    <rect x="${btnX + 10}" y="${btnY + btnH - 4}" width="${btnW - 20}" height="2" rx="1" fill="#ffffff" fill-opacity="0.14"/>
                    <rect x="${btnX + 10}" y="${btnY + btnH - 4}" width="${Math.round((btnW - 20) * 0.34)}" height="2" rx="1" fill="${data.accent}"/>
                `);
            } else if (data.style === "venom") {
                // Glossy obsidian symbiote highlight & inner Rim
                interior.push(`
                    <ellipse cx="${(btnX + btnW * 0.35).toFixed(1)}" cy="${(btnY + btnH * 0.18).toFixed(1)}" rx="${(btnW * 0.38).toFixed(1)}" ry="${(btnH * 0.22).toFixed(1)}" fill="#ffffff" fill-opacity="0.12"/>
                    <ellipse cx="${(btnX + btnW * 0.72).toFixed(1)}" cy="${(btnY + btnH * 0.88).toFixed(1)}" rx="${(btnW * 0.32).toFixed(1)}" ry="${(btnH * 0.25).toFixed(1)}" fill="${data.accent}" fill-opacity="0.22"/>
                `);
            } else if (data.style === "border-beam") {
                // Spotlight aura at top-right corner
                interior.push(`
                    <circle cx="${(btnX + btnW * 0.82).toFixed(1)}" cy="${(btnY + 4).toFixed(1)}" r="${(btnH * 0.85).toFixed(1)}" fill="${data.accent}" fill-opacity="0.2"/>
                    <circle cx="${(btnX + btnW * 0.2).toFixed(1)}" cy="${(btnY + btnH).toFixed(1)}" r="${(btnH * 0.7).toFixed(1)}" fill="${data.accent2}" fill-opacity="0.16"/>
                `);
            }

            // Diagonal sheen + top specular hairline inside the button
            interior.push(`
                <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}" fill="url(#db-grad-sheen)"/>
                <rect x="${btnX + 1.5}" y="${btnY + 1.5}" width="${btnW - 3}" height="${Math.max(8, btnH * 0.42).toFixed(1)}" rx="${Math.max(4, rx - 1.5).toFixed(1)}" fill="#ffffff" fill-opacity="0.06"/>
            `);
            layers.push(`<g clip-path="url(#db-clip-pill)">${interior.join("")}</g>`);

            // Keycap inner dish bevel
            if (data.style === "keycap-3d") {
                layers.push(
                    `<rect x="${btnX + 5}" y="${btnY + 4}" width="${btnW - 10}" height="${btnH - 9}" rx="${Math.max(4, rx - 4).toFixed(1)}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>`
                );
            }

            // Measure and lay out [Icon] [Label] [Badge] horizontally centered inside the button pill
            const fontSize = Math.min(data.fontSize, Math.round(btnH * 0.46));
            const labelStyle = { size: fontSize, weight: 700, family: FONT };
            const badgeFontSize = Math.max(10, Math.round(fontSize * 0.72));
            const badgeStyle = { size: badgeFontSize, weight: 700, family: FONT };

            const hasIcon = data.icon && data.icon !== "none";
            const iconBoxSize = hasIcon ? Math.round(fontSize * 1.15) : 0;
            const iconGap = hasIcon ? Math.round(fontSize * 0.5) : 0;

            const badgeText = data.badge;
            const badgeTextW = badgeText ? context.measureText(badgeText, badgeStyle) : 0;
            const badgePadX = badgeText ? Math.round(badgeFontSize * 0.65) : 0;
            const badgeW = badgeText ? Math.round(badgeTextW + badgePadX * 2) : 0;
            const badgeH = badgeText ? Math.round(badgeFontSize * 1.55) : 0;
            const badgeGap = badgeText ? Math.round(fontSize * 0.55) : 0;

            const maxLabelRoom = Math.max(30, btnW - 28 - (hasIcon ? iconBoxSize + iconGap : 0) - (badgeText ? badgeW + badgeGap : 0));
            let shownLabel = data.label;
            if (context.measureText(shownLabel, labelStyle) > maxLabelRoom) {
                let lo = 1;
                let hi = shownLabel.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (context.measureText(`${shownLabel.slice(0, mid)}…`, labelStyle) <= maxLabelRoom) lo = mid;
                    else hi = mid - 1;
                }
                shownLabel = `${shownLabel.slice(0, lo)}…`;
            }
            const labelW = context.measureText(shownLabel, labelStyle);
            const totalContentW = labelW + (hasIcon ? iconBoxSize + iconGap : 0) + (badgeText ? badgeW + badgeGap : 0);

            let cursorX = btnX + (btnW - totalContentW) / 2;
            const centerY = btnY + btnH / 2;
            const textBaselineY = centerY + fontSize * 0.35;

            const iconColor = data.style === "neon-shimmer" ? data.textColor : mixHex(data.accent, data.textColor, 0.35);
            const iconScale = (fontSize / 16) * 0.95;

            if (hasIcon && data.iconPosition === "left") {
                const icX = cursorX + iconBoxSize / 2;
                if (data.style === "hold-confirm") {
                    layers.push(`<circle cx="${icX.toFixed(1)}" cy="${centerY.toFixed(1)}" r="${(iconBoxSize * 0.62).toFixed(1)}" fill="none" stroke="${data.accent}" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="16 8"/>`);
                }
                layers.push(svgIconMarkup(data.icon, icX, centerY, iconScale, iconColor));
                cursorX += iconBoxSize + iconGap;
            }

            // Main button label
            layers.push(
                `<text x="${cursorX.toFixed(1)}" y="${textBaselineY.toFixed(1)}" font-size="${fontSize}" font-weight="700" fill="${data.textColor}" letter-spacing="0.2">${context.escapeXml(shownLabel)}</text>`
            );
            cursorX += labelW;

            // Optional pill badge / shortcut / counter
            if (badgeText) {
                cursorX += badgeGap;
                const bx = cursorX;
                const by = centerY - badgeH / 2;
                const brx = data.style === "keycap-3d" ? 5 : badgeH / 2;
                const badgeBg = data.style === "neon-shimmer" ? "#09090b" : data.accent;
                const badgeBgOpacity = data.style === "neon-shimmer" ? "0.35" : "0.22";
                const badgeStrokeOp = data.style === "neon-shimmer" ? "0.45" : "0.55";
                layers.push(`
                    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${badgeW}" height="${badgeH}" rx="${brx.toFixed(1)}" fill="${badgeBg}" fill-opacity="${badgeBgOpacity}" stroke="${data.accent2}" stroke-opacity="${badgeStrokeOp}" stroke-width="1"/>
                    <text x="${(bx + badgeW / 2).toFixed(1)}" y="${(centerY + badgeFontSize * 0.35).toFixed(1)}" text-anchor="middle" font-size="${badgeFontSize}" font-weight="700" fill="${data.textColor}">${context.escapeXml(badgeText)}</text>
                `);
                cursorX += badgeW;
            }

            if (hasIcon && data.iconPosition !== "left") {
                cursorX += iconGap;
                const icX = cursorX + iconBoxSize / 2;
                if (data.style === "hold-confirm") {
                    layers.push(`<circle cx="${icX.toFixed(1)}" cy="${centerY.toFixed(1)}" r="${(iconBoxSize * 0.62).toFixed(1)}" fill="none" stroke="${data.accent}" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="16 8"/>`);
                }
                layers.push(svgIconMarkup(data.icon, icX, centerY, iconScale, iconColor));
            }

            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><defs>${defs.join("")}</defs>${layers.join("")}</svg>`;
        },

        mount(host, data, context) {
            host.style.background = "transparent";
            host.style.overflow = "visible";
            const siblingImg = host.parentElement?.querySelector("img");
            if (siblingImg) siblingImg.hidden = true;

            const elementNode = host.closest(".canvas-element, .slide-element");
            const elementId = elementNode?.id || elementNode?.dataset?.id || null;

            const root = document.createElement("div");
            root.className = "sf-originkit-live-root";
            root.style.cssText = `
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                -webkit-user-select: none;
                font-family: ${context.fontFamily || FONT};
                overflow: visible;
            `;

            // Background canvas for Venom symbiote tendrils & Emoji/Star burst physics particles
            const fxCanvas = document.createElement("canvas");
            fxCanvas.style.cssText = `
                position: absolute;
                inset: -24px;
                width: calc(100% + 48px);
                height: calc(100% + 48px);
                pointer-events: none;
                z-index: 1;
            `;
            root.appendChild(fxCanvas);

            const W = Math.max(120, Math.round(Number(context.width) || 260));
            const H = Math.max(44, Math.round(Number(context.height) || 84));
            const padX = Math.max(14, Math.round(W * 0.08));
            const padY = Math.max(10, Math.round(H * 0.16));
            const btnW = Math.max(80, W - padX * 2);
            const btnH = Math.max(32, H - padY * 2);
            const rx = cornerRadiusForShape(data.shape, btnH);
            const fontSize = Math.min(data.fontSize, Math.round(btnH * 0.46));
            const badgeFontSize = Math.max(10, Math.round(fontSize * 0.72));
            const glowAlpha = (data.glowIntensity / 100) * 0.6;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("aria-label", data.label);
            const isNeon = data.style === "neon-shimmer";
            const isKeycap = data.style === "keycap-3d";
            const keycapDepth = Math.max(5, Math.round(btnH * 0.13));

            btn.style.cssText = `
                position: relative;
                z-index: 2;
                width: ${btnW}px;
                height: ${btnH}px;
                border-radius: ${rx}px;
                border: ${data.style === "border-beam" ? "2px" : "1.5px"} solid ${rgba(data.accent, 0.65)};
                background: ${
                    isNeon
                        ? `linear-gradient(135deg, ${data.accent} 0%, ${mixHex(data.accent, data.accent2, 0.5)} 50%, ${data.accent2} 100%)`
                        : `linear-gradient(180deg, ${mixHex(data.surface, "#ffffff", 0.1)} 0%, ${data.surface} 100%)`
                };
                color: ${data.textColor};
                font-size: ${fontSize}px;
                font-weight: 700;
                letter-spacing: 0.2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: ${Math.round(fontSize * 0.48)}px;
                padding: 0 18px;
                cursor: pointer;
                overflow: hidden;
                outline: none;
                box-shadow: ${
                    isKeycap
                        ? `0 ${keycapDepth}px 0 ${mixHex(data.surface, "#000000", 0.5)}, 0 ${keycapDepth + 6}px 18px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.18)`
                        : `0 8px 26px -4px ${rgba(data.accent, glowAlpha)}, 0 0 18px 0 ${rgba(data.accent2, glowAlpha * 0.55)}, inset 0 1px 0 rgba(255,255,255,0.18)`
                };
                transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.22s ease, border-color 0.2s ease;
                transform: translateY(${isKeycap ? -2 : 0}px);
            `;

            // Dynamic cursor-tracking radial spotlight & liquid fill overlay inside the button
            const spotlight = document.createElement("div");
            spotlight.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                background: radial-gradient(circle 75px at 50% 50%, ${rgba(data.accent, 0.35)}, transparent 100%);
                opacity: 0;
                transition: opacity 0.2s ease;
            `;
            btn.appendChild(spotlight);

            // Liquid fill / Hold-to-confirm progress layer
            const progressFill = document.createElement("div");
            progressFill.style.cssText = `
                position: absolute;
                left: 0;
                bottom: 0;
                width: ${data.style === "hold-confirm" ? "0%" : "100%"};
                height: ${data.style === "liquid-morph" ? "38%" : "100%"};
                background: linear-gradient(90deg, ${rgba(data.accent, 0.48)}, ${rgba(data.accent2, 0.52)});
                pointer-events: none;
                transition: ${data.style === "hold-confirm" ? "none" : "height 0.32s cubic-bezier(0.22, 1, 0.36, 1)"};
            `;
            if (data.style === "hold-confirm" || data.style === "liquid-morph") {
                btn.appendChild(progressFill);
            }

            // Sweeping metallic sheen layer
            const sheen = document.createElement("div");
            sheen.style.cssText = `
                position: absolute;
                top: 0;
                bottom: 0;
                left: -120%;
                width: 85%;
                background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0.05) 65%, transparent 100%);
                transform: skewX(-24deg);
                pointer-events: none;
            `;
            btn.appendChild(sheen);

            // Build inline SVG icon node
            const makeIconNode = () => {
                if (!data.icon || data.icon === "none") return null;
                const wrap = document.createElement("span");
                wrap.style.cssText = `
                    position: relative;
                    z-index: 2;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: ${Math.round(fontSize * 1.15)}px;
                    height: ${Math.round(fontSize * 1.15)}px;
                    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
                `;
                const iconColor = isNeon ? data.textColor : mixHex(data.accent, data.textColor, 0.35);
                wrap.innerHTML = `<svg viewBox="-9 -9 18 18" width="100%" height="100%" style="overflow:visible">${svgIconMarkup(data.icon, 0, 0, 1, iconColor)}</svg>`;
                return wrap;
            };

            const iconNode = makeIconNode();
            const labelSpan = document.createElement("span");
            labelSpan.style.cssText = "position: relative; z-index: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
            labelSpan.textContent = data.label;

            let liveLikeCount = parseInt(data.badge, 10);
            if (!Number.isFinite(liveLikeCount)) liveLikeCount = 128;
            let liked = false;

            let badgeSpan = null;
            if (data.badge || data.style === "pulse-like" || data.style === "hold-confirm") {
                badgeSpan = document.createElement("span");
                badgeSpan.style.cssText = `
                    position: relative;
                    z-index: 2;
                    font-size: ${badgeFontSize}px;
                    font-weight: 700;
                    padding: 2px ${Math.round(badgeFontSize * 0.65)}px;
                    border-radius: ${isKeycap ? "5px" : "999px"};
                    background: ${isNeon ? "rgba(9,9,11,0.38)" : rgba(data.accent, 0.25)};
                    border: 1px solid ${rgba(data.accent2, 0.55)};
                    color: ${data.textColor};
                    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease;
                `;
                badgeSpan.textContent = data.badge || (data.style === "pulse-like" ? String(liveLikeCount) : "HOLD");
            }

            if (iconNode && data.iconPosition === "left") btn.appendChild(iconNode);
            btn.appendChild(labelSpan);
            if (badgeSpan) btn.appendChild(badgeSpan);
            if (iconNode && data.iconPosition !== "left") btn.appendChild(iconNode);

            root.appendChild(btn);
            host.appendChild(root);

            // Interactive state for 60fps canvas animation (Venom tendrils, Border Beam, Emoji particles, Shockwave rings)
            const pointer = { x: W / 2, y: H / 2, inside: false, near: false };
            const particles = [];
            const tendrils = [
                { angle: -0.35, reach: 0, targetReach: 0, phase: 0.4, color: data.accent },
                { angle: 0.28, reach: 0, targetReach: 0, phase: 1.9, color: data.accent2 },
                { angle: 2.8, reach: 0, targetReach: 0, phase: 3.5, color: data.accent },
                { angle: -2.7, reach: 0, targetReach: 0, phase: 5.1, color: data.accent2 },
            ];
            let beamAngle = 0;
            let sheenPhase = -120;
            let holdStartTs = 0;
            let holdConfirmed = false;
            let rafId = 0;

            const spawnParticleBurst = (originX, originY) => {
                const symbols = data.particles
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean);
                const count = data.style === "emoji-burst" ? 16 : 10;
                for (let i = 0; i < count; i++) {
                    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
                    const speed = 2.2 + Math.random() * 3.4;
                    particles.push({
                        x: originX,
                        y: originY,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed - 1.4,
                        life: 1,
                        decay: 0.022 + Math.random() * 0.015,
                        size: 11 + Math.random() * 7,
                        symbol: data.style === "emoji-burst" && symbols.length ? symbols[i % symbols.length] : null,
                        color: i % 2 === 0 ? data.accent : data.accent2,
                    });
                }
            };

            const onPointerMove = e => {
                const rect = root.getBoundingClientRect();
                const scaleX = W / Math.max(1, rect.width);
                const scaleY = H / Math.max(1, rect.height);
                pointer.x = (e.clientX - rect.left) * scaleX;
                pointer.y = (e.clientY - rect.top) * scaleY;
                pointer.near = true;

                const btnRect = btn.getBoundingClientRect();
                const localX = e.clientX - btnRect.left;
                const localY = e.clientY - btnRect.top;
                spotlight.style.background = `radial-gradient(circle 85px at ${localX.toFixed(0)}px ${localY.toFixed(0)}px, ${rgba(data.accent2, 0.38)}, transparent 100%)`;
            };

            root.addEventListener("pointermove", onPointerMove, { signal: context.signal });
            root.addEventListener(
                "pointerleave",
                () => {
                    pointer.near = false;
                    pointer.inside = false;
                    spotlight.style.opacity = "0";
                },
                { signal: context.signal }
            );

            btn.addEventListener(
                "pointerenter",
                () => {
                    pointer.inside = true;
                    spotlight.style.opacity = "1";
                    if (!isKeycap) {
                        btn.style.transform = "translateY(-2px) scale(1.02)";
                    }
                    if (iconNode) {
                        iconNode.style.transform = data.icon === "arrow" ? "translateX(3px)" : "scale(1.16) rotate(8deg)";
                    }
                    if (data.style === "liquid-morph") {
                        progressFill.style.height = "100%";
                    }
                },
                { signal: context.signal }
            );

            btn.addEventListener(
                "pointerleave",
                () => {
                    pointer.inside = false;
                    holdStartTs = 0;
                    if (!holdConfirmed && data.style === "hold-confirm") {
                        progressFill.style.width = "0%";
                        labelSpan.textContent = data.label;
                    }
                    btn.style.transform = `translateY(${isKeycap ? -2 : 0}px) scale(1)`;
                    if (iconNode) iconNode.style.transform = "none";
                    if (data.style === "liquid-morph") {
                        progressFill.style.height = "38%";
                    }
                },
                { signal: context.signal }
            );

            btn.addEventListener(
                "pointerdown",
                e => {
                    e.stopPropagation();
                    if (isKeycap) {
                        btn.style.transform = `translateY(${keycapDepth - 2}px)`;
                        btn.style.boxShadow = `0 1px 0 ${mixHex(data.surface, "#000000", 0.5)}, 0 2px 6px rgba(2,6,23,0.45), inset 0 1px 0 rgba(255,255,255,0.15)`;
                    } else {
                        btn.style.transform = "scale(0.97)";
                    }
                    if (data.style === "hold-confirm") {
                        holdConfirmed = false;
                        holdStartTs = performance.now();
                    }
                },
                { signal: context.signal }
            );

            btn.addEventListener(
                "pointerup",
                e => {
                    e.stopPropagation();
                    if (isKeycap) {
                        btn.style.transform = "translateY(-2px)";
                        btn.style.boxShadow = `0 ${keycapDepth}px 0 ${mixHex(data.surface, "#000000", 0.5)}, 0 ${keycapDepth + 6}px 18px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.18)`;
                    } else {
                        btn.style.transform = pointer.inside ? "translateY(-2px) scale(1.02)" : "scale(1)";
                    }

                    if (data.style === "hold-confirm") {
                        if (!holdConfirmed) {
                            holdStartTs = 0;
                            progressFill.style.width = "0%";
                            labelSpan.textContent = data.label;
                            if (badgeSpan) badgeSpan.textContent = data.badge || `${data.holdDuration}s`;
                        }
                        return;
                    }

                    // Standard click micro-interaction + particle burst
                    spawnParticleBurst(pointer.x || W / 2, pointer.y || H / 2);

                    if (data.style === "pulse-like") {
                        liked = !liked;
                        liveLikeCount += liked ? 1 : -1;
                        if (badgeSpan) {
                            badgeSpan.textContent = String(liveLikeCount);
                            badgeSpan.style.transform = "scale(1.28)";
                            setTimeout(() => {
                                if (badgeSpan) badgeSpan.style.transform = "scale(1)";
                            }, 200);
                        }
                    }

                    triggerButtonDestination(data, elementId);
                },
                { signal: context.signal }
            );

            const step = now => {
                if (context.signal.aborted) return;
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const cw = W + 48;
                const ch = H + 48;
                if (fxCanvas.width !== Math.round(cw * dpr) || fxCanvas.height !== Math.round(ch * dpr)) {
                    fxCanvas.width = Math.round(cw * dpr);
                    fxCanvas.height = Math.round(ch * dpr);
                }
                const ctx = fxCanvas.getContext("2d");
                ctx.save();
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, cw, ch);
                ctx.translate(24, 24);

                // 1. Border beam continuous conic orbit
                if (data.style === "border-beam") {
                    beamAngle = (beamAngle + 2.2) % 360;
                    btn.style.borderColor = beamAngle < 180 ? data.accent : data.accent2;
                }

                // 2. Cyber shimmer periodic sweep
                if (data.style === "neon-shimmer" || pointer.inside) {
                    sheenPhase += 2.6;
                    if (sheenPhase > 220) sheenPhase = -120;
                    sheen.style.left = `${sheenPhase}%`;
                }

                // 3. Hold-to-confirm live progress charging
                if (data.style === "hold-confirm" && holdStartTs > 0 && !holdConfirmed) {
                    const elapsed = (now - holdStartTs) / 1000;
                    const pct = Math.min(1, elapsed / Math.max(0.3, data.holdDuration));
                    progressFill.style.width = `${(pct * 100).toFixed(1)}%`;
                    if (badgeSpan) badgeSpan.textContent = `${Math.round(pct * 100)}%`;
                    if (pct >= 1) {
                        holdConfirmed = true;
                        holdStartTs = 0;
                        labelSpan.textContent = "Confirmed ✓";
                        if (badgeSpan) badgeSpan.textContent = "DONE";
                        spawnParticleBurst(W / 2, H / 2);
                        triggerButtonDestination(data, elementId);
                    }
                }

                // 4. Venom symbiote tendrils reaching toward pointer
                if (data.style === "venom") {
                    const cx = W / 2;
                    const cy = H / 2;
                    const dx = pointer.x - cx;
                    const dy = pointer.y - cy;
                    const dist = Math.hypot(dx, dy);
                    const pointerAngle = Math.atan2(dy, dx);

                    tendrils.forEach((td, idx) => {
                        const wobble = Math.sin(now * 0.004 + td.phase) * 0.18;
                        const activeAngle = pointer.near ? pointerAngle + (idx - 1.5) * 0.28 + wobble : td.angle + wobble;
                        const target = pointer.near ? Math.min(26, Math.max(10, dist * 0.22)) : 8 + Math.sin(now * 0.003 + td.phase) * 3;
                        td.reach += (target - td.reach) * 0.14;

                        const rimX = cx + Math.cos(activeAngle) * (btnW * 0.46);
                        const rimY = cy + Math.sin(activeAngle) * (btnH * 0.44);
                        const tipX = rimX + Math.cos(activeAngle) * td.reach;
                        const tipY = rimY + Math.sin(activeAngle) * td.reach;
                        const perpX = -Math.sin(activeAngle) * 7;
                        const perpY = Math.cos(activeAngle) * 7;

                        ctx.beginPath();
                        ctx.moveTo(rimX + perpX, rimY + perpY);
                        ctx.quadraticCurveTo(
                            (rimX + tipX) * 0.5 + perpX * 0.4,
                            (rimY + tipY) * 0.5 + perpY * 0.4,
                            tipX,
                            tipY
                        );
                        ctx.quadraticCurveTo(
                            (rimX + tipX) * 0.5 - perpX * 0.4,
                            (rimY + tipY) * 0.5 - perpY * 0.4,
                            rimX - perpX,
                            rimY - perpY
                        );
                        ctx.closePath();
                        ctx.fillStyle = data.surface;
                        ctx.fill();
                        ctx.lineWidth = 1.2;
                        ctx.strokeStyle = rgba(td.color, 0.75);
                        ctx.stroke();

                        // Symbiote droplet at tip
                        ctx.beginPath();
                        ctx.arc(tipX + Math.cos(activeAngle) * 4, tipY + Math.sin(activeAngle) * 4, 2.3, 0, Math.PI * 2);
                        ctx.fillStyle = td.color;
                        ctx.fill();
                    });
                }

                // 5. Render burst particles (Emoji / Star / Confirm fountain)
                for (let i = particles.length - 1; i >= 0; i--) {
                    const p = particles[i];
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.12; // gravity
                    p.life -= p.decay;
                    if (p.life <= 0) {
                        particles.splice(i, 1);
                        continue;
                    }
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, p.life);
                    if (p.symbol) {
                        ctx.font = `${Math.round(p.size)}px ${FONT}`;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(p.symbol, p.x, p.y);
                    } else {
                        ctx.fillStyle = p.color;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.size * 0.25, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }

                ctx.restore();
                rafId = requestAnimationFrame(step);
            };

            rafId = requestAnimationFrame(step);

            return () => {
                cancelAnimationFrame(rafId);
                if (siblingImg) siblingImg.hidden = false;
                root.remove();
            };
        },
    });
})();
