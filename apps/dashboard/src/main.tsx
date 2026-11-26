import {Button} from './components/button.js';
import {cachedQuery, invalidateQueries, resetQuerySession} from './query-cache.js';
import {HeatmapFilters} from './heatmap-filters.js';
import {HeatmapInsights} from './heatmap-insights.js';
import {Card, MetricCard as Stat, CardGrid} from './components/card.js';
import {FormField} from './components/form-field.js';
import {FilterBar} from './components/filter-bar.js';
import {canonicalPath, pathKey, type SiteRules} from '../../../packages/domain/site-paths.js';
import {createProjectApi, projectSelection} from './project-scope.js';
import {Projects, ProjectInstallation} from './projects.js';
import {Modal} from './components/modal.js';
import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Eye,
  FileImage,
  Flame,
  Globe,
  Image,
  Info,
  Layers,
  LockKeyhole,
  LogOut,
  Maximize2,
  Monitor,
  MousePointer2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  X,
} from 'lucide-react';
import {paintHeatmap, heatColor} from '../../../packages/heatmap-renderer/index.js';
import {deviceForWidth} from '../../../packages/domain/metrics.js';
import {parseAddress, selectorURL, MARKETING_PARAMS, type Selector} from '../../../packages/domain/matcher.js';
import './styles.css';
import './analytics.css';
import './typography.css';
import './charts.css';
import './theme.css';
import './workspace.css';
import './product-brand.css';
import './dashboard-polish.css';
import './tables.css';
import './input-focus.css';
import {RegistryTable} from './registry-table.js';
import {RemoteTable} from './data-table.js';
import {WorkspaceBrand, ProductMark, ProductBrand} from './brand.js';
import {WorkspaceNavigation, MoreAnalysis, workspaceRoutes} from './workspace-ui.js';
import {HeatmapCharts, ComparisonCharts, ActivityChart} from './chart-loader.js';
import {ReferencePicker, ElementTable} from './heatmap-tools.js';
import {ReferenceLibrary} from './reference-library.js';
import {DataSourceBar} from './data-source-bar.js';
import {
  CampaignDashboard,
  CampaignFilters,
  FunnelPanel,
  DiagnosticsPanel,
  ReportQualityPanel,
  VersionComparison,
  TrackingPolicy,
} from './analytics-panels.js';
import {OperationsPanel} from './operations-panel.js';
import {
  MarketRegistry,
  AcquisitionDashboard,
  ExperimentsDashboard,
  ScopeFilters,
  scopePages,
  type GrowthScope,
} from './growth-dashboard.js';
import {SharedHeatmapComparison} from './comparison-heatmaps.js';
import {InstallationCheckPanel} from './installation-status.js';
import {IntelligencePanel} from './intelligence-panel.js';
import {AudiencePanel} from './audience-panel.js';
import './dark-workspace.css';
type Page = {
  auto?: boolean;
  market?: string;
  page_family: string;
  acquisition_goal: string;
  campaign_codes?: string[];
  primary_cta_id?: string;
  primary_action_id?: string;
  diagnostics_enabled?: boolean;
  diagnostic_error_codes?: string[];
  site_id: string;
  page_key: string;
  name: string;
  selector: Selector;
  enabled: boolean;
  approval_state: string;
  revision: string;
  locale: string;
  variant: string;
  state: string;
  product: string;
  elements: string[];
};
type Site = {
  market?: string;
  brand: string;
  currency: string;
  report_timezone: string;
  id: string;
  site_key: string;
  name: string;
  origin: string;
  collection_mode?: string;
  site_rules: SiteRules;
  environment: string;
  enabled: boolean;
  sample_rate: number;
};
type Bootstrap = {
  experiments?: any[];
  user: {email: string; role: string; csrf: string};
  sites: Site[];
  pages: Page[];
  privacy: {raw_days: number; reference_days: number; minimum_views: number; global_stop: boolean};
  demo_url: null;
};
type Report = any;
type ProjectApi = typeof api;
let csrf = '';
async function api<T = any>(url: string, body?: unknown, method?: string): Promise<T> {
  const verb = method ?? (body ? 'POST' : 'GET');
  const request = async () => {
    const response = await fetch(url, {
      method: verb,
      headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(csrf ? {'X-CSRF-Token': csrf} : {})},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.code || 'REQUEST_FAILED');
    if (verb !== 'GET') invalidateQueries();
    return data as T;
  };
  if (url.startsWith('/api/auth/')) {
    resetQuerySession();
    return request();
  }
  return verb === 'GET' ? cachedQuery(url, request) : request();
}

const format = (n: number) => new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0}).format(n || 0);
const pct = (n: number) => (n || 0).toFixed(1) + '%';
function Badge({children, tone = 'neutral'}: {children: React.ReactNode; tone?: string}) {
  return <span className={'badge ' + tone}>{children}</span>;
}
function Empty({
  icon: Icon = Database,
  title,
  description,
  action,
}: {
  icon?: any;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Login({onLogin}: {onLogin: () => void}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api('/api/auth/csrf');
      csrf = data.login_token || data.token;
      await api('/api/auth/login', {email, password});
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-header">
        <div className="login-brand">
          <ProductBrand />
        </div>
      </div>
      <div className="login-grid">
        <div className="login-story">
          <Badge tone="orange">
            <span className="dot" /> YOUR PRIVATE ANALYTICS WORKSPACE
          </Badge>
          <h1>
            See the clicks.
            <br />
            Understand
            <br />
            <em>the experience.</em>
          </h1>
          <p>
            One clear view of how your selected landing pages perform. Built around consent, context, and your own data.
          </p>
          <div className="login-feature">
            <ShieldCheck size={18} /> Private by design <span>·</span>
            <Database size={18} /> Locally owned
          </div>
          <div className="login-art">
            {Array.from({length: 42}, (_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
        <Card title="Welcome to Infrared" description="Sign in to your workspace." icon={LockKeyhole}>
          <form onSubmit={submit}>
            <FormField
              label={<>Email address</>}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              required
            />
            <FormField
              label={<>Password</>}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            {error && <div className="error-inline">{error.replaceAll('_', ' ').toLowerCase()}</div>}
            <Button variant="primary" className="full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in to workspace'}
              <ArrowRight size={17} />
            </Button>
          </form>
        </Card>
      </div>
      <footer className="login-footer">
        Infrared <span>Website analytics · Europe/Bucharest</span>
      </footer>
    </div>
  );
}
function Logo() {
  return <ProductMark />;
}
function Studio() {
  const [auth, setAuth] = useState<'loading' | 'login' | 'ready'>('loading'),
    [workspaceData, setData] = useState<Bootstrap | null>(null),
    [projectId, setProjectId] = useState(() => localStorage.getItem('infrared.project') ?? ''),
    [nav, setNav] = useState(workspaceRoutes.has(location.hash.slice(1)) ? location.hash.slice(1) : 'projects'),
    [selected, setSelected] = useState(''),
    [reportResult, setReportResult] = useState<{query: string; value: Report} | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState(false),
    [search, setSearch] = useState('');
  const activeProject = workspaceData?.sites.find((s) => s.id === projectId) ?? workspaceData?.sites[0];
  const data = useMemo(
    () =>
      workspaceData
        ? {
            ...workspaceData,
            sites: activeProject ? [activeProject] : [],
            pages: workspaceData.pages.filter((p) => p.site_id === activeProject?.id),
            experiments: workspaceData.experiments?.filter((e) => e.site_id === activeProject?.id),
          }
        : null,
    [workspaceData, activeProject],
  );
  useEffect(() => {
    if (activeProject) localStorage.setItem('infrared.project', activeProject.id);
  }, [activeProject?.id]);
  const projectApi = useMemo(() => createProjectApi(api, activeProject?.id), [activeProject?.id]);
  const projectRef = useRef(activeProject?.id);
  projectRef.current = activeProject?.id;
  const openProject = (id: string) => {
    setProjectId(id);
    setModal(false);
    setSearch('');
    setSelected('');
    setReport(null);
    setScope({market: '', product: '', brand: ''});
    setNav('pages');
    location.hash = 'pages';
  };
  useEffect(() => {
    setSelected((current) =>
      data?.pages.some((p) => p.site_id + '/' + p.page_key === current)
        ? current
        : data?.pages[0]
          ? data.pages[0].site_id + '/' + data.pages[0].page_key
          : '',
    );
    setReport(null);
    setReferenceId('');
    setExperimentId('');
    setCampaign('');
    setRevision('');
    setVariant('');
  }, [activeProject?.id, data?.pages.length]);
  const [device, setDevice] = useState('desktop'),
    [width, setWidth] = useState('1440'),
    [from, setFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [mode, setMode] = useState('clicks'),
    [opacity, setOpacity] = useState(0.7),
    [referenceOn, setReferenceOn] = useState(true);
  const [referenceId, setReferenceId] = useState('');
  const [dataSource, setDataSource] = useState('recorded'),
    [autoWidth, setAutoWidth] = useState(true);
  const [campaign, setCampaign] = useState(''),
    [mapping, setMapping] = useState('document'),
    [revision, setRevision] = useState(''),
    [reloadToken, setReloadToken] = useState(0);
  const [scope, setScope] = useState<GrowthScope>({market: '', product: '', brand: ''}),
    [variant, setVariant] = useState(''),
    [experimentId, setExperimentId] = useState('');
  const projectScope = {...scope, site_id: activeProject?.id};
  const scopedPages = scopePages(data?.pages ?? [], data?.sites ?? [], scope);
  const [siteId, pageKey] = selected.split('/');
  const page = data?.pages.find((p) => p.site_id === siteId && p.page_key === pageKey),
    site = data?.sites.find((s) => s.id === siteId);
  const go = (id: string) => {
    setNav(id);
    location.hash = id;
    setError('');
  };
  const reload = useCallback(async () => {
    invalidateQueries();
    try {
      const b = await api<Bootstrap>('/api/bootstrap');
      csrf = b.user.csrf;
      setSelected((current) =>
        projectSelection(
          b.pages,
          b.sites.some((s) => s.id === projectRef.current) ? projectRef.current : b.sites[0]?.id,
          current,
        ),
      );
      setData(b);
      setAuth('ready');
    } catch (e) {
      setAuth('login');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const sync = () => {
      const next = location.hash.slice(1);
      setNav(workspaceRoutes.has(next) ? next : 'projects');
      setError('');
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const query = new URLSearchParams({
    site_id: siteId || '',
    page_key: pageKey || '',
    from,
    to,
    device,
    data_source: dataSource,
    mapping: nav === 'heatmaps' ? mapping : 'document',
    ...(campaign ? {campaign} : {}),
    ...(experimentId ? {experiment_id: experimentId} : {}),
    ...(width ? {width} : {}),
    ...(page ? {revision: revision || page.revision, variant: variant || page.variant} : {}),
    ...(referenceId ? {reference_id: referenceId} : {}),
  }).toString();
  const report = reportResult?.query === query ? reportResult.value : null;
  const setReport = useCallback((value: Report | null) => setReportResult(value ? {query, value} : null), [query]);
  const refresh = useCallback(async () => {
    await reload();
    if (!page || nav === 'projects' || nav === 'pages' || nav === 'installation') return;
    setReloadToken((n) => n + 1);
    setLoading(true);
    setError('');
    try {
      setReport(await api('/api/reports?' + query));
    } catch (e) {
      setReport(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, reload, page, nav]);
  useEffect(() => {
    if (auth !== 'ready' || data?.user.role === 'installer' || !page) return;
    let live = true;
    setLoading(true);
    setError('');
    api('/api/reports?' + query)
      .then((r) => {
        if (live) setReport(r);
      })
      .catch((e) => {
        if (live) {
          setReport(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [auth, query, data]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const copied = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied to clipboard');
    } catch {
      setError('Clipboard unavailable. Select and copy the text manually.');
    }
  };
  const choose = (value: string) => {
    setExperimentId('');
    setVariant('');
    setRevision('');
    setCampaign('');
    setReport(null);
    setAutoWidth(true);
    setReferenceId('');
    setSelected(value);
    setWidth('1440');
    setDevice('desktop');
  };
  const toggle = async (p: Page) => {
    try {
      await api(`/api/pages/${p.site_id}/${p.page_key}/toggle`, {});
      await reload();
      setNotice(p.enabled ? 'Collection paused for this page' : 'Collection resumed');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!autoWidth || !report?.widths?.length) return;
    const w = report.widths.includes(Number(width)) ? Number(width) : report.widths[0];
    setAutoWidth(false);
    setWidth(String(w));
    setDevice(deviceForWidth(w));
  }, [autoWidth, report, width]);
  const selectDevice = (next: string) => {
    const observed: number[] = report?.widths?.filter((w: number) => deviceForWidth(w) === next) ?? [];
    const defaultWidth = next === 'desktop' ? '1440' : next === 'mobile' ? '390' : '';
    const nextWidth = observed.includes(Number(width)) ? width : String(observed[0] ?? defaultWidth);
    setAutoWidth(false);
    setReferenceId('');
    setDevice(next);
    setWidth(nextWidth);
  };
  useEffect(() => {
    if (auth !== 'ready' || nav !== 'heatmaps' || !page) return;
    let live = true,
      busy = false;
    const timer = setInterval(async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const r = await api('/api/reports?' + query);
        if (live) setReport(r);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        busy = false;
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [auth, nav, query]);
  if (auth === 'loading')
    return (
      <div className="boot">
        <Logo />
        <span>Opening your workspace…</span>
      </div>
    );
  if (auth === 'login') return <Login onLogin={() => void reload()} />;
  const newTitles: Record<string, string> = {
    projects: 'Projects',
    intelligence: 'Journey intelligence',
    markets: 'Markets & registry',
    acquisition: 'Acquisition',
    experiments: 'Experiments',
    campaigns: 'Overview',
    funnels: 'Conversion funnels',
    diagnostics: 'Experience diagnostics',
    versions: 'Page versions',
    operations: 'Operations',
  };
  const descriptions: Record<string, string> = {
    projects: 'A separate analytics project for every website and brand.',
    intelligence: 'Rank the next interaction from an observed sequence of actions.',
    markets: 'Your markets, products and selected landing pages.',
    acquisition: 'Follow visits through conversions and qualified acquisition.',
    experiments: 'Test landing pages with randomized acquisition experiments.',
    campaigns: 'Your landing pages. The numbers that matter.',
    funnels: 'See where views turn into action.',
    diagnostics: 'Find the moments that need attention.',
    versions: 'Compare performance across page revisions.',
    operations: 'Workspace-wide service health, maintenance and recovery.',
  };
  const title =
    newTitles[nav] ||
    (nav === 'pages'
      ? 'Landing pages'
      : nav === 'heatmaps'
        ? 'Heatmaps'
        : nav === 'compare'
          ? 'Compare performance'
          : nav === 'references'
            ? 'Reference library'
            : nav === 'installation'
              ? 'Install & connect'
              : nav === 'quality'
                ? 'Data quality'
                : 'Privacy & settings');
  return (
    <div className="app">
      <aside className="sidebar">
        <WorkspaceBrand onHome={() => go('projects')} />
        <div className="workspace">
          <span className="workspace-icon">IR</span>
          <div>
            <b>Website workspace</b>
            <small>
              <span className="status-light" /> Local environment
            </small>
          </div>
        </div>
        <WorkspaceNavigation
          current={nav}
          onNavigate={go}
          pageCount={data?.pages.length ?? 0}
          owner={data?.user.role === 'owner'}
        />
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{data?.user.email.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{data?.user.email.split('@')[0]}</b>
              <small>{data?.user.role}</small>
            </div>
            <Button
              variant="icon"
              title="Sign out"
              onClick={async () => {
                await api('/api/auth/logout', {});
                setAuth('login');
              }}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <FormField
              category="select"
              hideLabel
              label={'Current project'}
              aria-label="Current project"
              value={activeProject?.id ?? ''}
              onChange={(e) => openProject(e.target.value)}
            >
              {!workspaceData?.sites.length && <option value="">No projects yet</option>}
              {workspaceData?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </FormField>{' '}
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="workspace-access">
              <LockKeyhole size={13} /> Private workspace
            </span>
            <span className="top-avatar">IR</span>
          </div>
        </header>
        <main className="main">
          <div className="page-heading">
            <div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {descriptions[nav] ??
                  (nav === 'pages'
                    ? 'Your selected pages, ready to explore.'
                    : nav === 'heatmaps'
                      ? 'See where people click and how far they scroll.'
                      : nav === 'compare'
                        ? 'Compare your landing pages side by side.'
                        : nav === 'references'
                          ? 'Manage the layouts behind your heatmaps.'
                          : nav === 'installation'
                            ? 'Connect the selected website and verify its tracking script.'
                            : nav === 'quality'
                              ? 'Understand coverage, delivery, and the health of your data.'
                              : 'Workspace-wide consent, masking and retention settings.')}
              </p>
            </div>
            <div className="heading-actions">
              {nav === 'pages' ? (
                <>
                  <Button variant="secondary" onClick={() => void reload()}>
                    <RefreshCw size={15} /> Refresh pages
                  </Button>
                  <Button variant="secondary" onClick={() => go('installation')}>
                    <BookOpen size={15} /> Installation guide
                  </Button>
                  <Button variant="primary" disabled={!activeProject} onClick={() => setModal(true)}>
                    <Plus size={17} /> Add landing page
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => void refresh()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh data
                </Button>
              )}
            </div>
          </div>
          <React.Fragment key={activeProject?.id ?? 'no-project'}>
            {!activeProject && !['projects', 'settings', 'operations'].includes(nav) ? (
              <Card padding="normal">
                <Empty
                  title="Choose a website project"
                  description="Create a project to prepare its pages, tracking and analytics."
                  action={
                    <Button variant="primary" onClick={() => go('projects')}>
                      Start a project
                    </Button>
                  }
                />
              </Card>
            ) : (
              <>
                {nav === 'projects' && (
                  <Projects
                    sites={workspaceData?.sites ?? []}
                    role={data?.user.role ?? ''}
                    api={api}
                    onOpen={openProject}
                    onCreated={async (id) => {
                      await reload();
                      openProject(id);
                      setNav('installation');
                      location.hash = 'installation';
                    }}
                  />
                )}
                {nav === 'installation' && activeProject?.collection_mode === 'whole_site' && (
                  <ProjectInstallation
                    key={activeProject.id}
                    site={activeProject}
                    role={data?.user.role ?? ''}
                    api={projectApi}
                    onChanged={reload}
                    copy={copied}
                  />
                )}
                {error && (
                  <div className="notice error" role="alert">
                    <Info size={17} />
                    <span>{error.replaceAll('_', ' ').toLowerCase()}. Your previous query did not return data.</span>
                    <Button variant="secondary" onClick={() => void refresh()}>
                      Retry
                    </Button>
                    <Button variant="icon" onClick={() => setError('')}>
                      <X size={15} />
                    </Button>
                  </div>
                )}
                {!['projects', 'quality', 'operations', 'settings', 'installation'].includes(nav) && (
                  <DataSourceBar
                    value={dataSource}
                    onChange={(v) => {
                      setReport(null);
                      setDataSource(v);
                      setReferenceId('');
                      setAutoWidth(true);
                    }}
                    stopped={data?.privacy.global_stop ?? false}
                    onResume={
                      data?.user.role === 'owner'
                        ? () => {
                            void api('/api/settings/privacy', {...data.privacy, global_stop: false}, 'PATCH')
                              .then(reload)
                              .catch((e) => setError(e.message));
                          }
                        : undefined
                    }
                  />
                )}
                {['heatmaps', 'compare', 'references', 'installation', 'funnels', 'diagnostics', 'versions'].includes(
                  nav,
                ) && (
                  <HeatmapFilters
                    nav={nav}
                    pages={data?.pages ?? []}
                    experiments={data?.experiments ?? []}
                    page={page}
                    report={report}
                    selected={selected}
                    device={device}
                    width={width}
                    campaign={campaign}
                    experimentId={experimentId}
                    variant={variant}
                    mapping={mapping}
                    revision={revision}
                    from={from}
                    to={to}
                    onPage={choose}
                    onDevice={selectDevice}
                    onWidth={(next) => {
                      setAutoWidth(false);
                      setReferenceId('');
                      setWidth(next);
                      if (next) setDevice(deviceForWidth(Number(next)));
                    }}
                    onCampaign={setCampaign}
                    onExperiment={(value) => {
                      setReferenceId('');
                      setExperimentId(value);
                    }}
                    onVariant={(value) => {
                      setReferenceId('');
                      setVariant(value);
                    }}
                    onMapping={setMapping}
                    onRevision={(value) => {
                      setReferenceId('');
                      setRevision(value);
                    }}
                    onFrom={setFrom}
                    onTo={setTo}
                  />
                )}
                {nav === 'pages' && (
                  <FilterBar label="Page filters" variant="scope">
                    <ScopeFilters
                      pages={data?.pages ?? []}
                      sites={data?.sites ?? []}
                      value={scope}
                      onChange={setScope}
                    />
                  </FilterBar>
                )}
                {['markets', 'acquisition', 'experiments'].includes(nav) && (
                  <ScopeFilters pages={data?.pages ?? []} sites={data?.sites ?? []} value={scope} onChange={setScope} />
                )}
                {nav === 'markets' && (
                  <MarketRegistry
                    refresh={reloadToken}
                    api={projectApi}
                    pages={scopedPages}
                    sites={data?.sites ?? []}
                    role={data?.user.role ?? ''}
                    onSaved={reload}
                    onPage={(value) => {
                      choose(value);
                      go('heatmaps');
                    }}
                  />
                )}
                {nav === 'acquisition' && (
                  <AcquisitionDashboard
                    key={activeProject?.id}
                    api={projectApi}
                    pages={data?.pages ?? []}
                    sites={data?.sites ?? []}
                    role={data?.user.role ?? ''}
                    from={from}
                    to={to}
                    onFrom={setFrom}
                    onTo={setTo}
                    dataSource={dataSource}
                    scope={projectScope}
                    refresh={reloadToken}
                  />
                )}
                {nav === 'experiments' && (
                  <ExperimentsDashboard
                    key={activeProject?.id}
                    api={projectApi}
                    pages={data?.pages ?? []}
                    role={data?.user.role ?? ''}
                    dataSource={dataSource}
                    scope={projectScope}
                    refresh={reloadToken}
                    onChanged={reload}
                  />
                )}
                {nav === 'pages' && (
                  <>
                    <div className="page-summary">
                      <span>
                        <b>{data?.pages.length || 0}</b> landing pages
                      </span>
                      <span>
                        <i className="status-light" />
                        <b>{data?.pages.filter((p) => p.enabled).length || 0}</b> enabled for collection
                      </span>
                      <span>
                        <b>{data?.pages.filter((p) => p.approval_state !== 'approved').length || 0}</b> awaiting
                        approval
                      </span>
                    </div>
                    <Card
                      title="Your landing pages"
                      description="Pages discovered from your website or added individually."
                      padding="none"
                      actions={
                        <FormField
                          hideLabel
                          label="Search pages"
                          type="search"
                          placeholder="Search pages or URLs…"
                          aria-label="Search pages"
                          maxLength={120}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      }
                      footer={
                        <>
                          <span>Real-site drafts require independent approval before collection.</span>
                          <span>{data?.pages.length} pages</span>
                        </>
                      }
                    >
                      <RegistryTable
                        api={projectApi}
                        role={data?.user.role ?? ''}
                        refresh={reloadToken}
                        pages={scopedPages.filter((p) =>
                          (p.name + ' ' + selectorURL(p.selector)).toLowerCase().includes(search.toLowerCase()),
                        )}
                        onSelect={(value) => {
                          choose(value);
                          go('heatmaps');
                        }}
                        onToggle={(p) => void toggle(p)}
                        resetKey={search + JSON.stringify(scope)}
                      />
                    </Card>
                    <div className="workspace-next">
                      <span>Ready for the next step?</span>
                      <Button variant="text" onClick={() => go('heatmaps')}>
                        Explore heatmaps <ArrowUpRight size={15} />
                      </Button>
                      <Button variant="text" onClick={() => go('installation')}>
                        Connect a landing page <ArrowUpRight size={15} />
                      </Button>
                    </div>
                  </>
                )}
                {nav === 'heatmaps' && (
                  <>
                    <CardGrid>
                      <Stat
                        label="Tracked page views"
                        value={loading ? '-' : report?.summary ? format(report.summary.views) : '-'}
                        icon={Eye}
                        detail="Consented, sampled views"
                      />
                      <Stat
                        label="Pointer clicks"
                        value={loading ? '-' : report?.summary ? format(report.summary.clicks) : '-'}
                        icon={MousePointer2}
                        detail="Repeated clicks are included"
                      />
                      <Stat
                        label="Average scroll reach"
                        value={loading ? '-' : report?.summary ? pct(report.summary.avg_reach) : '-'}
                        icon={ArrowDown}
                        detail="Maximum viewport-bottom reach"
                      />
                      <Stat
                        label="Page activation rate"
                        value={loading ? '-' : report?.summary ? pct(report.summary.activation_rate) : '-'}
                        icon={Target}
                        detail={
                          report?.summary
                            ? `${report.summary.activated_views || 0} activated / ${report.summary.views || 0} tracked views`
                            : 'Distinct activated views'
                        }
                      />
                    </CardGrid>
                    <ReferencePicker
                      report={report}
                      value={referenceId}
                      onChange={setReferenceId}
                      width={width}
                      loading={loading}
                    />
                    <div className="heatmap-layout">
                      <Card padding="none">
                        <div className="heatmap-toolbar">
                          <div className="mode-tabs">
                            {[
                              {id: 'clicks', label: 'Clicks', icon: MousePointer2},
                              {id: 'scroll', label: 'Scroll reach', icon: ArrowDown},
                              {id: 'elements', label: 'Elements', icon: Layers},
                              {id: 'rage', label: 'Repeated clicks', icon: Flame},
                              {id: 'dead', label: 'No response', icon: MousePointer2},
                            ].map(({id, label, icon: Icon}) => (
                              <Button
                                variant="secondary"
                                className={mode === id ? 'active' : ''}
                                onClick={() => setMode(id)}
                                key={id}
                              >
                                <Icon size={15} />
                                {label}
                              </Button>
                            ))}
                          </div>
                          <Button
                            variant="icon"
                            title="Export annotated PNG"
                            disabled={!report?.reference}
                            onClick={() =>
                              void exportPNG(report, mode, opacity, from, to).catch((e) => setError(e.message))
                            }
                          >
                            <ArrowDownToLine size={17} />
                          </Button>
                        </div>
                        <div className="heatmap-subtoolbar">
                          <span>
                            <span className="status-light" /> Reference layout{' '}
                            <code>{report?.selected_revision || page?.revision}</code>
                          </span>
                          <div>
                            <FormField
                              label="Opacity"
                              aria-label="Heatmap opacity"
                              type="range"
                              min="0.1"
                              max="1"
                              step="0.05"
                              value={opacity}
                              onChange={(e) => setOpacity(+e.target.value)}
                            />
                            <Button
                              variant="secondary"
                              className={'icon-btn ' + (!referenceOn ? 'selected' : '')}
                              title="Toggle reference image"
                              onClick={() => setReferenceOn(!referenceOn)}
                            >
                              <Image size={15} />
                            </Button>
                          </div>
                        </div>
                        <HeatmapStage
                          report={report}
                          mode={mode}
                          opacity={opacity}
                          referenceOn={referenceOn}
                          loading={loading}
                          onReference={() => go('references')}
                        />
                        <div className="heatmap-footer">
                          <span>
                            <Monitor size={13} />
                            {report?.reference
                              ? `${report.reference.manifest.viewport.width} × ${report.reference.manifest.viewport.height} px`
                              : report?.outline
                                ? `Drawn page · ${report.outline.width} px wide`
                                : 'No compatible viewport'}{' '}
                            <span className="footer-separator">·</span> Document layer
                          </span>
                          <span>
                            Fit to width <Maximize2 size={13} />
                          </span>
                        </div>
                      </Card>
                      <HeatmapInsights report={report} />
                    </div>
                    <MoreAnalysis
                      title="Element engagement"
                      description="Exposure and activation for each registered element"
                    >
                      <ElementTable report={report} loading={loading} />
                    </MoreAnalysis>
                    <AudiencePanel report={report} minimum={data?.privacy?.minimum_views ?? 20} />
                    <MoreAnalysis description="Scroll trends, daily activity and data quality">
                      <HeatmapCharts report={report} />
                      <ReportQualityPanel report={report} />
                    </MoreAnalysis>
                    <div className="report-note">
                      <Info size={14} />
                      <span>
                        Dates use UTC boundaries. Times display in Europe/Bucharest. Recent data is provisional for 48
                        hours. No cross-site visitor identity.
                      </span>
                      <a href={'/api/export.csv?' + query} className="text-button">
                        <ArrowDownToLine size={14} /> Export aggregate CSV
                      </a>
                    </div>
                  </>
                )}
                {nav === 'campaigns' && (
                  <>
                    <FilterBar>
                      <ScopeFilters
                        pages={data?.pages ?? []}
                        sites={data?.sites ?? []}
                        value={scope}
                        onChange={setScope}
                      />
                      <CampaignFilters
                        from={from}
                        to={to}
                        device={device}
                        campaign={campaign}
                        codes={[...new Set(data?.pages.flatMap((p) => p.campaign_codes ?? ['unknown']) ?? [])]}
                        onFrom={setFrom}
                        onTo={setTo}
                        onDevice={setDevice}
                        onCampaign={setCampaign}
                      />
                    </FilterBar>
                    <CampaignDashboard
                      api={projectApi}
                      scope={projectScope}
                      from={from}
                      to={to}
                      device={device}
                      dataSource={dataSource}
                      campaign={campaign}
                      reloadToken={reloadToken}
                      onPage={(value) => {
                        choose(value);
                        go('heatmaps');
                      }}
                    />
                  </>
                )}
                {['funnels', 'diagnostics'].includes(nav) && report?.suppressed && (
                  <Card padding="normal">
                    <Empty
                      icon={ShieldCheck}
                      title="Not enough activity yet"
                      description={`At least ${report.minimum_views} confirmed tracked views are needed to show this report.`}
                    />
                  </Card>
                )}
                {nav === 'intelligence' && (
                  <IntelligencePanel
                    key={selected + ':' + dataSource + ':' + reloadToken}
                    pages={data?.pages ?? []}
                    selected={selected}
                    onSelect={choose}
                    dataSource={dataSource}
                    from={from}
                    to={to}
                    setFrom={setFrom}
                    setTo={setTo}
                    role={data?.user.role ?? ''}
                    api={projectApi}
                  />
                )}
                {nav === 'funnels' && <FunnelPanel report={report} />}
                {nav === 'diagnostics' && (
                  <>
                    <DiagnosticsPanel report={report} />
                    <MoreAnalysis title="Data quality details" description="Mapping coverage, delivery and processing">
                      <ReportQualityPanel report={report} />
                    </MoreAnalysis>
                  </>
                )}
                {nav === 'versions' && (
                  <VersionComparison api={projectApi} report={report} query={query} reloadToken={reloadToken} />
                )}
                {nav === 'operations' && <OperationsPanel api={api} reloadToken={reloadToken} />}
                {nav === 'compare' && (
                  <Compare
                    key={activeProject?.id}
                    api={projectApi}
                    selected={selected}
                    data={data!}
                    from={from}
                    to={to}
                    device={device}
                    width={width}
                    dataSource={dataSource}
                    campaign={campaign}
                  />
                )}
                {nav === 'references' && (
                  <ReferenceLibrary
                    report={report}
                    site={site}
                    page={page}
                    width={width}
                    reload={refresh}
                    notify={setNotice}
                    fail={setError}
                    api={projectApi}
                    onUse={(ref) => {
                      setVariant(ref.manifest.variant);
                      setRevision(ref.manifest.revision);
                      if (ref.manifest.variant !== page?.variant) {
                        setExperimentId(
                          data?.experiments?.find(
                            (e) =>
                              e.site_id === siteId &&
                              e.page_key === pageKey &&
                              e.treatment_variant === ref.manifest.variant,
                          )?.id ?? '',
                        );
                      }
                      setAutoWidth(false);
                      const w = ref.manifest.viewport.width;
                      setWidth(String(w));
                      setDevice(w < 768 ? 'mobile' : w < 1200 ? 'tablet' : 'desktop');
                      setReferenceId(ref.id);
                      go('heatmaps');
                    }}
                  />
                )}
                {nav === 'installation' && activeProject?.collection_mode !== 'whole_site' && (
                  <InstallationCheckPanel
                    api={projectApi}
                    page={page}
                    role={data?.user.role ?? ''}
                    refresh={reloadToken}
                  />
                )}
                {nav === 'installation' && (
                  <TrackingPolicy page={page} role={data?.user.role ?? ''} api={projectApi} onSaved={reload} />
                )}
                {nav === 'installation' && activeProject?.collection_mode !== 'whole_site' && (
                  <Installation api={projectApi} selected={selected} site={site} page={page} copy={copied} go={go} />
                )}
                {nav === 'quality' && <Quality api={projectApi} siteId={activeProject!.id} reloadToken={reloadToken} />}
                {nav === 'settings' && data && (
                  <Privacy data={data} reload={reload} notify={setNotice} fail={setError} />
                )}
              </>
            )}
          </React.Fragment>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {notice}
        </div>
      )}
      {modal && activeProject && (
        <AddPage
          key={activeProject.id}
          site={activeProject}
          api={projectApi}
          close={() => setModal(false)}
          saved={async (value) => {
            await reload();
            choose(value);
            setModal(false);
            setNotice('Landing page saved as a disabled draft');
          }}
        />
      )}
    </div>
  );
}
// Drawn page: element boxes from recorded clicks, no screenshot required.
function OutlineStage({
  report,
  mode,
  opacity,
  onReference,
}: {
  report: Report;
  mode: string;
  opacity: number;
  onReference: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const o = report.outline;
  useEffect(() => {
    if (canvas.current && mode === 'clicks') paintHeatmap(canvas.current, o.points, o.width, o.height, opacity, 32);
  }, [o, opacity, mode]);
  const most = Math.max(1, ...o.elements.map((e: any) => e.clicks));
  return (
    <div className="heatmap-stage">
      <div className="stage-info">
        <Badge tone="dark">
          {report.data_source === 'recorded' ? 'RECORDED' : report.data_source === 'seeded' ? 'SAMPLE' : 'LEGACY'}
        </Badge>
        <span>
          Drawn page · {o.width}px ·{' '}
          {o.widths.length > 1
            ? `${o.widths.length} screen widths combined (${o.widths[0]}–${o.widths[o.widths.length - 1]}px)`
            : '1 screen width'}{' '}
          · {o.placed}/{o.total} clicks placed on their element
        </span>
        <Button variant="text" onClick={onReference}>
          <Plus size={13} /> Add a screenshot (optional)
        </Button>
      </div>
      <div className="reference-page outline-page" style={{aspectRatio: `${o.width} / ${o.height}`}}>
        {o.elements.map((el: any) => (
          <div
            key={el.id}
            className={'outline-box' + (mode === 'elements' ? ' labelled' : '')}
            style={{
              left: (100 * el.rect.x) / o.width + '%',
              top: (100 * el.rect.y) / o.height + '%',
              width: (100 * el.rect.width) / o.width + '%',
              height: (100 * el.rect.height) / o.height + '%',
              ...(mode === 'elements'
                ? {background: `rgba(${heatColor(el.clicks / most).join(',')},${opacity * 0.45})`}
                : {}),
            }}
          >
            <span>
              {el.id.replace(/^auto\./, '').replace('.', ' ')}
              {mode === 'elements' ? ` · ${el.clicks} clicks` : ''}
            </span>
          </div>
        ))}
        <canvas ref={canvas} className="heat-canvas" hidden={mode !== 'clicks'} />
        {mode === 'scroll' && (
          <div className="scroll-overlay">
            {report.scroll.slice(0, 20).map((s: any, i: number) => {
              const color = heatColor(s.percent / 100);
              return (
                <div key={s.depth} style={{top: i * 5 + '%', background: `rgba(${color.join(',')},${opacity * 0.65})`}}>
                  <span>
                    {s.depth}% depth <b>{Math.round(s.percent)}% reach</b>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="heat-legend">
        <span>Less</span>
        <i />
        <span>More</span>
        <small>
          Boxes are the clicked page elements, drawn from visitor data. Positions are approximate across screen widths.
        </small>
      </div>
    </div>
  );
}
function HeatmapStage({
  report,
  mode,
  opacity,
  referenceOn,
  loading,
  onReference,
}: {
  report: Report;
  mode: string;
  opacity: number;
  referenceOn: boolean;
  loading: boolean;
  onReference: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const m = report?.reference?.manifest;
  useEffect(() => {
    if (canvas.current && m)
      paintHeatmap(
        canvas.current,
        (mode === 'rage' ? report.rage_points : mode === 'dead' ? report.dead_points : report.points) || [],
        m.document.width,
        m.document.height,
        opacity,
        32,
      );
  }, [report, m, opacity, mode]);
  if (loading)
    return (
      <div className="map-loading">
        <span className="loader" />
        <p>Preparing this cohort…</p>
      </div>
    );
  if (report?.suppressed)
    return (
      <Empty
        icon={ShieldCheck}
        title="Cohort below the reporting threshold"
        description={`At least ${report.minimum_views} confirmed tracked views are required.`}
      />
    );
  if (!m && report?.outline && ['clicks', 'elements', 'scroll'].includes(mode))
    return <OutlineStage report={report} mode={mode} opacity={opacity} onReference={onReference} />;
  if (!m)
    return (
      <Empty
        icon={FileImage}
        title="A reference makes the picture complete"
        description="Capture or import an approved layout for this page, revision, and exact viewport width."
        action={
          <Button variant="secondary" onClick={onReference}>
            <Plus size={15} /> Add a reference layout
          </Button>
        }
      />
    );
  return (
    <div className="heatmap-stage">
      <div className="stage-info">
        <Badge tone="dark">
          {report.data_source === 'recorded' ? 'RECORDED' : report.data_source === 'seeded' ? 'SAMPLE' : 'LEGACY'}
        </Badge>
        <span>
          Reference layout · {m.viewport.width}px · {m.revision}
        </span>
      </div>
      <div className="reference-page" style={{aspectRatio: `${m.document.width} / ${m.document.height}`}}>
        {referenceOn && (
          <img
            src={`/api/references/${report.reference.id}/image`}
            alt={`Approved reference layout for ${report.page.name}`}
            draggable={false}
          />
        )}
        <canvas ref={canvas} className="heat-canvas" hidden={!['clicks', 'rage', 'dead'].includes(mode)} />
        {mode === 'scroll' && (
          <div className="scroll-overlay">
            {report.scroll.slice(0, 20).map((s: any, i: number) => {
              const color = heatColor(s.percent / 100);
              return (
                <div key={s.depth} style={{top: i * 5 + '%', background: `rgba(${color.join(',')},${opacity * 0.65})`}}>
                  <span>
                    {s.depth}% depth <b>{Math.round(s.percent)}% reach</b>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {mode === 'elements' && (
          <div className="elements-overlay">
            {m.elements.map((el: any) => {
              const fact = report.elements.find((e: any) => e.id === el.id);
              return (
                <div
                  key={el.id}
                  style={{
                    left: (100 * el.rect.x) / m.document.width + '%',
                    top: (100 * el.rect.y) / m.document.height + '%',
                    width: (100 * el.rect.width) / m.document.width + '%',
                    height: (100 * el.rect.height) / m.document.height + '%',
                  }}
                >
                  <span>
                    {el.id} · {fact?.exposed_views || 0} exposed
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="heat-legend">
        <span>Less</span>
        <i />
        <span>More</span>
        <small>Relative density · log scale</small>
      </div>
    </div>
  );
}
async function exportPNG(report: Report, mode: string, opacity: number, from: string, to: string) {
  const m = report.reference.manifest,
    img = new window.Image();
  img.src = `/api/references/${report.reference.id}/image`;
  await img.decode();
  const out = document.createElement('canvas');
  out.width = m.document.width;
  out.height = m.document.height + 160;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (['clicks', 'rage', 'dead'].includes(mode)) {
    const heat = document.createElement('canvas');
    paintHeatmap(
      heat,
      mode === 'rage' ? report.rage_points : mode === 'dead' ? report.dead_points : report.points,
      m.document.width,
      m.document.height,
      opacity,
      32,
    );
    ctx.drawImage(heat, 0, 0, m.document.width, m.document.height);
  }
  if (mode === 'scroll') {
    for (const s of report.scroll.slice(0, 20)) {
      ctx.fillStyle = `rgba(${heatColor(s.percent / 100).join(',')},${opacity * 0.65})`;
      ctx.fillRect(0, (s.depth / 100) * m.document.height, m.document.width, m.document.height * 0.05);
    }
  }
  if (mode === 'elements') {
    ctx.strokeStyle = '#ff8a45';
    ctx.lineWidth = 3;
    for (const e of m.elements) ctx.strokeRect(e.rect.x, e.rect.y, e.rect.width, e.rect.height);
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, m.document.height, out.width, 160);
  ctx.fillStyle = '#181a23';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`${report.page.name} · ${mode}`, 25, m.document.height + 35);
  ctx.font = '15px sans-serif';
  ctx.fillText(
    `${report.data_source.toUpperCase()} · sampled observations · ${from}–${to} UTC · ${m.revision} · ${m.viewport.width}px`,
    25,
    m.document.height + 70,
  );
  ctx.fillText(
    `${report.summary.views} tracked views · ${report.quality.mapped}/${report.quality.total_observations} mapped clicks · ${report.quality.sample_rate * 100}% sample · log density`,
    25,
    m.document.height + 100,
  );
  ctx.fillText(
    `Reference ${report.reference.id} · Best-effort delivery · Aggregation v${report.quality.aggregation_version}`,
    25,
    m.document.height + 130,
  );
  const link = document.createElement('a');
  link.download = 'infrared-heatmap.png';
  link.href = out.toDataURL('image/png');
  link.click();
}
function Compare({
  api,
  selected,
  data,
  from,
  to,
  device,
  width,
  dataSource,
  campaign,
}: {
  api: ProjectApi;
  selected: string;
  data: Bootstrap;
  from: string;
  to: string;
  device: string;
  width: string;
  dataSource: string;
  campaign: string;
}) {
  const [other, setOther] = useState(projectSelection(data.pages, data.sites[0]?.id, '')),
    [reports, setReports] = useState<Report[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setReports([]);
    setError('');
    if (!selected || !other) return;
    Promise.all(
      [selected, other].map((value) => {
        const [site_id, page_key] = value.split('/');
        return api(
          '/api/reports?' +
            new URLSearchParams({
              site_id,
              page_key,
              from,
              to,
              device,
              data_source: dataSource,
              ...(campaign ? {campaign} : {}),
              ...(width ? {width} : {}),
            }),
        );
      }),
    )
      .then((r) => {
        if (live) setReports(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, selected, other, from, to, device, width, dataSource, campaign]);
  return (
    <>
      <div className="comparison-note">
        <Layers size={20} />
        <div>
          <strong>Independent pages. Comparable counts.</strong>
          <p>Each page keeps its own views, layout, and consented population. Pixel maps are never merged.</p>
        </div>
        <FormField
          category="select"
          hideLabel
          label={'Comparison page'}
          aria-label="Comparison page"
          value={other}
          onChange={(e) => setOther(e.target.value)}
        >
          {data.pages.map((p) => (
            <option value={p.site_id + '/' + p.page_key} key={p.site_id + p.page_key}>
              {p.name}
            </option>
          ))}
        </FormField>
      </div>
      {error && <div className="notice error">{error}</div>}
      <ComparisonCharts reports={reports} />
      <div className="compare-grid">
        {reports.map((r, i) => (
          <Card
            padding="none"
            key={i}
            title={<>{r.page.name}</>}
            actions={
              <>
                <Badge>{r.page.environment === 'synthetic' ? 'SYNTHETIC' : 'REAL'}</Badge>
              </>
            }
          >
            <CardGrid>
              <Stat
                label="Tracked views"
                value={r.suppressed ? 'Suppressed' : format(r.summary.views)}
                detail="Selected cohort"
              />
              <Stat
                label="Page activation"
                value={r.suppressed ? '-' : pct(r.summary.activation_rate)}
                detail="Distinct activated views"
              />
              <Stat
                label="Scroll reach"
                value={r.suppressed ? '-' : pct(r.summary.avg_reach)}
                detail="Maximum viewport-bottom reach"
              />
            </CardGrid>
            <ActivityChart rows={r.suppressed ? [] : (r.daily ?? [])} />
            <div className="compare-foot">
              <Info size={14} /> Daily tracked page views · UTC
            </div>
          </Card>
        ))}
      </div>
      <SharedHeatmapComparison reports={reports} />
    </>
  );
}
function Installation({
  api,
  selected,
  site,
  page,
  copy,
  go,
}: {
  api: ProjectApi;
  selected: string;
  site?: Site;
  page?: Page;
  copy: (s: string) => void;
  go: (s: string) => void;
}) {
  const [install, setInstall] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setInstall(null);
    const [site_id, page_key] = selected.split('/');
    api('/api/install?' + new URLSearchParams({site_id, page_key}))
      .then(setInstall)
      .catch((e) => setError(e.message));
  }, [selected]);
  return (
    <div className="installation-grid">
      <div>
        <Card padding="normal" title={<>A small script. A precise scope.</>}>
          <div className="section-heading">
            <span className="section-icon">
              <Code2 size={22} />
            </span>
            <Badge tone={install?.blocked ? 'orange' : 'green'}>
              {install?.blocked ? 'DRAFT · INSTALLATION BLOCKED' : 'WEBSITE INTEGRATION'}
            </Badge>
          </div>
          <p>
            The generated host bridge loads the SDK only after analytics consent, an eligible public-page context, and
            an exact URL match.
          </p>
          {install?.blocked && (
            <div className="info-box warning">
              <LockKeyhole size={17} />
              <span>{install.reason}</span>
            </div>
          )}
          {error && <div className="error-inline">{error}</div>}
          <div className="code-block">
            <div>
              <span>Host-owned campaign template</span>
              <Button variant="text" disabled={!install || install.blocked} onClick={() => copy(install.code)}>
                <Copy size={13} />
                Copy script
              </Button>
            </div>
            <pre>{install?.code || 'Preparing page-scoped integration…'}</pre>
          </div>
          <div className="snippet-meta">
            <span>
              <ShieldCheck size={13} /> Immutable SDK + SHA-384 integrity
            </span>
            <span>Manifest v2 · Event protocol v1</span>
          </div>
        </Card>
        <Card padding="normal" title={<>The Marketing handoff</>}>
          {[
            {
              title: 'Choose the exact campaign template',
              text: 'Install only on the selected origin, path, and query selector. A tag manager trigger needs the same exact scope.',
            },
            {
              title: 'Connect the host consent and context adapters',
              text: 'Call InfraredHost.setContext with the approved page key, release, locale, variant, and public eligibility. Call setConsent only from the reviewed CMP callback.',
            },
            {
              title: 'Review security and verify the release',
              text: 'Add the collector to script-src and connect-src in CSP. Use the generated immutable filename and SRI. Confirm the page revision matches an approved reference.',
            },
            {
              title: 'Test the boundaries before collecting',
              text: 'Decline consent, withdraw it, open an unselected campaign, and switch to a sensitive context. Verify that collection stops and no old events are replayed.',
            },
          ].map((s, i) => (
            <div className="install-step" key={s.title}>
              <span>{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
          <div className="code-example">
            <code>{`InfraredHost.setContext({\n  eligible: true, // anonymous public page only\n  pageKey: "${page?.page_key}",\n  revision: "${page?.revision}",\n  locale: "${page?.locale}",\n  variant: "${page?.variant}",\n  state: "${page?.state}"\n});\n// From your reviewed CMP subscription:\nInfraredHost.setConsent("granted");\n// Before opening a sensitive UI:\nInfraredHost.setContext({ ...context, eligible: false });`}</code>
          </div>
        </Card>
      </div>
      <aside>
        <Card padding="normal">
          <div className="insights-title">
            <Target size={18} />
            <h2>Your installation scope</h2>
          </div>
          <span className="scope-label">INCLUDED</span>
          <div className="scope-url">
            <Check size={15} />
            <code>{page ? selectorURL(page.selector) : ''}</code>
          </div>
          <span className="scope-label excluded-label">NOT INCLUDED</span>
          {[
            site?.origin + '/',
            (site?.origin || '') + (page?.selector.path || ''),
            (site?.origin || '') + (page?.selector.path || '') + '?lp=another-campaign',
          ].map((v, i) => (
            <div className="scope-url excluded" key={i}>
              <X size={14} />
              <code>{v}</code>
            </div>
          ))}
          <div className="info-box">
            <Info size={15} />
            <span>Query values select a page. They are never sent as raw visitor URLs.</span>
          </div>
        </Card>
        <Card padding="normal">
          <div className="insights-title">
            <ShieldCheck size={18} />
            <h2>Privacy instrumentation</h2>
          </div>
          <p>Mark complete sensitive regions to exclude clicks, exposure, and screenshot content.</p>
          <div className="code-example">
            <code>{'<aside data-hm-private>…</aside>\n<form>…</form>\n<div data-hm-ignore>…</div>'}</code>
          </div>
          <Button variant="text" onClick={() => go('settings')}>
            Review privacy controls <ArrowRight size={14} />
          </Button>
        </Card>
        <section className="install-warning">
          <Globe size={18} />
          <div>
            <strong>Localhost is local to each visitor.</strong>
            <p>
              A live page needs an approved, publicly reachable HTTPS collector. Public websites require an HTTPS
              collector.
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}
function Quality({api, siteId, reloadToken}: {api: ProjectApi; siteId: string; reloadToken: number}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    api('/api/quality')
      .then((next) => {
        if (live) setData(next);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, reloadToken]);
  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <div className="report-scope">
        <Database size={14} /> Current project totals · all stored data sources
      </div>
      <CardGrid>
        <Stat
          label="Durably stored events"
          value={data ? format(data.counts.events) : '-'}
          icon={Database}
          detail="Acknowledged after commit"
        />
        <Stat
          label="Tracked view identities"
          value={data ? format(data.counts.views) : '-'}
          icon={Eye}
          detail="Memory-only on the client"
        />
        <Stat
          label="Unresolved orphan views"
          value={data ? format(data.counts.orphans) : '-'}
          icon={Activity}
          detail="Excluded from rate denominators"
        />
        <Stat
          label="Processing backlog"
          value={
            data
              ? format(data.jobs.filter((j: any) => j.state !== 'done').reduce((a: number, j: any) => a + j.count, 0))
              : '-'
          }
          icon={Layers}
          detail="Durable, replayable view jobs"
        />
      </CardGrid>
      <div className="two-column">
        <Card padding="normal" title={<>Collection boundaries</>}>
          {[
            ['Database', data?.database || 'Checking…'],
            ['Workspace', 'Website projects'],
            ['Live collection', 'Per-project approval'],
            ['External references', 'Upload supported'],
            ['Report date boundaries', 'UTC'],
            ['Display timezone', 'Europe/Bucharest'],
          ].map(([k, v]) => (
            <div className="settings-row" key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </Card>
        <Card padding="normal" title={<>Recent validation outcomes</>}>
          <p>
            Workspace-wide counters since this collector process started. Rejected payloads and source IPs are not
            retained in application logs.
          </p>
          {data && Object.keys(data.rejections).length ? (
            Object.entries(data.rejections).map(([k, v]) => (
              <div className="settings-row" key={k}>
                <code>{k}</code>
                <b>{String(v)}</b>
              </div>
            ))
          ) : (
            <div className="quiet-state">
              <CheckCheck size={23} />
              <span>No rejected requests recorded this run.</span>
            </div>
          )}
        </Card>
      </div>
      <Card
        padding="none"
        title={<>Project audit trail</>}
        description={<>Configuration changes, reference reviews, and aggregate exports.</>}
        actions={
          <>
            <Badge>Recorded actions</Badge>
          </>
        }
      >
        <RemoteTable
          name="Project audit trail"
          endpoint={'/api/tables/audit?site_id=' + encodeURIComponent(siteId)}
          reloadToken={reloadToken}
          defaultSort="created_at"
          rowId={(row: any) => row.id}
          columns={[
            {
              id: 'action',
              label: 'ACTION',
              value: (row: any) => row.action,
              render: (row: any) => row.action.replaceAll('_', ' '),
            },
            {
              id: 'site_id',
              label: 'SITE',
              value: (row: any) => row.site_id,
              render: (row: any) => <code>{row.site_id || 'Workspace'}</code>,
            },
            {
              id: 'created_at',
              label: 'TIME · BUCHAREST',
              value: (row: any) => row.created_at,
              render: (row: any) => new Date(row.created_at).toLocaleString('en-GB', {timeZone: 'Europe/Bucharest'}),
            },
          ]}
        />
      </Card>
    </>
  );
}
function Privacy({
  data,
  reload,
  notify,
  fail,
}: {
  data: Bootstrap;
  reload: () => Promise<void>;
  notify: (s: string) => void;
  fail: (s: string) => void;
}) {
  const [settings, setSettings] = useState(data.privacy),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/api/settings/privacy', settings, 'PATCH');
      await reload();
      notify('Privacy settings saved');
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <Card padding="normal" title={<>Collect with a clear purpose.</>}>
        <span className="section-icon green">
          <ShieldCheck size={24} />
        </span>
        <p>
          Every event requires analytics consent, an eligible public context, and an approved exact-page configuration.
          Unknown states collect nothing.
        </p>
        <div className="privacy-principles">
          {[
            ['Consent is an independent gate', 'Revocation removes observers and clears unsent events.'],
            ['Sensitive regions stay excluded', 'Forms, editable fields, and private regions are never captured.'],
            ['No persistent visitor identity', 'View identifiers live in memory. No cookies or offline event queues.'],
            [
              'Exact pages, explicit revisions',
              'Other campaigns, parent pages, and incompatible layouts stay separate.',
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <Check size={17} />
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div>
        <Card padding="normal" title={<>Retention & reporting</>}>
          <p>Retention runs through the documented maintenance command. Shortening a rule applies on its next run.</p>
          <label className="setting-input">
            Raw event & view retention
            <div>
              <FormField
                hideLabel
                label={'Field'}
                type="number"
                min="1"
                max="90"
                value={settings.raw_days}
                onChange={(e) => setSettings({...settings, raw_days: +e.target.value})}
              />
              <span>days</span>
            </div>
          </label>
          <label className="setting-input">
            Reference artifact retention
            <div>
              <FormField
                hideLabel
                label={'Field'}
                type="number"
                min="1"
                max="365"
                value={settings.reference_days}
                onChange={(e) => setSettings({...settings, reference_days: +e.target.value})}
              />
              <span>days</span>
            </div>
          </label>
          <label className="setting-input">
            Minimum real-data reporting cohort
            <div>
              <FormField
                hideLabel
                label={'Field'}
                type="number"
                min="20"
                max="100"
                value={settings.minimum_views}
                onChange={(e) => setSettings({...settings, minimum_views: +e.target.value})}
              />
              <span>views</span>
            </div>
          </label>
          <div className="small-note">Reports appear after the configured minimum number of tracked views.</div>
          <div className="code-line">
            <code>pnpm retention</code>
          </div>
        </Card>
        <Card padding="normal" title={<>Global collection stop</>}>
          <p>
            Stop acceptance on every property immediately. Restoring collection preserves each page’s individual
            enablement.
          </p>
          <FormField
            label={
              <>
                <span>Emergency stop {settings.global_stop ? 'enabled' : 'disabled'}</span>
              </>
            }
            type="checkbox"
            checked={settings.global_stop}
            onChange={(e) => setSettings({...settings, global_stop: e.target.checked})}
          />
        </Card>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          <Check size={16} />
          {busy ? 'Saving…' : 'Save privacy settings'}
        </Button>
      </div>
    </div>
  );
}
function AddPage({
  site,
  api,
  close,
  saved,
}: {
  site: Site;
  api: ProjectApi;
  close: () => void;
  saved: (v: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(site.origin + '/'),
    [name, setName] = useState(''),
    [key, setKey] = useState(''),
    [product, setProduct] = useState('website'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [strict, setStrict] = useState(false);
  const parsed = parseAddress(url);
  const query = parsed
    ? Object.fromEntries([...parsed.searchParams].filter(([k]) => !MARKETING_PARAMS.includes(k)))
    : {};
  const whole = site.collection_mode === 'whole_site',
    canonical = parsed && whole ? canonicalPath(parsed.pathname, site.site_rules) : null,
    pageKey = whole && canonical ? pathKey(canonical) : key;
  const valid =
    parsed &&
    parsed.origin === site.origin &&
    Object.keys(query).length <= 8 &&
    (!whole || (canonical && Object.keys(query).length === 0));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const response = await api('/api/landing-pages', {
        name,
        page_key: pageKey,
        product,
        selector: {
          origin: parsed.origin,
          path: parsed.pathname,
          query_equals: query,
          ignored_query_names: [],
          other_query_policy: !whole && strict ? 'reject' : 'ignore',
          duplicate_query_policy: 'reject',
          fragment_policy: 'ignore_anchor',
        },
      });
      await saved(response.site_id + '/' + response.page_key);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={close}
      title="Add a landing page"
      description={<>Add a public page on {site.origin}. The page starts as a disabled draft.</>}
      icon={<Plus size={23} />}
      busy={busy}
      className="landing-page-modal"
    >
      <form className="landing-page-form" onSubmit={save}>
        <FormField
          label={<>Landing page URL</>}
          autoFocus
          type="url"
          placeholder="https://www.example.com/collection/"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        {valid && (
          <div className="selector-preview">
            <span>
              <b>ORIGIN</b>
              <code>{parsed.origin}</code>
            </span>
            <span>
              <b>EXACT PATH</b>
              <code>{parsed.pathname}</code>
            </span>
            <span>
              <b>PAGE SELECTORS</b>
              <code>
                {Object.entries(query)
                  .map(([k, v]) => k + ' = ' + v)
                  .join(', ') || 'None · exact path only'}
              </code>
            </span>
            <span>
              <b>IGNORED</b>
              <code>{strict ? 'Ad tags (utm_*, gclid, fbclid…) only' : 'Ad tags and any other parameter'}</code>
            </span>
          </div>
        )}
        <FormField
          label={<>Strict: don't track this page when the URL has other, unlisted parameters</>}
          type="checkbox"
          disabled={whole}
          checked={!whole && strict}
          onChange={(e) => setStrict(e.target.checked)}
        />
        <div className="info-box">
          <Info size={15} />
          <span>
            Paste public, static page selectors only. Remove attribution IDs, tokens, account information, and other
            sensitive values before saving.
          </span>
        </div>
        {whole && (
          <p className="small-note">
            Page keys are generated from public paths. Query-specific pages require selected-pages collection mode.
          </p>
        )}
        {parsed && parsed.origin !== site.origin && (
          <p role="alert" className="error-inline">
            Use a page from {site.origin}.
          </p>
        )}
        <FormField
          label={<>Display name</>}
          placeholder="Summer collection"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
        <div className="two-fields">
          <FormField
            label={<>Page key</>}
            placeholder="summer-collection"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,63}"
            value={pageKey}
            readOnly={whole}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <FormField
            label={<>Product label</>}
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="website, clothing, services…"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,63}"
            required
          />
        </div>
        {error && <div className="error-inline">{error.replaceAll('_', ' ')}</div>}
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || busy}>
            <Plus size={16} />
            {busy ? 'Saving…' : 'Save disabled draft'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById('root')!).render(<Studio />);
