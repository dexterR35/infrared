import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {testDB,batch,realOrigin} from './fixtures.js';
import type {DB} from '../packages/db/index.js';
import {createManagement} from '../apps/server/management.js';
import {createCollector} from '../apps/server/collector.js';
import {ingest} from '../apps/server/ingestion.js';
import {eligiblePage} from '../apps/server/acquisition.js';
import {installationStatuses} from '../apps/server/installation-checks.js';
import {digest} from '../packages/security/index.js';
import {visibleFraction} from '../packages/domain/visibility.js';
import {DEFAULT_RULES} from '../packages/domain/site-paths.js';
import {config} from '../apps/server/config.js';
let db:DB,app:ReturnType<typeof createManagement>,collector:ReturnType<typeof createCollector>;
const tokens={owner:randomUUID(),viewer:randomUUID(),administrator:randomUUID()};
const auth=(role:keyof typeof tokens)=>({host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'ir_session='+tokens[role],'x-csrf-token':'audit-csrf'});
beforeAll(async()=>{
 db=await testDB();
 for(const role of ['owner','viewer','administrator'] as const){
  await db.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,\'x\',$1)',[role,role+'@audit.test']);
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,'audit-csrf',now()+interval '1 hour')",[digest(tokens[role]),role]);
 }
 await db.query("UPDATE sites SET enabled=true,approval_state='approved' WHERE id='example-real'");
 await db.query("UPDATE pages SET enabled=true,approval_state='approved' WHERE site_id='example-real'");
 await db.query("INSERT INTO sites(id,site_key,name,origin,domain_group,family,environment,enabled,approval_state,archived) VALUES('archived-real','site_archived_audit','Archived','https://archived.test','archived.test','website','real',true,'approved',true)");
 await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES('viewer','archived-real'),('viewer','example-real')");
 await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES('administrator','example-real')");
 app=createManagement(db,new Map());collector=createCollector(db);await app.ready();await collector.app.ready();
});
afterAll(async()=>{await app.close();await collector.app.close();await db.close();});
it('serves newly built assets after startup with the correct MIME type',async()=>{
 const name='asset-rebuild-'+randomUUID()+'.css',file=path.resolve('dist/dashboard/assets',name);
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'.asset-rebuild-check{padding:24px}');
 try{
  const response=await app.inject({url:'/assets/'+name,headers:{host:'127.0.0.1:3000'}});expect(response.statusCode,response.body).toBe(200);expect(response.headers['content-type']).toContain('text/css');expect(response.body).toContain('padding:24px');
  const missing=await app.inject({url:'/assets/missing-'+name,headers:{host:'127.0.0.1:3000'}});expect(missing.statusCode).toBe(404);
  const index=await app.inject({url:'/',headers:{host:'127.0.0.1:3000'}});expect(index.headers['cache-control']).toBe('no-store');
 }finally{await unlink(file);}
});
it('rejects archived projects for owners and members across management and collection',async()=>{
 for(const role of ['owner','viewer'] as const){
  for(const url of ['/api/reports?site_id=archived-real&page_key=home','/api/install/site?site_id=archived-real','/api/campaigns?site_id=archived-real']){
   expect((await app.inject({url,headers:auth(role)})).statusCode,url).toBe(404);
  }
  expect((await app.inject({url:'/api/registry/export',headers:auth(role)})).body).not.toContain('https://archived.test');
  expect((await app.inject({url:'/api/bootstrap',headers:auth(role)})).json().sites.some((s:any)=>s.id==='archived-real')).toBe(false);
 }
 expect((await collector.app.inject({url:'/v2/config/site_archived_audit',headers:{origin:'https://archived.test'}})).statusCode).toBe(403);
 await expect(ingest(db,{...batch(),site_key:'site_archived_audit'},'https://archived.test')).rejects.toMatchObject({code:'COLLECTION_DISABLED'});
 await expect(eligiblePage(db,'archived-real','home')).rejects.toMatchObject({code:'COLLECTION_DISABLED'});
});
it('reports approved real website collection as enabled',async()=>{
 const rows=await installationStatuses(db,['example-real']);expect(rows[0].collection).toBe('enabled');
 expect((await collector.app.inject({url:'/v2/config/'+(await db.query("SELECT site_key FROM sites WHERE id='example-real'"))[0].site_key,headers:{origin:realOrigin}})).statusCode).toBe(200);
});
it('allows diagnostics policy without inventing primary conversion goals',async()=>{
 const payload={campaign_codes:['unknown'],diagnostics_enabled:true,diagnostic_error_codes:[],primary_cta_id:'',primary_action_id:''};
 const r=await app.inject({method:'PATCH',url:'/api/pages/example-real/casino-halloween/policy',headers:auth('owner'),payload});expect(r.statusCode,r.body).toBe(200);
 const bad=await app.inject({method:'PATCH',url:'/api/pages/example-real/casino-halloween/policy',headers:auth('owner'),payload:{...payload,primary_cta_id:'not-registered'}});expect(bad.statusCode).toBe(422);
});
it('does not let administrators expand live collection beyond the owner-approved scope',async()=>{
 const response=await app.inject({method:'PATCH',url:'/api/sites/example-real/collection',headers:auth('administrator'),payload:{collection_mode:'whole_site',rules:DEFAULT_RULES,elements:[],actions:[]}});
 expect(response.statusCode).toBe(403);expect(response.json().error.code).toBe('LIVE_APPROVAL_REQUIRED');
 const [site]=await db.query("SELECT collection_mode FROM sites WHERE id='example-real'");expect(site.collection_mode).toBe('selected_pages');
});
it('rejects synthetic acquisition collection in production as well as browser events',async()=>{
 const release=config.releaseStatus;config.releaseStatus='PRODUCTION';
 try{await expect(eligiblePage(db,'local-demo','casino-halloween')).rejects.toMatchObject({code:'COLLECTION_DISABLED'});}
 finally{config.releaseStatus=release;}
});
it('requires visible area in both axes for qualified exposure',()=>{
 expect(visibleFraction({left:2000,right:2100,top:0,bottom:100,width:100,height:100},1000,1000)).toBe(0);
 expect(visibleFraction({left:950,right:1050,top:950,bottom:1050,width:100,height:100},1000,1000)).toBe(.25);
 expect(visibleFraction({left:0,right:100,top:0,bottom:100,width:100,height:100},1000,1000)).toBe(1);
 expect(visibleFraction({left:0,right:0,top:0,bottom:0,width:0,height:0},1000,1000)).toBe(0);
});
