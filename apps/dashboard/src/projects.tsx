import {Collapsible} from './components/collapsible.js';
import {Card, CardGrid} from './components/card.js';
import {Button} from './components/button.js';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowRight, Check, Copy, Globe, Plus, RefreshCw} from 'lucide-react';
import {InstallationCheckButton, InstallationStatus, useInstallationChecks} from './installation-status.js';
import {marketForHost} from '../../../packages/domain/market-defaults.js';
import {FormField} from './components/form-field.js';
import {Modal} from './components/modal.js';
import {emptyProjectForm, prepareProject, type ProjectFormValues, type ProjectFormErrors} from './project-form.js';
import './projects.css';

type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
type ProjectSummary = {
  id: string;
  name: string;
  origin: string;
  brand?: string;
  enabled: boolean;
  market?: string;
  currency?: string;
};
export function Projects({
  sites,
  role,
  api,
  onCreated,
  onOpen,
}: {
  sites: ProjectSummary[];
  role: string;
  api: Api;
  onCreated: (id: string) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="project-stack">
      <Card padding="normal">
        <div className="project-heading">
          <div>
            <div className="project-title-row">
              <h2>Your website projects</h2>
              <span className="badge">
                {sites.length} {sites.length === 1 ? 'project' : 'projects'}
              </span>
            </div>
            <p>A workspace for every website. Choose a project to get started.</p>
          </div>
          {role === 'owner' && (
            <Button variant="primary" type="button" className="project-start" onClick={() => setOpen(true)}>
              <Plus size={16} />
              Start new project
            </Button>
          )}
        </div>
        {!sites.length ? (
          <div className="project-empty">
            <span className="project-empty-icon">
              <Globe size={25} />
            </span>
            <h3>Your next project starts here</h3>
            <p>Connect a website to bring its pages, analytics, and heatmaps into one place.</p>
            {role === 'owner' && (
              <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
                <Plus size={15} />
                Create your first project
              </Button>
            )}
          </div>
        ) : (
          <CardGrid>
            {sites.map((site) => (
              <ProjectCard key={site.id} site={site} onOpen={onOpen} />
            ))}
          </CardGrid>
        )}
      </Card>
      {open && role === 'owner' && (
        <CreateProjectModal api={api} onCreated={onCreated} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

export function ProjectCard({site, onOpen}: {site: ProjectSummary; onOpen: (id: string) => void}) {
  return (
    <Card
      title={site.name}
      description={site.origin}
      icon={Globe}
      footer={
        <>
          <span className="ui-card-detail">{site.brand || 'Website project'}</span>
          <Button type="button" onClick={() => onOpen(site.id)}>
            Open project
            <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <div className="project-card-meta">
        <span className={'badge ' + (site.enabled ? 'green' : 'neutral')}>
          <span className="project-status-dot" />
          {site.enabled ? 'Collection enabled' : 'Setup pending'}
        </span>
        {site.market && (
          <span>
            {site.market}
            {site.currency ? ' · ' + site.currency : ''}
          </span>
        )}
      </div>
    </Card>
  );
}

function CreateProjectModal({
  api,
  onCreated,
  onClose,
}: {
  api: Api;
  onCreated: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<ProjectFormValues>({...emptyProjectForm}),
    [errors, setErrors] = useState<ProjectFormErrors>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const touched = useRef(new Set<keyof ProjectFormValues>()),
    submitting = useRef(false),
    createdId = useRef<string | null>(null),
    formRef = useRef<HTMLFormElement>(null);
  function change(field: keyof ProjectFormValues, value: string) {
    touched.current.add(field);
    setErrors((current) => ({...current, [field]: undefined}));
    setError('');
    setValues((current) => {
      const next = {...current, [field]: value};
      if (field === 'url') {
        let host = '';
        try {
          host = new URL(value.trim()).hostname;
        } catch {}
        const defaults = marketForHost(host);
        if (!touched.current.has('market')) next.market = defaults?.market ?? '';
        if (!touched.current.has('currency')) next.currency = defaults?.currency ?? '';
        if (!touched.current.has('timezone')) next.timezone = defaults?.report_timezone ?? '';
      }
      return next;
    });
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const result = prepareProject(values);
    setErrors(result.errors);
    setError('');
    if (Object.keys(result.errors).length) {
      const field = Object.keys(result.errors)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      if (!createdId.current) {
        const project = await api('/api/projects', result.body);
        createdId.current = project.id;
      }
      await onCreated(createdId.current!);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        createdId.current
          ? 'Your project was created, but could not be opened. Try opening it again.'
          : message.includes('WEBSITE_ALREADY_EXISTS')
            ? 'A project already exists for this website.'
            : message.replaceAll('_', ' ') || 'Could not create the project. Please try again.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Start a project"
      description="One website, one project. Keep your pages, analytics, and integrations together."
      icon={<Plus size={21} />}
      busy={busy}
      className="project-create-modal"
    >
      <form ref={formRef} className="project-create" onSubmit={create} noValidate>
        <fieldset disabled={busy || !!createdId.current} className="project-form-fields">
          <div className="project-form-section">
            <span className="project-section-number">01</span>
            <h3>Website details</h3>
          </div>
          <div className="project-form-grid">
            <FormField
              label="Project name"
              name="name"
              value={values.name}
              onChange={(e) => change('name', e.target.value)}
              error={errors.name}
              maxLength={120}
              placeholder="My clothing store"
              autoComplete="organization"
              autoFocus
              required
            />
            <FormField
              label="Website address"
              name="url"
              type="url"
              value={values.url}
              onChange={(e) => change('url', e.target.value)}
              error={errors.url}
              maxLength={255}
              placeholder="https://clothing.ro"
              autoComplete="url"
              hint="HTTPS address only, without a page path."
              required
            />
            <div className="project-field-wide">
              <FormField
                label="Brand"
                optional
                name="brand"
                value={values.brand}
                onChange={(e) => change('brand', e.target.value)}
                error={errors.brand}
                maxLength={120}
                placeholder="Defaults to your website name"
              />
            </div>
          </div>
          <div className="project-form-section project-locale-heading">
            <span className="project-section-number">02</span>
            <h3>Regional settings</h3>
            <span>Suggested from your domain</span>
          </div>
          <div className="project-form-grid project-region-grid">
            <FormField
              label="Market"
              name="market"
              value={values.market}
              onChange={(e) => change('market', e.target.value)}
              error={errors.market}
              maxLength={64}
              placeholder="RO"
              hint="Applies to every page."
            />
            <FormField
              label="Currency"
              name="currency"
              value={values.currency}
              onChange={(e) => change('currency', e.target.value.toUpperCase())}
              error={errors.currency}
              maxLength={3}
              placeholder="RON"
            />
            <FormField
              label="Report time zone"
              name="timezone"
              value={values.timezone}
              onChange={(e) => change('timezone', e.target.value)}
              error={errors.timezone}
              maxLength={64}
              placeholder="Europe/Bucharest"
            />
          </div>
        </fieldset>
        <div className="project-setup-note">
          <Check size={16} />
          <p>
            Your home page and tracking setup are prepared automatically. Next, install your website’s tracking script.
          </p>
        </div>
        {error && (
          <p role="alert" className="error-inline">
            {error}
          </p>
        )}
        <div className="project-form-actions">
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Creating project…' : createdId.current ? 'Open created project' : 'Create project'}
            <ArrowRight size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectInstallation({
  site,
  role,
  api,
  onChanged,
  copy,
}: {
  site: any;
  role: string;
  api: Api;
  onChanged: () => Promise<void>;
  copy: (s: string) => void;
}) {
  const [snippet, setSnippet] = useState<any>(null),
    [policy, setPolicy] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const checks = useInstallationChecks(api, site.config_version ?? 0);
  const load = useCallback(() => api('/api/install/site?' + new URLSearchParams({site_id: site.id})), [api, site.id]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setSnippet(null);
    load()
      .then((r) => {
        if (live) {
          setSnippet(r);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load, site.config_version]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void checks.reload().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(timer);
  }, [checks.reload]);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await load();
      setSnippet(result);
      await checks.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function approve() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/sites/${site.id}/approve`, {consent_policy_version: policy});
      await onChanged();
      await checks.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const receiving = checks.rows.some((r) => r.recent_events),
    first = checks.rows.find((r) => r.page_key === 'p.home') ?? checks.rows[0];
  return (
    <Card padding="normal">
      <div className="project-heading">
        <div>
          <h2>Connect {site.name}</h2>
          <p className="project-origin">{site.origin}</p>
        </div>
        <span className={'badge ' + (receiving && site.enabled ? 'green' : 'neutral')}>
          {receiving ? 'Activity received' : 'Waiting for connection'}
        </span>
      </div>
      <ol className="project-steps">
        <li className="complete">
          <span>1</span>
          <div>
            <b>Project prepared</b>
            <small>Home page and tracking configuration</small>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>Install the script</b>
            <small>Use this website’s script and consent manager</small>
          </div>
        </li>
        <li className={receiving ? 'complete' : ''}>
          <span>3</span>
          <div>
            <b>{receiving ? 'Activity received' : 'Discover your website'}</b>
            <small>Public pages and interactions appear as visitors browse</small>
          </div>
        </li>
      </ol>
      <p>
        Install this script once across your website. Landing pages, analytics, heatmaps and connection checks belong to
        this project.
      </p>
      {!site.enabled && role === 'owner' && (
        <div className="project-enable">
          <FormField
            label={
              <>
                Consent policy version<small>Enter the version of the analytics consent policy you reviewed.</small>
              </>
            }
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            placeholder="privacy-v1"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,63}"
          />
          <Button
            variant="primary"
            disabled={busy || !/^[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,63}$/.test(policy)}
            onClick={() => void approve()}
          >
            {busy ? 'Enabling…' : 'Enable website collection'}
          </Button>
        </div>
      )}
      <div className="project-script-heading">
        <h3>Website tracking script</h3>
        <div className="project-buttons">
          <Button variant="secondary" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={15} />
            {loading ? 'Loading…' : 'Refresh status'}
          </Button>
          {snippet && (
            <Button
              variant="primary"
              disabled={snippet.blocked}
              title={snippet.blocked ? 'Fix the items below before installing' : undefined}
              onClick={() => copy(snippet.code)}
            >
              <Copy size={15} />
              Copy complete script
            </Button>
          )}
        </div>
      </div>
      {snippet && (
        <dl className="project-install-facts">
          <div>
            <dt>Website address</dt>
            <dd>
              <code>{site.origin}</code>
              <small>Must match the address in the visitor’s browser exactly, including www.</small>
            </dd>
          </div>
          <div className={snippet.blockers?.includes('HTTPS_COLLECTOR_REQUIRED') ? 'missing' : 'ready'}>
            <dt>Collector address</dt>
            <dd>
              <code>{snippet.endpoint}</code>
              <small>
                {snippet.blockers?.includes('HTTPS_COLLECTOR_REQUIRED')
                  ? 'Visitors’ browsers cannot reach this address. Set COLLECTOR_ORIGIN in .env to your public HTTPS collector, for example https://collect.yourdomain.ro, then restart Infrared.'
                  : 'Public HTTPS collector.'}
              </small>
            </dd>
          </div>
          <div className={snippet.consent_policy_version ? 'ready' : 'missing'}>
            <dt>Consent policy version</dt>
            <dd>
              <code>{snippet.consent_policy_version ?? 'not set'}</code>
              <small>
                {snippet.consent_policy_version
                  ? 'Recorded when this website was approved.'
                  : 'Enter the version above and select Enable website collection.'}
              </small>
            </dd>
          </div>
        </dl>
      )}
      {snippet?.blocked && (
        <div className="info-box warning" role="status">
          <div>
            <b>Not ready to install.</b> Fix these first, then select Refresh status. A script copied now would not
            collect:
            <ul>
              {(snippet.blockers ?? []).map((b: string) => (
                <li key={b}>
                  {(
                    {
                      APPROVAL_REQUIRED: 'An owner approves this website (Enable website collection).',
                      CONSENT_VERSION_REQUIRED: 'Record your consent policy version when approving.',
                      HTTPS_COLLECTOR_REQUIRED: 'Run the collector on a public HTTPS address and set COLLECTOR_ORIGIN.',
                      PAGE_PAUSED: 'Resume the page.',
                    } as Record<string, string>
                  )[b] ?? snippet.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {snippet && (
        <>
          <p className="small-note">
            Paste the complete script, unchanged, inside the <code>&lt;head&gt;</code> of every page (or as one Custom
            HTML tag in Google Tag Manager). It starts with <code>&lt;script&gt;</code> and ends with{' '}
            <code>InfraredBridge(…);</code> and <code>&lt;/script&gt;</code>. No <code>&lt;noscript&gt;</code> part is
            needed.
          </p>
          <pre
            className={'code-block project-script' + (snippet.blocked ? ' blocked' : '')}
            aria-label="Complete website tracking script"
          >
            <code>{snippet.code}</code>
          </pre>
        </>
      )}
      <h3>Connect analytics consent</h3>
      <p>
        Call these methods from your website’s consent manager when the visitor grants or withdraws analytics consent.
      </p>
      <pre className="code-block project-script">
        {
          '// After analytics consent:\nInfraredHost.setConsent("granted");\n// On withdrawal:\nInfraredHost.setConsent("denied");'
        }
      </pre>
      <PrivacyNotice site={site} copy={copy} />
      <div className="project-script-heading">
        <h3>Link & pixel verification</h3>
        {first && <InstallationCheckButton page={first} checks={checks} role={role} />}
      </div>
      <InstallationStatus status={first} />
      <p className="small-note">
        Status refreshes every 15 seconds. A static pixel check does not prove script execution or consent. Recent
        activity confirms received events. Your collector must be reachable over HTTPS for live websites.
      </p>
      <p className="small-note">
        Public sections and buttons receive structural names. Forms and marked private regions are excluded, along with
        sensitive account, login, cart and checkout paths. Choose business categories, conversion goals and backend
        integrations for this website when needed.
      </p>
      {(error || checks.error) && (
        <p className="error-inline" role="alert">
          {(error || checks.error).replaceAll('_', ' ')}
        </p>
      )}
    </Card>
  );
}

// Plain-language text for the website's cookie/privacy page. Not legal advice; the site owner stays responsible for it.
function PrivacyNotice({site, copy}: {site: any; copy: (s: string) => void}) {
  const host = (() => {
    try {
      return new URL(site.origin).hostname;
    } catch {
      return site.origin;
    }
  })();
  const ro = `Analiză statistică (Infrared)
Dacă accepți cookie-urile de analiză, ${host} înregistrează în mod anonim cum este folosit site-ul: paginile vizitate, clicurile și cât de mult derulezi pagina, tipul dispozitivului (calculator, tabletă, telefon), browserul, sistemul de operare, limba, țara și dimensiunea ecranului. Nu colectăm numele, adresa de e-mail, conținutul formularelor sau adresa IP completă și nu folosim aceste date pentru publicitate. Datele sunt folosite doar pentru a îmbunătăți site-ul, sunt raportate numai agregat (grupuri de minimum 20 de vizite) și sunt șterse după 30 de zile. Temei legal: consimțământul tău (art. 6 alin. 1 lit. a GDPR). Îți poți retrage oricând acordul din setările cookie de pe site.`;
  const en = `Analytics (Infrared)
If you accept analytics cookies, ${host} records anonymously how the site is used: pages viewed, clicks and how far you scroll, device type (computer, tablet, phone), browser, operating system, language, country and screen size. We do not collect your name, email address, form contents or full IP address, and we do not use this data for advertising. It is used only to improve the site, reported only in aggregate (groups of at least 20 visits) and deleted after 30 days. Legal basis: your consent (Art. 6(1)(a) GDPR). You can withdraw consent at any time in the site's cookie settings.`;
  return (
    <Collapsible
      title={
        <>
          <h3>Privacy policy text</h3>
          <small>Ready to paste into your cookie or privacy page</small>
        </>
      }
      className="project-privacy"
    >
      <p className="small-note">
        Tracking only starts after the visitor accepts analytics in your cookie banner (
        <code>setConsent("granted")</code>). Add this paragraph to your privacy page so visitors know what is measured.
        If you changed retention or the minimum group size in Privacy & settings, update the numbers.
      </p>
      {[
        ['Română', ro],
        ['English', en],
      ].map(([label, text]) => (
        <div key={label} className="project-privacy-text">
          <div className="project-script-heading">
            <b>{label}</b>
            <Button variant="secondary" onClick={() => copy(text)}>
              <Copy size={15} />
              Copy text
            </Button>
          </div>
          <pre className="code-block project-script">{text}</pre>
        </div>
      ))}
    </Collapsible>
  );
}
