import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineConfig, RenderSnapshot } from "@digital-evolution/contracts";
import { WorkerRuntimeClient } from "@digital-evolution/sim-runtime";
import { IndexedDbWorldRepository } from "./persistence";

const DEFAULT_CONFIG:EngineConfig={
  seed:821947219,
  start:.58,
  prod:.77,
  cap:360,
  pop:30,
  div:.35,
  mr:.03,
  ms:.12,
  press:1.0875,
  patch:.6,
  resource_b_fraction:.5,
  cat:"global",
  st:null,
  resource_model:"definition_driven_substances",
  resource_grid:60,
  enable_byproduct:true,
  enable_dormancy:true,
};

type Surface="world"|"history"|"tree"|"experiments";

function WorldCanvas({snapshot}:{snapshot:RenderSnapshot}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const w=canvas.width,h=canvas.height,n=snapshot.resources.gridSize,cell=w/n;
    ctx.fillStyle="#07110f";ctx.fillRect(0,0,w,h);
    const [a,b,c]=snapshot.resources.stock,cap=snapshot.resources.capacity;
    for(let i=0;i<n*n;i++){
      const x=(i%n)*cell,y=Math.floor(i/n)*cell;
      const af=(cap[0]?.[i]||0)>0?(a?.[i]||0)/(cap[0]?.[i]||1):0;
      const bf=(cap[1]?.[i]||0)>0?(b?.[i]||0)/(cap[1]?.[i]||1):0;
      const cf=(cap[2]?.[i]||0)>0?(c?.[i]||0)/(cap[2]?.[i]||1):0;
      const r=Math.round(9+55*bf+45*cf),g=Math.round(16+72*af+42*cf),bl=Math.round(18+52*bf+80*cf);
      ctx.fillStyle=`rgb(${r},${g},${bl})`;ctx.fillRect(x,y,cell+1,cell+1);
    }
    for(const o of snapshot.organisms){
      ctx.beginPath();
      ctx.arc(o.x/600*w,o.y/600*h,o.activity==="dormant"?2.2:3,0,Math.PI*2);
      ctx.fillStyle=o.activity==="dormant"?"#98a49e":o.byproductUse>.55?"#e7b36a":"#d8f0df";
      ctx.fill();
    }
  },[snapshot]);
  return <canvas className="world-canvas" ref={ref} width={720} height={720}/>;
}

export function App(){
  const runtime=useMemo(()=>new WorkerRuntimeClient(),[]);
  const repository=useMemo(()=>new IndexedDbWorldRepository(),[]);
  const [snapshot,setSnapshot]=useState<RenderSnapshot|null>(null);
  const [surface,setSurface]=useState<Surface>("world");
  const [running,setRunning]=useState(false);
  const [speed,setSpeed]=useState(100);
  const [status,setStatus]=useState("Creating universe…");

  useEffect(()=>{
    const unsub=runtime.subscribe(s=>{setSnapshot(s);setStatus("")});
    runtime.create(DEFAULT_CONFIG);
    return()=>{unsub();runtime.destroy()};
  },[runtime]);

  useEffect(()=>{
    if(!running)return;
    const id=window.setInterval(()=>runtime.advance(speed),40);
    return()=>window.clearInterval(id);
  },[running,speed,runtime]);

  const save=async()=>{
    setStatus("Saving exact checkpoint…");
    const checkpoint=await runtime.requestCheckpoint();
    const summary=await repository.save("current",checkpoint);
    setStatus(`Saved tick ${summary.tick.toLocaleString()}`);
  };

  const load=async()=>{
    const checkpoint=await repository.load("current");
    if(!checkpoint){setStatus("No saved universe found");return}
    runtime.loadCheckpoint(checkpoint);setStatus("Checkpoint restored");
  };

  const exportEvidence=async()=>{
    const data=await runtime.requestExport();
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`ecosystem-v029-tick-${snapshot?.tick??0}.json`;a.click();
    URL.revokeObjectURL(url);
  };

  if(!snapshot)return <main className="loading">{status}</main>;
  const m=snapshot.metrics;
  const records=(snapshot.analysis.records as any[])||[];
  const clades=m.clades?.top||[];

  return <div className="app-shell">
    <header className="topbar">
      <div><span className="eyebrow">Living Evolution Explorer</span><strong>Digital Evolution Ecosystem</strong></div>
      <div className="hud"><span>Tick {snapshot.tick.toLocaleString()}</span><span>{snapshot.population} living</span><span>{snapshot.dormantPopulation} dormant</span></div>
    </header>

    <nav className="rail">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active":""} onClick={()=>setSurface(s)}>{s[0].toUpperCase()+s.slice(1)}</button>)}
    </nav>

    <main className="surface">
      {surface==="world"&&<section className="world-layout">
        <WorldCanvas snapshot={snapshot}/>
        <aside className="inspector">
          <h2>World</h2>
          <p>{m.ecological_outcome}</p>
          <dl>
            <div><dt>Active</dt><dd>{snapshot.activePopulation}</dd></div>
            <div><dt>Dormant</dt><dd>{snapshot.dormantPopulation}</dd></div>
            <div><dt>Effective niches</dt><dd>{Number(m.effective_niches||0).toFixed(2)}</dd></div>
            <div><dt>Metabolite C</dt><dd>{((m.metabolite_c?.fraction||0)*100).toFixed(0)}%</dd></div>
            <div><dt>Cross-feeders</dt><dd>{((m.metabolic_roles?.crossfeeder_fraction||0)*100).toFixed(0)}%</dd></div>
          </dl>
        </aside>
      </section>}

      {surface==="history"&&<section className="panel">
        <h2>History</h2>
        {records.length===0?<p>No durable ecological arc has been established yet.</p>:records.slice().reverse().map((r:any)=><article key={r.id}><span>Tick {r.tick.toLocaleString()}</span><h3>{r.title}</h3><p>{r.summary}</p></article>)}
      </section>}

      {surface==="tree"&&<section className="panel">
        <h2>Tree</h2>
        <p>{m.clades?.definition}</p>
        <div className="cards">{clades.map((c:any)=><article key={c.id}><h3>L-{String(c.id).padStart(4,"0")}</h3><p>{c.count} living · {(c.share*100).toFixed(0)}%</p><small>{(c.mutations||[]).join(" + ")||"founder ancestry"}</small></article>)}</div>
      </section>}

      {surface==="experiments"&&<section className="panel">
        <h2>Experiments</h2>
        {snapshot.control?<div className="compare"><div><strong>Experiment</strong><span>{snapshot.population} living</span><span>{m.ecological_outcome}</span></div><div><strong>Untouched twin</strong><span>{snapshot.control.population} living</span><span>{snapshot.control.metrics.ecological_outcome}</span></div></div>:<p>No matched control exists yet. Applying an intervention creates an exact twin first.</p>}
        <div className="actions"><button onClick={()=>runtime.intervene("global")}>Global nutrient crash</button><button onClick={()=>runtime.intervene("droughtA")}>Nutrient A drought</button><button onClick={()=>runtime.intervene("droughtB")}>Nutrient B drought</button></div>
      </section>}
    </main>

    <footer className="controls">
      <button onClick={()=>setRunning(v=>!v)}>{running?"Pause":"Play"}</button>
      <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={100}>100×</option><option value={500}>Max</option></select>
      <button onClick={()=>runtime.advance(251)}>Next observation</button>
      <button onClick={save}>Save</button>
      <button onClick={load}>Resume</button>
      <button onClick={exportEvidence}>Export</button>
      <span className="status">{status}</span>
    </footer>
  </div>;
}
