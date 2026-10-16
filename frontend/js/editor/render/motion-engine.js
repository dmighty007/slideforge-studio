// The 3D motion backgrounds: small scenes of points and lines, drawn in perspective on a 2D canvas.
// One engine draws every copy of a slide's background (editor, thumbnails, the show, the HTML viewer, picture and
// PowerPoint exports), so they all show the same scene. The old version drew the live slide with three.js and the
// rest with a different 2D approximation, so thumbnails and exports never matched what was on screen.
// Everything lives inside this one function: the HTML viewer embeds it with createThemeMotionEngine.toString().

function createThemeMotionEngine() {
  // World units: the slide spans y -1..1 and x -aspect..aspect at depth 0; the eye sits at z = CAMERA.
  const CAMERA = 4;
  const TAU = Math.PI * 2;

  const STYLE_LABELS = {
    orbital: "Orbits",
    mesh: "Terrain",
    particles: "Drift",
    lattice: "Crystal lattice",
    wave: "Ribbons",
    vortex: "Double helix",
    network: "Network",
    globe: "Globe",
  };
  const SIDES = ["right", "left", "center"];
  const STRENGTHS = { subtle: 0.6, standard: 1, bold: 1.45 };
  const MOTIONS = { still: 0, slow: 0.55, normal: 1 };

  function seededRandom(seed) {
    let value = Math.max(1, Math.floor(Math.abs(Number(seed) || 1)) % 2147483647);
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function normalizeOptions(background = {}) {
    const style = STYLE_LABELS[background.style] ? background.style : "orbital";
    const seed = Math.max(1, Math.min(999999, Math.round(Number(background.seed) || 1)));
    return {
      style,
      seed,
      side: SIDES.includes(background.side) ? background.side : "right",
      strength: STRENGTHS[background.strength] ? background.strength : "standard",
      motion: MOTIONS[background.motion] !== undefined ? background.motion : "slow",
      calm: background.calm !== false,
    };
  }

  // Rotation about x, then y (radians), of one point into out[o..o+2].
  function rotate(out, o, x, y, z, ax, ay) {
    const cx = Math.cos(ax);
    const sx = Math.sin(ax);
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const cy = Math.cos(ay);
    const sy = Math.sin(ay);
    out[o] = x * cy + z1 * sy;
    out[o + 1] = y1;
    out[o + 2] = -x * sy + z1 * cy;
  }

  // Where a style's centre goes: placed for "right"; "left" mirrors it, "center" moves it to the middle.
  function anchor(opts, aspect, rightX, y, centerY = y) {
    if (opts.side === "left") return { x: -rightX * aspect, y, mirror: -1 };
    if (opts.side === "center") return { x: 0, y: centerY, mirror: 1 };
    return { x: rightX * aspect, y, mirror: 1 };
  }

  // Every builder returns { count, size, tone, alpha, edges, edgeAlpha, glow, frame(t, out) }:
  // sizes are in slide pixels (of a 768-high slide), tone 0/1 picks the theme's first or second accent.
  const BUILDERS = {
    orbital(random, aspect, opts) {
      const centre = anchor(opts, aspect, 0.6, 0.12, -0.42);
      const rings = [];
      let count = 0;
      for (let k = 0; k < 4; k += 1) {
        const n = 64 + k * 22;
        rings.push({
          start: count,
          n,
          radius: 0.36 + k * 0.22,
          // Tilted a little out of the floor plane: seen as ellipses, like orbits drawn in perspective.
          tiltX: 0.32 + random() * 0.38,
          tiltY: (random() - 0.5) * 0.8,
          speed: (0.16 / (k + 1)) * (random() < 0.5 ? -1 : 1),
          phase: random() * TAU,
        });
        count += n;
      }
      const planets = rings.map(ring => ({ ring, at: random() * TAU, index: count++ }));
      const nucleus = count++;
      const size = new Float32Array(count).fill(2);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count).fill(0.6);
      const edges = [];
      const edgeAlpha = [];
      rings.forEach((ring, k) => {
        for (let j = 0; j < ring.n; j += 1) {
          tone[ring.start + j] = k % 2;
          edges.push(ring.start + j, ring.start + ((j + 1) % ring.n));
          edgeAlpha.push(0.4);
        }
      });
      planets.forEach((planet, k) => {
        size[planet.index] = 5 + k * 0.8;
        alpha[planet.index] = 0.85;
        tone[planet.index] = k % 2 ? 0 : 1;
      });
      size[nucleus] = 16;
      alpha[nucleus] = 0.55;
      const ringPoint = (ring, angle, out, o) => {
        rotate(out, o, Math.cos(angle) * ring.radius, 0, Math.sin(angle) * ring.radius, ring.tiltX, ring.tiltY);
        out[o] = centre.x + out[o] * centre.mirror;
        out[o + 1] += centre.y;
      };
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: centre.x, y: centre.y, radius: 1.5 },
        frame(t, out) {
          rings.forEach(ring => {
            for (let j = 0; j < ring.n; j += 1) {
              ringPoint(ring, ring.phase + (j / ring.n) * TAU + ring.speed * t, out, (ring.start + j) * 3);
            }
          });
          planets.forEach(planet => ringPoint(planet.ring, planet.ring.phase + planet.at + planet.ring.speed * t, out, planet.index * 3));
          out[nucleus * 3] = centre.x;
          out[nucleus * 3 + 1] = centre.y;
          out[nucleus * 3 + 2] = 0;
        },
      };
    },

    mesh(random, aspect, opts) {
      // A wireframe landscape along the bottom of the slide, rolling slowly towards the viewer.
      const cols = 44;
      const rows = 20;
      const count = cols * rows;
      const size = new Float32Array(count).fill(1.1);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count).fill(0.42);
      const edges = [];
      const edgeAlpha = [];
      const peakX = opts.side === "center" ? 0 : (opts.side === "left" ? -0.55 : 0.55) * aspect;
      const phase = random() * TAU;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const i = r * cols + c;
          tone[i] = (r + c) % 7 === 0 ? 1 : 0;
          if (c < cols - 1) { edges.push(i, i + 1); edgeAlpha.push(0.38); }
          if (r < rows - 1) { edges.push(i, i + cols); edgeAlpha.push(0.28); }
        }
      }
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: peakX, y: -0.75, radius: 1.8 },
        frame(t, out) {
          for (let r = 0; r < rows; r += 1) {
            const z = -3.4 + (r / (rows - 1)) * 4.3;
            for (let c = 0; c < cols; c += 1) {
              const x = (c / (cols - 1) - 0.5) * aspect * 2.7;
              const near = Math.exp(-((x - peakX) ** 2) / (aspect * aspect * 0.5));
              const height =
                (0.1 + 0.22 * near) * Math.sin(1.25 * x + phase + 0.5 * t) * Math.cos(0.85 * z - 0.35 * t) +
                0.06 * Math.sin(2.6 * x - 1.7 * z + 0.6 * t + phase);
              const o = (r * cols + c) * 3;
              out[o] = x;
              out[o + 1] = -0.86 + height;
              out[o + 2] = z;
            }
          }
        },
      };
    },

    particles(random, aspect, opts) {
      const count = 210;
      const base = [];
      const size = new Float32Array(count);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count);
      const lean = opts.side === "center" ? 0 : opts.side === "left" ? -1 : 1;
      for (let i = 0; i < count; i += 1) {
        let x = 0;
        let y = 0;
        // Fewer in the middle, where the text is, and more on the chosen side.
        for (let tries = 0; tries < 6; tries += 1) {
          x = (random() * 2 - 1) * aspect * 1.15;
          y = random() * 2.4 - 1.2;
          const middle = Math.abs(x) < aspect * 0.5 && Math.abs(y) < 0.55;
          const wrongSide = lean && x * lean < 0 && random() < 0.55;
          if (!middle && !wrongSide) break;
        }
        const z = random() * 3.4 - 2.2;
        base.push({ x, y, z, rise: 0.035 + random() * 0.06, sway: random() * TAU });
        const near = z > 0.7;
        size[i] = near ? 10 + random() * 10 : 2.4 + random() * 3.6;
        alpha[i] = near ? 0.2 : 0.5 + random() * 0.4;
        tone[i] = random() < 0.3 ? 1 : 0;
      }
      return {
        count, size, tone, alpha, edges: [], edgeAlpha: [],
        glow: { x: lean * aspect * 0.6, y: 0.2, radius: 1.6 },
        frame(t, out) {
          base.forEach((p, i) => {
            const span = 2.6;
            let y = p.y + p.rise * t;
            y = ((((y + 1.3) % span) + span) % span) - 1.3;
            out[i * 3] = p.x + Math.sin(t * 0.4 + p.sway) * 0.05;
            out[i * 3 + 1] = y;
            out[i * 3 + 2] = p.z;
          });
        },
      };
    },

    lattice(random, aspect, opts) {
      // A rock-salt crystal: two kinds of atom on alternate sites, bonded along the axes.
      const n = 4;
      const count = n * n * n;
      const spacing = 0.3;
      const centre = anchor(opts, aspect, 0.6, 0.02, -0.5);
      const local = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count);
      const edges = [];
      const edgeAlpha = [];
      const index = (i, j, k) => (i * n + j) * n + k;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          for (let k = 0; k < n; k += 1) {
            const a = index(i, j, k);
            local[a * 3] = (i - (n - 1) / 2) * spacing;
            local[a * 3 + 1] = (j - (n - 1) / 2) * spacing;
            local[a * 3 + 2] = (k - (n - 1) / 2) * spacing;
            tone[a] = (i + j + k) % 2;
            size[a] = tone[a] ? 5.2 : 8;
            alpha[a] = 0.7;
            if (i < n - 1) { edges.push(a, index(i + 1, j, k)); edgeAlpha.push(0.32); }
            if (j < n - 1) { edges.push(a, index(i, j + 1, k)); edgeAlpha.push(0.32); }
            if (k < n - 1) { edges.push(a, index(i, j, k + 1)); edgeAlpha.push(0.32); }
          }
        }
      }
      const startY = Math.PI / 5 + random() * 0.4;
      const spun = new Float32Array(3);
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: centre.x, y: centre.y, radius: 1.3 },
        frame(t, out) {
          // Spun about its vertical axis, then tipped towards the viewer: the top faces show, so it reads as a solid
          // block and never as a flat grid.
          const ay = startY + 0.14 * t;
          const ax = 0.5 + 0.06 * Math.sin(0.3 * t);
          for (let a = 0; a < count; a += 1) {
            rotate(spun, 0, local[a * 3], local[a * 3 + 1], local[a * 3 + 2], 0, ay);
            rotate(out, a * 3, spun[0], spun[1], spun[2], ax, 0);
            out[a * 3] = centre.x + out[a * 3] * 1.25;
            out[a * 3 + 1] = centre.y + out[a * 3 + 1] * 1.25;
            out[a * 3 + 2] = out[a * 3 + 2] * 1.25 - 0.3;
          }
        },
      };
    },

    wave(random, aspect, opts) {
      // Silk ribbons: a few strands that twist around each other, crossing the lower part of the slide.
      const strands = 6;
      const perStrand = 110;
      const count = strands * perStrand;
      const size = new Float32Array(count).fill(0.9);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count).fill(0.3);
      const edges = [];
      const edgeAlpha = [];
      for (let s = 0; s < strands; s += 1) {
        for (let p = 0; p < perStrand; p += 1) {
          const i = s * perStrand + p;
          tone[i] = s % 3 === 2 ? 1 : 0;
          if (p < perStrand - 1) { edges.push(i, i + 1); edgeAlpha.push(0.55); }
          if (s < strands - 1 && p % 5 === 0) { edges.push(i, i + perStrand); edgeAlpha.push(0.14); }
        }
      }
      const phase = random() * TAU;
      const rise = opts.side === "center" ? 0 : opts.side === "left" ? -1 : 1;
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: rise * aspect * 0.55, y: -0.45, radius: 1.7 },
        frame(t, out) {
          for (let s = 0; s < strands; s += 1) {
            const twist = (s / (strands - 1) - 0.5) * 0.9;
            for (let p = 0; p < perStrand; p += 1) {
              const u = p / (perStrand - 1);
              const x = (u - 0.5) * aspect * 2.7;
              const lift = rise * (u - 0.5) * 0.55;
              const angle = 1.15 * x + phase + 0.45 * t;
              const o = (s * perStrand + p) * 3;
              out[o] = x;
              out[o + 1] = -0.5 + lift + 0.2 * Math.sin(angle) + twist * 0.32 * Math.cos(0.8 * x - 0.3 * t + phase);
              out[o + 2] = 0.55 * Math.cos(angle * 0.7) + twist * 0.5 * Math.sin(0.8 * x - 0.3 * t + phase);
            }
          }
        },
      };
    },

    vortex(random, aspect, opts) {
      // A DNA double helix: two backbones with base-pair rungs, along a diagonal on one side of the slide.
      const pairs = 46;
      const count = pairs * 2;
      const size = new Float32Array(count).fill(4.2);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count).fill(0.75);
      const edges = [];
      const edgeAlpha = [];
      for (let p = 0; p < pairs; p += 1) {
        tone[p * 2] = 0;
        tone[p * 2 + 1] = 1;
        edges.push(p * 2, p * 2 + 1);
        edgeAlpha.push(0.28);
        if (p < pairs - 1) {
          edges.push(p * 2, p * 2 + 2, p * 2 + 1, p * 2 + 3);
          edgeAlpha.push(0.6, 0.6);
        }
      }
      const centre = opts.side === "center";
      const mirror = opts.side === "left" ? -1 : 1;
      const from = centre ? { x: -aspect * 1.15, y: -0.62 } : { x: mirror * aspect * 0.42, y: -1.3 };
      const to = centre ? { x: aspect * 1.15, y: -0.5 } : { x: mirror * aspect * 1.02, y: 1.3 };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const nx = -dy / length;
      const ny = dx / length;
      const phase = random() * TAU;
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, radius: 1.5 },
        frame(t, out) {
          for (let p = 0; p < pairs; p += 1) {
            const u = p / (pairs - 1);
            const cx = from.x + dx * u;
            const cy = from.y + dy * u;
            const angle = phase + u * TAU * 3.2 + 0.5 * t;
            [0, 2.3].forEach((offset, strand) => {
              const o = (p * 2 + strand) * 3;
              const c = Math.cos(angle + offset) * 0.24;
              out[o] = cx + nx * c;
              out[o + 1] = cy + ny * c;
              out[o + 2] = Math.sin(angle + offset) * 0.24;
            });
          }
        },
      };
    },

    network(random, aspect, opts) {
      const count = 78;
      const lean = opts.side === "center" ? 0 : opts.side === "left" ? -1 : 1;
      const base = [];
      for (let i = 0; i < count; i += 1) {
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 8; tries += 1) {
          x = lean ? lean * aspect * (0.08 + random() * 1.08) : (random() * 2 - 1) * aspect * 1.1;
          y = random() * 2.3 - 1.15;
          if (lean || Math.abs(x) > aspect * 0.5 || Math.abs(y) > 0.55) break;
        }
        base.push({ x, y, z: random() * 1.6 - 0.9, phase: random() * TAU, speed: 0.25 + random() * 0.35 });
      }
      const size = new Float32Array(count);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count);
      base.forEach((p, i) => {
        const hub = random() < 0.12;
        size[i] = hub ? 6.5 : 2 + random() * 2;
        alpha[i] = hub ? 0.85 : 0.6;
        tone[i] = hub ? 1 : 0;
      });
      // Each node joins its three nearest neighbours (no long lines across the slide).
      const edges = [];
      const edgeAlpha = [];
      const seen = new Set();
      base.forEach((p, i) => {
        base
          .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) }))
          .filter(entry => entry.j !== i && entry.d < 0.62)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .forEach(({ j, d }) => {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (seen.has(key)) return;
            seen.add(key);
            edges.push(i, j);
            edgeAlpha.push(0.42 * (1 - d / 0.7));
          });
      });
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: lean * aspect * 0.62, y: 0, radius: 1.5 },
        frame(t, out) {
          base.forEach((p, i) => {
            out[i * 3] = p.x + Math.sin(t * p.speed + p.phase) * 0.045;
            out[i * 3 + 1] = p.y + Math.cos(t * p.speed * 0.8 + p.phase) * 0.045;
            out[i * 3 + 2] = p.z + Math.sin(t * p.speed * 0.6 + p.phase * 2) * 0.08;
          });
        },
      };
    },

    globe(random, aspect, opts) {
      // A wire globe rising from a lower corner, partly off the slide; its far side is drawn fainter.
      const meridians = 18;
      const perMeridian = 26;
      const count = meridians * perMeridian;
      const radius = opts.side === "center" ? 0.95 : 1.05;
      const centre = anchor(opts, aspect, 0.8, -0.62, -1.25);
      const size = new Float32Array(count).fill(1.5);
      const tone = new Uint8Array(count);
      const alpha = new Float32Array(count).fill(0.5);
      const edges = [];
      const edgeAlpha = [];
      const local = new Float32Array(count * 3);
      for (let m = 0; m < meridians; m += 1) {
        const lon = (m / meridians) * TAU;
        for (let p = 0; p < perMeridian; p += 1) {
          const lat = -Math.PI / 2 + ((p + 0.5) / perMeridian) * Math.PI;
          const i = m * perMeridian + p;
          local[i * 3] = Math.cos(lat) * Math.cos(lon) * radius;
          local[i * 3 + 1] = Math.sin(lat) * radius;
          local[i * 3 + 2] = Math.cos(lat) * Math.sin(lon) * radius;
          tone[i] = p % 6 === 3 ? 1 : 0;
          if (p % 6 === 3) size[i] = 2.6;
          if (p < perMeridian - 1) { edges.push(i, i + 1); edgeAlpha.push(0.34); }
          if (p % 3 === 1) { edges.push(i, ((m + 1) % meridians) * perMeridian + p); edgeAlpha.push(0.26); }
        }
      }
      const startY = random() * TAU;
      return {
        count, size, tone, alpha, edges, edgeAlpha,
        glow: { x: centre.x, y: centre.y, radius: 1.6 },
        frame(t, out) {
          const ay = startY + 0.1 * t;
          for (let i = 0; i < count; i += 1) {
            rotate(out, i * 3, local[i * 3], local[i * 3 + 1], local[i * 3 + 2], 0.38, ay);
            out[i * 3] += centre.x;
            out[i * 3 + 1] += centre.y;
          }
        },
      };
    },
  };

  function buildScene(background, aspect) {
    const opts = normalizeOptions(background);
    const random = seededRandom(opts.seed * 7919 + Object.keys(STYLE_LABELS).indexOf(opts.style) * 131);
    const scene = BUILDERS[opts.style](random, aspect, opts);
    scene.opts = opts;
    scene.aspect = aspect;
    scene.positions = new Float32Array(scene.count * 3);
    scene.speed = MOTIONS[opts.motion];
    return scene;
  }

  function hexToRgb(value, fallback) {
    const str = String(value || "").trim();
    const hex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (hex) {
      const full = hex.length === 3 ? hex.split("").map(ch => ch + ch).join("") : hex;
      return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16));
    }
    const rgb = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
  }

  function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // The theme's text colour tells light slides from dark ones. On a light slide the scene is drawn with normal
  // blending in the darker accent (adding light would bleach it to nothing); on a dark one it glows (additive).
  function paletteFor(colors = {}) {
    const fg = hexToRgb(colors.fg, [23, 32, 51]);
    const light = luminance(fg) < 0.5;
    let accent = hexToRgb(colors.accent, [37, 99, 235]);
    let accent2 = hexToRgb(colors.accent2, accent);
    if (light) {
      if (luminance(accent) > 0.62) accent = accent.map(c => Math.round(c * 0.7));
      if (luminance(accent2) > luminance(accent) + 0.12) accent2 = accent.map((c, i) => Math.round(c * 0.55 + accent2[i] * 0.2));
    }
    return { light, tones: [accent, accent2] };
  }

  const spriteCache = new Map();
  function sprite([r, g, b]) {
    const key = `${r},${g},${b}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(0.42, `rgba(${r},${g},${b},0.9)`);
    gradient.addColorStop(0.62, `rgba(${r},${g},${b},0.35)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    spriteCache.set(key, canvas);
    return canvas;
  }

  // Draws the scene at time t (seconds of motion) on a canvas of width x height pixels. Sizes are given for a
  // 768-pixel-high slide and scaled, so a thumbnail looks like a small copy of the slide.
  function draw(ctx, scene, width, height, colors, t = 0) {
    const { light, tones } = paletteFor(colors);
    const strength = STRENGTHS[scene.opts.strength] * (light ? 1.55 : 1.15);
    const unit = height / 768;
    const half = height / 2;
    const cx = width / 2;
    scene.frame(t, scene.positions);
    const pos = scene.positions;
    const count = scene.count;
    const px = new Float32Array(count);
    const py = new Float32Array(count);
    const fade = new Float32Array(count);
    const scale = new Float32Array(count);
    const calm = scene.opts.calm;
    for (let i = 0; i < count; i += 1) {
      const z = Math.min(CAMERA - 0.6, pos[i * 3 + 2]);
      const s = CAMERA / (CAMERA - z);
      scale[i] = s;
      px[i] = cx + pos[i * 3] * s * half;
      py[i] = half - pos[i * 3 + 1] * s * half;
      // Far points fade into the background; points over the text area (the middle of the slide) are quieter.
      let f = Math.max(0.12, Math.min(1, 0.55 + z * 0.3));
      if (calm) {
        const dx = (px[i] - cx) / (width * 0.34);
        const dy = (py[i] - height * 0.46) / (height * 0.3);
        f *= 1 - 0.62 * Math.exp(-(dx * dx + dy * dy));
      }
      fade[i] = f;
    }

    ctx.clearRect(0, 0, width, height);
    // A soft glow of the accent behind the scene, which gives the flat slide some depth.
    if (scene.glow) {
      const gx = cx + scene.glow.x * half;
      const gy = half - scene.glow.y * half;
      const radius = scene.glow.radius * half;
      const [r, g, b] = tones[0];
      const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
      // Eased fall-off: a straight one showed a ring where it ended.
      const peak = (light ? 0.05 : 0.14) * strength;
      [[0, 1], [0.25, 0.72], [0.5, 0.36], [0.75, 0.11], [1, 0]].forEach(([at, share]) => {
        gradient.addColorStop(at, `rgba(${r},${g},${b},${peak * share})`);
      });
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";

    // Lines, batched by tone and by one of eight alpha steps: a few strokes instead of one per line.
    const edges = scene.edges;
    if (edges.length) {
      const buckets = new Map();
      for (let e = 0; e < edges.length; e += 2) {
        const a = edges[e];
        const b = edges[e + 1];
        const value = scene.edgeAlpha[e / 2] * Math.min(fade[a], fade[b]) * strength;
        if (value < 0.01) continue;
        const step = Math.min(7, Math.round(value * 10));
        const key = scene.tone[a] * 8 + step;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(a, b);
      }
      ctx.lineWidth = Math.max(0.5, 1.25 * unit);
      ctx.lineCap = "round";
      buckets.forEach((list, key) => {
        const [r, g, b] = tones[Math.floor(key / 8)];
        ctx.strokeStyle = `rgba(${r},${g},${b},${Math.max(0.04, (key % 8) / 10)})`;
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 2) {
          ctx.moveTo(px[list[k]], py[list[k]]);
          ctx.lineTo(px[list[k + 1]], py[list[k + 1]]);
        }
        ctx.stroke();
      });
    }

    // Points, far ones first so near ones sit on top.
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => pos[a * 3 + 2] - pos[b * 3 + 2]);
    const sprites = tones.map(sprite);
    order.forEach(i => {
      const diameter = scene.size[i] * scale[i] * unit * 1.6;
      if (diameter < 0.4) return;
      const value = scene.alpha[i] * fade[i] * strength;
      if (value < 0.01) return;
      ctx.globalAlpha = Math.min(1, value);
      ctx.drawImage(sprites[scene.tone[i]], px[i] - diameter / 2, py[i] - diameter / 2, diameter, diameter);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  return {
    styles: Object.entries(STYLE_LABELS).map(([id, label]) => ({ id, label })),
    sides: SIDES,
    strengths: Object.keys(STRENGTHS),
    motions: Object.keys(MOTIONS),
    normalizeOptions,
    buildScene,
    draw,
  };
}

const THEME_MOTION_ENGINE = createThemeMotionEngine();
