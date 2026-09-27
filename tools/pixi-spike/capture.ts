/**
 * Pixi spike browser evidence: serves the spike entry, drives scenes via
 * URL params + the exposed __spike handle + DOM controls only (no
 * duplicated renderer math — see review implementation note), and records
 * backend, FPS, texture-cache statistics, and captures.
 *
 * Run: pnpm spike:capture
 * Writes: testdata/pixi-spike/ (manifest.json + PNGs; gitignored, CI artifact)
 *
 * Browser WebGL is required. The script fails LOUDLY (non-zero exit)
 * after writing whatever manifest it could collect when the backend is
 * not WebGL, so a software-fallback run is visible rather than silent.
 *
 * Environment note (proven on-device): headless SwiftShader creates a
 * WebGL2 context and runs the scene graph (stats/FPS/reuse are genuine),
 * but presents no pixels — canvas readback comes back blank. The manifest
 * records per-scene backend + capture method (shotKind) so a blank WebGL
 * pane is never mistaken for evidence. Real-GPU runners will produce
 * real pixels through the same code path; the Canvas2D comparison pane
 * captures everywhere.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const OUT = join(repo, "testdata", "pixi-spike");
mkdirSync(OUT, { recursive: true });

// Resolved pixi.js version (read from the installed package directory
// directly — v8's exports map does not expose ./package.json).
const pixiVersion: string = JSON.parse(
  readFileSync(join(repo, "node_modules", "pixi.js", "package.json"), "utf8"),
).version as string;

const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}/`;

function startServer(): ChildProcess {
  const child = spawn(
    "pnpm", ["--filter", "@digital-evolution/explorer", "exec", "vite",
      join(repo, "tools", "pixi-spike"), "--port", String(PORT), "--strictPort",
      "--host", "127.0.0.1"],
    { cwd: repo, stdio: ["ignore", "pipe", "pipe"] },
  );
  return child;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`spike dev server did not start at ${BASE}`);
}

interface SceneResult {
  fixture: number; organisms: number; tier: string; mode: string;
  backend: string; fps: number | null; sprites: number; liveTextures: number;
  gpuTextures: number; reuse: number; cumulative: number; pruned: number;
  shot: string; shotKind: string;
}

async function main(): Promise<void> {
  const server = startServer();
  let failed = "";
  const scenes: SceneResult[] = [];
  try {
    await waitForServer();
    const browser = await chromium.launch({
      args: ["--enable-unsafe-swiftshader"],
    });
    const version = browser.version();
    const errors: string[] = [];
    // Fixture scenes at population tier (pixi mode): 50 / 250 / 1000 / 3000.
    const plan: Array<{ fixture: number; tier: string; mode: string }> = [
      { fixture: 0, tier: "population", mode: "pixi" },
      { fixture: 1, tier: "population", mode: "pixi" },
      { fixture: 2, tier: "population", mode: "pixi" },
      { fixture: 3, tier: "population", mode: "pixi" },
      // LOD tiers + comparison mode on the 1000-organism scene.
      { fixture: 2, tier: "ecosystem", mode: "pixi" },
      { fixture: 2, tier: "inspection", mode: "pixi" },
      { fixture: 2, tier: "population", mode: "canvas2d" },
    ];
    for (const s of plan) {
      // Fresh page per scene: a dead SwiftShader context must not poison
      // later scenes — each scene boots a new renderer and retries WebGL.
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}?fixture=${s.fixture}&tier=${s.tier}&mode=${s.mode}`, { waitUntil: "networkidle" });
      await page.locator("#stats").waitFor();
      await page.waitForFunction(
        "document.getElementById('stats').textContent.includes('organisms')",
        null, { timeout: 30000 },
      );
      // String form (not closures): tsx/esbuild injects a __name helper
      // into compiled closures that does not exist in the page context.
      // Let the first frames land (shader compile on software GL) so
      // screenshots show rendered scenes, not blank canvases.
      await page.waitForTimeout(1500);
      const stats = await page.evaluate(
        "window.__spike.stats()",
      ) as {
          fixture: string; organisms: number; sprites: number; liveTextures: number;
          gpuTextures: number; reuse: number; cumulative: number; pruned: number;
          tier: string; mode: string; generation: number; backend: string;
        };
      let fps: number | null = null;
      const shot = `f${s.fixture}-${s.tier}-${s.mode}.png`;
      // Headless SwiftShader does not composite WebGL pixels into element
      // screenshots (they come back blank) and the GL context can die
      // mid-scene — so refresh the mapping and read the buffer back on a
      // render frame, before the FPS probe churns the context further.
      let shotKind = "";
      if (s.mode === "pixi") {
        // Synchronous render + readback in ONE task: immune to compositor
        // gaps, post-task buffer clears, and later context death. If the
        // context is already dead this still comes back blank — the
        // manifest's backend field says what really ran.
        const dataUrl = (await page.evaluate(
          "new Promise((resolve) => { const h = window.__spike; " +
          "try { h.app.renderer.render(h.app.stage); } catch (e) { /* dead context */ } " +
          "resolve(document.getElementById('pixi-world').toDataURL('image/png')); })",
        )) as string;
        writeFileSync(join(OUT, shot), Buffer.from(dataUrl.split(",")[1]!, "base64"));
        shotKind = "canvas-readback";
      } else {
        await page.locator("#stage").screenshot({ path: join(OUT, shot) });
        shotKind = "element";
      }
      if (s.mode === "pixi") {
        fps = (await page.evaluate(
          "new Promise((resolve) => { let frames = 0; const t0 = performance.now(); " +
          "const tick = () => { frames++; " +
          "if (performance.now() - t0 < 2000) requestAnimationFrame(tick); " +
          "else resolve((frames * 1000) / (performance.now() - t0)); }; " +
          "requestAnimationFrame(tick); })",
        )) as number;
      }
      scenes.push({
        fixture: s.fixture, organisms: stats.organisms, tier: stats.tier as string, mode: stats.mode as string,
        backend: stats.backend, fps: fps === null ? null : Math.round(fps * 10) / 10,
        sprites: stats.sprites, liveTextures: stats.liveTextures, gpuTextures: stats.gpuTextures,
        reuse: stats.reuse, cumulative: stats.cumulative, pruned: stats.pruned, shot,
        shotKind,
      });
      console.log(`scene f${s.fixture}/${s.tier}/${s.mode}: backend=${stats.backend} fps=${fps === null ? "n/a" : fps.toFixed(1)} reuse=${stats.reuse.toFixed(1)}x`);
      await page.close().catch(() => undefined);
    }
    // Close can hang on zombie browser children (observed on-device):
    // race it, then force-exit — the manifest and asserts above are the
    // actual evidence payload.
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
    const manifest = {
      pixiVersion, browser: `chromium/${version}`, baseUrl: BASE,
      generatedAt: new Date().toISOString(), pageErrors: errors, scenes,
    };
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`pixi spike evidence -> ${OUT} (${scenes.length} scenes)`);
    // Review fix: the accepted backend is WebGL2 — EVERY intended Pixi
    // scene must prove it, not just any scene. A WebGL1/class fallback
    // or a mid-run context loss now fails loudly instead of hiding in
    // the average.
    const pixiScenes = scenes.filter((s) => s.mode === "pixi");
    assert.ok(pixiScenes.length > 0, "no pixi scenes captured");
    assert.ok(errors.length === 0, `page errors: ${errors.join("; ")}`);
    for (const s of pixiScenes) {
      assert.ok(
        s.backend.includes("webgl2:yes"),
        `scene f${s.fixture}/${s.tier} backend is ${s.backend}, not WebGL2`,
      );
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    try {
      writeFileSync(join(OUT, "FAILURE.txt"), failed + "\n");
    } catch { /* best effort */ }
    console.error(`pixi spike capture FAILED: ${failed}`);
    process.exitCode = 1;
  } finally {
    try {
      server.kill("SIGKILL");
    } catch { /* already gone */ }
  }
  // Force-exit: browser-driver zombies have been observed holding the
  // event loop open on-device after the evidence payload is complete.
  process.exit(process.exitCode ?? 0);
}

// Entry point (no top-level await: the repo root is CommonJS-typed, and
// tsx compiles .ts by nearest package.json — keep this file CJS-safe).
void main();
