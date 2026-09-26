import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Issue #30 Slice 2 visual evidence: deterministic captures of the ordinary
 * ecological landscape and the analytical views, at representative zooms and
 * viewports, on a fixed seed.
 *
 * Statistical canvas checks (see tools/validation/browser-smoke.ts and
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

async function main(){
  mkdirSync(OUT_DIR,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const written:string[]=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
    const page=await context.newPage();
    await page.goto(baseUrl,{waitUntil:"networkidle"});
    await page.getByLabel("Evolution world").waitFor();

    // A fixed Patchwork world (the Slice 2 calibration config) on a fixed
    // seed, advanced until Metabolic Waste is measurably present, so the
    // capture shows organism-created modification rather than an early world.
    await page.getByRole("button",{name:"World settings"}).click();
    await page.getByRole("button",{name:"Patchwork"}).click();
    await page.getByLabel("World seed").fill(String(SEED));
    await page.getByRole("button",{name:"Create universe"}).click();
    await page.waitForTimeout(600);
    // Max speed: the capture needs a world that has actually been modified
    // by its organisms, not a young one. At max speed the UI re-renders
    // continuously, so the run toggle is driven through the DOM (Playwright's
    // actionability check would never settle) and progress is read from the
    // tick readout rather than from button labels.
    await page.getByLabel("Simulation speed").selectOption("500");
    const pressRun=async(on:boolean)=>await page.evaluate((want:boolean)=>{
      const btn=[...document.querySelectorAll("button")]
        .find(b=>b.textContent?.trim()===(want?"Play":"Pause")) as HTMLButtonElement|undefined;
      if(btn&&!btn.disabled)btn.click();
      return!!btn;
    },on);
    const readTick=async()=>Number((await page.getByTestId("tick").innerText()).replace(/[^0-9]/g,""));

    const world=page.getByLabel("Evolution world");
    // Waste load measured from the canvas, so "waste-modified" is a verified
    // claim rather than a hopeful label.
    const wasteInk=async()=>{
      await page.getByRole("button",{name:"Waste"}).click();
      await page.waitForTimeout(320);
      return await world.evaluate((el:HTMLCanvasElement)=>{
        const ctx=el.getContext("2d");if(!ctx)return 0;
        const d=ctx.getImageData(0,0,el.width,el.height).data;
        let lit=0;
        for(let i=0;i<d.length;i+=4){
          // Waste overlay ramps a lifted dark base up to a bright load, so
          // "lit" means meaningfully above the empty-cell floor.
          if(d[i]!>96)lit++;
        }
        return lit/(d.length/4);
      });
    };

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

    await pressRun(true);
    let load=0;
    // Phase 1: run until the world is genuinely waste-modified. A young world
    // would make the "waste-modified" capture a lie.
    for(let i=0;i<40&&load<0.10;i++){
      await page.waitForTimeout(4000);
      if(await settleDecision())continue;
      await pressRun(false);
      await page.waitForTimeout(350);
      load=await wasteInk();
      if(load<0.10)await pressRun(true);
    }
    console.log(`waste coverage ${(load*100).toFixed(1)}% at tick ${await readTick()}`);

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
    await page.getByRole("button",{name:"Landscape"}).click();
    await page.waitForTimeout(500);
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
    await page.getByRole("button",{name:"Zoom in"}).click();
    await page.getByRole("button",{name:"Zoom in"}).click();
    await page.waitForTimeout(500);
    await shot("03-landscape-close-zoom");
    await page.getByRole("button",{name:"Reset view"}).click();
    await page.waitForTimeout(300);

    // 4. Waste analytical overlay of the same state.
    await page.getByRole("button",{name:"Waste"}).click();
    await page.waitForTimeout(500);
    await shot("04-waste-overlay");

    // 5. Nutrient analytical overlay for comparison.
    await page.getByRole("button",{name:"Nutrients"}).click();
    await page.getByLabel("Resource view").selectOption("a");
    await page.waitForTimeout(500);
    await shot("05-nutrient-a-overlay");

    // 6. Selected organism, landscape lens, so the focus marker and
    //    readability against the substrate are visible.
    await page.getByRole("button",{name:"Landscape"}).click();
    await page.waitForTimeout(400);
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
    await mobile.getByRole("button",{name:"Waste"}).click();
    await mobile.waitForTimeout(500);
    await shot("09-phone-waste-overlay",mobile.getByLabel("Evolution world"));
    await mobile.close();

    writeFileSync(`${OUT_DIR}/MANIFEST.json`,JSON.stringify({
      seed:SEED,engine:"0.22.0",preset:"Patchwork",
      captureTick:await readTick().catch(()=>null),
      wasteCellCoverage:+(load*100).toFixed(2),
      captures:written,
      nicheHistoryCapture:"omitted by decision: establishment occurs around tick 63k, outside a bounded interactive run. Deterministic establishment evidence lives in the engine/analysis validation and testdata/niche-survey-0.22.json; the history surface's record fields and causal caveat are covered there, not by a screenshot.",
      note:"Deterministic captures of the Slice 2 ecological landscape. Regenerate with pnpm test:visual against a preview server. wasteCellCoverage is the measured share of world cells whose waste overlay is lit, so 'waste-modified' is a measured claim rather than a label.",
    },null,2)+"\n");
  }finally{
    await browser.close();
  }
  console.log(`visual captures: ${written.length} written to ${OUT_DIR}`);
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
