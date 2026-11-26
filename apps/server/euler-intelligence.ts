import {conversionSurvival} from '../../packages/domain/conversion-survival.js';
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {DB} from '../../packages/db/index.js';
import type {Event} from '../../packages/contracts/events.js';
import {eulerFeatureNames,eulerTarget,conversionTarget,type EulerDataset,type EulerManifest,type EulerPrediction,type IntelligenceDatasetQuery,type IntelligenceScope,type ModelMonitor} from '../../packages/contracts/intelligence.js';
import {eulerFeatures} from '../../packages/domain/click-prediction.js';
import {deviceForWidth} from '../../packages/domain/metrics.js';
import {Problem} from './security.js';
import {actionToken,sequenceScope,runIntelligence,activeModelDirectory} from './intelligence.js';
import {config} from './config.js';

export const eulerDirectory=(scope:IntelligenceScope,objective:'euler'|'conversion'='euler')=>path.join(config.dataDir,'intelligence',createHash('sha256').update(JSON.stringify([objective==='conversion'?'EulerNetConversion':'EulerNet',scope.site_id,scope.page_key,scope.data_source,scope.revision,scope.variant])).digest('hex'));

export async function exportClickExamples(db:DB,f:IntelligenceDatasetQuery,page:any,objective:'euler'|'conversion'='euler',summaryOnly=false):Promise<EulerDataset> {
 if(objective==='conversion'&&(!page.primary_action_id||!page.actions.includes(page.primary_action_id)))throw new Problem(422,'INTELLIGENCE_PRIMARY_CONVERSION_ACTION_REQUIRED');
 const now=Date.now(),from=Date.parse(f.from+'T00:00:00Z'),to=Date.parse(f.to+'T00:00:00Z')+86400000;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>90*86400000)throw new Problem(400,'INTELLIGENCE_DATE_RANGE_INVALID');
 const [{value:privacy}]=await db.query("SELECT value FROM settings WHERE key='privacy'");
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const cutoff=Math.max(from,now-privacy.raw_days*86400000),end=Math.min(to,now);
 if(cutoff>=end)throw new Problem(422,'EULERNET_NO_OBSERVED_WINDOWS');
 // Only scalar fields needed for labels/context enter memory; movement cells,
 // form metadata and other payload contents never enter the dataset pipeline.
 const rows=await db.query<{view_id:string;started_at:string|Date;market:string|null;payload:Event}>(
  `SELECT v.view_id,v.started_at,v.acquisition_context->>'market' AS market,jsonb_build_object('type',e.event_type,'seq',e.payload->'seq','elapsed_ms',e.payload->'elapsed_ms',
   'viewport',jsonb_build_object('width',e.payload->'viewport'->'width'),'element_id',e.payload->'element_id',
   'target',jsonb_build_object('element_id',e.payload->'target'->'element_id'),'action_id',e.payload->'action_id','first_qualified',e.payload->'first_qualified',
   'source',jsonb_build_object('channel',e.payload->'source'->'channel'),'metric',e.payload->'metric','value',e.payload->'value',
   'max_reach_percent',e.payload->'max_reach_percent','kind',e.payload->'kind','dropped_events',e.payload->'dropped_events') AS payload
   FROM views v JOIN events e ON e.site_id=v.site_id AND e.view_id=v.view_id
   WHERE v.site_id=$1 AND v.page_key=$2 AND v.data_source=$3 AND v.started_at>=$4 AND v.started_at<$5
   AND v.context->>'revision'=$6 AND v.context->>'variant'=$7 AND v.context->>'locale'=$8 AND v.context->>'state'=$9
   ORDER BY v.started_at,v.view_id,(e.payload->>'seq')::int,e.event_id LIMIT 100001`,
  [f.site_id,f.page_key,f.data_source,new Date(cutoff).toISOString(),new Date(end).toISOString(),f.revision,f.variant,page.locale,page.state]);
 if(rows.length>100000)throw new Problem(422,'INTELLIGENCE_DATASET_BUDGET');
 // Match only a screenshot that already existed at page entry, at the exact width.
 const references=await db.query(`SELECT manifest,created_at FROM page_references WHERE site_id=$1 AND page_key=$2
  AND status='approved' AND manifest->>'revision'=$3 AND manifest->>'variant'=$4 AND manifest->>'locale'=$5
  AND manifest->>'state'=$6 AND created_at<$7 ORDER BY created_at DESC,id DESC LIMIT 100`,
  [f.site_id,f.page_key,f.revision,f.variant,page.locale,page.state,new Date(end).toISOString()]);
 const layouts=new Map<number,{available:number;height:number;density:string;elements:Map<string,{rect:{y:number};font_px?:number;solid_color_contrast?:number}>}[]>();
 for(const ref of references){
  const m=ref.manifest;if(!m?.viewport||!Array.isArray(m.elements))continue;
  const list=layouts.get(m.viewport.width)??[];
  const fraction=m.edge_fraction;
  list.push({available:Math.max(Date.parse(m.captured_at),new Date(ref.created_at).getTime()),height:m.viewport.height,
   density:typeof fraction!=='number'?'unknown':fraction<.1?'under-10%':fraction<.25?'10-25%':'25%+',
   elements:new Map(m.elements.map((el:any)=>[el.id,el]))});
  layouts.set(m.viewport.width,list);
 }
 const groups=new Map<string,{started_at:string;market:string;events:Event[]}>();
 for(const row of rows){
  if(new Date(row.started_at).getTime()+row.payload.elapsed_ms>=end)continue;
  let view=groups.get(row.view_id);if(!view){view={started_at:new Date(row.started_at).toISOString(),market:row.market&&/^[A-Z]{2,3}$/.test(row.market)?row.market:'unknown',events:[]};groups.set(row.view_id,view);}view.events.push(row.payload);
 }
 const views:EulerDataset['views']=[],exclusions={censored_exposures:0,invalid_views:0};
 const observations:{ms:number;converted:boolean}[]=[], visibility=new Map<string,number>();
 for(const view of groups.values()){
  const events=view.events;
  if(events[0]?.type!=='page_view'||events[0].seq!==0||events.some((e,i)=>(i>0&&(e.seq!==events[i-1].seq+1||e.elapsed_ms<events[i-1].elapsed_ms||e.type==='page_view'))||(e.type==='delivery'&&e.dropped_events>0))){exclusions.invalid_views++;continue;}
  const last=events.at(-1)!.elapsed_ms,tokens:string[]=[],seen=new Set<string>(),examples:EulerDataset['views'][number]['examples']=[];
  if(page.primary_action_id){
   const firstEnd=events.find(e=>(e.type==='activation'&&e.action_id===page.primary_action_id)||(e.type==='exit'&&e.kind==='hidden'));
   observations.push({ms:firstEnd?.elapsed_ms??last,converted:firstEnd?.type==='activation'});
  }
  // A gap remains relevant until a later observation reaches the horizon. The reverse
  // scan indexes only events strictly after each exposure, including equal-time ties.
  const windows=new Map<number,{observed:boolean;positive:boolean}>(),nextClick=new Map<string,number>();
  let nextHidden=Infinity,nextPrimary=Infinity,nextGapStart=Infinity;
  for(let i=events.length-1;i>=0;i--){
   const event=events[i],time=event.elapsed_ms;
   if(i+1<events.length&&events[i+1].elapsed_ms-time>15000)nextGapStart=time;
   if(event.type==='exposure'&&event.first_qualified){
    const deadline=time+30000;
    windows.set(i,{observed:last>=deadline&&nextHidden>deadline&&nextGapStart>=deadline,
     positive:(objective==='conversion'?nextPrimary:nextClick.get(event.element_id)??Infinity)<=deadline});
   }
   if(event.type==='exit'&&event.kind==='hidden')nextHidden=time;
   if(event.type==='activation'&&event.action_id===page.primary_action_id)nextPrimary=time;
   if(event.type==='click'&&event.target?.element_id)nextClick.set(event.target.element_id,time);
  }
  let converted=false,channel='unknown',reach='unmeasured',load='unmeasured';const priorElements:string[]=[];
  for(let i=0;i<events.length;i++){
   const e=events[i];
   if(e.type==='page_view')channel=e.source?.channel??'unknown';
   if(e.type==='progress')reach=e.max_reach_percent<25?'0-24':e.max_reach_percent<50?'25-49':e.max_reach_percent<75?'50-74':'75-100';
   if(e.type==='performance'&&e.metric==='navigation_load_ms')load=e.value<1000?'under-1s':e.value<3000?'1-3s':'3s+';
   if(e.type==='exposure'&&e.first_qualified&&page.elements.includes(e.element_id)&&!seen.has(e.element_id)){
    seen.add(e.element_id);visibility.set(e.element_id,(visibility.get(e.element_id)??0)+1);
    if(objective==='conversion'&&converted)continue;
    const window=windows.get(i)!;
    if(!window.observed){exclusions.censored_exposures++;}
    else{
     const clicked=window.positive;
     const features=eulerFeatures([...tokens.slice(-49),'exposure:'+e.element_id],deviceForWidth(e.viewport.width));
     const layout=layouts.get(e.viewport.width)?.find(l=>l.available<=Date.parse(view.started_at));
     const item=layout?.elements.get(e.element_id),font=item?.font_px,contrast=item?.solid_color_contrast;
     examples.push({features,label:clicked?1:0,prior_elements:priorElements.slice(-12),context:{channel,market:view.market,reach,load,placement:item&&layout?(item.rect.y<layout.height?'first-screen':'below-fold'):'unknown',
       font:font===undefined?'unknown':font<14?'under-14px':font<20?'14-19px':'20px+',
       contrast:contrast===undefined?'unknown':contrast<3?'under-3':contrast<4.5?'3-4.5':'4.5+',
       density:layout?.density??'unknown',elapsed:e.elapsed_ms<5000?'under-5s':e.elapsed_ms<15000?'5-15s':e.elapsed_ms<30000?'15-30s':'30s+',element_type:e.element_id.startsWith('auto.')?e.element_id.split('.')[1]:'registered'}});
    }
   }
   if(e.type==='activation'&&e.action_id===page.primary_action_id)converted=true;
   const token=actionToken(e,page);if(token){
    tokens.push(token);
    if(token.startsWith('exposure:')||token.startsWith('click:'))priorElements.push(token.slice(token.indexOf(':')+1));
   }
  }
  if(examples.length)views.push({started_at:view.started_at,ended_at:new Date(Date.parse(view.started_at)+last).toISOString(),examples});
 }
 const minimum=page.environment==='synthetic'?1:privacy.minimum_views;
 if(views.length<minimum&&!summaryOnly)throw new Problem(422,'EULERNET_NO_OBSERVED_WINDOWS');
 const {site_id,page_key,data_source,revision,variant}=f;
 return {schema_version:1,model:'EulerNet',feature_schema_version:1,target:objective==='conversion'?conversionTarget:eulerTarget,horizon_ms:30000,...(objective==='conversion'?{primary_action_id:page.primary_action_id}:{}),environment:page.environment,scope:sequenceScope({site_id,page_key,data_source,revision,variant},{...page,intelligence_version:site.intelligence_version}),exported_at:new Date(now).toISOString(),expires_at:new Date(Math.min(now,...views.map(v=>Date.parse(v.started_at)))+privacy.raw_days*86400000).toISOString(),minimum_views:minimum,views,exclusions,attention:[...visibility].filter(([,v])=>v>=minimum).map(([element,views])=>({element,views})).sort((a,b)=>b.views-a.views),survival:conversionSurvival(observations,minimum)};
}

export async function eulerStatus(db:DB,f:IntelligenceScope,page:any,directory?:string,objective:'euler'|'conversion'='euler'):Promise<{status:'not_trained'|'expired'|'incompatible'}|{status:'ready';manifest:EulerManifest}> {
 directory??=await activeModelDirectory(eulerDirectory(f,objective));
 let manifest:EulerManifest;
 try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {status:'not_trained'};throw new Problem(503,'INTELLIGENCE_ARTIFACT_INVALID');}
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const scope=sequenceScope(f,{...page,intelligence_version:site?.intelligence_version});
 const ev=manifest?.evaluation;
 const metricInvalid=(m:EulerManifest['evaluation']['eulernet'])=>!m||[m.log_loss,m.brier,m.ece].some(n=>!Number.isFinite(n)||n<0)||m.brier>1||m.ece>1||(m.auc!==null&&(!Number.isFinite(m.auc)||m.auc<0||m.auc>1));
 if(!manifest||manifest.schema_version!==1||manifest.model!=='EulerNet'||manifest.environment!==page.environment||!manifest.model_id||manifest.feature_schema_version!==1||manifest.target!==(objective==='conversion'?conversionTarget:eulerTarget)||manifest.horizon_ms!==30000||
  (objective==='conversion'&&(!page.primary_action_id||manifest.primary_action_id!==page.primary_action_id||!page.actions.includes(manifest.primary_action_id)))||
  !manifest.scope||Object.entries(scope).some(([k,v])=>manifest.scope[k as keyof typeof scope]!==v)||
  !manifest.vocabulary||eulerFeatureNames.some(name=>!Array.isArray(manifest.vocabulary[name])||!manifest.vocabulary[name].length||manifest.vocabulary[name].some(v=>typeof v!=='string'||v.length>150))||manifest.vocabulary.element_id.some(id=>!page.elements.includes(id))||
  !ev||!Number.isInteger(ev.test_views)||ev.test_views<1||!Number.isInteger(ev.test_examples)||ev.test_examples<ev.test_views||!Number.isInteger(ev.positives)||!Number.isInteger(ev.negatives)||ev.positives<1||ev.negatives<1||ev.positives+ev.negatives!==ev.test_examples||
  !['fixture_only','needs_review','passes_offline_checks'].includes(manifest.validation_state)||(['eulernet','logistic','constant'] as const).some(model=>metricInvalid(ev[model]))
 )return {status:'incompatible'};
 const [{value:privacy}]=await db.query("SELECT value FROM settings WHERE key='privacy'");
 const minimum=page.environment==='synthetic'?1:privacy.minimum_views;
 if(!Number.isInteger(manifest.minimum_views)||manifest.minimum_views<minimum||ev.test_views<minimum||ev.positives<minimum||ev.negatives<minimum)return {status:'incompatible'};
 const expiry=Math.min(Date.parse(manifest.expires_at),Date.parse(manifest.oldest_started_at)+privacy.raw_days*86400000);
 if(!Number.isFinite(expiry)||Date.now()>=expiry)return {status:'expired'};
 try{await stat(path.join(directory,'model.pt'));}catch{return {status:'not_trained'};}
 return {status:'ready',manifest};
}

export async function predictClick(input:EulerPrediction,manifest:EulerManifest) {
 let features;
 try{features=eulerFeatures(input.history,input.device);}catch{throw new Problem(422,'INTELLIGENCE_FIRST_EXPOSURE_REQUIRED');}
 if(!manifest.vocabulary.element_id.includes(features.element_id))throw new Problem(422,'EULERNET_UNSUPPORTED_ELEMENT');
 const objective=manifest.target===conversionTarget?'conversion':'euler';
 if(objective==='conversion'&&input.history.includes('activation:'+manifest.primary_action_id))throw new Problem(422,'INTELLIGENCE_CONVERSION_ALREADY_OBSERVED');
 try{
  const result=JSON.parse(await runIntelligence('eulernet.py',await activeModelDirectory(eulerDirectory(input,objective)),{features,model_id:manifest.model_id}));
  if(result?.model_id!==manifest.model_id||!Number.isFinite(result.probability)||result.probability<0||result.probability>1||result.element_id!==features.element_id||!Array.isArray(result.unseen_context)||result.unseen_context.some((name:any)=>!eulerFeatureNames.includes(name)))throw new Error('INVALID_RESULT');
  return {model:'EulerNet',...result,target:manifest.target,primary_action_id:manifest.primary_action_id,horizon_ms:30000,validation_state:manifest.validation_state,data_source:input.data_source};
 }catch(e){if(e instanceof Problem)throw e;throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');}
}

const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const monitorStatuses=new Set(['evaluated','insufficient_data']),recommendations=new Set(['healthy','watch','retrain','collect_more_data']);
type MonitorResult=ModelMonitor|{status:'not_trained'|'expired'|'incompatible'}|{status:'no_fresh_views';model_id:string;objective:'click'|'conversion';cutoff:string};

// Evaluate the published model only on views that began after its newest training view.
export async function monitorModel(db:DB,scope:IntelligenceScope,page:any,objective:'click'|'conversion'):Promise<MonitorResult> {
 const kind=objective==='conversion'?'conversion':'euler';
 const before=await eulerStatus(db,scope,page,undefined,kind);
 if(before.status!=='ready')return {status:before.status};
 const manifest=before.manifest,cutoffText=manifest.newest_started_at??manifest.created_at,cutoff=Date.parse(cutoffText),now=Date.now();
 if(!Number.isFinite(cutoff))return {status:'incompatible'};
 const none={status:'no_fresh_views' as const,model_id:manifest.model_id,objective,cutoff:cutoffText};
 if(cutoff>=now)return none;
 let data:EulerDataset;
 try{data=await exportClickExamples(db,{...scope,from:day(Math.max(cutoff,now-89*86400000)),to:day(now)},page,kind,true);}
 catch(e){if(e instanceof Problem&&e.code==='EULERNET_NO_OBSERVED_WINDOWS')return none;throw e;}
 // The Python process repeats this filter. Trimming here bounds the payload.
 data.views=data.views.filter(v=>Date.parse(v.started_at)>cutoff);
 if(!data.views.length)return none;
 let result:any;
 try{result=JSON.parse(await runIntelligence('eulernet.py',await activeModelDirectory(eulerDirectory(scope,kind)),{model_id:manifest.model_id,dataset:data},'monitor',60000));}
 catch(e){if(e instanceof Problem)throw e;throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');}
 const counts=['fresh_views','fresh_examples','scored_examples','unseen_element_examples','positives','negatives'];
 if(result?.model_id!==manifest.model_id||!monitorStatuses.has(result.status)||!recommendations.has(result.recommendation)||counts.some(k=>!Number.isInteger(result[k])||result[k]<0)||
  !Array.isArray(result.findings)||result.findings.some((f:any)=>typeof f?.code!=='string'||!Number.isFinite(f.value))||typeof result.models!=='object'||
  Object.values(result.models).some((m:any)=>!Number.isFinite(m?.calibration_z)||!Number.isFinite(m?.mean_probability)))throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');
 const after=await eulerStatus(db,scope,page,undefined,kind);
 if(after.status!=='ready'||after.manifest.model_id!==manifest.model_id)throw new Problem(409,'INTELLIGENCE_MODEL_CHANGED');
 // Small cohorts are suppressed exactly as in the other reports.
 const minimum=page.environment==='synthetic'?1:manifest.minimum_views;
 if(result.fresh_views<minimum)return none;
 return {...result,objective};
}
