import {expect,it} from 'vitest';
import sharp from 'sharp';
import {posteriorImprovement} from '../packages/domain/bayesian-experiment.js';
import {conversionSurvival} from '../packages/domain/conversion-survival.js';
import {designAnalysis} from '../apps/server/design-intelligence.js';
import type {Manifest} from '../apps/server/references.js';

it('keeps posterior readouts stable and handles missing arms',()=>{
 const a={mature:100,successes:50},b={mature:100,successes:80};
 expect(posteriorImprovement(a,b)).toEqual(posteriorImprovement(a,b));
 expect(posteriorImprovement(a,b)!.low_pp).toBeGreaterThan(0);
 expect(posteriorImprovement(a,{mature:0,successes:0})).toBeNull();
});
it('censors before later events and suppresses small risk sets',()=>{
 const obs=[{ms:1000,converted:false},{ms:2000,converted:true},{ms:2000,converted:false},{ms:60000,converted:false}];
 expect(conversionSurvival(obs,1)[0].probability).toBeCloseTo(1/3);
 expect(conversionSurvival(obs,2)).toEqual([]);
});
it('excludes masked images and clips first-screen geometry',async()=>{
 const bytes=await sharp({create:{width:300,height:500,channels:3,background:'white'}}).png().toBuffer();
 const rect={x:0,y:150,width:100,height:100};
 const manifest={viewport:{width:300,height:200},document:{width:300,height:500},masks:[{x:0,y:0,width:300,height:500}],elements:[{id:'hero',rect}]} as Manifest;
 const result=await designAnalysis(bytes,manifest);
 expect(result.edge_fraction).toBeNull();expect(result.elements[0].first_screen_fraction).toBe(.5);
});
import {randomUUID} from 'node:crypto';
import {testDB} from './fixtures.js';
import {registerAcquisitionVisit,recordAcquisitionOutcome} from '../apps/server/acquisition.js';
import {createExperiment,changeExperimentState,experimentReadout} from '../apps/server/experiments.js';

it('logs a stable campaign policy, learns from mature purchases and separates sampled outcomes',async()=>{
 const db=await testDB();
 try{
  const e=await createExperiment(db,{site_id:'local-demo',page_key:'casino-halloween',name:'Public campaign',kind:'adaptive',
   primary_metric:'purchase',control_variant:'control',treatment_variant:'alternate',baseline_rate:.1,mde_relative:.2,minimum_days:1,attribution_hours:1});
  await changeExperimentState(db,e.id,'running');
  const input=()=>({receipt_id:randomUUID(),page_key:'casino-halloween',experiment_id:e.id,campaign:'unknown',device:'mobile' as const,analytics_consent:true as const,public_context:true as const,policy_version:'demo-v1',unit_token:randomUUID()});
  const assigned=[];
  for(let i=0;i<60;i++){
   const v=await registerAcquisitionVisit(db,'local-demo',input(),'seeded');
   expect(v.treatment_probability).toBe(.5);assigned.push(v);
  }
  const byArm=new Map<string,number>();
  for(const v of assigned){
   const index=(byArm.get(v.variant)??0)+1;byArm.set(v.variant,index);
   if(v.variant==='alternate'?index%5!==0:index%5===0)
    await recordAcquisitionOutcome(db,'local-demo',{event_id:randomUUID(),visit_id:v.visit_id,kind:'purchase',occurred_at:new Date().toISOString()});
  }
  await db.query("UPDATE acquisition_outcomes SET occurred_at=occurred_at-interval '2 days' WHERE visit_id IN(SELECT id FROM acquisition_visits WHERE experiment_id=$1)",[e.id]);
  await db.query("UPDATE acquisition_visits SET created_at=created_at-interval '2 days' WHERE experiment_id=$1",[e.id]);
  const request=input(),next=await registerAcquisitionVisit(db,'local-demo',request,'seeded');
  expect(next.treatment_probability).toBeGreaterThan(.5);expect(next.treatment_probability).toBeLessThanOrEqual(.9);
  expect(await registerAcquisitionVisit(db,'local-demo',request,'seeded')).toEqual(next);
  expect((await registerAcquisitionVisit(db,'local-demo',input(),'recorded')).treatment_probability).toBe(.5);
  const readout=await experimentReadout(db,e.id,'seeded');
  expect(readout.decision).toBe('DESCRIPTIVE_ONLY');expect(readout.effect).toBeNull();
 }finally{await db.close();}
});
