// Requires a local app. Generates a tiny PDB/DCD fixture unless MOLECULE_TEST_DATASET
// points to a folder containing protein.pdb and path_protein.dcd. No project is saved.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert/strict");

function createFixture(directory) {
    const atoms = 4, frames = 24;
    const record = body => {
        const block = Buffer.alloc(body.length + 8);
        block.writeInt32LE(body.length); body.copy(block, 4);
        block.writeInt32LE(body.length, body.length + 4);
        return block;
    };
    const header = Buffer.alloc(84);
    header.write("CORD"); header.writeInt32LE(frames, 4);
    header.writeInt32LE(1, 12); header.writeFloatLE(1, 40); header.writeInt32LE(24, 80);
    const title = Buffer.alloc(84, 32); title.writeInt32LE(1);
    title.write("SlideForge generated trajectory test", 4);
    const count = Buffer.alloc(4); count.writeInt32LE(atoms);
    const records = [record(header), record(title), record(count)];
    for (let frame = 0; frame < frames; frame++) {
        for (let axis = 0; axis < 3; axis++) {
            const coordinates = Buffer.alloc(atoms * 4);
            for (let atom = 0; atom < atoms; atom++) {
                const value = axis === 0 ? atom * 3.8 : axis === 1 ? Math.sin(atom + frame / 5) * (atom + 1) : atom * atom * 0.4;
                coordinates.writeFloatLE(value, atom * 4);
            }
            records.push(record(coordinates));
        }
    }
    const pdb = Array.from({ length: atoms }, (_, atom) => {
        const serial = String(atom + 1).padStart(5), residue = String(atom + 1).padStart(4);
        const coordinates = [atom * 3.8, Math.sin(atom) * (atom + 1), atom * atom * 0.4].map(x => x.toFixed(3).padStart(8)).join("");
        return `ATOM  ${serial}  CA  ALA A${residue}    ${coordinates}  1.00  0.00           C`;
    }).join("\n") + "\nTER\nEND\n";
    fs.writeFileSync(path.join(directory, "protein.pdb"), pdb);
    fs.writeFileSync(path.join(directory, "path_protein.dcd"), Buffer.concat(records));
}

(async () => {
    const temporary = process.env.MOLECULE_TEST_DATASET ? null : fs.mkdtempSync(path.join(os.tmpdir(), "slideforge-trajectory-"));
    const dataset = process.env.MOLECULE_TEST_DATASET || temporary;
    if (temporary) createFixture(temporary);
    let browser;
    try {
        const pdbPath = path.join(dataset, "protein.pdb"), dcdPath = path.join(dataset, "path_protein.dcd");
        const atoms = fs.readFileSync(pdbPath, "utf8").split(/\r?\n/).filter(line => /^(ATOM  |HETATM)/.test(line)).length;
        const header = Buffer.alloc(8), descriptor = fs.openSync(dcdPath, "r");
        try { fs.readSync(descriptor, header, 0, 8, 8); } finally { fs.closeSync(descriptor); }
        const frames = header.readInt32LE(0);
        assert(frames >= 12, "Test requires at least 12 frames");
        browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/media/__trajectory_test/*", route => {
            const name = new URL(route.request().url()).pathname.split("/").pop();
            if (!["protein.pdb", "path_protein.dcd"].includes(name)) return route.abort();
            return route.fulfill({ path: path.join(dataset, name), contentType: "application/octet-stream" });
        });
        await page.goto(process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/", { waitUntil: "networkidle" });
        await page.evaluate(() => {
            const data = {
                ...createMoleculeElementData({ sourceUrl: "/media/__trajectory_test/protein.pdb", name: "Trajectory test" }),
                id: "trajectory-usability",
                moleculeTrajectory: { url: "/media/__trajectory_test/path_protein.dcd", format: "dcd" },
                moleculePlayback: { autoplay: true, fps: 12, startFrame: 10 },
            };
            const host = document.createElement("iframe");
            host.id = "trajectory-test";
            host.style.cssText = "position:fixed;inset:0;width:900px;height:650px;z-index:2147483647;background:white";
            applyMoleculeEmbedSandbox(host); attachMoleculeDataBridge(host, data);
            host.srcdoc = buildMoleculeEmbedSrcdoc(data); document.body.append(host);
        });
        const host = page.locator("#trajectory-test");
        const viewer = await (await host.elementHandle()).contentFrame();
        await viewer.locator("#trajectory-panel").waitFor({ state: "visible", timeout: 30000 }).catch(async error => {
            console.error("Viewer diagnostics", errors, await viewer.locator("#status").textContent()); throw error;
        });
        const info = await viewer.evaluate(() => ({ atoms: sfMoleculeViewer.component().structure.atomCount, frames: sfMoleculeViewer.trajectory().frameCount }));
        assert.deepEqual(info, { atoms, frames });

        // Assert the actual NGL frame and atom coordinates, not just optimistic UI values.
        async function settled(index) {
            await viewer.waitForFunction(expected => {
                const trajectory = sfMoleculeViewer.trajectory(), structure = sfMoleculeViewer.component().structure;
                return document.getElementById("trajectory-panel").getAttribute("aria-busy") !== "true"
                    && trajectory.currentFrame === expected && trajectory.structure.trajectory?.frame === expected
                    && Number(document.getElementById("traj-number").value) === expected + 1;
            }, index);
            const correct = await viewer.evaluate(expected => {
                const trajectory = sfMoleculeViewer.trajectory(), structure = sfMoleculeViewer.component().structure;
                const coordinates = trajectory.frameCache[expected], store = structure.atomStore;
                if (!coordinates) return false;
                return [0, Math.floor(store.count / 2), store.count - 1].every(atom =>
                    ["x", "y", "z"].every((axis, offset) => Math.abs(store[axis][atom] - coordinates[atom * 3 + offset]) < 1e-4));
            }, index);
            assert(correct, "Displayed atom coordinates do not match confirmed frame " + index);
            assert.equal(await viewer.locator("#traj-frame").getAttribute("aria-valuetext"), `Frame ${index + 1} of ${frames}`);
        }
        const lifecycle = (active, presenting) => host.evaluate((node, message) => node.contentWindow.postMessage(message, "*"),
            { type: "pptmaker:molecule:lifecycle", active, presenting });
        const click = name => viewer.getByRole("button", { name, exact: true }).click();
        await settled(9);
        assert.equal(await viewer.locator("#traj-speed-label").textContent(), "12 FPS");
        for (const [name, index] of [["Next frame", 10], ["Previous frame", 9], ["Last frame", frames - 1], ["First frame", 0]]) {
            await click(name); await settled(index);
        }
        const jump = Math.min(800, frames);
        await viewer.locator("#traj-number").fill(String(jump)); await viewer.locator("#traj-number").press("Enter");
        await settled(jump - 1);
        await lifecycle(false, true);
        assert.equal(await viewer.locator("#traj-play").textContent(), "Play", "Hidden slide started autoplay");
        await lifecycle(true, true);
        await viewer.waitForFunction(() => sfMoleculeViewer.trajectory().currentFrame > 9 && document.getElementById("traj-play").textContent === "Pause");
        await lifecycle(false, true);
        await viewer.waitForFunction(() => document.getElementById("trajectory-panel").getAttribute("aria-busy") !== "true");
        const stopped = await viewer.evaluate(() => sfMoleculeViewer.trajectory().currentFrame);
        await page.waitForTimeout(200); await settled(stopped);
        await lifecycle(true, true);
        await viewer.locator("#traj-play").filter({ hasText: "Pause" }).waitFor();
        await click("Next frame");
        assert.equal(await viewer.locator("#traj-play").textContent(), "Play", "Stepping must pause");
        await viewer.locator("#traj-play").click(); await lifecycle(true, false);
        await viewer.waitForFunction(() => document.getElementById("trajectory-panel").getAttribute("aria-busy") !== "true");
        const exited = await viewer.evaluate(() => sfMoleculeViewer.trajectory().currentFrame);
        await page.waitForTimeout(200); await settled(exited);
        assert.equal(await viewer.locator("#traj-play").textContent(), "Play");
        await viewer.evaluate(() => { window.testTrajectory = sfMoleculeViewer.trajectory(); });
        const starting = Math.min(100, frames);
        await host.evaluate((node, startFrame) => node.contentWindow.postMessage({
            type: "pptmaker:molecule:update", playback: { autoplay: false, fps: 18, startFrame },
        }, "*"), starting);
        await settled(starting - 1);
        assert.equal(await viewer.locator("#traj-speed-label").textContent(), "18 FPS");
        assert(await viewer.evaluate(() => sfMoleculeViewer.trajectory() === window.testTrajectory), "Settings reloaded trajectory");

        // Hold real NGL calls until explicitly released. This deterministically simulates slow loads.
        await viewer.evaluate(() => {
            const trajectory = sfMoleculeViewer.trajectory(), original = trajectory.setFrame;
            window.loadGate = { calls: [], waiting: [], active: 0, maximum: 0 };
            trajectory.setFrame = function(index, callback) {
                const gate = window.loadGate;
                gate.calls.push(index); gate.active++; gate.maximum = Math.max(gate.maximum, gate.active);
                gate.waiting.push(() => original.call(this, index, () => { gate.active--; callback?.(); }));
                return this;
            };
            window.releaseFrame = () => {
                const next = window.loadGate.waiting.shift();
                if (!next) throw Error("No held frame to release");
                next();
            };
        });
        const seek = indexes => viewer.evaluate(values => {
            const slider = document.getElementById("traj-frame");
            for (const index of values) { slider.value = String(index); slider.dispatchEvent(new Event("input")); }
        }, indexes);
        await seek([2, 5, 8, 11]);
        assert.deepEqual(await viewer.evaluate(() => loadGate.calls), [2], "Concurrent seek requests");
        assert.equal(await viewer.locator("#traj-number").inputValue(), String(starting), "UI advanced before coordinates loaded");
        await viewer.evaluate(() => releaseFrame());
        assert.deepEqual(await viewer.evaluate(() => loadGate.calls), [2, 11], "Seeks did not coalesce to latest target");
        assert.equal(await viewer.evaluate(() => sfMoleculeViewer.trajectory().currentFrame), 2);
        await viewer.evaluate(() => releaseFrame()); await settled(11);
        assert.equal(await viewer.evaluate(() => loadGate.maximum), 1, "Overlapping NGL frame loads");

        await viewer.evaluate(() => {
            for (let step = 0; step < 3; step++) document.getElementById("traj-next").click();
        });
        assert.deepEqual(await viewer.evaluate(() => loadGate.calls), [2, 11, 12], "Rapid steps overlapped loads");
        await viewer.evaluate(() => releaseFrame());
        assert.deepEqual(await viewer.evaluate(() => loadGate.calls), [2, 11, 12, 14], "Rapid steps lost their latest target");
        await viewer.evaluate(() => releaseFrame()); await settled(14);

        // A paused or hidden viewer discards the queued seek, while allowing its in-flight load to finish.
        await seek([3, 7]); await lifecycle(false, false);
        await viewer.evaluate(() => releaseFrame()); await settled(3);
        assert.deepEqual(await viewer.evaluate(() => loadGate.calls), [2, 11, 12, 14, 3], "Hidden slide drained queued seek");
        await lifecycle(true, false);
        await viewer.locator("#traj-play").click();
        await viewer.waitForFunction(() => loadGate.waiting.length === 1);
        const callsBefore = await viewer.evaluate(() => loadGate.calls.length);
        await page.waitForTimeout(200);
        assert.equal(await viewer.evaluate(() => loadGate.calls.length), callsBefore, "Playback overlapped a slow frame");
        // Check within the same browser task to avoid a timing-sensitive round trip.
        const callsAfterRelease = await viewer.evaluate(() => { releaseFrame(); return loadGate.calls.length; });
        assert.equal(callsAfterRelease, callsBefore, "Completion caused a catch-up burst");
        await viewer.waitForFunction(() => loadGate.waiting.length === 1);
        await viewer.locator("#traj-play").click(); // pause while one request is held
        await viewer.evaluate(() => releaseFrame());
        const paused = await viewer.evaluate(() => sfMoleculeViewer.trajectory().currentFrame);
        await page.waitForTimeout(200); await settled(paused);
        assert.equal(await viewer.evaluate(() => loadGate.waiting.length), 0, "Paused playback restarted from completion callback");
        assert.equal(await viewer.evaluate(() => loadGate.maximum), 1);

        // Also cover a load failure: keep the last confirmed frame, clear busy state and stop playback.
        await viewer.evaluate(() => {
            sfMoleculeViewer.trajectory().setFrame = () => { throw Error("Injected frame failure"); };
        });
        await click("Next frame"); await settled(paused);
        assert((await viewer.locator("#status").textContent()).includes("Injected frame failure"));
        await host.evaluate(node => { node.style.width = "380px"; node.style.height = "320px"; });
        assert(await viewer.locator("#trajectory-panel").evaluate(node => {
            const box = node.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
        }), "Controls overflow a small viewer");
        await host.evaluate(node => { node.style.width = "900px"; node.style.height = "650px"; });
        assert.deepEqual(errors, []);
        if (process.env.MOLECULE_TEST_SCREENSHOT) await host.screenshot({ path: process.env.MOLECULE_TEST_SCREENSHOT });
        await host.evaluate(node => { node._moleculeDataBridgeCleanup?.(); node.remove(); });
        console.log("PASS actual coordinates, navigation, autoplay, serialized loads, latest seek, pause/hide, failures and small layout", info);
    } finally {
        await browser?.close();
        if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
