import assert from "node:assert/strict";
import { chromium, type Locator, type Page } from "playwright";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { BARE_RGB } from "../../apps/explorer/src/landscape.ts";

const baseUrl=process.env.DEE_BASE_URL||"http://127.0.0.1:4173";

/**
 * Does the minimap resource field reach every corner of the world?
 *
 * The ratio bound is a judgement call, so it is a named function with its
 * justification adjacent rather than a bare number buried in an assertion.
 * An absolute ink floor cannot express this claim: how much material is on the
 * field depends on how far the world has been advanced, and the speed-control
 * checks advance it by a wall-clock-derived tick count, so an absolute floor
 * fails on total stock instead of on coverage. The bound below is relative to
 * the densest quadrant and is pinned against its regression vectors where it is
 * used, so retuning it cannot quietly narrow what the check proves.
 */
function minimapCoversWorld(quadrantInk:readonly number[]):boolean{
  const sparsest=Math.min(...quadrantInk);
  const densest=Math.max(...quadrantInk);
  return sparsest>densest/4;
}

async function tick(page:Page){
  const text=await page.getByTestId("tick").innerText();
  return Number(text.replace(/[^0-9]/g,""));
}

/**
 * Wait until the world has genuinely stopped moving.
 *
 * Clicking Pause stops the requestAnimationFrame scheduler on the next effect
 * teardown, which is not synchronous with the click: one further advance can
 * still be in flight, and the HUD it lands on repaints a frame later. Anything
 * that then computes `target - tick(page)` from that lagging read sends one tick
 * too many and lands one tick past its target.
 *
 * Two consecutive identical reads is the smallest honest condition: a moving
 * world cannot produce the same tick twice at this cadence.
 */
async function settlePaused(page:Page,timeoutMs=10_000){
  const deadline=Date.now()+timeoutMs;
  let previous=await tick(page);
  while(Date.now()<deadline){
    await page.waitForTimeout(120);
    const current=await tick(page);
    if(current===previous)return current;
    previous=current;
  }
  throw new Error(`world never settled after Pause (last tick ${previous})`);
}

async function waitForTickOrDecision(page:Page,target:number,timeoutMs=120_000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const current=await tick(page);
    if(current>=target||await page.getByTestId("decision-sheet").count())return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`timed out waiting for tick ${target} or a pending decision; current tick ${await tick(page)}`);
}

async function advanceRuntimeToTick(page:Page,target:number){
  let current=await tick(page);
  while(current<target){
    // ADVANCE_TICKS has a 2,000-tick command limit. Send ordinary production
    // commands in bounded slices and wait for each reply to reach the HUD.
    const next=Math.min(target,current+2_000);
    await page.evaluate((ticks)=>(window as any).__DEE_TEST__.advanceTicks(ticks),next-current);
    const reached=await waitForTickOrDecision(page,next);
    assert.equal(reached,next,`the runtime accepts and reaches its bounded advance to tick ${next}`);
    assert.equal(await page.getByTestId("decision-sheet").count(),0,
      `no automatic decision interrupts protected advancement before tick ${target}`);
    current=reached;
  }
}

async function historyRecordCount(page:Page){
  const text=await page.getByText(/\d+ durable ecological records/).innerText();
  const match=text.match(/(\d+) durable ecological records/);
  assert.ok(match,"History displays its durable ecological record count");
  return Number(match[1]);
}

// Renderer geometry is published after the canvas paints, so poll for the
// expectation instead of sampling once (a single read can catch a stale value).
async function expectAttr(locator:Locator,name:string,match:(v:number)=>boolean,label:string){
  const deadline=Date.now()+5000;
  let last=Number.NaN;
  while(Date.now()<deadline){
    last=Number(await locator.getAttribute(name));
    if(Number.isFinite(last)&&match(last))return last;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`assertion failed: ${label} (last ${name}=${last})`);
}

async function main(){
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    // P1.6 route contract: Pixi is the sole semantic World on both routes;
    // deeTest enables instrumentation only and never selects a renderer.
    const routePage=await context.newPage();
    await routePage.goto(baseUrl,{waitUntil:"domcontentloaded"});
    await routePage.locator(".world-pixi-host canvas").waitFor({timeout:30_000});
    assert.equal(await routePage.locator("canvas.world-canvas").count(),0,
      "default route has no semantic Canvas2D World");
    assert.equal(await routePage.locator(".world-pixi-host").count(),1,
      "default route mounts exactly one Pixi World host");
    assert.equal(await routePage.locator(".world-pixi-host canvas").count(),1,
      "default route has exactly one active Pixi canvas");
    await routePage.close();
    const pixiRoutePage=await context.newPage();
    await pixiRoutePage.goto(`${baseUrl}?deeTest=1`,{waitUntil:"domcontentloaded"});
    await pixiRoutePage.locator(".world-pixi-host canvas").waitFor({timeout:30_000});
    assert.equal(await pixiRoutePage.locator("canvas.world-canvas").count(),0,
      "deeTest route has no semantic Canvas2D World");
    assert.equal(await pixiRoutePage.locator(".world-pixi-host").count(),1,
      "deeTest route mounts exactly one Pixi World host");
    assert.equal(await pixiRoutePage.locator(".world-pixi-host canvas").count(),1,
      "StrictMode and async boot leave exactly one active Pixi canvas");
    await pixiRoutePage.getByLabel("World minimap").waitFor();
    await pixiRoutePage.getByRole("button",{name:"Zoom in"}).click();
    assert.equal(await pixiRoutePage.getByTestId("zoom-level").innerText(),"1.5×",
      "the existing React zoom control updates the production Pixi renderer");
    await pixiRoutePage.getByRole("button",{name:"Reset view"}).click();
    const initialCamX=Number(await pixiRoutePage.getByTestId("world-minimap").getAttribute("data-cam-x"));
    const pixiBox=await pixiRoutePage.locator(".world-pixi-host canvas").boundingBox();
    assert.ok(pixiBox,"Pixi canvas has measured CSS geometry in the real shell");
    await pixiRoutePage.mouse.move(pixiBox!.x+pixiBox!.width/2,pixiBox!.y+pixiBox!.height/2);
    await pixiRoutePage.mouse.down();
    await pixiRoutePage.mouse.move(pixiBox!.x+pixiBox!.width/2+35,pixiBox!.y+pixiBox!.height/2,{steps:4});
    await pixiRoutePage.mouse.up();
    await expectAttr(pixiRoutePage.getByTestId("world-minimap"),"data-cam-x",v=>Math.abs(v-initialCamX)>.1,
      "Pixi user pan is reported to React and the React minimap");
    await pixiRoutePage.getByRole("button",{name:"Reset view"}).click();
    const startTick=await tick(pixiRoutePage);
    await pixiRoutePage.getByRole("button",{name:"Play"}).click();
    await pixiRoutePage.waitForFunction((before)=>{
      const text=document.querySelector('[data-testid="tick"]')?.textContent??"";
      return Number(text.replace(/[^0-9]/g,""))>before;
    },startTick,{timeout:10_000});
    await pixiRoutePage.getByRole("button",{name:"Pause"}).click();
    await settlePaused(pixiRoutePage);
    await pixiRoutePage.getByRole("button",{name:"History"}).click();
    await pixiRoutePage.getByRole("heading",{name:"History"}).waitFor();
    await pixiRoutePage.getByRole("button",{name:"World",exact:true}).click();
    await pixiRoutePage.getByLabel("Evolution world").waitFor();
    assert.equal(await pixiRoutePage.locator(".world-pixi-host canvas").count(),1,
      "navigation back to World does not duplicate or leak its canvas");
    await pixiRoutePage.close();
    const failedRoute=await context.newPage();
    await failedRoute.goto(`${baseUrl}?deeTest=1&deePixiFailure=1`,{waitUntil:"networkidle"});
    const failure=failedRoute.getByRole("alert");
    await failure.waitFor();
    assert.match(await failure.innerText(),/World display unavailable.*Simulation data and state remain intact/s,
      "renderer failure clearly says the World display is unavailable while state remains intact");
    assert.equal(await failedRoute.locator("canvas.world-canvas").count(),0,
      "renderer failure never silently falls back to Canvas2D");
    assert.equal(await failedRoute.locator(".world-pixi-host canvas").count(),0,
      "failed renderer does not leave a misleading empty Pixi canvas");
    assert.ok(await failedRoute.getByRole("button",{name:"Play"}).isVisible(),
      "React playback controls remain available after renderer failure");
    const failureTick=await tick(failedRoute);
    assert.equal(await tick(failedRoute),failureTick,"renderer failure does not mutate simulation time");
    await failedRoute.close();
    if(process.env.DEE_PIXI_ROUTE_ONLY==="1"){
      console.log("P1.6 production Pixi route and failure state: PASS");
      return;
    }

    const page=await context.newPage();
    // deeTest enables the URL-gated runtime hook. Used by the throughput loop to
    // acknowledge the aftermath without racing the DOM (see the guarded branch
    // below). Not a product control (AC21).
    await page.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();
    assert.equal(await tick(page),0,"fresh world starts at tick 0");

    await page.getByRole("button",{name:"Play"}).click();
    await page.waitForTimeout(900);
    await page.getByRole("button",{name:"Pause"}).click();
    await settlePaused(page);
    const advanced=await tick(page);
    assert.ok(advanced>0,"worker-owned simulation advances");

    // M3 aftermath impact state, on its own world, deliberately placed BEFORE
    // the throughput section: that section's ratio assertion is device-sensitive
    // (#46) and must not be able to hide unrelated evidence by failing first.
  await (async()=>{
  const deltaPage=await context.newPage();
  // Test hook, not a product control (AC21): the UI has no "Next meaningful change".
  await deltaPage.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
  await deltaPage.getByLabel("Evolution world").waitFor();
  const deltaSheet=deltaPage.getByTestId("decision-sheet");
  for(let i=0;i<25&&!(await deltaSheet.isVisible().catch(()=>false));i++){
    await deltaPage.evaluate(()=>(window as any).__DEE_TEST__.runToNextEvent());
    await deltaPage.waitForTimeout(400);
  }
  await deltaSheet.waitFor({timeout:180_000});
  const slot=deltaPage.getByTestId("sheet-slot");
  assert.equal(await slot.getAttribute("data-mode"),"decision","the slot holds the decision to begin with");
  // Tag the live slot DOM node. If the morph is genuine continuity, this exact
  // element survives the transition; a close-and-reopen would destroy it. This
  // is the difference between "a sheet appeared" and "one sheet became another",
  // which is what AC1 actually requires.
  await slot.evaluate((el:HTMLElement)=>{el.dataset.morphWitness="intact"});
  const decisionTick=await tick(deltaPage);
  // The primary acceptance case, measured in the NORMAL World.
  //
  // The World canvas renders the LIVE field, so "before" must be sampled before
  // the intervention resolves - flipping the sheet's comparison mode would only
  // change the small field canvas inside the sheet, not the world. The world is
  // paused here, so this comparison spans exactly the intervention and ZERO
  // additional ticks, which is the claim the whole slice turns on.
  // Measured as a per-pixel CHANGE, not against an absolute threshold.
  //
  // An absolute "distance from bare" test saturates: the field's own natural
  // spread, plus organisms, put nearly every pixel beyond any fixed cutoff, so
  // it reported 100% before AND after and could not discriminate at all. The
  // claim being tested is directional - material DIMINISHED - so measure exactly
  // that: for each pixel, did it move toward bare (material lost) or away from
  // it (material gained)?
  //
  // Sampling a coarse grid rather than every pixel, because the substrate is a
  // 60x60 field scaled up with smoothing; a dense sample would just re-read the
  // same interpolated cells. Zero ticks separate the two captures, so organisms
  // have not moved and any difference is the field itself.
  const GRID = 40;
  // Use Chromium's captured output for the production renderer. Direct WebGL
  // readPixels observes the default drawing buffer, which may be discarded
  // after presentation (and can therefore report stale/blank data even when
  // the user-visible canvas changed).
  const captureWorld=async(mode:"grid"|"mean")=>{
    const screenshot=await deltaPage.getByLabel("Evolution world").screenshot();
    const base64=screenshot.toString("base64");
    return await deltaPage.evaluate(({encoded,g,mode})=>new Promise<number[]|number>((resolve,reject)=>{
      const image=new Image();
      image.onerror=()=>reject(new Error("Could not decode browser-captured World"));
      image.onload=()=>{
        const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext("2d",{willReadFrequently:true});
        if(!context){reject(new Error("2D canvas unavailable for screenshot sampling"));return;}
        context.drawImage(image,0,0);
        const {data}=context.getImageData(0,0,canvas.width,canvas.height);
        if(mode==="mean"){
          let sum=0;
          for(let i=0;i<data.length;i+=4)sum+=0.2126*data[i]!+0.7152*data[i+1]!+0.0722*data[i+2]!;
          resolve(sum/(data.length/4));return;
        }
        const out:number[]=[];
        for(let gy=0;gy<g;gy++)for(let gx=0;gx<g;gx++){
          const px=Math.floor((gx+0.5)*canvas.width/g),py=Math.floor((gy+0.5)*canvas.height/g);
          const i=(py*canvas.width+px)*4;out.push(data[i]!,data[i+1]!,data[i+2]!);
        }
        resolve(out);
      };
      image.src=`data:image/png;base64,${encoded}`;
    }),{encoded:base64,g:GRID,mode});
  };
  const sampleWorld=async()=>await captureWorld("grid") as number[];
  const meanLuma=async()=>await captureWorld("mean") as number;
  const lensBefore=await deltaPage.locator(".lens-active").innerText().catch(()=>"(default)");
  const pixelsBefore=await sampleWorld();
  const lumaBefore=await meanLuma();
  const readAuthoritativeResources=async()=>await deltaPage.evaluate(()=>{
    const state=(window as any).__DEE_TEST__.readWorldState();
    const field=state.environment.resources;
    let total=0,count=0;
    for(let kind=0;kind<field.stock.length;kind++)for(let cell=0;cell<field.gridSize*field.gridSize;cell++){
      const cap=field.capacity[kind]?.[cell]??0;
      if(cap>1e-9){total+=(field.stock[kind]?.[cell]??0)/cap;count++;}
    }
    return {worldId:state.worldId,tick:state.tick,environmentTick:state.environment.tick,meanFraction:total/count};
  });
  const authoritativeBefore=await readAuthoritativeResources();
  assert.equal(await deltaPage.locator(".world-pixi-host canvas").count(),1,"production Pixi is the sole semantic World renderer");
  // A real intervention, so the retained baseline and "Now" genuinely differ.
  // Chosen by intent rather than index, so a catalog reordering cannot silently
  // turn this into a no-intervention resolution.
  const intervening=deltaSheet.locator(".decision-choices button").filter({hasNotText:"Keep watching"}).first();
  await intervening.click();
  const deltaImpact=deltaPage.getByTestId("aftermath-impact");
  await deltaImpact.waitFor({timeout:15_000});
  assert.equal(await deltaPage.locator(".investigation-rail .inspector").count(),0,
    "expanded impact owns the single large sheet over inspection");
  // Still zero ticks: the world has not advanced past the resolution, so every
  // pixel difference below is the intervention and nothing else.
  assert.equal(await tick(deltaPage),decisionTick,"the world is still at the resolution tick while the sheet is open");
  const authoritativeAfter=await readAuthoritativeResources();
  assert.equal(authoritativeAfter.worldId,authoritativeBefore.worldId,"resource comparison remains in the same world");
  assert.equal(authoritativeAfter.tick,authoritativeBefore.tick,"resource comparison remains at the same live tick");
  assert.ok(authoritativeAfter.meanFraction<authoritativeBefore.meanFraction,
    `authoritative resource fractions decrease at the intervention tick (${authoritativeBefore.meanFraction} -> ${authoritativeAfter.meanFraction}; env tick ${authoritativeBefore.environmentTick} -> ${authoritativeAfter.environmentTick})`);
  // Wait for the renderer to actually repaint before sampling. The substrate is
  // rebuilt into the retained Pixi environment layer after the snapshot lands,
  // so the presented World can still show the previous field at this instant.
  // Sampling immediately produced two byte-identical captures on one run and a
  // correct reading on another - a race in the test, not in the renderer. Polling
  // for the change is honest about what is being waited for; sleeping a fixed
  // number of milliseconds would only hide it.
  let pixelsAfter=await sampleWorld();
  const changed=()=>pixelsAfter.some((v,i)=>v!==pixelsBefore[i]);
  for(let i=0;i<40&&!changed();i++){
    await deltaPage.waitForTimeout(100);
    pixelsAfter=await sampleWorld();
  }
  assert.ok(changed(),"the normal World repaints with the new field after the intervention");
  assert.equal(await tick(deltaPage),decisionTick,"production Pixi comparison remains at the resolution tick");
  const lumaAfter=await meanLuma();
  // Directional tally against the bare-substrate reference.
  // The bare reference comes from the module, never from a literal here. A stale
  // hardcoded copy inverted this whole measurement once already.
  const [bareR,bareG,bareB]=BARE_RGB;
  let lost=0, gained=0, totalShift=0;
  for(let i=0;i<pixelsBefore.length;i+=3){
    const db=Math.hypot(pixelsBefore[i]!-bareR,pixelsBefore[i+1]!-bareG,pixelsBefore[i+2]!-bareB);
    const da=Math.hypot(pixelsAfter[i]!-bareR,pixelsAfter[i+1]!-bareG,pixelsAfter[i+2]!-bareB);
    if(da<db-6){lost++;totalShift+=db-da;}
    else if(da>db+6){gained++;totalShift-=da-db;}
  }
  const samples=pixelsBefore.length/3;
  assert.ok(lost>0,
    `resource material visibly diminishes in the NORMAL World (${lost}/${samples} samples moved toward bare, ${gained} away)`);
  assert.ok(lost>gained*3,
    `loss dominates the change rather than being a wash (${lost} lost vs ${gained} gained)`);
  assert.ok(lost/samples>0.25,
    `the affected area is substantial, not a few cells (${(lost/samples*100).toFixed(0)}% of samples)`);
  // No lens was required to see it, and none was silently changed for the player.
  const lensAfter=await deltaPage.locator(".lens-active").innerText().catch(()=>"(default)");
  assert.equal(lensAfter,lensBefore,"the lens was never switched in order to perceive the consequence");
  // Scarcity must not read as damage. Damage vocabulary in practice means a
  // darker, wounded frame; the design rule forbids it without sim evidence, and
  // depleting material must not smuggle it in.
  assert.ok(lumaAfter>=lumaBefore-3,
    `depletion removes material without darkening the world (${lumaBefore.toFixed(1)} -> ${lumaAfter.toFixed(1)}), because darkening reads as damage`);

  // AC2: the one causal claim the sheet makes is the direct mechanical effect.
  // Read while the sheet is still up - previously this was read after the
  // acknowledge, by which point the sheet had detached and the element was gone.
  const effectText=await deltaPage.getByTestId("aftermath-direct-effect").innerText().catch(()=>"");
  assert.ok(effectText.trim().length>0,"the direct effect is stated on the open sheet");
  const compareButtons=deltaImpact.locator(".compare-option");
  assert.equal(await compareButtons.count(),3,"all comparison modes remain available in the impact sheet");
  assert.deepEqual(await compareButtons.allTextContents(),["Difference","Now","Before"],
    "impact comparisons remain ordered Difference | Now | Before");
  assert.equal(await deltaImpact.locator(".compare-option.active").getAttribute("data-compare"),"difference",
    "Difference remains the default impact comparison");
  await compareButtons.nth(2).click();
  await deltaPage.getByText(/moment the intervention was applied/i).waitFor();
  await compareButtons.nth(0).click();
  // Logged, not only asserted on failure: the margin is the evidence for this
  // slice, so a passing run must still produce it.
  console.log(`world consequence at zero ticks: ${lost}/${samples} samples lost material, ${gained} gained, luma ${lumaBefore.toFixed(1)}->${lumaAfter.toFixed(1)}`);

  // Pin the coverage bound against the regressions it must keep rejecting, so a
  // future retune of the ratio cannot read as a performance fix while quietly
  // accepting a worse minimap. Each vector is a real failure mode: painting one
  // corner, painting half, dropping a corner, and a quadrant that is present
  // but nearly empty.
  assert.ok(minimapCoversWorld([354, 794, 628, 518]),
    "minimap coverage: the observed live distribution must satisfy the bound");
  for (const [label, quadrants] of [
    ["top-left only", [5200, 0, 0, 0]],
    ["half painted", [5200, 4100, 0, 0]],
    ["one corner missing", [5200, 0, 4800, 4600]],
    ["one corner faint", [5200, 4100, 4800, 200]],
    ["blank minimap", [0, 0, 0, 0]],
  ] as const) {
    assert.ok(!minimapCoversWorld([...quadrants]),
      `minimap coverage must still reject: ${label} (${quadrants.join("/")})`);
  }
  console.log("minimap coverage bound: PASS (rejects single-corner, half-painted, missing-corner, faint-corner, blank)");
  // The affordance collapses the sheet; it is not a prerequisite for time.
  await deltaPage.getByTestId("aftermath-acknowledge").click();
  await deltaImpact.waitFor({state:"detached",timeout:15_000});
  // The slot is released once the sheet is acknowledged. That the evidence never
  // drifted is asserted above, by measuring the World across the intervention at
  // zero ticks, and separately in the runtime suite, which advances the world
  // 4,000 ticks and requires the retained states to be unchanged.
  const stillPinned=await deltaPage.getByTestId("sheet-slot").count();
  assert.equal(stillPinned,0,"the slot is released once the sheet is acknowledged");
  const compactAftermath=deltaPage.getByTestId("aftermath-compact");
  await compactAftermath.waitFor({timeout:15_000});
  const observationTick=await tick(deltaPage);
  await compactAftermath.click();
  const observationPanel=deltaPage.getByTestId("aftermath-stage2");
  await observationPanel.waitFor();
  assert.equal(await deltaPage.getByTestId("sheet-slot").getAttribute("data-mode"),"aftermath-stage2",
    "expanded observation uses the same single sheet slot");
  assert.equal(await deltaPage.locator(".decision-sheet").count(),1,"only one large sheet is present");
  assert.equal(await deltaPage.locator(".investigation-rail .inspector").count(),0,
    "expanded observation owns the sheet priority over inspection");
  assert.equal(await tick(deltaPage),observationTick,"expanding observation is a zero-tick presentation action");
  await deltaPage.getByRole("button",{name:"Collapse"}).click();
  await deltaPage.getByTestId("aftermath-compact").waitFor();
  assert.equal(await tick(deltaPage),observationTick,"collapsing observation is a zero-tick presentation action");
  await deltaPage.evaluate(()=>(window as any).__DEE_TEST__.setAftermathFixture("development"));
  await deltaPage.getByTestId("aftermath-compact").click();
  await deltaPage.getByTestId("aftermath-stage2").waitFor();
  await deltaPage.getByText("TEST FIXTURE — synthetic presentation only; not a world finding.").waitFor();
  assert.equal(await tick(deltaPage),observationTick,"fixture development presentation does not advance the world");
  await deltaPage.getByRole("button",{name:"Follow this view"}).click();
  assert.match(await deltaPage.locator(".lens-active").innerText(),/^Clades\b/,"Follow exposes only the fixture's explicitly selected lens");
  await deltaPage.getByRole("button",{name:"Traits",exact:true}).click();
  await deltaPage.getByRole("button",{name:"Stop Follow"}).waitFor();
  assert.match(await deltaPage.locator(".lens-active").innerText(),/^Traits\b/,"manual lens change remains the player's viewport");
  await deltaPage.getByRole("button",{name:"Stop Follow"}).click();
  assert.match(await deltaPage.locator(".lens-active").innerText(),/^Traits\b/,"stopping Follow never restores a hidden lens");
  assert.equal(await tick(deltaPage),observationTick,"Follow and manual lens override are zero-tick actions");
  await deltaPage.getByRole("button",{name:"Collapse"}).click();
  await deltaPage.evaluate(()=>(window as any).__DEE_TEST__.setAftermathFixture("settlement"));
  await deltaPage.getByTestId("aftermath-compact").getByText(/settled/).waitFor();
  await deltaPage.getByTestId("aftermath-compact").click();
  await deltaPage.getByTestId("aftermath-stage2").getByTestId("aftermath-settlement").waitFor();
  assert.equal(await deltaPage.getByTestId("aftermath-settlement").innerText(),
    "little/no major measured response within the observation window","horizon settlement uses evidence-bounded quiet wording");
  assert.equal(await deltaPage.getByRole("button",{name:"Review development in History"}).count(),0,
    "quiet settlement never creates a development History link");
  assert.equal(await tick(deltaPage),observationTick,"settlement presentation is a zero-tick operation");
  await deltaPage.getByRole("button",{name:"Collapse"}).click();
  await deltaPage.evaluate(()=>(window as any).__DEE_TEST__.setAftermathFixture(null));
  await deltaPage.getByTestId("aftermath-compact").getByText(/observing/).waitFor();
  await deltaPage.getByTestId("aftermath-compact").click();
  const provenanceLink=deltaPage.getByRole("button",{name:"Review decision context in History"});
  if(await provenanceLink.isVisible().catch(()=>false)){
    await provenanceLink.click();
    await deltaPage.getByRole("heading",{name:"History"}).waitFor();
    await deltaPage.locator(".story-detail").waitFor();
    assert.equal(await tick(deltaPage),observationTick,"History navigation does not advance simulation ticks");
    await deltaPage.getByRole("button",{name:"World",exact:true}).click();
    await deltaPage.getByTestId("aftermath-compact").waitFor();
  }else{
    await deltaPage.getByRole("button",{name:"Collapse"}).click();
  }
  await deltaPage.getByTestId("aftermath-compact").waitFor();
  const preemptedDecision=deltaPage.getByTestId("decision-sheet");
  for(let i=0;i<25&&!await preemptedDecision.isVisible().catch(()=>false);i++){
    await deltaPage.evaluate(()=>(window as any).__DEE_TEST__.runToNextEvent());
    await deltaPage.waitForTimeout(400);
  }
  await preemptedDecision.waitFor({timeout:180_000});
  assert.equal(await deltaPage.getByTestId("sheet-slot").getAttribute("data-mode"),"decision",
    "a pending decision takes the one expanded sheet slot");
  assert.equal(await deltaPage.getByTestId("aftermath-compact").count(),0,
    "pending decisions hide compact Aftermath without deleting its retained evidence");

  await deltaPage.close();
  console.log("aftermath impact → compact observation → expand/collapse: PASS");
  })();

    await page.getByRole("button",{name:"History"}).click();
    await page.getByRole("heading",{name:"History"}).waitFor();
    await page.getByRole("button",{name:"Tree"}).click();
    await page.getByRole("heading",{name:"Tree"}).waitFor();
    // M3 walkthrough: drill into the first clade lineage, then locate it.
    const cladeCard=page.locator(".cards .record-button").first();
    await cladeCard.waitFor();
    await cladeCard.click();
    await page.getByRole("button",{name:"Back to all clades"}).waitFor();
    await page.getByRole("button",{name:"Locate in world"}).click();
    await page.getByText("Selected organism").waitFor();
    await page.getByRole("button",{name:"Experiments"}).click();
    await page.getByRole("heading",{name:"Experiments"}).waitFor();

    await page.getByRole("button",{name:"Global nutrient crash"}).click();
    await page.getByText("Untouched twin").waitFor();

    await page.getByRole("button",{name:"World",exact:true}).click();
    await page.getByRole("button",{name:"Landscape"}).waitFor();
    await page.getByRole("button",{name:"Nutrients"}).click();
    await page.getByLabel("Resource view").selectOption("c");
    await page.getByRole("button",{name:"Waste"}).click();
    await page.getByRole("button",{name:"Traits"}).click();
    await page.getByLabel("Trait view").selectOption("byproductUse");

    // Lane 2 M4B: the normal lens delegates morphology to the phenotype
    // engine while every other lens keeps the legacy voxel path. Both must
    // paint in-browser, render differently, and survive inspection zoom.
    const worldInk=async()=>{
      // Measure Chromium's presented World pixels. Reading
      // Pixi's WebGL default framebuffer directly is not reliable after its
      // drawing buffer has been presented/discarded.
      const screenshot=await page.getByLabel("Evolution world").screenshot();
      return await page.evaluate(({encoded})=>new Promise<{bright:number;sig:number[]}>((resolve,reject)=>{
        const image=new Image();
        image.onerror=()=>reject(new Error("Could not decode browser-captured World"));
        image.onload=()=>{
          const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const context=canvas.getContext("2d",{willReadFrequently:true});
          if(!context){reject(new Error("2D canvas unavailable for screenshot sampling"));return;}
          context.drawImage(image,0,0);
          const {data}=context.getImageData(0,0,canvas.width,canvas.height);
          let bright=0;const sig=[];
          const nx=32,ny=18;
          for(let gy=0;gy<ny;gy++)for(let gx=0;gx<nx;gx++){
            let sum=0,n=0;
            const x0=Math.floor(gx*canvas.width/nx),x1=Math.floor((gx+1)*canvas.width/nx);
            const y0=Math.floor(gy*canvas.height/ny),y1=Math.floor((gy+1)*canvas.height/ny);
            for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1;x+=3){
              const i=(y*canvas.width+x)*4,l=(data[i]!+data[i+1]!+data[i+2]!)/3;
              sum+=l;n++;if(l>90)bright++;
            }
            sig.push(Math.round(sum/Math.max(1,n)));
          }
          resolve({bright,sig});
        };
        image.src=`data:image/png;base64,${encoded}`;
      }),{encoded:screenshot.toString("base64")});
    };
    await page.getByRole("button",{name:"Landscape",exact:true}).click();
    await page.getByRole("button",{name:"Reset view"}).click();
    await page.waitForTimeout(300);
    const readRasterEvidence = async () => page.evaluate(() => (window as Window & { __DEE_PIXI_RASTER_EVIDENCE__?: Array<{ family: string; tier: string; key: string; pixels: string }> }).__DEE_PIXI_RASTER_EVIDENCE__ ?? []);
    const ecosystemEvidence = await readRasterEvidence();
    assert.ok(ecosystemEvidence.some((item) => item.family === "plated" && item.tier === "ecosystem" && item.pixels === "legacy-grid"),
      "deeTest fixture guarantees Plated stays on the coarse ecosystem renderer");
    assert.ok(ecosystemEvidence.some((item) => item.family !== "plated" && item.pixels === "legacy-grid"),
      "deeTest fixture guarantees non-Plated families stay on the legacy renderer");
    for(let i=0;i<2;i++)await page.getByRole("button",{name:"Zoom in"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"2.0×","population tier zoom is deterministic");
    await page.waitForTimeout(300);
    const normalInk=await worldInk();
    console.log(`phenotype normal-lens ink: ${normalInk.bright} bright px`);
    assert.ok(normalInk.bright>50,`phenotype path paints organisms in normal lens (${normalInk.bright} bright px)`);
    const platedLayers = await readRasterEvidence();
    assert.ok(platedLayers.some((item) => item.family === "plated" && item.tier === "population" && item.pixels === "rich-rgba"),
      "normal population zoom presents a rich procedural Plated raster in the production Pixi world");
    console.log(`Plated production Pixi raster: ${JSON.stringify(platedLayers.filter((item) => item.family === "plated"))}`);
    await page.getByRole("button",{name:"Traits"}).click();
    await page.waitForTimeout(300);
    const traitsInk=await worldInk();
    console.log(`legacy traits-lens ink: ${traitsInk.bright} bright px`);
    assert.ok(traitsInk.bright>50,`legacy voxel path paints organisms in traits lens (${traitsInk.bright} bright px)`);
    assert.ok((await readRasterEvidence()).some((item) => item.family === "plated" && item.tier === "population" && item.pixels === "rich-rgba"),
      "analytical lenses preserve Plated texture identity while rendering the existing voxel encoding");
    let changedCells=0;
    for(let i=0;i<normalInk.sig.length;i++)if(Math.abs(normalInk.sig[i]-traitsInk.sig[i])>12)changedCells++;
    assert.ok(changedCells>20,`normal and traits lenses render differently (${changedCells}/576 cells)`);
    await page.getByRole("button",{name:"Landscape",exact:true}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"2.0×","inspection transition starts at population zoom");
    for(let i=0;i<2;i++)await page.getByRole("button",{name:"Zoom in"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"3.0×","reached inspection zoom");
    await page.waitForTimeout(300);
    const inspInk=await worldInk();
    console.log(`inspection-lens ink at 3.0x: ${inspInk.bright} bright px`);
    assert.ok(inspInk.bright>50,"inspection LOD paints at 3.0x");
    const inspectionRasterEvidence = await page.evaluate(() => (window as Window & { __DEE_PIXI_RASTER_EVIDENCE__?: Array<{ family: string; tier: string; key: string; pixels: string }> }).__DEE_PIXI_RASTER_EVIDENCE__ ?? []);
    assert.ok(inspectionRasterEvidence.some((item) => item.family === "plated" && item.tier === "inspection" && item.pixels === "rich-rgba"),
      "actual Explorer inspection zoom uses the rich Plated RGBA texture");
    assert.ok(inspectionRasterEvidence.some((item) => item.family !== "plated" && item.pixels === "legacy-grid"),
      "inspection zoom leaves non-Plated families on the existing renderer");
    await page.getByRole("button",{name:"Reset view"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"1.0×","reset restores the view");

    // Exercise every player-facing speed mode through the real controls.
    // Deterministic rate separation belongs to tools/validation/time-controls.ts;
    // a short browser wall-clock ratio is host-throughput evidence, not policy proof.
    // Decision-gate aware: a legitimate pending decision auto-pauses mid-window.
    // Never bypass the gate — resolve through the normal Keep-watching UI and
    // restart that window fresh (up to 3 attempts per speed).
    const speedSelect=page.getByLabel("Simulation speed");
    const deltas:Record<string,number>={};
    for(const v of ["1","10","100"]){
      await speedSelect.selectOption(v);
      let done=false;
      for(let attempt=0;attempt<3&&!done;attempt++){
        const before=await tick(page);
        await page.getByRole("button",{name:"Play"}).click();
        let elapsed=0;
        let gated=false;
        while(elapsed<2500){
          await page.waitForTimeout(250);
          elapsed+=250;
          if(await page.getByTestId("decision-sheet").isVisible().catch(()=>false)){
            gated=true;
            break;
          }
        }
        if(gated){
          await page.getByTestId("decision-sheet").getByText("Keep watching").click();
          await page.getByTestId("decision-sheet").waitFor({state:"detached",timeout:15_000});
          // Resolving opens the aftermath impact sheet. It does not gate time
          // (AC22) - playback auto-resumes here, because the world WAS playing -
          // so the sheet has NO guaranteed lifetime: a new pending decision
          // outranks it (AC15), takes the slot, and the sheet legitimately
          // disappears. That is correct product behaviour and it invalidates
          // this measurement window, so restart the window instead of assuming
          // the button stays put.
          //
          // Acknowledged through the runtime hook rather than a click: a click
          // races a node another sheet is entitled to remove. The real button
          // is still exercised by click in the dedicated aftermath block, where
          // the world is paused and preemption cannot occur.
          if(await page.getByTestId("aftermath-impact").isVisible().catch(()=>false)){
            await page.evaluate(async()=>{
              try {
                await (window as any).__DEE_TEST__.acknowledgeAftermath();
              } catch(error) {
                // The sheet can be one render behind playback: the runtime may
                // already have released impact into observation. Ignore only
                // that expected race; surface every other command failure.
                if(!String(error).includes("Aftermath is not awaiting acknowledgement"))throw error;
              }
            });
            await page.waitForTimeout(150);
          }
          // Whichever sheet now owns the slot, the window is void either way.
          if(await page.getByTestId("decision-sheet").isVisible().catch(()=>false))continue;
          await page.getByRole("button",{name:"Pause"}).click().catch(()=>{});
          continue;
        }
        await page.getByRole("button",{name:"Pause"}).click();
        deltas[v]=await tick(page)-before;
        console.log(`speed ${v}x: +${deltas[v]} ticks/2.5s`);
        assert.ok(deltas[v]!>0,`real ${v}x control advances the simulation`);
        done=true;
      }
      assert.ok(done,`speed ${v}x completed a gate-free window`);
    }
    // The browser proves each integrated control advances. Relative speed-policy
    // semantics are validated deterministically without wall-clock scheduling.
    await speedSelect.selectOption("100");
    // Family artwork: clicking an organism opens the details card with its
    // 128x128 base family portrait. World is paused, so a bounded grid search
    // over canvas points is deterministic enough (first hit wins).
    const worldCanvas=page.getByLabel("Evolution world");
    const wbox=await worldCanvas.boundingBox();
    let portrait=0;
    outer: for(const fy of [0.3,0.42,0.5,0.58,0.7]){
      for(const fx of [0.3,0.42,0.5,0.58,0.7]){
        await page.mouse.click(wbox!.x+wbox!.width*fx,wbox!.y+wbox!.height*fy);
        await page.waitForTimeout(200);
        portrait=await page.locator(".family-portrait img").count();
        if(portrait>0)break outer;
      }
    }
    assert.equal(portrait,1,"selecting an organism shows one family portrait");
    const art=page.locator(".family-portrait img").first();
    assert.match(await art.getAttribute("alt")||"",/family portrait$/,"portrait alt names the family");
    const artBox=await art.boundingBox();
    assert.equal(Math.round(artBox!.width),128,"portrait renders at 128px wide");
    assert.equal(Math.round(artBox!.height),128,"portrait renders at 128px tall");
    assert.match(await page.locator(".family-portrait figcaption").first().innerText(),/family$/i,"portrait caption names the family");

    await page.getByRole("button",{name:"Save"}).click();
    try{
      await page.getByText(/Saved tick/).waitFor();
    }catch(error){
      const diagnostics=await page.evaluate(()=>({
        events:(window as any).__DEE_TEST__?.saveDiagnostics?.()??null,
        runtimeStatus:(window as any).__DEE_TEST__?.currentStatus?.()??null,
        renderedStatus:document.querySelector(".status")?.textContent??null,
      }));
      const persisted=await page.evaluate(()=>new Promise((resolve)=>{
        const request=indexedDB.open("digital-evolution-ecosystem");
        request.onerror=()=>resolve({error:request.error?.name??"open-failed"});
        request.onsuccess=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains("universes")){db.close();resolve({error:"missing-store"});return}
          const tx=db.transaction("universes","readonly");
          const get=tx.objectStore("universes").get("current");
          let record:unknown=null;
          get.onsuccess=()=>{record=get.result??null};
          tx.oncomplete=()=>{
            db.close();
            const value=record as {tick?:unknown;checkpoint?:{createdTick?:unknown}}|null;
            resolve({tick:value?.tick??null,checkpointTick:value?.checkpoint?.createdTick??null});
          };
          tx.onerror=()=>{db.close();resolve({error:tx.error?.name??"read-failed"})};
          tx.onabort=()=>{db.close();resolve({error:tx.error?.name??"read-aborted"})};
        };
      }));
      console.log(`SAVE FLOW DIAGNOSTICS ${JSON.stringify({diagnostics,persisted})}`);
      throw error;
    }
    const saveStages=await page.evaluate(()=>(window as any).__DEE_TEST__?.saveDiagnostics?.()??[]);
    assert.ok(saveStages.some((event:any)=>event.stage==="checkpoint-request-resolved"),"worker checkpoint request resolved before storage");
    assert.ok(saveStages.some((event:any)=>event.stage==="indexeddb-transaction-committed"),"save confirmation follows IndexedDB transaction completion");
    assert.ok(saveStages.some((event:any)=>event.stage==="confirmation-set"),"post-commit save confirmation was emitted");
    // `let`, not `const`: the F3a block below advances the world while proving
    // playback intent survives a rejected load, so the exact-tick baseline is
    // re-taken at a known-paused moment once that block returns to pause.
    let saved=await tick(page);
    assert.ok(saved>=advanced,"checkpoint saved after runtime activity");

    await page.reload({waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();
    await page.getByRole("button",{name:"Resume"}).click();
    await page.getByText("Checkpoint restored").waitFor();
    await page.waitForTimeout(150);
    assert.equal(await tick(page),saved,"IndexedDB checkpoint restores exact tick");

    // AC2 — a FAILED write is reported as a failure, and destroys nothing.
    //
    // Both halves are asserted here because both are observable in a browser:
    // the truthful sentence, and the survival of the confirmed save across a
    // reload. The Node suite proves the same survival through the transaction
    // semantics directly (`testFailedOverwritePreservesPriorSave`).
    let confirmedTick=0;
    // Page-side scripts as STRINGS: esbuild's `__name` helper does not exist in the
    // browser, so any page.evaluate given a compiled function that declares a named
    // function fails with `ReferenceError: __name is not defined` before it runs.
    const poisonIndexedDbPut=`(()=>{
      const proto=IDBObjectStore.prototype;
      window.__deeOriginalPut=proto.put;
      proto.put=function(){throw new DOMException("The quota has been exceeded.","QuotaExceededError")};
      window.__deeRestorePut=function(){proto.put=window.__deeOriginalPut;window.__deeRestorePut=null};
      return true;
    })()`;
    const restoreIndexedDbPut=`(()=>{if(window.__deeRestorePut)window.__deeRestorePut();return true})()`;
    const corruptCurrentSave=`(()=>new Promise((resolve,reject)=>{
      const open=indexedDB.open("digital-evolution-ecosystem");
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const db=open.result;
        const tx=db.transaction("universes","readwrite");
        tx.objectStore("universes").put({id:"current",savedAt:new Date().toISOString(),tick:1,engineVersion:"0.0.0",checkpoint:{not:"a checkpoint"}});
        tx.oncomplete=()=>{db.close();resolve(true)};
        tx.onerror=()=>{db.close();reject(tx.error)};
        tx.onabort=()=>{db.close();reject(tx.error)};
      };
    }))()`;
    const failedOverwriteIsReportedTruthfully=async()=>{
      await page.getByRole("button",{name:"Save"}).click();
      await page.getByText(/Saved tick/).waitFor();
      confirmedTick=await tick(page);
      // Force a real write failure at the storage engine's own boundary.
      //
      // Passed as a STRING, not a function: esbuild injects a `__name` helper into
      // named function expressions it compiles, and that helper does not exist
      // inside the page, so a function form throws `ReferenceError: __name is not
      // defined` before reaching the browser. A string is evaluated as-is.
      //
      // A value containing a function is NOT the trigger: `put` throws
      // DataCloneError SYNCHRONOUSLY on one, so such a record is never stored and
      // cannot make anything fail. Instead the engine itself refuses the write —
      // the shape a quota-exhausted device produces — so the app's own code path
      // meets a genuine DOMException without the repository being stubbed.
      await page.evaluate(poisonIndexedDbPut);
      try{
        await page.getByRole("button",{name:"Save"}).click();
        await page.getByText(/Could not save/).waitFor({timeout:15_000});
        assert.doesNotMatch(
          await page.locator(".status").innerText(),
          /QuotaExceededError|quota has been exceeded|DOMException/i,
          "a failed write is reported in player prose, not as the raw DOM exception",
        );
      }finally{
        await page.evaluate(restoreIndexedDbPut);
      }
      // And the previously confirmed save is still loadable — the failed write
      // destroyed nothing.
      await page.reload({waitUntil:"networkidle"});
      await page.getByLabel("Evolution world").waitFor();
      await page.getByRole("button",{name:"Resume"}).click();
      await page.getByText("Checkpoint restored").waitFor({timeout:15_000});
      await page.waitForTimeout(150);
      assert.equal(await tick(page),confirmedTick,"a failed write leaves the previously confirmed save loadable");
    };

    // F3a — a rejected load must leave the live world alone and put playback
    // back (AC7/AC9), against real IndexedDB and real app ordering — the only
    // place these are observable, since App is not importable in Node.
    //
    // Precondition matters here: the suite arrives PAUSED (the speed gates above
    // end on Pause, and the reload at :487 does not resume). Attempting a load
    // from a paused world has no prior playback intent to restore, so AC9 would
    // pass vacuously. So this starts playback, proves the load did not steal it,
    // then pauses again — and the pause happens AFTER the tick is sampled, so
    // the exact-tick baseline the later assertions compare against is re-taken
    // at a known-paused moment.
    const rejectedLoadPreservesWorld=async()=>{
    // Corrupt the stored record through the page's own database, then attempt a
    // load while playing. The player must get a truthful sentence, the world
    // must stay usable, and playback must resume by itself.
    await page.evaluate(corruptCurrentSave);
    // Start playback FIRST: AC9 is about restoring a prior intent to RUN, which is
    // only observable from a running world.
    await page.getByRole("button",{name:"Play"}).click();
    await page.waitForTimeout(400);
    const beforeRejected=await tick(page);
    await page.getByRole("button",{name:"Resume"}).click();
    await page.getByText(/Restore failed/).waitFor({timeout:15_000});
    assert.doesNotMatch(
      await page.locator(".status").innerText(),
      /not a checkpoint|undefined|\[object/i,
      "the rejected-load message is player prose, not raw record text",
    );
    // The world is still usable: it is the pre-load world, still on screen.
    assert.ok(await page.getByLabel("Evolution world").isVisible(),"the world remains usable after a rejected load");
    // AC9: the app paused only to attempt the load, so it must resume for itself.
    await page.waitForTimeout(2_500);
    const afterRejected=await tick(page);
    assert.ok(afterRejected>beforeRejected,`playback intent is restored after an ordinary rejected load (${beforeRejected} -> ${afterRejected})`);
    // Resumed playback may have reached a decision. That is ordinary and
    // expected — and a pending decision hides the secondary chrome, including
    // the play/pause control — so clear it before returning to a paused world,
    // exactly as the world-chrome section below does.
    const interrupted=page.getByTestId("decision-sheet");
    if(await interrupted.count()){
      await interrupted.getByText("Keep watching").click();
      await interrupted.waitFor({state:"detached",timeout:15_000});
    }
    // Back to paused for the exact-tick assertions that follow, sampled here so
    // the baseline is taken at a known-paused moment.
    if(await page.getByRole("button",{name:"Pause"}).count())await page.getByRole("button",{name:"Pause"}).click();
    await settlePaused(page);
    await page.waitForTimeout(300);
    };

    // Put a loadable save back so the rest of the suite has a slot to resume
    // from: the corruption above made the slot unrestorable on purpose.
    await rejectedLoadPreservesWorld();
    await page.getByRole("button",{name:"Save"}).click();
    await page.getByText(/Saved tick/).waitFor();
    saved=await tick(page);
    await failedOverwriteIsReportedTruthfully();
    // failedOverwrite reloads the page and resumes, landing back on `saved`.
    saved=await tick(page);

    // World view: minimap + zoom controls (uniform zoom into the same world).
    // A pending decision yields the overlay by design (Lane A: secondary World
    // chrome may hide to prevent occlusion), so clear any decision first —
    // this section is about the world-view chrome, not the decision state.
    const decisionSheetOnMain=page.getByTestId("decision-sheet");
    if(await decisionSheetOnMain.count()){
      await decisionSheetOnMain.getByText("Keep watching").click();
      await decisionSheetOnMain.waitFor({state:"detached",timeout:15_000});
    }
    // Collapse any aftermath sheet the clearance above opened, so the
    // world-chrome assertions below are not measured through an overlay.
    const leftoverImpact=page.getByTestId("aftermath-impact");
    if(await leftoverImpact.isVisible().catch(()=>false)){
      await page.getByTestId("aftermath-acknowledge").click();
      await leftoverImpact.waitFor({state:"detached",timeout:15_000});
    }
    await page.getByLabel("World minimap").waitFor();
    assert.equal(await page.locator(".world-presentation-region .lensbar").count(),1,
      "React lens control is grouped with the World presentation region");
    assert.equal(await page.locator(".world-presentation-region .world-overlay").count(),1,
      "React minimap and zoom stay in the same presentation region");
    const minimap=page.getByTestId("world-minimap");
    const worldBox=await page.getByLabel("Evolution world").boundingBox();
    assert.ok(worldBox,"world canvas measurable");
    // Mirrors the renderer's fit rule so the expectation is independent of it.
    const fit=worldBox!.height>worldBox!.width
      ?worldBox!.height/600
      :Math.min(worldBox!.width,worldBox!.height)/600;
    assert.equal(await page.getByTestId("zoom-level").innerText(),"1.0×","camera starts unzoomed");
    await expectAttr(minimap,"data-window-w",v=>Math.abs(v-worldBox!.width/fit)<1,
      `minimap window matches visible world at 1x (~${(worldBox!.width/fit).toFixed(1)} world units)`);
    await page.getByRole("button",{name:"Zoom in"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"1.5×","zoom changes the view only");
    // The drawn rect must be the true visible width, not width/zoom again.
    const expectedZoomed=worldBox!.width/(fit*1.5);
    const windowW1=await expectAttr(minimap,"data-window-w",v=>Math.abs(v-expectedZoomed)<1,
      `minimap window tracks true zoom (~${expectedZoomed.toFixed(1)} world units, not /zoom twice)`);
    assert.ok(windowW1<expectedZoomed+1,"zooming in shrinks the visible world window");
    assert.equal(await tick(page),saved,"zooming never advances biology");
    await page.getByRole("button",{name:"Reset view"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"1.0×","reset restores the view");

    // The minimap resource field must cover the whole world, not a fraction.
    // Real stocks exist in every cell, so all four quadrants are inked; a
    // top-left-only regression drops the others to near-background.
    //
    // The comparison is RELATIVE, and deliberately so. The speed-control checks
    // above advance the world by a wall-clock-derived number of ticks (measured
    // at +141/+947/+2272 on one run and +153/+1389/+2794 on another), so how
    // much material is on the field when this assertion runs varies between
    // runs. An absolute ink floor therefore fails on total ink rather than on
    // coverage: a run that happened to advance less stock landed on 354 against
    // a 400 floor, which says nothing about the minimap being wrong.
    //
    // Ratio to the densest quadrant expresses the actual claim, and catches
    // every regression this check exists for: a top-left-only paint gives
    // [n,0,0,0] and a half-painted minimap gives [n,n,0,0], both of which fail,
    // while an entirely blank minimap gives [0,0,0,0] and also fails.
    const quadrantInk=await page.evaluate(`(()=>{
      const c=document.querySelector('canvas[aria-label="World minimap"]');
      const ctx=c.getContext('2d');
      const ink=(x,y,w,h)=>{const d=ctx.getImageData(x,y,w,h).data;let n=0;
        for(let i=0;i<d.length;i+=4){if(Math.abs(d[i]-6)+Math.abs(d[i+1]-18)+Math.abs(d[i+2]-26)>12)n++}
        return n;};
      const w=c.width,h=c.height,q=Math.floor(w*0.3);
      return[ink(0,0,q,q),ink(w-q,0,q,q),ink(0,h-q,q,q),ink(w-q,h-q,q,q)];
    })()`) as number[];
    assert.ok(minimapCoversWorld(quadrantInk),
      `minimap field covers the whole world (quadrants ${quadrantInk.join("/")}, sparsest must exceed a quarter of ${Math.max(...quadrantInk)})`);

    // Panning across the torus must keep the camera normalized: drag well past
    // one world width and the center stays inside [0,600).
    for(let i=0;i<6;i++){
      await page.mouse.move(700,520);await page.mouse.down();
      await page.mouse.move(300,520,{steps:8});await page.mouse.up();
    }
    await expectAttr(minimap,"data-cam-x",v=>v>=0&&v<600,"camera x normalized after panning past a world width");
    await expectAttr(minimap,"data-cam-y",v=>v>=0&&v<600,"camera y normalized after panning past a world width");
    await expectAttr(minimap,"data-window-w",v=>Math.abs(v-worldBox!.width/fit)<1,"view size is stable after panning");
    await page.getByRole("button",{name:"Reset view"}).click();
    assert.equal(await tick(page),saved,"camera work never advances biology");

    await page.getByRole("button",{name:"World settings"}).click();
    await page.getByRole("dialog",{name:"World settings"}).waitFor();
    // M4 presets: applying Patchwork sets its founding population; a random
    // seed must differ from the previous one. Neither creates a universe.
    await page.getByRole("button",{name:"Patchwork"}).click();
    assert.equal(await page.getByLabel(/Founding population/).inputValue(),"34","patchwork preset applies");
    await page.getByRole("button",{name:"Abundant"}).click();
    assert.equal(await page.getByLabel(/Nutrient supply/).inputValue(),"3.2","abundant preset applies");
    const seedBefore=await page.getByLabel("World seed").inputValue();
    await page.getByRole("button",{name:"New random seed"}).click();
    assert.notEqual(await page.getByLabel("World seed").inputValue(),seedBefore,"random seed generates a new seed");
    await page.getByRole("button",{name:"Developer diagnostics"}).click();
    // Diagnostics shows the running engine version (tracks version.ts, never pinned).
    await page.getByText(new RegExp(`Engine ${ENGINE_VERSION.replaceAll(".","\\.")}`)).waitFor();
    await page.getByRole("button",{name:"Close"}).click();

    // M4A: active-vs-pending recipe clarity. Staged settings stay visibly
    // pending; only Create universe applies them to a new universe.
    await page.getByRole("button",{name:"World settings"}).click();
    await page.getByRole("dialog",{name:"World settings"}).waitFor();
    // The running universe (the resumed world) is shown as the active recipe,
    // while the Abundant/random-seed recipe staged earlier stays pending.
    assert.match(await page.getByTestId("active-config").innerText(),/Active: Balanced · seed 821947219/,"resumed universe shown as active config (A3)");
    await page.getByTestId("pending-note").waitFor();
    assert.match(await page.getByTestId("pending-note").innerText(),/Unapplied changes/,"staged recipe visibly pending (A1)");
    await page.getByRole("button",{name:"Close"}).click();
    assert.equal(await tick(page),saved,"closing settings does not alter the running universe (A2)");
    assert.ok(await page.getByTestId("settings-pending").isVisible(),"pending state stays visible outside the modal");
    // Applying the pending recipe: Create universe starts a fresh world and
    // the staged recipe becomes the active configuration.
    await page.getByRole("button",{name:"World settings"}).click();
    await page.getByRole("button",{name:"Create universe"}).click();
    // The status text is transient (the fresh snapshot clears it), so wait for
    // the deterministic effects instead: modal closed, world rebuilt at tick 0.
    await page.getByRole("dialog",{name:"World settings"}).waitFor({state:"detached"});
    let rebuilt=await tick(page);
    for(let i=0;i<30&&rebuilt!==0;i++){await page.waitForTimeout(100);rebuilt=await tick(page)}
    assert.equal(rebuilt,0,"create universe starts a fresh world");
    await page.getByRole("button",{name:"World settings"}).click();
    assert.match(await page.getByTestId("active-config").innerText(),/Active: Abundant/,"created recipe becomes the active config");
    await page.getByTestId("active-note").waitFor();
    assert.match(await page.getByTestId("active-note").innerText(),/match the running universe/,"pending indicator clears after create");

    // Touch ownership on phone: the world canvas must keep its own gestures
    // (WebView scroll/pinch would otherwise cancel a pan mid-drag), and a real
    // touch pan must move the camera without advancing simulation time.
    const touchCtx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const touchPage=await touchCtx.newPage();
    await touchPage.goto(baseUrl,{waitUntil:"networkidle"});
    await touchPage.getByLabel("Evolution world").waitFor();
    // The inspector handle is progressive disclosure: it appears only once
    // something is selected, so it must be absent here rather than present.
    assert.equal(await touchPage.locator(".sheet-toggle").count(),0,
      "no inspector handle is shown until something is selected");
    const touchAction=await touchPage.evaluate(`getComputedStyle(document.querySelector('.world-pixi-host canvas, canvas[aria-label="Evolution world"]')).touchAction`);
    assert.equal(touchAction,"none","world canvas owns touch gestures (touch-action:none)");
    const tickBeforeTouch=await tick(touchPage);
    const camBefore=await touchPage.getByTestId("world-minimap").getAttribute("data-cam-x");
    const cdp=await touchCtx.newCDPSession(touchPage);
    const touchBox=(await touchPage.getByLabel("Evolution world").boundingBox())!;
    const ty=Math.round(touchBox.y+touchBox.height*0.45);
    const tx0=Math.round(touchBox.x+touchBox.width*0.5);
    const tx1=Math.round(touchBox.x+touchBox.width*0.2);
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:tx0,y:ty,id:1}]});
    for(let step=1;step<=6;step++){
      await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:tx0+(tx1-tx0)*step/6,y:ty,id:1}]});
    }
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    const camAfter=await expectAttr(touchPage.getByTestId("world-minimap"),"data-cam-x",
      v=>Math.abs(v-Number(camBefore))>1,"touch pan moves the camera");
    assert.ok(Number(camAfter)>=0&&Number(camAfter)<600,`touch pan keeps the camera normalized (${camAfter})`);
    assert.equal(await tick(touchPage),tickBeforeTouch,"touch pan never advances simulation time");
    // A tap is a selection gesture, not a pan: the camera must not drift.
    const camBeforeTap=await touchPage.getByTestId("world-minimap").getAttribute("data-cam-x");
    await touchPage.getByLabel("Evolution world").tap({position:{x:Math.round(touchBox.width*0.5),y:Math.round(touchBox.height*0.4)}});
    assert.equal(await touchPage.getByTestId("world-minimap").getAttribute("data-cam-x"),camBeforeTap,"tap does not pan the camera");
    assert.equal(await tick(touchPage),tickBeforeTouch,"tap never advances simulation time");
    await touchCtx.close();

    // M3 event decision, end to end on the World surface: the world pauses for a
    // decision, Play cannot bypass it, resolving records the choice with no hidden
    // tick, and prior playback intent resumes afterward.
    const decisionPage=await context.newPage();
    // Test hook, not a product control (AC21).
    await decisionPage.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await decisionPage.getByLabel("Evolution world").waitFor();
    await decisionPage.getByRole("button",{name:"World settings"}).click();
    // Balanced with this seed reaches a mapped formation event earliest of
    // the surveyed seeds, so the decision path is provable in smoke time.
    await decisionPage.getByLabel("World seed").fill("24681357");
    await decisionPage.getByRole("button",{name:"Create universe"}).click();
    // Same transient-status reasoning as above: the modal closing plus the
    // requested seed in the HUD-adjacent active config proves the rebuild.
    await decisionPage.getByRole("dialog",{name:"World settings"}).waitFor({state:"detached"});
    // Prove the rebuild used the requested seed: the active recipe reflects it.
    await decisionPage.getByRole("button",{name:"World settings"}).click();
    assert.match(
      await decisionPage.getByTestId("active-config").innerText(),
      /seed 24681357/,
      "rebuilt world runs the requested seed",
    );
    await decisionPage.getByRole("button",{name:"Close"}).click();
    // Start the production journey without any retained RenderSnapshot detail.
    await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.clearRetainedDetail());
    await decisionPage.getByLabel("Simulation speed").selectOption("1");
    const tickBeforeSearch=await tick(decisionPage);
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForFunction(
      previous=>Number(document.querySelector('[data-testid="tick"]')?.textContent?.replace(/\D/g,""))>previous,
      tickBeforeSearch,
      {timeout:15_000},
    );
    const sheet=decisionPage.getByTestId("decision-sheet");
    for(let i=0;i<20&&!(await sheet.isVisible().catch(()=>false));i++){
      await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.runToNextEvent());
      await decisionPage.waitForTimeout(1000);
    }
    await sheet.waitFor({timeout:180_000});
    // Scoped to the sheet: the status line elsewhere carries the same prefix
    // ("A decision is waiting — choose how to respond.") and makes the
    // unscoped text locator resolve to two elements (issue #36).
    await sheet.getByText("A decision is waiting").waitFor();
    const decisionTick=await tick(decisionPage);
    const choices=await sheet.locator(".decision-choices button").count();
    assert.equal(choices,4,"decision offers keep watching plus three interventions (A4)");
    // A13: Play must not bypass the pending decision.
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(600);
    assert.equal(await tick(decisionPage),decisionTick,"Play cannot advance while a decision is pending (A6/A13)");
    // Capture both sides of the brief impact->observation morph. Prior play
    // intent resumes immediately after resolution, so impact is transient by
    // design; the observer preserves evidence without slowing product playback.
    await decisionPage.evaluate(()=>{
      const evidence:{phases:string[];impactSlotMode:string|null}={phases:[],impactSlotMode:null};
      (window as any).__DEE_AFTERMATH_PHASES__=evidence;
      new MutationObserver(records=>{
        for(const record of records){
          for(const node of [...record.addedNodes]){
            if(node instanceof Element&&(node.matches('[data-testid="aftermath-impact"]')||node.querySelector('[data-testid="aftermath-impact"]')!==null)){
              evidence.phases.push("impact");
              evidence.impactSlotMode=(node instanceof Element?node.closest('[data-testid="sheet-slot"]'):null)?.getAttribute("data-mode")??null;
            }
          }
        }
        if(document.querySelector('[data-testid="aftermath-compact"]')&&!evidence.phases.includes("observation"))evidence.phases.push("observation");
      }).observe(document.body,{childList:true,subtree:true});
    });
    // A7: resolve with keep watching; no hidden tick, no control fork.
    await sheet.getByText("Keep watching").click();
    await sheet.waitFor({state:"detached",timeout:15_000});
    assert.equal(await tick(decisionPage),decisionTick,"resolution advances zero ticks (A7)");
    // The live frame resumes remembered play automatically. Wait for the first
    // live advance to expose compact observation, not for the transient impact.
    const compactAfterFirstAdvance=decisionPage.getByTestId("aftermath-compact");
    await compactAfterFirstAdvance.waitFor({timeout:15_000});
    assert.ok(await tick(decisionPage)>decisionTick,"the pre-existing play intent resumes on the first live advance");
    const observedMorph=await decisionPage.evaluate(()=>(window as any).__DEE_AFTERMATH_PHASES__);
    assert.ok(observedMorph.phases.includes("impact"),"the browser observed the real decision impact phase");
    assert.ok(observedMorph.phases.includes("observation"),"the browser observed compact observation after impact");
    assert.equal(observedMorph.impactSlotMode,"aftermath","impact uses the same single large sheet slot");
    assert.equal(await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.retainedAftermathPhase()),"impact",
      "retained detail is deliberately stale at impact while live interpretation has advanced");
    assert.match(await compactAfterFirstAdvance.innerText(),/observing/,
      "live observation remains visible despite stale retained detail at impact");
    await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.clearRetainedDetail());
    await compactAfterFirstAdvance.waitFor({state:"visible",timeout:5_000});
    assert.equal(await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.retainedAftermathPhase()),null,
      "the retained detail is now explicitly null");
    assert.match(await compactAfterFirstAdvance.innerText(),/observing/,
      "null retained detail also leaves live observation visible");
    await decisionPage.getByRole("button",{name:"Pause"}).click();
    // The HUD can still be a frame behind the scheduler's teardown, so wait for
    // the world to actually stop before computing a bounded advance from it.
    await settlePaused(decisionPage);

    // Reach real T+25,000 through ordinary bounded runtime advances, without
    // opening History/Experiments or refreshing retained detail in observation.
    const aftermathHorizon=decisionTick+25_000;
    const currentTick=await tick(decisionPage);
    assert.ok(currentTick<aftermathHorizon,"the live decision Aftermath is still inside its observation horizon");
    await advanceRuntimeToTick(decisionPage,aftermathHorizon-1);
    assert.equal(await tick(decisionPage),aftermathHorizon-1,
      "ordinary runtime advancement reaches T+24,999 without an automatic decision preemption");
    assert.equal(await decisionPage.getByTestId("decision-sheet").count(),0,
      "no automatic decision is pending at the last protected tick");
    const compactBeforeBoundary=decisionPage.getByTestId("aftermath-compact");
    await compactBeforeBoundary.waitFor({timeout:15_000});
    await compactBeforeBoundary.click();
    const observationPanel=decisionPage.getByTestId("aftermath-stage2");
    await observationPanel.waitFor({timeout:15_000});
    assert.match(await observationPanel.innerText(),/Observation continues for 1 more simulation ticks/,
      "remaining ticks use the live tick exactly one tick before the horizon");
    await advanceRuntimeToTick(decisionPage,aftermathHorizon);
    assert.equal(await tick(decisionPage),aftermathHorizon,
      "ordinary runtime advancement reaches the exact Aftermath horizon");
    assert.equal(await decisionPage.getByTestId("decision-sheet").count(),0,
      "the horizon boundary itself does not replay a protected-period event");
    assert.equal(await observationPanel.getAttribute("data-stage"),"settlement",
      "live Stage 2 settles exactly at resolutionTick + 25,000 without detail refresh");
    assert.match(await observationPanel.innerText(),/observation window/i,
      "quiet settlement retains its approved observation-window meaning");

    // A later retained-detail pull may enrich History, but cannot rewind or
    // hide the live Aftermath lifecycle.
    await decisionPage.getByRole("button",{name:"History",exact:true}).click();
    await decisionPage.getByText("Your decisions").waitFor();
    await decisionPage.getByText("Keep watching",{exact:true}).waitFor();
    await decisionPage.getByRole("button",{name:"World",exact:true}).click();
    assert.equal(await observationPanel.getAttribute("data-stage"),"settlement",
      "refreshing detail does not hide or rewind the settled live Aftermath");
    await decisionPage.getByRole("button",{name:"Experiments",exact:true}).click();
    await decisionPage.getByRole("heading",{name:"Experiments"}).waitFor();
    await decisionPage.getByRole("button",{name:"World",exact:true}).click();
    assert.equal(await observationPanel.getAttribute("data-stage"),"settlement",
      "an Experiments detail refresh also leaves live settlement unchanged");
    // C17 plus Aftermath protection: after the observation horizon the existing
    // catalyst policy resumes at its first eligible stride.
    await decisionPage.getByRole("button",{name:"World",exact:true}).click();
    const catalystSheet=decisionPage.getByTestId("decision-sheet");
    await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.advanceTicks(251));
    await catalystSheet.waitFor({timeout:180_000});
    assert.equal(await catalystSheet.getAttribute("data-source"),"world_catalyst","window carries catalyst provenance, never a fake event");
    await catalystSheet.getByText("World catalyst — your move").waitFor();
    await catalystSheet.getByText("Change the environment?").waitFor();
    const catalystTick=await tick(decisionPage);
    assert.ok(catalystTick>=aftermathHorizon,"catalyst window resumes only after the Aftermath horizon");
    const catalystChoices=await catalystSheet.locator(".decision-choices button").count();
    assert.ok(catalystChoices>=2,"window offers keep watching plus eligible catalysts");
    // Bypass prevention, zero-tick resolution, explicit resume — same gate.
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(600);
    assert.equal(await tick(decisionPage),catalystTick,"Play cannot bypass a catalyst window");
    await catalystSheet.getByText("Keep watching").click();
    await catalystSheet.waitFor({state:"detached",timeout:15_000});
    assert.equal(await tick(decisionPage),catalystTick,"catalyst resolution advances zero ticks");
    // Same contract as an event decision: the sheet collapses via its
    // affordance, and time is not gated on that.
    const catalystImpact=decisionPage.getByTestId("aftermath-impact");
    await catalystImpact.waitFor({timeout:15_000});
    await decisionPage.getByTestId("aftermath-acknowledge").click();
    await catalystImpact.waitFor({state:"detached",timeout:15_000});
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(900);
    assert.ok(await tick(decisionPage)>catalystTick,"explicit play resumes after a catalyst choice");
    await decisionPage.getByRole("button",{name:"Pause"}).click();
    await settlePaused(decisionPage);
    await decisionPage.getByRole("button",{name:"History"}).click();
    await decisionPage.getByText(/World catalyst offered at tick/).waitFor();
    // A deliberate manual intervention remains available and clears the old
    // foreground observation rather than leaving it attached to a new world.
    await decisionPage.getByRole("button",{name:"Experiments",exact:true}).click();
    await decisionPage.getByRole("button",{name:"Global nutrient crash",exact:true}).click();
    const afterManualExperiment=await tick(decisionPage);
    await decisionPage.getByRole("button",{name:"World",exact:true}).click();
    await decisionPage.waitForFunction(
      ()=>document.querySelector('[data-testid="aftermath-compact"]')===null,
      undefined,
      {timeout:15_000},
    );
    assert.equal(await decisionPage.getByTestId("aftermath-compact").count(),0,
      "a deliberate experiment supersedes the previous foreground Aftermath");
    assert.equal(await decisionPage.getByTestId("aftermath-impact").count(),0,
      "manual intervention does not fabricate a new decision-impact aftermath");
    assert.equal(await tick(decisionPage),afterManualExperiment,
      "the superseding manual experiment advances zero ticks");
    await decisionPage.close();

    const mobile=await context.newPage();
    await mobile.setViewportSize({width:390,height:844});
    await mobile.goto(baseUrl,{waitUntil:"networkidle"});
    await mobile.getByLabel("Evolution world").waitFor();
    // A4: on a phone viewport the living world dominates the frame instead
    // of shrinking to a card in a scroll stack.
    const box=await mobile.getByLabel("Evolution world").boundingBox();
    const vp=mobile.viewportSize()??{width:390,height:844};
    assert.ok(box&&box.height>=vp.height*0.5,"world canvas dominates the phone viewport (A4)");
    await mobile.getByRole("button",{name:"History"}).click();
    await mobile.getByRole("heading",{name:"History"}).waitFor();

    // Toroidal pan regression: the substrate is one world period repeated
    // across the canvas, and panning must not blank it. Previously the
    // destination rect was derived from the wrapped world->screen mapping,
    // which collapsed to zero width for every camera except the exact world
    // centre - so the landscape rendered only un-panned and vanished on a
    // device after a pan.
    //
    // This must prove BOTH halves of that failure, or it proves nothing:
    //   1. a real pan occurred - the camera moved by a meaningful toroidal
    //      distance, and
    //   2. the substrate survived it.
    // A coverage-only check passes trivially at the default camera, which is
    // the one position that always worked, so movement must be asserted
    // rather than assumed.
    const panPage=await context.newPage();
    await panPage.goto(baseUrl,{waitUntil:"networkidle"});
    await panPage.getByLabel("Evolution world").waitFor();
    // Freeze the world: a pending decision hard-pauses time and hides the
    // minimap that publishes the camera, so a running world would make this
    // check depend on simulation timing.
    const pauseBtn=panPage.getByRole("button",{name:"Pause"});
    if(await pauseBtn.count())await pauseBtn.click();
    const panWorld=panPage.getByLabel("Evolution world");
    const PAN_EXTENT=600;
    const panWrap=(a:number,b:number)=>{let d=(a-b)%PAN_EXTENT;if(d>PAN_EXTENT/2)d-=PAN_EXTENT;else if(d<-PAN_EXTENT/2)d+=PAN_EXTENT;return d};
    const readCam=async()=>{
      const el=panPage.getByTestId("world-minimap");
      await el.waitFor({state:"attached"});
      return {
        x:Number(await el.getAttribute("data-cam-x")),
        y:Number(await el.getAttribute("data-cam-y")),
      };
    };
    const camDist=(a:{x:number;y:number},b:{x:number;y:number})=>
      Math.hypot(panWrap(a.x,b.x),panWrap(a.y,b.y));
    // A genuine drag of a few percent of the frame moves the camera tens of
    // world units, so 20 sits far above a no-op and far below a real pan.
    const MEANINGFUL=20;
    const fieldInk=async()=>{
      const encoded=(await panWorld.screenshot()).toString("base64");
      return await panPage.evaluate(({encoded})=>new Promise<number>((resolve,reject)=>{
        const image=new Image();image.onerror=()=>reject(new Error("Could not decode presented World"));
        image.onload=()=>{
          const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
          const ctx=canvas.getContext("2d");if(!ctx){reject(new Error("Screenshot analysis canvas unavailable"));return;}
          ctx.drawImage(image,0,0);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
          let varied=0;
          for(let i=0;i<data.length;i+=4)if(data[i]!==data[i+1]||data[i+1]!==data[i+2])varied++;
          resolve(varied/(data.length/4));
        };
        image.src=`data:image/png;base64,${encoded}`;
      }),{encoded});
    };
    const panBox=await panWorld.boundingBox();
    assert.ok(panBox,"pan canvas measurable");
    // Start at the reset camera, and require that it actually is the reset
    // camera. That is the single position the wrapped mapping got right, so
    // departing from it is exactly the path that used to fail.
    const camStart=await readCam();
    assert.ok(Number.isFinite(camStart.x)&&Math.abs(panWrap(camStart.x,PAN_EXTENT/2))<1,
      `pan test starts at the world centre, the one position that used to work (cam ${camStart.x.toFixed(1)},${camStart.y.toFixed(1)})`);
    const inkAtRest=await fieldInk();
    assert.ok(inkAtRest>0,`presented World has spatial color variation at rest (${(inkAtRest*100).toFixed(1)}% pixels)`);
    let camPrev=camStart;
    let departed=false;
    for(const [dx,dy] of [[.42,.5],[.5,.42],[.25,.3],[.6,.62]]){
      await panPage.mouse.move(panBox!.x+panBox!.width/2,panBox!.y+panBox!.height/2);
      await panPage.mouse.down();
      await panPage.mouse.move(panBox!.x+panBox!.width*dx,panBox!.y+panBox!.height*dy,{steps:6});
      await panPage.mouse.up();
      await panPage.waitForTimeout(250);
      // Half one: the camera really moved, by a meaningful toroidal distance
      // from where it stood before this drag.
      const camNow=await readCam();
      const moved=camDist(camPrev,camNow);
      assert.ok(moved>MEANINGFUL,
        `drag to (${dx},${dy}) moved the camera ${moved.toFixed(0)} world units (cam ${camPrev.x.toFixed(0)},${camPrev.y.toFixed(0)} -> ${camNow.x.toFixed(0)},${camNow.y.toFixed(0)}), so this is a pan and not a no-op`);
      camPrev=camNow;
      if(camDist(camStart,camNow)>MEANINGFUL)departed=true;
      // Half two: the landscape survived the pan.
      const after=await fieldInk();
       assert.ok(after>0,`presented World remains visible after panning to (${dx},${dy}) (${(after*100).toFixed(1)}% varied pixels)`);
    }
    // And it ended up away from the one position the old code drew correctly.
    assert.ok(departed,
      `camera departed the world centre (start ${camStart.x.toFixed(0)},${camStart.y.toFixed(0)} -> ${camPrev.x.toFixed(0)},${camPrev.y.toFixed(0)})`);
    await panPage.close();
    console.log("toroidal pan moves the camera and keeps the substrate visible: PASS");

  await runLandscapeChecks(context);
    // Fatal runtime path (Tranche B item 6): a dead worker must read as stopped,
    // never as playing-while-dead.
    await page.goto(`${baseUrl}?deeTest=1`, { waitUntil: "networkidle" });
    await page.getByLabel("Evolution world").waitFor();
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(900);
    await page.evaluate(() => (window as any).__DEE_TEST__.killWorker());
    await page.getByRole("button", { name: "Play" }).waitFor({ timeout: 5000 }); // running false => Play shown
    assert.match(await page.getByTestId("runtime-status").innerText(), /stopped/i, "fatal status names the stopped state");
    const frozenAt = await tick(page);
    await page.waitForTimeout(900);
    assert.equal(await tick(page), frozenAt, "no snapshot advances the dead world");
    await page.getByRole("button", { name: "Play" }).click(); // AC8: scheduler must not feed the dead runtime
    await page.waitForTimeout(900);
    assert.equal(await tick(page), frozenAt, "Play after death issues no advance");
    // Finding 2: the dead runtime stays visibly stopped — post-death Play never
    // flips the toggle to Pause, and the stopped status survives the click.
    assert.equal(await page.getByRole("button",{name:"Play"}).count(), 1, "post-death Play still offers Play");
    assert.equal(await page.getByRole("button",{name:"Pause"}).count(), 0, "no Pause affordance on a dead runtime");
    assert.match(await page.getByTestId("runtime-status").innerText(), /stopped/i, "stopped status survives Play after death");
    console.log("fatal worker path reads as stopped: PASS");
    console.log("browser smoke: PASS");
  }finally{
    await browser.close();
  }
}

/**
 * Slice 2 ecological landscape: semantic compositing, analytical waste view,
 * organism readability, temporal smoothing, and universe-switch isolation.
 * Reads only pixels and canvas geometry, so it stays independent of the
 * renderer's own arithmetic.
 */
async function runLandscapeChecks(context:import("playwright").BrowserContext){
  const page=await context.newPage();
  await page.goto(baseUrl,{waitUntil:"networkidle"});
  const world=page.locator(".world-pixi-host");
  await world.locator("canvas").waitFor();
  assert.equal(await page.locator("canvas.world-canvas").count(),0,"production landscape evidence has no semantic Canvas World");
  assert.equal(await world.count(),1,"production landscape evidence samples exactly one Pixi World");
  // Waste exists and grows in this world; the landscape must reflect it.
  await page.getByRole("button",{name:"Play"}).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button",{name:"Pause"}).click();
  await settlePaused(page);
  // Analyze Chromium's presented element screenshot, never Pixi's discarded
  // WebGL drawing buffer. Signatures support lens/reset comparisons without
  // reusing Canvas-calibrated pixel thresholds.
  const ink=async(p:import("playwright").Locator)=>{
    const encoded=(await p.screenshot()).toString("base64");
    return await p.evaluate((_,{encoded})=>new Promise<{mean:number;sd:number;bright:number;sig:number[]}>((resolve,reject)=>{
      const image=new Image();
      image.onerror=()=>reject(new Error("Could not decode presented World screenshot"));
      image.onload=()=>{
        const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const ctx=canvas.getContext("2d",{willReadFrequently:true});
        if(!ctx){reject(new Error("2D canvas unavailable for screenshot analysis"));return;}
        ctx.drawImage(image,0,0);
        const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
        let n=0,sum=0,sum2=0,bright=0;
        for(let i=0;i<data.length;i+=4){
          const lum=.2126*data[i]!+.7152*data[i+1]!+.0722*data[i+2]!;
          sum+=lum;sum2+=lum*lum;n++;if(lum>150)bright++;
        }
        const sig:number[]=[],nx=32,ny=32;
        for(let gy=0;gy<ny;gy++)for(let gx=0;gx<nx;gx++){
          const x=Math.floor((gx+.5)*canvas.width/nx),y=Math.floor((gy+.5)*canvas.height/ny),i=(y*canvas.width+x)*4;
          sig.push(data[i]!,data[i+1]!,data[i+2]!);
        }
        const mean=sum/n;
        resolve({mean,sd:Math.sqrt(Math.max(0,sum2/n-mean*mean)),bright,sig});
      };
      image.src=`data:image/png;base64,${encoded}`;
    }),{encoded});
  };

  await page.getByRole("button",{name:"Landscape"}).click();
  await page.waitForTimeout(350);
  const landscape=await ink(world);
  assert.ok(landscape&&landscape.sd>0,
    `production Pixi landscape is spatially structured (sd ${landscape?.sd.toFixed(2)})`);

  // Analytical views must be clearly different modes from the landscape.
  await page.getByRole("button",{name:"Nutrients"}).click();
  await page.getByLabel("Resource view").selectOption("a");
  await page.waitForTimeout(250);
  const nutrientA=await ink(world);
  await page.getByRole("button",{name:"Waste"}).click();
  await page.waitForTimeout(250);
  const wasteView=await ink(world);
  const lensDelta=landscape!.sig.reduce((n,value,i)=>n+(value!==wasteView!.sig[i]?1:0),0);
  assert.ok(lensDelta>0,
    `waste overlay presents a distinct mode from the landscape (${lensDelta} sampled channels differ)`);
  assert.ok(nutrientA&&wasteView,
    "analytical lenses render measurable fields");
  // Exact-field views must not carry the landscape's cosmetic texture: a
  // flat analytical view has visibly lower local variance than the substrate.
  await page.getByRole("button",{name:"Landscape"}).click();
  await page.waitForTimeout(350);
  const landscape2=await ink(world);
  assert.deepEqual(landscape2!.sig,landscape!.sig,"landscape signature returns after the analytical lens round-trip");

  // Organism foreground must survive the richer substrate: active and
  // dormant life stay distinguishable by their own marks, not by the field.
  const organisms=await ink(world);
  assert.ok(organisms.bright>0,
    `organisms remain visible above the production Pixi landscape (${organisms.bright} bright pixels)`);

  // --- Reset contract: entering B after A must equal entering B cleanly ----
  //
  // Temporal smoothing is presentation-only state and must not leak between
  // worlds. The previous check here could not test that: it created the second
  // universe with `New random seed` (Math.random in App.tsx) and then asserted
  // `sd > 3`. That asserts "this particular random world has some contrast",
  // which is not the same claim -- a smoothing leak would satisfy it too -- and
  // it flaked, measuring 2.97 against a floor of 3.
  //
  // The claim becomes testable once the seed is fixed and the two entry paths
  // are made comparable. `landscape.ts` has no Math.random, no Date.now, and no
  // performance.now, so the renderer is deterministic: if the smoother's inertia
  // is genuinely cleared, the A -> B frame and a clean B frame at the same seed,
  // config, and tick must agree. If they blend, the A -> B frame carries A's
  // structure into B and the comparison catches it.
  //
  // So: build real A-derived smoothing state, switch to B, and require that
  // frame to match the frame a fresh page produces for B on its own.
  const SEED_A=11111111;
  const SEED_B=22222222;
  const switchToSeed=async(p:Page,seed:number)=>{
    await p.getByRole("button",{name:"World settings"}).click();
    await p.getByRole("dialog",{name:"World settings"}).waitFor();
    await p.getByLabel("World seed").fill(String(seed));
    await p.getByRole("button",{name:"Create universe"}).click();
    await p.getByRole("button",{name:"Landscape"}).click();
    await p.waitForTimeout(500);
    return p.locator(".world-pixi-host");
  };

  // World A, with enough rendered history for the smoother to hold real
  // A-derived inertia rather than starting from nothing.
  const worldA=await switchToSeed(page,SEED_A);
  await page.waitForTimeout(700);
  const inkA=await ink(worldA);

  // Path 1: A -> B on the page that has been rendering A.
  const pixiB=await switchToSeed(page,SEED_B);
  const switched=await ink(pixiB);

  // Path 2: a fresh page that has only ever seen B.
  const cleanPage=await context.newPage();
  await cleanPage.goto(baseUrl,{waitUntil:"networkidle"});
  const cleanWorld=cleanPage.locator(".world-pixi-host");
  await cleanWorld.locator("canvas").waitFor();
  assert.equal(await cleanWorld.count(),1,"clean reset comparison mounts one Pixi World");
  const cleanPixi=await switchToSeed(cleanPage,SEED_B);
  const clean=await ink(cleanPixi);
  await cleanPage.close();

  assert.ok(inkA&&switched&&clean,
    `both entry paths render a landscape (A ${!!inkA}, A->B ${!!switched}, clean B ${!!clean})`);
  const differingChannels=switched!.sig.reduce((n,value,i)=>n+(value!==clean!.sig[i]?1:0),0);
  console.log(`Pixi universe reset: A sd=${inkA!.sd.toFixed(2)} | A→B vs clean B differing sampled channels=${differingChannels}`);
  assert.deepEqual(switched!.sig,clean!.sig,
    "entering B after A produces the same presented Pixi signature as entering B cleanly");

  // Phone viewport: the landscape must still dominate and stay readable.
  const mobile=await context.newPage();
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(baseUrl,{waitUntil:"networkidle"});
  const mobileWorld=mobile.locator(".world-pixi-host");
  await mobileWorld.locator("canvas").waitFor();
  assert.equal(await mobileWorld.count(),1,"phone landscape baseline mounts one Pixi World");
  await mobile.getByRole("button",{name:"Play"}).click();
  await mobile.waitForTimeout(1000);
  await mobile.getByRole("button",{name:"Pause"}).click();
  await settlePaused(mobile);
  const mWorld=mobileWorld;
  const mBox=await mWorld.boundingBox();
  const mvp=mobile.viewportSize()??{width:390,height:844};
  assert.ok(mBox&&mBox.height>=mvp.height*0.5,"landscape dominates the phone viewport");
  const mInk=await ink(mWorld);
  assert.ok(mInk&&mInk.sd>0,`phone Pixi landscape remains spatially structured (sd ${mInk?.sd.toFixed(2)})`);
  // The lens set is collapsed behind the active-lens chip on the phone.
  await mobile.locator(".lens-active").click();
  await mobile.waitForTimeout(200);
  await mobile.getByRole("button",{name:"Waste",exact:true}).click();
  await mobile.waitForTimeout(250);
  const mWaste=await ink(mWorld);
  const phoneLensDelta=mInk!.sig.reduce((n,value,i)=>n+(value!==mWaste!.sig[i]?1:0),0);
  assert.ok(phoneLensDelta>0,`phone waste lens visibly differs from Landscape (${phoneLensDelta} sampled channels)`);
  await mobile.close();
  await page.close();

}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
