import {Collapsible} from './components/collapsible.js';
import {DataTable} from './data-table.js';
import {Card} from './components/card.js';
import {FormField} from './components/form-field.js';
import {Button} from './components/button.js';
import {useCallback, useEffect, useState} from 'react';
import type {ModelManifest} from '../../../packages/contracts/intelligence.js';
import {exposureElement} from '../../../packages/domain/click-prediction.js';
import {EulerSetup, EulerEvaluation, ClickResult, type EulerStatus, type ClickEstimate} from './click-intelligence.js';
import {IntelligenceTraining, ObservedJourney} from './intelligence-training.js';
import './intelligence.css';

type Page = {site_id: string; page_key: string; name: string; revision: string; variant: string};
type Status = {status: 'not_trained' | 'expired' | 'incompatible'} | {status: 'ready'; manifest: ModelManifest};
const messages = {
  not_trained: 'No SASRec model has been trained for this page and data source.',
  expired: 'This model has expired. Retrain from retained activity.',
  incompatible: 'This model uses an older page configuration. Retrain from current activity.',
};
export function IntelligencePanel({
  pages,
  selected,
  onSelect,
  dataSource,
  from,
  to,
  setFrom,
  setTo,
  role,
  api,
}: {
  pages: Page[];
  selected: string;
  onSelect: (value: string) => void;
  dataSource: string;
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  role: string;
  api: (url: string, body?: unknown) => Promise<any>;
}) {
  const page = pages.find((p) => p.site_id + '/' + p.page_key === selected);
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [history, setHistory] = useState<string[]>(['page_view']),
    [action, setAction] = useState('page_view');
  const [rankings, setRankings] = useState<{action: string; score: number}[] | null>(null);
  const [euler, setEuler] = useState<EulerStatus | null>(null),
    [click, setClick] = useState<ClickEstimate | null>(null),
    [device, setDevice] = useState('desktop');
  const [conversion, setConversion] = useState<EulerStatus | null>(null),
    [conversionEstimate, setConversionEstimate] = useState<(ClickEstimate & {primary_action_id: string}) | null>(null);
  const [variant, setVariant] = useState({page: '', value: ''}),
    [refresh, setRefresh] = useState(0);
  const updated = useCallback(() => setRefresh((n) => n + 1), []);
  const scope = page
    ? {
        site_id: page.site_id,
        page_key: page.page_key,
        data_source: dataSource as 'recorded' | 'seeded',
        revision: page.revision,
        variant: variant.page === selected ? variant.value : page.variant,
      }
    : null;
  const query = scope ? new URLSearchParams(scope).toString() : '';
  useEffect(() => {
    if (!query || dataSource === 'legacy' || role === 'installer') return;
    let live = true;
    setStatus(null);
    setEuler(null);
    setConversion(null);
    setRankings(null);
    setClick(null);
    setConversionEstimate(null);
    setHistory(['page_view']);
    api('/api/intelligence/status?' + query)
      .then((result: Status) => {
        if (!live) return;
        setStatus(result);
        if (result.status === 'ready') {
          const initial = result.manifest.vocabulary.includes('page_view')
            ? 'page_view'
            : result.manifest.vocabulary[0];
          setHistory([initial]);
          setAction(result.manifest.vocabulary.find((t) => t !== 'page_view') ?? initial);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    api('/api/intelligence/euler/status?' + query)
      .then((result: EulerStatus) => {
        if (live) setEuler(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    api('/api/intelligence/conversion/status?' + query)
      .then((result: EulerStatus) => {
        if (live) setConversion(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, query, dataSource, role, refresh]);
  async function download(model: 'sasrec' | 'euler' = 'sasrec') {
    if (!scope) return;
    setBusy('export');
    setError('');
    try {
      const dataset = await api(
        '/api/intelligence/' +
          (model === 'euler' ? 'euler/' : '') +
          'dataset?' +
          new URLSearchParams({...scope, from, to}),
      );
      const url = URL.createObjectURL(new Blob([JSON.stringify(dataset)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = model === 'euler' ? 'infrared-click-examples.json' : 'infrared-sequences.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function estimate(joint = false) {
    setBusy('estimate');
    setError('');
    setClick(null);
    if (joint) setRankings(null);
    try {
      const result = await api('/api/intelligence/' + (joint ? 'analyze' : 'euler/predict'), {
        ...scope,
        history,
        device,
        ...(joint ? {top_k: 5} : {}),
      });
      setClick(joint ? result.eulernet : result);
      if (joint) setRankings(result.sasrec.rankings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const actions = [
    ...new Set([
      ...(status?.status === 'ready' ? status.manifest.vocabulary.filter((t) => t !== 'page_view') : []),
      ...(euler?.status === 'ready' ? euler.manifest.vocabulary.element_id.map((id) => 'exposure:' + id) : []),
      ...(conversion?.status === 'ready'
        ? conversion.manifest.vocabulary.element_id.map((id) => 'exposure:' + id)
        : []),
    ]),
  ];
  const sasrecHistory = status?.status === 'ready' && history.every((t) => status.manifest.vocabulary.includes(t));
  async function predict() {
    setBusy('predict');
    setError('');
    setRankings(null);
    try {
      const result = await api('/api/intelligence/predict', {...scope, history, top_k: 5});
      setRankings(result.rankings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function predictConversion() {
    setBusy('conversion');
    setError('');
    setConversionEstimate(null);
    try {
      setConversionEstimate(await api('/api/intelligence/conversion/predict', {...scope, history, device}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (role === 'installer')
    return (
      <Card padding="normal">
        <p>Journey intelligence is available to reporting roles.</p>
      </Card>
    );
  return (
    <div className="intelligence-layout">
      <Card
        padding="normal"
        title={
          <>
            Next-action intelligence <span className="badge">SASRec · Local</span>
          </>
        }
      >
        <p>Explore which registered interaction may follow an action sequence within one page view.</p>
        <div className="intelligence-controls">
          <FormField
            category="select"
            label={<>Landing page</>}
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
          >
            {pages.map((p) => (
              <option key={p.site_id + '/' + p.page_key} value={p.site_id + '/' + p.page_key}>
                {p.name}
              </option>
            ))}
          </FormField>
          <FormField
            label={<>Activity from · UTC</>}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <FormField
            label={<>Activity through · UTC</>}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        {page && (
          <p className="subtle">
            Revision {page.revision} · Variant {scope?.variant} · All devices and campaign codes. Activity dates select
            training and journey evidence; predictions use the installed model.
          </p>
        )}
        {dataSource === 'legacy' ? (
          <p role="status">
            Unclassified historical activity cannot train this model. Choose Recorded activity or Generated samples.
          </p>
        ) : (
          <>
            {dataSource === 'seeded' && (
              <p className="intelligence-note">
                Generated samples test the pipeline. Rankings trained on samples do not describe real visitors.
              </p>
            )}
            {status?.status !== 'ready' && (
              <p role="status">{status ? messages[status.status] : 'Checking the local model…'}</p>
            )}
            {scope && (
              <IntelligenceTraining
                key={query}
                scope={scope}
                from={from}
                to={to}
                editable={['owner', 'administrator'].includes(role)}
                api={api}
                onUpdated={updated}
                onVariant={(value) => setVariant({page: selected, value})}
              />
            )}
            {['owner', 'administrator'].includes(role) && (
              <Collapsible title={<>Advanced dataset export</>} className="intelligence-setup">
                <Button variant="secondary" disabled={!!busy || !page} onClick={() => void download()}>
                  {busy === 'export' ? 'Exporting…' : 'Download training sequences'}
                </Button>
                <p>
                  Optional export for independent analysis. At least 10 eligible page views are required for training;
                  real activity also needs sufficient action support. Delete exported datasets after use.
                </p>
              </Collapsible>
            )}
            <EulerSetup
              status={euler}
              canExport={['owner', 'administrator'].includes(role) && !!page}
              busy={!!busy}
              onDownload={() => void download('euler')}
            />
            {(status?.status === 'ready' || euler?.status === 'ready' || conversion?.status === 'ready') && (
              <>
                {status?.status === 'ready' && (
                  <p className="subtle">
                    SASRec trained {new Date(status.manifest.created_at).toLocaleString()} · Expires{' '}
                    {new Date(status.manifest.expires_at).toLocaleString()}
                  </p>
                )}
                <h3>Build an action history</h3>
                <ol className="intelligence-history">
                  {history.map((token, i) => (
                    <li key={i}>
                      <code>{token}</code>
                    </li>
                  ))}
                </ol>
                <div className="intelligence-controls">
                  <FormField
                    category="select"
                    label={<>Observed action</>}
                    value={actions.includes(action) ? action : actions[0]}
                    disabled={!!busy}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    {actions.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </FormField>
                  <Button
                    variant="secondary"
                    disabled={!!busy || history.length >= 50 || !actions.length}
                    onClick={() => {
                      setHistory([...history, actions.includes(action) ? action : actions[0]]);
                      setRankings(null);
                      setClick(null);
                      setConversionEstimate(null);
                    }}
                  >
                    Add action
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!!busy || history.length <= 1}
                    onClick={() => {
                      setHistory(history.slice(0, -1));
                      setRankings(null);
                      setClick(null);
                      setConversionEstimate(null);
                    }}
                  >
                    Remove last
                  </Button>
                  {status?.status === 'ready' && (
                    <Button variant="primary" disabled={!!busy || !sasrecHistory} onClick={() => void predict()}>
                      {busy === 'predict' ? 'Ranking…' : 'Predict next action'}
                    </Button>
                  )}
                </div>
                {euler?.status === 'ready' && (
                  <>
                    <p>
                      For the click estimate, end the history with the element's first <code>exposure:</code> action.
                      Choose the device at that exposure.
                    </p>
                    <div className="intelligence-controls">
                      <FormField
                        category="select"
                        label={<>Device at exposure</>}
                        value={device}
                        disabled={!!busy}
                        onChange={(e) => {
                          setDevice(e.target.value);
                          setClick(null);
                        }}
                      >
                        <option value="desktop">Desktop</option>
                        <option value="tablet">Tablet</option>
                        <option value="mobile">Mobile</option>
                      </FormField>
                      <Button
                        variant="secondary"
                        disabled={!!busy || !exposureElement(history)}
                        onClick={() => void estimate()}
                      >
                        Estimate exposed-element click
                      </Button>
                      {status?.status === 'ready' && (
                        <Button
                          variant="primary"
                          disabled={!!busy || !exposureElement(history) || !sasrecHistory}
                          onClick={() => void estimate(true)}
                        >
                          Analyze both models
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {rankings && (
                  <>
                    <h3>Likely next interactions</h3>
                    <p>
                      Higher scores rank ahead of lower scores. These scores are not calibrated probabilities. Repeated
                      actions remain eligible.
                    </p>
                    <DataTable
                      name="Next interaction rankings"
                      data={rankings.map((row, index) => ({...row, rank: index + 1}))}
                      rowId={(row) => row.action}
                      columns={[
                        {id: 'rank', label: 'RANK', value: (row) => row.rank},
                        {
                          id: 'action',
                          label: 'REGISTERED ACTION',
                          value: (row) => row.action,
                          render: (row) => <code>{row.action}</code>,
                        },
                        {
                          id: 'score',
                          label: 'RANKING SCORE',
                          value: (row) => row.score,
                          render: (row) => row.score.toFixed(3),
                        },
                      ]}
                    />
                  </>
                )}
                {click && <ClickResult result={click} />}
                {conversion?.status === 'ready' && (
                  <div className="intelligence-setup">
                    <h3>Conversion probability</h3>
                    <p>
                      Estimates the primary action <code>{conversion.manifest.primary_action_id}</code> within 30
                      seconds of first exposure, among fully observed windows. End the history with a first exposure
                      before that action has occurred.
                    </p>
                    <div className="intelligence-controls">
                      <FormField
                        category="select"
                        label={<>Conversion exposure device</>}
                        value={device}
                        onChange={(e) => {
                          setDevice(e.target.value);
                          setConversionEstimate(null);
                          setClick(null);
                        }}
                      >
                        <option value="desktop">Desktop</option>
                        <option value="tablet">Tablet</option>
                        <option value="mobile">Mobile</option>
                      </FormField>
                      <Button
                        variant="primary"
                        disabled={
                          !!busy ||
                          !exposureElement(history) ||
                          history.includes('activation:' + conversion.manifest.primary_action_id)
                        }
                        onClick={() => void predictConversion()}
                      >
                        Predict conversion probability
                      </Button>
                    </div>
                    {conversionEstimate && (
                      <div
                        role="region"
                        aria-label="Conversion probability estimate"
                        className="intelligence-click-result"
                      >
                        <strong>{(100 * conversionEstimate.probability).toFixed(1)}%</strong>
                        <p>
                          Estimated probability of <code>{conversionEstimate.primary_action_id}</code> in the next 30
                          seconds.{' '}
                          {conversionEstimate.validation_state === 'fixture_only'
                            ? 'Generated samples validate the pipeline only.'
                            : 'Offline estimate; validate on representative future activity.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="error-inline" role="alert">
            {error.replaceAll('_', ' ').toLowerCase()}
          </p>
        )}
      </Card>
      {status?.status === 'ready' && (
        <Card padding="normal" title={<>Held-out evaluation</>}>
          <p>
            {status.manifest.evaluation.test_sequences} later page views · Final action predicted from the preceding
            history · Top {status.manifest.evaluation.k}
          </p>
          <DataTable<any>
            name="Held-out model evaluation"
            data={(['sasrec', 'markov', 'popularity'] as const).map((name) => ({
              name,
              ...status.manifest.evaluation[name],
            }))}
            rowId={(row) => row.name}
            columns={[
              {
                id: 'name',
                label: 'MODEL',
                value: (row) => row.name,
                render: (row) =>
                  row.name === 'sasrec'
                    ? 'SASRec'
                    : row.name === 'markov'
                      ? 'Last-action baseline'
                      : 'Popularity baseline',
              },
              {
                id: 'hit_rate',
                label: 'HIT RATE',
                value: (row) => row.hit_rate,
                render: (row) => (100 * row.hit_rate).toFixed(1) + '%',
              },
              {id: 'ndcg', label: 'NDCG', value: (row) => row.ndcg, render: (row) => row.ndcg.toFixed(3)},
            ]}
          />
          <p>
            {status.manifest.evaluation.unknown_targets} held-out sequences contained unseen or unsupported actions and
            count as misses. Test activity never builds the action vocabulary or chooses a checkpoint.
          </p>
          <p className="subtle">
            This model ranks subsequent recorded interactions. It does not estimate abandonment, diagnose friction,
            cluster behaviour, or prove a change will improve conversions.
          </p>
        </Card>
      )}
      {dataSource !== 'legacy' && euler?.status === 'ready' && <EulerEvaluation manifest={euler.manifest} />}
      {dataSource !== 'legacy' && conversion?.status === 'ready' && <EulerEvaluation manifest={conversion.manifest} />}
      {scope && dataSource !== 'legacy' && <ObservedJourney key={query} scope={scope} from={from} to={to} api={api} />}
    </div>
  );
}
