// The README's framed images (docs/images/readme-*.webp), drawn from the editor captures beside them
// (editor.jpg, gallery.jpg, molecule.jpg, diagram.jpg, plugins.jpg) with the app's own fonts.
// Run from the repository root after replacing a capture:  node tools/render-readme-images.cjs [file]
// Then look at each image before committing it.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const images = path.join(root, "docs", "images");
const img = name => "file://" + path.join(images, name);
const font = (family, weight) => {
    const slug = family.toLowerCase().replace(/ /g, "-");
    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(file://${root}/frontend/vendor/fontsource/${slug}/files/${slug}-latin-${weight}-normal.woff2) format('woff2');}`;
};
// gallery.jpg is four 960x540 slides on a 1960x1120 sheet: a tile shows one of them.
const tile = n => {
    const [x, y] = [[10, 10], [990, 10], [10, 570], [990, 570]][n - 1];
    return `<div class="tile"><img src="${img("gallery.jpg")}" style="left:-${(x / 960) * 100}%;top:-${(y / 540) * 100}%"></div>`;
};

const CSS = `
${font("Space Grotesk", 500)}${font("Space Grotesk", 700)}${font("DM Sans", 400)}${font("DM Sans", 500)}${font("DM Sans", 600)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
.canvas{position:relative;overflow:hidden;border-radius:28px;color:#fff;font-family:'DM Sans',sans-serif;
  background:
    radial-gradient(900px 520px at 88% -8%, rgba(94,234,212,.20), transparent 62%),
    radial-gradient(800px 600px at -6% 108%, rgba(56,132,255,.16), transparent 60%),
    linear-gradient(135deg,#0c1729 0%,#0e2638 48%,#0f3a3f 100%);}
.canvas::before{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:22px 22px;
  mask-image:linear-gradient(180deg,rgba(0,0,0,.9),rgba(0,0,0,.15));}
.inner{position:relative;padding:64px 80px}
.brand{display:flex;align-items:center;gap:14px;font-family:'Space Grotesk';font-weight:700;font-size:26px;color:#d4f7f2;letter-spacing:.3px}
.brand i{display:block;width:8px;height:30px;border-radius:4px;background:linear-gradient(#5eead4,#22b8a6)}
.top{display:flex;justify-content:space-between;align-items:center}
.kicker{font-size:16px;font-weight:600;letter-spacing:3.2px;text-transform:uppercase;color:#7fe3d3}
h1{font-family:'Space Grotesk';font-weight:700;font-size:60px;letter-spacing:-1.6px;line-height:1.05;margin-top:40px}
h2{font-family:'Space Grotesk';font-weight:700;font-size:46px;letter-spacing:-1.1px;line-height:1.1;margin-top:12px}
.sub{font-size:24px;color:#b9d0d8;margin-top:16px;line-height:1.4}
.accent{background:linear-gradient(90deg,#5eead4,#7cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.window{border-radius:16px;background:rgba(255,255,255,.10);padding:8px;
  box-shadow:0 40px 90px -20px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.14),0 0 80px -10px rgba(94,234,212,.25)}
.window .bar{height:30px;display:flex;align-items:center;gap:8px;padding:0 12px}
.window .bar b{width:12px;height:12px;border-radius:50%;background:#ff5f57}.window .bar b:nth-child(2){background:#febc2e}.window .bar b:nth-child(3){background:#28c840}
.window img{display:block;width:100%;border-radius:10px}
.chips{display:flex;gap:14px;flex-wrap:wrap}
.chip{font-size:19px;font-weight:500;color:#d6eef0;padding:10px 20px;border-radius:999px;background:rgba(255,255,255,.07);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.chip em{font-style:normal;color:#5eead4;margin-right:8px}
.card{border-radius:14px;overflow:hidden;background:#fff;
  box-shadow:0 30px 60px -18px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.16)}
.card img{display:block;width:100%}
.tile{position:relative;aspect-ratio:16/9;overflow:hidden}.tile img{position:absolute;width:204.1667%;max-width:none}
.label{display:flex;align-items:center;gap:12px;margin-top:18px;font-size:21px;font-weight:600;color:#e6f6f6}
.label span{font-family:'Space Grotesk';font-size:15px;font-weight:700;color:#0c1729;background:#5eead4;border-radius:8px;padding:3px 9px}
.label small{font-size:18px;font-weight:400;color:#9fbcc4}
`;

const pages = {
    "readme-hero.webp": {
        width: 1600,
        html: `<div class="canvas"><div class="inner" style="padding-bottom:56px">
      <div class="top"><div class="brand"><i></i>SlideForge</div><div class="kicker">Built for science</div></div>
      <h1>Scientific figures. <span class="accent">Presentation ready.</span></h1>
      <p class="sub">Build your figures on the slide. Present them. Take them to PowerPoint.</p>
      <div class="window" style="margin-top:48px"><div class="bar"><b></b><b></b><b></b></div><img src="${img("editor.jpg")}"></div>
      <div class="chips" style="margin-top:44px;justify-content:center">
        <div class="chip"><em>●</em>Free &amp; open source</div><div class="chip"><em>●</em>Charts · Equations · Molecules</div>
        <div class="chip"><em>●</em>PowerPoint · PDF · Web</div><div class="chip"><em>●</em>Linux · macOS · Windows</div></div>
    </div></div>`,
    },
    "readme-gallery.webp": {
        width: 1600,
        html: `<div class="canvas"><div class="inner">
      <div class="kicker">One research story</div>
      <h2>From plasmid to mechanism, <span class="accent">made in SlideForge</span></h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:44px 48px;margin-top:48px">
        <div><div class="card">${tile(1)}</div><div class="label"><span>01</span>Plasmid map <small>from a feature list</small></div></div>
        <div><div class="card">${tile(2)}</div><div class="label"><span>02</span>MIC heatmap <small>pasted from a spreadsheet</small></div></div>
        <div><div class="card">${tile(3)}</div><div class="label"><span>03</span>Curve fit <small>with its equation in LaTeX</small></div></div>
        <div><div class="card">${tile(4)}</div><div class="label"><span>04</span>Mechanism <small>built step by step</small></div></div>
      </div></div></div>`,
    },
    "readme-features.webp": {
        width: 1600,
        html: `<div class="canvas"><div class="inner">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px">
        <div><div class="kicker">Molecules</div><h2 style="font-size:36px">Rotate the structure <span class="accent">during your talk</span></h2>
          <div class="card" style="margin-top:32px"><img src="${img("molecule.jpg")}"></div>
          <div class="label"><small>NDM-1 with meropenem and its two zinc ions, from a PDB file</small></div></div>
        <div><div class="kicker">Diagrams</div><h2 style="font-size:36px">Reveal the mechanism <span class="accent">one step at a time</span></h2>
          <div class="card" style="margin-top:32px"><img src="${img("diagram.jpg")}"></div>
          <div class="label"><small>Boxes and connectors that stay joined as you move them</small></div></div>
      </div></div></div>`,
    },
    "readme-plugins.webp": {
        width: 1600,
        html: `<div class="canvas"><div class="inner">
      <div class="top"><div><div class="kicker">Plugins</div>
        <h2>26 science tools, <span class="accent">one search away</span></h2>
        <p class="sub" style="font-size:22px">Chemistry, biology, statistics and physics, drawn on the slide and editable later.</p></div></div>
      <div class="window" style="margin-top:40px"><div class="bar"><b></b><b></b><b></b></div><img src="${img("plugins.jpg")}"></div>
      <div class="chips" style="margin-top:40px">
        <div class="chip">SMILES &amp; RDKit</div><div class="chip">Phylogenetic tree</div><div class="chip">Gel</div><div class="chip">Plasmid map</div>
        <div class="chip">Kaplan–Meier</div><div class="chip">Volcano plot</div><div class="chip">Feynman diagram</div><div class="chip">+ 19 more</div></div>
    </div></div>`,
    },
};

(async () => {
    const browser = await chromium.launch();
    const only = process.argv[2];
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "readme-images-"));
    for (const [file, { width, html }] of Object.entries(pages)) {
        if (only && only !== file) continue;
        const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
        page.on("requestfailed", r => console.warn("could not load", r.url()));
        const htmlPath = path.join(work, file.replace(".webp", ".html"));
        fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`);
        await page.goto("file://" + htmlPath);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const png = await page.locator(".canvas").screenshot({ omitBackground: true });
        // Playwright writes PNG or JPEG; Chromium's canvas encodes WebP (with the rounded corners' transparency).
        const webp = await page.evaluate(async dataUrl => {
            const picture = new Image();
            picture.src = dataUrl;
            await picture.decode();
            const canvas = Object.assign(document.createElement("canvas"), { width: picture.width, height: picture.height });
            canvas.getContext("2d").drawImage(picture, 0, 0);
            return canvas.toDataURL("image/webp", 0.88);
        }, "data:image/png;base64," + png.toString("base64"));
        fs.writeFileSync(path.join(images, file), Buffer.from(webp.split(",")[1], "base64"));
        console.log("wrote docs/images/" + file);
        await page.close();
    }
    fs.rmSync(work, { recursive: true, force: true });
    await browser.close();
})();
