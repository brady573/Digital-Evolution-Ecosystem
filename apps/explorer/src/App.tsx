import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineConfig, RenderOrganism, RenderSnapshot } from "@digital-evolution/contracts";
import { ENGINE_VERSION } from "@digital-evolution/sim-core";
import { WorkerRuntimeClient } from "@digital-evolution/sim-runtime";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { IndexedDbWorldRepository } from "./persistence";

type Surface="world"|"history"|"tree"|"experiments";
type Lens="normal"|"nutrients"|"clades"|"traits";
type ResourceView="combined"|"a"|"b"|"c";
type TraitView="speed"|"sensing"|"metabolism"|"reproduction"|"diet"|"habitat"|"byproductUse"|"dormancyResponse";

interface WorldSettings {
  seed:number;
  richness:number;
  separation:number;
  variety:number;
  population:number;
  variation:number;
  mutation:number;
  pressure:number;
}

const DEFAULT_SETTINGS:WorldSettings={
  seed:821947219,
  richness:.6,
  separation:.6,
  variety:1,
  population:30,
  variation:.35,
  mutation:.03,
  pressure:.45,
};

const TRAIT_RANGES:Record<TraitView,[number,number,string]>={
  speed:[.25,4,"Movement"],
  sensing:[10,180,"Nutrient sensing"],
  metabolism:[.04,.5,"Energy use"],
  reproduction:[55,220,"Reproduction energy"],
  diet:[-1.5,1.5,"Nutrient tendency"],
  habitat:[-1.5,1.5,"Home-zone preference"],
  byproductUse:[0,1.5,"Byproduct use"],
  dormancyResponse:[0,1.5,"Dormancy response"],
};

function configFromSettings(s:WorldSettings):EngineConfig{
  return{
    seed:s.seed>>>0,
    start:.25+s.richness*.55,
    prod:.08+s.richness*1.15,
    cap:360,
    pop:Math.max(1,Math.round(s.population)),
    div:s.variation,
    mr:s.mutation,
    ms:.12,
    press:.75+s.pressure*.75,
    patch:s.separation,
    resource_b_fraction:s.variety*.5,
    cat:"global",
    st:null,
    resource_model:"definition_driven_substances",
    resource_grid:60,
    enable_byproduct:true,
    enable_dormancy:true,
  };
}

function cladeColor(id:number){
  const hue=(id*137.508)%360;
  return `hsl(${hue} 58% 63%)`;
}
function traitColor(value:number,[lo,hi]:[number,number]){
  const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));
  const hue=210-170*t;
  return `hsl(${hue} 68% 62%)`;
}

function WorldCanvas({
  snapshot,lens,resourceView,traitView,selectedId,onSelect,
}:{
  snapshot:RenderSnapshot;lens:Lens;resourceView:ResourceView;traitView:TraitView;
  selectedId:number|null;onSelect:(id:number|null)=>void;
}){
  const ref=useRef<HTMLCanvasElement>(null);

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const w=canvas.width,h=canvas.height,n=snapshot.resources.gridSize,cell=w/n;
    ctx.clearRect(0,0,w,h);

    const stocks=snapshot.resources.stock,caps=snapshot.resources.capacity;
    const drawEnvironment=lens==="normal"||lens==="nutrients";
    if(drawEnvironment){
      for(let i=0;i<n*n;i++){
        const frac=(k:number)=>((caps[k]?.[i]||0)>0?(stocks[k]?.[i]||0)/(caps[k]?.[i]||1):0);
        const a=frac(0),b=frac(1),c=frac(2);
        let r=8,g=14,bl=16;
        if(lens==="normal"){r+=22*b+14*c;g+=26*a+12*c;bl+=20*b+24*c}
        else if(resourceView==="a"){r+=8*a;g+=150*a;bl+=72*a}
        else if(resourceView==="b"){r+=110*b;g+=55*b;bl+=155*b}
        else if(resourceView==="c"){r+=190*c;g+=115*c;bl+=35*c}
        else {r+=72*b+95*c;g+=105*a+55*c;bl+=92*b+35*c}
        ctx.fillStyle=`rgb(${Math.min(255,Math.round(r))},${Math.min(255,Math.round(g))},${Math.min(255,Math.round(bl))})`;
        ctx.fillRect((i%n)*cell,Math.floor(i/n)*cell,cell+1,cell+1);
      }
    }

    const traitRange=TRAIT_RANGES[traitView];
    for(const o of snapshot.organisms){
      const px=o.x/600*w,py=o.y/600*h;
      let color="#d8f0df";
      if(o.activity==="dormant")color="#7f9189";
      else if(lens==="clades")color=cladeColor(o.cladeId);
      else if(lens==="traits")color=traitColor(o[traitView] as number,[traitRange[0],traitRange[1]]);
      else if(o.byproductUse>.55)color="#e7b36a";
      else if(o.diet<-.25)color="#7bd3c4";
      else if(o.diet>.25)color="#b79de4";

      ctx.fillStyle=color;
      ctx.beginPath();
      if(o.diet<-.25){
        ctx.arc(px,py,o.activity==="dormant"?2.2:3.2,0,Math.PI*2);
      }else if(o.diet>.25){
        const s=o.activity==="dormant"?4:6;ctx.rect(px-s/2,py-s/2,s,s);
      }else{
        const s=o.activity==="dormant"?4:7;
        ctx.moveTo(px,py-s/2);ctx.lineTo(px+s/2,py+s/2);ctx.lineTo(px-s/2,py+s/2);ctx.closePath();
      }
      ctx.fill();

      if(o.id===selectedId){
        ctx.strokeStyle="#ffffff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px,py,7,0,Math.PI*2);ctx.stroke();
      }
    }
  },[snapshot,lens,resourceView,traitView,selectedId]);

  const click=(event:React.MouseEvent<HTMLCanvasElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width*600;
    const y=(event.clientY-rect.top)/rect.height*600;
    let best:RenderOrganism|null=null,bestD=18;
    for(const o of snapshot.organisms){
      const dx=Math.abs(o.x-x),dy=Math.abs(o.y-y);
      const tx=Math.min(dx,600-dx),ty=Math.min(dy,600-dy);
      const d=Math.hypot(tx,ty);
      if(d<bestD){bestD=d;best=o}
    }
    onSelect(best?.id??null);
  };

  return <canvas aria-label="Evolution world" className="world-canvas" ref={ref} width={720} height={720} onClick={click}/>;
}

function Slider({label,value,min,max,step,onChange}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void}){
  return <label className="slider"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}

export function App(){
  const runtime=useMemo(()=>new WorkerRuntimeClient(),[]);
  const repository=useMemo(()=>new IndexedDbWorldRepository(),[]);
  const [snapshot,setSnapshot]=useState<RenderSnapshot|null>(null);
  const [surface,setSurface]=useState<Surface>("world");
  const [running,setRunning]=useState(false);
  const [speed,setSpeed]=useState(100);
  const [status,setStatus]=useState("Creating universe…");
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
  const [lens,setLens]=useState<Lens>("normal");
  const [resourceView,setResourceView]=useState<ResourceView>("combined");
  const [traitView,setTraitView]=useState<TraitView>("speed");
  const [selectedId,setSelectedId]=useState<number|null>(null);
  // Backpressure: never queue an advance while the worker is still busy with
  // the previous one. Without this, high speeds pile up work faster than the
  // worker can drain it and the UI stalls instead of running fast.
  const advanceDebt=useRef(false);

  useEffect(()=>{
    const unsub=runtime.subscribe(s=>{advanceDebt.current=false;setSnapshot(s);setStatus("")});
    runtime.create(configFromSettings(DEFAULT_SETTINGS));
    return()=>{unsub();runtime.destroy()};
  },[runtime]);

  useEffect(()=>{
    if(!running)return;
    // Frame-paced loop (prototype-authentic feel): advance a speed-scaled
    // slice of ticks every animation frame and render each snapshot, so
    // ticks visibly count up and organisms glide instead of teleporting.
    // Backpressure keeps slow workers responsive: a new slice is only sent
    // once the previous snapshot has arrived.
    let raf=0;
    const frame=()=>{
      if(!advanceDebt.current){
        advanceDebt.current=true;
        runtime.advance(Math.max(1,Math.round(speed/60)));
      }
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);
    return()=>cancelAnimationFrame(raf);
  },[running,speed,runtime]);

  const newUniverse=()=>{
    setRunning(false);setSelectedId(null);runtime.create(configFromSettings(settings));setSettingsOpen(false);setStatus("New universe created");
  };
  const save=async()=>{
    setStatus("Saving exact checkpoint…");
    const checkpoint=await runtime.requestCheckpoint();
    const summary=await repository.save("current",checkpoint);
    setStatus(`Saved tick ${summary.tick.toLocaleString()}`);
  };
  const load=async()=>{
    const checkpoint=await repository.load("current");
    if(!checkpoint){setStatus("No saved universe found");return}
    setRunning(false);
    setStatus("Restoring checkpoint…");
    try{
      await runtime.loadCheckpoint(checkpoint);
      setStatus("Checkpoint restored");
    }catch(error){
      setStatus(`Restore failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  const exportEvidence=async()=>{
    const data=await runtime.requestExport();
    const text=JSON.stringify(data,null,2);
    const filename=`ecosystem-v029-tick-${snapshot?.tick??0}.json`;
    setStatus("Preparing evidence export…");
    try{
      // Blob-anchor downloads do not work inside the native WebView, so on
      // Android the export is staged to a real file and handed to the OS
      // share sheet instead. Browsers keep the direct download path.
      if(Capacitor.isNativePlatform()){
        const saved=await Filesystem.writeFile({path:filename,data:text,directory:Directory.Cache,encoding:Encoding.UTF8});
        try{
          await Share.share({title:"Ecosystem evidence export",text:`Digital Evolution evidence export, tick ${snapshot?.tick??0}`,files:[saved.uri],dialogTitle:"Share evidence export"});
          setStatus(`Export shared (tick ${(snapshot?.tick??0).toLocaleString()})`);
        }finally{
          await Filesystem.deleteFile({path:filename,directory:Directory.Cache}).catch(()=>{});
        }
        return;
      }
    }catch(error){
      setStatus(`Export failed: ${error instanceof Error?error.message:String(error)}`);
      return;
    }
    const blob=new Blob([text],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filename}`);
  };

  if(!snapshot)return <main className="loading">{status}</main>;
  const m=snapshot.metrics;
  const records=(snapshot.analysis.records as any[])||[];
  const clades=m.clades?.top||[];
  const selected=snapshot.organisms.find(o=>o.id===selectedId)??null;
  const accounting=m.nutrient_field?.accounting?.absolute_residual??[];

  return <div className="app-shell">
    <header className="topbar">
      <div className="hud-cell brand-cell"><span className="eyebrow">Living Evolution Explorer</span><strong className="world-name">Digital Evolution Ecosystem</strong></div>
      <div className="hud"><div className="hud-cell"><span className="hud-label">Tick</span><span className="hud-value" data-testid="tick">{snapshot.tick.toLocaleString()}</span></div><div className="hud-cell"><span className="hud-label">Living</span><span className="hud-value">{snapshot.population}</span></div><div className="hud-cell"><span className="hud-label">Dormant</span><span className="hud-value">{snapshot.dormantPopulation}</span></div><button className="hud-settings" onClick={()=>setSettingsOpen(true)}>World settings</button></div>
    </header>

    <nav className="rail" aria-label="Primary">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active":""} onClick={()=>setSurface(s)}><span className="nav-ico" aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span className="nav-label">{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <main className="surface">
      <section className="world-column" aria-label="Living world">
        <div className="lensbar">
          {(["normal","nutrients","clades","traits"] as Lens[]).map(v=><button key={v} className={lens===v?"active":""} onClick={()=>setLens(v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>)}
          {lens==="nutrients"&&<select aria-label="Resource view" value={resourceView} onChange={e=>setResourceView(e.target.value as ResourceView)}><option value="combined">Combined</option><option value="a">Nutrient A</option><option value="b">Nutrient B</option><option value="c">Metabolite C</option></select>}
          {lens==="traits"&&<select aria-label="Trait view" value={traitView} onChange={e=>setTraitView(e.target.value as TraitView)}>{Object.entries(TRAIT_RANGES).map(([key,[,,label]])=><option key={key} value={key}>{label}</option>)}</select>}
        </div>
        <div className="world-wrap">
          <div className="world-scene" aria-hidden="true"><div className="nutrient-cloud nc-a"/><div className="nutrient-cloud nc-b"/><div className="nutrient-cloud nc-c"/><div className="biofilm"/></div>
          <WorldCanvas snapshot={snapshot} lens={lens} resourceView={resourceView} traitView={traitView} selectedId={selectedId} onSelect={setSelectedId}/>
        </div>
      </section>
      <aside className="investigation-rail" aria-label="Investigation">
        {surface==="world"&&<div className="inspector">
          {selected?<><span className="eyebrow">Selected organism</span><h2>#{selected.id}</h2><p>{selected.activity} · generation {selected.generation}</p><dl>
            <div><dt>Clade</dt><dd>L-{String(selected.cladeId).padStart(4,"0")}</dd></div>
            <div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div>
            <div><dt>Movement</dt><dd>{selected.speed.toFixed(2)}</dd></div>
            <div><dt>Sensing</dt><dd>{selected.sensing.toFixed(1)}</dd></div>
            <div><dt>Byproduct use</dt><dd>{selected.byproductUse.toFixed(2)}</dd></div>
            <div><dt>Dormancy response</dt><dd>{selected.dormancyResponse.toFixed(2)}</dd></div>
          </dl><button onClick={()=>setSelectedId(null)}>Clear selection</button></>:<>
            <span className="eyebrow">World now</span><h2>{m.ecological_outcome}</h2><p>{m.population} living · peak {m.peak_population}</p><dl>
              <div><dt>Active</dt><dd>{snapshot.activePopulation}</dd></div>
              <div><dt>Dormant</dt><dd>{snapshot.dormantPopulation}</dd></div>
              <div><dt>Effective niches</dt><dd>{Number(m.effective_niches||0).toFixed(2)}</dd></div>
              <div><dt>Metabolite C</dt><dd>{((m.metabolite_c?.fraction||0)*100).toFixed(0)}%</dd></div>
              <div><dt>Cross-feeders</dt><dd>{((m.metabolic_roles?.crossfeeder_fraction||0)*100).toFixed(0)}%</dd></div>
            </dl>
          </>}
        </div>}

        {surface==="history"&&<section className="panel">
        <div className="panel-head"><div><span className="eyebrow">What happened here?</span><h2>History</h2></div><span>{records.length} durable ecological records</span></div>
        {records.length===0?<><p>No durable ecological arc has been established yet.</p><h3>Recent simulation events</h3>{snapshot.events.slice(-8).reverse().map((e,i)=><article key={`${e.tick}-${i}`}><span>Tick {e.tick.toLocaleString()}</span><p>{e.label}</p></article>)}</>:records.slice().reverse().map((r:any)=><article key={r.id}><span>Tick {r.tick.toLocaleString()} · {r.phase}</span><h3>{r.title}</h3><p>{r.summary}</p></article>)}
      </section>}

      {surface==="tree"&&<section className="panel">
        <div className="panel-head"><div><span className="eyebrow">Evolutionary branches</span><h2>Tree</h2></div><span>{m.clades?.active??0} active clades</span></div>
        <p>{m.clades?.definition}</p>
        <div className="cards">{clades.map((c:any)=><article key={c.id} style={{borderTopColor:cladeColor(c.id)}}><h3>L-{String(c.id).padStart(4,"0")}</h3><p>{c.count} living · {(c.share*100).toFixed(0)}%</p><small>{(c.mutations||[]).join(" + ")||"founder ancestry"} · age {Number(c.age||0).toLocaleString()} ticks</small></article>)}</div>
      </section>}

      {surface==="experiments"&&<section className="panel">
        <span className="eyebrow">What if this world changed?</span><h2>Experiments</h2>
        {snapshot.control?<div className="compare"><div><strong>Experiment</strong><span>{snapshot.population} living</span><span>{m.ecological_outcome}</span></div><div><strong>Untouched twin</strong><span>{snapshot.control.population} living</span><span>{snapshot.control.metrics.ecological_outcome}</span></div></div>:<p>No matched control exists yet. Applying an intervention creates an exact twin first.</p>}
        <div className="actions"><button onClick={()=>runtime.intervene("global")}>Global nutrient crash</button><button onClick={()=>runtime.intervene("droughtA")}>Nutrient A drought</button><button onClick={()=>runtime.intervene("droughtB")}>Nutrient B drought</button></div>
      </section>}
      </aside>
    </main>

    <nav className="mobile-nav" aria-label="Mobile navigation">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active mnav-btn":"mnav-btn"} onClick={()=>setSurface(s)}><span aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span>{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <footer className="controls">
      <button onClick={()=>setRunning(v=>!v)}>{running?"Pause":"Play"}</button>
      <select aria-label="Simulation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={100}>100×</option><option value={500}>Max</option></select>
      <button onClick={()=>{setRunning(false);runtime.runToNextEvent()}}>Next meaningful change</button>
      <button onClick={save}>Save</button>
      <button onClick={load}>Resume</button>
      <button onClick={exportEvidence}>Export</button>
      <span className="status">{status}</span>
    </footer>

    {settingsOpen&&<div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="World settings">
      <div className="panel-head"><div><span className="eyebrow">Create / inspect</span><h2>World settings</h2></div><button onClick={()=>setSettingsOpen(false)}>Close</button></div>
      <label className="seed"><span>World seed</span><input value={settings.seed} type="number" onChange={e=>setSettings(v=>({...v,seed:Number(e.target.value)}))}/></label>
      <Slider label="Nutrient supply" value={settings.richness} min={0} max={1} step={.01} onChange={v=>setSettings(s=>({...s,richness:v}))}/>
      <Slider label="Nutrient-zone separation" value={settings.separation} min={0} max={1} step={.01} onChange={v=>setSettings(s=>({...s,separation:v}))}/>
      <Slider label="Nutrient variety" value={settings.variety} min={0} max={1} step={.01} onChange={v=>setSettings(s=>({...s,variety:v}))}/>
      <Slider label="Founding population" value={settings.population} min={5} max={120} step={1} onChange={v=>setSettings(s=>({...s,population:v}))}/>
      <Slider label="Starting differences" value={settings.variation} min={0} max={1} step={.01} onChange={v=>setSettings(s=>({...s,variation:v}))}/>
      <Slider label="Mutation chance" value={settings.mutation} min={0} max={.15} step={.005} onChange={v=>setSettings(s=>({...s,mutation:v}))}/>
      <Slider label="Survival pressure" value={settings.pressure} min={0} max={1} step={.01} onChange={v=>setSettings(s=>({...s,pressure:v}))}/>
      <div className="actions"><button className="primary" onClick={newUniverse}>Create universe</button><button onClick={()=>setDiagnosticsOpen(v=>!v)}>Developer diagnostics</button></div>
      {diagnosticsOpen&&<div className="diagnostics">
        <strong>Engine {ENGINE_VERSION}</strong>
        <span>Resource accounting residuals: {accounting.length?accounting.map((v:number)=>Number(v).toExponential(2)).join(" / "):"—"}</span>
        <span>Analysis records: {records.length}</span>
        <span>Biology target population rule: none</span>
      </div>}
    </section></div>}
  </div>;
}
