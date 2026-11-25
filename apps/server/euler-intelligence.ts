import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {DB} from '../../packages/db/index.js';
import type {Event} from '../../packages/contracts/events.js';
import {eulerFeatureNames,eulerTarget,type EulerDataset,type EulerManifest,type EulerPrediction,type IntelligenceDatasetQuery,type IntelligenceScope} from '../../packages/contracts/intelligence.js';
import {eulerFeatures} from '../../packages/domain/click-prediction.js';
import {deviceForWidth} from '../../packages/domain/metrics.js';
import {Problem} from './security.js';
import {actionToken,sequenceScope,runIntelligence} from './intelligence.js';
import {config} from './config.js';

export const eulerDirectory=(scope:IntelligenceScope)=>path.join(config.dataDir,'intelligence',createHash('sha256').update(JSON.stringify(['EulerNet',scope.site_id,scope.page_key,scope.data_source,scope.revision,scope.variant])).digest('hex'));

export async function exportClickExamples(db:DB,f:IntelligenceDatasetQuery,page:any):Promise<EulerDataset> {
 const now=Date.now(),from=Date.parse(f.from+'T00:00:00Z'),to=Date.parse(f.to+'T00:00:00Z')+86400000;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>90*86400000)throw new Problem(400,'INTELLIGENCE_DATE_RANGE_INVALID');
 const [{value:privacy}]=await db.query("SELECT value FROM settings WHERE key='privacy'");
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const cutoff=Math.max(from,now-privacy.raw_days*86400000),end=Math.min(to,now);
 if(cutoff>=end)throw new Problem(422,'EULERNET_NO_OBSERVED_WINDOWS');
 // Only scalar fields needed for labels/context enter memory; movement cells,
 // form metadata and other payload contents never enter the dataset pipeline.
 const rows=await db.query<{view_id:string;started_at:string|Date;payload:Event}>(
  `SELECT v.view_id,v.started_at,jsonb_build_object('type',e.event_type,'seq',e.payload->'seq','elapsed_ms',e.payload->'elapsed_ms',
   'viewport',jsonb_build_object('width',e.payload->'viewport'->'width'),'element_id',e.payload->'element_id',
   'target',jsonb_build_object('element_id',e.payload->'target'->'element_id'),'action_id',e.payload->'action_id','first_qualified',e.payload->'first_qualified',
   'kind',e.payload->'kind','dropped_events',e.payload->'dropped_events') AS payload
   FROM views v JOIN events e ON e.site_id=v.site_id AND e.view_id=v.view_id
   WHERE v.site_id=$1 AND v.page_key=$2 AND v.data_source=$3 AND v.started_at>=$4 AND v.started_at<$5
   AND v.context->>'revision'=$6 AND v.context->>'variant'=$7 AND v.context->>'locale'=$8 AND v.context->>'state'=$9
   ORDER BY v.started_at,v.view_id,(e.payload->>'seq')::int,e.event_id LIMIT 100001`,
  [f.site_id,f.page_key,f.data_source,new Date(cutoff).toISOString(),new Date(end).toISOString(),f.revision,f.variant,page.locale,page.state]);
 if(rows.length>100000)throw new Problem(422,'INTELLIGENCE_DATASET_BUDGET');
 const groups=new Map<string,{started_at:string;events:Event[]}>();
 for(const row of rows){
  if(new Date(row.started_at).getTime()+row.payload.elapsed_ms>=end)continue;
  let view=groups.get(row.view_id);if(!view){view={started_at:new Date(row.started_at).toISOString(),events:[]};groups.set(row.view_id,view);}view.events.push(row.payload);
 }
 const views:EulerDataset['views']=[],exclusions={censored_exposures:0,invalid_views:0};
 for(const view of groups.values()){
  const events=view.events;
  if(events[0]?.type!=='page_view'||events[0].seq!==0||events.some((e,i)=>(i>0&&(e.seq!==events[i-1].seq+1||e.elapsed_ms<events[i-1].elapsed_ms||e.type==='page_view'))||(e.type==='delivery'&&e.dropped_events>0))){exclusions.invalid_views++;continue;}
  const last=events.at(-1)!.elapsed_ms,tokens:string[]=[],seen=new Set<string>(),examples:EulerDataset['views'][number]['examples']=[];
  for(let i=0;i<events.length;i++){
   const e=events[i];
   if(e.type==='exposure'&&e.first_qualified&&page.elements.includes(e.element_id)&&!seen.has(e.element_id)){
    seen.add(e.element_id);
    const deadline=e.elapsed_ms+30000;
    const interrupted=events.slice(i+1).some(next=>next.elapsed_ms<=deadline&&next.type==='exit'&&next.kind==='hidden');
    let observedUntil=e.elapsed_ms,observationGap=false;
    for(let j=i+1;j<events.length&&observedUntil<deadline;j++){
     if(events[j].elapsed_ms-observedUntil>15000)observationGap=true;
     observedUntil=events[j].elapsed_ms;
    }
    // Apply the same observation eligibility to positive AND negative labels.
    if(last<deadline||interrupted||observationGap){exclusions.censored_exposures++;}
    else{
     const clicked=events.slice(i+1).some(next=>next.elapsed_ms<=deadline&&next.type==='click'&&next.target?.element_id===e.element_id);
     const features=eulerFeatures([...tokens.slice(-49),'exposure:'+e.element_id],deviceForWidth(e.viewport.width));
     examples.push({features,label:clicked?1:0});
    }
   }
   const token=actionToken(e,page);if(token)tokens.push(token);
  }
  if(examples.length)views.push({started_at:view.started_at,ended_at:new Date(Date.parse(view.started_at)+last).toISOString(),examples});
 }
 const minimum=page.environment==='synthetic'?1:privacy.minimum_views;
 if(views.length<minimum)throw new Problem(422,'EULERNET_NO_OBSERVED_WINDOWS');
 const {site_id,page_key,data_source,revision,variant}=f;
 return {schema_version:1,model:'EulerNet',feature_schema_version:1,target:eulerTarget,horizon_ms:30000,environment:page.environment,scope:sequenceScope({site_id,page_key,data_source,revision,variant},{...page,intelligence_version:site.intelligence_version}),exported_at:new Date(now).toISOString(),expires_at:new Date(Math.min(...views.map(v=>Date.parse(v.started_at)))+privacy.raw_days*86400000).toISOString(),minimum_views:minimum,views,exclusions};
}

export async function eulerStatus(db:DB,f:IntelligenceScope,page:any):Promise<{status:'not_trained'|'expired'|'incompatible'}|{status:'ready';manifest:EulerManifest}> {
 let manifest:EulerManifest;
 try{manifest=JSON.parse(await readFile(path.join(eulerDirectory(f),'manifest.json'),'utf8'));}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {status:'not_trained'};throw new Problem(503,'INTELLIGENCE_ARTIFACT_INVALID');}
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const scope=sequenceScope(f,{...page,intelligence_version:site?.intelligence_version});
 const ev=manifest?.evaluation;
 const metricInvalid=(m:EulerManifest['evaluation']['eulernet'])=>!m||[m.log_loss,m.brier,m.ece].some(n=>!Number.isFinite(n)||n<0)||m.brier>1||m.ece>1||(m.auc!==null&&(!Number.isFinite(m.auc)||m.auc<0||m.auc>1));
 if(!manifest||manifest.schema_version!==1||manifest.model!=='EulerNet'||manifest.environment!==page.environment||!manifest.model_id||manifest.feature_schema_version!==1||manifest.target!==eulerTarget||manifest.horizon_ms!==30000||
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
 try{await stat(path.join(eulerDirectory(f),'model.pt'));}catch{return {status:'not_trained'};}
 return {status:'ready',manifest};
}

export async function predictClick(input:EulerPrediction,manifest:EulerManifest) {
 let features;
 try{features=eulerFeatures(input.history,input.device);}catch{throw new Problem(422,'INTELLIGENCE_FIRST_EXPOSURE_REQUIRED');}
 if(!manifest.vocabulary.element_id.includes(features.element_id))throw new Problem(422,'EULERNET_UNSUPPORTED_ELEMENT');
 try{
  const result=JSON.parse(await runIntelligence('eulernet.py',eulerDirectory(input),{features,model_id:manifest.model_id}));
  if(result?.model_id!==manifest.model_id||!Number.isFinite(result.probability)||result.probability<0||result.probability>1||result.element_id!==features.element_id||!Array.isArray(result.unseen_context)||result.unseen_context.some((name:any)=>!eulerFeatureNames.includes(name)))throw new Error('INVALID_RESULT');
  return {model:'EulerNet',...result,target:eulerTarget,horizon_ms:30000,validation_state:manifest.validation_state,data_source:input.data_source};
 }catch(e){if(e instanceof Problem)throw e;throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');}
}
