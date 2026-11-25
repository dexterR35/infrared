import {createHash} from 'node:crypto';
import {readFile,stat,readdir,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import type {DB} from '../../packages/db/index.js';
import type {Event} from '../../packages/contracts/events.js';
import type {IntelligenceScope,IntelligenceDatasetQuery,SequenceDataset,SequenceScope,ModelManifest} from '../../packages/contracts/intelligence.js';
import {Problem} from './security.js';
import {config} from './config.js';

export function sequenceScope(f:IntelligenceScope,page:any):SequenceScope {
 return {site_id:f.site_id,page_key:f.page_key,data_source:f.data_source,revision:f.revision,variant:f.variant,locale:page.locale,state:page.state,registry_hash:createHash('sha256').update(JSON.stringify([ [...page.elements].sort(),[...page.actions].sort() ])).digest('hex'),data_version:page.intelligence_version??'initial'};
}
export function actionToken(e:Event,page:{elements:string[];actions:string[]}):string|undefined {
 if(e.type==='page_view')return 'page_view';
 if(e.type==='click'&&e.target&&page.elements.includes(e.target.element_id))return 'click:'+e.target.element_id;
 if(e.type==='exposure'&&e.first_qualified&&page.elements.includes(e.element_id))return 'exposure:'+e.element_id;
 if(e.type==='activation'&&page.actions.includes(e.action_id))return 'activation:'+e.action_id;
}
export function allowedTokens(page:{elements:string[];actions:string[]}) {
 return new Set(['page_view',...page.elements.flatMap(id=>['click:'+id,'exposure:'+id]),...page.actions.map(id=>'activation:'+id)]);
}
export async function exportSequences(db:DB,f:IntelligenceDatasetQuery,page:any):Promise<SequenceDataset> {
 const now=Date.now(),from=Date.parse(f.from+'T00:00:00Z'),to=Date.parse(f.to+'T00:00:00Z')+86400000;
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>90*86400000)throw new Problem(400,'INTELLIGENCE_DATE_RANGE_INVALID');
 const [{value:privacy}]=await db.query("SELECT value FROM settings WHERE key='privacy'");
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const cutoff=Math.max(from,now-privacy.raw_days*86400000),end=Math.min(to,now);
 if(cutoff>=end)throw new Problem(422,'INTELLIGENCE_NO_SEQUENCES');
 const rows=await db.query<{view_id:string;started_at:Date|string;payload:Event}>(
  `SELECT v.view_id,v.started_at,e.payload FROM views v JOIN events e ON e.site_id=v.site_id AND e.view_id=v.view_id
   WHERE v.site_id=$1 AND v.page_key=$2 AND v.data_source=$3 AND v.started_at>=$4 AND v.started_at<$5
   AND v.context->>'revision'=$6 AND v.context->>'variant'=$7 AND v.context->>'locale'=$8 AND v.context->>'state'=$9
   AND e.event_type IN ('page_view','click','exposure','activation')
   ORDER BY v.started_at,v.view_id,(e.payload->>'seq')::int,e.event_id LIMIT 100001`,
  [f.site_id,f.page_key,f.data_source,new Date(cutoff).toISOString(),new Date(end).toISOString(),f.revision,f.variant,page.locale,page.state]);
 if(rows.length>100000)throw new Problem(422,'INTELLIGENCE_DATASET_BUDGET');
 const groups=new Map<string,{started_at:string;ended_at:string;tokens:string[];last_seq:number;last_ms:number;valid:boolean}>();
 for(const row of rows){
  const e=row.payload,at=new Date(row.started_at).getTime()+e.elapsed_ms;
  if(at>=end)continue;
  const token=actionToken(e,page);if(!token)continue;
  let s=groups.get(row.view_id);
  if(!s){const start=new Date(row.started_at).toISOString();s={started_at:start,ended_at:start,tokens:[],last_seq:-1,last_ms:-1,valid:true};groups.set(row.view_id,s);}
  // Ambiguous or backwards event order cannot supply a reliable training sequence.
  if(e.seq<=s.last_seq||e.elapsed_ms<s.last_ms)s.valid=false;
  s.last_seq=e.seq;s.last_ms=e.elapsed_ms;s.ended_at=new Date(at).toISOString();s.tokens.push(token);
 }
 const sequences=[...groups.values()].filter(s=>s.valid&&s.tokens.length>=2&&s.tokens[0]==='page_view'&&!s.tokens.slice(1).includes('page_view')).map(({started_at,ended_at,tokens})=>({started_at,ended_at,tokens}));
 const minimum=page.environment==='synthetic'?1:privacy.minimum_views;
 if(sequences.length<minimum)throw new Problem(422,'INTELLIGENCE_INSUFFICIENT_SEQUENCES');
 return {schema_version:1,scope:sequenceScope({site_id:f.site_id,page_key:f.page_key,data_source:f.data_source,revision:f.revision,variant:f.variant},{...page,intelligence_version:site.intelligence_version}),exported_at:new Date(now).toISOString(),expires_at:new Date(Math.min(...sequences.map(s=>Date.parse(s.started_at)))+privacy.raw_days*86400000).toISOString(),minimum_token_views:minimum,sequences};
}
export function modelDirectory(scope:IntelligenceScope) {
 const key=createHash('sha256').update(JSON.stringify([scope.site_id,scope.page_key,scope.data_source,scope.revision,scope.variant])).digest('hex');
 return path.join(config.dataDir,'intelligence',key);
}
export async function pruneIntelligence(dataDir:string,rawDays:number,versions?:Map<string,string>) {
 const root=path.join(dataDir,'intelligence');
 const entries=await readdir(root,{withFileTypes:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
 let pruned=0;
 for(const entry of entries){
  if(!entry.isDirectory()||!/^[a-f0-9]{64}$/.test(entry.name))continue;
  const directory=path.join(root,entry.name);
  let manifest:ModelManifest;
  try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}catch{continue;}
  if(!manifest||typeof manifest!=='object')continue;
  const expiry=Math.min(Date.parse(manifest.expires_at),Date.parse(manifest.oldest_started_at)+rawDays*86400000);
  const revoked=versions&&versions.get(manifest.scope?.site_id)!==manifest.scope?.data_version;
  if(revoked||(Number.isFinite(expiry)&&expiry<=Date.now())){
   for(const file of ['model.pt','manifest.json'])await unlink(path.join(directory,file)).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
   pruned++;
  }
 }
 return pruned;
}
export async function modelStatus(db:DB,f:IntelligenceScope,page:any):Promise<{status:'not_trained'|'expired'|'incompatible'}|{status:'ready';manifest:ModelManifest}> {
 let manifest:ModelManifest;
 try{manifest=JSON.parse(await readFile(path.join(modelDirectory(f),'manifest.json'),'utf8'));}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {status:'not_trained'};throw new Problem(503,'INTELLIGENCE_ARTIFACT_INVALID');}
 const [site]=await db.query('SELECT intelligence_version FROM sites WHERE id=$1',[f.site_id]);
 const scope=sequenceScope(f,{...page,intelligence_version:site?.intelligence_version});
 const evaluation=manifest?.evaluation,metrics=['sasrec','markov','popularity'] as const;
 if(!manifest||manifest.schema_version!==1||manifest.model!=='SASRec'||!manifest.model_id||
  !Number.isInteger(manifest.max_length)||manifest.max_length<1||manifest.max_length>50||
  !Array.isArray(manifest.vocabulary)||manifest.vocabulary.length<2||!manifest.vocabulary.includes('page_view')||
  new Set(manifest.vocabulary).size!==manifest.vocabulary.length||manifest.vocabulary.some(t=>!allowedTokens(page).has(t))||
  !manifest.scope||Object.entries(scope).some(([key,value])=>manifest.scope[key as keyof SequenceScope]!==value)||
  !evaluation||!Number.isInteger(evaluation.test_sequences)||evaluation.test_sequences<1||
  !Number.isInteger(evaluation.k)||evaluation.k<1||evaluation.k>Math.min(5,manifest.vocabulary.length-1)||
  !Number.isInteger(evaluation.unknown_targets)||evaluation.unknown_targets<0||evaluation.unknown_targets>evaluation.test_sequences||
  metrics.some(name=>!evaluation[name]||[evaluation[name].hit_rate,evaluation[name].ndcg].some(n=>!Number.isFinite(n)||n<0||n>1))
 )return {status:'incompatible'};
 const [{value:privacy}]=await db.query("SELECT value FROM settings WHERE key='privacy'");
 if(page.environment!=='synthetic'&&(manifest.minimum_token_views<privacy.minimum_views||!Number.isInteger(manifest.minimum_token_views)||evaluation.test_sequences<privacy.minimum_views))return {status:'incompatible'};
 const oldest=Date.parse(manifest.oldest_started_at),expiry=Date.parse(manifest.expires_at);
 if(!Number.isFinite(oldest)||!Number.isFinite(expiry)||Date.now()>=Math.min(expiry,oldest+privacy.raw_days*86400000))return {status:'expired'};
 try{await stat(path.join(modelDirectory(f),'model.pt'));}catch{return {status:'not_trained'};}
 return {status:'ready',manifest};
}
let inferenceBusy=false;
export async function runIntelligence(script:'sasrec.py'|'eulernet.py',directory:string,input:object) {
 if(inferenceBusy)throw new Problem(429,'INTELLIGENCE_BUSY');
 inferenceBusy=true;
 try{
  return await new Promise<string>((resolve,reject)=>{
   const child=execFile(config.intelligencePython,[path.resolve('apps/intelligence',script),'predict','--model-dir',directory],{timeout:15000,maxBuffer:65536,windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout));
   child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(input));
  });
 }catch{throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');}finally{inferenceBusy=false;}
}
export async function predictActions(scope:IntelligenceScope,history:string[],top_k:number,manifest:ModelManifest) {
 if(history.some(t=>!manifest.vocabulary.includes(t)))throw new Problem(422,'INTELLIGENCE_UNKNOWN_ACTION');
 try{
  const stdout=await runIntelligence('sasrec.py',modelDirectory(scope),{history,top_k,model_id:manifest.model_id});
  const result=JSON.parse(stdout);
  if(result.model_id!==manifest.model_id||!Array.isArray(result.rankings)||result.rankings.length>top_k||result.rankings.some((r:any)=>!manifest.vocabulary.includes(r.action)||!Number.isFinite(r.score)))throw new Error('INVALID_RESULT');
  return {model:'SASRec',...result,score_type:'ranking_logit',data_source:scope.data_source};
 }catch(e){if(e instanceof Problem)throw e;throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');}
}
