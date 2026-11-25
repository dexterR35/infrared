import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {testDB,batch} from './fixtures.js';
import {createManagement} from '../apps/server/management.js';
import {digest} from '../apps/server/security.js';
import {exportSequences,sequenceScope,modelDirectory,modelStatus,pruneIntelligence} from '../apps/server/intelligence.js';
import {config} from '../apps/server/config.js';
import {registerAcquisitionVisit,withdrawAcquisitionUnit} from '../apps/server/acquisition.js';
import type {DB} from '../packages/db/index.js';
import type {IntelligenceDatasetQuery,ModelManifest} from '../packages/contracts/intelligence.js';
let db:DB,app:ReturnType<typeof createManagement>,temporary:string,page:any;
const originalDataDir=config.dataDir;
const f:IntelligenceDatasetQuery={site_id:'local-demo',page_key:'casino-halloween',data_source:'seeded',revision:'demo-v1',variant:'control',from:new Date(Date.now()-3*86400000).toISOString().slice(0,10),to:new Date().toISOString().slice(0,10)};
const {from,to,...scope}=f;
const headers=(role='owner')=>({host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'ir_session='+role,'x-csrf-token':'test'});
const url=(endpoint:string)=>'/api/intelligence/'+endpoint+'?'+new URLSearchParams(endpoint==='dataset'?f:scope);
beforeAll(async()=>{
 temporary=await mkdtemp(path.join(tmpdir(),'infrared-intelligence-'));config.dataDir=temporary;
 db=await testDB();[page]=await db.query("SELECT p.*,s.environment FROM pages p JOIN sites s ON s.id=p.site_id WHERE p.site_id='local-demo' AND page_key='casino-halloween'");
 for(const role of ['owner','administrator','analyst','viewer','installer']){
  await db.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,\'unused\',$1)',[role,role+'@test.invalid']);
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'test',now()+interval '1 hour')",[digest(role),role]);
  if(role!=='owner')await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES($1,'local-demo')",[role]);
 }
 for(let i=0;i<40;i++){
  const view=randomUUID(),b=batch();
  const start=new Date(Date.now()-2*86400000+i*600000).toISOString();
  await db.query("INSERT INTO views(site_id,view_id,page_key,started_at,context,context_hash,config_version,sample_rate,data_source) VALUES('local-demo',$1,'casino-halloween',$2,$3,'test',1,1,'seeded')",[view,start,JSON.stringify(b.context)]);
  const base=b.events[0];
  const events=[base,{...base,type:'exposure',seq:1,elapsed_ms:1100,element_id:'hero-register',first_qualified:true},
   {...base,type:'click',seq:2,elapsed_ms:1200,target:{element_id:'hero-register'}},
   {...base,type:'click',seq:3,elapsed_ms:1300,target:{element_id:'hero-register'}},
   {...base,type:'activation',seq:4,elapsed_ms:1400,action_id:'registration-start'},
   {...base,type:'click',seq:5,elapsed_ms:1500,target:{element_id:'unregistered'}},
   {...base,type:'diagnostic',seq:6,elapsed_ms:1600,code:'private-noise'}];
  // Deliberately reversed storage order; logical event sequence is authoritative.
  for(const e of events.reverse())await db.query("INSERT INTO events(site_id,event_id,view_id,event_hash,event_type,payload) VALUES('local-demo',$1,$2,'test',$3,$4)",[randomUUID(),view,e.type,JSON.stringify(e)]);
 }
 app=createManagement(db,new Map());await app.ready();
});
afterAll(async()=>{await app?.close();await db?.close();config.dataDir=originalDataDir;if(path.dirname(path.resolve(temporary))!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('infrared-intelligence-'))throw new Error('UNSAFE_TEST_CLEANUP');await rm(temporary,{recursive:true,force:true});});

it('exports registered ordered within-view sequences without identifiers or private payloads',async()=>{
 const response=await app.inject({url:url('dataset'),headers:headers()});expect(response.statusCode).toBe(200);
 const dataset=response.json();expect(dataset.sequences).toHaveLength(40);
 expect(dataset.sequences[0].tokens).toEqual(['page_view','exposure:hero-register','click:hero-register','click:hero-register','activation:registration-start']);
 expect(Object.keys(dataset.sequences[0]).sort()).toEqual(['ended_at','started_at','tokens']);
 expect(response.body).not.toContain('private-noise');expect(response.body).not.toContain('view_id');
 expect(dataset.scope).toEqual(sequenceScope(scope,page));expect(response.headers['cache-control']).toBe('no-store');
 expect((await db.query("SELECT 1 FROM audit WHERE action='intelligence_dataset_exported'")).length).toBe(1);
});
it('enforces authentication, membership, export roles and prediction CSRF',async()=>{
 expect((await app.inject({url:url('status'),headers:{host:'127.0.0.1:3000'}})).statusCode).toBe(401);
 for(const role of ['analyst','viewer','installer'])expect((await app.inject({url:url('dataset'),headers:headers(role)})).statusCode).toBe(403);
 expect((await app.inject({url:url('status'),headers:headers('viewer')})).json()).toEqual({status:'not_trained'});
 expect((await app.inject({url:url('status').replace('local-demo','example-real'),headers:headers('viewer')})).statusCode).toBe(404);
 expect((await app.inject({url:url('status'),headers:headers('installer')})).statusCode).toBe(403);
 const payload={...scope,history:['page_view'],top_k:5};
 expect((await app.inject({method:'POST',url:'/api/intelligence/predict',headers:{...headers(),'x-csrf-token':''},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/intelligence/predict',headers:headers(),payload})).json().error.code).toBe('INTELLIGENCE_MODEL_NOT_TRAINED');
 expect((await app.inject({method:'POST',url:'/api/intelligence/predict',headers:headers(),payload:{...payload,history:['email:secret']}})).statusCode).toBe(422);
});
it('separates sources and revisions and rejects invalid or oversized requests',async()=>{
 expect((await app.inject({url:url('dataset').replace('seeded','recorded'),headers:headers()})).statusCode).toBe(422);
 expect((await app.inject({url:url('status').replace('demo-v1','old-v1'),headers:headers()})).statusCode).toBe(409);
 expect((await app.inject({url:url('status').replace('seeded','legacy'),headers:headers()})).statusCode).toBe(400);
 await expect(exportSequences(db,{...f,from:'2020-01-01'},page)).rejects.toMatchObject({code:'INTELLIGENCE_DATE_RANGE_INVALID'});
 expect((await app.inject({method:'POST',url:'/api/intelligence/predict',headers:headers(),payload:{...scope,history:Array(51).fill('page_view'),top_k:5}})).statusCode).toBe(400);
});
it('applies real activity minimum cohorts and current retention on export',async()=>{
 await db.query("UPDATE settings SET value=jsonb_set(value,'{minimum_views}','100') WHERE key='privacy'");
 await expect(exportSequences(db,f,{...page,environment:'real'})).rejects.toMatchObject({code:'INTELLIGENCE_INSUFFICIENT_SEQUENCES'});
 await db.query("UPDATE settings SET value=jsonb_set(value,'{raw_days}','1') WHERE key='privacy'");
 await expect(exportSequences(db,f,page)).rejects.toMatchObject({code:'INTELLIGENCE_INSUFFICIENT_SEQUENCES'});
 await db.query("UPDATE settings SET value=jsonb_set(jsonb_set(value,'{raw_days}','30'),'{minimum_views}','20') WHERE key='privacy'");
});
it('rejects changed or expired models, and retention removes only managed artifacts',async()=>{
 const dataset=await exportSequences(db,f,page),dir=modelDirectory(scope);await mkdir(dir,{recursive:true});
 const manifest:ModelManifest={schema_version:1,model:'SASRec',model_id:'fixture',scope:dataset.scope,created_at:new Date().toISOString(),expires_at:dataset.expires_at,oldest_started_at:dataset.sequences[0].started_at,vocabulary:['page_view','click:hero-register'],max_length:50,minimum_token_views:1,evaluation:{test_sequences:1,unknown_targets:0,k:1,sasrec:{hit_rate:1,ndcg:1},markov:{hit_rate:1,ndcg:1},popularity:{hit_rate:1,ndcg:1}}};
 await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(dir,'model.pt'),'fixture');await writeFile(path.join(dir,'keep.txt'),'keep');
 expect((await modelStatus(db,scope,page)).status).toBe('ready');
 expect((await modelStatus(db,scope,{...page,elements:['changed']})).status).toBe('incompatible');
 await db.query("UPDATE settings SET value=jsonb_set(value,'{raw_days}','1') WHERE key='privacy'");
 expect((await modelStatus(db,scope,page)).status).toBe('expired');
 expect(await pruneIntelligence(temporary,1)).toBe(1);expect(await readFile(path.join(dir,'keep.txt'),'utf8')).toBe('keep');
 expect((await modelStatus(db,scope,page)).status).toBe('not_trained');
 await db.query("UPDATE settings SET value=jsonb_set(value,'{raw_days}','30') WHERE key='privacy'");
});
it.skipIf(!process.env.INFRARED_INTELLIGENCE_PYTHON)('trains an exported dataset and serves real SASRec predictions through the API',async()=>{
 const dataset=await exportSequences(db,f,page),file=path.join(temporary,'dataset.json');await writeFile(file,JSON.stringify(dataset));
 await promisify(execFile)(config.intelligencePython,['apps/intelligence/sasrec.py','train','--dataset',file,'--data-dir',temporary,'--epochs','2','--hidden','8'],{timeout:30000,windowsHide:true});
 const status=await app.inject({url:url('status'),headers:headers()});expect(status.json().status).toBe('ready');
 const response=await app.inject({method:'POST',url:'/api/intelligence/predict',headers:headers(),payload:{...scope,history:['page_view','click:hero-register'],top_k:5}});
 expect(response.statusCode).toBe(200);expect(response.json().rankings.length).toBeGreaterThan(0);
 expect(response.json().score_type).toBe('ranking_logit');expect(response.json().data_source).toBe('seeded');
 expect(response.json().rankings.every((r:any)=>Number.isFinite(r.score))).toBe(true);
 expect(response.json().rankings.some((r:any)=>r.action==='page_view')).toBe(false);
 const visit=await registerAcquisitionVisit(db,'local-demo',{receipt_id:randomUUID(),unit_token:'unit_'+randomUUID(),page_key:f.page_key,campaign:'unknown',device:'desktop',analytics_consent:true,public_context:true,policy_version:'demo-v1'});
 await withdrawAcquisitionUnit(db,'local-demo',visit.visit_id);
 expect((await modelStatus(db,scope,page)).status).toBe('incompatible');
 const versions=await db.query('SELECT id,intelligence_version FROM sites');
 expect(await pruneIntelligence(temporary,30,new Map(versions.map(s=>[s.id,s.intelligence_version])))).toBe(1);
});
