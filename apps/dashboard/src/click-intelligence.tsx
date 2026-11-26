import {Collapsible} from './components/collapsible.js';
import {DataTable} from './data-table.js';
import {Button} from './components/button.js';
import {Card} from './components/card.js';
import type {EulerManifest} from '../../../packages/contracts/intelligence.js';

export type EulerStatus =
  {status: 'not_trained' | 'expired' | 'incompatible'} | {status: 'ready'; manifest: EulerManifest};
export type ClickEstimate = {
  element_id: string;
  probability: number;
  validation_state: EulerManifest['validation_state'];
  unseen_context: string[];
};
const reviewLabels = {
  fixture_only: 'Generated samples · Pipeline validation only',
  needs_review: 'Needs review · Offline checks did not pass',
  passes_offline_checks: 'Passed offline checks · Product review required',
};
export function EulerSetup({
  status,
  canExport,
  busy,
  onDownload,
}: {
  status: EulerStatus | null;
  canExport: boolean;
  busy: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="intelligence-setup">
      <h3>
        Click likelihood <span className="badge">EulerNet · Local</span>
      </h3>
      <p>
        Estimate a registered element click in the 30 seconds after its first qualified exposure. Both intelligence
        models are optional.
      </p>
      {status?.status !== 'ready' && (
        <p role="status">
          {!status
            ? 'Checking the EulerNet model…'
            : status.status === 'not_trained'
              ? 'No EulerNet model has been trained for this page and data source.'
              : status.status === 'expired'
                ? 'The EulerNet model has expired. Export retained examples and retrain.'
                : 'The EulerNet model is incompatible with the current evidence or reporting policy. Retrain it.'}
        </p>
      )}
      {canExport && (
        <Collapsible title={<>Advanced click dataset export</>}>
          <Button variant="secondary" disabled={busy} onClick={onDownload}>
            Download click training examples
          </Button>
          <p>
            Training requires fully observed exposure windows with both click and no-click outcomes. Incomplete windows
            are excluded from both classes.
          </p>
        </Collapsible>
      )}
      {status?.status === 'ready' && (
        <p className="intelligence-note">
          {reviewLabels[status.manifest.validation_state]}. Model estimates need validation on representative recorded
          traffic.
        </p>
      )}
    </div>
  );
}
export function ClickResult({result}: {result: ClickEstimate}) {
  return (
    <div className="intelligence-click-result" role="region" aria-label="EulerNet click estimate">
      <h3>30-second click estimate</h3>
      <p>
        <strong>{(100 * result.probability).toFixed(1)}%</strong> model estimate for <code>{result.element_id}</code>{' '}
        after its first qualified exposure, among windows observed for the full 30 seconds.
      </p>
      <p>{reviewLabels[result.validation_state]}. This outcome differs from SASRec's next recorded interaction.</p>
      {result.unseen_context.length > 0 && (
        <p className="intelligence-note">
          Some context values were absent or below support in training; the model used its unknown-context
          representation.
        </p>
      )}
    </div>
  );
}
export function EulerEvaluation({manifest}: {manifest: EulerManifest}) {
  const conversion = manifest.target === 'qualified_exposure_primary_action_30s';
  return (
    <Card
      padding="normal"
      title={<>{conversion ? 'Conversion probability evaluation' : 'EulerNet click evaluation'}</>}
    >
      <p>
        {manifest.evaluation.test_views} held-out page views · {manifest.evaluation.test_examples} fully observed
        exposures · {manifest.evaluation.positives} {conversion ? 'converted' : 'clicked'} /{' '}
        {manifest.evaluation.negatives} {conversion ? 'did not convert' : 'not clicked'} within 30 seconds
        {conversion ? ' · Primary action: ' + manifest.primary_action_id : ''}
      </p>
      <p className="intelligence-note">
        {reviewLabels[manifest.validation_state]}. Neither model is required for ordinary analytics.
      </p>
      <DataTable<any>
        name="Click model evaluation"
        data={(['eulernet', 'logistic', 'constant'] as const).map((name) => ({name, ...manifest.evaluation[name]}))}
        rowId={(row) => row.name}
        columns={[
          {
            id: 'name',
            label: 'MODEL',
            value: (row) => row.name,
            render: (row) =>
              row.name === 'eulernet'
                ? 'EulerNet'
                : row.name === 'logistic'
                  ? 'Logistic regression'
                  : 'Observed-rate baseline',
          },
          {id: 'log_loss', label: 'LOG LOSS', value: (row) => row.log_loss, render: (row) => row.log_loss.toFixed(3)},
          {id: 'brier', label: 'BRIER', value: (row) => row.brier, render: (row) => row.brier.toFixed(3)},
          {id: 'ece', label: 'CALIBRATION ERROR', value: (row) => row.ece, render: (row) => row.ece.toFixed(3)},
        ]}
      />
      <p>
        Lower values are better. EulerNet AUC: {manifest.evaluation.eulernet.auc?.toFixed(3) ?? 'unavailable'}.
        Calibration is fitted on validation views; these results use later test views.
      </p>
      <p className="subtle">
        These estimates describe {conversion ? 'primary actions' : 'clicks'} among exposures with a complete observed
        window. Visitors who leave earlier are outside this target. Offline checks do not establish production readiness
        or conversion lift.
      </p>
    </Card>
  );
}
