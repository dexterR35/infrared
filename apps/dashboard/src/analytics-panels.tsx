import {Collapsible} from './components/collapsible.js';
import {MetricCard, Card, CardGrid} from './components/card.js';
import {Button} from './components/button.js';
import {FilterFields} from './components/filter-bar.js';
import {FormField} from './components/form-field.js';
import {useEffect, useRef, useState} from 'react';
import {Activity, Clock3, Info, ShieldCheck, Target} from 'lucide-react';
import {FunnelCharts, DiagnosticCharts, QualityCharts, ComparisonCharts} from './chart-loader.js';
import {paintHeatmap} from '../../../packages/heatmap-renderer/index.js';
import {SharedHeatmapComparison} from './comparison-heatmaps.js';
type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
export function CampaignFilters({
  from,
  to,
  device,
  campaign,
  codes,
  onFrom,
  onTo,
  onDevice,
  onCampaign,
}: {
  from: string;
  to: string;
  device: string;
  campaign: string;
  codes: string[];
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onDevice: (v: string) => void;
  onCampaign: (v: string) => void;
}) {
  return (
    <FilterFields>
      <FormField
        label="From · UTC"
        aria-label="Campaign from date"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFrom(e.target.value)}
      />
      <FormField
        label="Through · UTC"
        aria-label="Campaign through date"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onTo(e.target.value)}
      />
      <FormField
        category="select"
        label="Device"
        aria-label="Campaign device"
        value={device}
        onChange={(e) => onDevice(e.target.value)}
      >
        {['all', 'desktop', 'tablet', 'mobile'].map((d) => (
          <option key={d} value={d}>
            {d === 'all' ? 'All devices' : d[0].toUpperCase() + d.slice(1)}
          </option>
        ))}
      </FormField>
      <FormField
        category="select"
        label="Approved campaign"
        aria-label="Portfolio campaign"
        value={campaign}
        onChange={(e) => onCampaign(e.target.value)}
      >
        <option value="">All approved codes</option>
        {codes.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </FormField>
    </FilterFields>
  );
}

const number = (n: number | undefined) => new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0}).format(n ?? 0),
  percent = (n: number | undefined) => (n ?? 0).toFixed(1) + '%';
function Metric({label, value, detail}: {label: string; value: string; detail?: string}) {
  return <MetricCard label={label} value={value} detail={detail} />;
}
export function FunnelPanel({report}: {report: any}) {
  if (!report || report.suppressed || !report.funnel) return null;
  const f = report.funnel,
    steps = [
      {label: 'Tracked page views', n: f.views},
      {label: 'Qualified primary CTA exposure', n: f.exposed_views},
      {label: 'CTA activation after exposure', n: f.ordered_activated_views},
    ];
  return (
    <>
      <Card
        padding="none"
        aria-label="Ordered conversion funnel"
        title={<>From landing to action</>}
        description={
          <>
            Ordered steps within a tracked view · primary CTA <code>{report.page.primary_cta_id}</code>
          </>
        }
        actions={
          <>
            <Target size={20} />
          </>
        }
      >
        <CardGrid>
          {steps.map((step, index) => (
            <MetricCard
              key={step.label}
              label={step.label}
              value={number(step.n)}
              detail={
                index === 0
                  ? 'Consented, sampled views'
                  : percent(steps[index - 1].n ? (100 * step.n) / steps[index - 1].n : 0) + ' from previous step'
              }
            />
          ))}
        </CardGrid>
        <CardGrid>
          <Metric
            label="Engaged tracked views"
            value={number(report.engagement.engaged_views)}
            detail="Action, 10s visible time, or 75% reach"
          />
          <Metric
            label="Observed quick exits"
            value={number(report.engagement.quick_exit_views)}
            detail="Under 10s visible, no primary action"
          />
          <Metric
            label="Median time to first action"
            value={
              report.engagement.median_first_action_ms === null
                ? '-'
                : (report.engagement.median_first_action_ms / 1000).toFixed(1) + 's'
            }
            detail={number(report.engagement.first_action_samples) + ' observed views'}
          />
          <Metric
            label="Primary CTA exposure"
            value={percent(f.exposure_rate)}
            detail="Distinct exposed views / tracked views"
          />
        </CardGrid>
        <Collapsible title={<>How to read this funnel</>} className="report-method panel-method">
          <div className="analytics-footnote">
            <Info size={14} />
            <span>
              {f.confidence
                ? `Exposure-to-activation ${percent(f.ordered_activation_rate)} · 95% Wilson interval ${percent(f.confidence.low)}–${percent(f.confidence.high)}. `
                : ''}
              {f.views < 20 ? 'Small cohort: interpret rates cautiously. ' : ''}CTA activation does not establish a
              completed conversion. This is an observed funnel, not a causal experiment.
            </span>
          </div>
        </Collapsible>
      </Card>
      <FunnelCharts report={report} />
    </>
  );
}
export function DiagnosticsPanel({report}: {report: any}) {
  if (!report || report.suppressed || !report.diagnostics) return null;
  const d = report.diagnostics,
    metrics: Record<string, string> = {
      navigation_load_ms: 'Page load',
      fcp_ms: 'First contentful paint',
      lcp_ms: 'Largest contentful paint',
      interaction_latency_ms: 'Observed interaction latency',
      layout_shift: 'Post-consent layout shift',
    };
  return (
    <>
      <Card
        padding="none"
        aria-label="Experience diagnostics"
        title={<>Experience signals</>}
        description={<>Heuristics and approved numeric measurements · messages and stacks are excluded.</>}
        actions={
          <>
            <Activity size={20} />
          </>
        }
      >
        <CardGrid>
          <Metric label="Repeated-click clusters" value={number(d.rage_clicks)} detail="3+ nearby clicks in 1 second" />
          <Metric
            label="Possible no-response clicks"
            value={number(d.dead_clicks)}
            detail="No observed response after 1 second"
          />
          <Metric
            label="Runtime error signals"
            value={number(d.runtime_errors + d.unhandled_rejections)}
            detail="Registered codes only"
          />
          <Metric
            label="Affected tracked views"
            value={number(d.affected_views)}
            detail="Views with any diagnostic signal"
          />
        </CardGrid>
        <CardGrid>
          {Object.entries(metrics).map(([metric, label]) => {
            const p = report.performance.find((p: any) => p.metric === metric);
            return (
              <MetricCard
                key={metric}
                label={label + ' · p75'}
                value={p ? (metric === 'layout_shift' ? p.p75.toFixed(3) : number(p.p75) + ' ms') : '-'}
                detail={p ? number(p.samples) + ' observed views' : 'No observations yet'}
              />
            );
          })}
        </CardGrid>
        <Collapsible title={<>About these experience signals</>} className="report-method panel-method">
          <div className="analytics-footnote">
            <Info size={14} />
            <span>
              These signals suggest places to investigate. Repeated clicks do not prove frustration, and possible
              no-response clicks do not prove a broken control. Timing samples are collected only after permission.
              Interaction latency is not a claim of standardized INP.
            </span>
          </div>
        </Collapsible>
      </Card>
      <DiagnosticCharts report={report} />
    </>
  );
}
export function ReportQualityPanel({report}: {report: any}) {
  if (!report || report.suppressed) return null;
  const q = report.quality,
    d = report.delivery ?? {},
    coverage = q.total_observations ? (100 * q.mapped) / q.total_observations : 0;
  return (
    <>
      <Card
        padding="none"
        aria-label="Report data quality"
        title={<>Can you trust this cohort?</>}
        description={<>Coverage, processing and client-reported delivery gaps.</>}
        actions={
          <>
            <ShieldCheck size={20} />
          </>
        }
      >
        <CardGrid>
          <Metric
            label="Map coverage"
            value={percent(coverage)}
            detail={`${number(q.mapped)} / ${number(q.total_observations)} clicks mapped`}
          />
          <Metric label="Pending views" value={number(q.pending_views)} detail="Awaiting current facts" />
          <Metric
            label="Events delayed over 60s"
            value={number(q.delayed_events)}
            detail={`${number(q.retained_events)} retained events in cohort`}
          />
          <Metric
            label="Client-reported drops"
            value={number(d.dropped_events)}
            detail={`${number(d.retry_attempts)} retries · ${number(d.transport_failures)} failed attempts`}
          />
        </CardGrid>
        <div className="analytics-footnote">
          <Info size={14} />
          <span>
            Map exclusions: {number(q.incompatible)} incompatible layouts · {number(q.unregistered)} unregistered
            targets · {number(q.unsupported)} unsupported geometry · {number(q.masked)} masked positions.
            Processing-delay p75 across per-view maximum delays:{' '}
            {q.p75_view_max_delay_ms === null ? 'unavailable' : number(q.p75_view_max_delay_ms) + ' ms'}.
          </span>
        </div>
        <div className="analytics-footnote">
          <Clock3 size={14} />
          <span>
            Processed through{' '}
            {q.processed_through
              ? new Date(q.processed_through).toLocaleString('en-GB', {timeZone: 'Europe/Bucharest'})
              : 'no confirmed views yet'}{' '}
            · {q.advanced_views} views with aggregation v3 ·{' '}
            {(q.sample_rates ?? []).map((n: number) => percent(100 * n)).join(', ') || 'no sample observations'}.
            Delivery is best-effort; a client that never reconnects cannot report its losses.
          </span>
        </div>
      </Card>
      <QualityCharts report={report} />
    </>
  );
}
export {CampaignDashboard} from './campaign-dashboard.js';
function VersionCard({report}: {report: any}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && report?.reference)
      paintHeatmap(
        ref.current,
        report.points,
        report.reference.manifest.document.width,
        report.reference.manifest.document.height,
        0.75,
      );
  }, [report]);
  if (!report) return <div className="quiet-state">Choose a revision.</div>;
  return (
    <Card
      padding="none"
      title={<>{report.page.name}</>}
      actions={
        <>
          <code>{report.selected_revision ?? report.page.revision}</code>
        </>
      }
    >
      {report.suppressed ? (
        <p>Cohort below reporting threshold.</p>
      ) : (
        <>
          <CardGrid>
            <Metric label="Tracked views" value={number(report.summary.views)} />
            <Metric label="Activation" value={percent(report.summary.activation_rate)} />
          </CardGrid>
          {report.reference ? (
            <div
              className="version-preview"
              style={{
                aspectRatio: `${report.reference.manifest.document.width}/${report.reference.manifest.document.height}`,
              }}
            >
              <img alt="Approved revision reference" src={'/api/references/' + report.reference.id + '/image'} />
              <canvas ref={ref} />
            </div>
          ) : (
            <div className="quiet-state">
              No approved reference for this revision and viewport. Counts remain available.
            </div>
          )}
          <div className="analytics-footnote">
            {report.reference?.manifest.viewport.width ?? 'No exact'} px · {report.quality.mapped} mapped clicks · Each
            map has its own relative density scale.
          </div>
        </>
      )}
    </Card>
  );
}
export function VersionComparison({
  api,
  report,
  query,
  reloadToken,
}: {
  api: Api;
  report: any;
  query: string;
  reloadToken: number;
}) {
  const [a, setA] = useState(''),
    [b, setB] = useState(''),
    [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  const revisions: string[] = report?.revisions ?? [];
  useEffect(() => {
    setA(revisions[0] ?? '');
    setB(revisions.length > 1 ? revisions.at(-1)! : '');
  }, [report?.page.site_id, report?.page.page_key, revisions.join('|')]);
  useEffect(() => {
    setData(null);
    setError('');
    if (!a || !b) return;
    let live = true;
    const params = new URLSearchParams(query);
    params.delete('reference_id');
    params.set('revision_a', a);
    params.set('revision_b', b);
    api('/api/reports/versions?' + params)
      .then((r) => {
        if (live) {
          setData(r);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, query, a, b, reloadToken]);
  return (
    <>
      <div className="comparison-note">
        <div>
          <strong>Compare page revisions</strong>
          <p>Independent observed cohorts. A version difference does not establish a causal uplift.</p>
        </div>
        {[
          ['Earlier revision', a, setA],
          ['Later revision', b, setB],
        ].map(([label, value, set]) => (
          <FormField
            category="select"
            label={<>{String(label)}</>}
            aria-label={String(label)}
            value={value as string}
            onChange={(e) => (set as (v: string) => void)(e.target.value)}
          >
            <option value="">Choose a revision</option>
            {revisions.map((r) => (
              <option value={r} key={r}>
                {r}
              </option>
            ))}
          </FormField>
        ))}
      </div>
      {error && <div className="notice error">{error}</div>}
      {revisions.length === 1 && !b && (
        <div className="quiet-state">
          Only one observed revision is available. Publish a new page revision and collect its own views before
          comparing versions.
        </div>
      )}
      {data && <ComparisonCharts reports={data.reports} />}
      <div className="version-grid">
        {data?.reports.map((r: any, i: number) => (
          <VersionCard key={i} report={r} />
        ))}
      </div>
      {data && <SharedHeatmapComparison reports={data.reports} />}
      {!revisions.length && <div className="quiet-state">No recorded revisions in this data source yet.</div>}
    </>
  );
}
export function TrackingPolicy({
  page,
  role,
  api,
  onSaved,
}: {
  page: any;
  role: string;
  api: Api;
  onSaved: () => Promise<void>;
}) {
  const [release, setRelease] = useState(''),
    [codes, setCodes] = useState(''),
    [diagnostics, setDiagnostics] = useState(false),
    [cta, setCta] = useState(''),
    [action, setAction] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    setRelease(page?.revision ?? '');
    setCodes((page?.campaign_codes ?? ['unknown']).join(', '));
    setDiagnostics(page?.diagnostics_enabled ?? false);
    setCta(page?.primary_cta_id ?? '');
    setAction(page?.primary_action_id ?? '');
  }, [
    page?.site_id,
    page?.page_key,
    page?.revision,
    page?.diagnostics_enabled,
    page?.campaign_codes?.join('|'),
    page?.primary_cta_id,
    page?.primary_action_id,
  ]);
  if (!page) return null;
  const editable = ['owner', 'administrator'].includes(role);
  async function save() {
    try {
      await api(
        `/api/pages/${encodeURIComponent(page.site_id)}/${encodeURIComponent(page.page_key)}/policy`,
        {
          revision: release,
          campaign_codes: [
            ...new Set(
              codes
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean),
            ),
          ],
          diagnostics_enabled: diagnostics,
          diagnostic_error_codes: page.diagnostic_error_codes ?? ['runtime-error', 'unhandled-rejection'],
          primary_cta_id: cta,
          primary_action_id: action,
        },
        'PATCH',
      );
      await onSaved();
      setMessage('Tracking policy saved. Refresh the landing page to apply it to a new view.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <Card padding="normal" aria-label="Tracking policy" title={<>Approved campaign and diagnostic policy</>}>
      <p>Campaigns are host-supplied public codes. Raw URL parameters are never used as attribution.</p>
      <FormField
        label={<>Published page revision</>}
        value={release}
        disabled={!editable || page.auto}
        onChange={(e) => setRelease(e.target.value)}
      />
      <p className="small-note">
        {page.auto
          ? 'Whole-site page context is managed automatically.'
          : 'Set the revision to match the published host context. A changed revision requires its own approved reference and collects a separate cohort.'}
      </p>
      {page.auto ? (
        <p className="small-note">
          Whole-site pages record every visit without a campaign code. To compare campaigns, add UTM tags to your ad
          links (for example ?utm_source=tiktok&amp;utm_campaign=black-friday); they are recorded automatically as the
          traffic source.
        </p>
      ) : (
        <FormField
          label={<>Approved campaign codes</>}
          value={codes}
          disabled={!editable}
          onChange={(e) => setCodes(e.target.value)}
        />
      )}
      <div className="two-fields">
        <FormField
          category="select"
          label={<>Primary CTA</>}
          value={cta}
          disabled={!editable}
          onChange={(e) => setCta(e.target.value)}
        >
          <option value="">Not configured</option>
          {page.elements.map((id: string) => (
            <option key={id}>{id}</option>
          ))}
        </FormField>
        <FormField
          category="select"
          label={<>Primary action</>}
          value={action}
          disabled={!editable}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">Not configured</option>
          {page.actions.map((id: string) => (
            <option key={id}>{id}</option>
          ))}
        </FormField>
      </div>
      <FormField
        label={<>Approved numeric performance and generic error signals</>}
        type="checkbox"
        checked={diagnostics}
        disabled={!editable}
        onChange={(e) => setDiagnostics(e.target.checked)}
      />
      <p className="small-note">
        Keep unknown in the approved codes. Only registered elements/actions can be selected. No registration-completion
        event is inferred.
      </p>
      {message && <p role="status">{message}</p>}
      {editable && (
        <Button variant="primary" onClick={() => void save()}>
          Save tracking policy
        </Button>
      )}
    </Card>
  );
}
