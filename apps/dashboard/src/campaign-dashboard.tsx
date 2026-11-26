import {Collapsible} from './components/collapsible.js';
import {Button} from './components/button.js';
import {invalidateQueries} from './query-cache.js';
import {Card, MetricCard, CardGrid} from './components/card.js';
import {FormField} from './components/form-field.js';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowRight, ArrowUpRight, Eye, MousePointer2, Target, RefreshCw, TriangleAlert} from 'lucide-react';
import {CampaignCharts} from './chart-loader.js';
import {MoreAnalysis} from './workspace-ui.js';
import {DataTable} from './data-table.js';

type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
const number = (n: number | undefined) => new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0}).format(n ?? 0);
const percent = (n: number | undefined) => (n ?? 0).toFixed(1) + '%';

export function CampaignDashboard({
  api,
  from,
  to,
  device,
  dataSource,
  campaign,
  reloadToken,
  onPage,
  scope,
}: {
  api: Api;
  scope?: {market: string; product: string; brand: string};
  from: string;
  to: string;
  device: string;
  dataSource: string;
  campaign: string;
  reloadToken: number;
  onPage: (value: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<{query: string; data: any} | null>(null),
    [error, setError] = useState(''),
    [tableSearch, setTableSearch] = useState('');
  const query = new URLSearchParams({
    from,
    to,
    device,
    data_source: dataSource,
    ...Object.fromEntries(Object.entries(scope ?? {}).filter(([, v]) => v)),
    ...(campaign ? {campaign} : {}),
  }).toString();
  const data = snapshot?.query === query ? snapshot.data : null;
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await api('/api/campaigns?' + query);
      if (version === requestVersion.current) {
        setSnapshot({query, data: next});
        setError('');
      }
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    }
  }, [api, query]);
  useEffect(() => {
    setSnapshot(null);
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      requestVersion.current++;
      clearInterval(timer);
    };
  }, [load, reloadToken]);
  const pages: any[] = data?.pages ?? [];
  const tablePages = pages.filter((p) =>
    (p.name + ' ' + p.site_name + ' ' + p.revision).toLowerCase().includes(tableSearch.toLowerCase()),
  );
  const eligible = pages.filter((p) => !p.suppressed);
  const exposed = eligible.reduce((sum, p) => sum + (p.funnel?.exposed_views ?? 0), 0);
  const activated = eligible.reduce((sum, p) => sum + (p.funnel?.ordered_activated_views ?? 0), 0);
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <CardGrid>
        <MetricCard
          label="Tracked page views"
          value={data ? number(data.totals.tracked_views) : '-'}
          detail="Consented views · not unique visitors"
          icon={Eye}
        />
        <MetricCard
          label="Pointer clicks"
          value={data ? number(data.totals.clicks) : '-'}
          detail="Across reportable landing pages"
          icon={MousePointer2}
        />
        <MetricCard
          label="CTA activation rate"
          value={data && exposed ? percent((100 * activated) / exposed) : '-'}
          detail={
            data ? `${number(activated)} activated / ${number(exposed)} exposed views` : 'Waiting for observations'
          }
          icon={Target}
        />
      </CardGrid>
      <CampaignCharts data={data} />
      <Card
        title="Landing page performance"
        description="Select a page to explore its heatmap."
        padding="none"
        actions={
          <FormField
            hideLabel
            label="Search landing pages"
            type="search"
            aria-label="Search campaign table"
            placeholder="Search landing pages…"
            value={tableSearch}
            maxLength={120}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        }
        footer={
          <>
            <span>
              {data
                ? `${number(data.totals.reportable_pages)} reportable pages · ${number(data.totals.suppressed_pages)} below reporting threshold`
                : 'Loading recorded counts'}
            </span>
            <Button
              variant="text"
              type="button"
              onClick={() => {
                invalidateQueries();
                void load();
              }}
            >
              <RefreshCw size={13} />
              Refresh
            </Button>
          </>
        }
      >
        <DataTable<any>
          name="Campaign performance"
          data={tablePages}
          rowId={(p) => p.site_id + '/' + p.page_key}
          initialSorting={[{id: 'views', desc: true}]}
          loading={!data && !error}
          error={error}
          onRetry={() => void load()}
          resetKey={query + '|' + tableSearch}
          renderExpanded={(p) => <CampaignPageDetails page={p} />}
          columns={[
            {
              id: 'name',
              label: 'LANDING PAGE',
              value: (p) => p.name,
              render: (p) => (
                <>
                  <Button variant="text" onClick={() => onPage(p.site_id + '/' + p.page_key)}>
                    {p.name}
                  </Button>
                  <small className="table-detail">
                    {p.site_name} · {p.revision}
                  </small>
                  {p.suppressed && <small className="table-detail">Below the {p.minimum_views}-view threshold</small>}
                </>
              ),
            },
            {
              id: 'views',
              label: 'VIEWS',
              value: (p) => (p.suppressed ? undefined : p.views),
              render: (p) => (p.suppressed ? '-' : number(p.views)),
            },
            {
              id: 'clicks',
              label: 'CLICKS',
              value: (p) => (p.suppressed ? undefined : p.clicks),
              render: (p) => (p.suppressed ? '-' : number(p.clicks)),
            },
            {
              id: 'activation',
              label: 'CTA ACTIVATION',
              value: (p) => (p.suppressed || !p.funnel.exposed_views ? undefined : p.funnel.ordered_activation_rate),
              render: (p) =>
                p.suppressed || !p.funnel.exposed_views ? (
                  '-'
                ) : (
                  <span
                    title={
                      p.funnel.ordered_activated_views + ' activated / ' + p.funnel.exposed_views + ' exposed views'
                    }
                  >
                    {percent(p.funnel.ordered_activation_rate)}
                  </span>
                ),
            },
            {
              id: 'reach',
              label: 'SCROLL REACH',
              value: (p) => (p.suppressed || !p.views ? undefined : p.avg_reach),
              render: (p) => (p.suppressed || !p.views ? '-' : percent(p.avg_reach)),
            },
            {
              id: 'actions',
              label: '',
              sortable: false,
              value: (p) => p.page_key,
              render: (p) => (
                <Button
                  variant="plain"
                  className="table-explore"
                  aria-label={'View heatmap for ' + p.name}
                  onClick={() => onPage(p.site_id + '/' + p.page_key)}
                >
                  <ArrowUpRight size={17} />
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <MoreAnalysis description="Device breakdown, CTA exposure and experience signals">
        <CampaignCharts data={data} variant="detail" />
        <Card title="Campaign detail" description="Exposure, experience signals and sampling by page." padding="none">
          <DataTable<any>
            name="Campaign detail"
            data={eligible}
            rowId={(p) => p.site_id + '/' + p.page_key}
            resetKey={query}
            renderExpanded={(p) => <CampaignPageDetails page={p} />}
            columns={[
              {id: 'name', label: 'LANDING PAGE', value: (p) => p.name},
              {
                id: 'exposure',
                label: 'CTA EXPOSURE',
                value: (p) => (p.views ? p.funnel.exposure_rate : undefined),
                render: (p) => (p.views ? percent(p.funnel.exposure_rate) : '-'),
              },
              {
                id: 'activation',
                label: 'ORDERED ACTIVATION',
                value: (p) => p.funnel.ordered_activated_views,
                render: (p) => p.funnel.ordered_activated_views + ' / ' + p.funnel.exposed_views,
              },
              {id: 'rage', label: 'REPEATED CLUSTERS', value: (p) => p.diagnostics.rage_clicks},
              {id: 'dead', label: 'NO-RESPONSE SIGNALS', value: (p) => p.diagnostics.dead_clicks},
              {
                id: 'sample',
                label: 'SAMPLE RATES',
                value: (p) => p.sample_rates?.join(','),
                render: (p) => p.sample_rates?.map((n: number) => percent(100 * n)).join(', ') || '-',
              },
            ]}
          />
        </Card>
      </MoreAnalysis>
      {!!data?.insights.length && (
        <Card title="Worth a closer look" padding="none">
          <div className="insight-list">
            {data.insights.map((item: any) => (
              <div key={item.site_id + item.page_key + item.code}>
                <TriangleAlert size={18} />
                <div>
                  <strong>
                    {data.pages.find((p: any) => p.site_id === item.site_id && p.page_key === item.page_key)?.name}
                  </strong>
                  <p>{item.message}</p>
                </div>
                <Button variant="text" onClick={() => onPage(item.site_id + '/' + item.page_key)}>
                  Inspect
                  <ArrowRight size={13} />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Collapsible title={<>How to read these numbers</>} className="report-method">
        <p>
          Tracked counts are unweighted and exclude suppressed cohorts. Different sample rates and audiences can limit
          comparisons. CTA activation means a primary action after qualified exposure; it does not establish a completed
          registration. Small cohorts are provisional. Diagnostic signals suggest investigation, and an empty shortlist
          does not establish the absence of problems.
        </p>
      </Collapsible>
    </>
  );
}

function CampaignPageDetails({page: p}: {page: any}) {
  if (p.suppressed)
    return (
      <p className="ui-card-detail">
        This page is below the {p.minimum_views}-view reporting threshold. Detailed observations are withheld.
      </p>
    );
  const value = (n: number | undefined) => (n == null ? 'Unavailable' : number(n));
  return (
    <div className="detail-grid">
      <section>
        <h3>CTA engagement</h3>
        <dl>
          <div>
            <dt>Qualified exposure</dt>
            <dd>{value(p.funnel?.exposed_views)} views</dd>
          </div>
          <div>
            <dt>Ordered activations</dt>
            <dd>{value(p.funnel?.ordered_activated_views)} views</dd>
          </div>
          <div>
            <dt>Exposure rate</dt>
            <dd>{p.views && p.funnel?.exposure_rate != null ? percent(p.funnel.exposure_rate) : 'Unavailable'}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Experience signals</h3>
        <dl>
          <div>
            <dt>Repeated-click clusters</dt>
            <dd>{value(p.diagnostics?.rage_clicks)}</dd>
          </div>
          <div>
            <dt>Possible no response</dt>
            <dd>{value(p.diagnostics?.dead_clicks)}</dd>
          </div>
          <div>
            <dt>Generic errors</dt>
            <dd>
              {p.diagnostics
                ? value((p.diagnostics.runtime_errors ?? 0) + (p.diagnostics.unhandled_rejections ?? 0))
                : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Collection context</h3>
        <dl>
          <div>
            <dt>Revision</dt>
            <dd>{p.revision || 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Sample rates</dt>
            <dd>
              {p.sample_rates?.length
                ? p.sample_rates.map((rate: number) => percent(rate * 100)).join(', ')
                : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt>Device segments</dt>
            <dd>
              {p.devices?.length
                ? p.devices.map((d: any) => d.device + ': ' + number(d.segments)).join(' · ')
                : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
