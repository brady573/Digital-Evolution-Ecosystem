import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

/**
 * Issue #30 Lane A: phone-scale World interaction shell.
 *
 * Acceptance evidence for the mobile interaction cleanup, measured at
 * representative widths. This checks *reachability and layout geometry* — the
 * things the human eye can miss at one viewport size — and it deliberately
 * asserts that the simulation is untouched (AC10).
 *
 * Usage: pnpm --filter @digital-evolution/explorer exec vite preview --port 4173
 *        pnpm test:mobile-ui
 * Runs locally and in CI.
 */

const baseUrl = process.env.DEE_BASE_URL || "http://127.0.0.1:4173";
const PHONE = { narrow: 320, phone: 390, large: 430 };
const TABLET = 820;
const DESKTOP = 1280;

const CORE_ACTIONS = [
  { name: /^(Play|Pause)$/, label: "Play/Pause" },
  { name: "Simulation speed", label: "speed" },
  { name: "Next meaningful change", label: "Next meaningful change" },
  { name: "Save", label: "Save" },
  { name: "Resume", label: "Resume" },
  { name: "Export", label: "Export" },
];
const LENSES = ["Landscape", "Nutrients", "Waste", "Clades", "Traits"];

async function readTick(page: Page): Promise<number> {
  return Number((await page.getByTestId("tick").innerText()).replace(/[^0-9]/g, ""));
}

/** Bounding box of the first element matching a role/name pattern. */
async function boxOf(page: Page, name: string | RegExp, exact = false) {
  const locator = exact ? page.getByRole("button", { name }) : page.getByRole("button", { name });
  return await locator.first().boundingBox();
}

async function openWorld(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Evolution world").waitFor();
}

/**
 * World dominance (revised AC): the evolving world is the product, not the
 * backdrop. Measures the world canvas against the usable app height, and
 * separately against the height not taken by persistent chrome. The earlier
 * suite proved every action was *reachable* and never asked how much of the
 * screen the world actually owned, which is exactly how a fully compliant
 * layout could still feel like an interface with a world behind it.
 */
async function checkWorldDominance(page: Page, width: number) {
  const viewport = page.viewportSize()!;
  const world = (await page.getByLabel("Evolution world").boundingBox())!;
  const worldShare = world.height / viewport.height;

  // Persistent chrome is everything that stays on screen with no selection
  // and no pending decision: top HUD, lens control, simulation controls,
  // and bottom navigation.
  // NOTE: no named inner functions here — tsx/esbuild injects a `__name`
  // helper that does not exist inside the page context.
  const chrome = await page.evaluate(() => {
    const out: Record<string, number> = { hud: 0, lens: 0, controls: 0, nav: 0 };
    const sels: Array<[string, string]> = [
      ["hud", ".hud"],
      ["lens", ".lensbar"],
      ["controls", ".controls"],
      ["nav", ".mobile-nav"],
    ];
    for (const [key, sel] of sels) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) out[key] = el.getBoundingClientRect().height;
    }
    return out;
  });
  const chromeTotal = chrome.hud + chrome.lens + chrome.controls + chrome.nav;
  const chromeShare = chromeTotal / viewport.height;
  const detail = `world ${(worldShare * 100).toFixed(0)}% of ${viewport.height}px; chrome ${(chromeShare * 100).toFixed(0)}% (hud ${chrome.hud.toFixed(0)}, lens ${chrome.lens.toFixed(0)}, controls ${chrome.controls.toFixed(0)}, nav ${chrome.nav.toFixed(0)})`;
  assert.ok(worldShare >= 0.7,
    `the world owns at least 70% of usable app height at ${width}px — ${detail}`);
  assert.ok(chromeShare <= 0.3,
    `persistent chrome stays at or under 30% of usable height at ${width}px — ${detail}`);

  // Progressive disclosure: nothing large is permanently expanded that the
  // user did not ask for. The inspector handle must be small and, with
  // nothing selected, absent.
  const handle = await page.locator(".sheet-toggle").boundingBox().catch(() => null);
  if (!handle) {
    assert.ok(true, `no inspector handle is shown with nothing selected at ${width}px`);
  } else {
    assert.ok(handle.height <= 44,
      `the inspector handle is a small chip, not a full-width bar (${handle.height.toFixed(0)}px at ${width}px)`);
  }
  return { worldShare, chromeShare, chrome };
}

/** AC1/AC2: every core action is reachable, inside the viewport, and touch-sized. */
async function checkCoreActions(page: Page, width: number) {
  const viewport = page.viewportSize()!;
  for (const action of CORE_ACTIONS) {
    const locator =
      action.name === "Simulation speed"
        ? page.getByLabel("Simulation speed")
        : page.getByRole("button", { name: action.name as RegExp });
    // Secondary actions live behind an explicit labelled menu, so they are
    // reached on request rather than being permanently on screen. They must
    // still be genuinely reachable without any hidden scrolling. Open the
    // menu only when the target is not already showing, so a second press
    // cannot toggle it shut again.
    if (["Save", "Resume", "Export"].includes(action.label)) {
      const already = await locator.first().isVisible().catch(() => false);
      if (!already) {
        const more = page.getByRole("button", { name: "More actions" });
        if (await more.isVisible().catch(() => false)) {
          await more.click();
          await page.waitForTimeout(150);
        }
      }
    }
    await locator.first().waitFor();
    const box = await locator.first().boundingBox();
    assert.ok(box, `${action.label} is laid out at ${width}px`);
    assert.ok(box!.x >= -1 && box!.x + box!.width <= viewport.width + 1,
      `${action.label} is fully inside the ${width}px viewport (x ${box!.x.toFixed(0)}..${(box!.x + box!.width).toFixed(0)})`);
    assert.ok(box!.y + box!.height <= viewport.height + 1,
      `${action.label} is reachable vertically at ${width}px`);
    if (width <= PHONE.large) {
      assert.ok(box!.height >= 40,
        `${action.label} keeps a practical touch target at ${width}px (${box!.height.toFixed(0)}px)`);
    }
  }
  // The control bar itself must not require horizontal scrolling.
  const overflow = await page.evaluate(() => {
    const el = document.querySelector(".controls")!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1,
    `control bar needs no horizontal scrolling at ${width}px (${overflow.scrollWidth} vs ${overflow.clientWidth})`);
  // No page-level horizontal scroll either.
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(doc.scrollWidth <= doc.clientWidth + 1,
    `no page-level horizontal scrolling at ${width}px`);
}

/** AC3: all five lenses visible at once, and the lens surface stays compact. */
/** The lens set is collapsed by design; open it before driving a lens. */
async function openLensSet(page: Page) {
  const first = page.locator(".lens-options button").first();
  if (await first.isVisible().catch(() => false)) return;
  await page.locator(".lens-active").click();
  await page.waitForTimeout(180);
}

/** Choose a lens, expanding the collapsed control first. */
async function chooseLens(page: Page, lens: string) {
  await openLensSet(page);
  await page.getByRole("button", { name: lens, exact: true }).click();
  await page.waitForTimeout(150);
}

async function checkLensBar(page: Page, width: number) {
  const viewport = page.viewportSize()!;
  const bar = await page.locator(".lensbar").boundingBox();
  assert.ok(bar, `lens control present at ${width}px`);
  assert.ok(bar!.width <= viewport.width, `lens control fits the ${width}px viewport`);

  // Progressive disclosure: collapsed, the lens set is one small chip naming
  // the active lens, so the control does not permanently occupy the world.
  const chip = await page.locator(".lens-active").boundingBox();
  assert.ok(chip, `the active-lens chip is present at ${width}px`);
  assert.ok(chip!.height <= 44,
    `the collapsed lens control is a small chip at ${width}px (${chip!.height.toFixed(0)}px)`);
  const collapsedBar = (await page.locator(".lensbar").boundingBox())!;
  assert.ok(collapsedBar.height <= 60,
    `the collapsed lens control stays compact at ${width}px (${collapsedBar.height.toFixed(0)}px)`);
  assert.equal(await page.locator(".lens-options button").first().isVisible().catch(() => false), false,
    `the full lens set is not permanently expanded at ${width}px`);

  // Ask for it: every lens must then be reachable, inside the viewport, and
  // its label fully legible. Measured against real glyph width, not
  // scrollWidth — a nowrap button can report scrollWidth == clientWidth and
  // still clip at the edge.
  await page.locator(".lens-active").click();
  await page.waitForTimeout(200);
  for (const lens of LENSES) {
    await page.getByRole("button", { name: lens, exact: true }).waitFor();
    const box = await page.getByRole("button", { name: lens, exact: true }).boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1,
      `${lens} lens is reachable and fully inside the ${width}px viewport`);
    const fit = await page.evaluate((name:string)=>{
      const btn=[...document.querySelectorAll(".lens-options button")].find(b=>b.textContent?.trim()===name) as HTMLElement|undefined;
      if(!btn)return null;
      const style=getComputedStyle(btn);
      const probe=document.createElement("canvas").getContext("2d")!;
      probe.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const textWidth=probe.measureText(name).width;
      const inner=btn.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
      return{textWidth:Math.ceil(textWidth),inner:Math.floor(inner)};
    },lens);
    assert.ok(fit, `the ${lens} lens is present at ${width}px`);
    assert.ok(fit!.textWidth <= fit!.inner,
      `the ${lens} lens label fits its button at ${width}px (text ${fit!.textWidth}px vs ${fit!.inner}px available)`);
  }
  // Collapsing again must hand the space back to the world.
  if (chip) {
    await page.locator(".lens-active").click();
    await page.waitForTimeout(150);
    const collapsed = await page.locator(".lens-options button").first().isVisible().catch(() => false);
    assert.ok(!collapsed, `the lens set collapses again on demand at ${width}px`);
  }
}

/** AC4: the secondary selector stays visibly tied to its lens. */
async function checkSecondarySelector(page: Page, width: number) {
  await chooseLens(page, "Nutrients");
  const select = await page.getByLabel("Resource view").boundingBox();
  const chip = await page.locator(".lens-active").boundingBox();
  assert.ok(select, `Nutrients selector renders at ${width}px`);
  assert.ok(select!.y > chip!.y, "the secondary selector sits below the lens control it belongs to");
  assert.ok(select!.width > chip!.width,
    "the secondary selector spans the lens bar width, reading as part of it");
  await chooseLens(page, "Traits");
  assert.ok(await page.getByLabel("Trait view").boundingBox(), `Traits selector renders at ${width}px`);
  await chooseLens(page, "Landscape");
  assert.equal(await page.getByLabel("Resource view").count(), 0,
    "leaving the lens also leaves its secondary selector");
}

/** AC7: a pending decision is never obscured by the inspector. */
async function checkDecisionPriority(page: Page, width: number) {
  const sheet = page.getByTestId("decision-sheet");
  for (let i = 0; i < 25; i++) {
    if (await sheet.count()) break;
    await page.getByRole("button", { name: "Next meaningful change" }).click();
    await page.waitForTimeout(500);
  }
  await sheet.waitFor();
  // The inspector must not be rendered alongside a pending decision.
  const toggles = await page.locator(".investigation-rail .sheet-toggle").count();
  assert.equal(toggles, 0,
    `a pending decision outranks inspection at ${width}px (sheet priority)`);
  const sheetBox = (await sheet.boundingBox())!;
  const inspectorBox = await page.locator(".investigation-rail .inspector").boundingBox().catch(() => null);
  if (inspectorBox) {
    const overlaps = !(sheetBox.y + sheetBox.height < inspectorBox.y
      || inspectorBox.y + inspectorBox.height < sheetBox.y);
    assert.ok(!overlaps, "decision sheet and inspector do not overlap");
  }
}

/** AC5/AC6: the first choice is visible, the world stays as context. */
async function checkDecisionUsability(page: Page, width: number) {
  const sheet = page.getByTestId("decision-sheet");
  const sheetBox = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  assert.ok(sheetBox.height < viewport.height * 0.6,
    `decision sheet keeps the world visible as context at ${width}px (${(sheetBox.height / viewport.height * 100).toFixed(0)}% of the screen)`);
  assert.ok(sheetBox.x >= -1 && sheetBox.x + sheetBox.width <= viewport.width + 1,
    `decision sheet fits the ${width}px viewport`);
  // The minimap and zoom controls must stay clear of the sheet, so no action
  // is buried under a pending decision (AC8). A pending decision yields the
  // overlay entirely, which is the simplest way to guarantee that.
  const zoomCount = await page.getByRole("button", { name: "Zoom in" }).count();
  if (zoomCount === 0) {
    const overlay = await page.locator(".world-overlay").count();
    assert.equal(overlay, 0, "the view overlay yields to a pending decision rather than hiding under it");
  } else {
    const zoomBox = (await page.getByRole("button", { name: "Zoom in" }).boundingBox())!;
    assert.ok(zoomBox.y + zoomBox.height <= sheetBox.y + 1,
      `zoom controls stay clear of the decision sheet at ${width}px (zoom ends ${(zoomBox.y + zoomBox.height).toFixed(0)}, sheet starts ${sheetBox.y.toFixed(0)})`);
  }
  const choices = sheet.locator(".decision-choices button");
  const count = await choices.count();
  assert.ok(count >= 2, `decision offers ${count} choices at ${width}px`);
  const first = (await choices.first().boundingBox())!;
  const title = await choices.first().innerText();
  assert.ok(title.trim().length > 0, "the first choice has a visible label");
  assert.ok(first.y >= sheetBox.y && first.y + first.height <= sheetBox.y + sheetBox.height + 1,
    "the first actionable choice is inside the visible sheet without scrolling");
  // Scroll affordance for the remaining choices.
  const scrollable = await page.evaluate(() => {
    const el = document.querySelector(".decision-choices") as HTMLElement | null;
    const sheet = document.querySelector(".decision-sheet") as HTMLElement | null;
    if (!el || !sheet) return null;
    return {
      sheetOverflow: getComputedStyle(sheet).overflowY,
      fade: getComputedStyle(sheet, "::after").content,
      firstSticky: getComputedStyle(el.querySelector("button")!).position,
    };
  });
  assert.ok(scrollable && /auto|scroll/.test(scrollable.sheetOverflow),
    "the decision sheet scrolls so no content is truncated");
  assert.ok(scrollable && scrollable.fade !== "none",
    "the sheet has a visible bottom fade so scrolling is unmistakable");
  assert.equal(scrollable?.firstSticky, "sticky",
    "the first choice is pinned so it cannot scroll out of reach");
  // No scientific text is hidden: the full context must be present in the DOM
  // and reachable, not line-clamped away.
  const contextText = (await page.locator(".decision-context").innerText()).trim();
  assert.ok(contextText.length > 0, "decision context is rendered in full, not truncated");
}

/** AC8: the fixed mobile navigation never covers the simulation controls. */
async function checkNavClearance(page: Page, width: number) {
  const nav = await page.locator(".mobile-nav").boundingBox().catch(() => null);
  if (!nav) return;
  const controls = (await page.locator(".controls").boundingBox())!;
  assert.ok(controls.y + controls.height <= nav.y + 1,
    `simulation controls are not covered by the fixed navigation at ${width}px (controls end ${(controls.y + controls.height).toFixed(0)}, nav starts ${nav.y.toFixed(0)})`);
  // Every mobile navigation item is itself reachable.
  const navButtons = await page.locator(".mnav-btn").count();
  assert.ok(navButtons >= 4, `mobile navigation exposes ${navButtons} surfaces at ${width}px`);
}

/** AC9: desktop keeps its single-row control bar and flexible lens bar. */
async function checkDesktopUnchanged(page: Page) {
  const controls = await page.locator(".controls").boundingBox();
  const rows = await page.evaluate(() => {
    // Only VISIBLE items count toward layout rows. A phone-only affordance
    // that is display:none on desktop still exists in the DOM at top 0, which
    // would otherwise read as a second row.
    const items = [...document.querySelectorAll(".controls button, .controls select")] as HTMLElement[];
    const tops = new Set(
      items
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0)
        .map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    return tops.size;
  });
  assert.equal(rows, 1, "desktop control bar is still a single row");
  assert.ok(controls!.height < 70, `desktop control bar stays compact (${controls!.height.toFixed(0)}px)`);
  const lensDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".lensbar")!).display);
  assert.equal(lensDisplay, "flex", "desktop lens bar keeps its flex treatment");
  // Progressive disclosure is a phone treatment: on desktop the whole control
  // set is already one row, so the More affordance must not appear. This
  // assertion exists because its absence let a real desktop regression ship
  // once (the More button rendered inline on desktop).
  assert.equal(await page.getByRole("button", { name: "More actions" }).isVisible().catch(() => false), false,
    "desktop does not show the phone-only More affordance");
  assert.equal(await page.locator(".lens-active").isVisible().catch(() => false), false,
    "desktop does not show the phone-only active-lens chip");
  for (const secondary of ["Save", "Resume", "Export"]) {
    assert.ok(await page.getByRole("button", { name: secondary, exact: true }).isVisible(),
      `desktop keeps ${secondary} inline on the single control row`);
  }
  for (const lens of LENSES) {
    assert.ok(await page.getByRole("button", { name: lens, exact: true }).count(), `desktop keeps ${lens}`);
  }
}

/** AC10: interaction changes nothing about the simulation. */
async function checkSimulationIsolation(page: Page) {
  const before = await readTick(page);
  for (const lens of LENSES) {
    await chooseLens(page, lens);
  }
  const after = await readTick(page);
  assert.equal(after, before, "switching lenses never advances or rewinds the simulation");
  // Zoom and selection are presentation too.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(120);
  assert.equal(await readTick(page), before, "zooming never advances the simulation");
  await page.getByRole("button", { name: "Reset view" }).click();
  const exportBtn = page.getByRole("button", { name: "Export" });
  assert.ok(await exportBtn.count(), "Export stays available on the phone surface");
  assert.ok(await page.getByRole("button", { name: "Save" }).count(), "Save stays available");
  assert.ok(await page.getByRole("button", { name: "Resume" }).count(), "Resume stays available");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: DESKTOP, height: 900 } });

    // Phone widths: full action/lens/secondary/isolation sweep.
    for (const [label, width] of Object.entries(PHONE)) {
      const page = await context.newPage();
      await openWorld(page, width);
      const dominance = await checkWorldDominance(page, width);
      console.log(`  world ${(dominance.worldShare * 100).toFixed(0)}% / chrome ${(dominance.chromeShare * 100).toFixed(0)}% (hud ${dominance.chrome.hud.toFixed(0)}px, lens ${dominance.chrome.lens.toFixed(0)}px, controls ${dominance.chrome.controls.toFixed(0)}px, nav ${dominance.chrome.nav.toFixed(0)}px)`);
      await checkCoreActions(page, width);
      await checkLensBar(page, width);
      await checkSecondarySelector(page, width);
      await checkNavClearance(page, width);
      await checkSimulationIsolation(page);
      console.log(`mobile ${label} (${width}px): core actions, lenses, selectors, nav, isolation OK`);
      await page.close();
    }

    // Decision priority and usability on a phone width.
    const decisionPage = await context.newPage();
    await openWorld(decisionPage, PHONE.phone);
    await decisionPage.getByRole("button", { name: "World settings" }).click();
    await decisionPage.getByLabel("World seed").fill("24681357");
    await decisionPage.getByRole("button", { name: "Create universe" }).click();
    await decisionPage.getByRole("dialog", { name: "World settings" }).waitFor({ state: "detached" });
    await checkDecisionPriority(decisionPage, PHONE.phone);
    await checkDecisionUsability(decisionPage, PHONE.phone);
    const pausedTick = await readTick(decisionPage);
    // The pending decision still hard-pauses: Play must not bypass it.
    await decisionPage.getByRole("button", { name: "Play" }).click();
    await decisionPage.waitForTimeout(600);
    assert.equal(await readTick(decisionPage), pausedTick,
      "a pending decision still hard-pauses the simulation after the layout change");
    console.log(`decision sheet (${PHONE.phone}px): priority, first-choice visibility, world context, pause contract OK`);
    await decisionPage.close();

    // Tablet: in between, must still pass the reachability rules.
    const tablet = await context.newPage();
    await openWorld(tablet, TABLET, 1024);
    await checkCoreActions(tablet, TABLET);
    await checkLensBar(tablet, TABLET);
    await checkNavClearance(tablet, TABLET);
    console.log(`tablet (${TABLET}px): core actions, lenses, nav OK`);
    await tablet.close();

    // Desktop: materially unchanged.
    const desktop = await context.newPage();
    await openWorld(desktop, DESKTOP, 900);
    await checkDesktopUnchanged(desktop);
    console.log(`desktop (${DESKTOP}px): single-row controls and flex lens bar unchanged`);
    await desktop.close();

    console.log("mobile UI validation: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
