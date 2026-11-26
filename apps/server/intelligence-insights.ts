import type {SequenceDataset,EulerDataset} from '../../packages/contracts/intelligence.js';

export function journeyGraph(dataset:SequenceDataset){
 const minimum=dataset.minimum_token_views,nodes=new Map<string,number>(),edges=new Map<string,{from:string;to:string;views:number}>();
 for(const sequence of dataset.sequences){
  for(const token of new Set(sequence.tokens))nodes.set(token,(nodes.get(token)??0)+1);
  const seen=new Set<string>();
  for(let i=1;i<sequence.tokens.length;i++){
   const from=sequence.tokens[i-1],to=sequence.tokens[i],key=JSON.stringify([from,to]);
   if(seen.has(key))continue;seen.add(key);
   const edge=edges.get(key)??{from,to,views:0};edge.views++;edges.set(key,edge);
  }
 }
 const retained=new Set([...nodes].filter(([,n])=>n>=minimum).map(([token])=>token));
 return {views:dataset.sequences.length,nodes:[...nodes].filter(([token])=>retained.has(token)).map(([action,views])=>({action,views})),
  edges:[...edges.values()].filter(e=>e.views>=minimum&&retained.has(e.from)&&retained.has(e.to)).sort((a,b)=>b.views-a.views).slice(0,100),
  definition:'Observed adjacent actions within one page view; each view counts at most once per edge. Small cohorts are suppressed.'};
}
export function wilson(positive:number,total:number){
 const z=1.96,p=positive/total,denom=1+z*z/total,center=(p+z*z/(2*total))/denom,half=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denom;
 return {low:Math.max(0,center-half),high:Math.min(1,center+half)};
}
export function elementPerformance(dataset:EulerDataset){
 const elements=new Map<string,{element_id:string;views:number;clicked:number}>();
 for(const view of dataset.views)for(const example of view.examples){
  const id=example.features.element_id,row=elements.get(id)??{element_id:id,views:0,clicked:0};
  row.views++;row.clicked+=example.label;elements.set(id,row);
 }
 const rows=[...elements.values()].filter(e=>e.views>=dataset.minimum_views&&(dataset.environment==='synthetic'||(e.clicked>=dataset.minimum_views&&e.views-e.clicked>=dataset.minimum_views)));
 const totalViews=rows.reduce((n,e)=>n+e.views,0),totalClicks=rows.reduce((n,e)=>n+e.clicked,0);
 return rows.map(row=>{
  // Suppressed peers cannot leak through the comparison rate.
  const n=totalViews-row.views,positive=totalClicks-row.clicked;
  const interval=wilson(row.clicked,row.views),flag=n>=dataset.minimum_views&&interval.high<wilson(positive,n).low;
  return {...row,rate:row.clicked/row.views,interval,flag,reason:flag?'Click rate interval is below the pooled peer interval. Investigate placement and relevance.':null};
 }).sort((a,b)=>Number(b.flag)-Number(a.flag)||a.rate-b.rate);
}
