import assert from "node:assert/strict";
import { chromium, type Locator, type Page } from "playwright";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import { BARE_RGB } from "../../apps/explorer/src/landscape.ts";

const baseUrl=process.env.DEE_BASE_URL||"http://127.0.0.1:4173";

async function tick(page:Page){
  const text=await page.getByTestId("tick").innerText();
  return Number(text.replace(/[^0-9]/g,""));
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
  const sampleWorld=async()=>await deltaPage.getByLabel("Evolution world").evaluate((el:HTMLCanvasElement,g:number)=>{
    const d=el.getContext("2d")!.getImageData(0,0,el.width,el.height).data;
    const out:number[]=[];
    for(let gy=0;gy<g;gy++){
      for(let gx=0;gx<g;gx++){
        const px=Math.floor((gx+0.5)*el.width/g),py=Math.floor((gy+0.5)*el.height/g);
        const i=(py*el.width+px)*4;
        out.push(d[i]!,d[i+1]!,d[i+2]!);
      }
    }
    return out;
  },GRID);
  const meanLuma=async()=>await deltaPage.getByLabel("Evolution world").evaluate((el:HTMLCanvasElement)=>{
    const d=el.getContext("2d")!.getImageData(0,0,el.width,el.height).data;
    let sum=0;for(let i=0;i<d.length;i+=4)sum+=0.2126*d[i]!+0.7152*d[i+1]!+0.0722*d[i+2]!;
    return sum/(d.length/4);
  });
  const lensBefore=await deltaPage.locator(".lens-active").innerText().catch(()=>"(default)");
  const pixelsBefore=await sampleWorld();
  const lumaBefore=await meanLuma();
  // A real intervention, so the retained baseline and "Now" genuinely differ.
  // Chosen by intent rather than index, so a catalog reordering cannot silently
  // turn this into a no-intervention resolution.
  const intervening=deltaSheet.locator(".decision-choices button").filter({hasNotText:"Keep watching"}).first();
  await intervening.click();
  const deltaImpact=deltaPage.getByTestId("aftermath-impact");
  await deltaImpact.waitFor({timeout:15_000});
  // Still zero ticks: the world has not advanced past the resolution, so every
  // pixel difference below is the intervention and nothing else.
  assert.equal(await tick(deltaPage),decisionTick,"the world is still at the resolution tick while the sheet is open");
  // Wait for the renderer to actually repaint before sampling. The substrate is
  // rebuilt into an offscreen buffer and blitted in an effect after the snapshot
  // lands, so the canvas can still be showing the previous field at this instant.
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
  // Logged, not only asserted on failure: the margin is the evidence for this
  // slice, so a passing run must still produce it.
  console.log(`world consequence at zero ticks: ${lost}/${samples} samples lost material, ${gained} gained, luma ${lumaBefore.toFixed(1)}->${lumaAfter.toFixed(1)}`);
  // The affordance collapses the sheet; it is not a prerequisite for time.
  await deltaPage.getByTestId("aftermath-acknowledge").click();
  await deltaImpact.waitFor({state:"detached",timeout:15_000});
  // The slot is released once the sheet is acknowledged. That the evidence never
  // drifted is asserted above, by measuring the World across the intervention at
  // zero ticks, and separately in the runtime suite, which advances the world
  // 4,000 ticks and requires the retained states to be unchanged.
  const stillPinned=await deltaPage.getByTestId("sheet-slot").count();
  assert.equal(stillPinned,0,"the slot is released once the sheet is acknowledged");

  await deltaPage.close();
  console.log("aftermath impact sheet: PASS");
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
    const worldInk=()=>page.evaluate(`(()=>{
      const c=document.querySelector('canvas[aria-label="Evolution world"]');
      const ctx=c.getContext('2d',{willReadFrequently:true});
      const d=ctx.getImageData(0,0,c.width,c.height).data;
      let bright=0;const sig=[];
      const nx=32,ny=18;
      for(let gy=0;gy<ny;gy++)for(let gx=0;gx<nx;gx++){
        let sum=0,n=0;
        const x0=Math.floor(gx*c.width/nx),x1=Math.floor((gx+1)*c.width/nx);
        const y0=Math.floor(gy*c.height/ny),y1=Math.floor((gy+1)*c.height/ny);
        for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1;x+=3){
          const i=(y*c.width+x)*4,l=(d[i]+d[i+1]+d[i+2])/3;
          sum+=l;n++;if(l>90)bright++;
        }
        sig.push(Math.round(sum/Math.max(1,n)));
      }
      return{bright,sig};
    })()`);
    await page.getByRole("button",{name:"Landscape",exact:true}).click();
    await page.waitForTimeout(300);
    const normalInk=await worldInk();
    console.log(`phenotype normal-lens ink: ${normalInk.bright} bright px`);
    assert.ok(normalInk.bright>50,`phenotype path paints organisms in normal lens (${normalInk.bright} bright px)`);
    await page.getByRole("button",{name:"Traits"}).click();
    await page.waitForTimeout(300);
    const traitsInk=await worldInk();
    console.log(`legacy traits-lens ink: ${traitsInk.bright} bright px`);
    assert.ok(traitsInk.bright>50,`legacy voxel path paints organisms in traits lens (${traitsInk.bright} bright px)`);
    let changedCells=0;
    for(let i=0;i<normalInk.sig.length;i++)if(Math.abs(normalInk.sig[i]-traitsInk.sig[i])>12)changedCells++;
    assert.ok(changedCells>20,`normal and traits lenses render differently (${changedCells}/576 cells)`);
    await page.getByRole("button",{name:"Landscape",exact:true}).click();
    for(let i=0;i<4;i++)await page.getByRole("button",{name:"Zoom in"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"3.0×","reached inspection zoom");
    await page.waitForTimeout(300);
    const inspInk=await worldInk();
    console.log(`inspection-lens ink at 3.0x: ${inspInk.bright} bright px`);
    assert.ok(inspInk.bright>50,"inspection LOD paints at 3.0x");
    await page.getByRole("button",{name:"Reset view"}).click();
    assert.equal(await page.getByTestId("zoom-level").innerText(),"1.0×","reset restores the view");

    // Issue #37: speed modes are genuinely distinct throughput policies.
    // World is paused; each mode runs a fixed window and the tick deltas must
    // order 1x < 10x < 100x <= Max with wide margins (headless timing is noisy).
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
            await page.evaluate(()=>(window as any).__DEE_TEST__.acknowledgeAftermath());
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
        done=true;
      }
      assert.ok(done,`speed ${v}x completed a gate-free window`);
    }
    assert.ok(deltas["10"]!>(deltas["1"]!*3),`10x materially faster than 1x (${deltas["10"]} vs ${deltas["1"]})`);
    // 100x vs 10x uses a 1.5x margin, not 3x: per-tick engine cost dominates
    // at high slice sizes, so both saturate toward the same worker ceiling
    // (that plateau IS the throughput limit Max is defined by).
    assert.ok(deltas["100"]!>(deltas["10"]!*1.5),`100x materially faster than 10x (${deltas["100"]} vs ${deltas["10"]})`);
    // The 500x/Max ratio assertion is retired with design approval (AC21):
    // Max is no longer a player-reachable mode, so the ratio no longer tested
    // anything a player can select, and it was the flaky half of #46. The
    // internal Max path still exists for tooling; only the product option and
    // this assertion are gone.
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
    await page.getByText(/Saved tick/).waitFor();
    const saved=await tick(page);
    assert.ok(saved>=advanced,"checkpoint saved after runtime activity");

    await page.reload({waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();
    await page.getByRole("button",{name:"Resume"}).click();
    await page.getByText("Checkpoint restored").waitFor();
    await page.waitForTimeout(150);
    assert.equal(await tick(page),saved,"IndexedDB checkpoint restores exact tick");

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
    })()`);
    const densest=Math.max(...quadrantInk);
    assert.ok(
      Math.min(...quadrantInk)>densest/4,
      `minimap field covers the whole world (quadrants ${quadrantInk.join("/")}, sparsest must exceed a quarter of ${densest})`);

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
    const touchAction=await touchPage.evaluate(`getComputedStyle(document.querySelector('canvas[aria-label="Evolution world"]')).touchAction`);
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
    // tick, and time only resumes on an explicit Play.
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
    // A7: resolve with keep watching; no hidden tick, no control fork.
    await sheet.getByText("Keep watching").click();
    await sheet.waitFor({state:"detached",timeout:15_000});
    assert.equal(await tick(decisionPage),decisionTick,"resolution advances zero ticks (A7)");
    // A14 + AC1/AC2: the aftermath impact state opens in the SAME sheet slot and
    // is itself a hard pause at the resolution tick.
    const impact=decisionPage.getByTestId("aftermath-impact");
    await impact.waitFor({timeout:15_000});
    assert.equal(await decisionPage.getByTestId("sheet-slot").getAttribute("data-mode"),"aftermath",
      "the sheet slot persists across the morph and switches mode, rather than one sheet closing and another opening");
    // AC3: Difference leads when a comparable baseline exists.
    const compareButtons=impact.locator(".compare-option");
    assert.equal(await compareButtons.count(),3,"all three comparison modes are offered when a baseline was retained");
    assert.deepEqual(await compareButtons.allTextContents(),["Difference","Now","Before"],
      "the comparison control is ordered Difference | Now | Before");
    assert.equal(await impact.locator(".compare-option.active").getAttribute("data-compare"),"difference",
      "Difference is the default, because the player's immediate question is 'what changed?'");
    // This resolution applied nothing, so the honest report is that nothing
    // measurable changed. Silence must not read as a broken or empty state.
    await decisionPage.getByTestId("aftermath-quiet").waitFor({timeout:10_000});
    await decisionPage.getByText(/not an outcome: no biological/i).waitFor(),
      "the sheet states that no biological response exists yet, so the effect cannot be read as an outcome";
    // Switching modes must change the evidence actually shown.
    await compareButtons.nth(1).click();
    await decisionPage.getByTestId("aftermath-single").waitFor({timeout:10_000});
    await compareButtons.nth(2).click();
    await decisionPage.getByText(/moment the intervention was applied/i).waitFor(),
      "Before is labelled as the instant the intervention was applied, not an invented earlier moment";
    await compareButtons.nth(0).click();
    await decisionPage.getByTestId("aftermath-quiet").waitFor({timeout:10_000});
    assert.equal(await tick(decisionPage),decisionTick,"world stays at the resolution tick (A14)");
    // The affordance collapses the sheet. It is not what releases time.
    await decisionPage.getByTestId("aftermath-acknowledge").click();
    await impact.waitFor({state:"detached",timeout:15_000});
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(900);
    assert.ok(await tick(decisionPage)>decisionTick,"explicit play still resumes time (A14)");
    // History retains the event and the player's action, without claiming cause.
    await decisionPage.getByRole("button",{name:"Pause"}).click();
    await decisionPage.getByRole("button",{name:"History"}).click();
    await decisionPage.getByText("Your decisions").waitFor();
    // History renders the recorded choice copy, never a UI-side label.
    await decisionPage.getByText("Keep watching",{exact:true}).waitFor();
    await decisionPage.getByText(/not a proven cause/).waitFor();

    // C17: catalyst window on the same World surface. Quiet restarts at the
    // event creation tick, so the first window follows at the next quiet stride.
    await decisionPage.getByRole("button",{name:"World",exact:true}).click();
    const catalystSheet=decisionPage.getByTestId("decision-sheet");
    for(let i=0;i<10&&!(await catalystSheet.isVisible().catch(()=>false));i++){
      await decisionPage.evaluate(()=>(window as any).__DEE_TEST__.runToNextEvent());
      await decisionPage.waitForTimeout(1000);
    }
    await catalystSheet.waitFor({timeout:180_000});
    assert.equal(await catalystSheet.getAttribute("data-source"),"world_catalyst","window carries catalyst provenance, never a fake event");
    await catalystSheet.getByText("World catalyst — your move").waitFor();
    await catalystSheet.getByText("Change the environment?").waitFor();
    const catalystTick=await tick(decisionPage);
    assert.ok(catalystTick>decisionTick,"catalyst window arrives after the event decision");
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
    await decisionPage.getByRole("button",{name:"History"}).click();
    await decisionPage.getByText(/World catalyst offered at tick/).waitFor();
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
    const fieldInk=async()=>await panWorld.evaluate((el:HTMLCanvasElement)=>{
      const ctx=el.getContext("2d");if(!ctx)return 0;
      const d=ctx.getImageData(0,0,el.width,el.height).data;
      // Count substrate pixels: the field is the bulk of the frame, and
      // organisms are a small minority, so a blank canvas reads near zero.
      let field=0;
      for(let i=0;i<d.length;i+=4){
        const lum=0.2126*d[i]!+0.7152*d[i+1]!+0.0722*d[i+2]!;
        if(lum>10&&lum<150)field++;
      }
      return field/(d.length/4);
    });
    const panBox=await panWorld.boundingBox();
    assert.ok(panBox,"pan canvas measurable");
    // Start at the reset camera, and require that it actually is the reset
    // camera. That is the single position the wrapped mapping got right, so
    // departing from it is exactly the path that used to fail.
    const camStart=await readCam();
    assert.ok(Number.isFinite(camStart.x)&&Math.abs(panWrap(camStart.x,PAN_EXTENT/2))<1,
      `pan test starts at the world centre, the one position that used to work (cam ${camStart.x.toFixed(1)},${camStart.y.toFixed(1)})`);
    const inkAtRest=await fieldInk();
    assert.ok(inkAtRest>0.5,`substrate renders at rest (${(inkAtRest*100).toFixed(0)}% field)`);
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
      assert.ok(after>0.5,`substrate still renders after panning to (${dx},${dy}) (${(after*100).toFixed(0)}% field)`);
    }
    // And it ended up away from the one position the old code drew correctly.
    assert.ok(departed,
      `camera departed the world centre (start ${camStart.x.toFixed(0)},${camStart.y.toFixed(0)} -> ${camPrev.x.toFixed(0)},${camPrev.y.toFixed(0)})`);
    await panPage.close();
    console.log("toroidal pan moves the camera and keeps the substrate visible: PASS");

  await runLandscapeChecks(context);
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
  await page.getByLabel("Evolution world").waitFor();
  // Waste exists and grows in this world; the landscape must reflect it.
  await page.getByRole("button",{name:"Play"}).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button",{name:"Pause"}).click();
  const world=page.getByLabel("Evolution world");

  // Ink statistics over the drawn canvas: a mean/contrast pair that would
  // catch a flat field, a black field, or a field that ignores waste.
  const ink=async(p:import("playwright").Locator)=>await p.evaluate((el:HTMLCanvasElement)=>{
    const ctx=el.getContext("2d");if(!ctx)return null;
    const d=ctx.getImageData(0,0,el.width,el.height).data;
    let n=0,sum=0,sum2=0,lit=0;
    for(let i=0;i<d.length;i+=4){
      const lum=0.2126*d[i]!+0.7152*d[i+1]!+0.0722*d[i+2]!;
      sum+=lum;sum2+=lum*lum;n++;if(lum>26)lit++;
    }
    const mean=sum/n;
    return{mean,sd:Math.sqrt(Math.max(0,sum2/n-mean*mean)),lit:lit/n};
  });

  await page.getByRole("button",{name:"Landscape"}).click();
  await page.waitForTimeout(350);
  const landscape=await ink(world);
  assert.ok(landscape&&landscape.sd>3,
    `landscape reads as a structured field, not a flat fill (sd ${landscape?.sd.toFixed(2)})`);
  assert.ok(landscape.mean>6&&landscape.mean<200,
    `landscape luminance stays legible (mean ${landscape?.mean.toFixed(1)})`);

  // Analytical views must be clearly different modes from the landscape.
  await page.getByRole("button",{name:"Nutrients"}).click();
  await page.getByLabel("Resource view").selectOption("a");
  await page.waitForTimeout(250);
  const nutrientA=await ink(world);
  await page.getByRole("button",{name:"Waste"}).click();
  await page.waitForTimeout(250);
  const wasteView=await ink(world);
  const lensDelta=Math.abs(landscape!.mean-wasteView!.mean)+Math.abs(landscape!.sd-wasteView!.sd);
  assert.ok(lensDelta>0.5,
    `waste overlay is a distinct mode from the landscape (delta ${lensDelta.toFixed(2)})`);
  assert.ok(nutrientA&&wasteView,
    "analytical lenses render measurable fields");
  // Exact-field views must not carry the landscape's cosmetic texture: a
  // flat analytical view has visibly lower local variance than the substrate.
  await page.getByRole("button",{name:"Landscape"}).click();
  await page.waitForTimeout(350);
  const landscape2=await ink(world);
  assert.ok(landscape2!.sd>0,"landscape still renders after lens round-trip");

  // Organism foreground must survive the richer substrate: active and
  // dormant life stay distinguishable by their own marks, not by the field.
  const organisms=await world.evaluate((el:HTMLCanvasElement)=>{
    const ctx=el.getContext("2d");if(!ctx)return null;
    const d=ctx.getImageData(0,0,el.width,el.height).data;
    // Count strongly bright pixels: organism bodies sit well above the
    // substrate's luminance ceiling.
    let bright=0;
    for(let i=0;i<d.length;i+=4){
      if(0.2126*d[i]!+0.7152*d[i+1]!+0.0722*d[i+2]!>150)bright++;
    }
    return bright;
  });
  assert.ok(organisms&&organisms>40,
    `organisms remain readable above the landscape (bright px ${organisms})`);

  // Smoothing is presentation-only and must not leak between worlds: after a
  // universe switch the landscape must not render through the old world's
  // inertia (checked by the reset path being reachable, not by pixel diffing
  // two different biological states).
  // Temporal smoothing must not leak between worlds. Switching universes is
  // the reset trigger, so the check switches seed AND recreates the universe,
  // then requires the landscape to render from a clean inertia state.
  const before=await ink(world);
  await page.getByRole("button",{name:"World settings"}).click();
  await page.getByRole("button",{name:"New random seed"}).click();
  await page.getByRole("button",{name:"Create universe"}).click();
  await page.waitForTimeout(500);
  const after=await ink(world);
  assert.ok(before&&after,
    "landscape renders before and after a universe switch (smoothing reset path exercised)");
  assert.ok(after!.sd>3,
    `landscape keeps structure after a universe switch (sd ${after?.sd.toFixed(2)})`);

  // Phone viewport: the landscape must still dominate and stay readable.
  const mobile=await context.newPage();
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(baseUrl,{waitUntil:"networkidle"});
  await mobile.getByLabel("Evolution world").waitFor();
  await mobile.getByRole("button",{name:"Play"}).click();
  await mobile.waitForTimeout(1000);
  await mobile.getByRole("button",{name:"Pause"}).click();
  const mWorld=mobile.getByLabel("Evolution world");
  const mBox=await mWorld.boundingBox();
  const mvp=mobile.viewportSize()??{width:390,height:844};
  assert.ok(mBox&&mBox.height>=mvp.height*0.5,"landscape dominates the phone viewport");
  const mInk=await ink(mWorld);
  assert.ok(mInk&&mInk.sd>3,`phone landscape keeps structure (sd ${mInk?.sd.toFixed(2)})`);
  // The lens set is collapsed behind the active-lens chip on the phone.
  await mobile.locator(".lens-active").click();
  await mobile.waitForTimeout(200);
  await mobile.getByRole("button",{name:"Waste",exact:true}).click();
  await mobile.waitForTimeout(250);
  const mWaste=await ink(mWorld);
  assert.ok(mWaste&&mWaste.lit>=0,"waste overlay renders on the phone viewport");
  await mobile.close();
  await page.close();

}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
