/**
 * pixiWorld browser proof: serves the production Pixi modules,
 * drives boot/resize/mint/retire/teardown and organism reconciliation via __pixiworld
 * handle (string-form evaluates only), and records backend evidence.
 *
 * Run: pnpm test:pixi-world
 * Writes: testdata/pixi-world-proof/ (manifest.json; gitignored, CI artifact)
 *
 * Asserts (Owner review on PR #73):
 * - bootPixiWorld() initializes; reported backend is actually WebGL2;
 * - host resize reaches the renderer/canvas;
 * - textureFromBits() mints a nearest-filtered population-tier texture;
 * - destroyTexture() retires texture AND source (AC-P7: no indefinite leak);
 * - organism movement retains displays and does not mint morphology textures;
 * - world replacement retires the prior organism display/resource set;
 * - destroy() removes the canvas and releases renderer resources.
 * Exercises production PixiWorld modules in an isolated proof page; integrated
 * App/read-model behavior is separately covered by browser-smoke and mobile-ui.
 *
 * Browser WebGL required. Fails LOUDLY (non-zero exit) when the backend is
 * not WebGL2. Headless SwiftShader presents no pixels on-device, but every
 * assertion here is state-based (flags, sizes, labels), never pixel-based,
 * so software GL proves only the asserted renderer/organism lifecycle claims;
 * it does not prove production App integration, environment/camera parity,
 * analytical-field exactness, phone overlays, or Android runtime behavior.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const OUT = join(repo, "testdata", "pixi-world-proof");
mkdirSync(OUT, { recursive: true });

const pixiVersion: string = JSON.parse(
  readFileSync(join(repo, "node_modules", "pixi.js", "package.json"), "utf8"),
).version as string;

const PORT = 5194;
const BASE = `http://127.0.0.1:${PORT}/`;

function startServer(): ChildProcess {
  const child = spawn(
    "pnpm", ["--filter", "@digital-evolution/explorer", "exec", "vite",
      join(repo, "tools", "pixi-world-proof"), "--port", String(PORT), "--strictPort",
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
  throw new Error(`pixi-world proof server did not start at ${BASE}`);
}

async function main(): Promise<void> {
  const server = startServer();
  let viteOutput = "";
  server.stdout?.on("data", (chunk: Buffer) => { viteOutput = `${viteOutput}${chunk.toString()}`.slice(-16_000); });
  server.stderr?.on("data", (chunk: Buffer) => { viteOutput = `${viteOutput}${chunk.toString()}`.slice(-16_000); });
  let failed = "";
  const evidence: Record<string, unknown> = {};
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  let browserVersion = "unavailable";
  try {
    await waitForServer();
    const browser = await chromium.launch({
      args: ["--enable-unsafe-swiftshader"],
    });
    browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      failedResponses.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "request failed"}`);
    });
    try {
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.locator("#stats").waitFor();
      try {
        await page.waitForFunction("window.__pixiworldReady === true", null, { timeout: 30000 });
      } catch (error) {
        const startup = await page.evaluate(() => ({
          ready: (window as Window & { __pixiworldReady?: boolean }).__pixiworldReady ?? false,
          statsText: document.querySelector("#stats")?.textContent ?? null,
          probeExposed: typeof (window as Window & { __pixiworld?: unknown }).__pixiworld !== "undefined",
          scripts: [...document.scripts].map((script) => script.src),
        })).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
        evidence.startupFailure = { error: String(error), startup, pageErrors: [...errors], consoleErrors: [...consoleErrors], failedResponses: [...failedResponses] };
        throw new Error(`pixiWorld probe readiness failed: ${JSON.stringify(evidence.startupFailure)}`);
      }

      // 1. Boot + backend.
      const stats = await page.evaluate("window.__pixiworld.stats()") as {
        backend: string; canvasW: number; canvasH: number; backingW: number; backingH: number; resolution: number; layers: string[];
      };
      evidence.boot = stats;
      console.log(`boot: backend=${stats.backend} canvas=${stats.canvasW}x${stats.canvasH}`);
      assert.ok(stats.backend.includes("webgl2:yes"), `backend is ${stats.backend}, not WebGL2`);
      assert.deepEqual(stats.layers, [
        "environment", "analytical-field", "waste-cue",
        "organisms", "selection-focus", "effects",
      ]);
      assert.equal(stats.canvasW, 600);
      assert.equal(stats.canvasH, 600);
      assert.equal(stats.backingW, 600 * stats.resolution, "backing width follows renderer resolution");
      assert.equal(stats.backingH, 600 * stats.resolution, "backing height follows renderer resolution");

      // 2. Host resize reaches the renderer in CSS pixels.
      await page.evaluate("window.__pixiworld.setStageSize(800, 500)");
      await page.waitForFunction(
        "window.__pixiworld.stats().canvasW === 800",
        null, { timeout: 10000 },
      );
      const resized = await page.evaluate("window.__pixiworld.stats()") as {
        canvasW: number; canvasH: number;
      };
      evidence.resize = resized;
      assert.equal(resized.canvasW, 800);
      assert.equal(resized.canvasH, 500);
      const resizedBacking = await page.evaluate("window.__pixiworld.stats()") as {
        canvasW: number; canvasH: number; backingW: number; backingH: number; resolution: number;
      };
      assert.equal(resizedBacking.backingW, resizedBacking.canvasW * resizedBacking.resolution);
      assert.equal(resizedBacking.backingH, resizedBacking.canvasH * resizedBacking.resolution);
      console.log(`resize: host 800x500 -> canvas ${resized.canvasW}x${resized.canvasH}`);

      // 3. Mint: real phenotype geometry, nearest-filtered.
      const minted = await page.evaluate("window.__pixiworld.mintProbe()") as {
        w: number; h: number; scaleMode: string;
      };
      evidence.mint = minted;
      assert.equal(minted.w, 9, "population-tier texture width");
      assert.equal(minted.h, 9, "population-tier texture height");
      assert.equal(minted.scaleMode, "nearest", "phenotype textures stay nearest-filtered");
      console.log(`mint: ${minted.w}x${minted.h} scaleMode=${minted.scaleMode}`);

      // 4. Retire: texture AND source destroyed (AC-P7).
      const retired = await page.evaluate("window.__pixiworld.destroyProbe()") as {
        texDestroyed: boolean; srcDestroyed: boolean;
      };
      evidence.retire = retired;
      assert.equal(retired.texDestroyed, true, "retired texture destroyed");
      assert.equal(retired.srcDestroyed, true, "retired texture source destroyed");
      console.log(`retire: texture destroyed=${retired.texDestroyed}, source destroyed=${retired.srcDestroyed}`);

      // 5. Obsolete async boot must stop before attaching a canvas.
      const obsolete = await page.evaluate("window.__pixiworld.obsoleteBootProbe()") as {
        returnedNull: boolean; attachedCanvasCount: number;
      };
      evidence.obsoleteBoot = obsolete;
      assert.equal(obsolete.returnedNull, true, "obsolete boot returns no live handle");
      assert.equal(obsolete.attachedCanvasCount, 0, "obsolete boot attaches no canvas");
      console.log(`obsolete boot: returned null=${obsolete.returnedNull}, attached canvases=${obsolete.attachedCanvasCount}`);

      // 6. Teardown: canvas removed.
      const gone = await page.evaluate("window.__pixiworld.teardown()");
      assert.equal(gone, true, "destroy() must remove the canvas");
      const teardown = await page.evaluate("window.__pixiworld.teardownStats()") as {
        canvasCount: number; destroyWasRepeated: boolean;
      };
      assert.equal(teardown.canvasCount, 0, "double destroy leaves no canvas");
      assert.equal(teardown.destroyWasRepeated, true, "handle was destroyed more than once");
      evidence.teardown = { canvasRemoved: gone, ...teardown };
      console.log(`teardown: canvas removed=${gone}, double destroy safe=${teardown.destroyWasRepeated}`);

      // Production modules: bounded synthetic RenderOrganism fixtures measure
      // Pixi reconciliation only; they carry no ecological evidence.
      const scenes: unknown[] = [];
      for (const count of [50, 250, 1000, 3000]) {
        const scene = await page.evaluate(`window.__pixiworld.productionSceneProbe(${count})`);
        const measured = scene as {
          count: number; initialLiveDisplays: number; movedLiveDisplays: number;
          initialTextureCreates: number; movedTextureCreates: number;
          textureReuses: number; movementTextureCreateDelta: number; remainingCanvasCount: number;
          movementDisplayCreateDelta: number; movementDisplayCountBefore: number; movementDisplayCountAfter: number;
          analyticalLensResults: Array<{ lens: string; visibleTextureCount: number; textureCreates: number; liveDisplays: number }>;
          focusVisible: boolean; restoredNormalPhenotype: boolean;
          selectionChecks: Array<{ zoom: number; hit25: number | null; miss27: number | null; seamIdentity: number | null }>;
          dormantAnalyticalAlpha: number;
          worldReplacementDisplayCountBefore: number; worldReplacementDisplayCountAfter: number;
          worldReplacementLiveTextures: number; worldReplacementTextureCreates: number;
          initialEnvironmentTextureCreates: number; pannedEnvironmentTextureCreates: number;
          pannedEnvironmentRebuilt: boolean; initialEnvironmentTiles: number; pannedEnvironmentTiles: number;
          initialWasteCueTextureCreates: number; pannedWasteCueTextureCreates: number;
          movedEnvironmentTextureCreates: number; resizedEnvironmentTextureCreates: number;
          resizedCanvas: { w: number; h: number }; reportedViews: Array<{ w: number; h: number }>;
        };
        assert.equal(measured.initialLiveDisplays, count, `${count} fixture displays mounted`);
        assert.equal(measured.movedLiveDisplays, count, `${count} displays retained after movement`);
        assert.equal(measured.movementTextureCreateDelta, 0, `${count} movement-only update creates zero morphology textures`);
        assert.equal(measured.movementDisplayCreateDelta, 0, `${count} movement-only update creates zero display objects`);
        assert.equal(measured.movementDisplayCountAfter, measured.movementDisplayCountBefore,
          `${count} movement retains the same display-object population`);
        assert.deepEqual(measured.analyticalLensResults.map((result) => result.lens), ["nutrients", "waste", "clades", "traits"]);
        for (const result of measured.analyticalLensResults) {
          assert.equal(result.textureCreates, measured.initialTextureCreates, `${count} ${result.lens} view leaves morphology identity unchanged`);
          assert.equal(result.visibleTextureCount, measured.initialTextureCreates,
            `${count} ${result.lens} view retains current phenotype texture resources`);
          assert.equal(result.liveDisplays, count, `${count} ${result.lens} view retains organism displays`);
        }
        assert.equal(measured.focusVisible, true, `${count} selection focus remains presentation-visible in analytical mode`);
        assert.equal(measured.restoredNormalPhenotype, true, `${count} returning to normal restores the same Pixel Phenotype texture`);
        assert.deepEqual(measured.selectionChecks, [
          { zoom: 1, hit25: 707, miss27: null, seamIdentity: 707 },
          { zoom: 3, hit25: 707, miss27: null, seamIdentity: 707 },
        ], `${count} toroidal selection preserves 26 CSS-pixel radius and one seam identity`);
        assert.ok(measured.dormantAnalyticalAlpha > 0 && measured.dormantAnalyticalAlpha < 1,
          `${count} analytical dormancy remains independently legible`);
        assert.equal(measured.worldReplacementDisplayCountAfter, Math.max(1, Math.floor(count / 2)),
          `${count} world replacement retains only new-world displays`);
        assert.ok(measured.worldReplacementLiveTextures > 0 && measured.worldReplacementLiveTextures <= measured.worldReplacementDisplayCountAfter,
          `${count} world replacement keeps only current-world texture resources`);
        assert.equal(measured.worldReplacementTextureCreates, measured.worldReplacementLiveTextures,
          `${count} world replacement metrics describe only new-world texture resources`);
        assert.equal(measured.pannedEnvironmentTextureCreates, measured.initialEnvironmentTextureCreates,
          `${count} camera-only update creates zero environment textures`);
        assert.equal(measured.pannedEnvironmentRebuilt, false, `${count} camera-only update reuses environment texture`);
        assert.equal(measured.pannedWasteCueTextureCreates, measured.initialWasteCueTextureCreates,
          `${count} camera-only update reuses waste-cue texture`);
        assert.ok(measured.pannedEnvironmentTiles > 0 && measured.pannedEnvironmentTiles !== measured.initialEnvironmentTiles,
          `${count} pan across both torus seams reconciles world-space field tiles`);
        assert.equal(measured.resizedCanvas.w, 800);
        assert.equal(measured.resizedCanvas.h, 500, `${count} host resize reaches renderer CSS dimensions`);
        assert.ok(measured.reportedViews.some((view) => view.w === 960 && view.h === 600),
          `${count} resized viewport is reported in world units at the fit scale`);
        assert.equal(measured.resizedEnvironmentTextureCreates, measured.initialEnvironmentTextureCreates,
          `${count} resize-only update creates zero environment textures`);
        assert.equal(measured.movedEnvironmentTextureCreates, measured.initialEnvironmentTextureCreates,
          `${count} unchanged environment fields reuse their texture across live movement`);
        assert.equal(measured.remainingCanvasCount, 0, `${count} scene teardown removes its canvas`);
        scenes.push(measured);
        console.log(`production scene n=${count}: organism textures=${measured.initialTextureCreates}, reused=${measured.textureReuses}, movement creates=${measured.movementTextureCreateDelta}; environment tiles=${measured.initialEnvironmentTiles}->${measured.pannedEnvironmentTiles}, camera/resize texture creates=0`);
      }
      evidence.productionScenes = scenes;

      assert.ok(errors.length === 0, `page errors: ${errors.join("; ")}`);
      assert.ok(consoleErrors.length === 0, `console errors: ${consoleErrors.join("; ")}`);
      assert.ok(failedResponses.length === 0, `failed requests: ${failedResponses.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
    const manifest = {
      pixiVersion,
      browser: `chromium/${browserVersion}`,
      baseUrl: BASE,
      generatedAt: new Date().toISOString(),
      pageErrors: errors,
      consoleErrors,
      failedResponses,
      evidence,
    };
    writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`pixiWorld browser proof -> ${OUT}`);
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    try {
      writeFileSync(join(OUT, "FAILURE.txt"), failed + "\n");
      writeFileSync(join(OUT, "diagnostics.json"), JSON.stringify({
        pixiVersion,
        browser: browserVersion,
        baseUrl: BASE,
        generatedAt: new Date().toISOString(),
        failure: failed,
        pageErrors: errors,
        consoleErrors,
        failedResponses,
        viteOutput,
        evidence,
      }, null, 2));
    } catch { /* best effort */ }
    console.error(`pixiWorld browser proof FAILED: ${failed}`);
    process.exitCode = 1;
  } finally {
    try {
      server.kill("SIGKILL");
    } catch { /* already gone */ }
  }
  process.exit(process.exitCode ?? 0);
}

// Entry point (no top-level await: the repo root is CommonJS-typed, and
// tsx compiles .ts by nearest package.json — keep this file CJS-safe).
void main();
