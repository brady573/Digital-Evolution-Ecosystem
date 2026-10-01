import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CladeId, EngineConfig, HistoryRecordId, OrganismId, RenderOrganism, RenderSnapshot, WorldEnvironmentFrame, WorldId } from "@digital-evolution/contracts";
import { CHECKPOINT_PLAYER_NOTICE, CheckpointRejectionError } from "@digital-evolution/contracts";
import { cladeId, formatCladeId, formatLineageId, lineageId, typedRefs } from "@digital-evolution/contracts";
import { WorkerRuntimeClient, createInstrumentedTransport, normalizeSpeedMode, sliceFor } from "@digital-evolution/sim-runtime";
import type { WorkerLike } from "@digital-evolution/sim-runtime";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { IndexedDbWorldRepository } from "./persistence";
import { formatTickAge, formatYear, glossOutcome } from "./language";
import {
  LandscapeSmoother, fillEnvironmentFractions, landscapeCell, landscapeTileLayout,
  microTexture, nutrientOverlayCell, wasteOverlayCell,
} from "./landscape";
import { cladeColor, dormantChannel, organismColor, type OrganismLens } from "./organismEncoding";
import { AftermathPanel } from "./AftermathPanel";
import { createPresentationStore, type PresentationView } from "./presentationStore";
import { drawPhenotypeOrganism, phenotypeCache, tierForZoom } from "./phenotype";
import { familyArtwork } from "./familyArt";

/** Details card for a selected organism, incl. its base family portrait. */
function SelectedOrganismCard({ selected, onViewLineage, onClear }: {
  selected: RenderOrganism;
  onViewLineage: () => void; onClear: () => void;
}) {
  // Direct live-cache lookup (review fix): the normal snapshot-resolution
  // pass already resolved this organism — never re-resolve the world here.
  const fam = phenotypeCache.familyOf(selected.id);
  return <>
    <span className="eyebrow">Selected organism</span><h2>#{selected.id}</h2>
    {fam && <figure className="family-portrait"><img src={familyArtwork(fam)} width={128} height={128} alt={`${fam} family portrait`} /><figcaption>{fam} family</figcaption></figure>}
    <p>{selected.activity} · generation {selected.generation}</p><p className="breadcrumb">Organism #{selected.id} → Lineage {formatLineageId(selected.lineageId)} → Clade {formatCladeId(selected.cladeId)}</p><dl>
      <div><dt>Clade</dt><dd>{formatCladeId(selected.cladeId)}</dd></div>
      <div><dt>Energy</dt><dd>{selected.energy.toFixed(1)}</dd></div>
      <div><dt>Movement</dt><dd>{selected.speed.toFixed(2)}</dd></div>
      <div><dt>Sensing</dt><dd>{selected.sensing.toFixed(1)}</dd></div>
      <div><dt>Byproduct use</dt><dd>{selected.byproductUse.toFixed(2)}</dd></div>
      <div><dt>Dormancy response</dt><dd>{selected.dormancyResponse.toFixed(2)}</dd></div>
    </dl><button onClick={onViewLineage}>View lineage in Tree</button><button onClick={onClear}>Clear selection</button>
  </>;
}

type Surface="world"|"history"|"tree"|"experiments";
type Lens="normal"|"nutrients"|"waste"|"clades"|"traits";
type ResourceView="combined"|"a"|"b"|"c";
type TraitView="speed"|"sensing"|"metabolism"|"reproduction"|"diet"|"habitat"|"byproductUse"|"dormancyResponse";
/** Display names for the lens set. The active-lens chip uses the same labels
 *  as the expanded buttons, so the two never disagree. */
const LENS_LABELS:Record<Lens,string>={
  normal:"Landscape",nutrients:"Nutrients",waste:"Waste",clades:"Clades",traits:"Traits",
};

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
// impl: REQ-WORLD-002 (Balanced/Patchwork/Harsh/Abundant richness presets)
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

// Organism colour and the dormancy channel live in ./organismEncoding, which
// tools/validation/landscape.ts asserts directly (§21.2). Keeping them out of
// the component is what makes the analytical-lens guarantee testable.

/** Presentation-only landscape smoothing state. Lives for the canvas's
 * lifetime, holds no simulation meaning, and re-primes from the current
 * fields whenever the displayed universe identity changes. */
const landscapeSmoother=new LandscapeSmoother();

function WorldCanvas({
  worldId,tick,env,organisms,lens,resourceView,traitView,selectedId,onSelect,cam,zoom,onCamera,onView,
}:{
  // Lane 3 F2b read-model inputs: identity (worldId/tick for smoother
  // scoping), the environment frame, and the store's joined organism rows.
  // Same RenderOrganism-shaped entries selection and phenotype read.
  worldId:WorldId;tick:number;env:WorldEnvironmentFrame;organisms:readonly RenderOrganism[];
  lens:Lens;resourceView:ResourceView;traitView:TraitView;
  selectedId:OrganismId|null;onSelect:(id:OrganismId|null)=>void;
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
    const w=canvas.width,h=canvas.height,n=env.resources.gridSize;
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

    const drawEnvironment=lens==="normal"||lens==="nutrients"||lens==="waste";
    if(drawEnvironment){
      // Analytical lenses read exact fields: no smoothing, no texture, flat
      // per-cell values, because measurement is the task. The ecological
      // default reads smoothed fields, composes them by role, and is drawn
      // as a continuous field: 3600 hard rectangles read as a grid, so the
      // composited field goes into a grid-sized buffer and is scaled up with
      // the browser's own interpolation. Large-scale structure is therefore
      // real simulation structure with smooth transitions, not cells.
      const analytical=lens!=="normal";
      const a=new Float32Array(n*n),b=new Float32Array(n*n),c=new Float32Array(n*n),wf=new Float32Array(n*n);
      fillEnvironmentFractions(env,a,b,c,wf);
      let av=a,bv=b,cv=c,wv=wf;
      if(lens==="normal"){
        // Presentation-only inertia, scoped by the universe's presentation
        // identity (unique per create/restore; seed and config are NOT
        // sufficient because two universes can share both). The smoother
        // primes from the current fields on a new identity, so a created or
        // restored world shows its real environment on the first frame
        // instead of a fictitious depleted one.
        const id=`w${worldId}`;
        const sm=landscapeSmoother.advance(id,tick,a,b,c,wf,0.35);
        av=new Float32Array(n*n);bv=new Float32Array(n*n);cv=new Float32Array(n*n);wv=new Float32Array(n*n);
        for(let i=0;i<n*n;i++){const j=i*4;av[i]=sm[j]!;bv[i]=sm[j+1]!;cv[i]=sm[j+2]!;wv[i]=sm[j+3]!}
      }
      const kind=resourceView==="a"?0:resourceView==="b"?1:resourceView==="c"?2:-1;
      if(!analytical){
        const buffer=document.createElement("canvas");
        buffer.width=n;buffer.height=n;
        const bctx=buffer.getContext("2d");
        if(bctx){
          const img=bctx.createImageData(n,n);
          for(let i=0;i<n*n;i++){
            const rgb=landscapeCell(av[i]!,bv[i]!,cv[i]!,wv[i]!,microTexture(i));
            const o=i*4;
            img.data[o]=rgb[0];img.data[o+1]=rgb[1];img.data[o+2]=rgb[2];img.data[o+3]=255;
          }
          bctx.putImageData(img,0,0);
          // Repeat one world period across the whole canvas. Deriving this
          // from the wrapped toX/toY mapping collapsed the rect to zero width
          // for every camera except the exact world centre, so the substrate
          // disappeared as soon as the world was panned.
          const tiles=landscapeTileLayout(cam.x,cam.y,s,w,h,WORLD_EXTENT);
          const prevSmooth=ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled=true;
          for(let ti=tiles.iStart;ti<=tiles.iEnd;ti++){
            for(let tj=tiles.jStart;tj<=tiles.jEnd;tj++){
              ctx.drawImage(buffer,tiles.baseX+ti*tiles.periodX,tiles.baseY+tj*tiles.periodY,tiles.periodX,tiles.periodY);
            }
          }
          ctx.imageSmoothingEnabled=prevSmooth;
        }
        // Detail on loaded ground: a deterministic stipple whose density rises
        // with the measured waste. It is a second, non-colour channel and
        // cosmetic only, so it is drawn at every zoom, not just close ones.
        for(let i=0;i<n*n;i++){
          const load=wv[i]!;
          if(load<0.18)continue;
          const px=toX((i%n+.5)*(WORLD_EXTENT/n)),py=toY((Math.floor(i/n)+.5)*(WORLD_EXTENT/n));
          if(px<-cell||py<-cell||px>w+cell||py>h+cell)continue;
          const dots=1+Math.min(3,Math.floor((load-0.18)*4));
          ctx.fillStyle=`rgba(58,48,40,${0.06+0.035*dots})`;
          for(let k=0;k<dots;k++){
            const t=microTexture(i*8+k);
            ctx.fillRect(px+((t-.5)*cell),py+((microTexture(i*13+k)-.5)*cell),1.5,1.5);
          }
        }
      }else{
        for(let i=0;i<n*n;i++){
          const px=toX((i%n+.5)*(WORLD_EXTENT/n)),py=toY((Math.floor(i/n)+.5)*(WORLD_EXTENT/n));
          if(px<-cell||py<-cell||px>w+cell||py>h+cell)continue;
          let rgb:readonly [number,number,number];
          if(lens==="waste")rgb=wasteOverlayCell(wv[i]!);
          else if(kind>=0)rgb=nutrientOverlayCell(kind,av[i]!);
          else rgb=nutrientOverlayCell(-1,(av[i]!+bv[i]!+cv[i]!)/3);
          ctx.fillStyle=`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          ctx.fillRect(px-cell/2,py-cell/2,cell+1,cell+1);
        }
      }
    }

    const traitRange=TRAIT_RANGES[traitView];
    // Lane 2 M4B: normal-lens morphology delegates to the phenotype engine.
    // Every other lens keeps the legacy voxel path exactly, so analytical
    // meaning always outranks decorative morphology. Phenotype resolutions
    // are memoized per organism across snapshots (traits/ancestry are fixed
    // at birth); only the visible tier renders each frame.
    const phenoTier=tierForZoom(zoom);
    const pheno=lens==="normal"?phenotypeCache.resolveSnapshot({worldId,organisms}):null;
    const unit=Math.max(2,s*2.2);
    for(const o of organisms){
      const px=toX(o.x),py=toY(o.y);
      if(px<-24||py<-24||px>w+24||py>h+24)continue;
      // §21.2: the lens encoding wins, including for dormant organisms, so
      // Clades and Traits always encode what they claim. Dormancy rides the
      // separate alpha/hollow channel below and never replaces the encoding.
      const color=organismColor(o as never,lens as OrganismLens,traitView,[traitRange[0],traitRange[1]]);
      // Dormancy is its own channel (§21.2), so it never displaces the lens
      // colour. One source of truth for alpha/hollow, asserted in validation.
      const chan=dormantChannel(o as never);

      if(lens==="normal"&&pheno){
        // Phenotype morphology: grid shape encodes family/traits/dormancy,
        // lens color and dormancy dimming stay exactly as before.
        const res=pheno.get(o.id);
        ctx.fillStyle=color;
        ctx.globalAlpha=chan.alpha;
        if(res)drawPhenotypeOrganism(ctx,o,res,phenotypeCache,phenoTier,px,py,unit);
        ctx.globalAlpha=1;
      }else{
      // Voxel sprite: chunky pixel cluster whose size follows stored energy,
      // texture is a deterministic function of organism id (stable per frame),
      // and density follows diet family. Positions are untouched, so
      // click-selection mapping is unchanged.
      const energyClass=chan.dormant?0:(o.energy>120?2:o.energy>60?1:0);
      const span=2+energyClass;
      let hsh=Math.imul(o.id,2654435761)^0x9e3779b9;hsh^=hsh>>>15;hsh=Math.imul(hsh,0x85ebca6b)>>>0;
      ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.globalAlpha=chan.alpha;
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
        if(chan.dormant)ctx.strokeRect(bx,by,unit,unit);else ctx.fillRect(bx,by,unit,unit);
      }
      ctx.globalAlpha=1;
      }

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
  },[worldId,tick,env,organisms,lens,resourceView,traitView,selectedId,size,cam,zoom,onView]);

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
    for(const o of organisms){
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

function WorldMinimap({resources,organisms,cam,view}:{
  // Lane 3 F2b read-model inputs: the environment frame's resource field plus
  // the store's joined organism rows (positions only are read here).
  resources:WorldEnvironmentFrame["resources"];organisms:readonly RenderOrganism[];
  cam:Camera;view:{w:number;h:number}|null;
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
    const n=resources.gridSize,stocks=resources.stock,caps=resources.capacity;
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
    const thin=organisms.length>2500?2:1;
    ctx.fillStyle="#cfeede";
    for(let i=0;i<organisms.length;i+=thin){
      const o=organisms[i];if(!o)continue;
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
  },[resources,organisms,cam,view]);
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
  // Test-only instrumented transport (?deeTest only; stays null in production,
  // where the client is constructed with no factory and owns its transport).
  const instrumentedRef=useRef<{transport:WorkerLike;fail:(kind:"error"|"messageerror")=>void}|null>(null);
  const runtime=useMemo(()=>{
    if(typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("deeTest")){
      // Test-only construction path. Real worker construction is owned by the
      // runtime boundary's instrumented-transport factory, so Explorer never
      // names the worker implementation path. The default (production) path
      // below is unchanged.
      const instrumented=createInstrumentedTransport();
      instrumentedRef.current=instrumented;
      return new WorkerRuntimeClient(()=>instrumented.transport);
    }
    return new WorkerRuntimeClient();
  },[]);
  const repository=useMemo(()=>new IndexedDbWorldRepository(),[]);
  const [snapshot,setSnapshot]=useState<RenderSnapshot|null>(null);
  // Lane 3 Task 6: read-model-only transport. The legacy snapshot subscription
  // is gone (RuntimeClient.subscribe removed): backpressure release, status
  // clearing, and the decision-gate control flow below live on the
  // interpretation frame. The `snapshot` state stays, but only as retained
  // detail: it is fed by request-correlated replies (restore/resolve/
  // acknowledge returns) and by the on-demand detail pull when History or
  // Experiments opens — never by a live push. Analysis records and the full
  // decision history deliberately stay out of live-frame traffic (handoff §6).
  const store=useMemo(()=>createPresentationStore(),[]);
  const [presentation,setPresentation]=useState<PresentationView>(()=>store.getView());
  const [surface,setSurface]=useState<Surface>("world");
  const [running,setRunning]=useState(false);
  // Play intent across a decision gate (AC22). The decision pause must not
  // silently turn "was playing" into "paused", or the world would stay stopped
  // after a choice the player never asked to stop for. Refs mirror the state so
  // the worker subscription can read them without stale closures.
  const [wasPlaying,setWasPlaying]=useState(false);
  const runningRef=useRef(false);
  const wasPlayingRef=useRef(false);
  runningRef.current=running;
  wasPlayingRef.current=wasPlaying;
  const [speed,setSpeed]=useState(100);
  const [status,setStatus]=useState("Creating universe…");
  const [settings,setSettings]=useState(DEFAULT_SETTINGS);
  // Recipe of the running universe (set on create/load). Settings staged in
  // the modal stay pending until Create universe applies them.
  // impl: REQ-WORLD-001 (pending-vs-active universe settings)
  const [activeSettings,setActiveSettings]=useState(DEFAULT_SETTINGS);
  const pendingDirty=!settingsEqual(settings,activeSettings);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
  const [lens,setLens]=useState<Lens>("normal");
  // Progressive disclosure: the lens set and the secondary save actions stay
  // collapsed until asked for, so the world keeps the screen.
  const [lensMenuOpen,setLensMenuOpen]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [resourceView,setResourceView]=useState<ResourceView>("combined");
  const [traitView,setTraitView]=useState<TraitView>("speed");
  const [selectedId,setSelectedId]=useState<OrganismId|null>(null);
  const [selectedStoryId,setSelectedStoryId]=useState<HistoryRecordId|null>(null);
  const [selectedCladeId,setSelectedCladeId]=useState<CladeId|null>(null);
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
  const deadRef=useRef(false);

  // Newest announced world, so a create/restore batch never wipes the status
  // its own flow sets. CHECKPOINT_LOADED resolves (and the flow sets e.g.
  // "Checkpoint restored") before the restore's frames arrive; clearing status
  // on those frames would wipe it, repeating the PR #84 defect class.
  const knownWorldRef=useRef<WorldId|null>(null);
  useEffect(()=>{
    // Read-model delivery only. The live frame is the per-advance heartbeat —
    // it emits on every advance — so one advance releases backpressure exactly
    // once, on the freshest composed view. Status clearing and the
    // decision-gate control flow below still live on the interpretation frame,
    // which emits only when its bounded payload changes (staggered cadence):
    // a suppressed interpretation must never stall the time controls.
    // Earlier frames only compose the store.
    const unsubPresentation=runtime.subscribePresentation(frame=>{
      store.apply(frame);
      const view=store.getView();
      setPresentation(view);
      if("organisms" in frame)advanceDebt.current=false;
      if(!("metrics" in frame))return;
      const transition=knownWorldRef.current!==null&&view.worldId!==knownWorldRef.current;
      knownWorldRef.current=view.worldId;
      if(!transition)setStatus("");
      const interp=view.interpretation;
      // A pending decision is a visible pause: the player must choose before
      // time moves again (A13). Runtime enforces the same gate independently.
      //
      // The player's intent is REMEMBERED rather than discarded (AC22): clearing
      // running outright loses the difference between "was playing" and "was
      // deliberately paused", and only the former should resume by itself once
      // the choice resolves.
      if(interp?.pendingDecision){
        setWasPlaying(w=>w||runningRef.current);
        setRunning(false);
      }else if(interp?.aftermath&&wasPlayingRef.current){
        // Playback resumes automatically at the prior bounded speed. The impact
        // sheet overlays a running world from here, and its evidence is pinned
        // to the resolution tick, so this cannot invalidate what it shows.
        setRunning(true);
        setWasPlaying(false);
      }
    });
    const onFatal=runtime.onTerminal(()=>{
      deadRef.current=true;
      setRunning(false);
      setWasPlaying(false);
      advanceDebt.current=false;
      setStatus("Simulation stopped — reload to continue");
    });
    runtime.create(configFromSettings(DEFAULT_SETTINGS));
    return()=>{unsubPresentation();onFatal();runtime.destroy()};
  },[runtime,store]);

  useEffect(()=>{
    if(!running)return;
    // Time-control scheduler (issue #37): each speed mode is a genuinely
    // distinct ticks/second target, decoupled from render cadence by a
    // wall-clock accumulator. Biology stays deterministic because the engine
    // steps per-tick with per-tick event breaks regardless of chunking;
    // backpressure keeps one slice in flight so slow workers stay responsive
    // and Max is worker-throughput-limited rather than a nominal multiplier.
    let raf=0,carry=0,last=performance.now();
    const frame=(now:number)=>{
      const elapsed=now-last;last=now;
      if(deadRef.current)return;
      if(!advanceDebt.current){
        const slice=sliceFor(normalizeSpeedMode(speed),elapsed,carry);
        carry=slice.carry;
        if(slice.ticks>0){
          advanceDebt.current=true;
          runtime.advance(slice.ticks);
        }
      }
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);
    return()=>cancelAnimationFrame(raf);
  },[running,speed,runtime]);

  // Test-only runtime hook. AC21 removes "Next meaningful change" from the
  // product, but the suites still need a deterministic way to reach a decision
  // without a DOM control to click. This is deliberately NOT a UI element - it
  // is invisible to a player and carries no affordance - and it is gated behind
  // an explicit URL flag so an ordinary session can never reach it.
  useEffect(()=>{
    if(typeof window==="undefined")return;
    if(!new URLSearchParams(window.location.search).has("deeTest"))return;
    const hook={
      runToNextEvent:()=>runtime.runToNextEvent(),
      acknowledgeAftermath:()=>runtime.acknowledgeAftermath(),
      resolve:(opportunityId:string,choiceId:string)=>runtime.resolveEventDecision(opportunityId,choiceId),
      killWorker:()=>instrumentedRef.current?.fail("error"),
    };
    (window as any).__DEE_TEST__=hook;
    return()=>{delete (window as any).__DEE_TEST__};
  },[runtime]);

  // Lane 3 Task 6: retained/detail path (handoff §5–§6). Analysis records and
  // the full decision history deliberately stay out of live-frame traffic,
  // so the History and Experiments history reads below pull them on demand
  // when those surfaces open — truthful during pure-advance play, with no
  // retained history pushed into live frames. A rejection (dead worker, no
  // universe yet) keeps the previous detail: the reads below stay
  // null-tolerant, so History falls back to the live interpretation refs.
  useEffect(()=>{
    if(surface!=="history"&&surface!=="experiments")return;
    let live=true;
    runtime.requestDetail().then(detail=>{if(live)setSnapshot(detail)}).catch(()=>{});
    return()=>{live=false};
  },[surface,runtime]);

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
    const pending=presentation.interpretation?.pendingDecision;if(!pending)return;
    setStatus("Recording your decision…");
    try{
      // The correlated reply feeds retained detail (full decision history);
      // live presentation already composed from the frames beside it.
      setSnapshot(await runtime.resolveEventDecision(pending.opportunityId,choiceId));
      setStatus("Decision recorded. The world stays paused until you resume.");
    }catch(error){
      setStatus(`Decision failed: ${error instanceof Error?error.message:String(error)}`);
    }
  };
  // While a decision is pending these must not advance time; they focus it.
  const blockWhilePending=()=>{if(!presentation.interpretation?.pendingDecision)return false;setStatus("A decision is waiting — choose how to respond.");return true};
  // M3 aftermath impact state. Playback is NOT gated on the sheet (AC22):
  // resolving a choice restores whatever the player had going, so the sheet
  // usually overlays a world that is already running. All the affordance does
  // is release the presentation slot.
  const [acknowledging,setAcknowledging]=useState(false);
  const acknowledgeAftermath=async()=>{
    if(!presentation.interpretation?.aftermath)return;
    setAcknowledging(true);
    try{
      setSnapshot(await runtime.acknowledgeAftermath());
      setStatus("Aftermath observed. Watching the world.");
    }catch(error){
      setStatus(`Could not continue: ${error instanceof Error?error.message:String(error)}`);
    }finally{
      setAcknowledging(false);
    }
  };
  const newUniverse=()=>{
    setRunning(false);setSelectedId(null);
    phenotypeCache.clearStaged();
    runtime.create(configFromSettings(settings));
    setActiveSettings(settings);setPreset(presetForSettings(settings));
    setSettingsOpen(false);setStatus("New universe created — settings now active");
  };
  const save=async()=>{
    setStatus("Saving exact checkpoint…");
    const checkpoint=await runtime.requestCheckpoint();
    // Presentation-side family anchors travel with the save record (never in
    // biology) so a restored world reconstructs identical families.
    const summary=await repository.save("current",checkpoint,phenotypeCache.snapshotAnchors());
    setStatus(`Saved tick ${summary.tick.toLocaleString()}`);
  };
  const load=async()=>{
    const checkpoint=await repository.load("current");
    if(!checkpoint){setStatus("No saved universe found");return}
    setRunning(false);
    setStatus("Restoring checkpoint…");
    try{
      // Stage anchors BEFORE restore: consumed once, on the restored world's
      // fresh identity. Null (old saves) means a clean presentation break.
      phenotypeCache.stageAnchors(await repository.loadAnchors("current")??{});
      const restored=await runtime.loadCheckpoint(checkpoint);
      // The correlated reply refreshes retained detail (records + full decision
      // history); the on-demand detail pull covers pure-advance play between
      // such replies.
      setSnapshot(restored);
      // A3: the resumed universe becomes the active recipe; pending resets to
      // match it so staged settings can never be mistaken for the live world.
      const mapped=settingsFromConfig(restored.config);
      setSettings(mapped);setActiveSettings(mapped);setPreset(presetForSettings(mapped));
      setStatus("Checkpoint restored — active settings match the resumed universe");
    }catch(error){
      // Branch on the typed reason, never on the message text. A3.3 makes an
      // ordinary save fail to load for the first time, so this string is now
      // something a player can meet: the developer message names a field, a
      // quoted value and a reason code, which is right for a log and useless
      // to someone who just wants their world back.
      setStatus(`Restore failed: ${error instanceof CheckpointRejectionError?`${error.playerMessage} ${CHECKPOINT_PLAYER_NOTICE}`:error instanceof Error?error.message:String(error)}`);
    }
  };
  const exportEvidence=async()=>{
    const data=await runtime.requestExport();
    const text=JSON.stringify(data,null,2);
    const filename=`ecosystem-v030-tick-${presentation.live?.tick??0}.json`;
    setStatus("Preparing evidence export…");
    try{
      // Blob-anchor downloads do not work inside the native WebView, so on
      // Android the export is staged to a real file and handed to the OS
      // share sheet instead. Browsers keep the direct download path.
      if(Capacitor.isNativePlatform()){
        const saved=await Filesystem.writeFile({path:filename,data:text,directory:Directory.Cache,encoding:Encoding.UTF8});
        try{
          await Share.share({title:"Ecosystem evidence export",text:`Digital Evolution evidence export, tick ${presentation.live?.tick??0}`,files:[saved.uri],dialogTitle:"Share evidence export"});
          setStatus(`Export shared (tick ${(presentation.live?.tick??0).toLocaleString()})`);
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

  // Lane 3 Task 5: maintained surfaces render from the read-model view below.
  // The first paint waits for every channel, so no surface ever renders a
  // half-composed world. The legacy detail snapshot is no longer part of the
  // gate: it arrives only with request-correlated replies now.
  const live=presentation.live,env=presentation.environment,interp=presentation.interpretation,ident=presentation.identity,catalog=presentation.catalog;
  if(!live||!env||!interp||!ident||!catalog)return <main className="loading">{status}</main>;
  const m=interp.metrics;
  const pending=interp.pendingDecision;
  // A pending decision outranks an aftermath (AC15); the aftermath yields the
  // slot without being discarded, so it returns after the decision resolves.
  const showDecision=!!pending;
  const showAftermath=!pending&&!!interp.aftermath&&interp.aftermath.phase==="impact";
  // Retained detail path: analysis records and the full decision history are
  // deliberately excluded from live read-model traffic (handoff §6 history
  // rule — never push retained history into live frames). History reads them
  // from the detail snapshot: request-correlated replies refresh it, and the
  // on-demand pull above refreshes it whenever History or Experiments opens,
  // so fresh-world History is truthful during pure-advance play. Before any
  // detail has arrived the reads below tolerate null. Bounded live needs
  // (recent-event refs, control summary) come from the interpretation frame
  // instead; see below.
  const records=snapshot?.analysis.records??[];
  const clades=m.clades?.top||[];
  const selected=selectedId===null?null:presentation.organismById(selectedId);
  const accounting=m.nutrient_field?.accounting?.absolute_residual??[];

  return <div className="app-shell">
    <header className="topbar">
      <div className="hud-cell brand-cell"><span className="eyebrow">Living Evolution Explorer</span><strong className="world-name">Digital Evolution Ecosystem</strong></div>
      <div className="hud"><div className="hud-cell"><span className="hud-label">Tick</span><span className="hud-value" data-testid="tick">{live.tick.toLocaleString()}</span><span className="hud-sub">{formatYear(live.tick)}</span></div><div className="hud-cell"><span className="hud-label">Living</span><span className="hud-value">{live.population}</span></div><div className="hud-cell"><span className="hud-label">Dormant</span><span className="hud-value">{live.dormantPopulation}</span></div><button className="hud-settings" onClick={()=>setSettingsOpen(true)}>World settings{pendingDirty&&<span className="pending-dot" data-testid="settings-pending" aria-hidden="true"/>}</button></div>
    </header>

    <nav className="rail" aria-label="Primary">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active":""} onClick={()=>setSurface(s)}><span className="nav-ico" aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span className="nav-label">{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <main className={surface==="world"?"surface surface-world":"surface"}>
      <section className="world-column" aria-label="Living world">
        {/* Lens control. On the phone this is progressive disclosure: one
            compact chip naming the active lens, which expands the full set
            only when asked. The five buttons stay in the DOM (so they remain
            reachable, labelled and keyboard-navigable) and are revealed by
            the expanded state; desktop shows them inline as before. */}
        <div className={lensMenuOpen?"lensbar open":"lensbar"}>
          <button className="lens-active" aria-haspopup="true" aria-expanded={lensMenuOpen}
            aria-label={`Lens: ${LENS_LABELS[lens]}. Change lens`}
            onClick={()=>setLensMenuOpen(v=>!v)}>
            <span>{LENS_LABELS[lens]}</span><span className="lens-caret" aria-hidden="true">{lensMenuOpen?"▴":"▾"}</span>
          </button>
          <div className="lens-options" role="group" aria-label="Lens">
          {(["normal","nutrients","waste","clades","traits"] as Lens[]).map(v=><button key={v} className={lens===v?"active":""} aria-pressed={lens===v} onClick={()=>{setLens(v);setLensMenuOpen(false)}}>{LENS_LABELS[v]}</button>)}
          </div>
          {lens==="nutrients"&&<select aria-label="Resource view" value={resourceView} onChange={e=>setResourceView(e.target.value as ResourceView)}><option value="combined">Combined</option><option value="a">Nutrient A</option><option value="b">Nutrient B</option><option value="c">Metabolite C</option></select>}
          {lens==="waste"&&<span className="lensnote" role="note">Metabolic Waste, exact and untextured: brighter means more waste in that cell (a luminance ramp, so the reading does not depend on hue). The Landscape lens shows the same field differently — loaded ground loses its green cast and settles toward pale, desaturated ash, lifted well clear of barren soil and stippled so the texture reads without colour.</span>}
          {lens==="traits"&&<select aria-label="Trait view" value={traitView} onChange={e=>setTraitView(e.target.value as TraitView)}>{Object.entries(TRAIT_RANGES).map(([key,[,,label]])=><option key={key} value={key}>{label}</option>)}</select>}
        </div>
        <div className="world-wrap">
          <div className="world-scene" aria-hidden="true"><div className="glow g-a"/><div className="glow g-b"/><div className="glow g-c"/><div className="ambient"/></div>
          <WorldCanvas worldId={ident.worldId} tick={live.tick} env={env} organisms={presentation.organisms} lens={lens} resourceView={resourceView} traitView={traitView} selectedId={selectedId} onSelect={setSelectedId} cam={cam} zoom={zoom} onCamera={setCam} onView={reportView}/>
          {/* A pending decision outranks inspection, so it also yields the view
              overlay: leaving the minimap/zoom controls under the sheet made
              zoom unreachable (AC8). The world canvas itself stays visible as
              context. View state is untouched, so the controls return exactly
              as they were when the decision resolves. */}
          {!pending&&<div className="world-overlay">
            <div className="minimap-frame"><WorldMinimap resources={env.resources} organisms={presentation.organisms} cam={cam} view={view}/></div>
            <div className="zoom-controls" role="group" aria-label="World view">
              <button aria-label="Zoom out" onClick={()=>setZoomClamped(zoom-.5)} disabled={zoom<=ZOOM_MIN}>−</button>
              <span className="zoom-readout" data-testid="zoom-level">{zoom.toFixed(1)}×</span>
              <button aria-label="Zoom in" onClick={()=>setZoomClamped(zoom+.5)} disabled={zoom>=ZOOM_MAX}>+</button>
              <button aria-label="Reset view" onClick={()=>{setZoom(1);setCam({x:300,y:300})}}>⌂</button>
            </div>
          </div>}
          {/* One sheet slot, two contents. The section is the same DOM node in
              both states, so resolving a decision morphs the sheet in place
              rather than closing one and opening another (AC1). The decision
              CONTENT carries the decision-sheet testid, so it still detaches on
              resolution - the slot outliving it is exactly what proves the morph
              is continuous. A pending decision always outranks an aftermath
              (AC15): it takes the slot and the aftermath record survives
              underneath, to be shown again once this decision resolves. */}
          {(showDecision||showAftermath)&&<section className="decision-sheet" role="dialog" aria-modal="false"
            aria-label={showDecision?(pending!.source==="world_catalyst"?"World catalyst":"Event decision"):"Aftermath"}
            data-testid="sheet-slot" data-mode={showDecision?"decision":"aftermath"}>
            {showDecision
              ? <div data-testid="decision-sheet" data-source={pending!.source}>
                  <span className="eyebrow">{pending!.source==="world_catalyst"?"World catalyst — your move":"A decision is waiting"}</span>
                  <h2>{pending!.prompt}</h2>
                  <p className="decision-context">{pending!.context}</p>
                  <p className="decision-tick">World paused at tick {pending!.createdTick.toLocaleString()}</p>
                  <div className="decision-choices">
                    {pending!.choices.map(choice=><button key={choice.choiceId} data-choice={choice.choiceId}
                      onClick={()=>resolveDecision(choice.choiceId)}>
                      <strong>{choice.title}</strong>
                      <span>{choice.directEffectDescription}</span>
                    </button>)}
                  </div>
                  <p className="decision-foot">Time stays paused until you choose. Leaving an intervention out changes nothing.</p>
                </div>
              : <AftermathPanel aftermath={interp.aftermath} capacity={env.resources.capacity} onAcknowledge={acknowledgeAftermath} busy={acknowledging}/>}
          </section>}
        </div>
      </section>
      <aside className="investigation-rail" aria-label="Investigation">
        {/* A pending decision outranks inspection (AC7): while one is open the
            decision sheet owns the lower screen, so the inspector is not
            rendered at all rather than rendered underneath it. The world
            remains visible as context, and the simulation stays paused exactly
            as the decision contract already guarantees. Nothing about the
            simulation changes; this only decides what is painted. */}
        {surface==="world"&&!pending&&<div className={inspectorOpen?"inspector sheet":"inspector sheet collapsed"}>
          {/* Progressive disclosure: with nothing selected there is no handle
              at all, and with something selected it is a small chip naming
              it — not a permanently expanded full-width bar. */}
          {selected&&<button className="sheet-toggle" onClick={()=>setInspectorOpen(v=>!v)}>
            {inspectorOpen?"Hide details":`Details · #${selected.id}`}
          </button>}
          {inspectorOpen&&<>{selected?<SelectedOrganismCard selected={selected} onViewLineage={()=>{setSelectedCladeId(selected.cladeId);setSurface("tree")}} onClear={()=>setSelectedId(null)}/>:<>
            <span className="eyebrow">World now</span><h2>{m.ecological_outcome}</h2><p className="gloss">{glossOutcome(m.ecological_outcome)}</p><p>{m.population} living · peak {m.peak_population}</p><dl>
              <div><dt>Active</dt><dd>{live.activePopulation}</dd></div>
              <div><dt>Dormant</dt><dd>{live.dormantPopulation}</dd></div>
              <div><dt>Effective niches</dt><dd>{Number(m.effective_niches||0).toFixed(2)}</dd></div>
              <div><dt>Metabolite C</dt><dd>{((m.metabolite_c?.fraction||0)*100).toFixed(0)}%</dd></div>
              <div><dt>Cross-feeders</dt><dd>{((m.metabolic_roles?.crossfeeder_fraction||0)*100).toFixed(0)}%</dd></div>
            </dl>
          </>}</>}
        </div>}

        {surface==="history"&&<section className="panel">
        <div className="panel-head"><div><span className="eyebrow">What happened here?</span><h2>History</h2></div><span>{records.length} durable ecological records</span></div>
        {(()=>{const story=records.find((r)=>r.id===selectedStoryId);if(!story)return null;const ev=story.evidence;const niche=story.kind==="niche";return<article key={story.id} className="story-detail"><span>{formatTickAge(story.tick)} · {story.phase}</span><h3>{story.title}</h3><p>{story.summary}</p>{niche&&<dl className="evidence"><div><dt>Waste load then</dt><dd>{typeof ev.waste_fraction==="number"?`${Math.round(ev.waste_fraction*100)}% of waste-field capacity`:"not measured"}</dd></div><div><dt>Waste load when the regime first formed</dt><dd>{typeof ev.base_waste==="number"?`${Math.round(ev.base_waste*100)}%`:"not measured"}</dd></div><div><dt>Organisms in burden-relevant cells</dt><dd>{typeof ev.waste_exposed_share==="number"?`${Math.round(ev.waste_exposed_share*100)}%`:"not measured"}</dd></div><div><dt>Waste tolerance mean</dt><dd>{typeof ev.tolerance_mean==="number"?ev.tolerance_mean.toFixed(3):"not measured"}</dd></div><div><dt>Waste cleanup mean</dt><dd>{typeof ev.cleanup_mean==="number"?ev.cleanup_mean.toFixed(3):"not measured"}</dd></div></dl>}{niche&&<p className="causal-note"><strong>Observational.</strong> This record pairs the environmental change with a measured strategy shift in the same run. It is not a matched comparison, so it cannot show that the modification caused the shift. Matched evidence for waste reliance exists only in the Slice 2 validation survey, where one of 24 surveyed worlds established such a regime — possible, not typical.</p>}{!niche&&<dl className="evidence"><div><dt>Population then</dt><dd>{ev.population}</dd></div><div><dt>Dormant share</dt><dd>{Math.round((ev.dormant_fraction||0)*100)}%</dd></div><div><dt>Metabolite C energy</dt><dd>{Math.round((ev.c_energy_share||0)*100)}%</dd></div><div><dt>Leading way of life</dt><dd>{String(ev.dominant_role||"—")}</dd></div></dl>}{(()=>{const named=typedRefs(story.entity_refs).map(r=>r.kind==="clade"?formatCladeId(cladeId(r.id)):r.kind==="lineage"?formatLineageId(lineageId(r.id)):null).filter((s):s is string=>s!==null);if(named.length>0)return <p>Entities involved: {named.join(", ")}</p>;if(niche)return <p>No lineage or clade accounted for enough of the interval waste flow to be named.</p>;return null})()}<button onClick={()=>setSelectedStoryId(null)}>Back to all stories</button></article>})()}
        {records.length===0?<><p>No durable ecological arc has been established yet.</p><h3>Recent simulation events</h3>{interp.events.slice(-8).reverse().map((e,i)=><article key={`${e.tick}-${i}`}><span>Tick {e.tick.toLocaleString()}</span><p>{e.label}</p></article>)}</>:records.slice().reverse().map((r)=><article key={r.id}><button className="record-button" onClick={()=>setSelectedStoryId(r.id)}><span>{formatTickAge(r.tick)} · {r.phase}</span><h3>{r.title}</h3><p>{r.summary}</p></button></article>)}
        {snapshot!==null&&snapshot.resolvedDecisions.length>0&&<>
          <h3>Your decisions</h3>
          <p>Actions you took, in order. A decision is an action followed by later outcomes, not a proven cause.</p>
          {snapshot.resolvedDecisions.slice().reverse().map(d=>{
            // A decision's `sourceEventId` is an Event, not a HistoryRecord, so
            // the two identities are deliberately not compared directly: the
            // brand makes that a compile error, which is the point. They are
            // matched on their string form because an event id is derived from
            // the record that produced it (see `observedEvents`).
            const source=d.sourceEventId?records.find(r=>String(r.id)===d.sourceEventId):null;
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
        {(()=>{const clade=clades.find((c)=>c.id===selectedCladeId);if(!clade)return null;const members=presentation.organisms.filter(o=>o.cladeId===clade.id);return<article key={`detail-${clade.id}`} className="lineage-detail"><span className="breadcrumb">Tree → Clade {formatCladeId(clade.id)}</span><h3>{formatCladeId(clade.id)}</h3><p>{clade.count} living · {((clade.share||0)*100).toFixed(0)}% of the world · {members.filter(o=>o.activity==="dormant").length} dormant right now</p><p>{(clade.mutations||[]).join(" + ")||"founder ancestry"} · {formatTickAge(Number(clade.age||0))} old</p><p className="gloss">{clade.count>0?"This family is alive in the world right now.":"No living members — this branch survives only in history."}</p><button onClick={()=>{const first=members[0];if(first){setSelectedId(first.id);setSurface("world")}}}>Locate in world</button><button onClick={()=>setSelectedCladeId(null)}>Back to all clades</button></article>})()}
        <div className="cards">{clades.map((c)=><article key={c.id} style={{borderTopColor:cladeColor(c.id)}}><button className="record-button" onClick={()=>setSelectedCladeId(c.id)}><h3>{formatCladeId(c.id)}</h3><p>{c.count} living · {(c.share*100).toFixed(0)}%</p><small>{(c.mutations||[]).join(" + ")||"founder ancestry"} · {formatTickAge(Number(c.age||0))} old</small></button></article>)}</div>
      </section>}

      {surface==="experiments"&&<section className="panel">
        {/* impl: REQ-UX-001 (World/History/Tree/Experiments investigation surfaces) */}
        <span className="eyebrow">What if this world changed?</span><h2>Experiments</h2>
        {interp.control?<div className="compare"><div><strong>Experiment</strong><span>{live.population} living</span><span>{m.ecological_outcome}</span><span>{formatYear(live.tick)}</span></div><div><strong>Untouched twin</strong><span>{interp.control.population} living</span><span>{interp.control.metrics.ecological_outcome}</span><span>{formatYear(interp.control.tick)}</span></div></div>:<p>No matched control exists yet. Applying an intervention creates an exact twin first.</p>}
        <div className="actions"><button onClick={()=>{if(blockWhilePending())return;runtime.intervene("global")}}>Global nutrient crash</button><button onClick={()=>{if(blockWhilePending())return;runtime.intervene("droughtA")}}>Nutrient A drought</button><button onClick={()=>{if(blockWhilePending())return;runtime.intervene("droughtB")}}>Nutrient B drought</button></div>
        {records.length>0&&<><h3>Histories so far</h3><p>What the experiment branch has lived through — the untouched twin keeps its own time.</p>{records.slice(-4).reverse().map((r)=><article key={r.id}><span>{formatTickAge(r.tick)} · {r.phase}</span><h3>{r.title}</h3></article>)}</>}
      </section>}
      </aside>
    </main>

    <nav className="mobile-nav" aria-label="Mobile navigation">
      {(["world","history","tree","experiments"] as Surface[]).map(s=><button key={s} className={surface===s?"active mnav-btn":"mnav-btn"} onClick={()=>setSurface(s)}><span aria-hidden="true">{s==="world"?"◉":s==="history"?"◔":s==="tree"?"⌘":"⚗"}</span><span>{s.charAt(0).toUpperCase()+s.slice(1)}</span></button>)}
    </nav>

    <footer className={moreOpen?"controls more-open":"controls"}>
      {/* Primary actions first: Play/Pause, speed, and Next meaningful change
          stay on the top row at every width. Save/Resume/Export group below
          so nothing is ever hidden behind unindicated horizontal scrolling.
          The wrappers are `display:contents` on desktop, so the desktop
          control bar is unchanged. */}
      <span className="control-row control-row-primary">
        <button onClick={()=>{if(deadRef.current){setStatus("Simulation stopped — reload to continue");return}if(blockWhilePending())return;setRunning(v=>!v)}}>{running?"Pause":"Play"}</button>
        {/* AC21: bounded speeds only. Max is gone from the product - it was a
            throughput ceiling the player could not read, not a speed, and its
            ratio assertion was the flaky part of #46. The internal
            RUN_TO_NEXT_EVENT command still exists for tooling and tests; it is
            simply not a player control any more. */}
        <select aria-label="Simulation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={100}>100×</option></select>
        {/* Secondary actions are an explicit menu on the phone and nothing at
            all on desktop, where they sit inline as before. Nothing is
            removed: the buttons are always in the DOM. */}
        <button className="control-more" aria-haspopup="true" aria-expanded={moreOpen}
          aria-label="More actions"
          onClick={()=>setMoreOpen(v=>!v)}>More<span className="lens-caret" aria-hidden="true">{moreOpen?"▴":"▾"}</span></button>
      </span>
      <span className="control-row control-row-secondary">
        <button onClick={save}>Save</button>
        <button onClick={load}>Resume</button>
        <button onClick={exportEvidence}>Export</button>
      </span>
      <span className="status" data-testid="runtime-status">{status}</span>
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
        <strong>Engine {ident.engineVersion}</strong>
        <span>Resource accounting residuals: {accounting.length?accounting.map((v:number)=>Number(v).toExponential(2)).join(" / "):"—"}</span>
        <span>Analysis records: {records.length}</span>
        <span>Biology target population rule: none</span>
      </div>}
    </section></div>}
  </div>;
}
