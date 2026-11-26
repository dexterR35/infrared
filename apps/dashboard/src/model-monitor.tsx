import {useState} from 'react';
import {Card} from './components/card.js';
import {FormField} from './components/form-field.js';
import {Button} from './components/button.js';
import {DataTable} from './data-table.js';
import type {IntelligenceScope, ModelMonitor, MonitorFinding} from '../../../packages/contracts/intelligence.js';

type Result = ModelMonitor | {status: 'no_fresh_views'; cutoff: string} | {status: 'not_trained' | 'expired' | 'incompatible'};
type ModelRow = {name: string} & ModelMonitor['models'][string];
type DriftRow = {field: string; psi: number};

const verdicts: Record<ModelMonitor['recommendation'], string> = {
  healthy: 'Healthy · no monitored check failed',
  watch: 'Watch · early warning, keep the model and review again',
  retrain: 'Retrain · the published model no longer fits recent traffic',
  collect_more_data: 'Collect more data · too few fresh outcomes to judge performance',
};
const findingText: Record<MonitorFinding['code'], string> = {
  NO_LIFT_OVER_BASELINE: 'Log loss is reliably worse than predicting the rate known at publication',
  LIFT_UNCERTAIN: 'No measurable log-loss improvement over the publication rate yet',
  MISCALIBRATED: 'Observed outcomes differ from predicted totals by more than 3 view-clustered standard errors',
  RANKING_DEGRADED: 'AUC fell below the held-out result by more than 0.05 and twice its standard error',
  FEATURE_DRIFT_MAJOR: 'Major distribution shift (PSI ≥ 0.25)',
  FEATURE_DRIFT_MODERATE: 'Moderate distribution shift (PSI 0.10–0.25)',
  UNSEEN_ELEMENTS: 'More than 5% of exposures involve elements the model never saw',
  UNSEEN_ELEMENTS_MAJOR: 'More than 20% of exposures involve elements the model never saw',
};
const fixed = (n: number | null | undefined, digits = 3) => (n == null ? '-' : n.toFixed(digits));
const percent = (n: number | null | undefined) => (n == null ? '-' : (100 * n).toFixed(1) + '%');
const fieldName = (name: string) => name.replace(/^context\./, '').replaceAll('_', ' ');

export function ModelMonitorCard({
  scope,
  clickReady,
  conversionReady,
  api,
}: {
  scope: IntelligenceScope;
  clickReady: boolean;
  conversionReady: boolean;
  api: (url: string) => Promise<Result>;
}) {
  const [objective, setObjective] = useState<'click' | 'conversion'>(clickReady ? 'click' : 'conversion'),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!clickReady && !conversionReady) return null;
  async function check() {
    setBusy(true);
    setError('');
    try {
      setResult(await api('/api/intelligence/monitor?' + new URLSearchParams({...scope, objective})));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const report = result?.status === 'evaluated' || result?.status === 'insufficient_data' ? result : null;
  const models: ModelRow[] = report ? Object.entries(report.models).map(([name, m]) => ({name, ...m})) : [];
  const drift: DriftRow[] =
    report && report.drift.status !== 'no_reference'
      ? Object.entries(report.drift.fields)
          .map(([field, psi]) => ({field, psi}))
          .sort((a, b) => b.psi - a.psi)
      : [];
  return (
    <Card id="predictive-monitoring" padding="normal" title="Live model monitoring">
      <p>
        Scores the published model on views that began after its newest training view. It checks lift over the rate
        known at publication, calibration and feature drift. These checks find decay; they do not explain its cause.
      </p>
      <div className="intelligence-controls">
        <FormField
          category="select"
          label="Monitored model"
          value={objective}
          disabled={busy}
          onChange={(e) => {
            setObjective(e.target.value as 'click' | 'conversion');
            setResult(null);
          }}
        >
          {clickReady && <option value="click">Click model</option>}
          {conversionReady && <option value="conversion">Conversion model</option>}
        </FormField>
        <Button variant="secondary" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check live performance'}
        </Button>
      </div>
      {result?.status === 'no_fresh_views' && (
        <p role="status">No reportable views have started since the newest training view ({result.cutoff}).</p>
      )}
      {result && ['not_trained', 'expired', 'incompatible'].includes(result.status) && (
        <p role="status">The published model is {result.status.replace('_', ' ')}. Retrain it before monitoring.</p>
      )}
      {report && (
        <>
          <p role="status">
            <strong>{verdicts[report.recommendation]}</strong> · {report.fresh_views} fresh views, {report.scored_examples}{' '}
            scored exposures, {report.positives} positive outcomes. Observed rate {percent(report.observed_rate)} vs{' '}
            {percent(report.reference_rate)} at publication.
          </p>
          {report.findings.length > 0 && (
            <ul aria-label="Monitoring findings">
              {report.findings.map((f, i) => (
                <li key={i}>
                  {findingText[f.code] ?? f.code}
                  {f.model ? ' · ' + f.model : ''}
                  {f.field ? ' · ' + fieldName(f.field) : ''} · {fixed(f.value)}
                </li>
              ))}
            </ul>
          )}
          {models.length > 0 && (
            <DataTable<ModelRow>
              name="Fresh-data model performance"
              data={models}
              rowId={(r) => r.name}
              columns={[
                {id: 'name', label: 'MODEL', value: (r) => r.name},
                {id: 'log_loss', label: 'LOG LOSS', value: (r) => r.metrics.log_loss, render: (r) => fixed(r.metrics.log_loss)},
                {id: 'baseline', label: 'BASELINE LOG LOSS', value: () => report.baseline?.log_loss, render: () => fixed(report.baseline?.log_loss)},
                {id: 'auc', label: 'AUC NOW / HELD-OUT', value: (r) => r.metrics.auc ?? undefined, render: (r) => fixed(r.metrics.auc) + ' / ' + fixed(r.reference?.auc)},
                {id: 'calibration', label: 'MEAN PREDICTED', value: (r) => r.mean_probability, render: (r) => percent(r.mean_probability)},
                {id: 'z', label: 'CALIBRATION Z', value: (r) => r.calibration_z, render: (r) => fixed(r.calibration_z, 2)},
              ]}
            />
          )}
          {report.drift.status === 'no_reference' && <p>This model predates drift references. Retrain it to enable drift checks.</p>}
          {report.drift.status === 'low_support' && (
            <p>Fewer than 200 fresh exposures. Distribution shift values are shown but not used for the verdict.</p>
          )}
          {drift.length > 0 && (
            <DataTable<DriftRow>
              name="Feature drift"
              data={drift}
              rowId={(r) => r.field}
              initialSorting={[{id: 'psi', desc: true}]}
              columns={[
                {id: 'field', label: 'FEATURE', value: (r) => fieldName(r.field)},
                {id: 'psi', label: 'PSI', value: (r) => r.psi, render: (r) => fixed(r.psi)},
                {id: 'level', label: 'SHIFT', value: (r) => r.psi, render: (r) => (r.psi >= 0.25 ? 'Major' : r.psi >= 0.1 ? 'Moderate' : 'Stable')},
              ]}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
