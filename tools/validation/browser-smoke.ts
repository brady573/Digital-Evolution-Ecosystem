import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

const baseUrl=process.env.DEE_BASE_URL||"http://127.0.0.1:4173";

async function tick(page:Page){
  const text=await page.getByTestId("tick").innerText();
  return Number(text.replace(/[^0-9]/g,""));
}

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
  await page.getByRole("button",{name:"Experiments"}).click();
  await page.getByRole("heading",{name:"Experiments"}).waitFor();

  await page.getByRole("button",{name:"Global nutrient crash"}).click();
  await page.getByText("Untouched twin").waitFor();

  await page.getByRole("button",{name:"World"}).click();
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

  await page.getByRole("button",{name:"World settings"}).click();
  await page.getByRole("dialog",{name:"World settings"}).waitFor();
  await page.getByRole("button",{name:"Developer diagnostics"}).click();
  await page.getByText(/Engine 0\.19\.0/).waitFor();
  await page.getByRole("button",{name:"Close"}).click();

  const mobile=await context.newPage();
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(baseUrl,{waitUntil:"networkidle"});
  await mobile.getByLabel("Evolution world").waitFor();
  await mobile.getByRole("button",{name:"History"}).click();
  await mobile.getByRole("heading",{name:"History"}).waitFor();

  console.log("browser smoke: PASS");
}finally{
  await browser.close();
}
