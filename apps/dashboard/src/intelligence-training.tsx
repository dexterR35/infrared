import {Collapsible} from './components/collapsible.js';
import {DataTable} from './data-table.js';
import {FormField} from './components/form-field.js';
import {Button} from './components/button.js';
import {Card} from './components/card.js';
import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import type {IntelligenceScope, TrainingRun} from '../../../packages/contracts/intelligence.js';

type Api = (url: string, body?: unknown) => Promise<any>;
type Experiment = {id: string; name: string; control_variant: string; treatment_variant: string};
type TrainingState = {
  runs: TrainingRun[];
  schedule: {interval_hours: number; lookback_days: number; next_run_at: string | null};
  variants: string[];
  experiments: Experiment[];
  primary_action_id: string;
};
const names = {
  sasrec: 'Next action · SASRec',
  euler: 'Element click · EulerNet',
  conversion: 'Conversion action · EulerNet',
};
const readable = (s: string) =>
  s
    .replace(/^INTELLIGENCE_/, '')
    .replaceAll('_', ' ')
    .toLowerCase();
const LossChart = lazy(() => import('./intelligence-loss.js'));

export function IntelligenceTraining({
  scope,
  from,
  to,
  editable,
  api,
  onUpdated,
  onVariant,
}: {
  scope: IntelligenceScope;
  from: string;
  to: string;
  editable: boolean;
  api: Api;
  onUpdated: () => void;
  onVariant: (value: string) => void;
}) {
  const [state, setState] = useState<TrainingState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState('');
  const [interval, setIntervalHours] = useState(0),
    [lookback, setLookback] = useState(7),
    [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState('');
  const initial = useRef(true),
    completed = useRef('');
  const query = new URLSearchParams(scope).toString();
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result: TrainingState = await api('/api/intelligence/training?' + query);
        if (!live) return;
        setState(result);
        const signature = result.runs
          .filter((r) => r.status === 'completed')
          .map((r) => r.id)
          .join(',');
        if (initial.current) {
          initial.current = false;
          setIntervalHours(result.schedule.interval_hours);
          setLookback(result.schedule.lookback_days);
          completed.current = signature;
        } else if (completed.current !== signature) {
          completed.current = signature;
          onUpdated();
        }
        timer = setTimeout(
          () => void poll(),
          result.runs.some((r) => ['queued', 'running'].includes(r.status)) ? 2500 : 15000,
        );
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          timer = setTimeout(() => void poll(), 15000);
        }
      }
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, query, refresh, onUpdated]);
  async function action(url: string, body: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(url, body);
      setRefresh((n) => n + 1);
      if (url.endsWith('/rollback')) onUpdated();
      setNotice(
        url.endsWith('/rollback')
          ? 'Model version is active.'
          : url.endsWith('/schedule')
            ? 'Retraining schedule saved.'
            : 'Training queued.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const run = state?.runs.find((r) => r.id === selected) ?? state?.runs[0];
  const active = state?.runs.some((r) => ['queued', 'running'].includes(r.status));
  const point = run?.progress.at(-1),
    progress =
      run?.status === 'completed'
        ? 100
        : point
          ? Math.round(
              (100 * (point.phase === 'logistic' ? point.epochs + point.epoch : point.epoch)) /
                (run?.model === 'sasrec' ? point.epochs : 2 * point.epochs),
            )
          : 0;
  return (
    <section className="intelligence-setup" aria-label="Automatic model training">
      <h3>Train from your activity</h3>
      <p>
        Infrared prepares private datasets from the database, trains in the background, and saves evaluated model
        versions. No downloads or Python commands are needed after runtime setup.
      </p>
      <div className="intelligence-controls">
        <FormField
          category="select"
          label={<>Analysis variant</>}
          value={scope.variant}
          onChange={(e) => onVariant(e.target.value)}
        >
          {[...new Set([scope.variant, ...(state?.variants ?? [])])].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </FormField>
        {editable && (
          <>
            <Button
              variant="primary"
              disabled={busy || !!active}
              onClick={() =>
                void action('/api/intelligence/train', {
                  ...scope,
                  from,
                  to,
                  models: state?.primary_action_id ? ['sasrec', 'euler', 'conversion'] : ['sasrec', 'euler'],
                })
              }
            >
              Train models
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !!active}
              onClick={() => void action('/api/intelligence/train', {...scope, from, to, models: ['sasrec']})}
            >
              Train SASRec
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !!active}
              onClick={() => void action('/api/intelligence/train', {...scope, from, to, models: ['euler']})}
            >
              Train click model
            </Button>
            {state?.primary_action_id && (
              <Button
                variant="secondary"
                disabled={busy || !!active}
                onClick={() => void action('/api/intelligence/train', {...scope, from, to, models: ['conversion']})}
              >
                Train conversion model
              </Button>
            )}
          </>
        )}
      </div>
      <p className="subtle">
        Training uses {from} through {to} (UTC) for this variant. Conversion predicts the configured primary action{' '}
        {state?.primary_action_id ? (
          <code>{state.primary_action_id}</code>
        ) : (
          '— configure a primary action in the page policy to enable it'
        )}{' '}
        within 30 seconds of exposure. Each objective needs enough retained activity.
      </p>
      {editable && (
        <div className="intelligence-controls">
          <FormField
            category="select"
            label={<>Automatic retraining</>}
            value={interval}
            onChange={(e) => setIntervalHours(Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={24}>Daily</option>
            <option value={168}>Weekly</option>
          </FormField>
          <FormField
            label={<>Rolling training window · days</>}
            type="number"
            min={1}
            max={90}
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
          />
          <Button
            variant="secondary"
            disabled={busy || lookback < 1 || lookback > 90}
            onClick={() =>
              void action('/api/intelligence/training/schedule', {
                ...scope,
                interval_hours: interval,
                lookback_days: lookback,
              })
            }
          >
            Save retraining schedule
          </Button>
        </div>
      )}
      {state?.schedule.interval_hours !== 0 && state?.schedule.next_run_at && (
        <p className="subtle">
          Next retraining: {new Date(state.schedule.next_run_at).toLocaleString()}. The server must be running; missed
          intervals run once after restart.
        </p>
      )}
      {run && (
        <>
          <div className="intelligence-controls">
            <FormField
              category="select"
              label={<>Training runs &amp; model versions</>}
              value={run.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {state?.runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {names[r.model]} · {r.status} · {new Date(r.created_at).toLocaleString()}
                </option>
              ))}
            </FormField>
            {editable && run.status === 'completed' && (
              <Button
                variant="secondary"
                disabled={busy || !!active || !run.manifest}
                onClick={() => void action('/api/intelligence/training/rollback', {...scope, run_id: run.id})}
              >
                Use this model version
              </Button>
            )}
          </div>
          <p role="status">
            {names[run.model]} · {run.status}
            {point ? ` · ${point.phase} epoch ${point.epoch}/${point.epochs}` : ''}
          </p>
          {['running', 'completed'].includes(run.status) && (
            <progress aria-label="Training progress" max={100} value={progress} />
          )}
          {run.error_code && (
            <p className="intelligence-note">
              {readable(run.error_code)}.{' '}
              {run.error_code.includes('RUNTIME')
                ? 'Install the optional Python runtime once and configure its interpreter; see docs/INTELLIGENCE.md.'
                : 'Review the data period, action support and configured primary action, then retry.'}
            </p>
          )}
          {run.progress.length > 0 && (
            <Suspense fallback={<p>Loading loss chart…</p>}>
              <LossChart points={run.progress} />
            </Suspense>
          )}
          {run.manifest && (
            <Collapsible title={<>Saved evaluation · {run.manifest.model_id.slice(0, 8)}</>}>
              <p>
                Saved {new Date(run.manifest.created_at).toLocaleString()} · Expires{' '}
                {new Date(run.manifest.expires_at).toLocaleString()}. Rollback rechecks current privacy policy, page
                configuration and evidence validity.
              </p>
              <pre>{JSON.stringify(run.manifest.evaluation, null, 2)}</pre>
            </Collapsible>
          )}
        </>
      )}
      {!state?.runs.length && (
        <p className="subtle">No background training runs yet. Existing manually trained models remain available.</p>
      )}
      {error && (
        <p className="error-inline" role="alert">
          {readable(error)}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {state && <VariantComparison experiments={state.experiments} source={scope.data_source} api={api} />}
    </section>
  );
}

function VariantComparison({experiments, source, api}: {experiments: Experiment[]; source: string; api: Api}) {
  const [chosen, setChosen] = useState(''),
    [readout, setReadout] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setReadout(null);
    setError('');
    if (chosen)
      api('/api/experiments/' + encodeURIComponent(chosen) + '/readout?data_source=' + source)
        .then((r) => {
          if (live) setReadout(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [api, chosen, source]);
  if (!experiments.length)
    return <p className="subtle">Create an A/B experiment in Experiments to compare randomized variants here.</p>;
  return (
    <div>
      <h3>A/B variant comparison</h3>
      <div className="intelligence-controls">
        <FormField category="select" label={<>Experiment</>} value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Choose an experiment</option>
          {experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </FormField>
      </div>
      {readout?.suppressed ? (
        <p>Below the reporting threshold.</p>
      ) : (
        readout?.control && (
          <>
            <DataTable<any>
              name="Variant conversion comparison"
              data={[readout.control, readout.treatment]}
              rowId={(row) => row.variant}
              resetKey={chosen + '|' + source}
              columns={[
                {id: 'variant', label: 'VARIANT', value: (row) => row.variant},
                {id: 'mature', label: 'MATURED UNITS', value: (row) => row.mature},
                {id: 'successes', label: 'CONVERSIONS', value: (row) => row.successes},
                {
                  id: 'rate',
                  label: 'CONVERSION RATE',
                  value: (row) => (row.mature ? row.successes / row.mature : undefined),
                  render: (row) => (row.mature ? ((100 * row.successes) / row.mature).toFixed(1) + '%' : 'Unavailable'),
                },
              ]}
            />
            <p>
              {source === 'seeded' ? 'Generated examples · ' : ''}
              {readable(readout.decision ?? 'Waiting for evidence')}.{' '}
              {readout.effect
                ? `Difference: ${readout.effect.difference_pp.toFixed(2)} percentage points; 95% interval ${readout.effect.low_pp.toFixed(2)} to ${readout.effect.high_pp.toFixed(2)}.`
                : ''}
            </p>
            <p className="subtle">
              {readout.blockers?.join(' · ')}. Use the full experiment readout to review validity and guardrails.
            </p>
            <a href="#experiments">Open Experiments</a>
          </>
        )
      )}
      {error && <p role="alert">{readable(error)}</p>}
    </div>
  );
}

export function ObservedJourney({
  scope,
  from,
  to,
  api,
}: {
  scope: IntelligenceScope;
  from: string;
  to: string;
  api: Api;
}) {
  const [data, setData] = useState<any>(null),
    [selected, setSelected] = useState('page_view'),
    [error, setError] = useState('');
  const query = new URLSearchParams({...scope, from, to}).toString();
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    api('/api/intelligence/journey?' + query)
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, query]);
  const outgoing = data?.edges.filter((e: any) => e.from === selected) ?? [];
  return (
    <Card padding="normal" title={<>Observed user journey</>}>
      <p>Select an action to explore the next observed steps. This map describes interactions inside one page view.</p>
      {data ? (
        <>
          <p className="subtle">
            {data.views} eligible page views · {data.definition}
          </p>
          <div className="intelligence-journey" aria-label="Journey actions">
            {data.nodes.map((node: any) => (
              <Button
                variant="secondary"
                className={'btn ' + (selected === node.action ? 'primary' : '')}
                key={node.action}
                aria-pressed={selected === node.action}
                onClick={() => setSelected(node.action)}
              >
                {node.action}
                <span className="badge">{node.views}</span>
              </Button>
            ))}
          </div>
          <h3>
            After <code>{selected}</code>
          </h3>
          {outgoing.length ? (
            <div className="intelligence-branches">
              {outgoing.map((edge: any) => (
                <Button
                  variant="plain"
                  className="intelligence-branch"
                  key={edge.to}
                  onClick={() => setSelected(edge.to)}
                >
                  <span aria-hidden="true">→</span>
                  <code>{edge.to}</code>
                  <span>{edge.views} views</span>
                  <span
                    className="intelligence-edge-bar"
                    style={{
                      width: Math.max(3, (100 * edge.views) / Math.max(...outgoing.map((e: any) => e.views))) + '%',
                    }}
                  />
                </Button>
              ))}
            </div>
          ) : (
            <p>No reportable next steps for this action in the selected period.</p>
          )}
          <h3>Elements to review</h3>
          <p>
            Exploratory flags compare 95% click-rate intervals against reportable peer elements. Different placements
            can explain differences; flags do not establish a defect or causal effect.
          </p>
          {data.elements.length ? (
            <div className="intelligence-table-wrap">
              <DataTable<any>
                name="Element click outcomes"
                data={data.elements}
                rowId={(row) => row.element_id}
                columns={[
                  {
                    id: 'element_id',
                    label: 'ELEMENT',
                    value: (row) => row.element_id,
                    render: (row) => <code>{row.element_id}</code>,
                  },
                  {id: 'views', label: 'OBSERVED WINDOWS', value: (row) => row.views},
                  {
                    id: 'rate',
                    label: 'CLICK RATE',
                    value: (row) => row.rate,
                    render: (row) => (100 * row.rate).toFixed(1) + '%',
                  },
                  {
                    id: 'interval',
                    label: '95% INTERVAL',
                    value: (row) => row.interval.low,
                    render: (row) =>
                      (100 * row.interval.low).toFixed(1) + '–' + (100 * row.interval.high).toFixed(1) + '%',
                  },
                  {id: 'flag', label: 'REVIEW', value: (row) => (row.flag ? 'Below peer range' : 'No flag')},
                ]}
              />
            </div>
          ) : (
            <p>No elements have enough fully observed windows and reportable outcomes for comparison.</p>
          )}
        </>
      ) : (
        <p role="status">{error ? readable(error) : 'Loading observed journeys…'}</p>
      )}
    </Card>
  );
}
