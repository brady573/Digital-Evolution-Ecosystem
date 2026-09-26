import type { FlowFacts, IntervalFlowFacts, IntervalRates, ObservedEvent } from "@digital-evolution/contracts";

export interface ObservationFrame {
  readonly tick: number;
  readonly population: number;
  readonly starting_population: number;
  readonly active_population: number;
  readonly dormant_population: number;
  readonly dormant_fraction: number;
  readonly c_energy_share: number;
  readonly crossfeeder_fraction: number;
  readonly partitioned: boolean;
  readonly dominant_role: string;
  readonly roles: Readonly<Record<string, number>>;
  readonly wake_events: number;
  readonly wake_clades: Readonly<Record<string, number>>;
  readonly dormant_clade_fraction: Readonly<Record<string, number>>;
  readonly clade_totals: Readonly<Record<string, number>>;
  /** Deterministic per-lineage flow facts at this tick (analysis reads, never writes). */
  readonly flows: FlowFacts;
  /** Per-stride biological interval rates ending at this tick. */
  readonly interval: IntervalRates;
  /** Per-lineage interval activity, dead included. Read-only. */
  readonly intervalFlows: IntervalFlowFacts;
  /** Waste field share of capacity (0..1): persistent modification signal. */
  readonly waste_fraction: number;
  /** Share of living organisms in burden-relevant cells (fraction >= half-max). */
  readonly waste_exposed_share: number;
  /** Population mean inherited tolerance / cleanup (strategy bundle). */
  readonly tolerance_mean: number;
  readonly cleanup_mean: number;
}

const CROSSFEED_FORM=.035;
const CROSSFEED_EST=.055;
const CROSSFEED_PERSIST=5000;
const DORMANCY_PERSIST=5000;
const ERA_PERSIST=7500;
// C-use guild thresholds mirror the crossfeeding family: forming at
// the durable-use floor, established strictly above it, collapse below half
// the forming level. Calibrated against balanced-seed-24681357 lineage flows
// (guild forms ~40-45k at 6-16% scavenger share; no lineage exceeds ~15% C
// energy, so lineage-commitment thresholds would never fire: the guild is
// role-defined, lineage-identified). Flagged as Owner-visible constants.
const DEP_FORM_SCAV=.04;
const DEP_FORM_C=.035;
const DEP_EST_SCAV=.06;
const DEP_EST_C=.055;
const DEP_PERSIST=5000;
// Guild collapse is relative to the established level, not absolute: a
// 70%-plus loss of the established guild is a disruption at any scale.
// Production is recorded as measured context, never a second tripwire:
// surveyed shocks starve marginal scavengers long before total C output
// halves, so conjoining production collapse would silence the arc on real
// dynamics. Causal reading belongs to matched-branch comparison, not the
// single-run record (see validation).
const DEP_GUILD_COLLAPSE=.33;
// Major-consumer attribution ranks by absolute C-energy contribution, never by
// within-lineage fraction (a singleton at 100% C must not outrank the guild's
// main supplier). Naming a lineage additionally requires a meaningful guild
// share; otherwise the record stays generic. Owner-visible constant.
const DEP_MAJOR_SHARE=.10;
// Niche-construction (Slice 2) thresholds. Modification first: waste alone
// never suffices. Establishment needs a measured strategy SHIFT relative to
// the forming baseline (exposure, tolerance, or cleanup moving by at least
// NC_STRAT_SHIFT) — a high exposure LEVEL with no movement is occupancy,
// not construction. Calibrated on 0.22 multi-config probes; Owner-visible.
const NC_FORM_WASTE=.05;
const NC_PERSIST=5000;
const NC_EXPOSED=.15;
const NC_STRAT_SHIFT=.05;
const NC_WASTE_COLLAPSE=.5;
// Lineage refs name only meaningful interval waste producers/removers
// (this share of interval flow), else nobody. Named and exported like the
// sibling C-use DEP_MAJOR_SHARE so evidence discloses the naming rule.
const NC_MEANINGFUL_SHARE=.10;

export class EcologyObserver {
  cross={id:"eco-crossfeeding-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null};
  seedbank={id:"eco-seedbank-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null,establishedTick:null as number|null,lastReturnTick:null as number|null,priorDormantClades:{} as Record<string,number>,returnedClades:{} as Record<string,number>};
  era={current:null as string|null,candidate:null as string|null,candidateSince:null as number|null,index:0};
  dep={id:"eco-cuse-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null,establishedTick:null as number|null,estScav:0,baselineProduced:0,topConsumer:null as number|null,topConsumerShare:0};
  niche={id:"eco-niche-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null,establishedTick:null as number|null,baseWaste:0,baseTol:0,baseCu:0,baseExposed:0,estWaste:0,estExposed:0,wasDisrupted:false};
  records:any[]=[];
  eras:any[]=[];

  add(kind:string,id:string,tick:number,phase:string,title:string,summary:string,level:string,evidence:ObservationFrame,refs:number[]=[]){
    const record={id:`${id}-${phase}-${tick}`,arc_id:id,kind,tick,phase,title,summary,level,evidence,entity_refs:refs};
    this.records.push(record);
    return record;
  }

  observe(s:ObservationFrame){
    const cf=s.c_energy_share>=CROSSFEED_EST&&s.crossfeeder_fraction>=.06;
    const cform=s.c_energy_share>=CROSSFEED_FORM&&s.crossfeeder_fraction>=.04;
    const c=this.cross;
    if(c.state==="absent"&&cform){c.state="forming";c.candidateSince=s.tick}
    else if(c.state==="forming"){
      if(!cform){c.state="absent";c.candidateSince=null}
      else if(cf&&c.candidateSince!==null&&s.tick-c.candidateSince>=CROSSFEED_PERSIST){
        c.state="established";c.lowSince=null;
        this.add("crossfeeding",c.id,s.tick,"established","Metabolic recycling became established",`${Math.round(s.c_energy_share*100)}% of recent living energy history comes from biologically produced Metabolite C; ${Math.round(s.crossfeeder_fraction*100)}% of living organisms currently meet the cross-feeder evidence rule.`,"major",s);
      }
    } else if(c.state==="established"){
      if(!cform){
        if(c.lowSince===null)c.lowSince=s.tick;
        if(s.tick-c.lowSince>=CROSSFEED_PERSIST){
          c.state="disrupted";
          this.add("crossfeeding",c.id,s.tick,"disrupted","Metabolic recycling was disrupted","Community use of Metabolite C remained below the durable threshold.","major",s);
        }
      } else c.lowSince=null;
    } else if(c.state==="disrupted"&&cf){
      if(c.candidateSince===null)c.candidateSince=s.tick;
      if(s.tick-c.candidateSince>=CROSSFEED_PERSIST){
        c.state="recovered";
        this.add("crossfeeding",c.id,s.tick,"recovered","Metabolic recycling recovered","Persistent use of biologically produced Metabolite C returned after disruption.","major",s);
        c.state="established";c.candidateSince=null;
      }
    }

    const d=this.seedbank,df=s.dormant_fraction;
    if(d.state==="absent"&&df>=.08){d.state="forming";d.candidateSince=s.tick}
    else if(d.state==="forming"){
      if(df<.04){d.state="absent";d.candidateSince=null}
      else if(df>=.10&&d.candidateSince!==null&&s.tick-d.candidateSince>=DORMANCY_PERSIST){
        d.state="established";d.establishedTick=s.tick;
        this.add("dormancy",d.id,s.tick,"established","A dormant seed bank became established",`${s.dormant_population} living organisms are dormant (${Math.round(df*100)}% of the population).`,"notable",s);
      }
    }

    if(d.state==="established"&&s.wake_events>0&&s.tick-(d.establishedTick||0)>=DORMANCY_PERSIST&&s.tick-(d.lastReturnTick??-1e9)>=DORMANCY_PERSIST*2){
      for(const [clade,n] of Object.entries(s.wake_clades)){
        const prev=d.priorDormantClades[clade];
        if(n>=2&&(prev??0)>=.8&&(s.clade_totals[clade]||0)>=5&&!d.returnedClades[clade]){
          d.returnedClades[clade]=s.tick;d.lastReturnTick=s.tick;
          this.add("dormancy",d.id,s.tick,"recovered","A dormant lineage returned",`Members of clade L-${String(clade).padStart(4,"0")} woke after the clade had been represented primarily by dormant living cells.`,"major",s,[Number(clade)]);
          break;
        }
      }
    }
    d.priorDormantClades={...s.dormant_clade_fraction};

    // C-use guild: a role-defined guild (byproduct scavengers) with
    // lineage-identified top consumers. Wording stays evidence-bounded:
    // decline *followed* measured production loss; causation is never asserted.
    const dd=this.dep,pop=s.population;
    const scav=pop>0?(s.roles.byproduct_scavenger||0)/pop:0;
    const depForm=scav>=DEP_FORM_SCAV&&s.c_energy_share>=DEP_FORM_C;
    const depEst=scav>=DEP_EST_SCAV&&s.c_energy_share>=DEP_EST_C;
    let topConsumer:null|number=null,topConsumerShare=0,topEnergyC=0,guildC=0;
    for(const l of s.flows.lineages){
      const e=l.energyA+l.energyB+l.energyC;
      guildC+=l.energyC;
      if(l.energyC>topEnergyC){topEnergyC=l.energyC;topConsumer=l.lineageId;topConsumerShare=e>0?l.energyC/e:0}
    }
    const topMeaningful=topConsumer!==null&&guildC>0&&topEnergyC/guildC>=DEP_MAJOR_SHARE;
    const topRefs=topMeaningful&&topConsumer!==null?[topConsumer]:[];
    if(dd.state==="absent"&&depForm){dd.state="forming";dd.candidateSince=s.tick}
    else if(dd.state==="forming"){
      if(!depForm){dd.state="absent";dd.candidateSince=null}
      else if(depEst&&dd.candidateSince!==null&&s.tick-dd.candidateSince>=DEP_PERSIST){
        dd.state="established";dd.establishedTick=s.tick;dd.estScav=scav;dd.baselineProduced=s.interval.producedC;
        dd.topConsumer=topMeaningful?topConsumer:null;dd.topConsumerShare=topConsumerShare;dd.lowSince=null;dd.candidateSince=null;
        this.add("cuse",dd.id,s.tick,"established","A C-using guild became established",`${Math.round(scav*100)}% of living organisms meet the byproduct-scavenger evidence rule while ${Math.round(s.c_energy_share*100)}% of living energy history comes from biologically produced Metabolite C.`,"major",s,topRefs);
      }
    } else if(dd.state==="established"){
      // Guild collapse is the tripwire; production is measured context.
      // Never assert causation in a single-run record: matched branches
      // carry that weight, not temporal order.
      if(scav<dd.estScav*DEP_GUILD_COLLAPSE){
        if(dd.lowSince===null)dd.lowSince=s.tick;
        if(s.tick-dd.lowSince>=DEP_PERSIST){
          dd.state="disrupted";dd.candidateSince=null;dd.lowSince=null;
          this.add("cuse",dd.id,s.tick,"disrupted","The C-using guild collapsed",`Scavenger share fell from ${Math.round(dd.estScav*100)}% to ${Math.round(scav*100)}% of the living population; per-stride C production stood at ${Math.round(dd.baselineProduced>0?100*s.interval.producedC/dd.baselineProduced:0)}% of its established level.`,"major",s,dd.topConsumer===null?[]:[dd.topConsumer]);
        }
      } else dd.lowSince=null;
    } else if(dd.state==="disrupted"){
      if(depEst){
        if(dd.candidateSince===null)dd.candidateSince=s.tick;
        if(s.tick-dd.candidateSince>=DEP_PERSIST){
          const same=topConsumer!==null&&topConsumer===dd.topConsumer;
          dd.state="recovered";
          if(!topMeaningful||topConsumer===null){
            this.add("cuse",dd.id,s.tick,"recovered","The C-using guild recovered",`Scavenger share returned to ${Math.round(scav*100)}% of the living population; C use is distributed across lineages; no lineage met the attribution threshold.`,"major",s,[]);
          }else if(same){
            this.add("cuse",dd.id,s.tick,"recovered","The C-using lineage recovered",`Lineage L-${String(topConsumer).padStart(4,"0")} again realizes ${Math.round(topConsumerShare*100)}% of its energy from biologically produced Metabolite C after disruption.`,"major",s,[topConsumer]);
          }else{
            // 10% marks a major consumer, never dominance: in a near-even
            // guild the top lineage leads by deterministic ordering, so the
            // record claims plurality factually (largest share) without a
            // dominance conclusion.
            this.add("cuse",dd.id,s.tick,"recovered","A new lineage became a major C consumer",`Lineage L-${String(topConsumer).padStart(4,"0")} now realizes ${Math.round(topConsumerShare*100)}% of its energy from C, the largest share among living lineages${dd.topConsumer===null?"":`, succeeding L-${String(dd.topConsumer).padStart(4,"0")} after disruption`}.`,"major",s,[topConsumer]);
          }
          dd.state="established";dd.establishedTick=s.tick;dd.estScav=scav;dd.baselineProduced=s.interval.producedC;
          dd.topConsumer=topMeaningful?topConsumer:null;dd.topConsumerShare=topConsumerShare;dd.candidateSince=null;dd.lowSince=null;
        }
      } else dd.candidateSince=null;
    }

    // Niche construction (Slice 2): persistent waste modification paired with
    // a durable measured strategy shift. Modification alone never suffices;
    // temporal pairing is recorded without asserting causation. Strategy is
    // read from movement in the population bundle (exposure, tolerance /
    // cleanup means vs the forming baseline), never a scalar score and never
    // a level. Lineage refs name only meaningful interval waste
    // producers/removers (>=NC_MEANINGFUL_SHARE of interval flow), else
    // nobody; one lineage topping both lists is named once.
    const nc=this.niche;
    const mod=s.waste_fraction>=NC_FORM_WASTE;
    const exposedShift=(s.waste_exposed_share>=NC_EXPOSED)
      &&(s.waste_exposed_share-(nc.baseExposed||0)>=NC_STRAT_SHIFT);
    const stratShift=exposedShift
      ||(s.tolerance_mean-nc.baseTol>=NC_STRAT_SHIFT)
      ||(s.cleanup_mean-nc.baseCu>=NC_STRAT_SHIFT);
    let topProd:null|number=null,topProdShare=0,topRem:null|number=null,topRemShare=0,ivProd=0,ivRem=0;
    for(const l of s.intervalFlows.lineages){ivProd+=l.wasteProduced;ivRem+=l.wasteRemoved}
    for(const l of s.intervalFlows.lineages){
      if(ivProd>0&&l.wasteProduced/ivProd>topProdShare){topProdShare=l.wasteProduced/ivProd;topProd=l.lineageId}
      if(ivRem>0&&l.wasteRemoved/ivRem>topRemShare){topRemShare=l.wasteRemoved/ivRem;topRem=l.lineageId}
    }
    const ncRefs=[...new Set([topProdShare>=NC_MEANINGFUL_SHARE&&topProd!==null?topProd:null,topRemShare>=NC_MEANINGFUL_SHARE&&topRem!==null?topRem:null].filter((v):v is number=>v!==null))];
    if(nc.state==="absent"&&mod){nc.state="forming";nc.candidateSince=s.tick;nc.baseWaste=s.waste_fraction;nc.baseTol=s.tolerance_mean;nc.baseCu=s.cleanup_mean;nc.baseExposed=s.waste_exposed_share}
    else if(nc.state==="forming"){
      if(!mod){nc.state="absent";nc.candidateSince=null}
      else if(nc.candidateSince!==null&&s.tick-nc.candidateSince>=NC_PERSIST&&stratShift){
        const returning=nc.wasDisrupted;
        nc.state="established";nc.establishedTick=s.tick;nc.estWaste=s.waste_fraction;nc.estExposed=s.waste_exposed_share;
        nc.lowSince=null;nc.candidateSince=null;nc.wasDisrupted=false;
        this.add("niche",nc.id,s.tick,returning?"recovered":"established",returning?"The constructed niche returned":"A constructed niche became established",`Waste load ${Math.round(100*s.waste_fraction)}% of waste-field capacity (${Math.round(100*nc.baseWaste)}% when the regime first formed). Exposure: ${Math.round(100*s.waste_exposed_share)}% of organisms in burden-relevant cells (dirty enough to cost energy), up from ${Math.round(100*(nc.baseExposed||0))}%. Tolerance mean ${nc.baseTol.toFixed(2)}->${s.tolerance_mean.toFixed(2)}; cleanup mean ${nc.baseCu.toFixed(2)}->${s.cleanup_mean.toFixed(2)}. The modification and the shift appeared together in time, which is not proof of cause.`,"major",s,ncRefs);
      }
    } else if(nc.state==="established"){
      const modGone=s.waste_fraction<nc.estWaste*NC_WASTE_COLLAPSE;
      // Supersession needs a measured occupancy baseline: a niche
      // established purely via trait shift (estExposed 0) can disrupt but
      // never supersede. Documented asymmetry, not an oversight.
      const replaced=s.waste_fraction>=NC_FORM_WASTE&&nc.estExposed>0&&s.waste_exposed_share<nc.estExposed/3;
      if(modGone||replaced){
        if(nc.lowSince===null)nc.lowSince=s.tick;
        if(s.tick-nc.lowSince>=NC_PERSIST){
          nc.state=replaced?"superseded":"disrupted";nc.wasDisrupted=!replaced;nc.lowSince=null;nc.candidateSince=null;
          this.add("niche",nc.id,s.tick,replaced?"superseded":"disrupted",replaced?"The constructed regime was superseded":"The constructed niche faded",replaced?`Waste persists at ${Math.round(100*s.waste_fraction)}% of capacity but occupancy reorganized: ${Math.round(100*nc.estExposed)}% lived in burden-relevant cells at establishment, ${Math.round(100*s.waste_exposed_share)}% now.`:`Waste load fell from ${Math.round(100*nc.estWaste)}% to ${Math.round(100*s.waste_fraction)}% of waste-field capacity; the modification no longer persists.`,"major",s,ncRefs);
        }
      } else nc.lowSince=null;
    } else if(nc.state==="disrupted"||nc.state==="superseded"){
      // Either terminal state exits to absent once the modification is gone;
      // either re-forms if it returns. Only disruption counts as a return:
      // a regime that was superseded and re-forms narrates as a new
      // establishment, not a recovery.
      if(!mod)nc.state="absent";
      else if(mod){nc.state="forming";nc.candidateSince=s.tick;nc.baseWaste=s.waste_fraction;nc.baseTol=s.tolerance_mean;nc.baseCu=s.cleanup_mean;nc.baseExposed=s.waste_exposed_share}
    }

    d.priorDormantClades={...s.dormant_clade_fraction};

    const pb=s.population===0?"extinct":s.population<s.starting_population*.7?"bottleneck":s.population>s.starting_population*3?"expanded":"established";
    const es=s.c_energy_share>=.2?"biogenic":"primary";
    const db=df>=.25?"high-dormancy":df>=.05?"some-dormancy":"active";
    const sig=`${pb}|${es}|${s.partitioned?"partitioned":"unpartitioned"}|${s.dominant_role}|${db}`;
    const e=this.era;
    if(sig!==e.current){
      if(e.candidate!==sig){e.candidate=sig;e.candidateSince=s.tick}
      else if(e.candidateSince!==null&&s.tick-e.candidateSince>=ERA_PERSIST){
        const prior=e.current;e.current=sig;e.index++;
        const era={id:`eco-era-${e.index}`,kind:"era",start_tick:s.tick,signature:sig,previous_signature:prior,evidence:s};
        this.eras.push(era);
        if(prior!==null)this.add("era",era.id,s.tick,"established","The community entered a new ecological era",`Durable community state changed from ${prior.replaceAll("|"," · ")} to ${sig.replaceAll("|"," · ")}.`,"major",s);
        e.candidate=null;e.candidateSince=null;
      }
    } else {e.candidate=null;e.candidateSince=null}
  }

  clone(){
    return EcologyObserver.restore(this.checkpoint());
  }

  checkpoint(){
    return JSON.parse(JSON.stringify({cross:this.cross,seedbank:this.seedbank,era:this.era,dep:this.dep,niche:this.niche,records:this.records,eras:this.eras}));
  }

  static restore(state:any){
    const observer=new EcologyObserver();
    Object.assign(observer,JSON.parse(JSON.stringify(state)));
    return observer;
  }

  export(){
    return{
      crossfeeding:{...this.cross},
      seed_bank:{...this.seedbank},
      cuse_guild:{...this.dep},
      niche_construction:{...this.niche},
      eras:JSON.parse(JSON.stringify(this.eras)),
      records:JSON.parse(JSON.stringify(this.records)),
      rules:{
        crossfeed_form:CROSSFEED_FORM,
        crossfeed_established:CROSSFEED_EST,
        crossfeed_persistence_ticks:CROSSFEED_PERSIST,
        dormancy_persistence_ticks:DORMANCY_PERSIST,
        era_persistence_ticks:ERA_PERSIST,
        cuse_form_scavenger:DEP_FORM_SCAV,
        cuse_form_c_share:DEP_FORM_C,
        cuse_established_scavenger:DEP_EST_SCAV,
        cuse_established_c_share:DEP_EST_C,
        cuse_persistence_ticks:DEP_PERSIST,
        cuse_collapse_guild_fraction:DEP_GUILD_COLLAPSE,
        cuse_major_consumer_guild_share:DEP_MAJOR_SHARE,
        niche_detector_form_waste:NC_FORM_WASTE,
        niche_detector_persistence_ticks:NC_PERSIST,
        niche_detector_exposed_share:NC_EXPOSED,
        niche_detector_strategy_shift:NC_STRAT_SHIFT,
        niche_detector_waste_collapse_fraction:NC_WASTE_COLLAPSE,
        niche_detector_meaningful_lineage_share:NC_MEANINGFUL_SHARE,
      },
    };
  }

  /**
   * Typed view of this observer's own records for the event-decision path.
   * Analysis remains the authority on whether the evidence supports an event;
   * this only adapts the record shape into the shared ObservedEvent contract so
   * no decision-layer code depends on an untyped analysis payload.
   * Read-only: it does not change detection or any biological state.
   */
  observedEvents(): ObservedEvent[]{
    return this.records.map((record:any)=>({
      schemaVersion:1 as const,
      eventId:String(record.id),
      arcId:String(record.arc_id),
      kind:String(record.kind),
      phase:String(record.phase),
      tick:Number(record.tick),
      level:String(record.level),
      title:String(record.title),
      summary:String(record.summary),
      evidence:Object.fromEntries(
        Object.entries(record.evidence??{}).filter(
          ([,v])=>typeof v==="number"||typeof v==="string"||typeof v==="boolean",
        ) as [string,number|string|boolean][],
      ),
      entityRefs:Array.isArray(record.entity_refs)?record.entity_refs.map(Number):[],
    }));
  }
}
