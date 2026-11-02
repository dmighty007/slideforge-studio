// Builds frontend/css/tailwind.css: the Tailwind utilities the app uses, made once instead of in the page.
//
// The page used to run Tailwind's in-browser compiler (vendor/tailwind/tailwind.cdn.js). It watches the whole
// document and rescans every change; redrawing a 200-slide deck spent about 1.7 s of each edit in it. This runs that
// same compiler, with the same config, over every class-like word in index.html and the app's scripts (the way
// Tailwind's own build scans its "content" files), and saves what it generates.
//
// Run after adding Tailwind classes to index.html or frontend/js:
//   node tools/build-tailwind.cjs
// Needs Playwright (PLAYWRIGHT_MODULE may point to an installed module; CHROMIUM_PATH to a browser).
// Classes built at run time from pieces (`bg-${colour}-500`) are not found: write class names out in full.

const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "frontend");
const output = path.join(frontend, "css", "tailwind.css");

// The theme the app's markup is written against (it was inline in index.html).
const config = {
    theme: {
        extend: {
            colors: {
                surface: "#F5F6F8",
                canvas: "#FFFFFF",
                primary: "#4F46E5",
                "primary-hover": "#4338CA",
                accent: "#0F766E",
                "text-main": "#0F172A",
                "text-sub": "#475569",
                border: "#CBD5E1",
                sidebar: "#F8FAFC",
                panel: "#F1F5F9",
                "pastel-blue": "#A5D8FF",
                "pastel-cyan": "#D0EBFF",
                "pastel-green": "#B7E4C7",
                "pastel-mint": "#B7E4C7",
                "pastel-yellow": "#FFE8A3",
                "pastel-orange": "#FFD6A5",
                "pastel-lavender": "#C7C9F4",
            },
            fontFamily: {
                sans: ['"Plus Jakarta Sans"', "Inter", "system-ui", "-apple-system", "sans-serif"],
                display: ['"Outfit"', "Manrope", "Inter", "sans-serif"],
            },
            boxShadow: {
                slide: "0 12px 30px rgba(0,0,0,0.08)",
                panel: "0 2px 8px rgba(0,0,0,0.04)",
                toolbar: "0 1px 4px rgba(0,0,0,0.03)",
                soft: "0 2px 6px rgba(0,0,0,0.05)",
            },
        },
    },
};

function sources() {
    const files = [path.join(frontend, "index.html")];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "vendor") walk(full);
            } else if (/\.(js|mjs|html)$/.test(entry.name)) {
                files.push(full);
            }
        }
    };
    walk(path.join(frontend, "js"));
    return files;
}

// Tailwind's default extractor: runs of characters that are not quotes, angle brackets or space.
function candidates() {
    const found = new Set();
    for (const file of sources()) {
        const text = fs.readFileSync(file, "utf8");
        for (const token of text.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || []) {
            if (token.length <= 120) found.add(token);
        }
    }
    return [...found];
}

(async () => {
    const tokens = candidates();
    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox"],
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });
    try {
        const page = await browser.newPage();
        await page.setContent("<!doctype html><html><head></head><body></body></html>");
        await page.addScriptTag({ content: `window.tailwind = {}; tailwind.config = ${JSON.stringify(config)};` });
        await page.addScriptTag({ path: path.join(frontend, "vendor", "tailwind", "tailwind.cdn.js") });
        const css = await page.evaluate(async tokens => {
            const holder = document.createElement("div");
            // In chunks: one class attribute of every token is slow for the compiler to split.
            for (let i = 0; i < tokens.length; i += 500) {
                const div = document.createElement("div");
                div.className = tokens.slice(i, i + 500).join(" ");
                holder.appendChild(div);
            }
            document.body.appendChild(holder);
            const generated = () => [...document.querySelectorAll("style")].find(style => style.textContent.includes("--tw-"));
            let last = -1;
            for (let tries = 0; tries < 100; tries++) {
                await new Promise(resolve => setTimeout(resolve, 200));
                const length = generated()?.textContent.length ?? 0;
                if (length && length === last) break; // settled
                last = length;
            }
            return generated()?.textContent || "";
        }, tokens);
        if (!css.includes("--tw-")) throw new Error("Tailwind produced no CSS");
        const banner = "/* Generated by tools/build-tailwind.cjs from index.html and frontend/js. Do not edit; rerun the tool. */\n";
        fs.writeFileSync(output, banner + css + "\n");
        console.log(`${path.relative(root, output)}: ${css.length.toLocaleString()} characters from ${tokens.length.toLocaleString()} candidate words`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
