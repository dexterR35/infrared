import type {FastifyInstance,FastifyRequest} from 'fastify';
import {filesystemReferences} from '../../packages/storage/index.js';
import {localResearch} from './local-research.js';
import {designAnalysis} from './design-intelligence.js';
import {config} from './config.js';
import path from 'node:path';
import type {DB} from '../../packages/db/index.js';
import {trainingSchema,trainingScheduleSchema,rollbackSchema,intelligenceScopeSchema,intelligenceDatasetSchema,eulerPredictSchema,monitorQuerySchema,type MonitorQuery,type TrainingRequest,type TrainingSchedule,type IntelligenceScope,type IntelligenceDatasetQuery,type EulerPrediction} from '../../packages/contracts/intelligence.js';
import type {WorkspaceUser} from './access.js';
import {requireEditor} from './access.js';
import {Problem,Limiter} from './security.js';
import {createTrainingService,trainingScopeKey} from './intelligence-training.js';
import {eulerFeatures} from '../../packages/domain/click-prediction.js';
import {exportSequences,runIntelligence,activeModelDirectory,allowedTokens,modelStatus,modelDirectory} from './intelligence.js';
import {exportClickExamples,eulerStatus,eulerDirectory,predictClick,monitorModel} from './euler-intelligence.js';
import {journeyGraph,elementPerformance} from './intelligence-insights.js';

export function registerIntelligenceTraining(app:FastifyInstance,db:DB,user:(req:FastifyRequest)=>WorkspaceUser,pageFor:(req:FastifyRequest,scope:IntelligenceScope)=>Promise<any>){
 const service=createTrainingService(db),limiter=new Limiter();
 app.addHook('onReady',()=>service.start());app.addHook('onClose',()=>service.close());
 app.get<{Querystring:IntelligenceScope}>('/api/intelligence/training',{schema:{querystring:intelligenceScopeSchema}},async req=>{
  const page=await pageFor(req,req.query),key=trainingScopeKey(req.query);
  const runs=await db.query('SELECT id,model,status,progress,manifest,error_code,created_at,finished_at FROM intelligence_runs WHERE scope_key=$1 ORDER BY created_at DESC,id DESC LIMIT 30',[key]);
  for(const run of runs){
   if(run.status!=='completed')continue;
   const directory=path.join(run.model==='sasrec'?modelDirectory(req.query):eulerDirectory(req.query,run.model),'versions',run.id);
   const checked=run.model==='sasrec'?await modelStatus(db,req.query,page,directory):await eulerStatus(db,req.query,page,directory,run.model);
   run.artifact_status=checked.status;
   if(checked.status!=='ready'){run.manifest=null;run.progress=[];}
  }
  const [schedule]=await db.query('SELECT interval_hours,lookback_days,next_run_at FROM intelligence_schedules WHERE scope_key=$1',[key]);
  const experiments=await db.query('SELECT id,name,control_variant,treatment_variant FROM experiments WHERE site_id=$1 AND page_key=$2 AND revision=$3 ORDER BY created_at DESC LIMIT 30',[req.query.site_id,req.query.page_key,req.query.revision]);
  return {runs,schedule:schedule??{interval_hours:0,lookback_days:7,next_run_at:null},variants:[...new Set([page.variant,...experiments.flatMap(e=>[e.control_variant,e.treatment_variant])])],experiments,primary_action_id:page.primary_action_id};
 });
 app.post<{Body:TrainingRequest}>('/api/intelligence/train',{schema:{body:trainingSchema}},async(req,reply)=>{
  const u=user(req);requireEditor(u);await pageFor(req,req.body);limiter.check('training:'+u.id,6,600000);
  const result=await service.enqueue(req.body,u.id);service.wake();return reply.code(202).send(result);
 });
 app.post<{Body:TrainingSchedule}>('/api/intelligence/training/schedule',{schema:{body:trainingScheduleSchema}},async req=>{
  const u=user(req);requireEditor(u);await pageFor(req,req.body);return service.setSchedule(req.body,u.id);
 });
 app.post<{Body:IntelligenceScope&{run_id:string}}>('/api/intelligence/training/rollback',{schema:{body:rollbackSchema}},async req=>{
  const u=user(req);requireEditor(u);const {run_id,...scope}=req.body;await pageFor(req,scope);return service.rollback(scope,run_id,u.id);
 });
 async function approvedReference(req:FastifyRequest,scope:IntelligenceScope){
  const page=await pageFor(req,scope);
  limiter.check('design:'+user(req).id,12,60000);
  const {site_id,page_key,revision,variant}=scope;
  const [ref]=await db.query(`SELECT manifest,object_key FROM page_references WHERE site_id=$1 AND page_key=$2
    AND status='approved' AND manifest->>'revision'=$3 AND manifest->>'variant'=$4
    AND manifest->>'locale'=$5 AND manifest->>'state'=$6 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [site_id,page_key,revision,variant,page.locale,page.state]);
  return ref;
 }
 app.get<{Querystring:IntelligenceScope}>('/api/intelligence/design',{schema:{querystring:intelligenceScopeSchema}},async req=>{
  const ref=await approvedReference(req,req.query);
  return {reference:ref?await designAnalysis(await filesystemReferences(config.dataDir).read(ref.object_key),ref.manifest):null};
 });
 app.post<{Body:IntelligenceScope}>('/api/intelligence/design/visual',{schema:{body:intelligenceScopeSchema}},async req=>{
  requireEditor(user(req));
  const ref=await approvedReference(req,req.body);
  if(!ref)throw new Problem(404,'INTELLIGENCE_APPROVED_REFERENCE_REQUIRED');
  return localResearch('reference',await filesystemReferences(config.dataDir).read(ref.object_key));
 });
 app.get<{Querystring:IntelligenceDatasetQuery}>('/api/intelligence/journey',{schema:{querystring:intelligenceDatasetSchema}},async req=>{
  const page=await pageFor(req,req.query);limiter.check('journey:'+user(req).id,20,60000);
  let graph:ReturnType<typeof journeyGraph>={views:0,nodes:[],edges:[],definition:'No reportable interaction sequences in the selected period.'};
  try{graph=journeyGraph(await exportSequences(db,req.query,page));}
  catch(e){if(!(e instanceof Problem && ['INTELLIGENCE_NO_SEQUENCES','INTELLIGENCE_INSUFFICIENT_SEQUENCES'].includes(e.code)))throw e;}
  let elements:any[]=[],attention:{element:string;views:number}[]=[],survival:{seconds:number;probability:number}[]=[],element_status='ready';
  try{const data=await exportClickExamples(db,req.query,page,'euler',true);elements=elementPerformance(data);attention=data.attention??[];survival=data.survival??[];}
  catch(e){if(e instanceof Problem&&e.status===422)element_status=e.code;else throw e;}
  return {...graph,elements,element_status,attention,survival,primary_action_id:page.primary_action_id};
 });
 app.post<{Body:EulerPrediction}>('/api/intelligence/elements/predict',{schema:{body:eulerPredictSchema}},async req=>{
  const {device,history,...scope}=req.body,page=await pageFor(req,scope);
  limiter.check('element-predict:'+user(req).id,10,60000);
  const allowed=allowedTokens(page);
  if(history.some(t=>!allowed.has(t)))throw new Problem(422,'INTELLIGENCE_UNKNOWN_ACTION');
  const before=await eulerStatus(db,scope,page);
  if(before.status!=='ready'||before.manifest.tabular?.status!=='evaluated')throw new Problem(409,'INTELLIGENCE_CATBOOST_MODEL_REQUIRED');
  const candidates=before.manifest.vocabulary.element_id.filter(id=>!history.includes('exposure:'+id)).map(id=>eulerFeatures([...history,'exposure:'+id],device));
  if(!candidates.length)throw new Problem(422,'INTELLIGENCE_NO_REMAINING_CANDIDATES');
  const result=JSON.parse(await runIntelligence('eulernet.py',await activeModelDirectory(eulerDirectory(scope)),{model_id:before.manifest.model_id,candidates}));
  if(result.model_id!==before.manifest.model_id||!Array.isArray(result.elements)||result.elements.length!==candidates.length||result.elements.some((row:any,i:number)=>row.element_id!==candidates[i].element_id||!Number.isFinite(row.probability)||row.probability<0||row.probability>1||(row.ranking_score!==null&&!Number.isFinite(row.ranking_score))))throw new Problem(503,'INTELLIGENCE_INFERENCE_UNAVAILABLE');
  const after=await eulerStatus(db,scope,await pageFor(req,scope));
  if(after.status!=='ready'||after.manifest.model_id!==before.manifest.model_id)throw new Problem(409,'INTELLIGENCE_MODEL_CHANGED');
  return result;
 });
 app.get<{Querystring:MonitorQuery}>('/api/intelligence/monitor',{schema:{querystring:monitorQuerySchema}},async req=>{
  const {objective,...scope}=req.query,page=await pageFor(req,scope);
  limiter.check('monitor:'+user(req).id,6,600000);
  return monitorModel(db,scope,page,objective);
 });
 app.get<{Querystring:IntelligenceScope}>('/api/intelligence/conversion/status',{schema:{querystring:intelligenceScopeSchema}},async req=>{
  const page=await pageFor(req,req.query);return eulerStatus(db,req.query,page,undefined,'conversion');
 });
 app.post<{Body:EulerPrediction}>('/api/intelligence/conversion/predict',{schema:{body:eulerPredictSchema}},async req=>{
  const {history,device,...scope}=req.body,page=await pageFor(req,scope);
  limiter.check('conversion:'+user(req).id,10,60000);
  if(history.some(t=>!allowedTokens(page).has(t)))throw new Problem(422,'INTELLIGENCE_UNKNOWN_ACTION');
  const before=await eulerStatus(db,scope,page,undefined,'conversion');
  if(before.status!=='ready')throw new Problem(409,'INTELLIGENCE_CONVERSION_MODEL_'+before.status.toUpperCase());
  const result=await predictClick({...scope,history,device},before.manifest);
  const after=await eulerStatus(db,scope,await pageFor(req,scope),undefined,'conversion');
  if(after.status!=='ready'||after.manifest.model_id!==before.manifest.model_id)throw new Problem(409,'INTELLIGENCE_MODEL_CHANGED');
  return result;
 });
}
