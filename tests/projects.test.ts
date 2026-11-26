import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {testDB,batch} from './fixtures.js';
import type {DB} from '../packages/db/index.js';
import {createManagement} from '../apps/server/management.js';
import {createCollector} from '../apps/server/collector.js';
import {digest} from '../packages/security/index.js';
import {migrate} from '../packages/db/index.js';
import {DEFAULT_RULES} from '../packages/domain/site-paths.js';
let db:DB,app:ReturnType<typeof createManagement>,collector:ReturnType<typeof createCollector>,project:any,second:any;
const token=randomUUID(),headers={host:'127.0.0.1:3000',cookie:'ir_session='+token,origin:'http://127.0.0.1:3000','x-csrf-token':'csrf-project'};
beforeAll(async()=>{
 db=await testDB();await db.query("INSERT INTO users(id,email,password_hash,role) VALUES('project-owner','owner@projects.test','x','owner')");
 await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,'project-owner','csrf-project',now()+interval '1 hour')",[digest(token)]);
 app=createManagement(db,new Map());collector=createCollector(db);await app.ready();await collector.app.ready();
});
afterAll(async()=>{await app.close();await collector.app.close();await db.close();});
it('prepares a home page and isolated tracking configuration without preset business categories',async()=>{
 for(const url of ['https://clothing.test','https://services.test']){
  const r=await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'Website '+url,url}});expect(r.statusCode).toBe(200);
  const [site]=await db.query('SELECT * FROM sites WHERE id=$1',[r.json().id]);
  expect(site).toMatchObject({family:'website',auto_discovery:true,collection_mode:'whole_site',site_elements:[],site_actions:[],enabled:false});
  const pages=await db.query('SELECT * FROM pages WHERE site_id=$1',[site.id]);
  expect(pages).toHaveLength(1);expect(pages[0]).toMatchObject({page_key:'p.home',name:'Home',path:'/',auto:true,enabled:false,approval_state:'pending',product:'website',elements:[],actions:[],primary_cta_id:'',primary_action_id:''});
  expect(r.json().page_key).toBe('p.home');expect(await db.query('SELECT * FROM events WHERE site_id=$1',[site.id])).toEqual([]);
  const script=await app.inject({url:'/api/install/site?site_id='+site.id,headers});expect(script.statusCode).toBe(200);expect(script.json().code).toContain(site.site_key);expect(script.json().blocked).toBe(true);
  if(!project)project=site;else second=site;
 }
 expect(project.site_key).not.toBe(second.site_key);
 const bootstrap=(await app.inject({url:'/api/bootstrap',headers})).json();expect(bootstrap.sites.some((s:any)=>s.environment==='synthetic')).toBe(false);expect(bootstrap.demo_url).toBeNull();
});
it('rejects duplicates and non-origin URLs without changing existing projects',async()=>{
 for(const [url,status] of [['https://clothing.test',409],['http://clothing.test',422],['https://store.test/account?token=x',422]]){
  expect((await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'Store',url}})).statusCode).toBe(status);
 }
 expect((await app.inject({method:'POST',url:'/api/projects',headers:{host:headers.host,origin:headers.origin},payload:{name:'No access',url:'https://other.test'}})).statusCode).toBe(401);
});
it('discovers page elements only inside the approved website and rejects arbitrary IDs',async()=>{
 expect((await app.inject({method:'POST',url:`/api/sites/${project.id}/approve`,headers,payload:{consent_policy_version:'privacy-v1'}})).statusCode).toBe(200);
 const [site]=await db.query('SELECT * FROM sites WHERE id=$1',[project.id]);
 const b={...batch(),site_key:site.site_key,config_version:site.config_version,consent:{analytics:true as const,policy_version:'privacy-v1'},context:{page_key:'p.home',page_path:'/',revision:'auto',locale:'auto',variant:'control',state:'public-default',campaign:'unknown',auto_elements:['auto.section.1','auto.button.1']}};
 expect((await collector.app.inject({method:'POST',url:'/v1/events',headers:{origin:project.origin},payload:b})).statusCode).toBe(204);
 const [page]=await db.query('SELECT * FROM pages WHERE site_id=$1',[project.id]);expect(page.elements).toEqual(['auto.section.1','auto.button.1']);expect(page.product).toBe('website');
 const otherPages=await db.query('SELECT * FROM pages WHERE site_id=$1',[second.id]);expect(otherPages).toHaveLength(1);expect(otherPages[0]).toMatchObject({enabled:false,elements:[],actions:[]});
 expect((await collector.app.inject({method:'POST',url:'/v1/events',headers:{origin:second.origin},payload:b})).statusCode).toBe(403);
 expect((await collector.app.inject({method:'POST',url:'/v1/events',headers:{origin:project.origin},payload:{...b,context:{...b.context,auto_elements:['customer@email.test']}}})).statusCode).toBe(400);
 const config=(await collector.app.inject({url:'/v2/config/'+site.site_key,headers:{origin:site.origin}})).json();expect(config.features).toContain('auto-elements-v1');
});
it('scopes installations, exports, experiments and quality totals to the selected project',async()=>{
 for(const endpoint of ['/api/installations','/api/registry/export','/api/experiments','/api/quality','/api/tables/audit']){
  const response=await app.inject({url:endpoint+'?site_id='+second.id,headers});expect(response.statusCode,response.body).toBe(200);expect(response.body).not.toContain(project.id);expect(response.body).not.toContain(project.origin);
 }
 const quality=(await app.inject({url:'/api/quality?site_id='+second.id,headers})).json();expect(quality.counts.events).toBe(0);expect(quality.counts.views).toBe(0);
 expect((await app.inject({url:'/api/quality?site_id='+project.id,headers})).json().counts.events).toBeGreaterThan(0);
});
it('prevents a project page or import from creating or changing another website',async()=>{
 const selector={origin:second.origin,path:'/summer',query_equals:{},ignored_query_names:[],other_query_policy:'ignore',duplicate_query_policy:'reject',fragment_policy:'ignore_anchor'};
 const wrong=await app.inject({method:'POST',url:'/api/landing-pages',headers,payload:{site_id:project.id,name:'Summer',page_key:'summer',product:'clothing',selector}});expect(wrong.statusCode).toBe(422);expect(wrong.json().error.code).toBe('PROJECT_WEBSITE_MISMATCH');
 const row={name:'Summer',page_key:'p.summer',url:second.origin+'/summer',market:'RO',product:'clothing',brand:'store',locale:'auto',currency:'RON',report_timezone:'Europe/Bucharest',page_family:'collection',acquisition_goal:'qualified_acquisition'};
 const imported=await app.inject({method:'POST',url:'/api/registry/import',headers,payload:{site_id:project.id,dry_run:false,rows:[row]}});expect(imported.statusCode).toBe(422);expect(imported.json().error.code).toBe('PROJECT_WEBSITE_MISMATCH');
 const valid=await app.inject({method:'POST',url:'/api/registry/import',headers,payload:{site_id:second.id,dry_run:false,rows:[row]}});expect(valid.statusCode,valid.body).toBe(200);expect(valid.json().applied).toBe(true);
 const [page]=await db.query("SELECT * FROM pages WHERE site_id=$1 AND page_key='p.summer'",[second.id]);expect(page).toMatchObject({product:'clothing',auto:true,path:'/summer',revision:'auto',locale:'auto'});
 expect(await db.query("SELECT * FROM pages WHERE site_id=$1 AND page_key='p.summer'",[project.id])).toEqual([]);
});
it('uses the same identity for manually prepared paths and automatic discovery',async()=>{
 const selector={origin:second.origin,path:'/offers/',query_equals:{},ignored_query_names:[],other_query_policy:'ignore',duplicate_query_policy:'reject',fragment_policy:'ignore_anchor'};
 const created=await app.inject({method:'POST',url:'/api/landing-pages',headers,payload:{site_id:second.id,name:'Offers',page_key:'p.offers',product:'services',selector}});expect(created.statusCode,created.body).toBe(200);
 const [page]=await db.query("SELECT * FROM pages WHERE site_id=$1 AND page_key='p.offers'",[second.id]);expect(page).toMatchObject({auto:true,path:'/offers',enabled:false,locale:'auto',revision:'auto'});
 expect((await app.inject({method:'POST',url:`/api/sites/${second.id}/approve`,headers,payload:{consent_policy_version:'privacy-v1'}})).statusCode).toBe(200);
 const [site]=await db.query('SELECT * FROM sites WHERE id=$1',[second.id]);
 const b={...batch(),site_key:site.site_key,config_version:site.config_version,consent:{analytics:true as const,policy_version:'privacy-v1'},context:{page_key:'p.offers',page_path:'/offers',revision:'auto',locale:'auto',variant:'control',state:'public-default',campaign:'unknown'}};
 const received=await collector.app.inject({method:'POST',url:'/v1/events',headers:{origin:second.origin},payload:b});expect(received.statusCode,received.body).toBe(204);
 expect((await db.query("SELECT * FROM pages WHERE site_id=$1 AND path='/offers'",[second.id])).length).toBe(1);
 // Reapproval must preserve an explicitly paused, already-approved page.
 await app.inject({method:'POST',url:`/api/pages/${second.id}/p.offers/toggle`,headers,payload:{}});
 await app.inject({method:'POST',url:`/api/sites/${second.id}/approve`,headers,payload:{consent_policy_version:'privacy-v2'}});
 expect((await db.query("SELECT enabled FROM pages WHERE site_id=$1 AND page_key='p.offers'",[second.id]))[0].enabled).toBe(false);
});
it('scopes portfolio reports to the selected project',async()=>{
 const r=await app.inject({url:'/api/campaigns?site_id='+second.id,headers});expect(r.statusCode).toBe(200);
 expect(JSON.stringify(r.json())).not.toContain(project.id);
});
it('keeps discovered elements and actions when collection settings are saved',async()=>{
 const response=await app.inject({method:'PATCH',url:`/api/sites/${project.id}/collection`,headers,payload:{collection_mode:'whole_site',rules:DEFAULT_RULES,elements:['custom-section'],actions:['custom-action']}});
 expect(response.statusCode,response.body).toBe(200);
 const [page]=await db.query('SELECT elements,actions FROM pages WHERE site_id=$1',[project.id]);
 expect(page.elements).toEqual(['custom-section','auto.section.1','auto.button.1']);expect(page.actions).toEqual(['custom-action','auto.button.1']);
});
it('protects automatic page context and enforces membership on scoped list endpoints',async()=>{
 const response=await app.inject({method:'PATCH',url:`/api/pages/${project.id}/p.home/policy`,headers,payload:{revision:'manual-release',campaign_codes:['unknown'],diagnostics_enabled:false,diagnostic_error_codes:[],primary_cta_id:'',primary_action_id:''}});expect(response.statusCode).toBe(422);expect(response.json().error.code).toBe('AUTO_PAGE_CONTEXT_MANAGED');
 const memberToken=randomUUID();await db.query("INSERT INTO users(id,email,password_hash,role) VALUES('project-analyst','analyst@projects.test','x','analyst')");
 await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,'project-analyst','analyst-csrf',now()+interval '1 hour')",[digest(memberToken)]);
 await db.query("INSERT INTO site_memberships(user_id,site_id) VALUES('project-analyst',$1)",[project.id]);
 const memberHeaders={host:headers.host,cookie:'ir_session='+memberToken};
 for(const endpoint of ['/api/installations','/api/registry/export','/api/experiments']){
  expect((await app.inject({url:endpoint+'?site_id='+project.id,headers:memberHeaders})).statusCode).toBe(200);
  expect((await app.inject({url:endpoint+'?site_id='+second.id,headers:memberHeaders})).statusCode).toBe(404);
 }
});
it('archives historical examples on upgrade without deleting real pages or users',async()=>{
 await db.query('DELETE FROM schema_migrations WHERE version=13');await migrate(db);
 const [demo]=await db.query("SELECT archived,enabled FROM sites WHERE id='local-demo'");expect(demo).toEqual({archived:true,enabled:false});
 expect((await db.query('SELECT * FROM pages WHERE site_id=$1',[project.id])).length).toBe(1);
 expect((await db.query("SELECT * FROM users WHERE id='project-owner'")).length).toBe(1);
 await migrate(db);expect((await db.query('SELECT * FROM sites WHERE id=$1',[project.id])).length).toBe(1);
});
it('fills market, currency and time zone from a country domain and applies project changes to every page',async()=>{
 const r=await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'Credit',url:'https://credit-example.ro'}});expect(r.statusCode).toBe(200);
 expect(r.json()).toMatchObject({market:'RO',currency:'RON',report_timezone:'Europe/Bucharest'});
 const id=r.json().id;
 expect((await db.query('SELECT market FROM pages WHERE site_id=$1',[id]))[0].market).toBe('RO');
 await db.query("INSERT INTO pages(site_id,page_key,name,selector,revision,locale,product,path,auto) SELECT site_id,'p.offer','Offer',selector,'auto','auto','website','/offer',true FROM pages WHERE site_id=$1 AND page_key='p.home'",[id]);
 const bad=await app.inject({method:'PATCH',url:`/api/projects/${id}/market`,headers,payload:{market:'MD',currency:'MDL',report_timezone:'Not/AZone'}});expect(bad.statusCode).toBe(422);
 const ok=await app.inject({method:'PATCH',url:`/api/projects/${id}/market`,headers,payload:{market:'MD',currency:'MDL',report_timezone:'Europe/Chisinau'}});expect(ok.statusCode).toBe(200);expect(ok.json().pages_updated).toBe(2);
 const[site]=await db.query('SELECT market,currency,report_timezone FROM sites WHERE id=$1',[id]);expect(site).toEqual({market:'MD',currency:'MDL',report_timezone:'Europe/Chisinau'});
 expect((await db.query('SELECT DISTINCT market FROM pages WHERE site_id=$1',[id])).map(p=>p.market)).toEqual(['MD']);
 const generic=await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'Generic',url:'https://generic-example.com'}});expect(generic.json()).toMatchObject({market:null,currency:'XXX',report_timezone:'UTC'});
});
