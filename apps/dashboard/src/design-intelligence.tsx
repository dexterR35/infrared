import {useState} from 'react';
import {Button} from './components/button.js';
import {Card} from './components/card.js';

type Layout = {width:number;captured_at:string;edge_fraction:number|null;elements:{id:string;font_px?:number;solid_color_contrast?:number;top:number;width:number;height:number;first_screen_fraction:number}[]};
type Visual={predicted_saliency_quarters:number[]|null;ocr_words?:number;visual_alignment?:Record<string,number>;copy_similarity?:Record<string,number>};
export function DesignIntelligence({query,api,editable}:{query:string;editable:boolean;api:(url:string,body?:unknown)=>Promise<any>}) {
 const [layout,setLayout]=useState<Layout|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [visual,setVisual]=useState<Visual|null>(null);
 async function analyseVisual(){
  setBusy(true);setMessage('');
  try{setVisual(await api('/api/intelligence/design/visual',Object.fromEntries(new URLSearchParams(query))));}
  catch(e){setMessage((e as Error).message);}
  finally{setBusy(false);}
 }
 async function measure(){
  setBusy(true);setMessage('');
  try{
   const {reference}=await api('/api/intelligence/design?'+query);
   setLayout(reference);setVisual(null);
   if(!reference)setMessage('Approve a screenshot for this revision and variant in References.');
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
 }
 return <Card id="predictive-design" padding="normal" title="Design intelligence">
  <Button variant="secondary" disabled={busy} onClick={()=>void measure()}>{busy?'Measuring…':'Analyse latest approved screenshot'}</Button>
  {message && <p role="status">{message}</p>}
  {layout && <><p>{layout.width}px viewport · captured {new Date(layout.captured_at).toLocaleString()} · {layout.edge_fraction===null?'All sampled pixels masked':(100*layout.edge_fraction).toFixed(1)+'% high-contrast edges in the reduced image'}.</p>
   <ul>{layout.elements.map(e=><li key={e.id}><code>{e.id}</code> · {Math.round(e.width)} × {Math.round(e.height)}px · {Math.round(e.first_screen_fraction*100)}% of element height on first screen{e.font_px!==undefined?' · '+e.font_px+'px font':''}{e.solid_color_contrast!==undefined?' · CSS color contrast '+e.solid_color_contrast.toFixed(1)+':1':''}</li>)}</ul>
   <p>Compare these placements with observed exposure and click rates for the same viewport.</p></>}
  {layout && editable && <Button variant="secondary" disabled={busy} onClick={()=>void analyseVisual()}>Analyse visual attention</Button>}
  {visual && <section><h3>Predicted visual attention</h3>
    <p>Image saliency by vertical quarter, from top to bottom. These scores come from screenshot pixels.</p>
    <p>{visual.predicted_saliency_quarters?.map(n=>(100*n).toFixed(1)+'%').join(' · ') || 'No contrast available.'}</p>
    {visual.ocr_words!==undefined && <p>{visual.ocr_words} words detected by OCR.</p>}
    {([['Image alignment',visual.visual_alignment],['Copy similarity',visual.copy_similarity]] as const).map(([name,scores])=>scores&&<div key={name}><h4>{name}</h4><ul>{Object.entries(scores).sort((a,b)=>b[1]-a[1]).map(([label,score])=><li key={label}>{label} · {score.toFixed(2)}</li>)}</ul></div>)}
  </section>}
 </Card>;
}
