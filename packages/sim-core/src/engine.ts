/**
 * Compatibility extraction of the v0.29.0 / engine 0.19.0 prototype core, extended to engine 0.20.0 (rich clamp only).
 * Engine 0.21.0 adds the c_washout environmental command (Stage 2); default
 * biological paths are bit-identical, parity-proven. APP_VERSION tracks the
 * product app version (0.31.0); it is metadata and affects no biological behavior.
 *
 * MIGRATION RULE: preserve this algorithm byte-for-byte in behavior while the
 * repository parity harness is active. Structural/type cleanup follows parity,
 * never precedes it.
 *
 * Issue #30 Phase A (A1): the duplicated internal EcologyObserver is no
 * longer instantiated or advanced; sim-analysis owns interpretation and reads
 * immutable facts via observerSnapshot(). The class stays only to decode old
 * checkpoints. Parity proves zero biological change.
 */
import type { EngineConfig, FlowFacts, IntervalFlowFacts } from "@digital-evolution/contracts";
import { APP_VERSION, ENGINE_VERSION, EXPORT_FORMAT_VERSION as EXPORT_VERSION } from "./version";
const Q=(v:number,a:number,b:number):number=>Math.max(a,Math.min(b,v));
const A=(a:number[]):number=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
/** Seeded callable RNG stream with serializable state (legacy extraction; new code prefers DeterministicRng). */
interface LegacyRng{():number;getState():number;setState(v:number):void}
const R=(s:number):LegacyRng=>{let a=s>>>0;let f=(()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}) as LegacyRng;f.getState=()=>a>>>0;f.setState=(v:number)=>{a=v>>>0};return f};
const C_BYPRODUCT_YIELD=.32,C_ENERGY_YIELD=9,C_DECAY_RATE=.00022,C_DIFFUSION_RATE=.06,BU_MAINT_COST=.010,DORMANT_MAINTENANCE=.12,DORMANCY_CHECK=40,CROSSFEED_FORM=.035,CROSSFEED_EST=.055,CROSSFEED_PERSIST=5000,DORMANCY_PERSIST=5000,ERA_PERSIST=7500;
/**
 * Slice 2 initial calibration (issue #30): waste yield per primary mass,
 * capacity scale, spatial rates, burden curve, tolerance/cleanup costs.
 * Tuned for legible dynamics and possible (never guaranteed) niche
 * construction; retune only with survey evidence, never to hit a frequency.
 */
const WASTE_YIELD=.15,WASTE_CAP_FRACTION=.25,WASTE_DIFFUSION=.20,WASTE_DECAY=.0001,WASTE_HALF=.3,WASTE_BURDEN_MAX=.45,WASTE_TOL_EFFICACY=.75,WASTE_TOL_COST=.001,CU_STANDING=.0015,CU_ACTIVE=.6,CU_RATE=.09;
const H01=(seed:number,id:number,salt=0):number=>{let x=(seed^(Math.imul(id+salt,0x9E3779B1)))>>>0;x^=x>>>16;x=Math.imul(x,0x7FEB352D);x^=x>>>15;x=Math.imul(x,0x846CA68B);x^=x>>>16;return(x>>>0)/4294967296};
const C_ACCESS=(bu:number):number=>{let v=Q(bu,0,1.5);return v<=0?0:(v*v)/(v*v+.1024)};
const BUC=(bu:number):number=>BU_MAINT_COST*bu*bu;
const T:Record<string,[string,number,number,string]>={speed:['sp',.25,4,'Movement speed'],sensing:['se',10,180,'Nutrient-sensing range'],metabolism:['me',.04,.5,'Baseline energy use'],reproduction:['rp',55,220,'Energy needed to reproduce'],diet:['di',-1.5,1.5,'Nutrient tendency'],habitat:['ha',-1.5,1.5,'Home-zone preference'],byproduct_use:['bu',0,1.5,'Byproduct use'],dormancy_response:['dr',0,1.5,'Dormancy response'],tolerance:['to',0,1.5,'Waste tolerance'],cleanup:['cu',0,1.5,'Waste cleanup']};
const STUDY_TRAITS=['speed','sensing','metabolism','reproduction','habitat','byproduct_use','dormancy_response','tolerance','cleanup'];
const STRAT_CUT=.25,REALIZED_CUT=.70,REALIZED_MIN_GAIN=45,PART_MIN=.12,PART_WINDOW=25000,PART_PERSIST=.8,PART_COVER=.65,ALIGN_MIN=.55,RECOVERY_HOLD=5000,EVENT_STRIDE=251,FOUNDER_MATURITY_MIN=450,FOUNDER_MATURITY_SPAN=650,OFFSPRING_MATURITY_MIN=700,OFFSPRING_MATURITY_SPAN=500,REPRO_COOLDOWN=450,CLADE_MIN_PEAK=10,CLADE_MIN_AGE=3000;
const F=(n:number):string=>`L-${String(n).padStart(4,'0')}`;
const B=():Record<string,[number,number]>=>Object.fromEntries(Object.keys(T).map(k=>[k,[0,0]])) as Record<string,[number,number]>;
/** Per-stride biological interval counters (births, deaths, resource flows, dormancy transitions). */
interface LineageDelta{consumedA:number;consumedB:number;consumedC:number;energyA:number;energyB:number;energyC:number;producedC:number;births:number;deaths:number;wasteProduced:number;wasteRemoved:number;burdenEnergy:number;cleanupEnergy:number;cleanupExec:number}
interface Interval{births:number;deaths:number;mutation_attempts:number;effective_mutations:number;resources_spawned:number;resources_suppressed:number;resources_consumed:number;spawned_a:number;spawned_b:number;consumed_a:number;consumed_b:number;consumed_c:number;produced_c:number;decayed_c:number;energy_a:number;energy_b:number;energy_c:number;repro_supported_a:number;repro_supported_b:number;repro_supported_mixed:number;repro_supported_c:number;dormancy_entries:number;wakes:number;wake_clades:Record<string,number>;proc_exec_a:number;proc_exec_b:number;proc_exec_c:number;produced_w:number;removed_w:number;decayed_w:number;burden_energy:number;cleanup_energy:number;cleanup_exec:number;[k:string]:number|Record<string,number>}
const I=():Interval=>({births:0,deaths:0,mutation_attempts:0,effective_mutations:0,resources_spawned:0,resources_suppressed:0,resources_consumed:0,spawned_a:0,spawned_b:0,consumed_a:0,consumed_b:0,consumed_c:0,produced_c:0,decayed_c:0,energy_a:0,energy_b:0,energy_c:0,repro_supported_a:0,repro_supported_b:0,repro_supported_mixed:0,repro_supported_c:0,dormancy_entries:0,wakes:0,wake_clades:{},proc_exec_a:0,proc_exec_b:0,proc_exec_c:0,produced_w:0,removed_w:0,decayed_w:0,burden_energy:0,cleanup_energy:0,cleanup_exec:0});
const H_STD=[50000,100000,200000,300000],H_DEEP=[100000,300000,500000,1000000];
const SCI={disclaimer:'Sources inform experimental design and interpretation; the exact simulation equations remain deliberate abstractions.',sources:[
{key:'avida',authors:'Ofria & Wilke',year:2004,title:'Avida: A Software Platform for Research in Computational Evolutionary Biology',doi:'10.1162/106454604773563612',url:'https://doi.org/10.1162/106454604773563612',informs:['digital evolution','controlled experiments']},
{key:'ecology_review',authors:'Dolson & Ofria',year:2021,title:'Digital Evolution for Ecology Research: A Review',doi:'10.3389/fevo.2021.750779',url:'https://doi.org/10.3389/fevo.2021.750779',informs:['ecological niches','competition','spatial eco-evolutionary dynamics']},
{key:'resource_coexistence',authors:'Cooper & Ofria',year:2002,title:'Evolution of Stable Ecosystems in Populations of Digital Organisms',doi:null,url:'https://cse.msu.edu/~ofria/pubs/2002CooperOfria.pdf',informs:['limiting resources','coexistence','multiple niches']},
{key:'replication',authors:'Travisano, Mongold, Bennett & Lenski',year:1995,title:'Experimental Tests of the Roles of Adaptation, Chance, and History in Evolution',doi:'10.1126/science.7809610',url:'https://doi.org/10.1126/science.7809610',informs:['replicated populations','chance and historical contingency']},
{key:'disturbance',authors:'Yedid, Ofria & Lenski',year:2009,title:'Selective Press Extinctions, but Not Random Pulse Extinctions, Cause Delayed Ecological Recovery in Communities of Digital Organisms',doi:'10.1086/597228',url:'https://doi.org/10.1086/597228',informs:['disturbance','recovery','digital communities']},
{key:'tradeoffs',authors:'Stearns',year:1989,title:'Trade-Offs in Life-History Evolution',doi:'10.2307/2389364',url:'https://doi.org/10.2307/2389364',informs:['life-history tradeoffs']},
{key:'rng',authors:'L’Ecuyer, Simard, Chen & Kelton',year:2002,title:'An Object-Oriented Random-Number Package with Many Long Streams and Substreams',doi:'10.1287/opre.50.6.1073.358',url:'https://doi.org/10.1287/opre.50.6.1073.358',informs:['independent RNG streams','synchronized comparisons']},
{key:'diversity',authors:'Chao, Chiu & Jost',year:2014,title:'Unifying Species Diversity, Phylogenetic Diversity, Functional Diversity, and Related Similarity and Differentiation Measures Through Hill Numbers',doi:'10.1146/annurev-ecolsys-120213-091540',url:'https://doi.org/10.1146/annurev-ecolsys-120213-091540',informs:['effective-number diversity','Hill numbers']}
]};
const MC=(s:number):number=>.01*s*s+.004*s*s*s*s;
const MV=(s:number):number=>2.7*Math.tanh(s/2.7);
const PC=(m:number):number=>.8*m+.0055/m;
const SC=(e:number):number=>.000035*Math.max(0,e-100)**2;
const MATCH=(v:number,k:number):number=>k?v:-v;
const PR=(v:number):number=>Math.tanh(1.2*v);
const AE=(d:number,k:number):number=>.35+.9*((PR(MATCH(d,k))+1)/2);
const HP=(h:number,k:number):number=>.6+.8*((PR(MATCH(h,k))+1)/2);
const DC=(d:number):number=>.008*d*d;
const WD=(a:number,b:number):number=>{let d=b-a;if(d>300)d-=600;else if(d<-300)d+=600;return d};
const TD=(a:number,b:number):number=>Math.abs(WD(a,b));
/** Living organism state: inherited traits (sp..dr), spatial/energy state, lifetime resource accounting (ma/mb/mc, ga/gb/gc, ra/rb/rc), lineage link (l). */
interface Organism{id:number;parent:number|null;generation:number;born:number;matureAt:number;readyAt:number;x:number;y:number;en:number;h:number;sp:number;se:number;me:number;rp:number;di:number;ha:number;bu:number;dr:number;activity:string;dormantSince:number|null;wakeCount:number;lastWakeTick:number|null;ma:number;mb:number;mc:number;ga:number;gb:number;gc:number;ra:number;rb:number;rc:number;pc:number;to:number;cu:number;pw:number;l:number;[k:string]:unknown}
const PATCH=(o:Organism):number=>{let da=TD(o.x,155)**2+TD(o.y,210)**2,db=TD(o.x,445)**2+TD(o.y,390)**2;return da<=db?0:1};
const QNT=(a:number[],p:number):number=>{if(!a.length)return 0;let b=[...a].sort((x,y)=>x-y),x=(b.length-1)*p,i=Math.floor(x),f=x-i;return b[i]!+(b[Math.min(i+1,b.length-1)]!-b[i]!)*f};
const MED=(a:number[]):number=>QNT(a,.5),SPREAD=(a:number[])=>({q1:QNT(a,.25),q3:QNT(a,.75),min:a.length?Math.min(...a):0,max:a.length?Math.max(...a):0});
const geneticClass=(o:Organism):string=>o.di<-STRAT_CUT?'a':o.di>STRAT_CUT?'b':'generalist';
const realizedClass=(o:Organism):string=>{let t=o.ga+o.gb;if(t<REALIZED_MIN_GAIN)return'unresolved';let a=o.ga/t;return a>=REALIZED_CUT?'a':a<=1-REALIZED_CUT?'b':'generalist'};
const ecotypeClass=(o:Organism):string=>{let r=realizedClass(o);if(r==='a'&&o.di<-STRAT_CUT&&o.ha<=0)return'a';if(r==='b'&&o.di>STRAT_CUT&&o.ha>=0)return'b';if(r==='generalist'&&Math.abs(o.di)<=STRAT_CUT)return'generalist';return'discordant'};
const friendlyOutcome=(v:string):string=>({'Persistent dual-niche partitioning':'Two stable ways of life','Transient dual-niche partitioning':'Two ways of life are forming','A-adapted dominance':'Nutrient A lifestyle dominates','B-adapted dominance':'Nutrient B lifestyle dominates','Adapted generalist dominance':'Flexible eaters dominate','Discordant resource use':'Eating behavior and inherited tendencies disagree','Mixed eco-strategies':'Several lifestyles are mixed together','Extinction':'Population died out'} as Record<string,string>)[v]||v;
const friendlyResilience=(v:string):string=>({Robust:'Large population',Established:'Established population',Vulnerable:'Small population',Fragile:'Very small population'} as Record<string,string>)[v]||v;
const friendlyResourceState=(v:string):string=>({'Fully utilized':'being used as fast as it appears',Tight:'scarce',Abundant:'plentiful',Balanced:'balanced','Energy-limited':'not supplying enough usable energy'} as Record<string,string>)[v]||v;
const friendlyResponse=(v:string):string=>String(v||'None').replace('Bottleneck ongoing','Population crash still unfolding').replace('Durable recovery after','Recovered and stayed recovered after').replace('No major bottleneck','No major population crash').replace('Moderate decline','Moderate population decline');
const MUTATION_NAMES:Record<string,string>={speed:'movement',sensing:'nutrient-sensing',metabolism:'energy-use',reproduction:'reproduction-energy',diet:'nutrient-tendency',habitat:'home-zone',byproduct_use:'byproduct-use',dormancy_response:'dormancy-response',tolerance:'waste-tolerance',cleanup:'waste-cleanup'};
const friendlyMutation=(a:string[]):string=>!a||!a.length?'founder':a.map(v=>MUTATION_NAMES[v]||v).join(' + ');

const metabolicRole=(o:Organism):string=>{let total=(o.ga||0)+(o.gb||0)+(o.gc||0);if(total<REALIZED_MIN_GAIN)return'unresolved';let cs=(o.gc||0)/total;if(cs>=.15&&C_ACCESS(o.bu||0)>=.35)return'byproduct_scavenger';let p=(o.ga||0)+(o.gb||0);if(p<=0)return'unresolved';let a=(o.ga||0)/p;return a>=REALIZED_CUT?'primary_a':a<=1-REALIZED_CUT?'primary_b':'mixed_primary'};
/**
 * Stage 2 (issue #30) process foundation: the three supported metabolisms as
 * explicit engine-owned processes. Identity, environmental input (field
 * kind), capability/expression factor (access), byproduct output, and
 * execution attribution route through these descriptors; consume() executes
 * them without re-deriving the math. Capability rule: access derives ONLY
 * from inherited organism state (AE/HP/C_ACCESS); analysis never activates,
 * suppresses, or modifies it. Energy yields stay authoritative in the RS
 * field definitions and are read through processYield, so no number here
 * can drift from the fields.
 */
interface BioProcess{id:'primary_a'|'primary_b'|'c_scavenge';kind:0|1|2;access:(o:Organism)=>number;producesByproduct:boolean}
const PROCESSES:Record<number,BioProcess>={
 0:{id:'primary_a',kind:0,access:(o)=>AE(o.di,0)*HP(o.ha,0),producesByproduct:true},
 1:{id:'primary_b',kind:1,access:(o)=>AE(o.di,1)*HP(o.ha,1),producesByproduct:true},
 2:{id:'c_scavenge',kind:2,access:(o)=>C_ACCESS(o.bu||0),producesByproduct:false},
};
function processFor(kind:number):BioProcess{return PROCESSES[kind]!}
function processYield(defs:FieldDef[],kind:number):number{return defs[kind]!.energy_yield}
/** Empty interval facts for pre-first-stride and pre-counter restores. Never mutated. */
const EMPTY_INTERVAL_FLOWS:IntervalFlowFacts={tick:0,strideTicks:EVENT_STRIDE,lineages:[],totals:{netMembers:0,consumedA:0,consumedB:0,consumedC:0,energyA:0,energyB:0,energyC:0,producedC:0,births:0,deaths:0,wasteProduced:0,wasteRemoved:0,burdenEnergy:0,cleanupEnergy:0,cleanupExec:0}};
/**
 * RETAINED ONLY to decode pre-removal checkpoints carrying the
 * "legacy-observer" tag. Never instantiated or advanced: ecological
 * interpretation is solely owned by sim-analysis (see analysisFrame /
 * observeIfDue in sim-runtime). Do not add new readers of this class.
 */
/** Spatial substance definition (abiotic nutrient or biogenic metabolite). */
interface FieldDef{id:string;display_name:string;role:string;energy_yield:number;source_mode:string;regeneration_rate:number|null;diffusion_rate:number;decay_rate:number}
/** Recorded external stock removal (interventions, droughts). */
interface RemovalEvent{tick:number|null;type:string|null;source:string|null;reason:string;amounts:number[];total:number}
interface Lineage{id:number;parent:number;born:number;mutations:string[];peak:number;last:number;established:boolean}
interface Family{id:number;root_lineage:number;born:number;peak:number;last:number;established:boolean}
interface ResponseEpisode{start_tick:number;min_population:number;min_tick:number;durable_recovery_tick:number|null}
/** Disturbance tracking state (bottleneck/recovery bookkeeping, not a story score). */
interface DisturbanceResponse{type:string;tick:number;pre_population:number;deepest_population:number;deepest_tick:number;nutrient_removed_by_type:number[];nutrient_removed_total:number;bottleneck_threshold:number;recovery_threshold:number;recovery_hold_ticks:number;episodes:ResponseEpisode[];active_episode_index:number|null;stable_since:number|null;first_durable_recovery_tick:number|null;durable_recovery_tick:number|null;relapses:number}
interface DroughtState{kind:number;end:number;suppression:number}
interface NicheHistoryPoint{tick:number;partitioned:boolean;effective_niches:number;coverage:number;alignment:number|null}
interface EventLogEntry{tick:number;label:string}
/** Fixed-stratum counter with dynamic class indexing (known strata read precise). */
interface ClassCounts{a:number;generalist:number;b:number;[k:string]:number}
interface ClassEnergy{a:[number,number];generalist:[number,number];b:[number,number];[k:string]:[number,number]}
/** Patch-occupancy bucket; fractions are assigned for every bucket before any read. */
interface OccBucket{a_patch:number;b_patch:number;n:number;a_fraction?:number|null;b_fraction?:number|null}
class EcologyObserver{
 declare cross:{id:string;state:string;candidateSince:number|null;lowSince:number|null};
 declare seedbank:{id:string;state:string;candidateSince:number|null;lowSince:number|null;establishedTick:number|null;lastReturnTick:number|null;priorDormantClades:Record<string,number>;returnedClades:Record<string,number>};
 declare era:{current:string|null;candidate:string|null;candidateSince:number|null;index:number};
 declare records:any[];
 declare eras:any[];
 constructor(){this.cross={id:'eco-crossfeeding-1',state:'absent',candidateSince:null,lowSince:null};this.seedbank={id:'eco-seedbank-1',state:'absent',candidateSince:null,lowSince:null,establishedTick:null,lastReturnTick:null,priorDormantClades:{},returnedClades:{}};this.era={current:null,candidate:null,candidateSince:null,index:0};this.records=[];this.eras=[]}
 add(kind:string,id:string,tick:number,phase:string,title:string,summary:string,level:string,evidence:any,refs:number[]=[]){let r={id:`${id}-${phase}-${tick}`,arc_id:id,kind,tick,phase,title,summary,level,evidence,entity_refs:refs};this.records.push(r);return r}
 observe(s:any){let cf=s.c_energy_share>=CROSSFEED_EST&&s.crossfeeder_fraction>=.06,cform=s.c_energy_share>=CROSSFEED_FORM&&s.crossfeeder_fraction>=.04,c=this.cross;if(c.state==='absent'&&cform){c.state='forming';c.candidateSince=s.tick}else if(c.state==='forming'){if(!cform){c.state='absent';c.candidateSince=null}else if(cf&&s.tick-c.candidateSince!>=CROSSFEED_PERSIST){c.state='established';c.lowSince=null;this.add('crossfeeding',c.id,s.tick,'established','Metabolic recycling became established',`${Math.round(s.c_energy_share*100)}% of recent living energy history comes from biologically produced Metabolite C; ${Math.round(s.crossfeeder_fraction*100)}% of living organisms currently meet the cross-feeder evidence rule.`,'major',s)}}else if(c.state==='established'){if(!cform){if(c.lowSince===null)c.lowSince=s.tick;if(s.tick-c.lowSince!>=CROSSFEED_PERSIST){c.state='disrupted';this.add('crossfeeding',c.id,s.tick,'disrupted','Metabolic recycling was disrupted','Community use of Metabolite C remained below the durable threshold.','major',s)}}else c.lowSince=null}else if(c.state==='disrupted'&&cf){if(c.candidateSince===null)c.candidateSince=s.tick;if(s.tick-c.candidateSince!>=CROSSFEED_PERSIST){c.state='recovered';this.add('crossfeeding',c.id,s.tick,'recovered','Metabolic recycling recovered','Persistent use of biologically produced Metabolite C returned after disruption.','major',s);c.state='established';c.candidateSince=null}}
 let d=this.seedbank,df=s.dormant_fraction;if(d.state==='absent'&&df>=.08){d.state='forming';d.candidateSince=s.tick}else if(d.state==='forming'){if(df<.04){d.state='absent';d.candidateSince=null}else if(df>=.10&&s.tick-d.candidateSince!>=DORMANCY_PERSIST){d.state='established';d.establishedTick=s.tick;this.add('dormancy',d.id,s.tick,'established','A dormant seed bank became established',`${s.dormant_population} living organisms are dormant (${Math.round(df*100)}% of the population).`,'notable',s)}}
 if(d.state==='established'&&s.wake_events>0&&s.tick-(d.establishedTick||0)>=DORMANCY_PERSIST&&s.tick-(d.lastReturnTick||-1e9)>=DORMANCY_PERSIST*2){for(const [clade,n] of Object.entries((s.wake_clades||{}) as Record<string,number>)){let prev=d.priorDormantClades[clade];if(n>=2&&prev!>=.8&&(s.clade_totals?.[clade]||0)>=5&&!d.returnedClades[clade]){d.returnedClades[clade]=s.tick;d.lastReturnTick=s.tick;this.add('dormancy',d.id,s.tick,'recovered','A dormant lineage returned',`Members of clade L-${String(clade).padStart(4,'0')} woke after the clade had been represented primarily by dormant living cells.`,'major',s,[Number(clade)]);break}}}
 d.priorDormantClades={...(s.dormant_clade_fraction||{})};
 let pb=s.population===0?'extinct':s.population<s.starting_population*.7?'bottleneck':s.population>s.starting_population*3?'expanded':'established',es=s.c_energy_share>=.2?'biogenic':'primary',db=df>=.25?'high-dormancy':df>=.05?'some-dormancy':'active',sig=`${pb}|${es}|${s.partitioned?'partitioned':'unpartitioned'}|${s.dominant_role}|${db}`,e=this.era;if(sig!==e.current){if(e.candidate!==sig){e.candidate=sig;e.candidateSince=s.tick}else if(s.tick-e.candidateSince!>=ERA_PERSIST){let prior=e.current;e.current=sig;e.index++;let er={id:`eco-era-${e.index}`,kind:'era',start_tick:s.tick,signature:sig,previous_signature:prior,evidence:s};this.eras.push(er);if(prior!==null)this.add('era',er.id,s.tick,'established','The community entered a new ecological era',`Durable community state changed from ${prior.replaceAll('|',' · ')} to ${sig.replaceAll('|',' · ')}.`,'major',s);e.candidate=null;e.candidateSince=null}}else{e.candidate=null;e.candidateSince=null}
 }
 clone(){let n=new EcologyObserver();Object.assign(n,JSON.parse(JSON.stringify(this)));return n}
 export(){return{crossfeeding:{...this.cross},seed_bank:{...this.seedbank},eras:JSON.parse(JSON.stringify(this.eras)),records:JSON.parse(JSON.stringify(this.records)),rules:{crossfeed_form:CROSSFEED_FORM,crossfeed_established:CROSSFEED_EST,crossfeed_persistence_ticks:CROSSFEED_PERSIST,dormancy_persistence_ticks:DORMANCY_PERSIST,era_persistence_ticks:ERA_PERSIST}}}
}
const FIELD_N=60,FIELD_CELLS=FIELD_N*FIELD_N,FIELD_CELL=600/FIELD_N,FIELD_UPDATE=20,FIELD_UPTAKE=.16,INTERACTIVE_POP_SOFT_LIMIT=5000;
class RS{
 declare n:number;declare cell:number;declare size:number;declare updateStride:number;declare uptake:number;declare enabledByproduct:boolean;
 declare defs:FieldDef[];
 declare stock:Float32Array[];declare cap:Float32Array[];declare source:Float32Array[];
 declare input:number[];declare biologicalProduction:number[];declare consumed:number[];declare decayed:number[];declare externalRemoved:number[];declare removalEvents:RemovalEvent[];declare diffusionAdjustment:number[];declare minFraction:number;declare maxFraction:number;declare lastInput:number[];declare diffusionRate:number[];declare delta:Float32Array[];
 declare sourceBoost:Float64Array[];declare right:Int32Array;declare down:Int32Array;declare minCapRight:Float64Array[];declare minCapDown:Float64Array[];declare totalStock:number[];declare totalCapacity:number[];declare regenLast:Int32Array;declare regenBuckets:number[][];
 declare regenRate:number;declare totalCapTarget:number;declare initialFraction:number;declare initialStock:number[];declare waste:WasteField;
 /** Temporary external C sink (validation washout assays): multiplies C decay while active. Null when absent. */
 declare cSink:{end:number;factor:number}|null;
 constructor(c:EngineConfig){
  this.n=FIELD_N;this.cell=FIELD_CELL;this.size=FIELD_CELLS;this.updateStride=FIELD_UPDATE;this.uptake=FIELD_UPTAKE;this.enabledByproduct=c.enable_byproduct!==false;
  this.defs=[
   {id:'nutrient_a',display_name:'Nutrient A',role:'abiotic_primary',energy_yield:15,source_mode:'seeded_environmental',regeneration_rate:null,diffusion_rate:.08,decay_rate:0},
   {id:'nutrient_b',display_name:'Nutrient B',role:'abiotic_primary',energy_yield:15,source_mode:'seeded_environmental',regeneration_rate:null,diffusion_rate:.08,decay_rate:0},
   {id:'metabolite_c',display_name:'Metabolite C',role:'biogenic_byproduct',energy_yield:C_ENERGY_YIELD,source_mode:'biological_only',regeneration_rate:0,diffusion_rate:C_DIFFUSION_RATE,decay_rate:C_DECAY_RATE}
  ];
  this.stock=Array.from({length:3},()=>new Float32Array(this.size));this.cap=Array.from({length:3},()=>new Float32Array(this.size));this.source=Array.from({length:3},()=>new Float32Array(this.size));
  this.input=[0,0,0];this.biologicalProduction=[0,0,0];this.consumed=[0,0,0];this.decayed=[0,0,0];this.externalRemoved=[0,0,0];this.removalEvents=[];this.diffusionAdjustment=[0,0,0];this.minFraction=1;this.maxFraction=0;this.lastInput=[0,0,0];this.diffusionRate=[.08,.08,C_DIFFUSION_RATE];this.delta=Array.from({length:3},()=>new Float32Array(this.size));
  this.sourceBoost=Array.from({length:3},()=>new Float64Array(this.size));this.right=new Int32Array(this.size);this.down=new Int32Array(this.size);this.minCapRight=Array.from({length:3},()=>new Float64Array(this.size));this.minCapDown=Array.from({length:3},()=>new Float64Array(this.size));this.totalStock=[0,0,0];this.totalCapacity=[0,0,0];this.regenLast=new Int32Array(this.size);this.regenBuckets=Array.from({length:this.updateStride},()=>[]);
  // 0.20.0: rich clamp raised 1.25 -> 8 for larger populations. The formula
  // itself is unchanged, so rich <= 1.25 replays bit-identically to 0.19.0.
  let rr=R((c.seed^0x51ED270B)>>>0),rich=Q(c.prod/1.23,0,8),totalCap=(900+2200*rich)*4,shares=[Math.max(0,1-c.resource_b_fraction),Math.max(0,c.resource_b_fraction)],sumShare=shares[0]!+shares[1]!||1;shares=shares.map(v=>v/sumShare);this.regenRate=(.0005+.00135*rich)/4;this.defs[0]!.regeneration_rate=this.regenRate;this.defs[1]!.regeneration_rate=this.regenRate;this.totalCapTarget=totalCap;this.initialFraction=.28+.48*Q(c.start,0,1);
  for(let kind=0;kind<2;kind++){let weights=new Float64Array(this.size),sum=0,cx=kind?445:155,cy=kind?390:210,sigma=205-105*Q(c.patch,0,1),sep=Q(c.patch,0,1);for(let iy=0;iy<this.n;iy++)for(let ix=0;ix<this.n;ix++){let idx=iy*this.n+ix,x=(ix+.5)*this.cell,y=(iy+.5)*this.cell,dx=WD(x,cx),dy=WD(y,cy),g=Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma)),noise=.88+.24*rr(),w=(1-sep*.82)+sep*(.22+2.6*g);w*=noise;weights[idx]=w;sum+=w}let kindCap=totalCap*shares[kind]!;for(let i=0;i<this.size;i++){let ccap=kindCap?kindCap*weights[i]!/sum:0;this.cap[kind]![i]=ccap;this.source[kind]![i]=weights[i]!;this.stock[kind]![i]=ccap*this.initialFraction*(.92+.16*rr());this.sourceBoost[kind]![i]=.55+.45*Math.min(2,this.source[kind]![i]!);this.totalStock[kind]!+=this.stock[kind]![i]!;this.totalCapacity[kind]!+=this.cap[kind]![i]!}}
  let cCap=this.enabledByproduct?totalCap*1.5:0,per=cCap/this.size;for(let i=0;i<this.size;i++){this.cap[2]![i]=per;this.source[2]![i]=0;this.sourceBoost[2]![i]=0;this.totalCapacity[2]!+=per}
  for(let iy=0;iy<this.n;iy++)for(let ix=0;ix<this.n;ix++){let i=iy*this.n+ix;this.right[i]=iy*this.n+((ix+1)%this.n);this.down[i]=((iy+1)%this.n)*this.n+ix}
  let regenLoad=new Float64Array(this.updateStride);for(let i=0;i<this.size;i++){let phase=0;for(let q=1;q<this.updateStride;q++)if((regenLoad[q]!)<(regenLoad[phase]!))phase=q;this.regenBuckets[phase]!.push(i);regenLoad[phase]!+=this.cap[0]![i]!+this.cap[1]![i]!}
  for(let k=0;k<3;k++)for(let i=0;i<this.size;i++){this.minCapRight[k]![i]=Math.min(this.cap[k]![i]!,this.cap[k]![this.right[i]!]!);this.minCapDown[k]![i]=Math.min(this.cap[k]![i]!,this.cap[k]![this.down[i]!]!)}
  this.initialStock=[...this.totalStock];this.cSink=null;this.waste=new WasteField(this.totalCapTarget,this.updateStride);this.recalcBounds();
 }
 idx(x:number,y:number):number{let ix=Math.floor((((x%600)+600)%600)/this.cell)%this.n,iy=Math.floor((((y%600)+600)%600)/this.cell)%this.n;return iy*this.n+ix}
 fractionAt(kind:number,x:number,y:number):number{let i=this.idx(x,y),c=this.cap[kind]![i]!;return c>1e-9?this.stock[kind]![i]!/c:0}
 amountAt(kind:number,x:number,y:number):number{return this.stock[kind]![this.idx(x,y)]!}
 access(o:Organism,k:number):number{return processFor(k).access(o)}
 scoreIndex(o:Organism,i:number):{score:number;kind:number}{let best=-1,bestKind=0,limit=this.enabledByproduct?3:2;for(let k=0;k<limit;k++){let amt=this.stock[k]![i]!,c=this.cap[k]![i]!;if(c<=1e-9||amt<=1e-9)continue;let score=amt*this.access(o,k);if(score>best){best=score;bestKind=k}}return{score:Math.max(0,best),kind:bestKind}}
 scoreAt(o:Organism,x:number,y:number):{score:number;kind:number}{return this.scoreIndex(o,this.idx(x,y))}
 opportunity(o:Organism):number{let i=this.idx(o.x,o.y),best=0,limit=this.enabledByproduct?3:2;for(let k=0;k<limit;k++){let c=this.cap[k]![i]!,f=c>1e-9?this.stock[k]![i]!/c:0;best=Math.max(best,f*this.access(o,k))}return best}
 sense(o:Organism){let best={score:0,kind:0,angle:o.h},ds=[Q(o.se*.45,15,75),Q(o.se,25,150)];for(const d of ds)for(let j=0;j<8;j++){let a=o.h+j*Math.PI/4,x=(o.x+Math.cos(a)*d+600)%600,y=(o.y+Math.sin(a)*d+600)%600,q=this.scoreIndex(o,this.idx(x,y));if(q.score>best.score){best={...q,angle:a}}}let local=this.scoreIndex(o,this.idx(o.x,o.y));if(local.score>best.score*1.12)best={...local,angle:o.h};return best}
 deposit(kind:number,x:number,y:number,amount:number,cause:string|null=null,interval:Interval|null=null):number{if(amount<=0||kind<0||kind>=this.stock.length)return 0;let i=this.idx(x,y),st=this.stock[kind]!,cp=this.cap[kind]!,room=Math.max(0,cp[i]!-st[i]!),add=Math.min(room,amount);if(add<=0)return 0;st[i]!+=add;this.totalStock[kind]!+=add;this.biologicalProduction[kind]!+=add;if(interval&&kind===2)interval.produced_c+=add;return add}
 consume(o:Organism,interval:Interval){let i=this.idx(o.x,o.y),best=-1,kind=0,limit=this.enabledByproduct?3:2;for(let k=0;k<limit;k++){let amt=this.stock[k]![i]!;if(amt<=1e-9)continue;let score=amt*this.access(o,k);if(score>best){best=score;kind=k}}if(best<=0)return null;let cap=this.cap[kind]![i]!,conc=cap>1e-9?this.stock[kind]![i]!/cap:0,take=Math.min(this.stock[kind]![i]!,this.uptake*(.55+.45*Q(conc,0,1)));if(take<=1e-6)return null;let before=this.stock[kind]![i]!;this.stock[kind]![i]!-=take;this.totalStock[kind]!+=this.stock[kind]![i]!-before;this.consumed[kind]!+=take;if(interval){interval.resources_consumed+=take;if(kind===0){interval.consumed_a+=take;interval.proc_exec_a=(interval.proc_exec_a||0)+1}else if(kind===1){interval.consumed_b+=take;interval.proc_exec_b=(interval.proc_exec_b||0)+1}else{interval.consumed_c+=take;interval.proc_exec_c=(interval.proc_exec_c||0)+1}}/* Frozen asymmetry (parity-protected): habitat preference shapes food
   discovery (selection access) but not digestion yield (AE-only gain).
   Do not 'fix' without an engine-version change. */
   let gain=take*processYield(this.defs,kind)*(kind===2?C_ACCESS(o.bu||0):AE(o.di,kind));let made=0,wmade=0;if(kind<2){wmade=this.waste.deposit(o.x,o.y,take*WASTE_YIELD,interval);o.pw=(o.pw||0)+wmade}
if(this.enabledByproduct&&processFor(kind).producesByproduct){made=this.deposit(2,o.x,o.y,take*C_BYPRODUCT_YIELD,'primary metabolism',interval);o.pc=(o.pc||0)+made}return{kind,amount:take,gain,produced:made,wasteProduced:wmade}}
 diffuse(k:number):void{let st=this.stock[k]!,cp=this.cap[k]!,d=this.delta[k]!,right=this.right,down=this.down,mr=this.minCapRight[k]!,md=this.minCapDown[k]!,rate=this.diffusionRate[k]!;d.fill(0);for(let i=0;i<this.size;i++){let ci=cp[i]!>1e-9?st[i]!/cp[i]!:0,j=right[i]!,cj=cp[j]!>1e-9?st[j]!/cp[j]!:0,flux=rate*(ci-cj)*mr[i]!;d[i]!-=flux;d[j]!+=flux;j=down[i]!;cj=cp[j]!>1e-9?st[j]!/cp[j]!:0;flux=rate*(ci-cj)*md[i]!;d[i]!-=flux;d[j]!+=flux}let adj=0;for(let i=0;i<this.size;i++){let before=st[i]!,raw=before+d[i]!,next=Q(raw,0,cp[i]!);st[i]=next;adj+=next-before}this.totalStock[k]!+=adj;this.diffusionAdjustment[k]!+=adj}
 step(t:number,drought:DroughtState|null,interval:Interval):void{let added=[0,0,0],phase=t%this.updateStride,bucket=this.regenBuckets[phase]!,elapsed=new Int32Array(bucket.length);for(let j=0;j<bucket.length;j++){let i=bucket[j]!;elapsed[j]=Math.max(1,t-this.regenLast[i]!)}for(let k=0;k<2;k++){let factor=drought&&t<drought.end&&k===drought.kind?(1-drought.suppression):1,st=this.stock[k]!,cp=this.cap[k]!,boost=this.sourceBoost[k]!;for(let j=0;j<bucket.length;j++){let i=bucket[j]!,gap=cp[i]!-st[i]!;if(gap<=1e-9)continue;let inc=gap*(1-Math.exp(-this.regenRate*boost[i]!*factor*elapsed[j]!));if(inc>0){let before=st[i]!;st[i]!+=inc;this.totalStock[k]!+=st[i]!-before;added[k]!+=inc}}this.input[k]!+=added[k]!}
  if(this.enabledByproduct){let st=this.stock[2]!,dec=0,decayRate=(this.cSink&&t<this.cSink.end)?C_DECAY_RATE*this.cSink.factor:C_DECAY_RATE;for(let j=0;j<bucket.length;j++){let i=bucket[j]!,e=elapsed[j]!,before=st[i]!,next=before*Math.exp(-decayRate*e),loss=before-next;if(loss>0){st[i]=next;dec+=loss}}this.totalStock[2]!-=dec;this.decayed[2]!+=dec;if(interval)interval.decayed_c+=dec}
  this.waste.stepWaste(t,interval);if(t%100===0){this.diffuse(0);this.diffuse(1);if(this.enabledByproduct)this.diffuse(2)}for(let j=0;j<bucket.length;j++)this.regenLast[bucket[j]!]=t;this.lastInput=added;if(interval){interval.resources_spawned+=added[0]!+added[1]!;interval.spawned_a+=added[0]!;interval.spawned_b+=added[1]!;if(drought&&t<drought.end&&t%this.updateStride===0)interval.resources_suppressed+=1}this.recalcBounds();
 }
 scale(kind:null,factor:number,meta?:{tick:number|null;type:string|null;source:string|null;reason?:string}|null):number[];
 scale(kind:number,factor:number,meta?:{tick:number|null;type:string|null;source:string|null;reason?:string}|null):number;
 scale(kind:number|null,factor:number,meta:{tick:number|null;type:string|null;source:string|null;reason?:string}|null=null):number|number[]{if(kind===null||kind===undefined){let amounts=this.stock.map((_,k)=>this.scale(k,factor));if(meta)this.removalEvents.push({tick:meta.tick??null,type:meta.type||null,source:meta.source||null,reason:meta.reason||'external intervention',amounts:[...amounts],total:amounts.reduce((a,b)=>a+b,0)});return amounts}let st=this.stock[kind]!,removed=0;for(let i=0;i<st.length;i++){let before=st[i]!;st[i]!*=factor;removed+=before-st[i]!}this.externalRemoved[kind]!+=removed;this.totalStock[kind]!-=removed;this.recalcBounds();return removed}
 totals(){let a=this.totalStock[0]!,b=this.totalStock[1]!,c=this.totalStock[2]!,ca=this.totalCapacity[0]!,cb=this.totalCapacity[1]!,cc=this.totalCapacity[2]!,primaryCap=ca+cb,primary=a+b,all=primary+c;return{a,b,c,a_capacity:ca,b_capacity:cb,c_capacity:cc,total:primary,total_with_byproduct:all,total_capacity:primaryCap,total_capacity_with_byproduct:primaryCap+cc,fraction:primaryCap?primary/primaryCap:0,c_fraction:cc?c/cc:0,min_fraction:this.minFraction,max_fraction:this.maxFraction}}
 recalcBounds(){let cap=this.totalCapacity[0]!+this.totalCapacity[1]!,tot=this.totalStock[0]!+this.totalStock[1]!,f=cap?tot/cap:0;this.minFraction=Math.min(this.minFraction,f);this.maxFraction=Math.max(this.maxFraction,f)}
 accounting(){let final=[...this.totalStock],residual=[0,1,2].map(k=>this.initialStock[k]!+this.input[k]!+this.biologicalProduction[k]!-this.consumed[k]!-this.decayed[k]!-this.externalRemoved[k]!+this.diffusionAdjustment[k]!-final[k]!);return{initial_stock:[...this.initialStock],environmental_input:[...this.input],biological_production:[...this.biologicalProduction],biological_consumption:[...this.consumed],decay:[...this.decayed],external_removal:[...this.externalRemoved],diffusion_clamp_adjustment:[...this.diffusionAdjustment],final_stock:final,residual,absolute_residual:residual.map(Math.abs),removal_events:this.removalEvents.map(v=>({...v,amounts:[...v.amounts]})),identity:'initial + environmental input + biological production - biological consumption - decay - external removal + diffusion clamp adjustment = final stock + residual'}}
 clone(){let n=Object.create(RS.prototype);for(const [k,v] of Object.entries(this)){if(v instanceof WasteField)n[k]=v.clone();else if(Array.isArray(v)&&v.length&&ArrayBuffer.isView(v[0]))n[k]=v.map(a=>new a.constructor(a));else if(ArrayBuffer.isView(v))n[k]=new (v.constructor as any)(v);else if(Array.isArray(v))n[k]=v.map(x=>x&&typeof x==='object'?JSON.parse(JSON.stringify(x)):x);else if(v&&typeof v==='object')n[k]=JSON.parse(JSON.stringify(v));else n[k]=v}return n}
 export(){let q=this.totals();return{model:'definition_driven_spatial_substance_field',grid:{width:this.n,height:this.n,cell_world_units:this.cell,toroidal:true},definitions:this.defs.map(v=>({...v})),update_stride_ticks:this.updateStride,uptake_per_tick:this.uptake,totals:q,environmental_input:[...this.input],biological_production:[...this.biologicalProduction],biological_consumption:[...this.consumed],decay:[...this.decayed],external_removal:[...this.externalRemoved],accounting:this.accounting(),stock_fields:this.stock.map(a=>Array.from(a)),capacity_fields:this.cap.map(a=>Array.from(a)),source_fields:this.source.map(a=>Array.from(a))}}
}

/**
 * Slice 2 (issue #30): spatial Metabolic Waste field. NOT food: no energy,
 * no uptake scoring, no environmental regen. Local deposition from primary
 * metabolism, toroidal neighbor diffusion with capacity clamping (same
 * algorithm as nutrients), slow passive decay on a bucketed stride (same
 * cadence idea as nutrient regen), plus biological cleanup. Separate arrays
 * keep legacy A/B/C parity meaningful; same spatial semantics keep the
 * model honest.
 */
class WasteField{
 declare n:number;declare cell:number;declare size:number;
 declare stock:Float32Array;declare cap:Float32Array;
 declare produced:number;declare bioRemoved:number;declare decayed:number;declare clampAdj:number;
 declare diffusionRate:number;declare decayRate:number;
 declare right:Int32Array;declare down:Int32Array;declare delta:Float32Array;
 declare updateStride:number;declare decayLast:Int32Array;declare decayBuckets:number[][];
 constructor(totalCap:number,updateStride:number){
  this.n=FIELD_N;this.cell=FIELD_CELL;this.size=FIELD_CELLS;this.updateStride=updateStride;
  this.diffusionRate=WASTE_DIFFUSION;this.decayRate=WASTE_DECAY;
  let per=totalCap*WASTE_CAP_FRACTION/this.size;
  this.stock=new Float32Array(this.size);this.cap=new Float32Array(this.size).fill(per);
  this.produced=0;this.bioRemoved=0;this.decayed=0;this.clampAdj=0;
  this.right=new Int32Array(this.size);this.down=new Int32Array(this.size);this.delta=new Float32Array(this.size);
  for(let iy=0;iy<this.n;iy++)for(let ix=0;ix<this.n;ix++){let i=iy*this.n+ix;this.right[i]=iy*this.n+((ix+1)%this.n);this.down[i]=((iy+1)%this.n)*this.n+ix}
  this.decayLast=new Int32Array(this.size);this.decayBuckets=Array.from({length:this.updateStride},()=>[] as number[]);
  for(let i=0;i<this.size;i++)this.decayBuckets[i%this.updateStride]!.push(i);
 }
 idx(x:number,y:number):number{let ix=Math.floor((((x%600)+600)%600)/this.cell)%this.n,iy=Math.floor((((y%600)+600)%600)/this.cell)%this.n;return iy*this.n+ix}
 fractionAt(x:number,y:number):number{let i=this.idx(x,y),c=this.cap[i]!;return c>1e-9?this.stock[i]!/c:0}
 amountAt(x:number,y:number):number{return this.stock[this.idx(x,y)]!}
 deposit(x:number,y:number,amount:number,interval:Interval|null):number{
  if(amount<=0)return 0;
  let i=this.idx(x,y),room=Math.max(0,this.cap[i]!-this.stock[i]!),add=Math.min(room,amount);
  if(add<=0)return 0;
  this.stock[i]!+=add;this.produced+=add;
  if(interval)interval.produced_w=(interval.produced_w||0)+add;
  return add;
 }
 removeAt(x:number,y:number,amount:number,interval:Interval|null):number{
  if(amount<=0)return 0;
  let i=this.idx(x,y),take=Math.min(this.stock[i]!,amount);
  if(take<=1e-9)return 0;
  this.stock[i]!-=take;this.bioRemoved+=take;
  if(interval)interval.removed_w=(interval.removed_w||0)+take;
  return take;
 }
 diffuseOne():void{
  let st=this.stock,cp=this.cap,d=this.delta,right=this.right,down=this.down,rate=this.diffusionRate,per=cp[0]!;
  d.fill(0);
  for(let i=0;i<this.size;i++){let ci=cp[i]!>1e-9?st[i]!/cp[i]!:0,j=right[i]!,cj=cp[j]!>1e-9?st[j]!/cp[j]!:0,flux=rate*(ci-cj)*per;d[i]!-=flux;d[j]!+=flux;j=down[i]!;cj=cp[j]!>1e-9?st[j]!/cp[j]!:0;flux=rate*(ci-cj)*per;d[i]!-=flux;d[j]!+=flux}
  let adj=0;for(let i=0;i<this.size;i++){let before=st[i]!,next=Math.max(0,Math.min(cp[i]!,before+d[i]!));st[i]=next;adj+=next-before}
  this.clampAdj+=adj;
 }
 stepWaste(t:number,interval:Interval|null):void{
  let phase=t%this.updateStride,bucket=this.decayBuckets[phase]!,elapsed=new Int32Array(bucket.length);
  for(let j=0;j<bucket.length;j++){let i=bucket[j]!;elapsed[j]=Math.max(1,t-this.decayLast[i]!)}
  let st=this.stock,dec=0;
  for(let j=0;j<bucket.length;j++){let i=bucket[j]!,e=elapsed[j]!,before=st[i]!,next=before*Math.exp(-this.decayRate*e),loss=before-next;if(loss>0){st[i]=next;dec+=loss}}
  this.decayed+=dec;
  if(interval)interval.decayed_w=(interval.decayed_w||0)+dec;
  if(t%100===0)this.diffuseOne();
  for(let j=0;j<bucket.length;j++)this.decayLast[bucket[j]!]=t;
 }
 totals():{stock:number;capacity:number;fraction:number}{let s=0,c=0;for(let i=0;i<this.size;i++){s+=this.stock[i]!;c+=this.cap[i]!}return{stock:s,capacity:c,fraction:c>0?s/c:0}}
 accounting():{identity:string;initial:number;produced:number;bio_removed:number;decayed:number;clamp_adjustment:number;final_stock:number;residual:number}{let final=this.totals().stock,residual=this.produced-this.bioRemoved-this.decayed+this.clampAdj-final;return{identity:'produced - biological removal - decay + clamp adjustment = final stock + residual',initial:0,produced:this.produced,bio_removed:this.bioRemoved,decayed:this.decayed,clamp_adjustment:this.clampAdj,final_stock:final,residual}}
 clone():WasteField{let n=Object.create(WasteField.prototype);for(const [k,v] of Object.entries(this)){if(ArrayBuffer.isView(v))n[k]=new (v.constructor as any)(v);else if(Array.isArray(v))n[k]=v.map(x=>x&&typeof x==='object'?JSON.parse(JSON.stringify(x)):x);else if(v&&typeof v==='object')n[k]=JSON.parse(JSON.stringify(v));else n[k]=v}return n}
 export():{model:string;grid:number;cell_world_units:number;diffusion_rate:number;decay_rate:number;totals:unknown;accounting:unknown}{return{model:'spatial_waste_substance_field',grid:this.n,cell_world_units:this.cell,diffusion_rate:this.diffusionRate,decay_rate:this.decayRate,totals:this.totals(),accounting:this.accounting()}}
}

class S{
 declare c:EngineConfig;declare study:boolean;
 declare rInit:LegacyRng;declare rFood:LegacyRng;declare rMove:LegacyRng;declare rMut:LegacyRng;declare rCat:LegacyRng;
 declare t:number;declare o:Organism[];declare ev:EventLogEntry[];declare sn:any[];declare long:any[];declare longStride:number;declare eventSn:any[];
 declare L:Map<number,Lineage>;declare FAM:Map<number,Family>;declare nL:number;declare nO:number;
 declare peakPopulation:number;declare peakPopulationTick:number;declare tb:Record<string,[number,number]>;
 declare last:Interval;declare cur:Interval;
 declare totalUse:number[];declare totalEnergy:number[];declare totalReproSupport:number[];
 declare resources:RS;declare drought:DroughtState|null;declare response:DisturbanceResponse|null;
 declare extinctTick:number|null;declare extinctionContext:any|null;declare nh:NicheHistoryPoint[];
 declare lineageInterval:Map<number,LineageDelta>;declare lastLineageFlows:IntervalFlowFacts|null;
 constructor(c:EngineConfig){
  this.c={enable_byproduct:c.enable_byproduct!==false,enable_dormancy:c.enable_dormancy!==false,...(c as Omit<EngineConfig,'enable_byproduct'|'enable_dormancy'>)};this.study=!!c.study;
  this.rInit=R((c.seed^0xA341316C)>>>0);this.rFood=R((c.seed^0xC8013EA4)>>>0);this.rMove=R((c.seed^0xAD90777D)>>>0);this.rMut=R((c.seed^0x7E95761E)>>>0);this.rCat=R((c.seed^0x9E3779B9)>>>0);
  this.t=0;this.o=[];this.ev=[];this.sn=[];this.long=[];this.longStride=2503;this.eventSn=[];this.L=new Map;this.FAM=new Map;this.nL=1;this.nO=1;this.peakPopulation=0;this.peakPopulationTick=0;this.tb=B();this.last=I();this.cur=I();this.totalUse=[0,0,0];this.totalEnergy=[0,0,0];this.totalReproSupport=[0,0,0,0];this.resources=new RS(this.c);this.drought=null;this.response=null;this.extinctTick=null;this.extinctionContext=null;this.nh=[];this.lineageInterval=new Map();this.lastLineageFlows=null;
  let ri=this.rInit;
  for(let k=0;k<c.pop;k++){let z=c.div,l=this.newL(0,[]),di=Q((ri()*2-1)*z,-1,1),ha=Q(di*.45+(ri()*2-1)*z*.75,-1,1);let matureAt=FOUNDER_MATURITY_MIN+Math.floor(ri()*FOUNDER_MATURITY_SPAN),id=this.nO++,bu=this.c.enable_byproduct?Q(.04+.28*H01(c.seed,id,17),0,1.5):0,dr=this.c.enable_dormancy?Q(.18+.62*H01(c.seed,id,29),0,1.5):0,to=Q(.05+.25*H01(c.seed,id,41),0,1.5),cu=Q(.05+.25*H01(c.seed,id,53),0,1.5);this.o.push({id,parent:null,generation:0,born:0,matureAt,readyAt:matureAt,x:ri()*600,y:ri()*600,en:60,h:ri()*6.28,sp:Q(1.15*(1+(ri()*2-1)*z),.25,4),se:Q(55*(1+(ri()*2-1)*z),10,180),me:Q(.16*(1+(ri()*2-1)*z),.04,.5),rp:Q(92*(1+(ri()*2-1)*z),55,220),di,ha,bu,dr,to,cu,activity:'active',dormantSince:null,wakeCount:0,lastWakeTick:null,ma:0,mb:0,mc:0,pc:0,pw:0,ga:0,gb:0,gc:0,ra:0,rb:0,rc:0,l})}
  this.peakPopulation=this.o.length;this.updateLineageHistory();this.updateFamilyHistory();this.log('Universe created');if(!this.study)this.long.push(this.pack());
 }
 newL(p:number,m:string[]):number{let id=this.nL++;this.L.set(id,{id,parent:p,born:this.t,mutations:m,peak:0,last:this.t,established:false});return id}
 resourceKind(){return this.rFood()<this.c.resource_b_fraction?1:0}
 mut(n:string,v:number):[number,boolean]{let[k,lo,hi]=T[n]!,r=this.rMut;if((n==='byproduct_use'&&!this.c.enable_byproduct)||(n==='dormancy_response'&&!this.c.enable_dormancy))return[v,false];if(r()>=this.c.mr)return[v,false];this.cur.mutation_attempts++;let additive=n==='diet'||n==='habitat'||n==='byproduct_use'||n==='dormancy_response',p=additive?v+(r()*2-1)*this.c.ms*1.15:v*(1+(r()*2-1)*this.c.ms);if(p<lo)this.tb[n]![0]!++;if(p>hi)this.tb[n]![1]!++;let nv=Q(p,lo,hi),changed=Math.abs(nv-v)>1e-12;if(changed)this.cur.effective_mutations++;return[nv,changed]}
 child(o:Organism):Organism{let q:Record<string,number>={},m:string[]=[];for(let n in T){if((n==='byproduct_use'&&!this.c.enable_byproduct)||(n==='dormancy_response'&&!this.c.enable_dormancy)){q[T[n]![0]!]=(o[T[n]![0]!] as number)||0;continue}let[v,x]=this.mut(n,o[T[n]![0]!] as number);q[T[n]![0]!]=v;if(x)m.push(n)}let ang=this.rMove()*6.28,dist=2+18*Math.sqrt(this.rMove()),matureAt=this.t+OFFSPRING_MATURITY_MIN+Math.floor(this.rMove()*OFFSPRING_MATURITY_SPAN);return{id:this.nO++,parent:o.id,generation:(o.generation||0)+1,born:this.t,matureAt,readyAt:matureAt,x:(o.x+Math.cos(ang)*dist+600)%600,y:(o.y+Math.sin(ang)*dist+600)%600,en:o.en*.92,h:this.rMove()*6.28,sp:q.sp!,se:q.se!,me:q.me!,rp:q.rp!,di:q.di!,ha:q.ha!,bu:q.bu||0,dr:q.dr||0,to:q.to!,cu:q.cu!,activity:'active',dormantSince:null,wakeCount:0,lastWakeTick:null,ma:0,mb:0,mc:0,pc:0,pw:0,ga:0,gb:0,gc:0,ra:0,rb:0,rc:0,l:m.length?this.newL(o.l,m):o.l}}
 reproSupport(o:Organism):number{let t=(o.ra||0)+(o.rb||0)+(o.rc||0);if(t<=0)return 2;let c=(o.rc||0)/t;if(c>=.45)return 3;let p=(o.ra||0)+(o.rb||0),a=p?o.ra/p:.5;return a>=.65?0:a<=.35?1:2}
 catalyst(type:string,src:string):void{
  this.eventSn.push({...this.pack(),phase:'before_catalyst',source:src,catalyst:type});let pre=this.o.length,removed:number[];
  if(type==='global'){removed=this.resources.scale(null,.5,{tick:this.t,type,source:src,reason:'global nutrient crash'});this.log(`Global nutrient crash −50% field stock (${src})`)}
  else if(type==='cWashout'){let r=this.resources.scale(2,0);removed=[0,0];this.resources.cSink={end:this.t+15000,factor:50};this.resources.removalEvents.push({tick:this.t,type,source:src,reason:'Metabolite C washout: stock cleared plus 50x decay sink for 15k ticks',amounts:[0,0,r],total:r});this.log(`Metabolite C washout · environmental C stock removed plus decay sink (${src})`)}
  else{let kind=type==='droughtB'?1:0,r=this.resources.scale(kind,.2);removed=kind?[0,r]:[r,0];this.resources.removalEvents.push({tick:this.t,type,source:src,reason:`Nutrient ${kind?'B':'A'} drought onset`,amounts:[...removed],total:r});this.drought={kind,end:this.t+25000,suppression:.85};this.log(`Nutrient ${kind?'B':'A'} drought · local field stock reduced · regeneration suppressed for 25k ticks (${src})`)}
  this.response={type,tick:this.t,pre_population:pre,deepest_population:pre,deepest_tick:this.t,nutrient_removed_by_type:[...removed],nutrient_removed_total:removed[0]!+removed[1]!,bottleneck_threshold:.6,recovery_threshold:.9,recovery_hold_ticks:RECOVERY_HOLD,episodes:[],active_episode_index:null,stable_since:null,first_durable_recovery_tick:null,durable_recovery_tick:null,relapses:0};
  this.eventSn.push({...this.pack(),phase:'after_catalyst',source:src,catalyst:type});
 }
 localOpportunity(o:Organism):number{return this.resources.opportunity(o)}
 dormancyEntry(o:Organism):boolean{if(!this.c.enable_dormancy||o.activity==='dormant')return false;let r=Q((o.dr||0)/1.5,0,1),energy=o.en/Math.max(55,o.rp),opp=this.localOpportunity(o),eThresh=.34+.20*r,oThresh=.10+.16*r;return energy<eThresh&&opp<oThresh}
 dormancyWake(o:Organism):boolean{let r=Q((o.dr||0)/1.5,0,1),opp=this.localOpportunity(o),wake=.22+.18*r;return opp>wake}
 lineageCredit(l:number,d:{consumedA?:number;consumedB?:number;consumedC?:number;energyA?:number;energyB?:number;energyC?:number;producedC?:number;births?:number;deaths?:number;wasteProduced?:number;wasteRemoved?:number;burdenEnergy?:number;cleanupEnergy?:number;cleanupExec?:number}){
  let m=this.lineageInterval;if(!m)m=this.lineageInterval=new Map();
  let f=m.get(l);
  if(!f){f={consumedA:0,consumedB:0,consumedC:0,energyA:0,energyB:0,energyC:0,producedC:0,births:0,deaths:0,wasteProduced:0,wasteRemoved:0,burdenEnergy:0,cleanupEnergy:0,cleanupExec:0};m.set(l,f)}
  if((f as any).wasteProduced===undefined){f.wasteProduced=0;f.wasteRemoved=0;f.burdenEnergy=0;f.cleanupEnergy=0;f.cleanupExec=0}
  f.consumedA+=d.consumedA||0;f.consumedB+=d.consumedB||0;f.consumedC+=d.consumedC||0;f.energyA+=d.energyA||0;f.energyB+=d.energyB||0;f.energyC+=d.energyC||0;f.producedC+=d.producedC||0;f.births+=d.births||0;f.deaths+=d.deaths||0;f.wasteProduced+=d.wasteProduced||0;f.wasteRemoved+=d.wasteRemoved||0;f.burdenEnergy+=d.burdenEnergy||0;f.cleanupEnergy+=d.cleanupEnergy||0;f.cleanupExec+=d.cleanupExec||0;
 }
 readIntervalFlows():IntervalFlowFacts{
  let lineages:{lineageId:number;netMembers:number;consumedA:number;consumedB:number;consumedC:number;energyA:number;energyB:number;energyC:number;producedC:number;births:number;deaths:number;wasteProduced:number;wasteRemoved:number;burdenEnergy:number;cleanupEnergy:number;cleanupExec:number}[]=[];
  let t={netMembers:0,consumedA:0,consumedB:0,consumedC:0,energyA:0,energyB:0,energyC:0,producedC:0,births:0,deaths:0,wasteProduced:0,wasteRemoved:0,burdenEnergy:0,cleanupEnergy:0,cleanupExec:0};
  for(const [id,f] of (this.lineageInterval||new Map()).entries()){
   let net=f.births-f.deaths;
   lineages.push({lineageId:id,netMembers:net,consumedA:f.consumedA,consumedB:f.consumedB,consumedC:f.consumedC,energyA:f.energyA,energyB:f.energyB,energyC:f.energyC,producedC:f.producedC,births:f.births,deaths:f.deaths,wasteProduced:f.wasteProduced||0,wasteRemoved:f.wasteRemoved||0,burdenEnergy:f.burdenEnergy||0,cleanupEnergy:f.cleanupEnergy||0,cleanupExec:f.cleanupExec||0});
   t.netMembers+=net;t.consumedA+=f.consumedA;t.consumedB+=f.consumedB;t.consumedC+=f.consumedC;t.energyA+=f.energyA;t.energyB+=f.energyB;t.energyC+=f.energyC;t.producedC+=f.producedC;t.births+=f.births;t.deaths+=f.deaths;t.wasteProduced+=(f.wasteProduced||0);t.wasteRemoved+=(f.wasteRemoved||0);t.burdenEnergy+=(f.burdenEnergy||0);t.cleanupEnergy+=(f.cleanupEnergy||0);t.cleanupExec+=(f.cleanupExec||0);
  }
  return{tick:this.t,strideTicks:EVENT_STRIDE,lineages,totals:t};
 }
 flowFacts():FlowFacts{
  let acc=new Map<number,{lineageId:number;members:number;consumedA:number;consumedB:number;consumedC:number;energyA:number;energyB:number;energyC:number;producedC:number}>();
  for(const o of this.o){
   let f=acc.get(o.l);
   if(!f){f={lineageId:o.l,members:0,consumedA:0,consumedB:0,consumedC:0,energyA:0,energyB:0,energyC:0,producedC:0};acc.set(o.l,f)}
   f.members++;f.consumedA+=o.ma;f.consumedB+=o.mb;f.consumedC+=o.mc||0;f.energyA+=o.ga;f.energyB+=o.gb;f.energyC+=o.gc||0;f.producedC+=(o.pc||0);
  }
  let lineages=[...acc.values()],t={members:0,consumedA:0,consumedB:0,consumedC:0,energyA:0,energyB:0,energyC:0,producedC:0};
  for(const f of lineages){t.members+=f.members;t.consumedA+=f.consumedA;t.consumedB+=f.consumedB;t.consumedC+=f.consumedC;t.energyA+=f.energyA;t.energyB+=f.energyB;t.energyC+=f.energyC;t.producedC+=f.producedC}
  return{tick:this.t,lineages,totals:t};
 }
 observerSnapshot(m:any,interval:Interval):any{let roles:Record<string,number>={},cross=0,dormClades:Record<string,number>={},cladeTotals:Record<string,number>={};for(const o of this.o){let role=metabolicRole(o);roles[role]=(roles[role]||0)+1;if(role==='byproduct_scavenger')cross++;let c=this.cladeRoot(o.l);cladeTotals[c]=(cladeTotals[c]||0)+1;if(o.activity==='dormant')dormClades[c]=(dormClades[c]||0)+1}let totalE=(m.resource_energy.a||0)+(m.resource_energy.b||0)+(m.resource_energy.c||0),fra:Record<string,number>={};for(const [c,n] of Object.entries(cladeTotals))fra[c]=(dormClades[c]||0)/n;let dominant=Object.entries(roles).sort((a,b)=>b[1]-a[1])[0]?.[0]||'unresolved';return{tick:this.t,population:m.population,starting_population:this.c.pop,active_population:m.active_population,dormant_population:m.dormant_population,dormant_fraction:m.dormant_fraction,c_energy_share:totalE?m.resource_energy.c/totalE:0,crossfeeder_fraction:m.population?cross/m.population:0,partitioned:m.niche_structure.persistent_partitioning,dominant_role:dominant,roles,wake_events:interval.wakes||0,wake_clades:{...(interval.wake_clades||{})},dormant_clade_fraction:fra,clade_totals:cladeTotals,waste_fraction:(m.waste?m.waste.fraction||0:0),waste_exposed_share:(()=>{let n=0;for(const o of this.o){if(this.resources.waste.fractionAt(o.x,o.y)>=WASTE_HALF)n++}return this.o.length?n/this.o.length:0})(),tolerance_mean:(m.traits&&m.traits.tolerance?m.traits.tolerance.mean||0:0),cleanup_mean:(m.traits&&m.traits.cleanup?m.traits.cleanup.mean||0:0),interval:{producedC:interval.produced_c||0,consumedA:interval.consumed_a||0,consumedB:interval.consumed_b||0,consumedC:interval.consumed_c||0,energyA:interval.energy_a||0,energyB:interval.energy_b||0,energyC:interval.energy_c||0,births:interval.births||0,deaths:interval.deaths||0,wasteProduced:interval.produced_w||0,wasteRemoved:interval.removed_w||0,wasteDecayed:interval.decayed_w||0,burdenEnergy:interval.burden_energy||0,cleanupEnergy:interval.cleanup_energy||0,cleanupExec:interval.cleanup_exec||0},flows:this.flowFacts(),intervalFlows:this.lastLineageFlows||EMPTY_INTERVAL_FLOWS}}
 step(){
  this.t++;if(this.c.st===this.t)this.catalyst(this.c.cat,'scheduled');if(this.drought&&this.t>=this.drought.end){this.log(`Nutrient ${this.drought.kind?'B':'A'} drought ended`);this.drought=null}if(this.resources.cSink&&this.t>=this.resources.cSink.end){this.log('Metabolite C sink dissipated');this.resources.cSink=null}
  this.resources.step(this.t,this.drought,this.cur);let born=[],live=[];
  for(const o of this.o){
   if(o.activity==='dormant'){
    if(((this.t+o.id)%DORMANCY_CHECK)===0&&this.dormancyWake(o)){o.activity='active';o.lastWakeTick=this.t;o.wakeCount=(o.wakeCount||0)+1;o.dormantSince=null;this.cur.wakes++;let cid=this.cladeRoot(o.l);this.cur.wake_clades[cid]=(this.cur.wake_clades[cid]||0)+1}
    if(o.activity==='dormant'){o.en-=(PC(o.me)*DORMANT_MAINTENANCE+SC(o.en)*.08)*this.c.press;if(o.en>0)live.push(o);else{this.cur.deaths++;this.lineageCredit(o.l,{deaths:1})}continue}
   }
   if(((this.t+o.id)%DORMANCY_CHECK)===0&&this.dormancyEntry(o)){o.activity='dormant';o.dormantSince=this.t;this.cur.dormancy_entries++;o.en-=(PC(o.me)*DORMANT_MAINTENANCE)*this.c.press;if(o.en>0)live.push(o);else{this.cur.deaths++;this.lineageCredit(o.l,{deaths:1})}continue}
   if(((this.t+o.id)&3)===0){let sensed=this.resources.sense(o);if(sensed.score>.003)o.h=sensed.angle;else{let pull=.04+.12*Math.abs(o.ha);if(Math.abs(o.ha)>.08&&this.rMove()<pull){let kind=o.ha>0?1:0,cx=kind?445:155,cy=kind?390:210;o.h=Math.atan2(WD(o.y,cy),WD(o.x,cx))+(this.rMove()-.5)*.75}else if(this.rMove()<.10)o.h+=this.rMove()*1.6-.8}}
   let mv=MV(o.sp);o.x=(o.x+Math.cos(o.h)*mv+600)%600;o.y=(o.y+Math.sin(o.h)*mv+600)%600;o.en-=(PC(o.me)+MC(o.sp)+DC(o.di)+SC(o.en)+(this.c.enable_byproduct?BUC(o.bu||0):0))*this.c.press;
   {let wf=this.resources.waste.fractionAt(o.x,o.y),to=Q(o.to||0,0,1.5),cu=Q(o.cu||0,0,1.5);
   if(wf>0||to>0||cu>0){
    let exposure=wf/(wf+WASTE_HALF);
    let burden=WASTE_BURDEN_MAX*exposure*(1-WASTE_TOL_EFFICACY*(to/1.5))+WASTE_TOL_COST*to;
    let cleanCost=CU_STANDING*cu,removed=0;
    if(cu>0&&wf>0){let amt=this.resources.waste.amountAt(o.x,o.y);if(amt>1e-9){let capAct=CU_RATE*(cu/1.5);removed=this.resources.waste.removeAt(o.x,o.y,capAct,this.cur);cleanCost+=CU_ACTIVE*removed}}
    let wcost=(burden+cleanCost)*this.c.press;
    o.en-=wcost;
    this.cur.burden_energy=(this.cur.burden_energy||0)+burden*this.c.press;
    this.cur.cleanup_energy=(this.cur.cleanup_energy||0)+cleanCost*this.c.press;
    if(removed>0){this.cur.cleanup_exec=(this.cur.cleanup_exec||0)+1;this.lineageCredit(o.l,{wasteRemoved:removed,burdenEnergy:burden*this.c.press,cleanupEnergy:cleanCost*this.c.press,cleanupExec:1})}
    else this.lineageCredit(o.l,{burdenEnergy:burden*this.c.press,cleanupEnergy:cleanCost*this.c.press});
   }}
   let eat=this.resources.consume(o,this.cur);if(eat){o.en+=eat.gain;/* Frozen counters (parity-protected): ma/mb/mc count consumption EVENTS,
   not mass. Only read by lineage flow attribution, which labels them as
   counts. Interval deltas carry true mass. Do not 'fix' without an
   engine-version change. */
   if(eat.kind===0){o.ma++;o.ga+=eat.gain;o.ra+=eat.gain;this.cur.energy_a+=eat.gain;this.lineageCredit(o.l,{consumedA:eat.amount,energyA:eat.gain,producedC:eat.produced,wasteProduced:eat.wasteProduced})}else if(eat.kind===1){o.mb++;o.gb+=eat.gain;o.rb+=eat.gain;this.cur.energy_b+=eat.gain;this.lineageCredit(o.l,{consumedB:eat.amount,energyB:eat.gain,producedC:eat.produced,wasteProduced:eat.wasteProduced})}else{o.mc=(o.mc||0)+1;o.gc=(o.gc||0)+eat.gain;o.rc=(o.rc||0)+eat.gain;this.cur.energy_c+=eat.gain;this.lineageCredit(o.l,{consumedC:eat.amount,energyC:eat.gain})}this.totalUse[eat.kind]!+=eat.amount;this.totalEnergy[eat.kind]!+=eat.gain}
   if(this.t>=(o.matureAt||0)&&this.t>=(o.readyAt||0)&&o.en>=o.rp){let support=this.reproSupport(o);this.totalReproSupport[support]!++;if(support===0)this.cur.repro_supported_a++;else if(support===1)this.cur.repro_supported_b++;else if(support===3)this.cur.repro_supported_c++;else this.cur.repro_supported_mixed++;o.ra=0;o.rb=0;o.rc=0;o.en*=.52;o.readyAt=this.t+REPRO_COOLDOWN;let baby=this.child(o);born.push(baby);this.cur.births++;this.lineageCredit(baby.l,{births:1})}if(o.en>0)live.push(o);else{this.cur.deaths++;this.lineageCredit(o.l,{deaths:1})}
  }
  this.o=live.concat(born);if(this.o.length>this.peakPopulation){this.peakPopulation=this.o.length;this.peakPopulationTick=this.t}
  if(!this.o.length&&this.extinctTick===null){this.extinctTick=this.t;let prev=this.sn.length?this.sn[this.sn.length-1]:this.long[this.long.length-1];this.extinctionContext={tick:this.t,previous_snapshot:prev||null,nutrient_field:this.resources.totals(),interval:{...this.cur}};this.log('Population extinct')}
  if(this.response)this.trackResponse();
  if(this.t%EVENT_STRIDE===0){this.updateLineageHistory();this.updateFamilyHistory();let obsM=this.metrics();this.last={...this.cur,wake_clades:{...this.cur.wake_clades}};this.lastLineageFlows=this.readIntervalFlows();this.lineageInterval=new Map();this.cur=I();let ns=obsM.niche_structure;this.nh.push({tick:this.t,partitioned:ns.partitioned_now,effective_niches:ns.effective_niches,coverage:ns.realized_coverage,alignment:ns.spatial.alignment});while(this.nh.length&&this.nh[0]!.tick<this.t-PART_WINDOW)this.nh.shift();if(!this.study){this.sn.push(this.pack());if(this.sn.length>120)this.sn.shift()}}
  if(!this.study&&this.t%this.longStride===0){this.long.push(this.pack());if(this.long.length>500){this.long=this.long.filter((_,i)=>i%2===0);this.longStride*=2}}
 }
 trackResponse(){let r=this.response!,p=this.o.length;if(p<r.deepest_population){r.deepest_population=p;r.deepest_tick=this.t}let b=p<=r.pre_population*r.bottleneck_threshold,rec=p>=r.pre_population*r.recovery_threshold;if(b&&r.active_episode_index===null){if(r.episodes.length)r.relapses++;r.episodes.push({start_tick:this.t,min_population:p,min_tick:this.t,durable_recovery_tick:null});r.active_episode_index=r.episodes.length-1;r.stable_since=null}if(r.active_episode_index!==null){let ep=r.episodes[r.active_episode_index]!;if(p<ep.min_population){ep.min_population=p;ep.min_tick=this.t}if(rec){if(r.stable_since===null)r.stable_since=this.t;if(this.t-r.stable_since!>=r.recovery_hold_ticks){ep.durable_recovery_tick=this.t;r.durable_recovery_tick=this.t;if(r.first_durable_recovery_tick===null)r.first_durable_recovery_tick=this.t;r.active_episode_index=null;r.stable_since=null}}else r.stable_since=null}}
 nicheStructure(withHistory:boolean=true){let n=this.o.length,g:ClassCounts={a:0,generalist:0,b:0},r:ClassCounts&{unresolved:number}={a:0,generalist:0,b:0,unresolved:0},eco:ClassCounts&{discordant:number}={a:0,generalist:0,b:0,discordant:0},occ:Record<string,OccBucket>={a_specialists:{a_patch:0,b_patch:0,n:0},generalists:{a_patch:0,b_patch:0,n:0},b_specialists:{a_patch:0,b_patch:0,n:0}},classEnergy:ClassEnergy={a:[0,0],generalist:[0,0],b:[0,0]};for(const o of this.o){let gc=geneticClass(o),rc=realizedClass(o),ec=ecotypeClass(o);g[gc]!++;r[rc]!++;eco[ec]!++;if(rc!=='unresolved')classEnergy[rc]![0]!+=o.ga,classEnergy[rc]![1]!+=o.gb;if(ec!=='discordant'){let p=PATCH(o),q=(ec==='a'?occ.a_specialists:ec==='b'?occ.b_specialists:occ.generalists)!;q.n++;if(p)q.b_patch++;else q.a_patch++}}
  let genetic={a:n?g.a/n:0,generalist:n?g.generalist/n:0,b:n?g.b/n:0},realized={a:n?r.a/n:0,generalist:n?r.generalist/n:0,b:n?r.b/n:0,unresolved:n?r.unresolved/n:0},ecotypes={a:n?eco.a/n:0,generalist:n?eco.generalist/n:0,b:n?eco.b/n:0,discordant:n?eco.discordant/n:0},resolved=r.a+r.generalist+r.b,coverage=n?resolved/n:0,rps=resolved?[r.a/resolved,r.generalist/resolved,r.b/resolved]:[0,0,0],effective=resolved?1/rps.reduce((z,v)=>z+v*v,0):0,gps=[genetic.a,genetic.generalist,genetic.b],genEff=n?1/gps.reduce((z,v)=>z+v*v,0):0,adapted=eco.a+eco.generalist+eco.b,eps=adapted?[eco.a/adapted,eco.generalist/adapted,eco.b/adapted]:[0,0,0],ecoEff=adapted?1/eps.reduce((z,v)=>z+v*v,0):0;
  for(const q of Object.values(occ)){if(q.n){q.a_fraction=q.a_patch/q.n;q.b_fraction=q.b_patch/q.n}else{q.a_fraction=null;q.b_fraction=null}}
  let alignedN=occ.a_specialists!.n+occ.b_specialists!.n,spatialMeaningful=this.c.patch>=.2&&this.c.resource_b_fraction>.02,aligned=spatialMeaningful&&alignedN?(occ.a_specialists!.a_patch+occ.b_specialists!.b_patch)/alignedN:null,seg=spatialMeaningful&&occ.a_specialists!.n&&occ.b_specialists!.n?Math.abs(occ.a_specialists!.a_fraction!-occ.b_specialists!.a_fraction!):null;
  let fidelity={a:classEnergy.a![0]+classEnergy.a![1]?classEnergy.a![0]/(classEnergy.a![0]+classEnergy.a![1]):null,b:classEnergy.b![0]+classEnergy.b![1]?classEnergy.b![0]/(classEnergy.b![0]+classEnergy.b![1]):null};
  let dual=ecotypes.a>=PART_MIN&&ecotypes.b>=PART_MIN&&coverage>=PART_COVER,spatialGood=dual&&aligned!==null&&aligned>=ALIGN_MIN&&occ.a_specialists!.a_fraction!>=ALIGN_MIN&&occ.b_specialists!.b_fraction!>=ALIGN_MIN,partitioned=dual&&spatialGood,h=withHistory?this.nh:[],persist=h.length?A(h.map(v=>v.partitioned?1:0)):0,windowCoverage=Math.min(1,(h.length*EVENT_STRIDE)/PART_WINDOW),persistent=windowCoverage>=1&&persist>=PART_PERSIST;
  let outcome=n===0?'Extinction':persistent?'Persistent dual-niche partitioning':partitioned?'Transient dual-niche partitioning':ecotypes.a>=.55?'A-adapted dominance':ecotypes.b>=.55?'B-adapted dominance':ecotypes.generalist>=.55?'Adapted generalist dominance':ecotypes.discordant>=.4?'Discordant resource use':'Mixed eco-strategies';
  return{genetic_strategy:genetic,genetic_effective_strategies:genEff,realized_strategy:realized,realized_coverage:coverage,effective_niches:effective,ecotype_strategy:ecotypes,effective_ecotypes:ecoEff,dual_adapted:dual,partitioned_now:partitioned,partition_persistence:persist,partition_window_coverage:windowCoverage,persistent_partitioning:persistent,feeding_fidelity:fidelity,spatial:{...occ,alignment:aligned,segregation:seg},outcome}}
 responseSummary(){let r=this.response;if(!r)return null;let status;if(this.extinctTick!==null)status=`Extinct at ${this.extinctTick.toLocaleString()}`;else if(r.active_episode_index!==null){let ep=r.episodes[r.active_episode_index]!;status=`Bottleneck ongoing · min ${ep.min_population}`}else if(r.episodes.length){let dt=r.durable_recovery_tick!-r.tick;status=`Durable recovery after ${dt.toLocaleString()} ticks${r.relapses?` · ${r.relapses} relapse${r.relapses===1?'':'s'}`:''}`}else if(r.deepest_population<r.pre_population*.8)status='Moderate decline';else status='No major bottleneck';return{...r,active_episode_index:r.active_episode_index,status}}
 updateLineageHistory(){let c=new Map;for(const o of this.o)c.set(o.l,(c.get(o.l)||0)+1);for(const [id,count] of c){let q=this.L.get(id);if(!q)continue;q.peak=Math.max(q.peak,count);q.last=this.t;if(q.peak>=8&&this.t-q.born>=1000)q.established=true}}
 familyRoot(id:number):number{let cur=id,q=this.L.get(cur),guard=0;while(q&&q.parent&&guard++<10000){cur=q.parent;q=this.L.get(cur)}return cur}
 cladeRoot(id:number):number{let cur=id,q=this.L.get(cur),guard=0;while(q&&guard++<10000){if(q.established&&q.peak>=CLADE_MIN_PEAK&&this.t-q.born>=CLADE_MIN_AGE)return q.id;if(!q.parent)break;cur=q.parent;q=this.L.get(cur)}return this.familyRoot(id)}
 updateFamilyHistory(){let c=new Map;for(const o of this.o){let id=this.familyRoot(o.l);c.set(id,(c.get(id)||0)+1)}for(const [id,count] of c){let q=this.FAM.get(id);if(!q){let root=this.L.get(id);q={id,root_lineage:id,born:root?.born||0,peak:0,last:this.t,established:false};this.FAM.set(id,q)}q.peak=Math.max(q.peak,count);q.last=this.t;if(q.peak>=6&&this.t-q.born>=1000)q.established=true}}
 fm(){let c=new Map;for(const o of this.o){let id=this.familyRoot(o.l);c.set(id,(c.get(id)||0)+1)}let n=this.o.length,r=[...c].map(([id,count])=>{let q=this.FAM.get(id)||{id,root_lineage:id,born:0,peak:count,last:this.t,established:false};return{...q,count,share:n?count/n:0,age:this.t-(q.born||0)}}).sort((a,b)=>b.count-a.count),eff=r.length?1/r.reduce((s,x)=>s+x.share*x.share,0):0,est=[...this.FAM.values()].filter(x=>x.established).length;let activeEst=r.filter(x=>x.established).length;return{active:r.length,active_established:activeEst,total:this.FAM.size,effective:eff,established:est,top:r.slice(0,8),dominant:r[0]||null}}
 cm(){let c=new Map;for(const o of this.o){let id=this.cladeRoot(o.l);c.set(id,(c.get(id)||0)+1)}let n=this.o.length,r=[...c].map(([id,count])=>{let q=this.L.get(id),founder=this.familyRoot(id);return{id,root_lineage:id,founder_family:founder,born:q?.born||0,mutations:q?.mutations||[],established:!!q?.established,peak:q?.peak||count,count,share:n?count/n:0,age:this.t-(q?.born||0)}}).sort((a,b)=>b.count-a.count),eff=r.length?1/r.reduce((s,x)=>s+x.share*x.share,0):0;return{active:r.length,effective:eff,top:r.slice(0,10),dominant:r[0]||null,definition:`deepest established mutation branch with peak >= ${CLADE_MIN_PEAK} and age >= ${CLADE_MIN_AGE} ticks; falls back to founder ancestry`}}
 lm(){let c=new Map;for(const o of this.o)c.set(o.l,(c.get(o.l)||0)+1);let n=this.o.length,r=[...c].map(([id,count])=>{let q=this.L.get(id);return{count,share:n?count/n:0,...q!}}).sort((a,b)=>b.count-a.count),eff=r.length?1/r.reduce((s,x)=>s+x.share*x.share,0):0,all=[...this.L.values()],est=all.filter(x=>x.established).length,activeEst=r.filter(x=>x.established).length;return{active:r.length,total:this.L.size,effective:eff,established:est,active_established:activeEst,extinct_established:est-activeEst,top:r.slice(0,5),dominant:r[0]||null}}
 bm(){let x:Record<string,{low:number;high:number;tries:[number,number]}>={};for(let n in T){let[k,lo,hi]=T[n]!,v=this.o.map(o=>o[k] as number),e=(hi-lo)*.05;x[n]={low:v.length?v.filter(a=>a<=lo+e).length/v.length:0,high:v.length?v.filter(a=>a>=hi-e).length/v.length:0,tries:this.tb[n]!}}return x}
 metrics(){
  let tr:Record<string,{mean:number;sd:number;min:number;max:number}>={},norm:number[]=[];for(let n in T){let[k,lo,hi]=T[n]!,v=this.o.map(o=>o[k] as number||0),m=A(v),sd=v.length?Math.sqrt(A(v.map(x=>(x-m)*(x-m)))):0;tr[n]={mean:m,sd,min:v.length?Math.min(...v):0,max:v.length?Math.max(...v):0};norm.push(sd/(hi-lo))}
  let active=this.o.filter(o=>o.activity!=='dormant'),dormant=this.o.length-active.length,move=A(active.map(o=>MC(o.sp)))*this.c.press,base=A(active.map(o=>PC(o.me)))*this.c.press,digest=A(active.map(o=>DC(o.di)))*this.c.press,byCost=A(active.map(o=>this.c.enable_byproduct?BUC(o.bu||0):0))*this.c.press,total=move+base+digest+byCost,use=this.totalUse.reduce((a,b)=>a+b,0),eg=this.totalEnergy.reduce((a,b)=>a+b,0),spec=A(this.o.map(o=>Math.abs(o.di))),hspec=A(this.o.map(o=>Math.abs(o.ha))),ns=this.nicheStructure(),liveEnergy=[0,0,0],roles:Record<string,number>={};for(const o of this.o){liveEnergy[0]!+=o.ga||0;liveEnergy[1]!+=o.gb||0;liveEnergy[2]!+=o.gc||0;let role=metabolicRole(o);roles[role]=(roles[role]||0)+1}let leg=liveEnergy.reduce((a,b)=>a+b,0),rep=this.totalReproSupport.reduce((a,b)=>a+b,0),rf=this.resources.totals();
  let ages=this.o.map(o=>this.t-(o.born||0)),gens=this.o.map(o=>o.generation||0),mature=this.o.filter(o=>this.t>=(o.matureAt||0)).length;return{population:this.o.length,active_population:active.length,dormant_population:dormant,dormant_fraction:this.o.length?dormant/this.o.length:0,starting_population:this.c.pop,peak_population:this.peakPopulation,peak_population_tick:this.peakPopulationTick,mean_age:A(ages),mean_generation:A(gens),mature_fraction:this.o.length?mature/this.o.length:0,resources:rf.total,nutrient_field:{...rf,grid_size:this.resources.n,cell_world_units:this.resources.cell,total_input:[...this.resources.input],biological_production:[...this.resources.biologicalProduction],total_consumed:[...this.resources.consumed],total_decay:[...this.resources.decayed],total_external_removal:[...this.resources.externalRemoved],accounting:this.resources.accounting()},metabolite_c:{stock:rf.c,capacity:rf.c_capacity,fraction:rf.c_fraction,produced:this.resources.biologicalProduction[2],consumed:this.resources.consumed[2],decayed:this.resources.decayed[2]},waste:{stock:this.resources.waste.totals().stock,capacity:this.resources.waste.totals().capacity,fraction:this.resources.waste.totals().fraction,produced:this.resources.waste.produced,removed:this.resources.waste.bioRemoved,decayed:this.resources.waste.decayed},renewable_biomass:{a:rf.a,b:rf.b,a_capacity:rf.a_capacity,b_capacity:rf.b_capacity,fraction:rf.fraction,min_fraction:rf.min_fraction},trait_diversity:A(norm),niche_specialization:spec,habitat_specialization:hspec,diet_bias:tr.diet!.mean,habitat_bias:tr.habitat!.mean,traits:tr,niche_structure:ns,effective_niches:ns.effective_niches,ecological_outcome:ns.outcome,metabolic_roles:{counts:roles,crossfeeder_fraction:this.o.length?(roles.byproduct_scavenger||0)/this.o.length:0},lineages:this.lm(),families:this.fm(),clades:this.cm(),bounds:this.bm(),resource_use:{a:this.totalUse[0]!,b:this.totalUse[1]!,c:this.totalUse[2]!,a_share:use?this.totalUse[0]!/use:0.5,c_share:use?this.totalUse[2]!/use:0},resource_energy:{a:this.totalEnergy[0]!,b:this.totalEnergy[1]!,c:this.totalEnergy[2]!,a_share:eg?this.totalEnergy[0]!/eg:0.5,c_share:eg?this.totalEnergy[2]!/eg:0,living_a:liveEnergy[0],living_b:liveEnergy[1]!,living_c:liveEnergy[2]!,living_c_share:leg?liveEnergy[2]!/leg:null},reproductive_support:{a:this.totalReproSupport[0]!,b:this.totalReproSupport[1]!,mixed:this.totalReproSupport[2]!,c:this.totalReproSupport[3]!,a_share:rep?this.totalReproSupport[0]!/rep:null,b_share:rep?this.totalReproSupport[1]!/rep:null,c_share:rep?this.totalReproSupport[3]!/rep:null},energy:{movement_per_tick:move,metabolism_per_tick:base,diet_specialization_per_tick:digest,byproduct_processing_per_tick:byCost,total_per_tick:total,movement_share:total?move/total:0},extinct_tick:this.extinctTick,disturbance_response:this.responseSummary()}
 }
 pack(){let m=this.metrics();return{tick:this.t,population:m.population,active_population:m.active_population,dormant_population:m.dormant_population,dormant_fraction:m.dormant_fraction,resources:m.resources,metabolite_c:m.metabolite_c,waste:m.waste,trait_diversity:m.trait_diversity,niche_specialization:m.niche_specialization,habitat_specialization:m.habitat_specialization,diet_bias:m.diet_bias,habitat_bias:m.habitat_bias,effective_niches:m.effective_niches,ecological_outcome:m.ecological_outcome,metabolic_roles:m.metabolic_roles,niche_structure:m.niche_structure,extinct_tick:m.extinct_tick,traits:m.traits,lineages:{active:m.lineages.active,effective:m.lineages.effective,established:m.lineages.established,active_established:m.lineages.active_established,dominant:m.lineages.dominant},families:m.families,clades:m.clades,population_lifecycle:{mean_age:m.mean_age,mean_generation:m.mean_generation,mature_fraction:m.mature_fraction},renewable_biomass:m.renewable_biomass,resource_use:m.resource_use,resource_energy:m.resource_energy,reproductive_support:m.reproductive_support,bounds:m.bounds,energy:m.energy,disturbance_response:m.disturbance_response,interval:this.last}}
 log(label:string):void{this.ev.push({tick:this.t,label})}
 roll(window:number=5000){let m=this.metrics(),samples=this.sn.filter(x=>x.tick>=this.t-window),start=samples[0]||this.long[0]||this.pack(),intervals=samples.slice(-Math.max(1,Math.ceil(window/250))),sum=(k:string)=>intervals.reduce((q,v)=>q+(v.interval?.[k]||0),0),births=sum('births'),deaths=sum('deaths'),input=sum('resources_spawned'),suppressed=sum('resources_suppressed'),consumed=sum('resources_consumed'),ca=sum('consumed_a'),cb=sum('consumed_b'),ea=sum('energy_a'),eb=sum('energy_b'),rsa=sum('repro_supported_a'),rsb=sum('repro_supported_b'),rsm=sum('repro_supported_mixed'),avgStock=A(intervals.map(v=>v.resources)),popChange=start.population?(m.population-start.population)/start.population:0,util=input?consumed/input:0,trend=m.population===0?'Extinct':popChange>.08?'Growing':popChange<-.08?'Declining':'Stable',resilience=m.population===0?'Extinct':m.population<20?'Fragile':m.population<50?'Vulnerable':m.population<100?'Established':'Robust',stockFrac=m.nutrient_field?.fraction??1,resourceState=stockFrac<.10?'Depleted':stockFrac<.28?'Tight':stockFrac>.72?'Abundant':'Balanced';return{window_ticks:window,population_change:popChange,births,deaths,resources_spawned:input,resources_suppressed:suppressed,resources_consumed:consumed,consumed_a:ca,consumed_b:cb,energy_a:ea,energy_b:eb,repro_supported_a:rsa,repro_supported_b:rsb,repro_supported_mixed:rsm,resource_utilization:util,average_resource_stock:avgStock,average_stock_fraction:stockFrac,renewable_biomass_fraction:stockFrac,population_trend:trend,population_resilience:resilience,resilience_basis:'descriptive current population class; no biological rule uses these labels',resource_state:resourceState}}
 ins(){let m=this.metrics(),r=this.roll(),ns=m.niche_structure,p=(ns.partition_persistence*100).toFixed(0),align=ns.spatial.alignment===null?'not measurable':`${(ns.spatial.alignment*100).toFixed(0)}%`,rr=ns.realized_strategy,energy=r.energy_a+r.energy_b,ea=energy?r.energy_a/energy:.5,nf=m.nutrient_field;let h=[m.population===0?`The population went extinct at tick ${this.extinctTick?.toLocaleString()||this.t.toLocaleString()}.`:`The population is ${r.population_trend.toLowerCase()} over the last 5k ticks (${r.population_change>=0?'+':''}${(r.population_change*100).toFixed(1)}%). Current population size is ${friendlyResilience(r.population_resilience).toLowerCase()}.`,`Environmental nutrient stock is ${friendlyResourceState(r.resource_state).toLowerCase()} at ${(nf.fraction*100).toFixed(0)}% of local field capacity. Recent uptake/input ratio is ${Number.isFinite(r.resource_utilization)?(r.resource_utilization*100).toFixed(0):'—'}%.`,`What they actually use: ${(rr.a*100).toFixed(0)}% mostly A / ${(rr.generalist*100).toFixed(0)}% both / ${(rr.b*100).toFixed(0)}% mostly B. Recent assimilated energy came ${(ea*100).toFixed(0)}% from Nutrient A and ${((1-ea)*100).toFixed(0)}% from Nutrient B.`,`Two adapted ways of life stayed separate for ${p}% of the last ${Math.round(PART_WINDOW/1000)}k ticks; ${(align==='not measurable'?'zone matching is not measurable yet':`${align} are in the matching nutrient zone`)}.`,`No inherited trait is strongly pressing against an artificial limit.`];let bp=Object.entries(m.bounds).find(([,v])=>v.low>.25||v.high>.25);if(bp)h[4]=`${T[bp[0]]![3]} is crowding the ${bp[1].low>bp[1].high?'low':'high'} end of its allowed range.`;let d=m.lineages.dominant,story=m.population===0?`Extinction. Environmental nutrient remained measurable after the last organism died; use History for an evidence-based extinction autopsy.`:`${friendlyOutcome(ns.outcome)}. `+(d?`${F(d.id)} began ${(this.t-d.born).toLocaleString()} ticks ago after a ${friendlyMutation(d.mutations)} change and now makes up ${(d.share*100).toFixed(1)}% of the population.`:'No family line currently dominates.');if(m.disturbance_response)story+=` Latest disturbance: ${friendlyResponse(m.disturbance_response.status)}.`;return{population_trend:r.population_trend,population_resilience:r.population_resilience,resource_state:r.resource_state,rolling:r,h,story}}
 clone(){let cp=(v:any):any=>typeof (globalThis as any).structuredClone==='function'?(globalThis as any).structuredClone(v):JSON.parse(JSON.stringify(v)),n=Object.create(S.prototype);for(const [k,v] of Object.entries(this)){if(typeof v==='function'&&v.getState){let r=R(0);r.setState(v.getState());n[k]=r}else if(v instanceof RS)n[k]=v.clone();else if(v instanceof EcologyObserver)n[k]=v.clone();else if(v instanceof Map)n[k]=new Map([...v].map(([a,b])=>[a,cp(b)]));else n[k]=cp(v)}return n}
 out(){let field=this.resources.export();return{format_version:EXPORT_VERSION,app_version:APP_VERSION,engine_version:ENGINE_VERSION,display_profile:'living-evolution-explorer',identity_model:{stable_creature_ids:true,parent_ids:true,generation:true,birth_tick:true,founder_families:true,dynamic_clades:true,next_creature_id:this.nO},interpretation_model:{rolling_window_ticks:5000,trait_diversity:'mean normalized standard deviation across eight evolvable traits',metabolic_role:'parallel realized-energy analysis; byproduct cross-feeder requires sufficient realized C energy plus inherited byproduct-use access',dormancy:'reversible phenotypic activity state; dormant organisms remain living but do not move, feed, or reproduce',persistent_partitioning:`legacy A/B ecological partitioning retained; partitioning present in >= ${PART_PERSIST} of a ${PART_WINDOW}-tick rolling window`,ecology_observer:'fixed-cadence analysis only; observer cannot mutate biological state'},model:{stage:'motile asexual microbes with abiotic primary nutrients, biologically produced Metabolite C, evolved cross-feeding, and reversible dormancy',movement_cost:'0.01*speed^2 + 0.004*speed^4',physiology_cost:'0.8*metabolism + 0.0055/metabolism',byproduct_processing_cost:`${BU_MAINT_COST}*byproduct_use^2 per active tick before pressure scaling`,dormant_maintenance_fraction:DORMANT_MAINTENANCE,byproduct_yield:C_BYPRODUCT_YIELD,metabolite_c_energy_yield:C_ENERGY_YIELD,metabolite_c_decay_rate:C_DECAY_RATE,population_target_rule:false,trait_ranges:Object.fromEntries(Object.entries(T).map(([n,[,lo,hi]])=>[n,[lo,hi]])),mutation_size:this.c.ms,rng_streams:'separate init/resource/behavior/mutation/catalyst streams',world_geometry:'600x600 toroidal; 60x60 substance fields'},seed:this.c.seed,tick:this.t,configuration:this.c,current_metrics:this.metrics(),rolling_summary:this.roll(),evolutionary_insights:this.ins(),last_interval:this.last,events:this.ev,recent_snapshots:this.sn,long_snapshots:this.long,event_snapshots:this.eventSn,lineages:[...this.L.values()],families:[...this.FAM.values()],clade_definition:this.cm().definition,resource_system:field,extinction_context:this.extinctionContext,extinction_autopsy:this.extinctionReport(),living_creatures:this.o.map(o=>({id:o.id,parent:o.parent,generation:o.generation,born:o.born,matureAt:o.matureAt,readyAt:o.readyAt,lineage:o.l,family:this.familyRoot(o.l),clade:this.cladeRoot(o.l),energy:o.en,x:o.x,y:o.y,activity:o.activity||'active',dormantSince:o.dormantSince??null,wakeCount:o.wakeCount||0,lastWakeTick:o.lastWakeTick??null,metabolic_role:metabolicRole(o),traits:{speed:o.sp,sensing:o.se,metabolism:o.me,reproduction:o.rp,diet:o.di,habitat:o.ha,byproduct_use:o.bu||0,dormancy_response:o.dr||0,tolerance:o.to||0,cleanup:o.cu||0},feeding:{a_energy:o.ga||0,b_energy:o.gb||0,c_energy:o.gc||0}})),boundary_attempts:this.tb}}
 extinctionReport(){if(this.extinctTick===null)return null;let hist=[...this.long,...this.sn].filter(x=>x&&x.population>0&&x.tick<=(this.extinctTick!)).sort((a,b)=>a.tick-b.tick),last=hist[hist.length-1]||this.extinctionContext?.previous_snapshot||null,target=this.extinctTick-25000,before=null;for(const q of hist)if(q.tick<=target)before=q;let nf=this.resources.totals(),interval=this.extinctionContext?.interval||{};return{extinct_tick:this.extinctTick,peak_population:this.peakPopulation,peak_population_tick:this.peakPopulationTick,last_living_snapshot:last,population_25k_before:before?.population??null,nutrient_fraction_at_extinction:nf.fraction,nutrient_stock_at_extinction:nf.total,nutrient_capacity:nf.total_capacity,recent_interval_births:interval.births??null,recent_interval_deaths:interval.deaths??null,last_dominant_clade:last?.clades?.dominant||null,last_ecological_outcome:last?.ecological_outcome||null,interpretation:'Evidence summary only; no single causal explanation is asserted.'}}

}


const CHECKPOINT_TAG="__digital_evolution_type";
function encodeCheckpointValue(v:any):any{
 if(v===undefined)return{[CHECKPOINT_TAG]:"undefined"};
 if(typeof v==="number"&&!Number.isFinite(v))return{[CHECKPOINT_TAG]:"number",value:String(v)};
 if(typeof v==="function"&&typeof v.getState==="function")return{[CHECKPOINT_TAG]:"rng",state:v.getState()};
 if(v instanceof S)return{[CHECKPOINT_TAG]:"simulation",props:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encodeCheckpointValue(x)]))};
 if(v instanceof RS)return{[CHECKPOINT_TAG]:"resource-system",props:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encodeCheckpointValue(x)]))};
 if(v instanceof WasteField)return{[CHECKPOINT_TAG]:"waste-field",props:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encodeCheckpointValue(x)]))};
 if(v instanceof EcologyObserver)return{[CHECKPOINT_TAG]:"legacy-observer",props:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encodeCheckpointValue(x)]))};
 if(v instanceof Map)return{[CHECKPOINT_TAG]:"map",entries:[...v].map(([k,x])=>[encodeCheckpointValue(k),encodeCheckpointValue(x)])};
 if(ArrayBuffer.isView(v)&&!(v instanceof DataView))return{[CHECKPOINT_TAG]:"typed-array",ctor:v.constructor.name,values:Array.from(v as unknown as ArrayLike<number>)};
 if(Array.isArray(v))return v.map(encodeCheckpointValue);
 if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encodeCheckpointValue(x)]));
 return v;
}
function decodeCheckpointValue(v:any):any{
 if(Array.isArray(v))return v.map(decodeCheckpointValue);
 if(!v||typeof v!=="object")return v;
 let tag=v[CHECKPOINT_TAG];
 if(tag==="undefined")return undefined;
 if(tag==="number")return v.value==="NaN"?NaN:v.value==="Infinity"?Infinity:-Infinity;
 if(tag==="rng"){let r=R(0);r.setState(v.state);return r}
 if(tag==="typed-array"){let C:any={Float32Array,Float64Array,Int32Array,Uint32Array,Uint16Array,Uint8Array,Int16Array,Int8Array}[(v.ctor as string)];if(!C)throw new Error("Unsupported checkpoint typed array: "+v.ctor);return new C(v.values)}
 if(tag==="map")return new Map(v.entries.map(([k,x]:any)=>[decodeCheckpointValue(k),decodeCheckpointValue(x)]));
 if(tag==="simulation"||tag==="resource-system"||tag==="legacy-observer"||tag==="waste-field"){
  let o=Object.create(tag==="simulation"?S.prototype:tag==="resource-system"?RS.prototype:tag==="waste-field"?WasteField.prototype:EcologyObserver.prototype);
  for(const [k,x] of Object.entries(v.props))o[k]=decodeCheckpointValue(x);
  return o;
 }
 return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decodeCheckpointValue(x)]));
}
function createSimulationCheckpoint(sim:S){
 return{checkpoint_schema_version:"0.1",engine_version:ENGINE_VERSION,tick:sim.t,seed:sim.c.seed,state:encodeCheckpointValue(sim)};
}
function restoreSimulationCheckpoint(checkpoint:any):S{
 if(!checkpoint||checkpoint.checkpoint_schema_version!=="0.1")throw new Error("Unsupported checkpoint schema");
 if(checkpoint.engine_version!==ENGINE_VERSION)throw new Error(`Checkpoint engine ${checkpoint.engine_version} cannot be restored by engine ${ENGINE_VERSION}`);
 let sim=decodeCheckpointValue(checkpoint.state);
 if(!(sim instanceof S))throw new Error("Checkpoint did not contain a simulation");
 return sim;
}

export {
  S as Simulation,
  RS as ResourceSystem,
  EcologyObserver,
  R as createLegacyRng,
  T as TRAIT_DEFINITIONS,
  SCI as SCIENTIFIC_BASIS,
  FIELD_N,
  FIELD_CELLS,
  FIELD_CELL,
  EVENT_STRIDE,
  createSimulationCheckpoint,
  restoreSimulationCheckpoint,
};
