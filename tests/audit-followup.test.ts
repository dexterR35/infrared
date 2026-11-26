import {afterEach,describe,expect,it,vi} from 'vitest';
import {Limiter} from '../packages/security/index.js';

afterEach(()=>{vi.useRealTimers();});

describe('rate limiter windows longer than an hour',()=>{
 it('keeps a daily cap across the hourly key rotation',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T00:00:00Z'));
  const limiter=new Limiter();
  for(let i=0;i<3;i++)limiter.check('daily:visitor',3,86400000);
  vi.setSystemTime(new Date('2026-11-25T05:00:00Z'));
  expect(()=>limiter.check('daily:visitor',3,86400000)).toThrow('RATE_LIMIT');
 });
 it('still forgets counters once the longest window has passed',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T00:00:00Z'));
  const limiter=new Limiter();
  for(let i=0;i<3;i++)limiter.check('daily:visitor',3,86400000);
  vi.setSystemTime(new Date('2026-11-26T00:00:01Z'));
  expect(()=>limiter.check('daily:visitor',3,86400000)).not.toThrow();
 });
});


describe('consent policy binding',()=>{
 it('rejects real-site events recorded under a policy other than the approved one',async()=>{
  const {testDB,batch}=await import('./fixtures.js');const {createCollector}=await import('../apps/server/collector.js');
  const db=await testDB();const collector=createCollector(db);
  try{
   await db.query("UPDATE sites SET approval_state='approved',enabled=true,consent_policy_version='cmp-2' WHERE id='example-real'");
   const [site]=await db.query("SELECT site_key,origin,config_version FROM sites WHERE id='example-real'");
   await db.query("UPDATE pages SET enabled=true,approval_state='approved' WHERE site_id='example-real'");
   const [page]=await db.query("SELECT page_key,revision,locale,variant,state FROM pages WHERE site_id='example-real' LIMIT 1");
   const b=batch(),payload={...b,site_key:site.site_key,config_version:site.config_version,consent:{analytics:true as const,policy_version:'cmp-1'},context:{...b.context,page_key:page.page_key,revision:page.revision,locale:page.locale,variant:page.variant,state:page.state}};
   const r=await collector.app.inject({method:'POST',url:'/v1/events',headers:{origin:site.origin},payload});
   expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe('CONSENT_POLICY_MISMATCH');
  }finally{await collector.app.close();await db.close();}
 });
});
