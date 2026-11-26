import {useState} from 'react';
import {Card} from './components/card.js';
import {FormField} from './components/form-field.js';
import {Button} from './components/button.js';
import {DataTable} from './data-table.js';
import type {IntelligenceScope} from '../../../packages/contracts/intelligence.js';

type Row={element_id:string;probability:number;ranking_score:number|null};
export function ElementIntelligence({scope,ready,validation,api}:{scope:IntelligenceScope;ready:boolean;validation?:string;api:(url:string,body:unknown)=>Promise<{elements:Row[]}>}){
 const [device,setDevice]=useState('desktop'),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function compare(){
  setBusy(true);setError('');
  try{
   const result=await api('/api/intelligence/elements/predict',{...scope,device,history:['page_view']});
   setRows(result.elements.sort((a,b)=>(b.ranking_score??b.probability)-(a.ranking_score??a.probability)));
  }catch(e){setRows([]);setError((e as Error).message);}
  finally{setBusy(false);}
 }
 return <Card id="predictive-element" padding="normal" title="Element intelligence">
  <p>Compare registered elements as the first exposure after page entry on the selected device. CatBoost estimates a click within 30 seconds of fully observed exposure.</p>
  {ready && <p>{validation==='fixture_only'?'Generated examples · pipeline check only.':validation==='passes_offline_checks'?'Passed the held-out comparison.':'Offline evaluation needs review.'} Context fields use the training defaults.</p>}
  {ready?<><div className="intelligence-controls"><FormField category="select" label="Comparison device" value={device} disabled={busy} onChange={e=>{setDevice(e.target.value);setRows([]);}}>
   {['desktop','tablet','mobile'].map(value=><option key={value}>{value}</option>)}</FormField>
   <Button variant="secondary" disabled={busy} onClick={()=>void compare()}>{busy?'Comparing…':'Compare elements'}</Button></div>
   {rows.length>0&&<DataTable<Row> name="Predicted element performance" data={rows} rowId={r=>r.element_id} columns={[
    {id:'element_id',label:'ELEMENT',value:r=>r.element_id},{id:'probability',label:'CLICK ESTIMATE',value:r=>r.probability,render:r=>(100*r.probability).toFixed(1)+'%'},
    {id:'ranking_score',label:'CATBOOST RANKER SCORE',value:r=>r.ranking_score??undefined,render:r=>r.ranking_score?.toFixed(3)??'Insufficient multi-element evidence'}
   ]}/>}</>:<p>Train a click model with varied exposure contexts to enable this comparison.</p>}
  {error&&<p role="alert">{error}</p>}
 </Card>;
}
