// Explicit synthetic examples for model/API/browser tests; never used by collection.
import {randomUUID} from 'node:crypto';
import type {DB} from '../packages/db/index.js';
import type {Event} from '../packages/contracts/events.js';
import {batch} from './fixtures.js';
export async function seedEulerViews(db:DB,count=80,variedDevices=false,firstStart=Date.now()-20*3600000) {
 const ids:string[]=[];
 for(let i=0;i<count;i++){
  const b=batch(),view=randomUUID();ids.push(view);
  const start=new Date(firstStart+i*300000).toISOString();
  await db.query("INSERT INTO views(site_id,view_id,page_key,started_at,context,context_hash,config_version,sample_rate,data_source) VALUES('local-demo',$1,'casino-halloween',$2,$3,'euler-test',1,1,'seeded')",[view,start,JSON.stringify(b.context)]);
  const base={...b.events[0],elapsed_ms:0,viewport:{...b.events[0].viewport,width:variedDevices&&i%3===0?390:b.events[0].viewport.width}};
  const events:Event[]=[{...base,type:'page_view',seq:0},{...base,type:'exposure',seq:1,elapsed_ms:1000,element_id:'hero-register',qualified_ms:1000,threshold:0.5,first_qualified:true}];
  if(i%2===0)events.push({...base,type:'click',seq:2,elapsed_ms:10000,client_x:200,client_y:400,document_x:200,document_y:400,pointer:'mouse',layer:'document',target:{element_id:'hero-register',x_fraction:0.5,y_fraction:0.5,rect:{x:100,y:350,width:200,height:100}}});
  for(const elapsed_ms of [10000,20000,35000])events.push({...base,type:'progress',seq:events.length,elapsed_ms,max_reach_px:900,max_reach_percent:43,max_scroll_percent:0,visible_ms:elapsed_ms,geometry_stable:true});
  for(const e of events.reverse()){
   const event_id=randomUUID();await db.query("INSERT INTO events(site_id,event_id,view_id,event_hash,event_type,payload) VALUES('local-demo',$1,$2,'euler-test',$3,$4)",[event_id,view,e.type,JSON.stringify({...e,event_id})]);
  }
 }
 return ids;
}
