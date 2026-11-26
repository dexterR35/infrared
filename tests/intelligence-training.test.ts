import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {testDB} from './fixtures.js';
import {seedEulerViews} from './euler-fixtures.js';
import {openDB,type DB} from '../packages/db/index.js';
import {saveBackup,restoreBackup} from '../apps/server/backup-service.js';
import type {IntelligenceDatasetQuery,ModelManifest} from '../packages/contracts/intelligence.js';
import {config} from '../apps/server/config.js';
import {createTrainingService} from '../apps/server/intelligence-training.js';
import {exportSequences,modelDirectory,modelStatus,pruneIntelligence} from '../apps/server/intelligence.js';
import {exportClickExamples,eulerStatus,predictClick,monitorModel} from '../apps/server/euler-intelligence.js';
import {createManagement} from '../apps/server/management.js';
import {digest} from '../apps/server/security.js';
import {journeyGraph,elementPerformance} from '../apps/server/intelligence-insights.js';

let db:DB,service:ReturnType<typeof createTrainingService>,temporary:string,page:any;
const original={dataDir:config.dataDir,python:config.intelligencePython};
const f:IntelligenceDatasetQuery={site_id:'local-demo',page_key:'casino-halloween',data_source:'seeded',revision:'demo-v1',variant:'control',from:new Date(Date.now()-2*86400000).toISOString().slice(0,10),to:new Date().toISOString().slice(0,10)};
const {from,to,...scope}=f;
const headers=(role='owner')=>({host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'ir_session='+role,'x-csrf-token':'test'});
beforeAll(async()=>{
 temporary=await mkdtemp(path.join(tmpdir(),'infrared-training-'));config.dataDir=temporary;
 db=await testDB();
 for(const role of ['owner','administrator','analyst','viewer','installer']){
  await db.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,\'unused\',$1)',[role,role+'@test.invalid']);
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'test',now()+interval '1 hour')",[digest(role),role]);
  if(role!=='owner')await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES($1,'local-demo')",[role]);
 }
 const ids=await seedEulerViews(db);
 // The primary activation occurs in the outcome window; click and conversion
 // labels deliberately disagree, proving the two targets are not aliases.
 for(let i=0;i<ids.length;i++)if(i%4<2)await db.query(`UPDATE events SET event_type='activation',payload=payload||$2::jsonb WHERE view_id=$1 AND event_type='progress' AND (payload->>'elapsed_ms')::int=20000`,[ids[i],JSON.stringify({type:'activation',action_id:'registration-start'})]);
 [page]=await db.query("SELECT p.*,s.environment FROM pages p JOIN sites s ON s.id=p.site_id WHERE p.site_id='local-demo' AND p.page_key='casino-halloween'");
 service=createTrainingService(db);
});
beforeEach(async()=>{await db.query('DELETE FROM intelligence_runs');await db.query('DELETE FROM intelligence_schedules');config.intelligencePython='infrared-python-deliberately-missing';});
afterAll(async()=>{await service?.close();await db?.close();config.dataDir=original.dataDir;config.intelligencePython=original.python;if(path.dirname(temporary)!==tmpdir()||!path.basename(temporary).startsWith('infrared-training-'))throw new Error('UNSAFE_TEST_CLEANUP');await rm(temporary,{recursive:true,force:true});});

it('queues model jobs atomically, prevents duplicates, and cleans datasets on runtime failure',async()=>{
 const result=await service.enqueue({...f,models:['sasrec','euler']},'owner');expect(result.run_ids).toHaveLength(2);
 await expect(service.enqueue({...f,models:['sasrec','conversion']},'owner')).rejects.toMatchObject({code:'INTELLIGENCE_TRAINING_ALREADY_QUEUED'});
 expect(await db.query('SELECT id FROM intelligence_runs')).toHaveLength(2);
 await service.tick();
 const rows=await db.query('SELECT status,error_code FROM intelligence_runs');
 expect(rows.filter(r=>r.status==='failed')).toHaveLength(1);expect(rows.find(r=>r.status==='failed')?.error_code).toBe('INTELLIGENCE_PYTHON_RUNTIME_UNAVAILABLE');
 expect(await readdir(path.join(temporary,'intelligence-training'))).toHaveLength(0);
});
it('runs a due schedule only once and disables it when its author loses access',async()=>{
 await service.setSchedule({...scope,interval_hours:24,lookback_days:7},'administrator');
 await db.query("UPDATE intelligence_schedules SET next_run_at=now()-interval '3 days'");
 await service.tick();expect(await db.query('SELECT id FROM intelligence_runs')).toHaveLength(3);
 await service.tick();expect(await db.query('SELECT id FROM intelligence_runs')).toHaveLength(3);
 await db.query("DELETE FROM site_memberships WHERE user_id='administrator'");
 await db.query("UPDATE intelligence_schedules SET next_run_at=now()-interval '1 hour'");
 await service.tick();expect((await db.query('SELECT interval_hours FROM intelligence_schedules'))[0].interval_hours).toBe(0);
 await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES('administrator','local-demo')");
});
it('expires an interrupted claim and removes its temporary dataset without another restart',async()=>{
 const {run_ids:[id]}=await service.enqueue({...f,models:['sasrec']},'owner');
 await db.query("UPDATE intelligence_runs SET status='running',started_at=now()-interval '36 minutes' WHERE id=$1",[id]);
 const stage=path.join(temporary,'intelligence-training',id);await mkdir(stage,{recursive:true});await writeFile(path.join(stage,'dataset.json'),'private abandoned dataset');
 await service.tick();
 expect((await db.query('SELECT status,error_code FROM intelligence_runs WHERE id=$1',[id]))[0]).toEqual({status:'failed',error_code:'INTELLIGENCE_TRAINING_INTERRUPTED'});
 await expect(readFile(path.join(stage,'dataset.json'))).rejects.toMatchObject({code:'ENOENT'});
});
it('keeps conversion labels separate from clicks and excludes already converted histories',async()=>{
 const click=await exportClickExamples(db,f,page),conversion=await exportClickExamples(db,f,page,'conversion');
 expect(conversion.target).toBe('qualified_exposure_primary_action_30s');expect(conversion.primary_action_id).toBe('registration-start');
 expect(click.views.flatMap(v=>v.examples).map(e=>e.label)).not.toEqual(conversion.views.flatMap(v=>v.examples).map(e=>e.label));
 expect(conversion.views.flatMap(v=>v.examples).filter(e=>e.label===1)).toHaveLength(40);
 await expect(exportClickExamples(db,f,{...page,primary_action_id:''},'conversion')).rejects.toMatchObject({code:'INTELLIGENCE_PRIMARY_CONVERSION_ACTION_REQUIRED'});
});
it('rolls back a compatible version and rejects a version after evidence withdrawal',async()=>{
 const {run_ids:[id]}=await service.enqueue({...f,models:['sasrec']},'owner'),dataset=await exportSequences(db,f,page);
 const manifest:ModelManifest={schema_version:1,model:'SASRec',model_id:randomUUID(),scope:dataset.scope,created_at:new Date().toISOString(),expires_at:dataset.expires_at,oldest_started_at:dataset.sequences[0].started_at,vocabulary:['page_view','exposure:hero-register','click:hero-register','activation:registration-start'],max_length:50,minimum_token_views:1,evaluation:{test_sequences:12,unknown_targets:0,k:3,sasrec:{hit_rate:1,ndcg:1},markov:{hit_rate:1,ndcg:1},popularity:{hit_rate:1,ndcg:1}}};
 const archive=path.join(modelDirectory(scope),'versions',id);await mkdir(archive,{recursive:true});await writeFile(path.join(archive,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(archive,'model.pt'),'fixture');
 await db.query("UPDATE intelligence_runs SET status='completed',manifest=$2 WHERE id=$1",[id,JSON.stringify(manifest)]);
 expect(await service.rollback(scope,id,'owner')).toMatchObject({model_id:manifest.model_id});
 expect((await modelStatus(db,scope,page)).status).toBe('ready');
 await db.query("UPDATE sites SET intelligence_version='withdrawn' WHERE id='local-demo'");
 await expect(service.rollback(scope,id,'owner')).rejects.toMatchObject({code:'INTELLIGENCE_TRAINED_MODEL_INCOMPATIBLE'});
 expect(await pruneIntelligence(temporary,30,new Map([['local-demo','withdrawn']]))).toBe(1);
 await expect(readFile(path.join(archive,'model.pt'))).rejects.toMatchObject({code:'ENOENT'});
 await db.query("UPDATE sites SET intelligence_version='initial' WHERE id='local-demo'");
});
it('protects training, schedules, rollback and journey reporting with role, membership and CSRF checks',async()=>{
 const app=createManagement(db,new Map());await app.ready();
 try{
  const payload={...f,models:['sasrec']};
  for(const role of ['analyst','viewer','installer'])expect((await app.inject({method:'POST',url:'/api/intelligence/train',headers:headers(role),payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/intelligence/train',headers:{...headers(),'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/intelligence/training?'+new URLSearchParams(scope),headers:headers('installer')})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/intelligence/training?'+new URLSearchParams({...scope,site_id:'example-real'}),headers:headers('viewer')})).statusCode).toBe(404);
  expect((await app.inject({url:'/api/intelligence/journey?'+new URLSearchParams(f),headers:headers('viewer')})).json().edges.length).toBeGreaterThan(0);
  expect((await app.inject({method:'POST',url:'/api/intelligence/train',headers:headers(),payload:{...payload,data_source:'legacy'}})).statusCode).toBe(400);
  const accepted=await app.inject({method:'POST',url:'/api/intelligence/train',headers:headers(),payload});expect(accepted.statusCode).toBe(202);
 }finally{await app.close();}
});
it('counts distinct views on journey edges and suppresses rare actions and elements',async()=>{
 const dataset=await exportSequences(db,f,page),graph=journeyGraph(dataset);
 expect(graph.edges.find(e=>e.from==='page_view'&&e.to==='exposure:hero-register')?.views).toBe(80);
 expect(journeyGraph({...dataset,minimum_token_views:81}).nodes).toHaveLength(0);
 const clicks=await exportClickExamples(db,f,page),rows=elementPerformance(clicks);expect(rows[0].views).toBe(80);expect(rows[0].flag).toBe(false);
 expect(elementPerformance({...clicks,minimum_views:81})).toHaveLength(0);
 const augmented={...clicks,views:clicks.views.map((v,i)=>({...v,examples:[...v.examples,{features:{...v.examples[0].features,element_id:'poor'},label:(i===0?1:0) as 0|1}]}))};
 expect(elementPerformance(augmented).find(e=>e.element_id==='poor')?.flag).toBe(true);
});
it('backs up schedules and restores job history as requiring retraining with a working identity sequence',async()=>{
 await service.setSchedule({...scope,interval_hours:168,lookback_days:7},'owner');
 const {run_ids:[id]}=await service.enqueue({...f,models:['sasrec']},'owner');
 const backup=path.join(temporary,'training-backup');await saveBackup(db,temporary,backup);
 const target=await openDB(undefined,'memory://');
 try{
  await restoreBackup(target,path.join(temporary,'restored'),backup);
  expect((await target.query('SELECT interval_hours FROM intelligence_schedules'))[0].interval_hours).toBe(168);
  expect((await target.query('SELECT status,error_code FROM intelligence_runs WHERE id=$1',[id]))[0]).toEqual({status:'failed',error_code:'INTELLIGENCE_RETRAIN_AFTER_RESTORE'});
  await target.query(`INSERT INTO intelligence_schedules(site_id,page_key,scope,scope_key,requested_by,interval_hours,lookback_days) SELECT site_id,page_key,scope,scope_key||'-new',requested_by,interval_hours,lookback_days FROM intelligence_schedules LIMIT 1`);
  expect(await target.query('SELECT id FROM intelligence_schedules')).toHaveLength(2);
 }finally{await target.close();}
});
it.skipIf(!process.env.INFRARED_INTELLIGENCE_PYTHON)('trains all objectives automatically, streams losses, versions models and serves conversion inference',async()=>{
 config.intelligencePython=process.env.INFRARED_INTELLIGENCE_PYTHON!;
 const {run_ids}=await service.enqueue({...f,models:['sasrec','euler','conversion']},'owner');
 for(let i=0;i<3;i++)await service.tick();
 const runs=await db.query('SELECT * FROM intelligence_runs WHERE id=ANY($1::text[])',[run_ids]);
 expect(runs.map(r=>[r.model,r.status,r.error_code])).toEqual(expect.arrayContaining([['sasrec','completed',null],['euler','completed',null],['conversion','completed',null]]));
 expect(runs.every(r=>r.progress.length>=20&&Number.isFinite(r.progress[0].loss))).toBe(true);
 const conversion=await eulerStatus(db,scope,page,undefined,'conversion');expect(conversion.status).toBe('ready');
 if(conversion.status!=='ready')throw new Error('CONVERSION_NOT_READY');
 const result=await predictClick({...scope,history:['page_view','exposure:hero-register'],device:'desktop'},conversion.manifest);
 expect(result.probability).toBeGreaterThanOrEqual(0);expect(result.probability).toBeLessThanOrEqual(1);
 expect(result.target).toBe('qualified_exposure_primary_action_30s');
 expect(await readdir(path.join(temporary,'intelligence-training'))).toHaveLength(0);
 // Monitoring scores only views that began after the newest training view.
 expect((await monitorModel(db,scope,page,'click')).status).toBe('no_fresh_views');
 await seedEulerViews(db,40,true,Date.now()-6*3600000);
 const monitored=await monitorModel(db,scope,page,'click');
 if(monitored.status!=='evaluated')throw new Error('MONITOR_NOT_EVALUATED:'+monitored.status);
 expect(monitored.fresh_views).toBe(40);expect(monitored.objective).toBe('click');
 expect(Object.keys(monitored.models)).toContain('eulernet');
 expect(['healthy','watch','retrain']).toContain(monitored.recommendation);
 expect((await monitorModel(db,scope,page,'conversion')).status).not.toBe('incompatible');
 const old=runs.find(r=>r.model==='sasrec');
 if(!old)throw new Error('SASREC_RUN_MISSING');
 await service.enqueue({...f,models:['sasrec']},'owner');await service.tick();
 await service.rollback(scope,old.id,'owner');const current=await modelStatus(db,scope,page);
 expect(current.status==='ready'&&current.manifest.model_id).toBe(old.manifest.model_id);
},120000);
