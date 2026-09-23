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
}

const CROSSFEED_FORM=.035;
const CROSSFEED_EST=.055;
const CROSSFEED_PERSIST=5000;
const DORMANCY_PERSIST=5000;
const ERA_PERSIST=7500;

export class EcologyObserver {
  cross={id:"eco-crossfeeding-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null};
  seedbank={id:"eco-seedbank-1",state:"absent",candidateSince:null as number|null,lowSince:null as number|null,establishedTick:null as number|null,lastReturnTick:null as number|null,priorDormantClades:{} as Record<string,number>,returnedClades:{} as Record<string,number>};
  era={current:null as string|null,candidate:null as string|null,candidateSince:null as number|null,index:0};
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
    return JSON.parse(JSON.stringify({cross:this.cross,seedbank:this.seedbank,era:this.era,records:this.records,eras:this.eras}));
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
      eras:JSON.parse(JSON.stringify(this.eras)),
      records:JSON.parse(JSON.stringify(this.records)),
      rules:{
        crossfeed_form:CROSSFEED_FORM,
        crossfeed_established:CROSSFEED_EST,
        crossfeed_persistence_ticks:CROSSFEED_PERSIST,
        dormancy_persistence_ticks:DORMANCY_PERSIST,
        era_persistence_ticks:ERA_PERSIST,
      },
    };
  }
}
