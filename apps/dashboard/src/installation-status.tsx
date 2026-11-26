import {Button} from './components/button.js';
import {Card} from './components/card.js';
import {useCallback, useEffect, useState} from 'react';
import {RefreshCw} from 'lucide-react';
import './installation-status.css';
type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
const key = (p: any) => p.site_id + '/' + p.page_key;
const text: Record<string, string> = {
  reachable: 'Success · page loads',
  blocked: 'Blocked · cannot inspect',
  unreachable: 'Unreachable',
  http_error: 'HTTP error',
  different_page: 'Redirects to a different page',
  not_html: 'Not an HTML page',
  redirect_error: 'Redirect could not be verified',
  detected: 'Pixel code detected',
  not_found_in_html: 'Pixel not found in HTML',
  unverified: 'Pixel unverified',
};
const reason: Record<string, string> = {
  ACCESS_OR_BOT_PROTECTION: 'The server refused this check. This does not prove that the pixel is missing.',
  REDIRECT_CHANGED_LANDING_PAGE: 'The URL ended on a different page or campaign. Check its redirect rules.',
  DYNAMIC_OR_CONSENT_LOADING_NOT_VERIFIED:
    'The pixel may load through consent or a tag manager. Static inspection cannot verify that.',
  DOCUMENT_TRUNCATED: 'The document exceeded the inspection limit. The result is incomplete.',
  UNSAFE_TARGET: 'This checker accepts public HTTPS pages and the configured local demo only.',
  CHECK_TIMEOUT: 'The check timed out after 12 seconds.',
  NETWORK_OR_TLS_ERROR: 'The page could not be reached or its TLS connection failed.',
  HTTP_ERROR: 'The page returned an unsuccessful HTTP response.',
  NOT_AN_HTML_PAGE: 'This URL did not return a landing-page document.',
  REDIRECT_LIMIT_OR_INVALID: 'The page returned too many redirects or an invalid destination.',
};
export function useInstallationChecks(api: Api, refresh = 0, registryVersion = '') {
  const [rows, setRows] = useState<any[]>([]),
    [busy, setBusy] = useState<string[]>([]),
    [error, setError] = useState('');
  const reload = useCallback(async () => {
    const result = await api('/api/installations');
    setRows(result.rows);
    setError('');
  }, [api]);
  useEffect(() => {
    let live = true;
    setError('');
    api('/api/installations')
      .then((r) => {
        if (live) setRows(r.rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [api, refresh, registryVersion]);
  async function check(p: any) {
    const id = key(p);
    setBusy((v) => [...v, id]);
    setError('');
    try {
      await api(`/api/pages/${encodeURIComponent(p.site_id)}/${encodeURIComponent(p.page_key)}/check-installation`, {});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy((v) => v.filter((k) => k !== id));
    }
  }
  return {rows, busy, error, check, reload, find: (p: any) => rows.find((r) => key(r) === key(p))};
}
function linkTone(link?: string) {
  return link === 'reachable'
    ? 'installation-good'
    : link && link !== 'unverified'
      ? 'installation-bad'
      : 'installation-muted';
}
function pixelTone(pixel?: string) {
  return pixel === 'detected'
    ? 'installation-good'
    : pixel === 'not_found_in_html'
      ? 'installation-bad'
      : 'installation-muted';
}
export function InstallationStatus({
  status,
  compact = false,
  variant = 'full',
}: {
  status: any;
  compact?: boolean;
  variant?: 'full' | 'summary';
}) {
  const c = status?.check,
    enabled = status?.collection === 'enabled',
    receiving = status?.recent_events === true;
  return (
    <div
      className={'installation-status' + (variant === 'summary' ? ' installation-summary' : '')}
      aria-label="Installation status"
    >
      <span className={'badge ' + (receiving && enabled ? 'green' : 'neutral')}>
        {!status
          ? 'Loading status…'
          : receiving && enabled
            ? status.environment === 'local_demo'
              ? 'Receiving · local demo'
              : 'Receiving events'
            : status.collection === 'stopped'
              ? 'Collection stopped'
              : !enabled
                ? 'Draft · collection disabled'
                : 'No recent events'}
      </span>
      {!compact && (
        <>
          <span className={linkTone(c?.link)}>
            {c ? `${text[c.link] ?? c.link}${c.http_status ? ' · HTTP ' + c.http_status : ''}` : 'Link not checked'}
          </span>
          <span className={pixelTone(c?.pixel)}>{c ? (text[c.pixel] ?? c.pixel) : 'Pixel not checked'}</span>
          {variant === 'full' && <InstallationDetails status={status} />}
        </>
      )}
    </div>
  );
}

/** Verbose verification information is shared by expanded rows and installation panels. */
export function InstallationDetails({status}: {status: any}) {
  const c = status?.check,
    enabled = status?.collection === 'enabled',
    receiving = status?.recent_events === true;
  if (!status)
    return <div className="installation-details installation-muted">Verification details are not available yet.</div>;
  return (
    <div className="installation-details">
      <section>
        <h3>Response & inspection</h3>
        <p className={linkTone(c?.link)}>
          {c ? `${text[c.link] ?? c.link}${c.http_status ? ' · HTTP ' + c.http_status : ''}` : 'Link not checked'}
        </p>
        {c?.response_ms != null && (
          <p>
            Response headers: <b>{(c.response_ms / 1000).toFixed(2)}s</b>
            {c.document_ms != null && (
              <>
                {' '}
                · document: <b>{(c.document_ms / 1000).toFixed(2)}s</b>
              </>
            )}
            . Measured from this server, excluding browser rendering.
          </p>
        )}
        {c?.reason && <p className={linkTone(c.link)}>{reason[c.reason] ?? 'Inspection incomplete.'}</p>}
        {c?.scripts_unchecked > 0 && <p>{c.scripts_unchecked} script(s) were outside static inspection.</p>}
        {c && (
          <p>
            Checked {new Date(c.checked_at).toLocaleString('en-GB', {timeZone: 'UTC'})} UTC · {c.scripts_checked}{' '}
            script(s) inspected
          </p>
        )}
      </section>
      <section>
        <h3>Pixel & configuration</h3>
        <p className={pixelTone(c?.pixel)}>{c ? (text[c.pixel] ?? c.pixel) : 'Pixel not checked'}</p>
        {c?.pixel === 'detected' && (
          <>
            <p className={c.identity === 'matched' ? 'installation-good' : 'installation-muted'}>
              {c.identity === 'matched' ? 'Site key matches.' : 'Site key unverified.'}
            </p>
            <p className={c.endpoint === 'matched' ? 'installation-good' : 'installation-muted'}>
              {c.endpoint === 'matched' ? 'Collector setting matches.' : 'Collector setting unverified.'}
            </p>
            <p>Execution and consent flow still require a browser check.</p>
          </>
        )}
      </section>
      <section>
        <h3>Activity & processing</h3>
        <p className={receiving ? 'installation-good' : 'installation-muted'}>
          {receiving
            ? `Recorded events received in the last 24h${!enabled ? ' · collection is now disabled' : ''}.`
            : 'No recorded events received in the last 24h.'}
        </p>
        {!receiving && status.last_event_at && (
          <p>Last event: {new Date(status.last_event_at).toLocaleString('en-GB', {timeZone: 'UTC'})} UTC</p>
        )}
        <p>
          Processing:{' '}
          <span className={status.pending_views > 0 ? 'installation-muted' : 'installation-good'}>
            {status.pending_views ?? 0} pending view(s)
          </span>
          ,{' '}
          <span className={status.failed_views > 0 ? 'installation-bad' : 'installation-good'}>
            {status.failed_views ?? 0} failed
          </span>
          .
        </p>
        {status.pending_views > 0 && <p>Oldest waiting: {Math.round(status.oldest_pending_seconds)}s.</p>}
      </section>
    </div>
  );
}
export function InstallationCheckButton({
  page,
  checks,
  role,
}: {
  page: any;
  checks: ReturnType<typeof useInstallationChecks>;
  role: string;
}) {
  if (!['owner', 'administrator', 'analyst', 'installer'].includes(role)) return null;
  const busy = checks.busy.includes(key(page));
  return (
    <Button
      variant="secondary"
      className="installation-check-button"
      disabled={busy || checks.busy.length >= 3}
      onClick={() => void checks.check(page)}
    >
      <RefreshCw size={14} className={busy ? 'spin' : ''} />
      {busy ? 'Checking…' : 'Check link & pixel'}
    </Button>
  );
}
export function InstallationCheckPanel({
  api,
  page,
  role,
  refresh = 0,
}: {
  api: Api;
  page: any;
  role: string;
  refresh?: number;
}) {
  const checks = useInstallationChecks(api, refresh);
  if (!page) return null;
  return (
    <Card padding="normal" aria-label="Landing page installation check">
      <div className="growth-heading">
        <div>
          <h2>Link & pixel verification</h2>
          <p>Saving a page in the registry does not install its pixel.</p>
        </div>
        <InstallationCheckButton page={page} checks={checks} role={role} />
      </div>
      {checks.error && (
        <div role="alert" className="notice error">
          {checks.error}
        </div>
      )}
      <InstallationStatus status={checks.find(page)} />
      <p className="small-note">
        The check reads the registered URL and up to four scripts from the same origin. It does not run JavaScript or
        grant consent. Recent activity uses received Recorded events for this page; sample and legacy data are excluded.
      </p>
    </Card>
  );
}
