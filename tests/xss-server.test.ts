import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {testDB} from './fixtures.js';
import type {DB} from '../packages/db/index.js';
import {createManagement} from '../apps/server/management.js';
import {Projects} from '../apps/dashboard/src/projects.js';
import {digest} from '../packages/security/index.js';
import {safeScriptJSON} from '../packages/security/validation.js';
import {probeInstallation,readDocument} from '../apps/server/installation-checks.js';
import {config} from '../apps/server/config.js';

let db:DB,app:ReturnType<typeof createManagement>;
const token=randomUUID(),headers={host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000',cookie:'ir_session='+token,'x-csrf-token':'xss-test'};
const attack='</script><img src=x onerror="globalThis.__xss=1">';
beforeAll(async()=>{
 db=await testDB();await db.query("INSERT INTO users(id,email,password_hash,role) VALUES('xss-owner','xss-owner@test.invalid','x','owner')");
 await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,'xss-owner','xss-test',now()+interval '1 hour')",[digest(token)]);
 app=createManagement(db,new Map());await app.ready();
});
afterAll(async()=>{await app.close();await db.close();});

it('renders stored hostile project names and brands as escaped text',async()=>{
 const created=await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:attack,brand:attack,url:'https://xss-project.test'}});
 expect(created.statusCode,created.body).toBe(200);expect(created.headers['content-type']).toContain('application/json');
 const b=(await app.inject({url:'/api/bootstrap',headers})).json(),site=b.sites.find((s:any)=>s.id===created.json().id);
 expect(site.name).toBe(attack);
 const markup=renderToStaticMarkup(createElement(Projects,{sites:[site],role:'viewer',api:async()=>({}),onCreated:async()=>{},onOpen:()=>{}}));
 expect(markup).toContain('&lt;/script&gt;&lt;img');expect(markup).not.toContain('<img');expect(markup).not.toContain('<script');
});
it('does not reflect hostile query strings into HTML or error responses',async()=>{
 const query=encodeURIComponent(attack);
 const r=await app.inject({url:'/api/reports?site_id='+query+'&page_key=home',headers});
 expect(r.statusCode).toBe(400);expect(r.headers['content-type']).toContain('application/json');expect(r.body).not.toContain(attack);
 const html=await app.inject({url:'/?search='+query,headers});expect(html.statusCode).toBe(200);expect(html.body).not.toContain(attack);
});
it('keeps hostile data inside generated JavaScript data literals',()=>{
 const payload={value:attack+'\u2028\u2029',nested:{name:'";globalThis.__xss=1;//'}};
 const code=safeScriptJSON(payload),context:Record<string,unknown>={};
 expect(code).not.toMatch(/[<>&\u2028\u2029]/);runInNewContext('globalThis.result='+code,context,{timeout:100});
 expect(context.__xss).toBeUndefined();expect(JSON.stringify(context.result)).toBe(JSON.stringify(payload));
});
it('keeps the installation script from terminating early on hostile stored data',async()=>{
 const [site]=await db.query("SELECT id,site_key FROM sites WHERE origin='https://xss-project.test'");
 await db.query('UPDATE sites SET site_key=$2 WHERE id=$1',[site.id,'site_'+attack]);
 try{
  const r=await app.inject({url:'/api/install/site?site_id='+site.id,headers});expect(r.statusCode,r.body).toBe(200);
  const code=r.json().code;expect(code.match(/<\/script>/gi)).toHaveLength(1);expect(code).not.toContain(attack);
 }finally{await db.query('UPDATE sites SET site_key=$2 WHERE id=$1',[site.id,site.site_key]);}
});
it('sets browser security boundaries for HTML, JSON and errors',async()=>{
 for(const url of ['/','/api/bootstrap','/api/reports?site_id=bad&page_key=bad']){
  const r=await app.inject({url,headers});
  expect(r.headers['x-content-type-options']).toBe('nosniff');expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');expect(r.headers['cross-origin-resource-policy']).toBe('same-origin');
  const csp=String(r.headers['content-security-policy']);expect(csp).toContain("script-src 'self'");expect(csp).toContain("object-src 'none'");expect(csp).toContain("frame-ancestors 'none'");expect(csp).toContain("base-uri 'none'");
 }
});
it('rejects SQL-shaped sort identifiers and filesystem traversal probes without leaking internals',async()=>{
 const sort=await app.inject({url:'/api/tables/audit?sort='+encodeURIComponent('created_at;DROP TABLE users;--'),headers});expect(sort.statusCode).toBe(400);
 for(const url of ['/..%2f.env','/%2e%2e/.local/admin-credentials.json','/api/references/'+encodeURIComponent('../.env')+'/image']){
  const r=await app.inject({url,headers});expect(r.statusCode).toBeGreaterThanOrEqual(400);expect(r.body).not.toContain('password_hash');expect(r.body).not.toContain('POSTGRES_PASSWORD');
 }
 expect((await db.query("SELECT id FROM users WHERE id='xss-owner'")).length).toBe(1);
});
it('rejects oversized request bodies before persisting projects',async()=>{
 const r=await app.inject({method:'POST',url:'/api/projects',headers,payload:{name:'x'.repeat(40000),url:'https://oversized.test'}});
 expect(r.statusCode).toBe(413);expect((await db.query("SELECT 1 FROM sites WHERE origin='https://oversized.test'")).length).toBe(0);
});
it('sets HSTS and secure HttpOnly cookies when configured for HTTPS',async()=>{
 const original=config.dashboardOrigin;config.dashboardOrigin='https://workspace.test';
 try{
  const r=await app.inject({url:'/api/auth/csrf',headers:{host:'workspace.test'}});expect(r.statusCode).toBe(200);
  expect(r.headers['strict-transport-security']).toBe('max-age=31536000');
  const cookies=String(r.headers['set-cookie']);expect(cookies).toContain('Secure');expect(cookies).toContain('HttpOnly');expect(cookies).toContain('SameSite=Strict');
 }finally{config.dashboardOrigin=original;}
});
it('does not follow a public website redirect into a metadata endpoint',async()=>{
 const selector={origin:'https://redirect.test',path:'/',query_equals:{},ignored_query_names:[],other_query_policy:'ignore' as const,duplicate_query_policy:'reject' as const,fragment_policy:'ignore_anchor' as const};
 const result=await probeInstallation({site_key:'site_redirect_test',environment:'real',origin:selector.origin},{selector},async(url,signal,allowDemo)=>{
  if(url.origin===selector.origin)return {status:302,body:'',type:'text/html',location:'http://169.254.169.254/latest/meta-data/',truncated:false};
  return readDocument(url,signal,allowDemo);
 });
 expect(result.reason).toBe('UNSAFE_TARGET');expect(result.pixel).toBe('unverified');
});
