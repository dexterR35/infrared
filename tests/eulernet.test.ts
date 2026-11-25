import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {testDB,batch} from './fixtures.js';
import {seedEulerViews} from './euler-fixtures.js';
import {createManagement} from '../apps/server/management.js';
import {digest} from '../apps/server/security.js';
import {config} from '../apps/server/config.js';
import {exportClickExamples,eulerStatus,eulerDirectory} from '../apps/server/euler-intelligence.js';
import {exportSequences,modelStatus,pruneIntelligence} from '../apps/server/intelligence.js';
import {eulerFeatures,exposureElement} from '../packages/domain/click-prediction.js';
import {registerAcquisitionVisit,withdrawAcquisitionUnit} from '../apps/server/acquisition.js';
import type {DB} from '../packages/db/index.js';
import type {IntelligenceDatasetQuery} from '../packages/contracts/intelligence.js';
let db:DB,app:ReturnType<typeof createManagement>,temporary:string,page:any;
const originalDataDir=config.dataDir;
const f:IntelligenceDatasetQuery={site_id:'local-demo',page_key:'casino-halloween',data_source:'seeded',revision:'demo-v1',variant:'control',from:new Date(Date.now()-2*86400000).toISOString().slice(0,10),to:new Date().toISOString().slice(0,10)};
const {from,to,...scope}=f;
const history=['page_view','exposure:hero-register'];
const headers=(role='owner')=>({host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'ir_session='+role,'x-csrf-token':'test'});
const url=(endpoint:string)=>'/api/intelligence/euler/'+endpoint+'?'+new URLSearchParams(endpoint==='dataset'?f:scope);
beforeAll(async()=>{
 temporary=await mkdtemp(path.join(tmpdir(),'infrared-euler-'));config.dataDir=temporary;
 db=await testDB();[page]=await db.query("SELECT p.*,s.environment FROM pages p JOIN sites s ON s.id=p.site_id WHERE p.site_id='local-demo' AND page_key='casino-halloween'");
 for(const role of ['owner','analyst','installer']){
  await db.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,\'unused\',$1)',[role,role+'@test.invalid']);
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'test',now()+interval '1 hour')",[digest(role),role]);
  if(role!=='owner')await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES($1,'local-demo')",[role]);
 }
 await seedEulerViews(db);app=createManagement(db,new Map());await app.ready();
});
afterAll(async()=>{await app?.close();await db?.close();config.dataDir=originalDataDir;if(path.dirname(path.resolve(temporary))!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('infrared-euler-'))throw new Error('UNSAFE_TEST_CLEANUP');await rm(temporary,{recursive:true,force:true});});

it('exports exposure-time features and real positive/negative labels without future features or identifiers',async()=>{
 const response=await app.inject({url:url('dataset'),headers:headers()});expect(response.statusCode).toBe(200);
 const dataset=response.json();expect(dataset.views).toHaveLength(80);expect(dataset.views.flatMap((v:any)=>v.examples).filter((e:any)=>e.label===1)).toHaveLength(40);
 expect(dataset.views.every((v:any)=>v.examples[0].features.recent_clicks==='0')).toBe(true);
 expect(dataset.views[0].examples[0].features.previous_action).toBe('page_view');
 expect(response.body).not.toMatch(/view_id|session_id|client_x|rect|"source"|"viewport"/);
});
it('excludes censored positives AND negatives, interrupted windows and missing/dropped events',async()=>{
 const ids=await seedEulerViews(db,6);
 for(const id of ids.slice(0,2))await db.query("DELETE FROM events WHERE view_id=$1 AND event_type='progress' AND (payload->>'elapsed_ms')::int>25000",[id]);
 await db.query("UPDATE events SET event_type='exit',payload=jsonb_set(jsonb_set(payload,'{type}','\"exit\"'),'{kind}','\"hidden\"') WHERE view_id=$1 AND (payload->>'elapsed_ms')::int=20000",[ids[2]]);
 await db.query("UPDATE events SET payload=jsonb_set(payload,'{seq}','5') WHERE view_id=$1 AND (payload->>'elapsed_ms')::int=35000",[ids[3]]);
 const delivery={...batch().events[0],type:'delivery',seq:6,elapsed_ms:36000,dropped_events:1};
 await db.query("INSERT INTO events(site_id,event_id,view_id,event_hash,event_type,payload) VALUES('local-demo',$1,$2,'test','delivery',$3)",[randomUUID(),ids[4],JSON.stringify(delivery)]);
 await db.query("UPDATE events SET payload=jsonb_set(payload,'{elapsed_ms}',to_jsonb((payload->>'elapsed_ms')::int/10)) WHERE view_id=$1 AND event_type='progress' AND (payload->>'elapsed_ms')::int<30000",[ids[5]]);
 const dataset=await exportClickExamples(db,f,page);expect(dataset.views).toHaveLength(80);expect(dataset.exclusions).toEqual({censored_exposures:4,invalid_views:2});
});
it('requires the current first exposure and derives identical bounded prefix features for serving',()=>{
 expect(exposureElement(['page_view','click:hero-register'])).toBeUndefined();
 expect(exposureElement(['page_view','exposure:hero-register','exposure:hero-register'])).toBeUndefined();
 expect(eulerFeatures(history,'desktop')).toEqual({element_id:'hero-register',device:'desktop',previous_action:'page_view',recent_clicks:'0',recent_activations:'0',recent_length:'0-4'});
 expect(eulerFeatures(['page_view','click:hero-register','exposure:hero-register'],'mobile').recent_clicks).toBe('1');
});
it('enforces role, membership, source, CSRF and real cohort rules',async()=>{
 expect((await app.inject({url:url('status'),headers:{host:'127.0.0.1:3000'}})).statusCode).toBe(401);
 expect((await app.inject({url:url('dataset'),headers:headers('analyst')})).statusCode).toBe(403);
 expect((await app.inject({url:url('status'),headers:headers('installer')})).statusCode).toBe(403);
 expect((await app.inject({url:url('status').replace('local-demo','example-real'),headers:headers('analyst')})).statusCode).toBe(404);
 expect((await app.inject({url:url('dataset').replace('seeded','recorded'),headers:headers()})).statusCode).toBe(422);
 expect((await app.inject({url:url('status').replace('seeded','legacy'),headers:headers()})).statusCode).toBe(400);
 const payload={...scope,history,device:'desktop',top_k:5};
 expect((await app.inject({method:'POST',url:'/api/intelligence/analyze',headers:{...headers(),'x-csrf-token':''},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/intelligence/analyze',headers:headers(),payload})).statusCode).toBe(409);
 await db.query("UPDATE settings SET value=jsonb_set(value,'{minimum_views}','100') WHERE key='privacy'");
 await expect(exportClickExamples(db,f,{...page,environment:'real'})).rejects.toMatchObject({code:'EULERNET_NO_OBSERVED_WINDOWS'});
 await db.query("UPDATE settings SET value=jsonb_set(value,'{minimum_views}','20') WHERE key='privacy'");
});
it.skipIf(!process.env.INFRARED_INTELLIGENCE_PYTHON)('trains both models, returns their separate outputs, and invalidates both on withdrawal',async()=>{
 const eulerFile=path.join(temporary,'clicks.json'),sasrecFile=path.join(temporary,'sequences.json');
 await writeFile(eulerFile,JSON.stringify(await exportClickExamples(db,f,page)));await writeFile(sasrecFile,JSON.stringify(await exportSequences(db,f,page)));
 await promisify(execFile)(config.intelligencePython,['apps/intelligence/eulernet.py','train','--dataset',eulerFile,'--data-dir',temporary,'--epochs','2','--width','4'],{timeout:30000,windowsHide:true});
 await promisify(execFile)(config.intelligencePython,['apps/intelligence/sasrec.py','train','--dataset',sasrecFile,'--data-dir',temporary,'--epochs','2','--hidden','8'],{timeout:30000,windowsHide:true});
 expect((await eulerStatus(db,scope,page)).status).toBe('ready');
 const response=await app.inject({method:'POST',url:'/api/intelligence/analyze',headers:headers(),payload:{...scope,history,device:'desktop',top_k:5}});
 expect(response.statusCode).toBe(200);const result=response.json();expect(result.combination).toBe('separate_objectives');expect(result.sasrec.rankings.length).toBeGreaterThan(0);
 expect(result.eulernet.probability).toBeGreaterThanOrEqual(0);expect(result.eulernet.probability).toBeLessThanOrEqual(1);expect(result.eulernet.validation_state).toBe('fixture_only');
 expect((await app.inject({method:'POST',url:'/api/intelligence/euler/predict',headers:headers(),payload:{...scope,history:['page_view'],device:'desktop'}})).json().error.code).toBe('INTELLIGENCE_FIRST_EXPOSURE_REQUIRED');
 const file=path.join(eulerDirectory(scope),'manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,JSON.stringify({...manifest,expires_at:'2000-01-01T00:00:00Z'}));expect((await eulerStatus(db,scope,page)).status).toBe('expired');await writeFile(file,JSON.stringify(manifest));
 const visit=await registerAcquisitionVisit(db,'local-demo',{receipt_id:randomUUID(),unit_token:'unit_'+randomUUID(),page_key:f.page_key,campaign:'unknown',device:'desktop',analytics_consent:true,public_context:true,policy_version:'demo-v1'});
 await withdrawAcquisitionUnit(db,'local-demo',visit.visit_id);expect((await eulerStatus(db,scope,page)).status).toBe('incompatible');expect((await modelStatus(db,scope,page)).status).toBe('incompatible');
 const versions=await db.query('SELECT id,intelligence_version FROM sites');expect(await pruneIntelligence(temporary,30,new Map(versions.map(s=>[s.id,s.intelligence_version])))).toBe(2);
},60000);
