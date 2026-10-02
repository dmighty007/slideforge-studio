// Animated theme backgrounds (canvas and three.js) and slide background nodes.

function _themeMotionColors(themeOverride = null) {
  const theme =
    themeOverride ||
    (typeof getPresentationTheme === "function"
      ? getPresentationTheme()
      : null);
  const vars = theme?.cssVars || {};
  return {
    bg: vars["--slide-bg"] || theme?.surfaceColor || "#ffffff",
    bgSolid: theme?.surfaceColor || "#ffffff",
    fg: vars["--slide-fg"] || theme?.defaultTextColor || "#172033",
    muted: vars["--slide-muted"] || theme?.defaultMutedColor || "#64748b",
    accent: vars["--slide-accent"] || theme?.accentStrong || "#2563eb",
    accent2: vars["--slide-accent-2"] || theme?.defaultShapeColor || "#0f766e",
  };
}

function _isThemeMotionActive(wrapper, forPreview = false) {
  if (forPreview) return false;
  const section = wrapper.closest("section");
  if (!section) return !document.body.classList.contains("play-mode-active");
  return (
    section.hasAttribute("data-media-active") ||
    section.classList.contains("present")
  );
}

function _hexToRgb(value, fallback = { r: 37, g: 99, b: 235 }) {
  const str = String(value || "").trim();
  const hex = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return fallback;
}

function _rgb(color, alpha = 1) {
  const { r, g, b } = _hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function _themeMotionBackground(style, colors) {
  const accent = _rgb(colors.accent, 0.18);
  const accent2 = _rgb(colors.accent2, 0.18);
  const faint = _rgb(colors.muted, 0.1);
  const overlays = {
    orbital: `radial-gradient(circle at 68% 28%, ${accent} 0 2%, transparent 24%), radial-gradient(circle at 30% 72%, ${accent2} 0 2%, transparent 28%)`,
    mesh: `linear-gradient(120deg, transparent 0 28%, ${faint} 28% 29%, transparent 29% 100%), linear-gradient(32deg, transparent 0 58%, ${accent2} 58% 59%, transparent 59% 100%)`,
    particles: `radial-gradient(circle at 18% 20%, ${accent} 0 1%, transparent 18%), radial-gradient(circle at 78% 64%, ${accent2} 0 1%, transparent 22%)`,
    lattice: `repeating-linear-gradient(90deg, ${faint} 0 1px, transparent 1px 76px), repeating-linear-gradient(0deg, ${faint} 0 1px, transparent 1px 76px)`,
    wave: `linear-gradient(165deg, transparent 0 36%, ${accent2} 36% 37%, transparent 37% 100%), radial-gradient(ellipse at 50% 92%, ${accent} 0 6%, transparent 42%)`,
    vortex: `conic-gradient(from 20deg at 50% 52%, transparent 0deg, ${accent} 54deg, transparent 118deg, ${accent2} 202deg, transparent 360deg)`,
  };
  return `${overlays[style] || overlays.orbital}, ${colors.bg}`;
}

function _colorToThreeInt(value, fallback = 0x2563eb) {
  const rgb = _hexToRgb(value, null);
  if (!rgb) return fallback;
  return (rgb.r << 16) + (rgb.g << 8) + rgb.b;
}

function _createThemeMotionSpriteTexture(THREE) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 96;
  textureCanvas.height = 96;
  const ctx = textureCanvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.28, "rgba(255,255,255,0.62)");
  gradient.addColorStop(0.64, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.needsUpdate = true;
  return texture;
}

function _makeSeededRandom(seed = 1) {
  let value = Math.max(1, Math.floor(seed) % 2147483647);
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function _themeMotionSphereConfig(style) {
  return (
    {
      orbital: { count: 7, radius: 0.11, opacity: 0.14, spread: 3.5 },
      mesh: { count: 5, radius: 0.08, opacity: 0.1, spread: 3.8 },
      particles: { count: 10, radius: 0.07, opacity: 0.12, spread: 4.4 },
      lattice: { count: 6, radius: 0.075, opacity: 0.11, spread: 3.2 },
      wave: { count: 7, radius: 0.09, opacity: 0.12, spread: 4.1 },
      vortex: { count: 8, radius: 0.085, opacity: 0.13, spread: 3.6 },
    }[style] || { count: 6, radius: 0.09, opacity: 0.12, spread: 3.6 }
  );
}

const THEME_MOTION_MAX_WEBGL_BACKGROUNDS = 6;

const _themeMotionWebglWrappers = new Set();

function _touchThemeMotionWebglWrapper(wrapper) {
  if (!wrapper) return;
  _themeMotionWebglWrappers.delete(wrapper);
  _themeMotionWebglWrappers.add(wrapper);
}

function _pruneThemeMotionWebglWrappers(activeWrapper = null) {
  Array.from(_themeMotionWebglWrappers).forEach((wrapper) => {
    if (
      !document.contains(wrapper) ||
      typeof wrapper._disposeThemeMotion !== "function"
    ) {
      _themeMotionWebglWrappers.delete(wrapper);
    }
  });
  while (_themeMotionWebglWrappers.size > THEME_MOTION_MAX_WEBGL_BACKGROUNDS) {
    const candidate = Array.from(_themeMotionWebglWrappers).find(
      (wrapper) => wrapper !== activeWrapper,
    );
    if (!candidate) return;
    candidate._disposeThemeMotion?.();
  }
}

function _themeMotionCount(style, fallback = 96) {
  return (
    {
      orbital: 126,
      mesh: 96,
      particles: 190,
      lattice: 125,
      wave: 144,
      vortex: 136,
    }[style] || fallback
  );
}

function _themeMotionPoint(style, index, count, random) {
  if (style === "lattice") {
    const size = 5;
    const x = (index % size) - 2;
    const y = (Math.floor(index / size) % size) - 2;
    const z = Math.floor(index / (size * size)) - 2;
    return { x: x * 0.86, y: y * 0.62, z: z * 0.72 };
  }
  if (style === "wave") {
    const cols = 12;
    const x = (index % cols) / (cols - 1) - 0.5;
    const y = Math.floor(index / cols) / (Math.ceil(count / cols) - 1) - 0.5;
    return {
      x: x * 5.1,
      y: y * 3.2,
      z: Math.sin(x * Math.PI * 3) * 0.36 + Math.cos(y * Math.PI * 2) * 0.22,
    };
  }
  if (style === "vortex") {
    const progress = index / Math.max(1, count - 1);
    const angle = progress * Math.PI * 9.5;
    const radius = 0.34 + progress * 2.6;
    return {
      x: Math.cos(angle) * radius,
      y: (progress - 0.5) * 3.2,
      z: Math.sin(angle) * radius,
    };
  }
  if (style === "particles") {
    return {
      x: (random() - 0.5) * 5.2,
      y: (random() - 0.5) * 3.9,
      z: (random() - 0.5) * 4.2,
    };
  }
  const radius = style === "mesh" ? 0.8 + random() * 3.1 : 1.1 + random() * 2.7;
  const angle = random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: (random() - 0.5) * (style === "mesh" ? 3.8 : 3.2),
    z: Math.sin(angle) * radius,
  };
}

function _themeMotionCanvasPoint(style, point, index, total, width, height, t) {
  if (style === "wave") {
    const cols = 12;
    const x = (index % cols) / (cols - 1);
    const y =
      Math.floor(index / cols) / Math.max(1, Math.ceil(total / cols) - 1);
    const lift =
      Math.sin(x * Math.PI * 4 + t * 2.2) * 0.04 +
      Math.cos(y * Math.PI * 3 + t * 1.4) * 0.03;
    return {
      x: width * (0.12 + x * 0.76),
      y: height * (0.24 + y * 0.52 + lift),
      z: 0.7 + lift * 3,
    };
  }
  if (style === "vortex") {
    const p = index / Math.max(1, total - 1);
    const angle = p * Math.PI * 8 + t * 1.4;
    const radius = 0.06 + p * 0.42;
    return {
      x: width * (0.5 + Math.cos(angle) * radius),
      y: height * (0.5 + Math.sin(angle) * radius * 0.72),
      z: 0.35 + p,
    };
  }
  if (style === "lattice") {
    const size = 5;
    const x = index % size;
    const y = Math.floor(index / size) % size;
    const z = Math.floor(index / (size * size));
    const pulse = Math.sin(t + z * 0.7) * 0.018;
    return {
      x: width * (0.2 + x * 0.15 + z * 0.035 + pulse),
      y: height * (0.24 + y * 0.12 - z * 0.025 + pulse),
      z: 0.35 + z / size,
    };
  }
  const orbit = t + point.drift;
  const depth = point.z + Math.sin(orbit) * 0.08;
  const spread = (style === "particles" ? 0.9 : 0.82) + depth * 0.24;
  return {
    x:
      width * (0.5 + (point.x - 0.5) * spread + Math.sin(orbit * 0.72) * 0.018),
    y:
      height *
      (0.5 + (point.y - 0.5) * spread + Math.cos(orbit * 0.66) * 0.018),
    z: depth,
  };
}

function _renderCanvasThemeMotion(
  canvas,
  wrapper,
  normalized,
  { forPreview = false, slideIndex = 0, theme = null } = {},
) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const colors = _themeMotionColors(theme);
  const reduceMotion =
    forPreview ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const seed =
    97 +
    Number(slideIndex || 0) * 37 +
    ["orbital", "mesh", "particles", "lattice", "wave", "vortex"].indexOf(
      normalized.style,
    ) *
      19;
  const random = _makeSeededRandom(seed);
  const canvasCount =
    normalized.style === "lattice"
      ? 125
      : normalized.style === "wave"
        ? 144
        : normalized.style === "vortex"
          ? 104
          : normalized.style === "particles"
            ? 92
            : 58;
  const points = Array.from({ length: canvasCount }, () => ({
    x: random(),
    y: random(),
    z: 0.25 + random() * 0.95,
    drift: random() * Math.PI * 2,
  }));

  const resize = () => {
    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(rect.width || wrapper.offsetWidth || 1024),
    );
    const height = Math.max(
      1,
      Math.round(rect.height || wrapper.offsetHeight || 768),
    );
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    return { width, height };
  };

  let mouseX = 0;
  let mouseY = 0;
  let currentOffsetX = 0;
  let currentOffsetY = 0;
  const onMouseMove = (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  };
  if (!reduceMotion) {
    window.addEventListener("mousemove", onMouseMove);
  }

  let motionTime = 0.35 + Number(slideIndex || 0) * 0.08;
  let lastActiveTimestamp = 0;
  const draw = (timestamp) => {
    const { width, height } = resize();
    const active = _isThemeMotionActive(wrapper, forPreview);
    if (!reduceMotion && active) {
      if (lastActiveTimestamp) {
        motionTime +=
          Math.min(80, Math.max(0, timestamp - lastActiveTimestamp)) / 5200;
      }
      lastActiveTimestamp = timestamp;
    } else {
      lastActiveTimestamp = 0;
    }
    const t = motionTime;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors.bgSolid);
    gradient.addColorStop(0.52, _rgb(colors.accent2, 0.12));
    gradient.addColorStop(1, _rgb(colors.accent, 0.16));
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (!reduceMotion && active) {
      currentOffsetX += (mouseX * 40 - currentOffsetX) * 0.05;
      currentOffsetY += (-mouseY * 40 - currentOffsetY) * 0.05;
    }

    const projected = points.map((point, index) => {
      const p = _themeMotionCanvasPoint(
        normalized.style,
        point,
        index,
        points.length,
        width,
        height,
        t,
      );
      if (!reduceMotion && active) {
        p.x += currentOffsetX * (point.z || 0.5);
        p.y += currentOffsetY * (point.z || 0.5);
      }
      return p;
    });

    if (normalized.style !== "particles") {
      ctx.lineWidth = ["mesh", "lattice", "wave"].includes(normalized.style)
        ? 1.1
        : 0.75;
      projected.forEach((a, i) => {
        for (let j = i + 1; j < projected.length; j += 1) {
          const b = projected[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const limit =
            normalized.style === "lattice" || normalized.style === "wave"
              ? 92
              : 150;
          if (distance > limit) continue;
          ctx.strokeStyle = _rgb(
            i % 2 ? colors.accent : colors.accent2,
            Math.max(0, 0.16 - distance / 1100),
          );
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      });
    }

    projected.forEach((point, index) => {
      const radius =
        normalized.style === "particles"
          ? 1.6 + point.z * 2.8
          : 1.2 + point.z * 2.2;
      const pulse =
        !reduceMotion && active ? Math.sin(t * 10 + index) * 0.08 : 0;
      ctx.fillStyle = _rgb(
        index % 3 === 0 ? colors.accent2 : colors.accent,
        0.22 + point.z * 0.18 + pulse,
      );
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    if (!document.contains(wrapper)) {
      if (!reduceMotion) {
        window.removeEventListener("mousemove", onMouseMove);
      }
      return;
    }
    if (!reduceMotion) {
      if (active) requestAnimationFrame(draw);
      else window.setTimeout(() => requestAnimationFrame(draw), 320);
    }
  };
  requestAnimationFrame(draw);
}

function _tryRenderThreeThemeMotion(
  canvas,
  wrapper,
  normalized,
  { forPreview = false, slideIndex = 0, theme = null } = {},
) {
  const THREE = window.THREE;
  if (!THREE?.WebGLRenderer) return false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
  } catch (_err) {
    return false;
  }
  const colors = _themeMotionColors(theme);
  // Additive blending glows on a dark slide but only adds light: on a light slide it bleached everything to a
  // faint grey-white (while the thumbnail, drawn in 2D, was vivid). Light slides are drawn with normal blending,
  // in the darker of the theme's two accents, a little stronger.
  const luminance = (value) => {
    const { r, g, b } = _hexToRgb(value, { r: 23, g: 32, b: 51 });
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const lightSlide = luminance(colors.fg) < 0.5;
  const blending = lightSlide ? THREE.NormalBlending : THREE.AdditiveBlending;
  const strength = lightSlide ? 1.7 : 1;
  if (lightSlide && luminance(colors.accent2) > luminance(colors.accent)) {
    colors.accent2 = colors.accent; // pastel second accents vanish on white
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 4 / 3, 0.1, 100);
  camera.position.z = 5.6;
  const count = _themeMotionCount(normalized.style, 118);
  const random = _makeSeededRandom(211 + Number(slideIndex || 0) * 41);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const point = _themeMotionPoint(normalized.style, i, count, random);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const pointTexture = _createThemeMotionSpriteTexture(THREE);
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: _colorToThreeInt(colors.accent),
      size:
        normalized.style === "particles"
          ? 0.18
          : ["lattice", "wave", "vortex"].includes(normalized.style)
            ? 0.135
            : 0.12,
      map: pointTexture || undefined,
      transparent: true,
      opacity: Math.min(0.9, (normalized.style === "particles" ? 0.52 : 0.46) * strength),
      depthWrite: false,
      blending,
    }),
  );
  scene.add(points);

  const sphereGroup = new THREE.Group();
  const sphereConfig = _themeMotionSphereConfig(normalized.style);
  const sphereGeometry = new THREE.SphereGeometry(sphereConfig.radius, 24, 16);
  for (let i = 0; i < sphereConfig.count; i += 1) {
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: _colorToThreeInt(i % 2 ? colors.accent2 : colors.accent),
      transparent: true,
      opacity: sphereConfig.opacity * (0.72 + random() * 0.46) * strength,
      depthWrite: false,
      blending,
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    const point = _themeMotionPoint(
      normalized.style,
      i + count,
      count + sphereConfig.count,
      random,
    );
    sphere.position.set(point.x * 0.92, point.y * 0.92, point.z * 0.92);
    const scale = 0.9 + random() * 1.8;
    sphere.scale.setScalar(scale);
    sphere.userData.phase = random() * Math.PI * 2;
    sphereGroup.add(sphere);
  }
  scene.add(sphereGroup);

  let lines = null;
  if (normalized.style !== "particles") {
    const linePositions = [];
    const pushLine = (from, to) => {
      linePositions.push(
        positions[from * 3],
        positions[from * 3 + 1],
        positions[from * 3 + 2],
        positions[to * 3],
        positions[to * 3 + 1],
        positions[to * 3 + 2],
      );
    };
    if (normalized.style === "wave") {
      const cols = 12;
      for (let i = 0; i < count; i += 1) {
        if ((i + 1) % cols !== 0 && i + 1 < count) pushLine(i, i + 1);
        if (i + cols < count) pushLine(i, i + cols);
      }
    } else if (normalized.style === "lattice") {
      const size = 5;
      for (let i = 0; i < count; i += 1) {
        const x = i % size;
        const y = Math.floor(i / size) % size;
        const z = Math.floor(i / (size * size));
        if (x < size - 1) pushLine(i, i + 1);
        if (y < size - 1) pushLine(i, i + size);
        if (z < size - 1) pushLine(i, i + size * size);
      }
    } else if (normalized.style === "vortex") {
      for (let i = 0; i < count - 1; i += 1) pushLine(i, i + 1);
    } else {
      for (let i = 0; i < count - 1; i += 2) pushLine(i, i + 1);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(linePositions, 3),
    );
    lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: _colorToThreeInt(colors.accent2),
        transparent: true,
        opacity: Math.min(0.8, (normalized.style === "orbital" ? 0.24 : 0.38) * strength),
      }),
    );
    scene.add(lines);
  }
  const pointBaseOpacity = points.material.opacity;
  const lineBaseOpacity = lines ? lines.material.opacity : 0;
  const light = new THREE.PointLight(_colorToThreeInt(colors.accent2), 0.7, 8);
  light.position.set(2.2, 1.5, 3);
  scene.add(light);
  renderer.setClearColor(0x000000, 0);

  let lastWidth = 0;
  let lastHeight = 0;
  let lastRatio = 0;
  const resize = () => {
    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(
      1,
      Math.round(rect.width || wrapper.offsetWidth || 1024),
    );
    const height = Math.max(
      1,
      Math.round(rect.height || wrapper.offsetHeight || 768),
    );
    // Only when the size really changed: setSize reallocates the drawing surface, and doing that on every frame
    // (as this did) made the animation stutter and filled the log with GPU "non-existent mailbox" errors.
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (width === lastWidth && height === lastHeight && ratio === lastRatio) return;
    lastWidth = width;
    lastHeight = height;
    lastRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const reduceMotion =
    forPreview ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  const onMouseMove = (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  };
  if (!reduceMotion) {
    window.addEventListener("mousemove", onMouseMove);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    _themeMotionWebglWrappers.delete(wrapper);
    if (!reduceMotion) {
      window.removeEventListener("mousemove", onMouseMove);
    }
    geometry.dispose();
    points.material.dispose();
    if (pointTexture) pointTexture.dispose();
    sphereGeometry.dispose();
    sphereGroup.children.forEach((sphere) => sphere.material.dispose());
    if (lines) {
      lines.geometry.dispose();
      lines.material.dispose();
    }
    renderer.dispose();
    renderer.forceContextLoss?.();
    wrapper._disposeThemeMotion = null;
    if (wrapper.dataset.renderer === "three")
      wrapper.dataset.renderer = "canvas";
  };
  wrapper._disposeThemeMotion = dispose;
  _touchThemeMotionWebglWrapper(wrapper);
  _pruneThemeMotionWebglWrappers(wrapper);

  let motionTime = 0.4 + Number(slideIndex || 0) * 0.06;
  let lastActiveTimestamp = 0;
  const renderFrame = (timestamp) => {
    if (disposed) return;
    resize();
    const active = _isThemeMotionActive(wrapper, forPreview);
    if (active) {
      _touchThemeMotionWebglWrapper(wrapper);
      _pruneThemeMotionWebglWrappers(wrapper);
      if (lastActiveTimestamp) {
        motionTime +=
          Math.min(80, Math.max(0, timestamp - lastActiveTimestamp)) / 7000;
      }
      lastActiveTimestamp = timestamp;
    } else {
      lastActiveTimestamp = 0;
    }
    const t = motionTime;
    points.rotation.y =
      t *
      (normalized.style === "vortex"
        ? 1.05
        : normalized.style === "mesh"
          ? 0.8
          : 0.55);
    points.rotation.x =
      normalized.style === "wave"
        ? -0.55 + Math.sin(t) * 0.05
        : Math.sin(t) * 0.16;
    if (lines) {
      lines.rotation.copy(points.rotation);
    }
    sphereGroup.rotation.y = points.rotation.y * 0.72;
    sphereGroup.rotation.x = points.rotation.x * 0.54;
    sphereGroup.children.forEach((sphere, index) => {
      const phase = sphere.userData.phase || 0;
      const pulse = 1 + Math.sin(t * 2.2 + phase) * 0.08;
      const base = 0.9 + (index % 4) * 0.18;
      sphere.scale.setScalar(base * pulse);
    });

    if (!reduceMotion && active) {
      targetX = mouseX * 0.15;
      targetY = mouseY * 0.15;
      camera.position.x += (targetX - camera.position.x) * 0.02;
      camera.position.y += (targetY - camera.position.y) * 0.02;
      scene.rotation.x += (-targetY * 0.5 - scene.rotation.x) * 0.02;
      scene.rotation.y += (targetX * 0.5 - scene.rotation.y) * 0.02;

      // Organic pulsing
      light.intensity = 0.7 + Math.sin(t * 12) * 0.15;
      // Around the opacity chosen when the scene was built (stronger on light slides), not a fixed dark-slide value.
      points.material.opacity = Math.min(0.95, pointBaseOpacity + Math.sin(t * 8) * 0.08);
      if (lines) {
        lines.material.opacity = Math.min(0.9, lineBaseOpacity + Math.cos(t * 6) * 0.05);
      }
      camera.position.z = 5.6 + Math.sin(t * 4) * 0.1;
    }

    try {
      renderer.render(scene, camera);
    } catch (err) {
      console.warn("3D background renderer stopped:", err);
      dispose();
      return;
    }
    if (!document.contains(wrapper)) {
      dispose();
      return;
    }
    if (!reduceMotion) {
      if (active) requestAnimationFrame(renderFrame);
      else window.setTimeout(() => requestAnimationFrame(renderFrame), 320);
    }
  };
  requestAnimationFrame(renderFrame);
  return true;
}

// Opacity, blur, brightness and saturation of a slide background. With everything at its default no filter is set:
// even a do-nothing filter makes the browser redraw the animated canvas through an extra pass on every frame.
function applySlideBackgroundAdjustments(node, background) {
  if (!node || !background) return;
  const blur = Number(background.blur) || 0;
  const brightness = Number(background.brightness ?? 100);
  const saturate = Number(background.saturate ?? 100);
  node.style.opacity = String(background.opacity ?? 1);
  node.style.filter =
    blur || brightness !== 100 || saturate !== 100 ? `blur(${blur}px) brightness(${brightness}%) saturate(${saturate}%)` : "";
  node.style.transform = blur ? `scale(${1 + Math.min(40, blur) / 120})` : "";
}

function createThemeThreeBackgroundNode(normalized, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "slide-background-media slide-background-three";
  wrapper.dataset.backgroundType = "three";
  wrapper.dataset.threeStyle = normalized.style || "orbital";
  const colors = _themeMotionColors(options.theme || null);
  wrapper.style.background = _themeMotionBackground(
    normalized.style || "orbital",
    colors,
  );
  const shouldUseThree =
    !options.forPreview &&
    Number(options.slideIndex ?? currentSlideIndex) ===
      getActiveSlideMediaIndex() &&
    document.visibilityState !== "hidden";
  const canvas = document.createElement("canvas");
  canvas.className = "slide-background-three-canvas";
  canvas.setAttribute("aria-hidden", "true");
  wrapper.appendChild(canvas);
  if (
    !shouldUseThree ||
    !_tryRenderThreeThemeMotion(canvas, wrapper, normalized, options)
  ) {
    wrapper.dataset.renderer = "canvas";
    _renderCanvasThemeMotion(canvas, wrapper, normalized, {
      ...options,
      forPreview: true,
    });
  } else {
    wrapper.dataset.renderer = "three";
  }
  return wrapper;
}

function cleanupSlideBackground3D(root = document) {
  root.querySelectorAll?.(".slide-background-three").forEach((wrapper) => {
    if (typeof wrapper._disposeThemeMotion === "function") {
      wrapper._disposeThemeMotion();
      wrapper._disposeThemeMotion = null;
    }
  });
}

function _resetThemeThreeBackgroundRenderer(wrapper, normalized, options = {}) {
  if (!wrapper || !normalized) return;
  cleanupSlideBackground3D(wrapper);
  wrapper.textContent = "";
  const canvas = document.createElement("canvas");
  canvas.className = "slide-background-three-canvas";
  canvas.setAttribute("aria-hidden", "true");
  wrapper.appendChild(canvas);
  if (
    options.useThree &&
    _tryRenderThreeThemeMotion(canvas, wrapper, normalized, options)
  ) {
    wrapper.dataset.renderer = "three";
  } else {
    wrapper.dataset.renderer = "canvas";
    _renderCanvasThemeMotion(canvas, wrapper, normalized, {
      ...options,
      forPreview: true,
    });
  }
}

function createSlideBackgroundNode(
  background,
  { forPreview = false, slideIndex = currentSlideIndex, theme = null } = {},
) {
  const normalized = normalizeSlideBackground(background);
  if (!normalized) return null;
  if (normalized.type === "three") {
    const node = createThemeThreeBackgroundNode(normalized, {
      forPreview,
      slideIndex,
      theme,
    });
    applySlideBackgroundAdjustments(node, normalized);
    return node;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "slide-background-media";
  applySlideBackgroundAdjustments(wrapper, normalized);
  if (normalized.type === "video") {
    const video = document.createElement("video");
    video.className = "slide-background-video";
    video.src = normalized.content;
    video.style.setProperty(
      "object-fit",
      normalized.fit || "cover",
      "important",
    );
    video.muted = true;
    video.loop = true;
    const initiallyActive =
      !forPreview &&
      document.visibilityState !== "hidden" &&
      document.hasFocus() &&
      Number(slideIndex) === getActiveSlideMediaIndex();
    video.autoplay = initiallyActive;
    video.playsInline = true;
    video.preload = forPreview ? "metadata" : "auto";
    video.setAttribute("playsinline", "true");
    if (initiallyActive) {
      const play = () => video.play().catch(() => {});
      video.addEventListener("loadeddata", play, { once: true });
      requestAnimationFrame(play);
    }
    wrapper.appendChild(video);
  } else {
    const image = document.createElement("img");
    image.className = "slide-background-image";
    image.src = normalized.content;
    image.style.setProperty(
      "object-fit",
      normalized.fit || "cover",
      "important",
    );
    image.alt = "";
    image.draggable = false;
    wrapper.appendChild(image);
  }
  return wrapper;
}
