import assert from "node:assert/strict";
import { chromium, type Locator, type Page } from "playwright";

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
    await page.goto(baseUrl,{waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();
    assert.equal(await tick(page),0,"fresh world starts at tick 0");

    await page.getByRole("button",{name:"Play"}).click();
    await page.waitForTimeout(900);
    await page.getByRole("button",{name:"Pause"}).click();
    const advanced=await tick(page);
    assert.ok(advanced>0,"worker-owned simulation advances");

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
    await page.getByRole("button",{name:"Normal"}).waitFor();
    await page.getByRole("button",{name:"Nutrients"}).click();
    await page.getByLabel("Resource view").selectOption("c");
    await page.getByRole("button",{name:"Traits"}).click();
    await page.getByLabel("Trait view").selectOption("byproductUse");

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
    const quadrantInk=await page.evaluate(`(()=>{
      const c=document.querySelector('canvas[aria-label="World minimap"]');
      const ctx=c.getContext('2d');
      const ink=(x,y,w,h)=>{const d=ctx.getImageData(x,y,w,h).data;let n=0;
        for(let i=0;i<d.length;i+=4){if(Math.abs(d[i]-6)+Math.abs(d[i+1]-18)+Math.abs(d[i+2]-26)>12)n++}
        return n;};
      const w=c.width,h=c.height,q=Math.floor(w*0.3);
      return[ink(0,0,q,q),ink(w-q,0,q,q),ink(0,h-q,q,q),ink(w-q,h-q,q,q)];
    })()`);
    assert.ok(Math.min(...quadrantInk)>400,`minimap field covers the whole world (quadrants ${quadrantInk.join("/")})`);

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
    await page.getByText(/Engine 0\.20\.0/).waitFor();
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
    await touchPage.getByText("Show details").waitFor();
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
    await decisionPage.goto(baseUrl,{waitUntil:"networkidle"});
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
      await decisionPage.getByRole("button",{name:"Next meaningful change"}).click();
      await decisionPage.waitForTimeout(1000);
    }
    await sheet.waitFor({timeout:180_000});
    await decisionPage.getByText("A decision is waiting").waitFor();
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
    // A14: world stays paused until an explicit resume.
    await decisionPage.waitForTimeout(600);
    assert.equal(await tick(decisionPage),decisionTick,"world stays paused after resolution (A14)");
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(900);
    assert.ok(await tick(decisionPage)>decisionTick,"explicit Play resumes time (A14)");
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
      await decisionPage.getByRole("button",{name:"Next meaningful change"}).click();
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
    await decisionPage.getByRole("button",{name:"Play"}).click();
    await decisionPage.waitForTimeout(900);
    assert.ok(await tick(decisionPage)>catalystTick,"explicit Play resumes after a catalyst choice");
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

    console.log("browser smoke: PASS");
  }finally{
    await browser.close();
  }
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
