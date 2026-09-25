import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineConfig, RenderOrganism, RenderSnapshot } from "@digital-evolution/contracts";
import { ENGINE_VERSION } from "@digital-evolution/sim-core";
import { WorkerRuntimeClient } from "@digital-evolution/sim-runtime";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { IndexedDbWorldRepository } from "./persistence";
import { formatTickAge, formatYear, glossOutcome } from "./language";

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

// Named world archetypes (M4 Phase A). Values are the v0.28.2 prototype
// preset sliders verbatim; the engine mapping is unchanged.
const PRESETS:Record<string,{settings:Omit<WorldSettings,"seed">,note:string}>={
  Balanced:{settings:{richness:.6,separation:.6,variety:1,population:30,variation:.35,mutation:.03,pressure:.45},note:"Balanced starts with a small founder population and a nutrient field that can support expansion, overshoot, stability, or decline."},
  Patchwork:{settings:{richness:.68,separation:.9,variety:1,population:34,variation:.45,mutation:.03,pressure:.42},note:"Patchwork starts below its potential scale and strongly separates nutrient zones, giving divergent clades room to expand into different niches."},
  Harsh:{settings:{richness:.38,separation:.55,variety:.8,population:30,variation:.35,mutation:.04,pressure:.78},note:"Harsh starts small with slower recovery and high survival pressure; growth is possible, but collapse or extinction remains a natural outcome."},
  Abundant:{settings:{richness:3.2,separation:.6,variety:1,population:30,variation:.35,mutation:.03,pressure:.45},note:"Abundant turns nutrient production far beyond balanced levels to sustain thousands of living organisms; built for large populations and deep-time runs."},
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

// M4A: the UI must distinguish the running universe from settings staged for
// the next one. `activeSettings` is the recipe of the live world; `settings`
// is what Create universe will use. These helpers map between the two so a
// resumed checkpoint can be shown (and re-staged) faithfully.
function settingsEqual(a:WorldSettings,b:WorldSettings,tol=1e-6){
  return a.seed===b.seed&&a.population===b.population
    &&Math.abs(a.richness-b.richness)<tol&&Math.abs(a.separation-b.separation)<tol
    &&Math.abs(a.variety-b.variety)<tol&&Math.abs(a.variation-b.variation)<tol
    &&Math.abs(a.mutation-b.mutation)<tol&&Math.abs(a.pressure-b.pressure)<tol;
}
function presetForSettings(s:WorldSettings):string{
  for(const [name,p] of Object.entries(PRESETS)){
    if(settingsEqual(s,{...s,...p.settings}))return name;
  }
  return "Custom";
}
// Invert configFromSettings for the fields we expose. Rounding snaps to the
// slider step so a staged recipe round-trips through the pre-existing mapping.
function settingsFromConfig(c:EngineConfig|undefined|null):WorldSettings{
  const step=(v:number,unit=100)=>Math.round(v*unit)/unit;
  const clamped=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
  return{
    seed:(c?.seed??DEFAULT_SETTINGS.seed)>>>0,
    richness:clamped(step(((c?.prod??0)-.08)/1.15),0,4),
    separation:clamped(step(c?.patch??.6),0,1),
    variety:clamped(step((c?.resource_b_fraction??.5)/.5),0,1),
    population:clamped(Math.round(c?.pop??30),1,120),
    variation:clamped(c?.div??.35,0,1),
    mutation:clamped(step(c?.mr??.03,200),0,.15),
    pressure:clamped(step(((c?.press??1.0875)-.75)/.75),0,1),
  };
}

// The simulated field is a 600x600 torus (engine constant, unchanged). On a
// portrait phone we cannot show a square world without letterboxing or
// distortion, so the phone shows a uniform-zoom *window* into that same
// toroidal world: wrap-aware panning, honest density (no tiling), and a
// minimap of the whole field. Presentation only; the simulation is untouched.
const WORLD_EXTENT=600;
const ZOOM_MIN=1,ZOOM_MAX=3;
type Camera={x:number;y:number};
// Shortest toroidal delta from a to b. Correct for any separation, not just
// one period: normalizing the camera during pan keeps this well-conditioned,
// and the modulo keeps it correct regardless.
const wrapDelta=(a:number,b:number)=>{let d=(a-b)%WORLD_EXTENT;if(d>WORLD_EXTENT/2)d-=WORLD_EXTENT;else if(d<-WORLD_EXTENT/2)d+=WORLD_EXTENT;return d};
const wrapCoord=(v:number)=>((v%WORLD_EXTENT)+WORLD_EXTENT)%WORLD_EXTENT;

function cladeColor(id:number){  const hue=(id*137.508)%360;
  return `hsl(${hue} 58% 63%)`;
}
function traitColor(value:number,[lo,hi]:[number,number]){
  const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));
  const hue=210-170*t;
  return `hsl(${hue} 68% 62%)`;
}

function WorldCanvas({
  snapshot,lens,resourceView,traitView,selectedId,onSelect,cam,zoom,onCamera,onView,
}:{
  snapshot:RenderSnapshot;lens:Lens;resourceView:ResourceView;traitView:TraitView;
  selectedId:number|null;onSelect:(id:number|null)=>void;
  cam:Camera;zoom:number;onCamera:(c:Camera)=>void;onView:(u:{w:number;h:number})=>void;
}){
  const ref=useRef<HTMLCanvasElement>(null);
  // Backing store follows the displayed size so the world fills its stage on
  // any viewport. The sim mapping stays resolution-independent; only the
  // presentation transform changes.
  const [size,setSize]=useState<[number,number]>([720,720]);
  useEffect(()=>{
    const canvas=ref.current,host=canvas?.parentElement;if(!canvas||!host)return;
    const ro=new ResizeObserver(entries=>{
      const r=entries[0]?.contentRect;if(!r)return;
      const w=Math.max(160,Math.min(1400,Math.round(r.width)));
      const h=Math.max(160,Math.min(1400,Math.round(r.height)));
      setSize(([pw,ph])=>pw===w&&ph===h?[pw,ph]:[w,h]);
    });
    ro.observe(host);
    return()=>ro.disconnect();
  },[]);

  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const w=canvas.width,h=canvas.height,n=snapshot.resources.gridSize;
    // Uniform scale, never a stretch. Portrait stages fit by height so the
    // world fills the frame; the zoomed-out baseline on wide stages still
    // shows the whole 600x600 field.
    const fit=h>w?h/WORLD_EXTENT:Math.min(w,h)/WORLD_EXTENT;
    const s=fit*zoom;
    const toX=(wx:number)=>w/2+wrapDelta(wx,cam.x)*s;
    const toY=(wy:number)=>h/2+wrapDelta(wy,cam.y)*s;
    const cell=(WORLD_EXTENT/n)*s;
    ctx.clearRect(0,0,w,h);
    // Report the visible window (in world units) so the minimap can mark it.
    onView({w:w/s,h:h/s});

    const stocks=snapshot.resources.stock,caps=snapshot.resources.capacity;
    const drawEnvironment=lens==="normal"||lens==="nutrients";
    if(drawEnvironment){
      for(let i=0;i<n*n;i++){
        const px=toX((i%n+.5)*(WORLD_EXTENT/n)),py=toY((Math.floor(i/n)+.5)*(WORLD_EXTENT/n));
        if(px<-cell||py<-cell||px>w+cell||py>h+cell)continue;
        const frac=(k:number)=>((caps[k]?.[i]||0)>0?(stocks[k]?.[i]||0)/(caps[k]?.[i]||1):0);
        const a=frac(0),b=frac(1),c=frac(2);
        let r=8,g=14,bl=16;
        if(lens==="normal"){r+=22*b+14*c;g+=26*a+12*c;bl+=20*b+24*c}
        else if(resourceView==="a"){r+=8*a;g+=150*a;bl+=72*a}
        else if(resourceView==="b"){r+=110*b;g+=55*b;bl+=155*b}
        else if(resourceView==="c"){r+=190*c;g+=115*c;bl+=35*c}
        else {r+=72*b+95*c;g+=105*a+55*c;bl+=92*b+35*c}
        ctx.fillStyle=`rgb(${Math.min(255,Math.round(r))},${Math.min(255,Math.round(g))},${Math.min(255,Math.round(bl))})`;
        ctx.fillRect(px-cell/2,py-cell/2,cell+1,cell+1);
      }
    }

    const traitRange=TRAIT_RANGES[traitView];
    for(const o of snapshot.organisms){
      const px=toX(o.x),py=toY(o.y);
      if(px<-24||py<-24||px>w+24||py>h+24)continue;
      let color="#d8f0df";
      if(o.activity==="dormant")color="#7f9189";
      else if(lens==="clades")color=cladeColor(o.cladeId);
      else if(lens==="traits")color=traitColor(o[traitView] as number,[traitRange[0],traitRange[1]]);
      else if(o.byproductUse>.55)color="#e7b36a";
      else if(o.diet<-.25)color="#7bd3c4";
      else if(o.diet>.25)color="#b79de4";

      // Voxel sprite: chunky pixel cluster whose size follows stored energy,
      // texture is a deterministic function of organism id (stable per frame),
      // and density follows diet family. Positions are untouched, so
      // click-selection mapping is unchanged.
      const unit=Math.max(2,s*2.2);
      const energyClass=o.activity==="dormant"?0:(o.energy>120?2:o.energy>60?1:0);
      const span=2+energyClass;
      let hsh=Math.imul(o.id,2654435761)^0x9e3779b9;hsh^=hsh>>>15;hsh=Math.imul(hsh,0x85ebca6b)>>>0;
      const dormant=o.activity==="dormant";
      ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.globalAlpha=dormant?0.55:1;
      for(let gy=0;gy<span;gy++)for(let gx=0;gx<span;gx++){
        const edge=gx===0||gy===0||gx===span-1||gy===span-1;
        let solid=true;
        if(edge){
          if(o.diet<-.25)solid=((hsh>>((gy*span+gx)%24))&1)===1;
          else if(o.diet>.25)solid=true;
          else solid=((gx*7+gy*13+(hsh&3))&3)!==0;
        }
        if(!solid)continue;
        const bx=px+(gx-span/2)*unit,by=py+(gy-span/2)*unit;
        if(dormant)ctx.strokeRect(bx,by,unit,unit);else ctx.fillRect(bx,by,unit,unit);
      }
      ctx.globalAlpha=1;

      if(o.id===selectedId){
        // Luminous focus marker: soft halo + double ring + diagonal ticks.
        // The surrounding ecosystem stays fully visible (A6).
        const halo=ctx.createRadialGradient(px,py,2,px,py,15);
        halo.addColorStop(0,"rgba(235,255,255,.55)");
        halo.addColorStop(.4,"rgba(120,240,255,.22)");
        halo.addColorStop(1,"rgba(120,240,255,0)");
        ctx.fillStyle=halo;ctx.beginPath();ctx.arc(px,py,15,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle="#eaffff";ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(px,py,7,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle="#7fe9ff";ctx.lineWidth=1;ctx.beginPath();ctx.arc(px,py,9.5,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle="rgba(170,245,255,.95)";ctx.lineWidth=1.2;
        for(let k=0;k<4;k++){const ang=k*Math.PI/2+Math.PI/4;
          ctx.beginPath();
          ctx.moveTo(px+Math.cos(ang)*11.5,py+Math.sin(ang)*11.5);
          ctx.lineTo(px+Math.cos(ang)*14,py+Math.sin(ang)*14);
          ctx.stroke();
        }
        ctx.lineWidth=1;
      }
    }
  },[snapshot,lens,resourceView,traitView,selectedId,size,cam,zoom,onView]);

  // Screen-space helpers for pointer input (CSS pixels, not backing store).
  const viewOf=(canvas:HTMLCanvasElement)=>{
    const rect=canvas.getBoundingClientRect();
    const fit=rect.height>rect.width?rect.height/WORLD_EXTENT:Math.min(rect.width,rect.height)/WORLD_EXTENT;
    return{rect,s:fit*zoom};
  };
  const selectAt=(clientX:number,clientY:number,canvas:HTMLCanvasElement)=>{
    const {rect,s}=viewOf(canvas);
    const x=wrapCoord(cam.x+(clientX-rect.left-rect.width/2)/s);
    const y=wrapCoord(cam.y+(clientY-rect.top-rect.height/2)/s);
    // Constant on-screen hit radius, so zooming never changes feel. Distance is
    // toroidal: an organism across the seam is one tap away, not across the map.
    let best:RenderOrganism|null=null,bestD=26/s;
    for(const o of snapshot.organisms){
      const d=Math.hypot(wrapDelta(o.x,x),wrapDelta(o.y,y));
      if(d<bestD){bestD=d;best=o}
    }
    onSelect(best?.id??null);
  };

  // Drag pans (wrapping freely across the torus); a tap without movement
  // selects, so one pointer does both.
  const drag=useRef<{x:number;y:number;cx:number;cy:number;moved:boolean}|null>(null);
  const onPointerDown=(event:React.PointerEvent<HTMLCanvasElement>)=>{
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={x:event.clientX,y:event.clientY,cx:cam.x,cy:cam.y,moved:false};
  };
  const onPointerMove=(event:React.PointerEvent<HTMLCanvasElement>)=>{
    const d=drag.current;if(!d)return;
    const dx=event.clientX-d.x,dy=event.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<6)return;
    d.moved=true;
    const {s}=viewOf(event.currentTarget);
    // Normalize while panning: the camera center can then never drift more
    // than one period from the field, so wrapDelta stays exact.
    onCamera({x:wrapCoord(d.cx-dx/s),y:wrapCoord(d.cy-dy/s)});
  };
  const onPointerUp=(event:React.PointerEvent<HTMLCanvasElement>)=>{
    const d=drag.current;drag.current=null;
    if(!d||d.moved)return;
    selectAt(event.clientX,event.clientY,event.currentTarget);
  };

  return <canvas aria-label="Evolution world" className="world-canvas" ref={ref} width={size[0]} height={size[1]}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={()=>{drag.current=null}}/>;
}

function WorldMinimap({snapshot,cam,view}:{
  snapshot:RenderSnapshot;cam:Camera;view:{w:number;h:number}|null;
}){
  const ref=useRef<HTMLCanvasElement>(null);
  // Single source for the drawn marker geometry and the published geometry.
  const rect=view?{w:view.w,h:view.h}:null;
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const w=canvas.width,h=canvas.height,k=w/WORLD_EXTENT;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle="#06121a";ctx.fillRect(0,0,w,h);
    // Coarse real resource field (every other cell) - an overview, not a claim.
    // Grid indices are scaled by the world size of one cell, not by k alone,
    // or the field collapses into the top-left tenth of the minimap.
    const n=snapshot.resources.gridSize,stocks=snapshot.resources.stock,caps=snapshot.resources.capacity;
    const cellWorld=WORLD_EXTENT/n,step=n>40?2:1,px=cellWorld*step*k;
    for(let y=0;y<n;y+=step)for(let x=0;x<n;x+=step){
      const i=y*n+x;
      const a=(caps[0]?.[i]||0)>0?(stocks[0]?.[i]||0)/(caps[0]?.[i]||1):0;
      const b=(caps[1]?.[i]||0)>0?(stocks[1]?.[i]||0)/(caps[1]?.[i]||1):0;
      const c=(caps[2]?.[i]||0)>0?(stocks[2]?.[i]||0)/(caps[2]?.[i]||1):0;
      ctx.fillStyle=`rgb(${Math.round(8+34*a+64*b)},${Math.round(16+64*a+48*c)},${Math.round(20+54*b+28*c)})`;
      ctx.fillRect(x*cellWorld*k,y*cellWorld*k,px+1,px+1);
    }
    // Real organisms; thinned above 2500 so a 5k world stays cheap on a phone.
    const thin=snapshot.organisms.length>2500?2:1;
    ctx.fillStyle="#cfeede";
    for(let i=0;i<snapshot.organisms.length;i+=thin){
      const o=snapshot.organisms[i];if(!o)continue;
      ctx.fillRect(o.x*k,o.y*k,1,1);
    }
    // Visible window marker. WorldCanvas already reports the visible size in
    // world units (w/s), so it must not be divided by zoom again. Panning is
    // normalized, but draw the wrapped copies defensively.
    if(rect){
      const x0=wrapCoord(cam.x-rect.w/2),y0=wrapCoord(cam.y-rect.h/2);
      ctx.strokeStyle="rgba(120,240,255,.95)";ctx.lineWidth=1;
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
        const x=(x0+ox*WORLD_EXTENT)*k,y=(y0+oy*WORLD_EXTENT)*k;
        if(x>w||y>h||x+rect.w*k<0||y+rect.h*k<0)continue;
        ctx.strokeRect(x+.5,y+.5,rect.w*k,rect.h*k);
      }
    }
  },[snapshot,cam,view]);
  // data-* publishes the geometry the marker is actually drawn from, so the
  // smoke test can assert it against the canvas instead of trusting the code.
  return <canvas aria-label="World minimap" className="minimap-canvas" ref={ref} width={108} height={108}
    data-testid="world-minimap"
    data-cam-x={cam.x.toFixed(2)} data-cam-y={cam.y.toFixed(2)}
    data-window-w={rect?rect.w.toFixed(2):""} data-window-h={rect?rect.h.toFixed(2):""}/>;
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
  // Recipe of the running universe (set on create/load). Settings staged in
  // the modal stay pending until Create universe applies them.
  const [activeSettings,setActiveSettings]=useState(DEFAULT_SETTINGS);
  const pendingDirty=!settingsEqual(settings,activeSettings);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
  const [lens,setLens]=useState<Lens>("normal");
  const [resourceView,setResourceView]=useState<ResourceView>("combined");
  const [traitView,setTraitView]=useState<TraitView>("speed");
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [selectedStoryId,setSelectedStoryId]=useState<string|null>(null);
  const [selectedCladeId,setSelectedCladeId]=useState<number|null>(null);
  // Camera: uniform zoom + toroidal pan into the same 600x600 world.
  const [cam,setCam]=useState<Camera>({x:300,y:300});
  const [zoom,setZoom]=useState(1);
  const [view,setView]=useState<{w:number;h:number}|null>(null);
  const setZoomClamped=(next:number)=>setZoom(Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,Math.round(next*10)/10)));
  const reportView=useCallback((u:{w:number;h:number})=>{
    setView(prev=>prev&&Math.abs(prev.w-u.w)<.5&&Math.abs(prev.h-u.h)<.5?prev:u);
  },[]);
  // On phone the inspector is a floating sheet over the world, so it starts
  // collapsed there (world-first first impression); desktop keeps the open
  // investigation panel. Presentation-only.
  const [inspectorOpen,setInspectorOpen]=useState(()=>typeof window!=="undefined"&&typeof window.matchMedia==="function"?window.matchMedia("(max-width: 900px)").matches?false:true:true);
  const [preset,setPreset]=useState<string>("Balanced");
  // Backpressure: never queue an advance while the worker is still busy with
  // the previous one. Without this, high speeds pile up work faster than the
  // worker can drain it and the UI stalls instead of running fast.
  const advanceDebt=useRef(false);

  useEffect(()=>{
    const unsub=runtime.subscribe(s=>{
      advanceDebt.current=false;setSnapshot(s);setStatus("");
      // A pending decision is a visible pause: the player must choose before
      // time moves again (A13). Runtime enforces the same gate independently.
      if(s.pendingDecision)setRunning(false);
    });
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

  const updateSettings=(patch:Partial<WorldSettings>)=>{
    setSettings(v=>({...v,...patch}));setPreset("Custom");
  };
  const applyPreset=(name:string)=>{
    const p=PRESETS[name];if(!p)return;
    setSettings(v=>({...v,...p.settings}));setPreset(name);
  };
  const randomizeSeed=()=>{
    setSettings(v=>({...v,seed:Math.floor(Math.random()*4294967294)+1}));setPreset("Custom");
  };
  // A7/A8: record the choice through runtime. It applies at most one
  // intervention, clears the gate, and never advances a tick.
  const resolveDecision=async(choiceId:string)=>{
    const pending=snapshot?.pendingDecision;if(!pending)return;
    setStatus("Recording your decision…");
    try{
      await runtime.resolveEventDecision(pending.opportunityId,choiceId);
      setStatus("Decision recorded. The world stays paused until you resume.");
    }catch(error){
      setStatus(`Decision failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  // While a decision is pending these must not advance time; they focus it.
  const blockWhilePending=()=>{if(!snapshot?.pendingDecision)return false;setStatus("A decision is waiting — choose how to respond.");return true};
  const newUniverse=()=>{
    setRunning(false);setSelectedId(null);
    runtime.create(configFromSettings(settings));
    setActiveSettings(settings);setPreset(presetForSettings(settings));
    setSettingsOpen(false);setStatus("New universe created — settings now active");
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
      const restored=await runtime.loadCheckpoint(checkpoint);
      // A3: the resumed universe becomes the active recipe; pending resets to
      // match it so staged settings can never be mistaken for the live world.
      const mapped=settingsFromConfig(restored.config);
      setSettings(mapped);setActiveSettings(mapped);setPreset(presetForSettings(mapped));
      setStatus("Checkpoint restored — active settings match the resumed universe");
    }catch(error){
      setStatus(`Restore failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  const exportEvidence=async()=>{
    const data=await runtime.requestExport();
    const text=JSON.stringify(data,null,2);
    const filename=`ecosystem-v030-tick-${snapshot?.tick??0}.json`;
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
  const pending=snapshot.pendingDecision;
  const records=(snapshot.analysis.records as any[])||[];
  const clades=m.clades?.top||[];
  const selected=snapshot.organisms.find(o=>o.id===selectedId)??null;
  const accounting=m.nutrient_field?.accounting?.absolute_residual??[];

  return <div className="app-shell">
    <header className="topbar">
      <div className="hud-cell brand-cell"><span className="eyebrow">Living Evolution Explorer</span><strong className="world-name">Digital Evolution Ecosystem</strong></div>
      <div className="hud"><div className="hud-cell"><span className="hud-label">Tick</span><span className="hud-value" data-testid="tick">{snapshot.tick.toLocaleString()}</span><span className="hud-sub">{formatYear(snapshot.tick)}</span></div><div className="hud-cell"><span className="hud-label">Living</span><span className="hud-value">{snapshot.population}</span></div><div className="hud-cell"><span className="hud-label">Dormant</span><span className="hud-value">{snapshot.dormantPopulation}</span></div><button className="hud-settings" onClick={()=>setSettingsOpen(true)}>World settings{pendingDirty&&<span className="pending-dot" data-testid="settings-pending" aria-hidden="true"/>}</button></div>
    </header>

    <nav className="rail" aria-label="Primary">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active":""} onClick={()=>setSurface(s)}><span className="nav-ico" aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span className="nav-label">{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <main className={surface==="world"?"surface surface-world":"surface"}>
      <section className="world-column" aria-label="Living world">
        <div className="lensbar">
          {(["normal","nutrients","clades","traits"] as Lens[]).map(v=><button key={v} className={lens===v?"active":""} onClick={()=>setLens(v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>)}
          {lens==="nutrients"&&<select aria-label="Resource view" value={resourceView} onChange={e=>setResourceView(e.target.value as ResourceView)}><option value="combined">Combined</option><option value="a">Nutrient A</option><option value="b">Nutrient B</option><option value="c">Metabolite C</option></select>}
          {lens==="traits"&&<select aria-label="Trait view" value={traitView} onChange={e=>setTraitView(e.target.value as TraitView)}>{Object.entries(TRAIT_RANGES).map(([key,[,,label]])=><option key={key} value={key}>{label}</option>)}</select>}
        </div>
        <div className="world-wrap">
          <div className="world-scene" aria-hidden="true"><div className="glow g-a"/><div className="glow g-b"/><div className="glow g-c"/><div className="ambient"/></div>
          <WorldCanvas snapshot={snapshot} lens={lens} resourceView={resourceView} traitView={traitView} selectedId={selectedId} onSelect={setSelectedId} cam={cam} zoom={zoom} onCamera={setCam} onView={reportView}/>
          <div className="world-overlay">
            <div className="minimap-frame"><WorldMinimap snapshot={snapshot} cam={cam} view={view}/></div>
            <div className="zoom-controls" role="group" aria-label="World view">
              <button aria-label="Zoom out" onClick={()=>setZoomClamped(zoom-.5)} disabled={zoom<=ZOOM_MIN}>−</button>
              <span className="zoom-readout" data-testid="zoom-level">{zoom.toFixed(1)}×</span>
              <button aria-label="Zoom in" onClick={()=>setZoomClamped(zoom+.5)} disabled={zoom>=ZOOM_MAX}>+</button>
              <button aria-label="Reset view" onClick={()=>{setZoom(1);setCam({x:300,y:300})}}>⌂</button>
            </div>
          </div>
          {pending&&<section className="decision-sheet" role="dialog" aria-modal="false" aria-label={pending.source==="world_catalyst"?"World catalyst":"Event decision"} data-testid="decision-sheet" data-source={pending.source}>
            <span className="eyebrow">{pending.source==="world_catalyst"?"World catalyst — your move":"A decision is waiting"}</span>
            <h2>{pending.prompt}</h2>
            <p className="decision-context">{pending.context}</p>
            <p className="decision-tick">World paused at tick {pending.createdTick.toLocaleString()}</p>
            <div className="decision-choices">
              {pending.choices.map(choice=><button key={choice.choiceId} data-choice={choice.choiceId}
                onClick={()=>resolveDecision(choice.choiceId)}>
                <strong>{choice.title}</strong>
                <span>{choice.directEffectDescription}</span>
              </button>)}
            </div>
            <p className="decision-foot">Time stays paused until you choose. Leaving an intervention out changes nothing.</p>
          </section>}
        </div>
      </section>
      <aside className="investigation-rail" aria-label="Investigation">
        {surface==="world"&&<div className={inspectorOpen?"inspector sheet":"inspector sheet collapsed"}>
          <button className="sheet-toggle" onClick={()=>setInspectorOpen(v=>!v)}>{inspectorOpen?"Hide details":"Show details"}</button>
          {inspectorOpen&&<>{selected?<><span className="eyebrow">Selected organism</span><h2>#{selected.id}</h2><p>{selected.activity} · generation {selected.generation}</p><p className="breadcrumb">Organism #{selected.id} → Lineage {`L-${String(selected.lineageId).padStart(4,"0")}`} → Clade {`L-${String(selected.cladeId).padStart(4,"0")}`}</p><dl>
            <div><dt>Clade</dt><dd>L-{String(selected.cladeId).padStart(4,"0")}</dd></div>
            <div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div>
            <div><dt>Movement</dt><dd>{selected.speed.toFixed(2)}</dd></div>
            <div><dt>Sensing</dt><dd>{selected.sensing.toFixed(1)}</dd></div>
            <div><dt>Byproduct use</dt><dd>{selected.byproductUse.toFixed(2)}</dd></div>
            <div><dt>Dormancy response</dt><dd>{selected.dormancyResponse.toFixed(2)}</dd></div>
          </dl><button onClick={()=>{setSelectedCladeId(selected.cladeId);setSurface("tree")}}>View lineage in Tree</button><button onClick={()=>setSelectedId(null)}>Clear selection</button></>:<>
            <span className="eyebrow">World now</span><h2>{m.ecological_outcome}</h2><p className="gloss">{glossOutcome(m.ecological_outcome)}</p><p>{m.population} living · peak {m.peak_population}</p><dl>
              <div><dt>Active</dt><dd>{snapshot.activePopulation}</dd></div>
              <div><dt>Dormant</dt><dd>{snapshot.dormantPopulation}</dd></div>
              <div><dt>Effective niches</dt><dd>{Number(m.effective_niches||0).toFixed(2)}</dd></div>
              <div><dt>Metabolite C</dt><dd>{((m.metabolite_c?.fraction||0)*100).toFixed(0)}%</dd></div>
              <div><dt>Cross-feeders</dt><dd>{((m.metabolic_roles?.crossfeeder_fraction||0)*100).toFixed(0)}%</dd></div>
            </dl>
          </>}</>}
        </div>}

        {surface==="history"&&<section className="panel">
        <div className="panel-head"><div><span className="eyebrow">What happened here?</span><h2>History</h2></div><span>{records.length} durable ecological records</span></div>
        {(()=>{const story=records.find((r:any)=>r.id===selectedStoryId);if(!story)return null;const ev=story.evidence||{};return<article key={story.id} className="story-detail"><span>{formatTickAge(story.tick)} · {story.phase}</span><h3>{story.title}</h3><p>{story.summary}</p>{typeof ev.population==="number"&&<dl className="evidence"><div><dt>Population then</dt><dd>{ev.population}</dd></div><div><dt>Dormant share</dt><dd>{Math.round((ev.dormant_fraction||0)*100)}%</dd></div><div><dt>Metabolite C energy</dt><dd>{Math.round((ev.c_energy_share||0)*100)}%</dd></div><div><dt>Leading way of life</dt><dd>{String(ev.dominant_role||"—")}</dd></div></dl>}<button onClick={()=>setSelectedStoryId(null)}>Back to all stories</button></article>})()}
        {records.length===0?<><p>No durable ecological arc has been established yet.</p><h3>Recent simulation events</h3>{snapshot.events.slice(-8).reverse().map((e,i)=><article key={`${e.tick}-${i}`}><span>Tick {e.tick.toLocaleString()}</span><p>{e.label}</p></article>)}</>:records.slice().reverse().map((r:any)=><article key={r.id}><button className="record-button" onClick={()=>setSelectedStoryId(r.id)}><span>{formatTickAge(r.tick)} · {r.phase}</span><h3>{r.title}</h3><p>{r.summary}</p></button></article>)}
        {snapshot.resolvedDecisions.length>0&&<>
          <h3>Your decisions</h3>
          <p>Actions you took, in order. A decision is an action followed by later outcomes, not a proven cause.</p>
          {snapshot.resolvedDecisions.slice().reverse().map(d=>{
            const source=d.sourceEventId?records.find((r:any)=>r.id===d.sourceEventId):null;
            const offered=d.source==="world_catalyst"
              ?`World catalyst offered at tick ${d.offerTick.toLocaleString()}.`
              :source?`After: ${source.title}.`:"No linked event.";
            return <article key={d.commandId} className="decision-record">
              <span>Tick {d.tick.toLocaleString()}</span>
              <h3>{d.choiceTitle}</h3>
              <p>{offered} {d.directEffectDescription}</p>
            </article>;
          })}
        </>}
      </section>}

      {surface==="tree"&&<section className="panel">
        <div className="panel-head"><div><span className="eyebrow">Evolutionary branches</span><h2>Tree</h2></div><span>{m.clades?.active??0} active clades</span></div>
        <p>{m.clades?.definition}</p>
        {(()=>{const clade=clades.find((c:any)=>c.id===selectedCladeId);if(!clade)return null;const members=snapshot.organisms.filter(o=>o.cladeId===clade.id);return<article key={`detail-${clade.id}`} className="lineage-detail"><span className="breadcrumb">Tree → Clade {`L-${String(clade.id).padStart(4,"0")}`}</span><h3>{`L-${String(clade.id).padStart(4,"0")}`}</h3><p>{clade.count} living · {((clade.share||0)*100).toFixed(0)}% of the world · {members.filter(o=>o.activity==="dormant").length} dormant right now</p><p>{(clade.mutations||[]).join(" + ")||"founder ancestry"} · {formatTickAge(Number(clade.age||0))} old</p><p className="gloss">{clade.count>0?"This family is alive in the world right now.":"No living members — this branch survives only in history."}</p><button onClick={()=>{const first=members[0];if(first){setSelectedId(first.id);setSurface("world")}}}>Locate in world</button><button onClick={()=>setSelectedCladeId(null)}>Back to all clades</button></article>})()}
        <div className="cards">{clades.map((c:any)=><article key={c.id} style={{borderTopColor:cladeColor(c.id)}}><button className="record-button" onClick={()=>setSelectedCladeId(c.id)}><h3>L-{String(c.id).padStart(4,"0")}</h3><p>{c.count} living · {(c.share*100).toFixed(0)}%</p><small>{(c.mutations||[]).join(" + ")||"founder ancestry"} · {formatTickAge(Number(c.age||0))} old</small></button></article>)}</div>
      </section>}

      {surface==="experiments"&&<section className="panel">
        <span className="eyebrow">What if this world changed?</span><h2>Experiments</h2>
        {snapshot.control?<div className="compare"><div><strong>Experiment</strong><span>{snapshot.population} living</span><span>{m.ecological_outcome}</span><span>{formatYear(snapshot.tick)}</span></div><div><strong>Untouched twin</strong><span>{snapshot.control.population} living</span><span>{snapshot.control.metrics.ecological_outcome}</span><span>{formatYear(snapshot.control.tick)}</span></div></div>:<p>No matched control exists yet. Applying an intervention creates an exact twin first.</p>}
        <div className="actions"><button onClick={()=>runtime.intervene("global")}>Global nutrient crash</button><button onClick={()=>runtime.intervene("droughtA")}>Nutrient A drought</button><button onClick={()=>runtime.intervene("droughtB")}>Nutrient B drought</button></div>
        {records.length>0&&<><h3>Histories so far</h3><p>What the experiment branch has lived through — the untouched twin keeps its own time.</p>{records.slice(-4).reverse().map((r:any)=><article key={r.id}><span>{formatTickAge(r.tick)} · {r.phase}</span><h3>{r.title}</h3></article>)}</>}
      </section>}
      </aside>
    </main>

    <nav className="mobile-nav" aria-label="Mobile navigation">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active mnav-btn":"mnav-btn"} onClick={()=>setSurface(s)}><span aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span>{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <footer className="controls">
      <button onClick={()=>{if(blockWhilePending())return;setRunning(v=>!v)}}>{running?"Pause":"Play"}</button>
      <select aria-label="Simulation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={100}>100×</option><option value={500}>Max</option></select>
      <button onClick={()=>{if(blockWhilePending())return;setRunning(false);runtime.runToNextEvent()}}>Next meaningful change</button>
      <button onClick={save}>Save</button>
      <button onClick={load}>Resume</button>
      <button onClick={exportEvidence}>Export</button>
      <span className="status">{status}</span>
    </footer>

    {settingsOpen&&<div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="World settings">
      <div className="panel-head"><div><span className="eyebrow">Create / inspect</span><h2>World settings</h2></div><button onClick={()=>setSettingsOpen(false)}>Close</button></div>
      <div className="config-chip-row"><span className="eyebrow">Active universe</span><strong data-testid="active-config">Active: {presetForSettings(activeSettings)} · seed {activeSettings.seed}</strong></div>
      <div className="preset-row" role="group" aria-label="World presets">{Object.keys(PRESETS).map(name=><button key={name} className={preset===name?"active":""} aria-pressed={preset===name} onClick={()=>applyPreset(name)}>{name}</button>)}</div>
      <p className="preset-note">{preset==="Custom"?"Custom world — your controls define the conditions.":PRESETS[preset]?.note}</p>
      <div className="seed-row"><label className="seed"><span>World seed</span><input aria-label="World seed" value={settings.seed} type="number" onChange={e=>updateSettings({seed:Number(e.target.value)})}/></label><button onClick={randomizeSeed}>New random seed</button></div>
      <Slider label="Nutrient supply" value={settings.richness} min={0} max={4} step={.01} onChange={v=>updateSettings({richness:v})}/>
      <Slider label="Nutrient-zone separation" value={settings.separation} min={0} max={1} step={.01} onChange={v=>updateSettings({separation:v})}/>
      <Slider label="Nutrient variety" value={settings.variety} min={0} max={1} step={.01} onChange={v=>updateSettings({variety:v})}/>
      <Slider label="Founding population" value={settings.population} min={5} max={120} step={1} onChange={v=>updateSettings({population:Math.round(v)})}/>
      <Slider label="Starting differences" value={settings.variation} min={0} max={1} step={.01} onChange={v=>updateSettings({variation:v})}/>
      <Slider label="Mutation chance" value={settings.mutation} min={0} max={.15} step={.005} onChange={v=>updateSettings({mutation:v})}/>
      <Slider label="Survival pressure" value={settings.pressure} min={0} max={1} step={.01} onChange={v=>updateSettings({pressure:v})}/>
      <div className="actions"><button className="primary" onClick={newUniverse}>Create universe</button><button onClick={()=>setDiagnosticsOpen(v=>!v)}>Developer diagnostics</button></div>
      {pendingDirty?<p className="pending-note" data-testid="pending-note">Unapplied changes — Create universe to apply</p>:<p className="active-note" data-testid="active-note">Settings match the running universe</p>}
      {diagnosticsOpen&&<div className="diagnostics">
        <strong>Engine {ENGINE_VERSION}</strong>
        <span>Resource accounting residuals: {accounting.length?accounting.map((v:number)=>Number(v).toExponential(2)).join(" / "):"—"}</span>
        <span>Analysis records: {records.length}</span>
        <span>Biology target population rule: none</span>
      </div>}
    </section></div>}
  </div>;
}
