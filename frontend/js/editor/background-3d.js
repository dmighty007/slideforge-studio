/**
 * 3D SLIDE BACKGROUND SYSTEM
 * Provides multiple 3D background styles with performance optimization
 * Supports particles, waves, gradients, and dynamic effects
 */

/* ─── 3D Background Styles ──────────────────────────────────────────────── */

const BACKGROUND_STYLES_3D = {
    "particle-float": {
        name: "Floating Particles",
        description: "Subtle floating particles with parallax effect",
        category: "particle",
        complexity: "low",
        performance: "high",
        animated: true,
    },
    "particle-burst": {
        name: "Particle Burst",
        description: "Dynamic particles bursting from center",
        category: "particle",
        complexity: "medium",
        performance: "medium",
        animated: true,
    },
    "wave-ripple": {
        name: "Wave Ripple",
        description: "Gentle ripple waves across background",
        category: "wave",
        complexity: "medium",
        performance: "medium",
        animated: true,
    },
    "wave-mesh": {
        name: "Mesh Wave",
        description: "3D mesh waves with gradient",
        category: "wave",
        complexity: "high",
        performance: "medium",
        animated: true,
    },
    "gradient-orbit": {
        name: "Orbiting Gradients",
        description: "Rotating gradient orbs",
        category: "gradient",
        complexity: "low",
        performance: "high",
        animated: true,
    },
    "gradient-nebula": {
        name: "Nebula",
        description: "Cosmic nebula effect with gradients",
        category: "gradient",
        complexity: "medium",
        performance: "high",
        animated: false,
    },
    "sphere-cluster": {
        name: "Sphere Cluster",
        description: "Floating 3D spheres",
        category: "3d-object",
        complexity: "high",
        performance: "low",
        animated: true,
    },
    "cube-matrix": {
        name: "Cube Matrix",
        description: "3D cube grid with animation",
        category: "3d-object",
        complexity: "high",
        performance: "low",
        animated: true,
    },
    "grid-3d": {
        name: "3D Grid",
        description: "Perspective 3D grid",
        category: "3d-object",
        complexity: "medium",
        performance: "medium",
        animated: true,
    },
    "blob-morph": {
        name: "Morphing Blobs",
        description: "Organic blob shapes morphing",
        category: "organic",
        complexity: "medium",
        performance: "high",
        animated: true,
    },
    "dot-pattern": {
        name: "Dot Pattern",
        description: "Interactive dot pattern",
        category: "pattern",
        complexity: "low",
        performance: "high",
        animated: false,
    },
    "mesh-gradient": {
        name: "Mesh Gradient",
        description: "Colorful mesh gradient",
        category: "gradient",
        complexity: "low",
        performance: "high",
        animated: false,
    },
    aurora: {
        name: "Aurora Borealis",
        description: "Northern lights effect",
        category: "natural",
        complexity: "high",
        performance: "medium",
        animated: true,
    },
    geometric: {
        name: "Geometric Shapes",
        description: "Abstract geometric composition",
        category: "geometric",
        complexity: "medium",
        performance: "high",
        animated: false,
    },
    liquid: {
        name: "Liquid Effect",
        description: "Flowing liquid shapes",
        category: "organic",
        complexity: "high",
        performance: "medium",
        animated: true,
    },
};

const BACKGROUND_CATEGORIES = {
    particle: {
        name: "Particles",
        description: "Floating and dynamic particles",
        icon: "fa-solid fa-sparkles",
    },
    wave: {
        name: "Waves",
        description: "Wave and ripple effects",
        icon: "fa-solid fa-water",
    },
    gradient: {
        name: "Gradients",
        description: "Gradient and color effects",
        icon: "fa-solid fa-palette",
    },
    "3d-object": {
        name: "3D Objects",
        description: "3D geometric objects",
        icon: "fa-solid fa-cube",
    },
    organic: {
        name: "Organic",
        description: "Natural flowing shapes",
        icon: "fa-solid fa-leaf",
    },
    pattern: {
        name: "Patterns",
        description: "Geometric patterns",
        icon: "fa-solid fa-grid-2",
    },
    natural: {
        name: "Natural",
        description: "Natural phenomena",
        icon: "fa-solid fa-sun",
    },
    geometric: {
        name: "Geometric",
        description: "Abstract geometry",
        icon: "fa-solid fa-shapes",
    },
};

/* ─── Canvas 3D Background Renderer ──────────────────────────────────────── */

class Canvas3DBackground {
    constructor(canvasElement, style = "particle-float", theme = {}) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext("2d");
        this.style = style;
        this.theme = theme;
        this.animationId = null;
        this.particles = [];
        this.time = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        this.isAnimating = false;

        this.setupCanvas();
        this.initStyle();
        this.setupEventListeners();
    }

    setupCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
    }

    initStyle() {
        const styleConfig = BACKGROUND_STYLES_3D[this.style];
        if (!styleConfig) return;

        switch (styleConfig.category) {
            case "particle":
                this.initParticles();
                break;
            case "wave":
                this.initWaves();
                break;
            case "gradient":
                this.initGradients();
                break;
            case "3d-object":
                this.init3DObjects();
                break;
            case "organic":
                this.initOrganic();
                break;
            case "pattern":
                this.initPattern();
                break;
            case "natural":
                this.initNatural();
                break;
            case "geometric":
                this.initGeometric();
                break;
        }
    }

    /* ─── Particle Backgrounds ──────────────────────────────────────────────── */

    initParticles() {
        if (this.style === "particle-float") {
            for (let i = 0; i < 50; i++) {
                this.particles.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    vx: (Math.random() - 0.5) * 1,
                    vy: (Math.random() - 0.5) * 1,
                    size: Math.random() * 2 + 1,
                    opacity: Math.random() * 0.5 + 0.2,
                    color: this.theme.accentSoft || "rgba(59, 130, 246, 0.3)",
                });
            }
        } else if (this.style === "particle-burst") {
            for (let i = 0; i < 100; i++) {
                const angle = (Math.PI * 2 * i) / 100;
                this.particles.push({
                    x: this.width / 2,
                    y: this.height / 2,
                    vx: Math.cos(angle) * 2,
                    vy: Math.sin(angle) * 2,
                    size: Math.random() * 3 + 1,
                    opacity: 0.6,
                    color: this.theme.accentStrong || "#3B82F6",
                    life: 1,
                    decay: 0.01,
                });
            }
        }
        this.startAnimation();
    }

    /* ─── Wave Backgrounds ──────────────────────────────────────────────────── */

    initWaves() {
        this.startAnimation();
    }

    /* ─── Gradient Backgrounds ──────────────────────────────────────────────── */

    initGradients() {
        if (this.style === "gradient-orbit") {
            this.orbits = [
                { radius: 100, speed: 0.001, color: this.theme.accentStrong },
                { radius: 150, speed: 0.0008, color: this.theme.accentSoft },
                { radius: 200, speed: 0.0006, color: this.theme.defaultShapeColor },
            ];
            this.startAnimation();
        } else if (this.style === "gradient-nebula") {
            this.drawNebula();
        } else if (this.style === "mesh-gradient") {
            this.drawMeshGradient();
        }
    }

    /* ─── 3D Objects ────────────────────────────────────────────────────────── */

    init3DObjects() {
        if (this.style === "grid-3d") {
            this.startAnimation();
        } else if (this.style === "sphere-cluster") {
            for (let i = 0; i < 20; i++) {
                this.particles.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    z: Math.random() * 200 - 100,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    vz: (Math.random() - 0.5) * 2,
                    size: Math.random() * 20 + 10,
                    color: this.theme.accentStrong,
                });
            }
            this.startAnimation();
        }
    }

    /* ─── Organic Shapes ────────────────────────────────────────────────────── */

    initOrganic() {
        if (this.style === "blob-morph") {
            this.blobs = [
                { x: this.width * 0.3, y: this.height * 0.3, phase: 0, color: this.theme.accentStrong },
                { x: this.width * 0.7, y: this.height * 0.7, phase: Math.PI / 2, color: this.theme.accentSoft },
                { x: this.width * 0.5, y: this.height * 0.2, phase: Math.PI, color: this.theme.defaultShapeColor },
            ];
            this.startAnimation();
        } else if (this.style === "liquid") {
            this.startAnimation();
        }
    }

    /* ─── Patterns ──────────────────────────────────────────────────────────── */

    initPattern() {
        if (this.style === "dot-pattern") {
            this.drawDotPattern();
        }
    }

    /* ─── Natural Effects ──────────────────────────────────────────────────── */

    initNatural() {
        if (this.style === "aurora") {
            this.startAnimation();
        }
    }

    /* ─── Geometric ─────────────────────────────────────────────────────────── */

    initGeometric() {
        this.drawGeometric();
    }

    /* ─── Animation Loop ────────────────────────────────────────────────────── */

    startAnimation() {
        const animate = () => {
            this.time++;
            this.clear();

            switch (this.style) {
                case "particle-float":
                case "particle-burst":
                    this.updateAndDrawParticles();
                    break;
                case "wave-ripple":
                    this.drawWaveRipple();
                    break;
                case "wave-mesh":
                    this.drawWaveMesh();
                    break;
                case "gradient-orbit":
                    this.drawOrbitingGradients();
                    break;
                case "sphere-cluster":
                    this.drawSphereClusters();
                    break;
                case "grid-3d":
                    this.draw3DGrid();
                    break;
                case "blob-morph":
                    this.drawMorphingBlobs();
                    break;
                case "aurora":
                    this.drawAurora();
                    break;
                case "liquid":
                    this.drawLiquid();
                    break;
            }

            this.isAnimating && (this.animationId = requestAnimationFrame(animate));
        };

        this.isAnimating = true;
        this.animationId = requestAnimationFrame(animate);
    }

    clear() {
        this.ctx.fillStyle = this.theme.cssVars?.["--slide-bg"] || "transparent";
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /* ─── Particle Animation ────────────────────────────────────────────────── */

    updateAndDrawParticles() {
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = this.width;
            if (p.x > this.width) p.x = 0;
            if (p.y < 0) p.y = this.height;
            if (p.y > this.height) p.y = 0;

            if (p.decay) {
                p.life -= p.decay;
                if (p.life < 0) return;
                p.opacity = p.life * 0.6;
            }

            this.ctx.fillStyle = p.color.replace("0.", `${p.opacity}.`);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Remove dead particles
        this.particles = this.particles.filter(p => !p.decay || p.life > 0);
    }

    /* ─── Wave Effects ──────────────────────────────────────────────────────── */

    drawWaveRipple() {
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const color = this.theme.accentStrong || "#3B82F6";

        for (let wave = 0; wave < 5; wave++) {
            const radius = (this.time + wave * 20) % 400;
            const alpha = Math.max(0, 1 - radius / 400);

            this.ctx.strokeStyle = color.replace(")", `, ${alpha * 0.3})`);
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawWaveMesh() {
        const gridSize = 40;
        const waveAmplitude = 30;
        const waveFrequency = 0.05;

        this.ctx.strokeStyle = this.theme.defaultShapeColor + "40";
        this.ctx.lineWidth = 1;

        for (let x = 0; x < this.width; x += gridSize) {
            this.ctx.beginPath();
            for (let y = 0; y < this.height; y += 5) {
                const offset = Math.sin((y + this.time) * waveFrequency) * waveAmplitude;
                this.ctx.lineTo(x + offset, y);
            }
            this.ctx.stroke();
        }

        for (let y = 0; y < this.height; y += gridSize) {
            this.ctx.beginPath();
            for (let x = 0; x < this.width; x += 5) {
                const offset = Math.cos((x + this.time) * waveFrequency) * waveAmplitude;
                this.ctx.lineTo(x, y + offset);
            }
            this.ctx.stroke();
        }
    }

    /* ─── Gradient Effects ──────────────────────────────────────────────────── */

    drawOrbitingGradients() {
        const centerX = this.width / 2;
        const centerY = this.height / 2;

        this.orbits.forEach((orbit, i) => {
            const angle = this.time * orbit.speed;
            const x = centerX + Math.cos(angle) * orbit.radius;
            const y = centerY + Math.sin(angle) * orbit.radius;

            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, 80);
            gradient.addColorStop(0, orbit.color + "80");
            gradient.addColorStop(1, orbit.color + "00");

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, this.width, this.height);
        });
    }

    drawNebula() {
        const colors = [
            this.theme.accentStrong || "#3B82F6",
            this.theme.accentSoft || "rgba(59,130,246,0.3)",
            this.theme.defaultShapeColor || "#A7C7E7",
        ];

        const grad = this.ctx.createLinearGradient(0, 0, this.width, this.height);
        colors.forEach((color, i) => {
            grad.addColorStop(i / (colors.length - 1), color);
        });

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Add noise effect
        this.addNoise(0.3);
    }

    drawMeshGradient() {
        const points = [
            { x: 0, y: 0, color: this.theme.accentStrong },
            { x: this.width, y: 0, color: this.theme.accentSoft },
            { x: this.width, y: this.height, color: this.theme.defaultShapeColor },
            { x: 0, y: this.height, color: this.theme.accentStrong },
        ];

        const centerX = this.width / 2;
        const centerY = this.height / 2;

        points.forEach(p => {
            const grad = this.ctx.createRadialGradient(p.x, p.y, 0, centerX, centerY, 500);
            grad.addColorStop(0, p.color + "40");
            grad.addColorStop(1, p.color + "00");

            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, this.width, this.height);
        });
    }

    /* ─── 3D Object Effects ────────────────────────────────────────────────── */

    draw3DGrid() {
        const perspective = 500;
        const gridSpacing = 40;

        this.ctx.strokeStyle = this.theme.defaultShapeColor + "40";
        this.ctx.lineWidth = 1;

        const rotX = this.time * 0.005;
        const rotY = this.time * 0.003;

        for (let x = -this.width; x < this.width * 2; x += gridSpacing) {
            for (let y = -this.height; y < this.height * 2; y += gridSpacing) {
                let z = 0;

                // Simple 3D rotation
                const x2 = x * Math.cos(rotY) - z * Math.sin(rotY);
                const z2 = x * Math.sin(rotY) + z * Math.cos(rotY);

                const projX = (x2 * perspective) / (perspective + z2) + this.width / 2;
                const projY = (y * perspective) / (perspective + z2) + this.height / 2;

                if (x % (gridSpacing * 2) === 0) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(projX, projY - gridSpacing);
                    this.ctx.lineTo(projX, projY + gridSpacing);
                    this.ctx.stroke();
                }
            }
        }
    }

    drawSphereClusters() {
        this.particles.forEach(p => {
            p.x += p.vx * 0.1;
            p.y += p.vy * 0.1;
            p.z += p.vz * 0.1;

            if (Math.abs(p.x - this.width / 2) > this.width) p.vx *= -1;
            if (Math.abs(p.y - this.height / 2) > this.height) p.vy *= -1;
            if (Math.abs(p.z) > 100) p.vz *= -1;

            const perspective = 500;
            const projX = (p.x * perspective) / (perspective + p.z) + this.width / 2;
            const projY = (p.y * perspective) / (perspective + p.z) + this.height / 2;
            const scale = perspective / (perspective + p.z);

            const gradient = this.ctx.createRadialGradient(projX, projY, 0, projX, projY, p.size * scale);
            gradient.addColorStop(0, p.color + "80");
            gradient.addColorStop(1, p.color + "00");

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(projX, projY, p.size * scale, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    /* ─── Organic Shapes ────────────────────────────────────────────────────── */

    drawMorphingBlobs() {
        this.blobs.forEach(blob => {
            blob.phase += 0.01;

            const gradient = this.ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, 150);
            gradient.addColorStop(0, blob.color + "60");
            gradient.addColorStop(1, blob.color + "00");

            this.ctx.fillStyle = gradient;

            this.ctx.beginPath();
            for (let i = 0; i < Math.PI * 2; i += 0.1) {
                const scale = 50 + Math.sin(i * 3 + blob.phase) * 30;
                const x = blob.x + Math.cos(i) * scale;
                const y = blob.y + Math.sin(i) * scale;
                i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();
            this.ctx.fill();
        });
    }

    drawLiquid() {
        const frequency = 0.05;
        const amplitude = 40;

        for (let x = 0; x < this.width; x += 10) {
            const y = this.height / 2 + Math.sin((x + this.time) * frequency) * amplitude;

            const gradient = this.ctx.createLinearGradient(x, y, x, this.height);
            gradient.addColorStop(0, this.theme.accentStrong + "60");
            gradient.addColorStop(1, this.theme.accentStrong + "00");

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(x, y, 10, this.height - y);
        }
    }

    /* ─── Aurora Effect ────────────────────────────────────────────────────── */

    drawAurora() {
        for (let i = 0; i < 10; i++) {
            const y = (this.height * (i + 1)) / 11;
            const offset = Math.sin(this.time * 0.01 + i) * 50;

            const gradient = this.ctx.createLinearGradient(0, y, this.width, y + 100);
            const colors = ["#00FF88", "#00FFFF", "#0088FF", "#FF00FF"];
            colors.forEach((color, j) => {
                gradient.addColorStop(j / (colors.length - 1), color + (80 - i * 8).toString(16));
            });

            this.ctx.globalAlpha = 0.3;
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0 + offset, y, this.width, 80);
            this.ctx.globalAlpha = 1;
        }
    }

    /* ─── Pattern ───────────────────────────────────────────────────────────── */

    drawDotPattern() {
        const spacing = 20;
        this.ctx.fillStyle = this.theme.defaultShapeColor + "40";

        for (let x = 0; x < this.width; x += spacing) {
            for (let y = 0; y < this.height; y += spacing) {
                this.ctx.beginPath();
                this.ctx.arc(x, y, 2, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    /* ─── Geometric ────────────────────────────────────────────────────────── */

    drawGeometric() {
        const colors = [this.theme.accentStrong, this.theme.accentSoft, this.theme.defaultShapeColor];
        let colorIndex = 0;

        // Draw circles
        for (let i = 0; i < 5; i++) {
            this.ctx.strokeStyle = colors[colorIndex % 3] + "40";
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(this.width / 2, this.height / 2, 100 + i * 50, 0, Math.PI * 2);
            this.ctx.stroke();
            colorIndex++;
        }

        // Draw lines
        this.ctx.strokeStyle = this.theme.defaultShapeColor + "30";
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 * i) / 8;
            const x1 = this.width / 2 + Math.cos(angle) * 100;
            const y1 = this.height / 2 + Math.sin(angle) * 100;
            const x2 = this.width / 2 + Math.cos(angle) * 300;
            const y2 = this.height / 2 + Math.sin(angle) * 300;

            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        }
    }

    /* ─── Utility Methods ───────────────────────────────────────────────────── */

    addNoise(intensity = 0.3) {
        const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 50 * intensity;
            data[i] += noise;
            data[i + 1] += noise;
            data[i + 2] += noise;
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    setupEventListeners() {
        this.canvas.addEventListener("mousemove", e => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
        });
    }

    destroy() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    }

    resize() {
        this.setupCanvas();
    }
}

/* ─── Background Helper Functions ──────────────────────────────────────────── */

function _getBackgroundStyle(styleId) {
    return BACKGROUND_STYLES_3D[styleId] || null;
}

function _getBackgroundsByCategory(categoryId) {
    return Object.entries(BACKGROUND_STYLES_3D)
        .filter(([, style]) => style.category === categoryId)
        .map(([id, style]) => ({ id, ...style }));
}

function _createCanvas3DBackground(parentElement, styleId, theme) {
    const canvas = document.createElement("canvas");
    canvas.className = "slide-3d-background";
    canvas.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 0;
    `;

    parentElement.insertBefore(canvas, parentElement.firstChild);

    return new Canvas3DBackground(canvas, styleId, theme);
}

function _removeCanvas3DBackground(parentElement) {
    const canvas = parentElement.querySelector(".slide-3d-background");
    if (canvas) {
        const bg = canvas._backgroundInstance;
        if (bg) bg.destroy();
        canvas.remove();
    }
}

/* ─── Export for use in other modules ──────────────────────────────────── */

window.BACKGROUND_STYLES_3D = BACKGROUND_STYLES_3D;
window.BACKGROUND_CATEGORIES = BACKGROUND_CATEGORIES;
window.Canvas3DBackground = Canvas3DBackground;

window._getBackgroundStyle = _getBackgroundStyle;
window._getBackgroundsByCategory = _getBackgroundsByCategory;
window._createCanvas3DBackground = _createCanvas3DBackground;
window._removeCanvas3DBackground = _removeCanvas3DBackground;
