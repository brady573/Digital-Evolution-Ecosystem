import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ENGINE_VERSION } from "../../packages/sim-core/src/index.ts";
import {
  WORLD_VISUAL_CAPTURE_CASES,
  WORLD_VISUAL_CHROME_CAPTURE_CASES,
  WORLD_VISUAL_BASELINE,
  WORLD_VISUAL_NATURAL_CAPTURE_ID,
  createWorldVisualFixtures,
} from "./world-visual-fixtures.ts";

/**
 * Issue #30 Slice 2 visual evidence: deterministic captures of the ordinary
 * ecological landscape and the analytical views, at representative zooms and
 * viewports, on a fixed seed.
 *
 * Statistical presented-frame checks (see tools/validation/browser-smoke.ts and
 * tools/validation/landscape.ts) can prove the landscape is structured, that
 * lenses differ, and that organisms stay readable. They cannot answer
 * whether the ordinary view *reads as an ecological landscape*. These
 * captures are that evidence.
 *
 * Usage:  pnpm --filter @digital-evolution/explorer exec vite preview --port 4173
 *         pnpm test:visual
 * Writes PNGs to testdata/visual/. Manual evidence run, not part of
 * `pnpm verify` (it needs a running preview server and a browser).
 */

const baseUrl=process.env.DEE_BASE_URL||"http://127.0.0.1:4173";
const OUT_DIR="testdata/visual";
const SEED=24681357; // a world that accumulates Metabolic Waste
const REPO_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const VISUAL_PROOF_URL="http://127.0.0.1:5196/";

async function startVisualProofServer():Promise<ChildProcess>{
  const server=spawn("pnpm",[
    "--filter","@digital-evolution/explorer","exec","vite","--config","../../tools/world-visual-proof/vite.config.mjs",
    "--host","127.0.0.1","--port","5196","--strictPort",
  ],{cwd:REPO_ROOT,stdio:"ignore"});
  const deadline=Date.now()+30_000;
  while(Date.now()<deadline){
    if(server.exitCode!==null)throw new Error(`World visual fixture server exited with ${server.exitCode}`);
    try{const response=await fetch(VISUAL_PROOF_URL);if(response.ok)return server;}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  server.kill("SIGTERM");
  throw new Error("World visual fixture server did not become ready within 30 seconds");
}

async function main(){
  mkdirSync(OUT_DIR,{recursive:true});
  const browser=await chromium.launch({headless:true});
  let proofServer:ChildProcess|null=null;
  const written:string[]=[];
  try{
    proofServer=await startVisualProofServer();
    const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
    const page=await context.newPage();
    // deeTest provides the runtime fixture hook only; production Pixi remains
    // the semantic World renderer on this URL as well.
    await page.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();
    const productionWorld=page.locator(".world-pixi-host");
    await productionWorld.locator("canvas").waitFor();
    if(await productionWorld.count()!==1||await page.locator("canvas.world-canvas").count()!==0)
      throw new Error("production visual capture requires one Pixi World and no semantic Canvas World");

    // A fixed Patchwork world (the Slice 2 calibration config) on a fixed
    // seed, advanced until Metabolic Waste is measurably present, so the
    // capture shows organism-created modification rather than an early world.
    await page.getByRole("button",{name:"World settings"}).click();
    await page.getByRole("button",{name:"Patchwork"}).click();
    await page.getByLabel("World seed").fill(String(SEED));
    await page.getByRole("button",{name:"Create universe"}).click();
    await page.waitForTimeout(600);
    // Max speed: the capture needs a world that has actually been modified
    // by its organisms, not a young one. At the top bounded speed the UI
    // re-renders continuously, so the run toggle is driven through the DOM
    // (Playwright's actionability check would never settle) and progress is read
    // from the tick readout rather than from button labels. AC21: Max is no
    // longer a product option, so captures use 100x.
    await page.getByLabel("Simulation speed").selectOption("100");
    const pressRun=async(on:boolean)=>await page.evaluate((want:boolean)=>{
      const btn=[...document.querySelectorAll("button")]
        .find(b=>b.textContent?.trim()===(want?"Play":"Pause")) as HTMLButtonElement|undefined;
      if(btn&&!btn.disabled)btn.click();
      return!!btn;
    },on);
    const readTick=async()=>Number((await page.getByTestId("tick").innerText()).replace(/[^0-9]/g,""));

    const world=page.getByLabel("Evolution world");
    // The lens set is collapsed behind the active-lens chip, so drive it
    // through the same disclosure the player uses.
    const pickLens=async(lens:string)=>{
      const first=page.locator(".lens-options button").first();
      if(!await first.isVisible().catch(()=>false)){
        await page.locator(".lens-active").click();
        await page.waitForTimeout(200);
      }
      await page.getByRole("button",{name:lens,exact:true}).click();
      await page.waitForTimeout(250);
    };
    // The authoritative read model establishes actual waste load; the
    // presented-frame screenshot independently proves that Waste and normal
    // World render as distinct visible modes.
    const wasteCapacityFraction=async()=>await page.evaluate(()=>{
        const waste=(window as any).__DEE_TEST__.readWorldState().environment.waste;
        let stock=0,capacity=0;
        for(let i=0;i<waste.stock.length;i++){
          stock+=waste.stock[i]??0;capacity+=waste.capacity[i]??0;
        }
        return capacity>0?stock/capacity:0;
      });

    // Pending decisions hard-pause the simulation, so a capture run that
    // ignores them would stall at the first event. Resolve with the first
    // offered choice: the capture is about environment and rendering, and
    // this keeps the world moving without steering its biology.
    const settleDecision=async()=>{
      const sheet=page.getByTestId("decision-sheet");
      if(await sheet.count()){
        const choice=sheet.locator("button").first();
        if(await choice.count()){await choice.click().catch(()=>{});await page.waitForTimeout(250);}
        return true;
      }
      return false;
    };
    // The last pause can race with an event becoming pending. That decision
    // removes the World overlay (including zoom controls) by design. Drain any
    // such gate and give its presentation update a moment to settle before
    // running captures which use those controls.
    const settlePendingDecision=async()=>{
      for(let attempt=0;attempt<5;attempt++){
        if(await settleDecision())continue;
        await page.waitForTimeout(150);
        if(!await page.getByTestId("decision-sheet").count())return;
      }
      throw new Error("Could not clear pending decision before landscape captures");
    };

    await pressRun(true);
    let load=0;
    // Phase 1: run until the world is genuinely waste-modified. A young world
    // would make the "waste-modified" capture a lie.
    for(let i=0;i<40&&load<0.10;i++){
      await page.waitForTimeout(4000);
      if(await settleDecision())continue;
      await pressRun(false);
      await page.waitForTimeout(350);
      await pickLens("Waste");
      await page.waitForTimeout(120);
      load=await wasteCapacityFraction();
      if(load<0.10)await pressRun(true);
    }
    console.log(`waste coverage ${(load*100).toFixed(1)}% at tick ${await readTick()}`);

    const compareFrame=async()=>{
      await pickLens("Landscape");
      const landscape=(await world.screenshot()).toString("base64");
      await pickLens("Waste");
      const waste=(await world.screenshot()).toString("base64");
      const signatures=await page.evaluate<{normal:number[];waste:number[]}>(`(async()=>{
        const {landscape,waste}=${JSON.stringify({landscape,waste})};
        const decode=encoded=>new Promise((resolve,reject)=>{
          const image=new Image();image.onerror=()=>reject(new Error("Could not decode presented World"));
          image.onload=()=>{
            const canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
            const ctx=canvas.getContext("2d");if(!ctx){reject(new Error("Screenshot analysis canvas unavailable"));return;}
            ctx.drawImage(image,0,0);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
            const out=[],n=32;
            for(let y=0;y<n;y++)for(let x=0;x<n;x++){
              const i=(Math.floor((y+.5)*canvas.height/n)*canvas.width+Math.floor((x+.5)*canvas.width/n))*4;
              out.push(data[i],data[i+1],data[i+2]);
            }
            resolve(out);
          };
          image.src="data:image/png;base64,"+encoded;
        });
        return {normal:await decode(landscape),waste:await decode(waste)};
      })()`);
      return signatures;
    };
    const presentedModes=await compareFrame();
    const visibleWasteDifference=presentedModes.normal.reduce((n,value,i)=>n+(value!==presentedModes.waste[i]?1:0),0);
    if(!(load>0))throw new Error("authoritative environment contains no measurable waste for the production capture");
    if(visibleWasteDifference===0)
      throw new Error("presented production Pixi Waste lens did not differ from Landscape");

    // No phase 2: deliberately NOT searching for a niche record. The
    // establishment point (~tick 63k on this calibration) sits outside a
    // bounded interactive run, and manufacturing a screenshot by burning
    // simulation time would be the wrong trade. Deterministic establishment
    // evidence lives in the engine/analysis validation and the retained
    // survey; the history surface's semantic rendering (record fields and
    // the causal caveat) is covered by the analysis suite, not by a picture.
    const shot=async(name:string,target:import("playwright").Locator=world)=>{
      const file=`${OUT_DIR}/${name}.png`;
      await target.screenshot({path:file});
      written.push(name);
      console.log(`captured ${name}`);
    };

    // 1. Landscape, desktop, default zoom, whole world.
    await pickLens("Landscape");
    await page.waitForTimeout(400);
    await shot("01-landscape-desktop-default-zoom");

    // 2. Waste-modified detail: a centre crop of the SAME state, so the
    // organism-created degradation is legible at pixel scale rather than
    // averaged away across the whole world.
    const crop=await world.boundingBox();
    if(crop){
      const side=Math.round(Math.min(crop.width,crop.height)*0.55);
      await shot("02-landscape-waste-modified",world);
      await writeFileSync(`${OUT_DIR}/02-landscape-waste-modified.png`,
        await page.screenshot({
          path:`${OUT_DIR}/02-landscape-waste-modified.png`,
          clip:{
            x:Math.round(crop.x+(crop.width-side)/2),
            y:Math.round(crop.y+(crop.height-side)/2),
            width:side,height:side,
          },
        }) as unknown as Uint8Array);
      console.log("captured 02 (centre crop)");
    }

    // 3. Closer zoom: substrate texture and organisms.
    await settlePendingDecision();
    await page.getByRole("button",{name:"Zoom in"}).click();
    await page.getByRole("button",{name:"Zoom in"}).click();
    await page.waitForTimeout(500);
    await shot("03-landscape-close-zoom");
    await page.getByRole("button",{name:"Reset view"}).click();
    await page.waitForTimeout(300);

    // 4. Waste analytical overlay of the same state.
    await pickLens("Waste");
    await shot("04-waste-overlay");

    // 5. Nutrient analytical overlay for comparison.
    await pickLens("Nutrients");
    await page.getByLabel("Resource view").selectOption("a");
    await page.waitForTimeout(500);
    await shot("05-nutrient-a-overlay");

    // 6. Selected organism, landscape lens, so the focus marker and
    //    readability against the substrate are visible.
    await pickLens("Landscape");
    const box=await world.boundingBox();
    if(box){
      // Click a few points until an organism is selected; the read-only
      // selection is driven by the same hit path a user would use.
      for(const [fx,fy] of [[.5,.5],[.42,.55],[.58,.46],[.5,.62],[.35,.5]]){
        await page.mouse.click(box.x+box.width*fx,box.y+box.height*fy);
        await page.waitForTimeout(150);
        if(await page.getByText("Selected organism").count())break;
      }
    }
    await page.waitForTimeout(300);
    await shot("06-landscape-selected-organism");

    // 7. History surface, visited for completeness. The niche record itself
    // is NOT chased: establishment sits around tick 63k, outside a bounded
    // interactive run, and manufacturing a screenshot by burning simulation
    // time would be the wrong trade.
    await page.getByRole("button",{name:"History"}).click();
    await page.getByRole("heading",{name:"History"}).waitFor();
    await page.waitForTimeout(300);
    await shot("07-history-surface",page.locator(".surface"));

    // 8. Phone viewport, landscape and waste lens.
    const mobile=await context.newPage();
    await mobile.setViewportSize({width:390,height:844});
    await mobile.goto(baseUrl,{waitUntil:"networkidle"});
    await mobile.getByLabel("Evolution world").waitFor();
    await page.evaluate((want:boolean)=>{
      const btn=[...document.querySelectorAll("button")]
        .find(b=>b.textContent?.trim()===(want?"Play":"Pause")) as HTMLButtonElement|undefined;
      if(btn&&!btn.disabled)btn.click();
    },true);
    await mobile.waitForTimeout(6000);
    await page.evaluate((want:boolean)=>{
      const btn=[...document.querySelectorAll("button")]
        .find(b=>b.textContent?.trim()===(want?"Play":"Pause")) as HTMLButtonElement|undefined;
      if(btn&&!btn.disabled)btn.click();
    },false);
    await mobile.waitForTimeout(500);
    await shot("08-phone-landscape",mobile.getByLabel("Evolution world"));
    await mobile.locator(".lens-active").click();
    await mobile.waitForTimeout(200);
    await mobile.getByRole("button",{name:"Waste",exact:true}).click();
    await mobile.waitForTimeout(500);
    await shot("09-phone-waste-overlay",mobile.getByLabel("Evolution world"));
    await mobile.close();

    // 10. Lane A phone interaction shell: full-viewport frames at the widths
    //     the acceptance criteria name, plus the pending-decision case. These
    //     are viewport captures (not canvas crops) because the subject here is
    //     the control shell and its relationship to the world.
    const shell=async(name:string,page:import("playwright").Page,label:string)=>{
      await page.screenshot({path:`${OUT_DIR}/${name}.png`});
      written.push(name);
      console.log(`captured ${label}`);
    };
    for(const [label,size] of Object.entries({
      "320":{width:320,height:844},
      "390":{width:390,height:844},
      "820":{width:820,height:1024},
      "1280":{width:1280,height:900},
    })){
      const shellPage=await context.newPage();
      await shellPage.setViewportSize(size);
      await shellPage.goto(baseUrl,{waitUntil:"networkidle"});
      await shellPage.getByLabel("Evolution world").waitFor();
      await shellPage.getByRole("button",{name:"Play"}).click().catch(()=>{});
      await shellPage.waitForTimeout(1500);
      await shellPage.getByRole("button",{name:"Pause"}).click().catch(()=>{});
      await shellPage.waitForTimeout(400);
      await shell(`10-shell-${label}px`,shellPage,`phone shell @${label}px`);
      await shellPage.close();
    }
    // Secondary selector association.
    const selectorPage=await context.newPage();
    await selectorPage.setViewportSize({width:390,height:844});
    await selectorPage.goto(baseUrl,{waitUntil:"networkidle"});
    await selectorPage.getByLabel("Evolution world").waitFor();
    await selectorPage.locator(".lens-active").click();
    await selectorPage.waitForTimeout(200);
    await selectorPage.getByRole("button",{name:"Nutrients",exact:true}).click();
    await selectorPage.waitForTimeout(400);
    await shell("11-shell-390px-nutrients-selector",selectorPage,"phone shell with Nutrients selector");
    await selectorPage.close();
    // Pending decision on a phone viewport.
    const decisionShell=await context.newPage();
    await decisionShell.setViewportSize({width:390,height:844});
    await decisionShell.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await decisionShell.getByLabel("Evolution world").waitFor();
    await decisionShell.getByRole("button",{name:"World settings"}).click();
    await decisionShell.getByLabel("World seed").fill(String(SEED));
    await decisionShell.getByRole("button",{name:"Create universe"}).click();
    await decisionShell.getByRole("dialog",{name:"World settings"}).waitFor({state:"detached"});
    for(let i=0;i<25&&!(await decisionShell.getByTestId("decision-sheet").count());i++){
      // AC21: no such product control; the suite uses the URL-gated test hook.
      await decisionShell.evaluate(() => (window as any).__DEE_TEST__.runToNextEvent());
      await decisionShell.waitForTimeout(500);
    }
    if(await decisionShell.getByTestId("decision-sheet").count()){
      await shell("12-shell-390px-pending-decision",decisionShell,"phone shell with pending decision");
      for(const width of [320,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(200);
        await shell(`12-shell-${width}px-pending-decision`,decisionShell,`pending decision @${width}px`);
      }
      await decisionShell.setViewportSize({width:390,height:844});
      const action=decisionShell.getByTestId("decision-sheet").locator(".decision-choices button").filter({hasNotText:"Keep watching"}).first();
      await action.click();
      await decisionShell.getByTestId("aftermath-impact").waitFor({timeout:15_000});
      for(const width of [320,390,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(250);
        await shell(`13-aftermath-impact-${width}px`,decisionShell,`Aftermath impact @${width}px`);
      }
      await decisionShell.setViewportSize({width:390,height:844});
      await decisionShell.getByTestId("aftermath-acknowledge").click();
      await decisionShell.getByTestId("aftermath-compact").waitFor({timeout:15_000});
      for(const width of [320,390,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(250);
        await shell(`14-aftermath-compact-${width}px`,decisionShell,`compact Aftermath observation @${width}px`);
      }
      await decisionShell.setViewportSize({width:390,height:844});
      await decisionShell.getByTestId("aftermath-compact").click();
      await decisionShell.getByTestId("aftermath-stage2").waitFor();
      for(const width of [320,390,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(250);
        await shell(`15-aftermath-observation-${width}px`,decisionShell,`expanded observation @${width}px`);
      }
      await decisionShell.setViewportSize({width:390,height:844});
      await decisionShell.getByRole("button",{name:"Collapse"}).click();
      await decisionShell.evaluate(()=> (window as any).__DEE_TEST__.setAftermathFixture("development"));
      await decisionShell.getByTestId("aftermath-compact").click();
      await decisionShell.getByTestId("aftermath-stage2").waitFor();
      await decisionShell.getByText("TEST FIXTURE — synthetic presentation only; not a world finding.").waitFor();
      for(const width of [320,390,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(250);
        await shell(`16-aftermath-development-fixture-${width}px`,decisionShell,`labeled development fixture @${width}px`);
      }
      await decisionShell.setViewportSize({width:390,height:844});
      await decisionShell.getByRole("button",{name:"Collapse"}).click();
      await decisionShell.evaluate(()=> (window as any).__DEE_TEST__.setAftermathFixture("settlement"));
      await decisionShell.getByTestId("aftermath-compact").getByText(/settled/).waitFor();
      await decisionShell.getByTestId("aftermath-compact").click();
      await decisionShell.getByTestId("aftermath-settlement").waitFor();
      for(const width of [320,390,430,1280]){
        await decisionShell.setViewportSize({width,height:width===1280?900:844});
        await decisionShell.waitForTimeout(250);
        await shell(`17-aftermath-settlement-fixture-${width}px`,decisionShell,`labeled quiet-settlement fixture @${width}px`);
      }
      await decisionShell.evaluate(()=> (window as any).__DEE_TEST__.setAftermathFixture(null));
      await decisionShell.getByRole("button",{name:"Collapse"}).click();
    }else{
      console.log("no pending decision reached on this run; decision shell capture skipped");
    }
    await decisionShell.close();

    // Deterministic renderer fixtures: same presentation-only props at each
    // capture head, rendered by the production WorldPixi component.
    const proofContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
    const proofPage=await proofContext.newPage();
    await proofPage.goto(VISUAL_PROOF_URL,{waitUntil:"networkidle"});
    const proofWorld=proofPage.locator(".world-pixi-host");
    await proofWorld.locator("canvas").waitFor({timeout:30_000});
    await proofPage.waitForFunction(()=>
      (document.querySelector(".world-pixi-host")?.getAttribute("data-renderer-backend")??"").startsWith("WebGLRenderer/"),
      undefined,{timeout:30_000});
    const visualFixtures=createWorldVisualFixtures();
    if(visualFixtures.families.length!==6||visualFixtures.sparse.organisms.length>=visualFixtures.dense.organisms.length)
      throw new Error("World visual fixture contract is incomplete");
    for(const captureCase of WORLD_VISUAL_CAPTURE_CASES){
      const viewport=captureCase.viewport==="desktop"?{width:1280,height:900}:{width:390,height:844};
      await proofPage.setViewportSize(viewport);
      const proofWorldElement=proofPage.locator(".proof-world");
      if(captureCase.viewport==="phone-stage"){
        await proofWorldElement.evaluate((element:HTMLElement)=>{
          element.style.width="100vw";
          element.style.height="calc(100dvh - 160px)";
        });
      }else{
        await proofWorldElement.evaluate((element:HTMLElement)=>{
          element.style.removeProperty("width");
          element.style.removeProperty("height");
        });
      }
      await proofPage.evaluate(({scene,environment})=>{
        const fixtureApi=(window as any).__DEE_WORLD_VISUAL__;
        fixtureApi.setScene(scene);fixtureApi.setEnvironment(environment);
      },{scene:captureCase.scene,environment:captureCase.environment});
      await proofPage.evaluate((zoom)=>{
        const world=(window as any).__DEE_WORLD_VISUAL__;
        world.setZoom(zoom);
      },captureCase.zoom);
      await proofPage.waitForTimeout(180);
      const name=`18-lane2-${captureCase.id}`;
      await proofWorld.screenshot({path:`${OUT_DIR}/${name}.png`});
      written.push(name);
      console.log(`captured deterministic Pixi fixture ${captureCase.id}`);
    }
    await proofContext.close();

    // Actual App screenshots establish phone DOM chrome composition. The
    // simulation is paused at its deterministic initial seed/state.
    const chromePage=await context.newPage();
    await chromePage.setViewportSize({width:390,height:844});
    await chromePage.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await chromePage.getByLabel("Evolution world").waitFor();
    await chromePage.locator(".world-pixi-host canvas").waitFor();
    await chromePage.waitForTimeout(300);
    for(const captureCase of WORLD_VISUAL_CHROME_CAPTURE_CASES.filter((item)=>item.viewport.width===390)){
      await chromePage.setViewportSize(captureCase.viewport);
      const optionsVisible=await chromePage.locator(".lens-options button").first().isVisible().catch(()=>false);
      if(captureCase.lens==="expanded"&&!optionsVisible)await chromePage.locator(".lens-active").click();
      if(captureCase.lens==="collapsed"&&optionsVisible)await chromePage.locator(".lens-active").click();
      await chromePage.waitForTimeout(100);
      await chromePage.screenshot({path:`${OUT_DIR}/${captureCase.id}.png`});
      written.push(captureCase.id);
    }
    // Return to the mobile breakpoint and collapse before the desktop sanity
    // frame, where the active-lens chip itself is hidden by design.
    await chromePage.locator(".lens-active").click();
    const desktopShell=WORLD_VISUAL_CHROME_CAPTURE_CASES.find((item)=>item.viewport.width===1280)!;
    await chromePage.setViewportSize(desktopShell.viewport);
    await chromePage.waitForTimeout(150);
    await chromePage.screenshot({path:`${OUT_DIR}/${desktopShell.id}.png`});
    written.push(desktopShell.id);
    await chromePage.close();

    // A supplementary natural-running frame is intentionally not fixture
    // input: it shows the actual default-seed simulation evolving on a phone.
    const naturalContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
    const naturalPage=await naturalContext.newPage();
    await naturalPage.goto(`${baseUrl}?deeTest=1`,{waitUntil:"networkidle"});
    await naturalPage.getByLabel("Evolution world").waitFor();
    await naturalPage.locator(".world-pixi-host canvas").waitFor();
    await naturalPage.getByRole("button",{name:"Play"}).click();
    await naturalPage.waitForFunction(()=>
      Number(document.querySelector('[data-testid="tick"]')?.textContent?.replaceAll(",","")??0)>0,
      undefined,{timeout:30_000});
    const naturalTick=Number((await naturalPage.getByTestId("tick").innerText()).replaceAll(",",""));
    if(await naturalPage.getByRole("button",{name:"Pause"}).count()!==1)
      throw new Error("natural phone frame must show the real simulation running");
    const naturalFramePath=`${OUT_DIR}/${WORLD_VISUAL_NATURAL_CAPTURE_ID}.png`;
    await naturalPage.screenshot({path:naturalFramePath});
    written.push(WORLD_VISUAL_NATURAL_CAPTURE_ID);
    await naturalContext.close();

    const requiredWorldFrames=[
      ...WORLD_VISUAL_CAPTURE_CASES.map((captureCase)=>`18-lane2-${captureCase.id}`),
      ...WORLD_VISUAL_CHROME_CAPTURE_CASES.map((captureCase)=>captureCase.id),
      WORLD_VISUAL_NATURAL_CAPTURE_ID,
    ];
    const missingWorldFrames=requiredWorldFrames.filter((name)=>!written.includes(name));
    if(missingWorldFrames.length>0)
      throw new Error(`World visual review set is incomplete: ${missingWorldFrames.join(", ")}`);

    writeFileSync(`${OUT_DIR}/MANIFEST.json`,JSON.stringify({
      seed:SEED,engine:ENGINE_VERSION,preset:"Patchwork",
      captureTick:await readTick().catch(()=>null),
      meanWasteCapacityFraction:+load.toFixed(4),
      presentedWasteLandscapeDifferingChannels:visibleWasteDifference,
      presentedPixelSource:"Playwright Chromium element screenshots of production WorldPixi host",
      captures:written,
      visualReviewSet:{
        captureMode:"paired-deterministic-presented-frames",
        baselineReferenceSha:WORLD_VISUAL_BASELINE.referenceSha,
        baselineCaptureSha:WORLD_VISUAL_BASELINE.captureSha,
        baselineRunId:WORLD_VISUAL_BASELINE.runId,
        baselineArtifact:WORLD_VISUAL_BASELINE.artifact,
        captureCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:REPO_ROOT,encoding:"utf8"}).trim(),
        browser:"Playwright Chromium",
        deviceScaleFactor:1,
        ecosystemZoom:1,
        fixtures:WORLD_VISUAL_CAPTURE_CASES,
        familyFixtures:visualFixtures.families.map((fixture)=>fixture.family),
        allActiveFamilyFixture:{capture:"18-lane2-phone-six-families-active-1x",families:visualFixtures.familiesActive.map((fixture)=>fixture.family),activity:"all-active"},
        activityFixture:{active:1,dormant:1},
        phoneStageCaptures:WORLD_VISUAL_CAPTURE_CASES.filter((captureCase)=>captureCase.viewport==="phone-stage").map((captureCase)=>({id:captureCase.id,host:{width:390,height:684},zoom:1,deviceScaleFactor:1})),
        sceneCounts:{sparse:visualFixtures.sparse.organisms.length,dense:visualFixtures.dense.organisms.length},
        chromeCaptures:WORLD_VISUAL_CHROME_CAPTURE_CASES.map((captureCase)=>captureCase.id),
        chromeCaptureCases:WORLD_VISUAL_CHROME_CAPTURE_CASES,
        naturalRunningWorld:{id:WORLD_VISUAL_NATURAL_CAPTURE_ID,seed:821947219,tick:naturalTick,viewport:{width:390,height:844},deviceScaleFactor:1,simulationState:"running",captureMode:"natural-live-world-not-synthetic-fixture"},
        syntheticFixtureNotice:"Renderer fixtures are deterministic presentation-only inputs, not simulation findings.",
      },
      nicheHistoryCapture:"omitted by decision: establishment occurs around tick 63k, outside a bounded interactive run. Deterministic establishment evidence lives in the engine/analysis validation and testdata/niche-survey-0.22.json; the history surface's record fields and causal caveat are covered there, not by a screenshot.",
      aftermathDevelopmentCapture:"captures are labeled deeTest-only synthetic presentation fixtures, not production findings; current contracts expose no stable identity link from a later ecological History record to this Aftermath.",
      aftermathSettlementCapture:"capture is a labeled deeTest presentation fixture with a synthetic horizon projection, not evidence that a live simulation reached 25,000 ticks; the real boundary is covered by deterministic projection tests.",
      note:"Captures of the production Pixi World and Aftermath impact/observation states. Regenerate with pnpm test:visual against a preview server. meanWasteCapacityFraction is read from the authoritative environment frame; presentedWasteLandscapeDifferingChannels compares Chromium-presented World screenshots and is not a biological measurement.",
    },null,2)+"\n");
  }finally{
    await browser.close();
    proofServer?.kill("SIGTERM");
  }
  console.log(`visual captures: ${written.length} written to ${OUT_DIR}`);
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
