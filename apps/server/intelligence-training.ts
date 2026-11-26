import {createHash,randomUUID} from 'node:crypto';
import {execFile,type ChildProcess} from 'node:child_process';
import {mkdir,writeFile,copyFile,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import type {DB} from '../../packages/db/index.js';
import type {IntelligenceScope,IntelligenceDatasetQuery,TrainingRequest,TrainingSchedule,TrainingPoint} from '../../packages/contracts/intelligence.js';
import {fromRoot} from '../../packages/config/paths.js';
import {config} from './config.js';
import {requireEditor,requireSiteAccess,type WorkspaceUser} from './access.js';
import {Problem,audit} from './security.js';
import {exportSequences,modelDirectory,modelStatus} from './intelligence.js';
import {exportClickExamples,eulerDirectory,eulerStatus} from './euler-intelligence.js';

type Model='sasrec'|'euler'|'conversion';
type Run={id:string;scope:IntelligenceScope;model:Model;requested_by:string;dataset_from:string|Date;dataset_to:string|Date};
const date=(v:string|Date)=>new Date(v).toISOString().slice(0,10);
export const trainingScopeKey=(scope:IntelligenceScope)=>createHash('sha256').update(JSON.stringify([scope.site_id,scope.page_key,scope.data_source,scope.revision,scope.variant])).digest('hex');
const directory=(scope:IntelligenceScope,model:Model)=>model==='sasrec'?modelDirectory(scope):eulerDirectory(scope,model);
const status=(db:DB,scope:IntelligenceScope,page:any,model:Model,dir?:string)=>model==='sasrec'?modelStatus(db,scope,page,dir):eulerStatus(db,scope,page,dir,model);

// No raw stderr or filesystem paths are returned through the API.
function failure(error:unknown){
 if(error instanceof Problem)return error.code;
 const message=String((error as any)?.stderr||'')+' '+String((error as any)?.message??error);
 if(/No module named|ENOENT|not recognized/i.test(message))return 'INTELLIGENCE_PYTHON_RUNTIME_UNAVAILABLE';
 if(/minimum|support|eligible|non-overlapping|trainable|positive|negative|partition/i.test(message))return 'INTELLIGENCE_MORE_TRAINING_ACTIVITY_REQUIRED';
 return 'INTELLIGENCE_TRAINING_FAILED';
}

export function createTrainingService(db:DB){
 let closing=false,timer:ReturnType<typeof setInterval>|undefined,work:Promise<void>|undefined,child:ChildProcess|undefined;
 const stagingRoot=path.join(config.dataDir,'intelligence-training');
 async function cleanStage(id:string){
  const stage=path.resolve(stagingRoot,id);
  if(!/^[a-f0-9-]{36}$/.test(id)||path.dirname(stage)!==path.resolve(stagingRoot))throw new Error('UNSAFE_TRAINING_CLEANUP');
  await rm(stage,{recursive:true,force:true});
 }
 async function pageFor(scope:IntelligenceScope,userId:string,connection:DB=db){
  const [u]=await connection.query<WorkspaceUser>('SELECT id,email,role FROM users WHERE id=$1',[userId]);
  if(!u)throw new Problem(403,'INTELLIGENCE_TRAINING_PERMISSION_REVOKED');
  requireEditor(u);const site=await requireSiteAccess(connection,u,scope.site_id);
  const [page]=await connection.query('SELECT * FROM pages WHERE site_id=$1 AND page_key=$2',[scope.site_id,scope.page_key]);
  if(!page||page.revision!==scope.revision)throw new Problem(409,'INTELLIGENCE_REVISION_MISMATCH');
  return {...page,environment:site.environment};
 }
 async function enqueue(request:TrainingRequest,userId:string,connection:DB=db){
  const {models,from,to,...scope}=request;
  const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>=90*86400000)throw new Problem(400,'INTELLIGENCE_DATE_RANGE_INVALID');
  const insert=async(tx:DB)=>{
   await tx.query("SELECT value FROM settings WHERE key='intelligence_worker' FOR UPDATE");
   if((await tx.query("SELECT id FROM intelligence_runs WHERE status IN ('queued','running') LIMIT 31")).length+models.length>30)throw new Problem(429,'INTELLIGENCE_QUEUE_FULL');
   const key=trainingScopeKey(scope),ids:string[]=[];
   if((await tx.query("SELECT id FROM intelligence_runs WHERE scope_key=$1 AND model=ANY($2::text[]) AND status IN ('queued','running')",[key,models])).length)throw new Problem(409,'INTELLIGENCE_TRAINING_ALREADY_QUEUED');
   for(const model of models){
    const id=randomUUID();ids.push(id);
    await tx.query('INSERT INTO intelligence_runs(id,site_id,page_key,scope,scope_key,model,requested_by,dataset_from,dataset_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,scope.site_id,scope.page_key,JSON.stringify(scope),key,model,userId,from,to]);
   }
   await audit(tx,userId,'intelligence_training_queued',scope.site_id,{page_key:scope.page_key,models,run_ids:ids});
   return {run_ids:ids};
  };
  return connection===db?db.transaction(insert):insert(connection);
 }
 async function setSchedule(input:TrainingSchedule,userId:string){
  const {interval_hours,lookback_days,...scope}=input;
  await db.query(`INSERT INTO intelligence_schedules(site_id,page_key,scope,scope_key,requested_by,interval_hours,lookback_days,next_run_at)
   VALUES($1,$2,$3,$4,$5,$6::integer,$7,now()+$6::integer*interval '1 hour') ON CONFLICT(scope_key) DO UPDATE SET requested_by=$5,interval_hours=$6::integer,lookback_days=$7,next_run_at=now()+$6::integer*interval '1 hour'`,
   [scope.site_id,scope.page_key,JSON.stringify(scope),trainingScopeKey(scope),userId,interval_hours,lookback_days]);
  await audit(db,userId,'intelligence_schedule_updated',scope.site_id,{page_key:scope.page_key,interval_hours,lookback_days});
  return {ok:true};
 }
 async function scheduleDue(){
  const due=await db.query('SELECT * FROM intelligence_schedules WHERE interval_hours>0 AND next_run_at<=now() ORDER BY next_run_at LIMIT 10');
  for(const schedule of due){
   try{
    await pageFor(schedule.scope,schedule.requested_by);
    await db.transaction(async tx=>{
     const [row]=await tx.query('SELECT * FROM intelligence_schedules WHERE id=$1 AND interval_hours>0 AND next_run_at<=now() FOR UPDATE',[schedule.id]);
     if(!row)return;
     // Skip a missed interval rather than creating a catch-up storm.
     await tx.query("UPDATE intelligence_schedules SET next_run_at=now()+interval_hours*interval '1 hour' WHERE id=$1",[row.id]);
     const pending=await tx.query("SELECT id FROM intelligence_runs WHERE scope_key=$1 AND status IN ('queued','running')",[row.scope_key]);
     if(pending.length)return;
     const today=new Date().toISOString().slice(0,10),from=new Date(Date.parse(today+'T00:00:00Z')-(row.lookback_days-1)*86400000).toISOString().slice(0,10);
     const [page]=await tx.query('SELECT primary_action_id FROM pages WHERE site_id=$1 AND page_key=$2',[row.site_id,row.page_key]);
     await enqueue({...row.scope,models:page?.primary_action_id?['sasrec','euler','conversion']:['sasrec','euler'],from,to:today},row.requested_by,tx);
    });
   }catch(e){
    if(e instanceof Problem&&e.status!==429){
     await db.query('UPDATE intelligence_schedules SET interval_hours=0 WHERE id=$1',[schedule.id]);
     await audit(db,null,'intelligence_schedule_disabled',schedule.site_id,{reason:e.code});
    }else throw e;
   }
  }
 }
 async function publish(run:Run,source:string,restoring=false){
  // The same DB lock protects publication and rollback. A withdrawal obtains
  // the site row before rotating the evidence version, so stale models fail closed.
  return db.transaction(async tx=>{
   await tx.query("SELECT value FROM settings WHERE key='intelligence_worker' FOR UPDATE");
   const [current]=await tx.query('SELECT status FROM intelligence_runs WHERE id=$1 FOR UPDATE',[run.id]);
   if(current?.status!==(restoring?'completed':'running'))throw new Problem(409,'INTELLIGENCE_TRAINING_INTERRUPTED');
   await tx.query('SELECT id FROM sites WHERE id=$1 FOR UPDATE',[run.scope.site_id]);
   const page=await pageFor(run.scope,run.requested_by,tx);
   const checked=await status(tx,run.scope,page,run.model,source);
   if(checked.status!=='ready')throw new Problem(409,'INTELLIGENCE_TRAINED_MODEL_'+checked.status.toUpperCase());
   const dest=directory(run.scope,run.model);await mkdir(dest,{recursive:true,mode:0o700});
   // A single atomic pointer replacement activates the immutable pair. Failed
   // training/publication leaves the previous pointer and model intact.
   await writeFile(path.join(dest,'active.json.next'),JSON.stringify({run_id:run.id}),{mode:0o600});
   await rename(path.join(dest,'active.json.next'),path.join(dest,'active.json'));
   return checked.manifest;
  });
 }
 async function execute(run:Run){
  const stage=path.join(stagingRoot,run.id),output=path.join(stage,'output');
  try{
   const page=await pageFor(run.scope,run.requested_by);
   const query:IntelligenceDatasetQuery={...run.scope,from:date(run.dataset_from),to:date(run.dataset_to)};
   const dataset=run.model==='sasrec'?await exportSequences(db,query,page):await exportClickExamples(db,query,page,run.model);
   await mkdir(stage,{recursive:true,mode:0o700});
   const datasetFile=path.join(stage,'dataset.json');await writeFile(datasetFile,JSON.stringify(dataset),{mode:0o600});
   if(closing)throw new Problem(503,'INTELLIGENCE_TRAINING_INTERRUPTED');
   const points:TrainingPoint[]=[];let pending='',updates=Promise.resolve();
   await new Promise<void>((resolve,reject)=>{
    child=execFile(config.intelligencePython,[fromRoot('apps/intelligence',run.model==='sasrec'?'sasrec.py':'eulernet.py'),'train','--dataset',datasetFile,'--output-dir',output,'--progress'],{timeout:30*60000,maxBuffer:1024*1024,windowsHide:true},(error,_stdout,stderr)=>{
     child=undefined;if(error){Object.assign(error,{stderr});reject(error);}else resolve();
    });
    child.stdout?.on('data',(bytes:Buffer|string)=>{
     pending+=bytes.toString();let pos:number;
     while((pos=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,pos);pending=pending.slice(pos+1);
      try{
       const {event,...point}=JSON.parse(line);
       if(event!=='progress'||!Number.isFinite(point.loss)||point.loss<0||!Number.isInteger(point.epoch)||!Number.isInteger(point.epochs)||point.epoch<1||point.epoch>point.epochs||!['sasrec','eulernet','logistic'].includes(point.phase)||points.length>=2000)continue;
       points.push(point);const snapshot=JSON.stringify(points);
       updates=updates.then(async()=>{await db.query('UPDATE intelligence_runs SET progress=$2 WHERE id=$1 AND status=\'running\'',[run.id,snapshot]);});
       // Observe failures immediately while retaining them for the final await.
       void updates.catch(()=>{});
      }catch{/* Non-protocol stdout cannot update job state. */}
     }
    });
   });
   await updates;
   if(closing)throw new Problem(503,'INTELLIGENCE_TRAINING_INTERRUPTED');
   // Immutable versions keep the previous active model usable while training.
   const archive=path.join(directory(run.scope,run.model),'versions',run.id);
   await mkdir(archive,{recursive:true,mode:0o700});
   for(const file of ['model.pt','manifest.json'])await copyFile(path.join(output,file),path.join(archive,file));
   const manifest=await publish(run,archive);
   await db.query("UPDATE intelligence_runs SET status='completed',manifest=$2,finished_at=now() WHERE id=$1",[run.id,JSON.stringify(manifest)]);
   await audit(db,run.requested_by,'intelligence_training_completed',run.scope.site_id,{run_id:run.id,model:run.model,model_id:manifest.model_id});
  }catch(e){
   await db.query("UPDATE intelligence_runs SET status='failed',error_code=$2,finished_at=now() WHERE id=$1",[run.id,closing?'INTELLIGENCE_TRAINING_INTERRUPTED':failure(e)]);
  }finally{
   // run.id is generated internally, and never taken from a path or request.
   await cleanStage(run.id);
  }
 }
 async function tick(){
  if(closing)return;
  await scheduleDue();
  const {run,interrupted}=await db.transaction(async tx=>{
   await tx.query("SELECT value FROM settings WHERE key='intelligence_worker' FOR UPDATE");
   const interrupted=await tx.query("UPDATE intelligence_runs SET status='failed',error_code='INTELLIGENCE_TRAINING_INTERRUPTED',finished_at=now() WHERE status='running' AND started_at<now()-interval '35 minutes' RETURNING id");
   if((await tx.query("SELECT id FROM intelligence_runs WHERE status='running' LIMIT 1")).length)return {run:undefined,interrupted};
   const [next]=await tx.query<Run>("SELECT * FROM intelligence_runs WHERE status='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE");
   if(next)await tx.query("UPDATE intelligence_runs SET status='running',started_at=now() WHERE id=$1",[next.id]);
   return {run:next,interrupted};
  });
  for(const row of interrupted)await cleanStage(row.id);
  if(run)await execute(run);
 }
 async function rollback(scope:IntelligenceScope,runId:string,userId:string){
  const [run]=await db.query<Run>("SELECT * FROM intelligence_runs WHERE id=$1 AND scope_key=$2 AND status='completed'",[runId,trainingScopeKey(scope)]);
  if(!run)throw new Problem(404,'INTELLIGENCE_VERSION_NOT_FOUND');
  if((await db.query("SELECT id FROM intelligence_runs WHERE status='running' LIMIT 1")).length)throw new Problem(409,'INTELLIGENCE_TRAINING_BUSY');
  const manifest=await publish({...run,requested_by:userId},path.join(directory(scope,run.model),'versions',run.id),true);
  await audit(db,userId,'intelligence_model_rolled_back',scope.site_id,{run_id:run.id,model_id:manifest.model_id});
  return {ok:true,model_id:manifest.model_id};
 }
 function wake(){if(!work&&!closing){work=tick().catch(()=>{console.error('INTELLIGENCE_WORKER_TICK_FAILED');}).finally(()=>{work=undefined;});}}
 return {enqueue,setSchedule,rollback,tick,wake,
  async start(){
   // Remove datasets left by a crashed process after its lease expires.
   const entries=await readdir(stagingRoot,{withFileTypes:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
   for(const entry of entries){
    if(!entry.isDirectory()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;
    const [live]=await db.query("SELECT id FROM intelligence_runs WHERE id=$1 AND status='running' AND started_at>now()-interval '35 minutes'",[entry.name]);
    if(!live)await cleanStage(entry.name);
   }
   timer=setInterval(wake,5000);timer.unref();wake();
  },
  async close(){closing=true;if(timer)clearInterval(timer);child?.kill();await work;},
 };
}
