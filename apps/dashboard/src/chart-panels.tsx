import {Collapsible} from './components/collapsible.js';
import {Button} from './components/button.js';
import {CardGrid} from './components/card.js';
import {FormField} from './components/form-field.js';
import {useMemo, useState} from 'react';
import {ChartCard, ChartPlot as Plot, type Row} from './components/analytics-chart.js';
import type {ActivityPoint} from '../../../packages/domain/chart-series.js';

const palette = Array.from({length: 8}, (_, i) => `var(--chart-${i + 1})`);
function StylePicker({
  value,
  onChange,
}: {
  value: 'line' | 'bar' | 'area';
  onChange: (v: 'line' | 'bar' | 'area') => void;
}) {
  return (
    <div className="chart-style" aria-label="Chart style">
      {(['line', 'bar', 'area'] as const).map((style) => (
        <Button variant="secondary" key={style} aria-pressed={value === style} onClick={() => onChange(style)}>
          {style === 'line' ? 'Lines' : style === 'bar' ? 'Bars' : 'Area'}
        </Button>
      ))}
    </div>
  );
}

export function CampaignCharts({data, variant = 'primary'}: {data: any; variant?: 'primary' | 'detail'}) {
  const [kind, setKind] = useState<'line' | 'bar' | 'area'>('line'),
    [metric, setMetric] = useState('views'),
    [selected, setSelected] = useState<string[] | null>(null);
  const pages: Row[] = (data?.pages ?? []).filter((p: any) => !p.suppressed),
    selectedKeys = selected ?? pages.slice(0, 4).map((p) => p.site_id + '/' + p.page_key),
    eligible = pages.filter((p) => selectedKeys.includes(p.site_id + '/' + p.page_key));
  const metrics: Record<string, string> = {
    views: 'Tracked views',
    clicks: 'Pointer clicks',
    ordered_activations: 'Ordered CTA activations',
    exposed_views: 'CTA-exposed views',
  };
  const trend = useMemo(() => {
    const rows = new Map<string, Row>();
    eligible.forEach((p) =>
      p.timeseries?.forEach((point: ActivityPoint) => {
        const row = rows.get(point.date) ?? {date: point.date};
        row['page' + pages.indexOf(p)] = point[metric as keyof ActivityPoint];
        rows.set(point.date, row);
      }),
    );
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data, metric, selected]);
  if (!data)
    return (
      <div className="chart-empty" role="status">
        Loading campaign charts…
      </div>
    );
  return (
    <>
      {variant === 'primary' && (
        <ChartCard
          title="Campaign trends"
          description="Daily activity across your selected landing pages."
          tools={<StylePicker value={kind} onChange={setKind} />}
          note="Suppressed daily cohorts are gaps. Zero means no tracked observations. Counts are not unique visitors or population estimates."
        >
          <div className="chart-controls">
            <FormField
              category="select"
              label="Trend metric"
              aria-label="Campaign chart metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            >
              {Object.entries(metrics).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </FormField>
            <Collapsible title={<>Compare pages · {eligible.length} selected</>} className="chart-page-picker">
              <div>
                {pages.map((p) => {
                  const key = p.site_id + '/' + p.page_key;
                  return (
                    <FormField
                      label={
                        <>
                          {p.name}
                          <small>{p.site_name}</small>
                        </>
                      }
                      type="checkbox"
                      checked={selectedKeys.includes(key)}
                      disabled={!selectedKeys.includes(key) && selectedKeys.length >= 8}
                      onChange={(e) => {
                        const list = selectedKeys;
                        if (e.target.checked && list.length >= 8) return;
                        setSelected(e.target.checked ? [...list, key] : list.filter((k) => k !== key));
                      }}
                    />
                  );
                })}
              </div>
              <p>Up to 8 pages. Use the legend to hide individual series.</p>
            </Collapsible>
          </div>
          <Plot
            rows={trend}
            series={eligible.slice(0, 8).map((p) => ({
              key: 'page' + pages.indexOf(p),
              label: p.name + ' · ' + p.site_name,
              color: palette[pages.indexOf(p) % palette.length],
            }))}
            kind={kind}
            zoom
          />
        </ChartCard>
      )}
      {variant === 'detail' && (
        <CardGrid columns={2}>
          <ChartCard
            title="Landing-page activity"
            description="Counts share the same selected dates, device and campaign code."
          >
            <Plot
              rows={pages.map((p) => ({name: p.name, views: p.views, clicks: p.clicks}))}
              x="name"
              series={[
                {key: 'views', label: 'Tracked views'},
                {key: 'clicks', label: 'Pointer clicks'},
              ]}
              kind="bar"
            />
          </ChartCard>
          <ChartCard
            title="CTA exposure and activation"
            description="Rates have separate denominators and are labeled explicitly."
            note="Exposure = exposed / tracked views. Ordered activation = later primary CTA activations / exposed views."
          >
            <Plot
              rows={pages.map((p) => ({
                name: p.name,
                exposure: p.views ? p.funnel.exposure_rate : null,
                activation: p.funnel.exposed_views ? p.funnel.ordered_activation_rate : null,
              }))}
              x="name"
              unit="%"
              series={[
                {key: 'exposure', label: 'Exposure / views'},
                {key: 'activation', label: 'Ordered activation / exposed'},
              ]}
              kind="bar"
            />
          </ChartCard>
          <ChartCard
            title="Responsive device segments"
            description="Selected viewport segments by device, grouped by landing page."
            note="Segment counts partition the selected layouts. A resized tracked view can contribute more than one segment."
          >
            <Plot
              rows={pages.map((p) => ({
                name: p.name,
                ...Object.fromEntries((p.devices ?? []).map((d: any) => [d.device, d.segments])),
              }))}
              x="name"
              series={[
                {key: 'desktop', label: 'Desktop segments'},
                {key: 'tablet', label: 'Tablet segments'},
                {key: 'mobile', label: 'Mobile segments'},
              ]}
              kind="bar"
              stacked
            />
          </ChartCard>
          <ChartCard
            title="Experience by landing page"
            description="Compare observed diagnostic counts within each selected page cohort."
            note="Signals suggest investigation, not a diagnosis; different traffic volumes affect raw counts."
          >
            <Plot
              rows={pages.map((p) => ({
                name: p.name,
                rage: p.diagnostics.rage_clicks,
                dead: p.diagnostics.dead_clicks,
                errors: p.diagnostics.runtime_errors + p.diagnostics.unhandled_rejections,
              }))}
              x="name"
              series={[
                {key: 'rage', label: 'Repeated-click clusters'},
                {key: 'dead', label: 'Possible no response'},
                {key: 'errors', label: 'Generic error signals'},
              ]}
              kind="bar"
            />
          </ChartCard>
        </CardGrid>
      )}
    </>
  );
}

export function FunnelCharts({report}: {report: any}) {
  if (!report || report.suppressed) return null;
  return (
    <CardGrid columns={2}>
      <ChartCard
        title="Funnel over time"
        description="Daily tracked views, qualified CTA exposure and later activation."
        note="The primary CTA and action match the ordered funnel above. Each step counts distinct tracked views."
      >
        <Plot
          rows={report.timeseries ?? []}
          series={[
            {key: 'views', label: 'Tracked views'},
            {key: 'exposed_views', label: 'Qualified exposure'},
            {key: 'ordered_activations', label: 'Later CTA activation'},
          ]}
          zoom
        />
      </ChartCard>
      <ChartCard
        title="Registered-element engagement"
        description="Compare distinct views exposed to and activating each registered element."
        note="Element activation counts can include actions before exposure; the ordered primary funnel applies its additional timing rule."
      >
        <Plot
          rows={report.elements.map((e: any) => ({
            name: e.id,
            exposure: e.exposed_views,
            activation: e.activated_views,
          }))}
          x="name"
          series={[
            {key: 'exposure', label: 'Exposed views'},
            {key: 'activation', label: 'Activated views'},
          ]}
          kind="bar"
          horizontal
        />
      </ChartCard>
    </CardGrid>
  );
}

export function DiagnosticCharts({report}: {report: any}) {
  const [kind, setKind] = useState<'line' | 'bar' | 'area'>('line'),
    [metric, setMetric] = useState('lcp_ms');
  if (!report || report.suppressed) return null;
  const names: Record<string, string> = {
    navigation_load_ms: 'Page load',
    fcp_ms: 'First contentful paint',
    lcp_ms: 'Largest contentful paint',
    interaction_latency_ms: 'Observed interaction latency',
  };
  const performance = (report.timeseries ?? []).map((p: ActivityPoint) => {
    const value = p.performance.find((v) => v.metric === metric);
    return {date: p.date, p50: value?.p50 ?? null, p75: value?.p75 ?? null, p95: value?.p95 ?? null};
  });
  return (
    <CardGrid columns={2}>
      <ChartCard
        title="Experience signals over time"
        description="Repeated-click clusters, possible no-response clicks and generic errors."
        tools={<StylePicker value={kind} onChange={setKind} />}
        note="Heuristic signals suggest investigations. Zero recorded signals does not prove absence of a problem or diagnostic coverage."
      >
        <Plot
          rows={report.timeseries ?? []}
          series={[
            {key: 'rage_clicks', label: 'Repeated-click clusters'},
            {key: 'dead_clicks', label: 'Possible no response'},
            {key: 'errors', label: 'Generic error signals'},
          ]}
          kind={kind}
          zoom
        />
      </ChartCard>
      <ChartCard
        title="Performance percentiles over time"
        description="Daily p50, p75 and p95 from observed per-view values."
        note="Unsupported metrics and days without timing samples stay unavailable. These measurements do not constitute standardized INP/CLS."
      >
        <div className="chart-controls">
          <FormField
            category="select"
            label="Timing metric"
            aria-label="Diagnostic timing metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            {Object.entries(names).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </FormField>
        </div>
        <Plot
          rows={performance}
          series={[
            {key: 'p50', label: 'p50'},
            {key: 'p75', label: 'p75'},
            {key: 'p95', label: 'p95', dashed: true},
          ]}
          unit="ms"
          zoom
        />
      </ChartCard>
    </CardGrid>
  );
}

export function QualityCharts({report}: {report: any}) {
  if (!report || report.suppressed) return null;
  const q = report.quality;
  const rows = [
    ['Mapped', 'mapped'],
    ['Incompatible layout', 'incompatible'],
    ['Unsupported geometry', 'unsupported'],
    ['Masked positions', 'masked'],
    ['Unregistered target', 'unregistered'],
  ].map(([name, key]) => ({name, clicks: q[key] ?? 0}));
  return (
    <CardGrid columns={2}>
      <ChartCard title="Click mapping coverage" description="Every observed click belongs to one mapping outcome.">
        <Plot
          rows={rows}
          x="name"
          series={[{key: 'clicks', label: 'Pointer clicks', color: 'var(--chart-2)'}]}
          kind="bar"
          horizontal
        />
      </ChartCard>
      <ChartCard
        title="Delivery and receipt signals"
        description="Client-reported drops and retries, plus retained events delayed over 60 seconds."
        note="Counters describe the selected views, including their other viewport segments. A client that never reconnects cannot report losses."
      >
        <Plot
          rows={report.timeseries ?? []}
          series={[
            {key: 'retry_attempts', label: 'Client retries'},
            {key: 'dropped_events', label: 'Client-reported drops'},
            {key: 'delayed_events', label: 'Delayed retained events'},
          ]}
          zoom
        />
      </ChartCard>
    </CardGrid>
  );
}

export function HeatmapCharts({report}: {report: any}) {
  if (!report || report.suppressed) return null;
  return (
    <CardGrid columns={2}>
      <ChartCard
        title="Scroll reach by depth"
        description="Viewport segments that reached each document depth."
        note="Reach is not proof of reading. The scroll map uses segments compatible with the selected reference layout."
      >
        <Plot
          rows={(report.scroll ?? []).map((p: any) => ({depth: p.depth + '%', reach: p.segments ? p.percent : null}))}
          x="depth"
          unit="%"
          series={[{key: 'reach', label: 'Segments reaching depth', color: 'var(--chart-3)'}]}
          kind="area"
        />
      </ChartCard>
      <ChartCard
        title="Activity over time"
        description="Tracked views and observed pointer clicks in this heatmap cohort."
      >
        <Plot
          rows={report.timeseries ?? []}
          series={[
            {key: 'views', label: 'Tracked views'},
            {key: 'clicks', label: 'Pointer clicks'},
          ]}
          zoom
        />
      </ChartCard>
    </CardGrid>
  );
}

export function ComparisonCharts({reports}: {reports: any[]}) {
  const [metric, setMetric] = useState('views');
  if (!reports.length) return null;
  const keys: Record<string, string> = {
    views: 'Tracked views',
    clicks: 'Pointer clicks',
    ordered_activations: 'Ordered CTA activations',
  };
  const eligible = reports.filter((r) => !r.suppressed),
    rows = new Map<string, Row>();
  eligible.forEach((r, i) =>
    (r.timeseries ?? []).forEach((p: ActivityPoint) => {
      const row = rows.get(p.date) ?? {date: p.date};
      row['cohort' + i] = p[metric as keyof ActivityPoint];
      rows.set(p.date, row);
    }),
  );
  return (
    <ChartCard
      title="Cohort comparison"
      description="One metric, shared date axis and independent page/revision cohorts."
      note="Different audiences and sample rates can limit comparisons. Observational differences do not establish causal uplift."
    >
      <div className="chart-controls">
        <FormField
          category="select"
          label="Comparison metric"
          aria-label="Comparison chart metric"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
        >
          {Object.entries(keys).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </FormField>
      </div>
      <Plot
        rows={[...rows.values()].sort((a, b) => a.date.localeCompare(b.date))}
        series={eligible.map((r, i) => ({
          key: 'cohort' + i,
          label: r.page.name + ' · ' + (r.selected_revision ?? r.page.revision),
          dashed: i === 1,
        }))}
        zoom
      />
    </ChartCard>
  );
}

export function OperationsCharts({data}: {data: any}) {
  if (!data) return null;
  return (
    <CardGrid columns={2}>
      <ChartCard title="Processing queue" description="Current durable jobs by state, including completed work.">
        <Plot
          rows={['pending', 'processing', 'failed', 'done'].map((state) => ({
            state,
            jobs: data.jobs.find((j: any) => j.state === state)?.count ?? 0,
          }))}
          x="state"
          series={[{key: 'jobs', label: 'Jobs', color: 'var(--chart-2)'}]}
          kind="bar"
        />
      </ChartCard>
      <ChartCard
        title="Service response outcomes"
        description="Requests and server errors since each local service process started."
        note="Separate replicas export their own telemetry. These counters are not visitor counts."
      >
        <Plot
          rows={data.telemetry.map((t: any) => ({
            service: t.service,
            success: Math.max(0, t.requests - t.errors),
            errors: t.errors,
          }))}
          x="service"
          series={[
            {key: 'success', label: 'Non-server-error responses', color: 'var(--chart-3)'},
            {key: 'errors', label: 'Server error responses', color: 'var(--chart-1)'},
          ]}
          kind="bar"
        />
      </ChartCard>
    </CardGrid>
  );
}

export function ActivityChart({rows}: {rows: Row[]}) {
  return <Plot rows={rows} series={[{key: 'views', label: 'Tracked views'}]} kind="bar" />;
}
