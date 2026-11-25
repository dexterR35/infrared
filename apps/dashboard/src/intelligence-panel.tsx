import {useEffect,useState} from 'react';
import type {ModelManifest} from '../../../packages/contracts/intelligence.js';
import {exposureElement} from '../../../packages/domain/click-prediction.js';
import {EulerSetup,EulerEvaluation,ClickResult,type EulerStatus,type ClickEstimate} from './click-intelligence.js';
import './intelligence.css';

type Page={site_id:string;page_key:string;name:string;revision:string;variant:string};
type Status={status:'not_trained'|'expired'|'incompatible'}|{status:'ready';manifest:ModelManifest};
const messages={not_trained:'No SASRec model has been trained for this page and data source.',expired:'This model has expired. Export retained activity and retrain it.',incompatible:'This model uses an older page configuration. Export activity and retrain it.'};
export function IntelligencePanel({pages,selected,onSelect,dataSource,from,to,setFrom,setTo,role,api}:{
 pages:Page[];selected:string;onSelect:(value:string)=>void;dataSource:string;from:string;to:string;
 setFrom:(value:string)=>void;setTo:(value:string)=>void;role:string;api:(url:string,body?:unknown)=>Promise<any>;
}){
 const page=pages.find(p=>p.site_id+'/'+p.page_key===selected);
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const [history,setHistory]=useState<string[]>(['page_view']),[action,setAction]=useState('page_view');
 const [rankings,setRankings]=useState<{action:string;score:number}[]|null>(null);
 const [euler,setEuler]=useState<EulerStatus|null>(null),[click,setClick]=useState<ClickEstimate|null>(null),[device,setDevice]=useState('desktop');
 const scope=page?{site_id:page.site_id,page_key:page.page_key,data_source:dataSource,revision:page.revision,variant:page.variant}:null;
 const query=scope?new URLSearchParams(scope).toString():'';
 useEffect(()=>{
  if(!query||dataSource==='legacy'||role==='installer')return;
  let live=true;
  api('/api/intelligence/status?'+query).then((result:Status)=>{
   if(!live)return;setStatus(result);
   if(result.status==='ready'){const initial=result.manifest.vocabulary.includes('page_view')?'page_view':result.manifest.vocabulary[0];setHistory([initial]);setAction(result.manifest.vocabulary.find(t=>t!=='page_view')??initial);}
  }).catch(e=>{if(live)setError(e.message);});
  api('/api/intelligence/euler/status?'+query).then((result:EulerStatus)=>{if(live)setEuler(result);}).catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 },[api,query,dataSource,role]);
 async function download(model:'sasrec'|'euler'='sasrec'){
  if(!scope)return;setBusy('export');setError('');
  try{
   const dataset=await api('/api/intelligence/'+(model==='euler'?'euler/':'')+'dataset?'+new URLSearchParams({...scope,from,to}));
   const url=URL.createObjectURL(new Blob([JSON.stringify(dataset)],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download=model==='euler'?'infrared-click-examples.json':'infrared-sequences.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function estimate(joint=false){
  setBusy('estimate');setError('');setClick(null);if(joint)setRankings(null);
  try{const result=await api('/api/intelligence/'+(joint?'analyze':'euler/predict'),{...scope,history,device,...(joint?{top_k:5}:{})});setClick(joint?result.eulernet:result);if(joint)setRankings(result.sasrec.rankings);}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 const actions=[...new Set([...(status?.status==='ready'?status.manifest.vocabulary.filter(t=>t!=='page_view'):[]),...(euler?.status==='ready'?euler.manifest.vocabulary.element_id.map(id=>'exposure:'+id):[])])];
 const sasrecHistory=status?.status==='ready'&&history.every(t=>status.manifest.vocabulary.includes(t));
 async function predict(){
  setBusy('predict');setError('');setRankings(null);
  try{const result=await api('/api/intelligence/predict',{...scope,history,top_k:5});setRankings(result.rankings);}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 if(role==='installer')return <section className="panel intelligence-panel"><p>Journey intelligence is available to reporting roles.</p></section>;
 return <div className="intelligence-layout">
  <section className="panel intelligence-panel">
   <h2>Next-action intelligence <span className="badge">SASRec · Local</span></h2>
   <p>Explore which registered interaction may follow an action sequence within one page view.</p>
   <div className="intelligence-controls">
    <label>Landing page<select value={selected} onChange={e=>onSelect(e.target.value)}>{pages.map(p=><option key={p.site_id+'/'+p.page_key} value={p.site_id+'/'+p.page_key}>{p.name}</option>)}</select></label>
    <label>Export from · UTC<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>Export through · UTC<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   </div>
   {page&&<p className="subtle">Revision {page.revision} · Variant {page.variant} · All devices and campaign codes. Export dates select training activity; predictions use the installed model.</p>}
   {dataSource==='legacy'?<p role="status">Unclassified historical activity cannot train this model. Choose Recorded activity or Generated samples.</p>:<>
    {dataSource==='seeded'&&<p className="intelligence-note">Generated samples test the pipeline. Rankings trained on samples do not describe real visitors.</p>}
    {status?.status!=='ready'&&<p role="status">{status?messages[status.status]:'Checking the local model…'}</p>}
    {['owner','administrator'].includes(role)&&<div className="intelligence-setup">
     <button className="btn" disabled={!!busy||!page} onClick={()=>void download()}>{busy==='export'?'Exporting…':'Download training sequences'}</button>
     <p>Train the downloaded dataset in the local Python environment, then use Refresh data. At least 10 eligible page views are required; real activity also needs sufficient action support.</p>
     <pre><code>python apps/intelligence/sasrec.py train --dataset /path/to/infrared-sequences.json</code></pre>
     <p className="subtle">Setup and evaluation details: docs/INTELLIGENCE.md in your Infrared repository. Delete the dataset export after training.</p>
    </div>}
    <EulerSetup status={euler} canExport={['owner','administrator'].includes(role)&&!!page} busy={!!busy} onDownload={()=>void download('euler')}/>
    {(status?.status==='ready'||euler?.status==='ready')&&<>
     {status?.status==='ready'&&<p className="subtle">SASRec trained {new Date(status.manifest.created_at).toLocaleString()} · Expires {new Date(status.manifest.expires_at).toLocaleString()}</p>}
     <h3>Build an action history</h3>
     <ol className="intelligence-history">{history.map((token,i)=><li key={i}><code>{token}</code></li>)}</ol>
     <div className="intelligence-controls"><label>Observed action<select value={actions.includes(action)?action:actions[0]} disabled={!!busy} onChange={e=>setAction(e.target.value)}>{actions.map(t=><option key={t}>{t}</option>)}</select></label>
      <button className="btn" disabled={!!busy||history.length>=50} onClick={()=>{setHistory([...history,actions.includes(action)?action:actions[0]]);setRankings(null);setClick(null);}}>Add action</button>
      <button className="btn" disabled={!!busy||history.length<=1} onClick={()=>{setHistory(history.slice(0,-1));setRankings(null);setClick(null);}}>Remove last</button>
      {status?.status==='ready'&&<button className="btn primary" disabled={!!busy||!sasrecHistory} onClick={()=>void predict()}>{busy==='predict'?'Ranking…':'Predict next action'}</button>}
     </div>
     {euler?.status==='ready'&&<><p>For the click estimate, end the history with the element's first <code>exposure:</code> action. Choose the device at that exposure.</p><div className="intelligence-controls"><label>Device at exposure<select value={device} disabled={!!busy} onChange={e=>{setDevice(e.target.value);setClick(null);}}><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select></label><button className="btn" disabled={!!busy||!exposureElement(history)} onClick={()=>void estimate()}>Estimate exposed-element click</button>{status?.status==='ready'&&<button className="btn primary" disabled={!!busy||!exposureElement(history)||!sasrecHistory} onClick={()=>void estimate(true)}>Analyze both models</button>}</div></>}
     {rankings&&<><h3>Likely next interactions</h3><p>Higher scores rank ahead of lower scores. These scores are not calibrated probabilities. Repeated actions remain eligible.</p><table className="intelligence-table"><thead><tr><th>Rank</th><th>Registered action</th><th>Ranking score</th></tr></thead><tbody>{rankings.map((r,i)=><tr key={r.action}><td>{i+1}</td><td><code>{r.action}</code></td><td>{r.score.toFixed(3)}</td></tr>)}</tbody></table></>}
     {click&&<ClickResult result={click}/>}
    </>}
   </>}
   {error&&<p className="error-inline" role="alert">{error.replaceAll('_',' ').toLowerCase()}</p>}
  </section>
  {status?.status==='ready'&&<section className="panel intelligence-panel"><h2>Held-out evaluation</h2><p>{status.manifest.evaluation.test_sequences} later page views · Final action predicted from the preceding history · Top {status.manifest.evaluation.k}</p>
   <table className="intelligence-table"><thead><tr><th>Model</th><th>Hit rate</th><th>NDCG</th></tr></thead><tbody>{(['sasrec','markov','popularity'] as const).map(name=><tr key={name}><td>{name==='sasrec'?'SASRec':name==='markov'?'Last-action baseline':'Popularity baseline'}</td><td>{(100*status.manifest.evaluation[name].hit_rate).toFixed(1)}%</td><td>{status.manifest.evaluation[name].ndcg.toFixed(3)}</td></tr>)}</tbody></table>
   <p>{status.manifest.evaluation.unknown_targets} held-out sequences contained unseen or unsupported actions and count as misses. Test activity never builds the action vocabulary or chooses a checkpoint.</p>
   <p className="subtle">This model ranks subsequent recorded interactions. It does not estimate abandonment, diagnose friction, cluster behaviour, or prove a change will improve conversions.</p>
  </section>}
  {dataSource!=='legacy'&&euler?.status==='ready'&&<EulerEvaluation manifest={euler.manifest}/>}
 </div>;
}
