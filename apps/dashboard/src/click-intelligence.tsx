import type {EulerManifest} from '../../../packages/contracts/intelligence.js';

export type EulerStatus={status:'not_trained'|'expired'|'incompatible'}|{status:'ready';manifest:EulerManifest};
export type ClickEstimate={element_id:string;probability:number;validation_state:EulerManifest['validation_state'];unseen_context:string[]};
const reviewLabels={fixture_only:'Generated samples · Pipeline validation only',needs_review:'Needs review · Offline checks did not pass',passes_offline_checks:'Passed offline checks · Product review required'};
export function EulerSetup({status,canExport,busy,onDownload}:{status:EulerStatus|null;canExport:boolean;busy:boolean;onDownload:()=>void}){
 return <div className="intelligence-setup"><h3>Click likelihood <span className="badge">EulerNet · Local</span></h3>
  <p>Estimate a registered element click in the 30 seconds after its first qualified exposure. Both intelligence models are optional.</p>
  {status?.status!=='ready'&&<p role="status">{!status?'Checking the EulerNet model…':status.status==='not_trained'?'No EulerNet model has been trained for this page and data source.':status.status==='expired'?'The EulerNet model has expired. Export retained examples and retrain.':'The EulerNet model is incompatible with the current evidence or reporting policy. Retrain it.'}</p>}
  {canExport&&<><button className="btn" disabled={busy} onClick={onDownload}>Download click training examples</button><p>Training requires fully observed exposure windows with both click and no-click outcomes. Incomplete windows are excluded from both classes.</p><pre><code>python apps/intelligence/eulernet.py train --dataset /path/to/infrared-click-examples.json</code></pre></>}
  {status?.status==='ready'&&<p className="intelligence-note">{reviewLabels[status.manifest.validation_state]}. Model estimates need validation on representative recorded traffic.</p>}
 </div>;
}
export function ClickResult({result}:{result:ClickEstimate}){
 return <div className="intelligence-click-result" role="region" aria-label="EulerNet click estimate"><h3>30-second click estimate</h3><p><strong>{(100*result.probability).toFixed(1)}%</strong> model estimate for <code>{result.element_id}</code> after its first qualified exposure, among windows observed for the full 30 seconds.</p><p>{reviewLabels[result.validation_state]}. This outcome differs from SASRec's next recorded interaction.</p>{result.unseen_context.length>0&&<p className="intelligence-note">Some context values were absent or below support in training; the model used its unknown-context representation.</p>}</div>;
}
export function EulerEvaluation({manifest}:{manifest:EulerManifest}){
 return <section className="panel intelligence-panel"><h2>EulerNet click evaluation</h2><p>{manifest.evaluation.test_views} held-out page views · {manifest.evaluation.test_examples} fully observed exposures · {manifest.evaluation.positives} clicked / {manifest.evaluation.negatives} not clicked within 30 seconds</p>
  <p className="intelligence-note">{reviewLabels[manifest.validation_state]}. Neither model is required for ordinary analytics.</p>
  <table className="intelligence-table intelligence-metrics"><thead><tr><th>Model</th><th>Log loss</th><th>Brier</th><th>Cal. error</th></tr></thead><tbody>{(['eulernet','logistic','constant'] as const).map(name=><tr key={name}><td>{name==='eulernet'?'EulerNet':name==='logistic'?'Logistic regression':'Observed-rate baseline'}</td><td>{manifest.evaluation[name].log_loss.toFixed(3)}</td><td>{manifest.evaluation[name].brier.toFixed(3)}</td><td>{manifest.evaluation[name].ece.toFixed(3)}</td></tr>)}</tbody></table>
  <p>Lower values are better. EulerNet AUC: {manifest.evaluation.eulernet.auc?.toFixed(3)??'unavailable'}. Calibration is fitted on validation views; these results use later test views.</p>
  <p className="subtle">These estimates describe clicks among exposures with a complete observed window. Visitors who leave earlier are outside this target. Offline checks do not establish production readiness or conversion lift.</p>
 </section>;
}
