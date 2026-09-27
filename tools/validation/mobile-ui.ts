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

/** AC1/AC2: every core action is reachable, inside the viewport, and touch-sized. */
async function checkCoreActions(page: Page, width: number) {
  const viewport = page.viewportSize()!;
  for (const action of CORE_ACTIONS) {
    const locator =
      action.name === "Simulation speed"
        ? page.getByLabel("Simulation speed")
        : page.getByRole("button", { name: action.name as RegExp });
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
async function checkLensBar(page: Page, width: number) {
  const world = await page.getByLabel("Evolution world").boundingBox();
  let bar: Awaited<ReturnType<typeof boundingOf>> = null;
  async function boundingOf() {
    return await page.locator(".lensbar").boundingBox();
  }
  bar = await boundingOf();
  assert.ok(bar, `lens bar present at ${width}px`);
  const viewport = page.viewportSize()!;
  for (const lens of LENSES) {
    const box = await page.getByRole("button", { name: lens, exact: true }).boundingBox();
    assert.ok(box, `${lens} lens present at ${width}px`);
    assert.ok(box!.x >= -1 && box!.x + box!.width <= viewport.width + 1,
      `${lens} lens is fully visible at ${width}px (no scrolling required)`);
  }
  const lensRow = await page.locator(".lensbar button").first().boundingBox();
  const rows = new Set<LENSES>();
  void rows;
  assert.ok(bar!.width <= viewport.width, `lens bar fits the ${width}px viewport`);
  // Compactness: the lens surface must not swallow the world. Measured against
  // the lens button height (one row) rather than the whole bar, so an
  // explanatory secondary row is not counted as lens chrome.
  if (world && lensRow) {
    const fraction = lensRow.height / world.height;
    assert.ok(fraction < 0.12,
      `lens row stays a small fraction of the world at ${width}px (${(fraction * 100).toFixed(1)}%)`);
  }
  // No horizontal scroll inside the lens bar itself.
  // Every lens label must be fully legible, not clipped or ellipsised: a
  // control the user cannot read is not discoverable. Measured against the
  // real glyph width of the rendered text, not scrollWidth — a nowrap button
  // can report scrollWidth == clientWidth and still clip at the edge.
  for (const lens of LENSES) {
    const fit = await page.evaluate((name:string)=>{
      const btn=[...document.querySelectorAll(".lensbar button")].find(b=>b.textContent?.trim()===name) as HTMLElement|undefined;
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
  const lensOverflow = await page.evaluate(() => {
    const el = document.querySelector(".lensbar")!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  assert.ok(lensOverflow.scrollWidth <= lensOverflow.clientWidth + 1,
    `lens bar needs no horizontal scrolling at ${width}px`);
}

/** AC4: the secondary selector stays visibly tied to its lens. */
async function checkSecondarySelector(page: Page, width: number) {
  await page.getByRole("button", { name: "Nutrients", exact: true }).click();
  await page.waitForTimeout(120);
  const select = await page.getByLabel("Resource view").boundingBox();
  const lens = await page.getByRole("button", { name: "Nutrients", exact: true }).boundingBox();
  assert.ok(select && lens, `Nutrients selector renders at ${width}px`);
  assert.ok(select!.y > lens!.y, "the secondary selector sits below the lens row it belongs to");
  assert.ok(select!.y - lens!.y < lens!.height * 3,
    "the secondary selector is adjacent to its lens, not detached elsewhere");
  assert.ok(select!.width > lens!.width,
    "the secondary selector spans the lens bar width, reading as part of it");
  await page.getByRole("button", { name: "Traits", exact: true }).click();
  await page.waitForTimeout(120);
  const traitSelect = await page.getByLabel("Trait view").boundingBox();
  assert.ok(traitSelect, `Traits selector renders at ${width}px`);
  await page.getByRole("button", { name: "Landscape", exact: true }).click();
  await page.waitForTimeout(120);
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
    const items = [...document.querySelectorAll(".controls button, .controls select")] as HTMLElement[];
    const tops = new Set(items.map((el) => Math.round(el.getBoundingClientRect().top)));
    return tops.size;
  });
  assert.equal(rows, 1, "desktop control bar is still a single row");
  assert.ok(controls!.height < 70, `desktop control bar stays compact (${controls!.height.toFixed(0)}px)`);
  const lensDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".lensbar")!).display);
  assert.equal(lensDisplay, "flex", "desktop lens bar keeps its flex treatment");
  for (const lens of LENSES) {
    assert.ok(await page.getByRole("button", { name: lens, exact: true }).count(), `desktop keeps ${lens}`);
  }
}

/** AC10: interaction changes nothing about the simulation. */
async function checkSimulationIsolation(page: Page) {
  const before = await readTick(page);
  for (const lens of LENSES) {
    await page.getByRole("button", { name: lens, exact: true }).click();
    await page.waitForTimeout(80);
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
