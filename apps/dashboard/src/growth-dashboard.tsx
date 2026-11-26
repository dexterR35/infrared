import {MetricCard} from './components/card.js';
import {Collapsible} from './components/collapsible.js';
import {Card} from './components/card.js';
import {Button} from './components/button.js';
import {FilterFields} from './components/filter-bar.js';
import {FormField} from './components/form-field.js';
import {useEffect, useState} from 'react';
import {ArrowUpRight, Check, Download, FlaskConical, KeyRound, Plus, RefreshCw, Upload} from 'lucide-react';
import {selectorURL} from '../../../packages/domain/matcher.js';
import {marketForHost} from '../../../packages/domain/market-defaults.js';
import {DataTable} from './data-table.js';
import './growth.css';
import {ExperimentBehavior} from './experiment-behavior.js';
import {useInstallationChecks, InstallationStatus, InstallationCheckButton} from './installation-status.js';
type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
export type GrowthScope = {site_id?: string; market: string; product: string; brand: string};
const n = (v: number | undefined) => (v === undefined ? '-' : v.toLocaleString('en-GB')),
  rate = (v: number | undefined) => (v === undefined ? '-' : v.toFixed(1) + '%');
const readable = (s: string) => s.toLowerCase().replaceAll('_', ' ');
const editable = (role: string) => ['owner', 'administrator'].includes(role);
function useQuery(api: Api, url: string | null, refresh: number) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    if (url)
      api(url)
        .then((r) => {
          if (live) setData(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [api, url, refresh]);
  return {data, error};
}
export function ScopeFilters({
  pages,
  sites,
  value,
  onChange,
}: {
  pages: any[];
  sites: any[];
  value: GrowthScope;
  onChange: (v: GrowthScope) => void;
}) {
  const choices = {
    market: [
      ...new Set(pages.map((p) => p.market ?? sites.find((s) => s.id === p.site_id)?.market ?? 'unknown')),
    ].sort(),
    product: [...new Set(pages.map((p) => p.product))].sort(),
    brand: [...new Set(sites.map((s) => s.brand ?? 'default'))].sort(),
  };
  return (
    <FilterFields>
      {(['market', 'product', 'brand'] as const).map((k) => (
        <FormField
          key={k}
          category="select"
          label={k[0].toUpperCase() + k.slice(1)}
          aria-label={`Portfolio ${k}`}
          value={value[k]}
          onChange={(e) => onChange({...value, [k]: e.target.value})}
        >
          <option value="">All {k === 'product' ? 'products' : k === 'brand' ? 'brands' : 'markets'}</option>
          {choices[k].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </FormField>
      ))}
    </FilterFields>
  );
}
export function scopePages(pages: any[], sites: any[], scope: GrowthScope) {
  return pages.filter(
    (p) =>
      (!scope.site_id || p.site_id === scope.site_id) &&
      (!scope.market || (p.market ?? sites.find((s) => s.id === p.site_id)?.market ?? 'unknown') === scope.market) &&
      (!scope.product || p.product === scope.product) &&
      (!scope.brand || (sites.find((s) => s.id === p.site_id)?.brand ?? 'default') === scope.brand),
  );
}
// The import example follows the selected project: its website, market, currency and time zone.
function importExample(site: any) {
  let host = '';
  try {
    host = new URL(site?.origin).hostname;
  } catch {}
  const d = marketForHost(host),
    whole = site?.collection_mode === 'whole_site';
  return {
    name: 'Collection',
    page_key: whole ? 'p.collection' : 'collection',
    url: (site?.origin ?? 'https://www.example.com') + '/collection/',
    market: site?.market ?? d?.market ?? 'unknown',
    product: 'website',
    brand: site?.brand ?? 'default',
    locale: whole ? 'auto' : (d?.locale ?? 'auto'),
    currency: site?.currency && site.currency !== 'XXX' ? site.currency : (d?.currency ?? 'XXX'),
    report_timezone:
      site?.report_timezone && site.report_timezone !== 'UTC' ? site.report_timezone : (d?.report_timezone ?? 'UTC'),
    page_family: 'unassigned',
    acquisition_goal: 'registration_completed',
  };
}
function ProjectMarketSettings({
  api,
  site,
  role,
  onSaved,
}: {
  api: Api;
  site: any;
  role: string;
  onSaved: () => Promise<void>;
}) {
  let host = '';
  try {
    host = new URL(site.origin).hostname;
  } catch {}
  const d = marketForHost(host);
  const [market, setMarket] = useState(site.market ?? d?.market ?? ''),
    [currency, setCurrency] = useState(site.currency && site.currency !== 'XXX' ? site.currency : (d?.currency ?? '')),
    [timezone, setTimezone] = useState(
      site.report_timezone && site.report_timezone !== 'UTC' ? site.report_timezone : (d?.report_timezone ?? 'UTC'),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const unset = !site.market || site.currency === 'XXX';
  async function save() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const r = await api(
        `/api/projects/${encodeURIComponent(site.id)}/market`,
        {market: market.trim(), currency: currency.trim().toUpperCase(), report_timezone: timezone.trim()},
        'PATCH',
      );
      await onSaved();
      setDone(`Saved. ${r.pages_updated} page${r.pages_updated === 1 ? '' : 's'} updated.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card padding="normal">
      <div className="growth-heading">
        <div>
          <h2>Project market · {site.name}</h2>
          <p>
            One market, currency and report time zone for this website. Saving updates the project and every one of its
            pages; acquisition, spend and experiments use these values.
          </p>
        </div>
      </div>
      {unset && (
        <div className={'growth-status warn'}>
          This project has no market or currency yet
          {d ? ` - suggested from ${host}: ${d.market} · ${d.currency} · ${d.report_timezone}` : ''}. Save to apply.
        </div>
      )}
      <div className="growth-form">
        <FormField
          label={<>Market</>}
          aria-label="Project market"
          value={market}
          disabled={!editable(role)}
          onChange={(e) => setMarket(e.target.value)}
          maxLength={64}
          placeholder="RO"
        />
        <FormField
          label={<>Currency</>}
          aria-label="Project currency"
          value={currency}
          disabled={!editable(role)}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          placeholder="RON"
        />
        <FormField
          label={<>Report time zone</>}
          aria-label="Project time zone"
          value={timezone}
          disabled={!editable(role)}
          onChange={(e) => setTimezone(e.target.value)}
          maxLength={64}
          placeholder="Europe/Bucharest"
        />
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error.replaceAll('_', ' ').toLowerCase()}
        </div>
      )}
      {done && <div className="growth-status good">{done}</div>}
      {editable(role) && (
        <div className="growth-actions">
          <Button
            variant="primary"
            disabled={
              busy ||
              !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(market.trim()) ||
              !/^[A-Z]{3}$/.test(currency.trim().toUpperCase()) ||
              !timezone.trim()
            }
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Apply to all project pages'}
          </Button>
        </div>
      )}
    </Card>
  );
}
export function MarketRegistry({
  api,
  pages,
  sites,
  role,
  onSaved,
  onPage,
  refresh = 0,
}: {
  refresh?: number;
  api: Api;
  pages: any[];
  sites: any[];
  role: string;
  onSaved: () => Promise<void>;
  onPage: (s: string) => void;
}) {
  const checks = useInstallationChecks(api, refresh + pages.length);
  const [text, setText] = useState(() => JSON.stringify([importExample(sites[0])], null, 2)),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(dry: boolean) {
    setBusy(true);
    setError('');
    try {
      const parsed = JSON.parse(text),
        rows = Array.isArray(parsed) ? parsed : parsed.rows;
      const result = await api('/api/registry/import', {dry_run: dry, rows});
      setPreview(result);
      if (result.applied) await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(p: any) {
    const s = sites.find((s) => s.id === p.site_id);
    setText(
      JSON.stringify(
        [
          {
            name: p.name,
            page_key: p.page_key,
            url: selectorURL(p.selector),
            market: p.market ?? s?.market ?? 'unknown',
            product: p.product,
            brand: s?.brand ?? 'default',
            locale: p.locale,
            currency: s?.currency ?? 'XXX',
            report_timezone: s?.report_timezone ?? 'UTC',
            page_family: p.page_family ?? 'unassigned',
            acquisition_goal: p.acquisition_goal ?? 'registration_completed',
          },
        ],
        null,
        2,
      ),
    );
    setPreview(null);
  }
  return (
    <div className="growth-stack">
      {sites[0] && (
        <ProjectMarketSettings
          key={sites[0].id + '/' + (sites[0].config_version ?? 0)}
          api={api}
          site={sites[0]}
          role={role}
          onSaved={onSaved}
        />
      )}
      <Card padding="normal">
        <div className="pa-el-header">
          <div>
            <h2>Markets & page families</h2>
            <p>
              Website page definitions and custom product labels. A registry entry does not mean tracking is installed.
            </p>
          </div>
          {['owner', 'administrator', 'analyst'].includes(role) && (
            <a className="btn" href={'/api/registry/export?' + new URLSearchParams({site_id: sites[0]?.id ?? ''})}>
              <Download size={15} /> Export registry
            </a>
          )}
        </div>
        <div className="registry-draft-note">
          Real-site entries are drafts with collection disabled. Verify the link, pixel and received events before
          treating a page as connected. Report date boundaries currently use UTC for every market; the configured market
          timezone does not shift those dates.
        </div>
        {checks.error && (
          <div className="notice error" role="alert">
            {checks.error}
          </div>
        )}
        <DataTable<any>
          name="Market landing pages"
          data={pages.map((p) => ({...p, site: sites.find((s) => s.id === p.site_id)}))}
          rowId={(p) => p.site_id + '/' + p.page_key}
          columns={[
            {
              id: 'page',
              label: 'LANDING PAGE',
              value: (p) => p.name,
              render: (p) => (
                <Button variant="text" onClick={() => onPage(p.site_id + '/' + p.page_key)}>
                  {p.name}
                  <ArrowUpRight size={13} />
                </Button>
              ),
            },
            {
              id: 'installation',
              label: 'LINK / PIXEL / ACTIVITY',
              value: (p) => checks.find(p)?.collection ?? 'unchecked',
              render: (p) => <InstallationStatus status={checks.find(p)} />,
            },
            {
              id: 'check',
              label: 'VERIFY',
              sortable: false,
              value: (p) => p.page_key,
              render: (p) => <InstallationCheckButton page={p} checks={checks} role={role} />,
            },
            {id: 'market', label: 'MARKET', value: (p) => p.market ?? p.site?.market ?? 'unknown'},
            {id: 'product', label: 'PRODUCT', value: (p) => p.product},
            {id: 'origin', label: 'WEBSITE', value: (p) => p.site?.origin},
            {id: 'timezone', label: 'CONFIGURED TIME ZONE', value: (p) => p.site?.report_timezone ?? 'UTC'},
            {id: 'family', label: 'PAGE FAMILY', value: (p) => p.page_family},
            {id: 'goal', label: 'ACQUISITION GOAL', value: (p) => readable(p.acquisition_goal)},
            {
              id: 'edit',
              label: '',
              sortable: false,
              value: (p) => p.page_key,
              render: (p) =>
                editable(role) ? (
                  <Button variant="secondary" onClick={() => edit(p)}>
                    Edit details
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      {editable(role) && (
        <Card padding="normal">
          <div className="growth-heading">
            <div>
              <h2>Import or update landing pages</h2>
              <p>
                Paste registry JSON or load a file. Validate the exact URLs and changes, then apply the reviewed batch.
              </p>
            </div>
            <FormField
              label={
                <>
                  <Upload size={15} /> Load JSON
                </>
              }
              aria-label="Import registry JSON file"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 30000) {
                    setError('Registry files must be under 30 KB.');
                    return;
                  }
                  setText(await file.text());
                  setPreview(null);
                }
              }}
            />
          </div>
          <FormField
            category="textarea"
            label={
              <>
                <span className="growth-kicker">Registry rows · JSON</span>
              </>
            }
            aria-label="Registry import JSON"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            spellCheck={false}
          />
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {preview && (
            <>
              <div className={'growth-status ' + (preview.applied ? 'good' : preview.errors.length ? 'warn' : '')}>
                {preview.applied
                  ? 'Registry updated. New real-site pages remain disabled.'
                  : preview.errors.length
                    ? `${preview.errors.length} row errors. No changes were applied.`
                    : `${preview.plan.length} changes validated. Ready to apply.`}
              </div>
              {preview.errors.map((e: any) => (
                <p key={e.row}>
                  Row {e.row}: {readable(e.code)}
                </p>
              ))}
              <DataTable<any>
                name="Registry import preview"
                data={preview.plan}
                rowId={(r) => String(r.row)}
                columns={[
                  {id: 'row', label: 'ROW', value: (r) => r.row},
                  {id: 'action', label: 'ACTION', value: (r) => r.action},
                  {id: 'page', label: 'PAGE KEY', value: (r) => r.page_key},
                  {id: 'origin', label: 'WEBSITE', value: (r) => r.origin},
                ]}
              />
            </>
          )}
          <div className="growth-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void run(true)}>
              <Check size={15} /> Validate import
            </Button>
            <Button
              variant="primary"
              disabled={busy || !preview?.dry_run || preview.errors.length > 0}
              onClick={() => void run(false)}
            >
              {busy ? 'Working…' : 'Apply validated changes'}
            </Button>
          </div>
          <p className="growth-section-note">
            Each exact origin, path and lp value identifies a page. Imports are transactional. Active experiments lock
            their page metadata. Live installation and collection require a separately verified release.
          </p>
        </Card>
      )}
    </div>
  );
}
function IntegrationKeys({api, sites, role, refresh}: {api: Api; sites: any[]; role: string; refresh: number}) {
  const [site, setSite] = useState(sites[0]?.id ?? ''),
    [counter, setCounter] = useState(0),
    [secret, setSecret] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const {data, error: loadError} = useQuery(
    api,
    editable(role) && site ? `/api/sites/${encodeURIComponent(site)}/acquisition-keys` : null,
    refresh + counter,
  );
  useEffect(() => setSecret(''), [site]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/api/sites/${encodeURIComponent(site)}/acquisition-keys`, {
        name: 'Acquisition host integration',
      });
      setSecret(r.key);
      setCounter((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!editable(role)) return null;
  return (
    <Collapsible
      title={
        <>
          <KeyRound size={16} /> Connect backend acquisition data
        </>
      }
      className="growth-integration"
    >
      <p>
        Create a site-scoped backend key, then send visit, rendered-variant and completed-outcome events. Keys stay on
        the host server.
      </p>
      <FormField
        category="select"
        label={<>Website</>}
        aria-label="Integration website"
        value={site}
        onChange={(e) => setSite(e.target.value)}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.environment}
          </option>
        ))}
      </FormField>
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      {secret && (
        <div className="growth-status warn">
          <strong>Copy this key now. It is shown once.</strong>
          <div className="key-secret">{secret}</div>
          <Button variant="secondary" onClick={() => setSecret('')}>
            Hide key
          </Button>
        </div>
      )}
      <div className="growth-actions">
        <Button variant="secondary" disabled={!site || busy} onClick={() => void create()}>
          Create backend key
        </Button>
      </div>
      {data?.keys.map((k: any) => (
        <div className="key-row" key={k.id}>
          <div>
            <strong>{k.name}</strong>
            <small> · {k.revoked_at ? 'Revoked' : 'Active'}</small>
          </div>
          {!k.revoked_at && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await api(`/api/acquisition-keys/${k.id}/revoke`, {});
                  setCounter((v) => v + 1);
                  setSecret('');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      <ol className="growth-plan">
        <li>Register a consented, eligible visit with a stable, random site-scoped unit token.</li>
        <li>
          For A/B tests, use the assigned variant before rendering. Keep assignment stable in the host integration.
        </li>
        <li>
          Report the variant actually rendered. Pass the returned visit ID as <code>acquisitionId</code> to the heatmap
          host bridge.
        </li>
        <li>Send backend-confirmed registration and qualified-acquisition events with retry-safe event IDs.</li>
      </ol>
      <pre>{`POST /v1/acquisition/visits\nPOST /v1/acquisition/rendered\nPOST /v1/acquisition/outcomes\nPOST /v1/acquisition/withdraw\n\nHeader: X-Acquisition-Key: <backend secret>\nCollector: http://127.0.0.1:8080\n\nEnable collection for this project and use its public HTTPS collector endpoint.`}</pre>
    </Collapsible>
  );
}
export function AcquisitionDashboard({
  api,
  pages,
  sites,
  role,
  from,
  to,
  onFrom,
  onTo,
  dataSource,
  scope,
  refresh,
}: {
  api: Api;
  pages: any[];
  sites: any[];
  role: string;
  from: string;
  to: string;
  onFrom: (s: string) => void;
  onTo: (s: string) => void;
  dataSource: string;
  scope: GrowthScope;
  refresh: number;
}) {
  const [website, setWebsite] = useState(scope.site_id ?? ''),
    [device, setDevice] = useState('all'),
    [count, setCount] = useState(0),
    [error, setError] = useState(''),
    [spendPage, setSpendPage] = useState(pages[0] ? pages[0].site_id + '/' + pages[0].page_key : ''),
    [campaign, setCampaign] = useState('unknown'),
    [day, setDay] = useState(to),
    [amount, setAmount] = useState(''),
    [coverage, setCoverage] = useState(false),
    [busy, setBusy] = useState(false);
  const params = new URLSearchParams({
    from,
    to,
    data_source: dataSource,
    device,
    ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v)),
    ...(website ? {site_id: website} : {}),
  });
  const {data, error: loadError} = useQuery(
    api,
    dataSource === 'legacy' ? null : '/api/acquisition?' + params,
    refresh + count,
  );
  const rows: any[] = data?.rows.filter((r: any) => !r.suppressed) ?? [],
    units = rows.reduce((s, r) => s + r.measured_units, 0),
    registrations = rows.reduce((s, r) => s + r.registrations, 0),
    qualified = rows.reduce((s, r) => s + r.qualified_acquisitions, 0);
  const current = pages.find((p) => p.site_id + '/' + p.page_key === spendPage),
    currency = sites.find((s) => s.id === current?.site_id)?.currency ?? 'XXX';
  async function saveSpend() {
    setBusy(true);
    setError('');
    try {
      if (!Number.isFinite(Number(amount)) || Number(amount) < 0 || !amount.trim())
        throw new Error('Enter a valid spend amount.');
      await api('/api/acquisition/spend', {
        site_id: current.site_id,
        page_key: current.page_key,
        campaign,
        day,
        currency,
        amount_micros: Math.round(Number(amount) * 1e6),
        coverage_confirmed: coverage,
      });
      setCount((c) => c + 1);
      setAmount('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="growth-stack">
      <div className="growth-scope">
        <FormField
          category="select"
          label={<>Website</>}
          aria-label="Acquisition website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        >
          <option value="">Current project</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </FormField>
        <FormField
          category="select"
          label={<>Device</>}
          aria-label="Acquisition device"
          value={device}
          onChange={(e) => setDevice(e.target.value)}
        >
          {['all', 'desktop', 'tablet', 'mobile'].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </FormField>
        <FormField
          label={<>From · UTC</>}
          aria-label="Acquisition from date"
          type="date"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
        <FormField
          label={<>Through · UTC</>}
          aria-label="Acquisition through date"
          type="date"
          value={to}
          onChange={(e) => onTo(e.target.value)}
        />
      </div>
      {(loadError || error) && (
        <div className="notice error" role="alert">
          {loadError || error}
        </div>
      )}
      {dataSource === 'legacy' ? (
        <div className="growth-empty">
          Legacy heatmap data has no acquisition ledger. Choose Recorded activity or Sample data.
        </div>
      ) : (
        <>
          <CardGrid>
            {[
              ['Measured units', units, 'Deduplicated within each page cohort'],
              ['Completed registrations', registrations, 'Backend-confirmed outcomes'],
              ['Qualified acquisitions', qualified, 'Your downstream acquisition goal'],
            ].map(([label, value, note]) => (
              <MetricCard
                key={String(label)}
                label={String(label)}
                value={data ? n(value as number) : '-'}
                detail={String(note)}
              />
            ))}
          </CardGrid>
          <p className="growth-filter-note">
            Portfolio sums describe page cohorts; the same person may occur on more than one page. This ledger is
            separate from sampled heatmap views.
          </p>
          {data && !data.rows.length && (
            <div className="growth-empty">
              <h3>No acquisition outcomes yet</h3>
              <p>Connect this project’s backend integration below to record completed outcomes.</p>
            </div>
          )}
          <Card
            padding="none"
            title={<>Acquisition by market & landing page</>}
            description={<>Counts, conversion rates and acquisition cost under one consistent scope.</>}
          >
            <DataTable<any>
              name="Acquisition performance"
              data={data?.rows ?? []}
              rowId={(r) => JSON.stringify([r.site_id, r.page_key, r.campaign, r.market, r.currency])}
              columns={[
                {id: 'page', label: 'LANDING PAGE', value: (r) => r.name},
                {id: 'market', label: 'MARKET', value: (r) => r.market},
                {id: 'product', label: 'PRODUCT', value: (r) => r.product},
                {id: 'campaign', label: 'CAMPAIGN', value: (r) => r.campaign},
                {
                  id: 'units',
                  label: 'MEASURED UNITS',
                  value: (r) => r.measured_units,
                  render: (r) => (r.suppressed ? 'Suppressed' : n(r.measured_units)),
                },
                {id: 'registration', label: 'REGISTRATIONS', value: (r) => r.registrations},
                {id: 'qualified', label: 'ACQUISITIONS', value: (r) => r.qualified_acquisitions},
                {
                  id: 'rate',
                  label: 'ACQUISITION RATE',
                  value: (r) => r.acquisition_rate,
                  render: (r) => rate(r.acquisition_rate),
                },
                {id: 'pending', label: 'OPEN WINDOWS', value: (r) => r.pending},
                {
                  id: 'cpa',
                  label: 'COST / ACQUISITION',
                  value: (r) => r.cost_per_acquisition,
                  render: (r) =>
                    r.cost_per_acquisition === null || r.suppressed ? (
                      <span title={r.cost_blockers?.map(readable).join(', ')}>Unavailable</span>
                    ) : (
                      new Intl.NumberFormat('en-GB', {style: 'currency', currency: r.currency}).format(
                        r.cost_per_acquisition,
                      )
                    ),
                },
              ]}
            />
          </Card>
          <p className="growth-section-note">{data?.definition}</p>
        </>
      )}
      {editable(role) && (
        <Collapsible title={<>Reconcile campaign spend</>}>
          <p>
            Enter the total daily spend for the matching page and campaign. Re-entering a day updates its total.
            Currency comes from the website registry.
          </p>
          <div className="growth-form">
            <FormField
              category="select"
              label={<>Landing page</>}
              aria-label="Spend landing page"
              value={spendPage}
              onChange={(e) => {
                setSpendPage(e.target.value);
                setCampaign('unknown');
              }}
            >
              {pages.map((p) => (
                <option key={p.site_id + p.page_key} value={p.site_id + '/' + p.page_key}>
                  {p.name}
                </option>
              ))}
            </FormField>
            <FormField
              category="select"
              label={<>Approved campaign</>}
              aria-label="Spend campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
            >
              {(current?.campaign_codes ?? ['unknown']).map((c: string) => (
                <option key={c}>{c}</option>
              ))}
            </FormField>
            <FormField
              label={<>Day · UTC</>}
              aria-label="Spend date"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
            <FormField
              label={<>Total spend · {currency}</>}
              aria-label="Daily spend amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <FormField
              label={
                <>
                  This spend and the acquisition ledger cover the same eligible traffic and attribution scope. Outcomes
                  are reconciled with the backend.
                </>
              }
              type="checkbox"
              checked={coverage}
              onChange={(e) => setCoverage(e.target.checked)}
            />
          </div>
          <div className="growth-actions">
            <Button
              variant="primary"
              disabled={busy || !current || currency === 'XXX' || dataSource !== 'recorded'}
              onClick={() => void saveSpend()}
            >
              Save daily spend
            </Button>
          </div>
          <p className="growth-section-note">
            Cost is unavailable until every day is supplied, outcome coverage is confirmed and attribution windows
            close. Device-filtered cost is unavailable because spend is not allocated by device. Set an actual currency
            in Markets before entering spend.
          </p>
          {data?.spend_rows.length > 0 && (
            <DataTable<any>
              name="Daily campaign spend"
              data={data.spend_rows}
              rowId={(r) => r.id}
              columns={[
                {id: 'day', label: 'UTC DAY', value: (r) => String(r.day).slice(0, 10)},
                {id: 'page', label: 'PAGE', value: (r) => r.page_key},
                {id: 'campaign', label: 'CAMPAIGN', value: (r) => r.campaign},
                {
                  id: 'amount',
                  label: 'SPEND',
                  value: (r) => r.amount_micros / 1e6,
                  render: (r) => `${(r.amount_micros / 1e6).toFixed(2)} ${r.currency}`,
                },
                {id: 'coverage', label: 'RECONCILED', value: (r) => (r.coverage_confirmed ? 'Yes' : 'No')},
              ]}
            />
          )}
        </Collapsible>
      )}
      <IntegrationKeys api={api} sites={sites} role={role} refresh={refresh} />
    </div>
  );
}
function Arm({label, arm}: {label: string; arm: any}) {
  return (
    <div className="experiment-arm">
      <span className="growth-kicker">{label}</span>
      <h3>{arm.variant}</h3>
      <div className="rate">{arm.mature ? rate((100 * arm.successes) / arm.mature) : '-'}</div>
      <dl>
        <dt>Assigned units</dt>
        <dd>{n(arm.assigned)}</dd>
        <dt>Rendered correctly</dt>
        <dd>{n(arm.rendered)}</dd>
        <dt>Matured units</dt>
        <dd>{n(arm.mature)}</dd>
        <dt>Primary conversions</dt>
        <dd>{n(arm.successes)}</dd>
      </dl>
    </div>
  );
}
export function ExperimentsDashboard({
  api,
  pages,
  role,
  dataSource,
  scope,
  refresh,
  onChanged,
}: {
  api: Api;
  pages: any[];
  role: string;
  dataSource: string;
  scope: GrowthScope;
  refresh: number;
  onChanged: () => Promise<void>;
}) {
  const [counter, setCounter] = useState(0),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [showForm, setShowForm] = useState(false),
    [pageId, setPageId] = useState(pages[0] ? pages[0].site_id + '/' + pages[0].page_key : ''),
    [name, setName] = useState(''),
    [kind, setKind] = useState('aa'),
    [metric, setMetric] = useState('registration_completed'),
    [baseline, setBaseline] = useState('5'),
    [mde, setMde] = useState('20'),
    [days, setDays] = useState('14'),
    [hours, setHours] = useState('24'),
    [control, setControl] = useState('control'),
    [treatment, setTreatment] = useState(() => 'treatment-' + Date.now().toString(36));
  const {data, error: listError} = useQuery(api, '/api/experiments', counter + refresh);
  const experiments: any[] = (data?.experiments ?? []).filter((e: any) =>
    Object.entries(scope).every(([k, v]) => !v || (k === 'site_id' ? e.site_id === v : e.context[k] === v)),
  );
  const chosen = experiments.find((e) => e.id === selected);
  const {data: readout, error: readoutError} = useQuery(
    api,
    chosen && dataSource !== 'legacy' ? `/api/experiments/${chosen.id}/readout?data_source=${dataSource}` : null,
    counter + refresh,
  );
  useEffect(() => {
    if (data && !experiments.some((e) => e.id === selected)) setSelected(experiments[0]?.id ?? '');
  }, [data, scope.market, scope.product, scope.brand]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
      setCounter((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    const [site_id, page_key] = pageId.split('/');
    await action(async () => {
      const e = await api('/api/experiments', {
        site_id,
        page_key,
        name,
        kind,
        primary_metric: metric,
        control_variant: control,
        treatment_variant: treatment,
        baseline_rate: Number(baseline) / 100,
        mde_relative: Number(mde) / 100,
        minimum_days: Number(days),
        attribution_hours: Number(hours),
      });
      setSelected(e.id);
      setShowForm(false);
      setName('');
      setTreatment('treatment-' + Date.now().toString(36));
    });
  }
  return (
    <div className="growth-stack">
      <Card padding="normal">
        <div className="growth-heading">
          <div>
            <h2>Experiment portfolio</h2>
            <p>Randomized acquisition tests with a stable assignment and a prespecified decision rule.</p>
          </div>
          {editable(role) && (
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> New experiment
            </Button>
          )}
        </div>
        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="growth-form">
              <FormField
                label={<>Experiment name</>}
                aria-label="Experiment name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <FormField
                category="select"
                label={<>Landing page</>}
                aria-label="Experiment landing page"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
              >
                {pages.map((p) => (
                  <option key={p.site_id + p.page_key} value={p.site_id + '/' + p.page_key}>
                    {p.name} · {p.market ?? 'unassigned market'}
                  </option>
                ))}
              </FormField>
              <FormField
                category="select"
                label={<>Test type</>}
                aria-label="Experiment type"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="aa">A/A · validate the measurement</option>
                <option value="ab">A/B · compare two experiences</option>
              </FormField>
              <FormField
                category="select"
                label={<>Primary acquisition metric</>}
                aria-label="Experiment primary metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                <option value="registration_completed">Completed registration</option>
                <option value="qualified_acquisition">Qualified acquisition</option>
              </FormField>
              <FormField
                label={<>Expected baseline rate · %</>}
                aria-label="Experiment baseline percent"
                type="number"
                min="0.01"
                max="99"
                step="0.01"
                required
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              />
              <FormField
                label={<>Minimum detectable relative improvement · %</>}
                aria-label="Experiment relative improvement percent"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                required
                value={mde}
                onChange={(e) => setMde(e.target.value)}
              />
              <FormField
                label={<>Minimum active duration · days</>}
                aria-label="Experiment minimum days"
                type="number"
                min="1"
                max="90"
                required
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
              <FormField
                label={<>Attribution window · hours</>}
                aria-label="Experiment attribution hours"
                type="number"
                min="1"
                max="720"
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
              <FormField
                label={<>Control variant code</>}
                aria-label="Control variant code"
                required
                value={control}
                onChange={(e) => setControl(e.target.value)}
              />
              <FormField
                label={<>Treatment variant code</>}
                aria-label="Treatment variant code"
                required
                value={treatment}
                onChange={(e) => setTreatment(e.target.value)}
              />
            </div>
            <p className="growth-section-note">
              The power plan uses a two-sided 5% significance level, 80% power and 50/50 allocation. A/A variants must
              render the same content in the host. Page context is frozen when the draft is created.
            </p>
            <div className="growth-actions">
              <Button variant="primary" disabled={busy || !pageId} type="submit">
                Create experiment draft
              </Button>
            </div>
          </form>
        )}
      </Card>
      {(error || listError || readoutError) && (
        <div className="notice error" role="alert">
          {error || listError || readoutError}
        </div>
      )}
      {!experiments.length && !showForm && (
        <div className="growth-empty">
          <FlaskConical size={26} />
          <h3>Start with an A/A test</h3>
          <p>Validate assignment, rendering and backend conversion tracking before evaluating page changes.</p>
        </div>
      )}
      {experiments.length > 0 && (
        <Card padding="normal">
          <DataTable<any>
            name="Experiments"
            data={experiments}
            rowId={(e) => e.id}
            columns={[
              {
                id: 'name',
                label: 'EXPERIMENT',
                value: (e) => e.name,
                render: (e) => (
                  <Button variant="text" onClick={() => setSelected(e.id)}>
                    {e.name}
                    <ArrowUpRight size={13} />
                  </Button>
                ),
              },
              {id: 'market', label: 'MARKET', value: (e) => e.context.market},
              {id: 'product', label: 'PRODUCT', value: (e) => e.context.product},
              {id: 'type', label: 'TYPE', value: (e) => e.kind.toUpperCase()},
              {id: 'status', label: 'STATUS', value: (e) => e.status},
              {id: 'goal', label: 'PRIMARY METRIC', value: (e) => readable(e.primary_metric)},
              {id: 'sample', label: 'REQUIRED / ARM', value: (e) => e.required_per_arm},
            ]}
          />
        </Card>
      )}
      {chosen && (
        <Card padding="normal" aria-label="Experiment readout">
          <div className="growth-heading">
            <div>
              <span className="growth-kicker">
                {chosen.kind.toUpperCase()} · {chosen.context.market} · {chosen.context.product}
              </span>
              <h2>{chosen.name}</h2>
              <p>
                {readable(chosen.primary_metric)} · {chosen.required_per_arm.toLocaleString()} matured units per arm ·{' '}
                {chosen.minimum_days} active days · {chosen.attribution_hours}h attribution
              </p>
            </div>
            <span className="badge">{chosen.status}</span>
          </div>
          {editable(role) && (
            <div className="growth-actions">
              {['draft', 'paused'].includes(chosen.status) && (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void action(() => api(`/api/experiments/${chosen.id}/state`, {status: 'running'}))}
                >
                  {chosen.status === 'draft' ? 'Start experiment' : 'Resume assignments'}
                </Button>
              )}
              {chosen.status === 'running' && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void action(() => api(`/api/experiments/${chosen.id}/state`, {status: 'paused'}))}
                >
                  Pause assignments
                </Button>
              )}
              {['running', 'paused'].includes(chosen.status) && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void action(() => api(`/api/experiments/${chosen.id}/state`, {status: 'completed'}))}
                >
                  Close assignments
                </Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={() => setCounter((c) => c + 1)}>
                <RefreshCw size={15} /> Refresh readout
              </Button>
            </div>
          )}
          {readout?.ready && !chosen.readout_frozen && editable(role) && dataSource === 'recorded' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void action(() => api(`/api/experiments/${chosen.id}/freeze`, {}))}
            >
              Freeze final readout
            </Button>
          )}
          {dataSource === 'legacy' ? (
            <div className="growth-empty">Legacy heatmap data cannot be used as a randomized experiment.</div>
          ) : readout?.suppressed ? (
            <div className="growth-status">Below the reporting threshold.</div>
          ) : (
            readout && (
              <>
                <div className={'growth-status ' + (readout.ready ? 'good' : 'warn')}>
                  <strong>{readable(readout.decision)}</strong>
                  <p>
                    {dataSource === 'seeded'
                      ? 'Generated historical examples. These do not establish a real experiment result.'
                      : readout.exploratory
                        ? 'The running readout is descriptive. A final decision requires closed assignments and every validity check.'
                        : 'The prespecified fixed-horizon readout is available. Assess the practical effect and operational guardrails before rollout.'}
                  </p>
                </div>
                <div className="compare-grid">
                  <Arm label="A · Control" arm={readout.control} />
                  <Arm label="B · Treatment" arm={readout.treatment} />
                </div>
                <div className="growth-blockers">
                  {readout.blockers.map((b: string) => (
                    <span key={b}>{readable(b)}</span>
                  ))}
                </div>
                <div className="compare-grid">
                  <div className="experiment-arm">
                    <small>Difference · treatment minus control</small>
                    <div className="growth-effect">
                      {readout.effect
                        ? (readout.effect.difference_pp > 0 ? '+' : '') +
                          readout.effect.difference_pp.toFixed(2) +
                          ' pp'
                        : '-'}
                    </div>
                    <p>
                      {readout.effect
                        ? `95% interval ${readout.effect.low_pp.toFixed(2)} to ${readout.effect.high_pp.toFixed(2)} pp`
                        : 'Waiting for matured units in both arms.'}
                    </p>
                    <small>Planned detectable difference: {readout.planned_effect_pp.toFixed(2)} pp</small>
                  </div>
                  <div className="experiment-arm">
                    <small>Allocation integrity · expected 50/50</small>
                    <div className="growth-effect">
                      {readout.srm.failed
                        ? 'Investigate'
                        : readout.srm.p_value === null
                          ? 'Waiting'
                          : 'No mismatch detected'}
                    </div>
                    <p>
                      SRM p-value: {readout.srm.p_value === null ? 'unavailable' : readout.srm.p_value.toPrecision(3)} ·
                      alert below 0.001
                    </p>
                    <small>
                      {readout.pending} units still inside the attribution window · {readout.active_days.toFixed(1)}{' '}
                      active days
                    </small>
                  </div>
                </div>
                <p className="growth-section-note">
                  {readout.definition} {readout.multiplicity}
                </p>
                <DataTable<any>
                  name="Exploratory device slices"
                  data={readout.device_slices}
                  rowId={(r) => r.variant + '/' + r.device}
                  columns={[
                    {id: 'variant', label: 'VARIANT', value: (r) => r.variant},
                    {id: 'device', label: 'DEVICE · EXPLORATORY', value: (r) => r.device},
                    {id: 'assigned', label: 'ASSIGNED', value: (r) => r.assigned},
                    {id: 'rendered', label: 'RENDERED', value: (r) => r.rendered},
                    {id: 'mature', label: 'MATURED', value: (r) => r.mature},
                    {id: 'success', label: 'CONVERSIONS', value: (r) => r.successes},
                  ]}
                />
                <Collapsible title={<>Sampled behavior guardrails</>}>
                  <DataTable<any>
                    name="Experiment behavior guardrails"
                    data={readout.guardrails ?? []}
                    rowId={(r) => r.variant}
                    columns={[
                      {id: 'variant', label: 'VARIANT', value: (r) => r.variant},
                      {id: 'views', label: 'TRACKED VIEWS', value: (r) => r.tracked_views},
                      {
                        id: 'errors',
                        label: 'ERROR SIGNALS',
                        value: (r) =>
                          r.tracked_views
                            ? r.diagnostics.runtime_errors + r.diagnostics.unhandled_rejections
                            : undefined,
                      },
                      {
                        id: 'repeat',
                        label: 'REPEATED CLICKS',
                        value: (r) => (r.tracked_views ? r.diagnostics.rage_clicks : undefined),
                      },
                      {
                        id: 'lcp',
                        label: 'LCP P75 · MS',
                        value: (r) => r.performance.find((p: any) => p.metric === 'lcp_ms')?.p75,
                      },
                    ]}
                  />
                  <p className="small-note">
                    Missing measurements remain unavailable. Sampled diagnostic signals do not establish an all-visitor
                    safety result. Review these before a rollout.
                  </p>
                </Collapsible>
                <ExperimentBehavior api={api} experiment={chosen} dataSource={dataSource} refresh={counter + refresh} />
                <p className="small-note">
                  Readout as of {new Date(readout.as_of).toLocaleString('en-GB', {timeZone: 'Europe/Bucharest'})} ·
                  Europe/Bucharest. Closing assignments is final; late outcomes inside their original window may still
                  arrive.
                </p>
              </>
            )
          )}
        </Card>
      )}
    </div>
  );
}
