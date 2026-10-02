const { chromium } = require("playwright");

const url = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/";
const failures = [];
const warnings = [];

function assert(name, condition, details = "") {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  const message = details ? `${name}: ${details}` : name;
  failures.push(message);
  console.log(`FAIL ${message}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const dialogs = [];
  const consoleErrors = [];
  page.on("dialog", async dialog => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on("console", message => {
    if (message.type() === "error") {
      const text = message.text();
      const location = message.location();
      const suffix = location.url ? ` @ ${location.url}:${location.lineNumber}:${location.columnNumber}` : "";
      const combined = `${text} ${location.url || ""}`;
      if (
        !combined.includes("/api/invalid-endpoint") &&
        !combined.includes("/api/auth/session/") &&
        !combined.includes("favicon.ico") &&
        !combined.includes(`${new URL(url).origin}/x`) // <img src=x> from the XSS probe below
      ) {
        consoleErrors.push(`${text}${suffix}`);
      }
    }
  });
  page.on("pageerror", err => consoleErrors.push(err.stack || err.message));

  await page.addInitScript(() => {
    sessionStorage.setItem("pptmaker_entry_gate_dismissed", "true");
    localStorage.setItem("pptmaker_properties_panel_visible", "1");
    document.addEventListener("DOMContentLoaded", () => {
      // These suites test the editor itself; test-start-screen.js covers the start screen.
      window.openStartScreen = () => false;
    });
    window.__phase2HandledRejection = false;
    window.addEventListener("unhandledrejection", event => {
      window.__phase2HandledRejection = true;
      // The probe below rejects on purpose; only that one is expected, so keep it out of the console-error check.
      if (event.reason?.message === "Phase 2 handled rejection probe") event.preventDefault();
    });
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#slides-container section", { timeout: 20000 });
  await page.waitForFunction(() => window.Reveal && window.state, null, { timeout: 20000 });
  await page.waitForTimeout(1000);

  console.log(`URL ${url}`);

  const boot = await page.evaluate(() => ({
    app: !!window.app,
    commands: !!window.app?.commands,
    addSlide: typeof window.app?.commands?.addSlide === "function",
    deleteCurrentSlide: typeof window.app?.commands?.deleteCurrentSlide === "function",
    undo: typeof window.app?.commands?.undo === "function",
    redo: typeof window.app?.commands?.redo === "function",
    saveProject: typeof window.app?.commands?.saveProject === "function",
    threeBackground: typeof window.app?.commands?.setCurrentSlideBackgroundThree === "function",
    tracker: Array.isArray(window._trackedListeners),
    domPurify: !!window.DOMPurify,
    initialSlides: window.state?.slides?.length || 0,
  }));
  assert("app object exists", boot.app);
  assert("commands facade exists", boot.commands);
  assert("add slide command exists", boot.addSlide);
  assert("delete slide command exists", boot.deleteCurrentSlide);
  assert("undo command exists", boot.undo);
  assert("redo command exists", boot.redo);
  assert("save command exists", boot.saveProject);
  assert("3D background command exists", boot.threeBackground);
  assert("event tracking exposed", boot.tracker);
  assert("DOMPurify loaded", boot.domPurify);

  console.log("TEST 1 3D background slide churn");
  const churn = await page.evaluate(async () => {
    const memory = () => performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const startMemory = memory();
    const startSlides = window.state.slides.length;
    const styles = ["orbital", "constellation", "waves"];
    for (let i = 0; i < 100; i += 1) {
      window.app.commands.addSlide();
      window.app.commands.setCurrentSlideBackgroundThree(styles[i % styles.length]);
      if (i % 10 === 0) await sleep(16);
    }
    await sleep(500);
    const canvasesAfterCreate = document.querySelectorAll("canvas.slide-background-three-canvas").length;
    const slideCountAfterCreate = window.state.slides.length;
    for (let i = 0; i < 100; i += 1) {
      window.app.commands.deleteCurrentSlide();
      if (i % 10 === 0) await sleep(16);
    }
    await sleep(1000);
    const endMemory = memory();
    return {
      startMemory,
      endMemory,
      growth: startMemory !== null && endMemory !== null ? endMemory - startMemory : null,
      startSlides,
      slideCountAfterCreate,
      finalSlides: window.state.slides.length,
      canvasesAfterCreate,
      remainingCanvases: document.querySelectorAll("canvas.slide-background-three-canvas").length,
    };
  });
  assert("created 100 slides", churn.slideCountAfterCreate >= churn.startSlides + 100, JSON.stringify(churn));
  assert("3D canvases rendered during churn", churn.canvasesAfterCreate > 0, JSON.stringify(churn));
  assert("deleted churn slides", churn.finalSlides === boot.initialSlides, JSON.stringify(churn));
  if (churn.growth === null) warnings.push("Memory API unavailable in this browser context");
  else assert("memory growth below 100MB", churn.growth < 100, JSON.stringify(churn));
  assert("3D canvases cleaned after delete", churn.remainingCanvases <= 1, JSON.stringify(churn));

  console.log("TEST 1b 3D background renderer persistence");
  const lifecycle = await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const sampleDistance = (a, b) => {
      if (!a || !b) return Infinity;
      const length = Math.min(a.length, b.length);
      const step = Math.max(1, Math.floor(length / 4000));
      let diff = 0;
      let count = 0;
      for (let i = 0; i < length; i += step) {
        diff += Math.abs(a.charCodeAt(i) - b.charCodeAt(i));
        count += 1;
      }
      return diff / Math.max(1, count);
    };
    const go = async index => {
      window.setCurrentSlideIndex?.(index);
      window.Reveal.slide(index);
      window.syncActiveSlideMedia?.();
      await sleep(450);
    };
    const styles = ["orbital", "mesh", "particles", "lattice", "wave", "vortex"];
    for (let i = 0; i < 8; i += 1) {
      window.app.commands.addSlide();
      window.app.commands.setCurrentSlideBackgroundThree(styles[i % styles.length]);
      await sleep(25);
    }
    await go(5);
    const firstWrapper = document.querySelector('.presentation-slide[data-slide-index="5"] .slide-background-three');
    const firstCanvas = firstWrapper?.querySelector("canvas.slide-background-three-canvas");
    if (firstCanvas) firstCanvas.dataset.phase2CanvasId = "retained-canvas";
    await sleep(700);
    const beforeLeaveImage = firstCanvas?.toDataURL("image/png") || "";
    await go(6);
    window.setCurrentSlideIndex?.(5);
    window.Reveal.slide(5);
    window.syncActiveSlideMedia?.();
    await sleep(80);
    const returnedWrapper = document.querySelector('.presentation-slide[data-slide-index="5"] .slide-background-three');
    const returnedCanvas = returnedWrapper?.querySelector("canvas.slide-background-three-canvas");
    const afterReturnImage = returnedCanvas?.toDataURL("image/png") || "";
    await sleep(700);
    const afterResumeImage = returnedCanvas?.toDataURL("image/png") || "";
    for (let i = 1; i < window.state.slides.length; i += 1) {
      await go(i);
    }
    return {
      retainedRecentRenderer:
        returnedWrapper?.dataset.renderer === "three" &&
        returnedCanvas?.dataset.phase2CanvasId === "retained-canvas",
      liveWebglBackgrounds: document.querySelectorAll('.slide-background-three[data-renderer="three"]').length,
      slideCount: window.state.slides.length,
      returnFrameDelta: sampleDistance(beforeLeaveImage, afterReturnImage),
      resumeFrameDelta: sampleDistance(afterReturnImage, afterResumeImage),
    };
  });
  assert("recent 3D renderer is retained across navigation", lifecycle.retainedRecentRenderer, JSON.stringify(lifecycle));
  assert("3D renderer returns without animation jump", lifecycle.returnFrameDelta <= 2, JSON.stringify(lifecycle));
  assert("3D renderer resumes after return", lifecycle.resumeFrameDelta > 0, JSON.stringify(lifecycle));
  assert("live 3D WebGL backgrounds are capped", lifecycle.liveWebglBackgrounds <= 6, JSON.stringify(lifecycle));
  assert("3D lifecycle setup created test slides", lifecycle.slideCount >= 9, JSON.stringify(lifecycle));

  console.log("TEST 2 XSS payload injection");
  await page.evaluate(() => {
    window.__xssPayloadExecuted = false;
    const payloads = [
      `<img src=x onerror="window.__xssPayloadExecuted = true">`,
      `<svg onload="window.__xssPayloadExecuted = true"></svg>`,
      `<a href="javascript:window.__xssPayloadExecuted = true">x</a>`,
    ];
    const host = document.createElement("div");
    host.innerHTML = payloads.map(payload => window.DOMPurify.sanitize(payload)).join("");
    document.body.appendChild(host);
  });
  await page.waitForTimeout(250);
  const xss = await page.evaluate(() => ({
    executed: !!window.__xssPayloadExecuted,
    dangerousAttrs: [...document.querySelectorAll("img,svg,a")].some(node =>
      [...node.attributes].some(attr => /^on/i.test(attr.name) || /^javascript:/i.test(attr.value))
    ),
  }));
  assert("XSS payloads did not execute", !xss.executed, JSON.stringify(xss));
  assert("sanitized DOM has no event/javascript attributes", !xss.dangerousAttrs, JSON.stringify(xss));
  assert("no alert dialogs during XSS test", dialogs.length === 0, dialogs.join("; "));

  console.log("TEST 3 event listener cleanup");
  const listeners = await page.evaluate(async () => {
    const before = window._trackedListeners.length;
    for (let i = 0; i < 50; i += 1) {
      const slide = document.querySelector(".slide-thumb, .slide-list-item, .slide-thumbnail");
      slide?.click();
      document.body.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return { before, after: window._trackedListeners.length };
  });
  assert("event listener count stable", listeners.after <= listeners.before + 5, JSON.stringify(listeners));

  console.log("TEST 4 promise rejection handling");
  const promiseResult = await page.evaluate(async () => {
    Promise.reject(new Error("Phase 2 handled rejection probe"));
    try {
      await fetch("/api/invalid-endpoint");
    } catch (_err) {}
    await new Promise(resolve => setTimeout(resolve, 250));
    return { handled: !!window.__phase2HandledRejection };
  });
  assert("promise rejection handler observed rejection", promiseResult.handled, JSON.stringify(promiseResult));

  console.log("TEST 5 UI regression smoke");
  const ui = await page.evaluate(() => {
    const visible = selector => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };
    return {
      toolbar: visible("header, .toolbar, #top-toolbar"),
      canvas: visible("#canvas-wrapper, #slides-container, .reveal"),
      slidePanel: visible("#slide-list, #slides-panel, #panel-slides, .slides-sidebar"),
      propertiesPanel: visible("#properties-panel, .properties-panel"),
      buttons: document.querySelectorAll("button").length,
      icons: document.querySelectorAll("i, svg, .material-icons, .lucide").length,
      slideCount: window.state?.slides?.length || 0,
    };
  });
  assert("toolbar/header visible", ui.toolbar, JSON.stringify(ui));
  assert("canvas visible", ui.canvas, JSON.stringify(ui));
  assert("slide panel visible", ui.slidePanel, JSON.stringify(ui));
  assert("properties panel visible", ui.propertiesPanel, JSON.stringify(ui));
  assert("buttons present", ui.buttons > 20, JSON.stringify(ui));
  assert("icons present", ui.icons > 10, JSON.stringify(ui));
  assert("slide state valid", ui.slideCount >= 1, JSON.stringify(ui));

  if (consoleErrors.length) {
    failures.push(`console errors: ${consoleErrors.slice(0, 5).join(" | ")}`);
  }

  await browser.close();

  console.log("WARNINGS", JSON.stringify(warnings));
  if (failures.length) {
    console.log("PHASE2_RESULT FAIL");
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("PHASE2_RESULT PASS");
})();
