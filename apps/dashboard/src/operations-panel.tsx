import {CardGrid, MetricCard, Card} from './components/card.js';
import {Button} from './components/button.js';
import {FormField} from './components/form-field.js';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Activity, Archive, CheckCircle2, Clock3, Database, RefreshCw, ShieldCheck, TriangleAlert} from 'lucide-react';
import {OperationsCharts} from './chart-loader.js';
import {RemoteTable} from './data-table.js';
type Api = (url: string, body?: unknown, method?: string) => Promise<any>;
const format = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString('en-GB', {timeZone: 'Europe/Bucharest'}) : '-';
export function OperationsPanel({api, reloadToken}: {api: Api; reloadToken: number}) {
  const [data, setData] = useState<any>(null),
    [settings, setSettings] = useState<any>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(''),
    [showMonitor, setShowMonitor] = useState(false);
  const dirty = useRef(false);
  const load = useCallback(async () => {
    try {
      const d = await api('/api/operations');
      setData(d);
      if (!dirty.current) setSettings(d.settings);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load, reloadToken]);
  const change = (key: string, value: unknown) => {
    dirty.current = true;
    setSettings((s: any) => ({...s, [key]: value}));
  };
  async function save() {
    setBusy('settings');
    try {
      await api('/api/operations/settings', settings, 'PATCH');
      dirty.current = false;
      await load();
      setMessage('Operation schedules saved. The maintenance scheduler checks every minute.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function run(kind: string) {
    setBusy(kind);
    setError('');
    try {
      await api('/api/operations/run/' + kind, {});
      setMessage(kind === 'backup' ? 'Backup completed with database and reference checksums.' : kind + ' completed.');
      await load();
    } catch (e) {
      await load();
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const active = data?.alerts.filter((a: any) => a.active) ?? [],
    failed = data?.jobs.filter((j: any) => j.state === 'failed').reduce((n: number, j: any) => n + j.count, 0) ?? 0;
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="info-box" role="status">
          <CheckCircle2 size={17} />
          {message}
        </div>
      )}
      <CardGrid>
        <MetricCard label={<>Active operational alerts</>} value={<>{active.length}</>} />
        <MetricCard label={<>Failed worker jobs</>} value={<>{failed}</>} />
        <MetricCard
          label={<>Oldest queued work</>}
          value={<>{data ? Math.round(data.queue_lag_seconds) + 's' : '-'}</>}
        />
        <MetricCard
          label={<>HTTP metrics exporters</>}
          value={<>{data ? data.telemetry.filter((t: any) => t.exporter_enabled).length : '-'}</>}
          detail={<>OpenTelemetry · disabled until configured</>}
        />
      </CardGrid>
      <OperationsCharts data={data} />
      <Card
        padding="none"
        aria-label="Operational alerts"
        title={<>Operational alerts</>}
        description={<>Durable local alerts. External notification delivery is not configured.</>}
        actions={
          <>
            <Activity size={20} />
          </>
        }
      >
        {active.length ? (
          <div className="insight-list">
            {active.map((a: any) => (
              <div key={a.code}>
                <TriangleAlert size={19} />
                <div>
                  <strong>
                    {a.code.replaceAll('_', ' ')} · {a.severity}
                  </strong>
                  <p>
                    First seen {format(a.first_seen)} · latest {format(a.last_seen)}
                  </p>
                  <code>{JSON.stringify(a.detail)}</code>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="quiet-state">
            <CheckCircle2 size={22} />
            <span>No active alerts from the latest monitor. This is not a production certification.</span>
          </div>
        )}
        <div className="table-footer">
          <span>Checks queue delay, failed work and available ingestion rejection metrics.</span>
          <Button variant="text" disabled={!!busy} onClick={() => void run('monitor')}>
            <RefreshCw size={14} />
            Check now
          </Button>
        </div>
      </Card>
      {settings && (
        <div className="two-column">
          <Card padding="normal" title={<>Scheduled maintenance</>}>
            <span className="section-icon green">
              <ShieldCheck size={22} />
            </span>
            <p>Retention follows your existing privacy rules. A database claim prevents competing maintenance runs.</p>
            <FormField
              label={<>Automatic daily retention</>}
              type="checkbox"
              checked={settings.automatic_retention}
              onChange={(e) => change('automatic_retention', e.target.checked)}
            />
            <FormField
              label={<>Retention hour · UTC</>}
              type="number"
              min="0"
              max="23"
              value={settings.retention_hour_utc}
              onChange={(e) => change('retention_hour_utc', +e.target.value)}
            />
            <FormField
              label={<>Automatic daily logical backup</>}
              type="checkbox"
              checked={settings.automatic_backup}
              onChange={(e) => change('automatic_backup', e.target.checked)}
            />
            <div className="two-fields">
              <FormField
                label={<>Backup hour · UTC</>}
                type="number"
                min="0"
                max="23"
                value={settings.backup_hour_utc}
                onChange={(e) => change('backup_hour_utc', +e.target.value)}
              />
              <FormField
                label={<>Backup retention · days</>}
                type="number"
                min="1"
                max="90"
                value={settings.backup_days}
                onChange={(e) => change('backup_days', +e.target.value)}
              />
            </div>
            <div className="info-box">
              <Archive size={17} />
              <span>
                Backups are private local recovery copies and contain password hashes. Encryption and offsite storage
                still need deployment configuration.
              </span>
            </div>
            <Button variant="primary" disabled={!!busy} onClick={() => void save()}>
              Save operation schedules
            </Button>
          </Card>
          <Card padding="normal" title={<>Checks and recovery</>}>
            <span className="section-icon">
              <Database size={22} />
            </span>
            <p>
              Backups use a consistent database snapshot, immutable reference bytes and SHA-256 verification. Restores
              require an empty destination.
            </p>
            <div className="operation-actions">
              <Button variant="secondary" disabled={!!busy} onClick={() => void run('backup')}>
                <Archive size={16} />
                {busy === 'backup' ? 'Creating backup…' : 'Create verified backup'}
              </Button>
              <Button variant="secondary" disabled={!!busy} onClick={() => void run('retention')}>
                <Clock3 size={16} />
                {busy === 'retention' ? 'Applying retention…' : 'Apply retention now'}
              </Button>
            </div>
            <FormField
              label={<>Queue warning · seconds</>}
              type="number"
              min="10"
              max="3600"
              value={settings.queue_warning_seconds}
              onChange={(e) => change('queue_warning_seconds', +e.target.value)}
            />
            <FormField
              label={<>Ingestion rejection warning · percent</>}
              type="number"
              min="1"
              max="100"
              value={settings.rejection_warning_percent}
              onChange={(e) => change('rejection_warning_percent', +e.target.value)}
            />
            <p className="small-note">
              Ingestion alerts require at least 20 requests in a five-minute process window. Separate collector replicas
              export their own metrics; absence of counters is not zero rejection.
            </p>
          </Card>
        </div>
      )}
      <Card
        padding="none"
        title={<>Maintenance history</>}
        description={<>Persisted across restarts · timestamps shown in Europe/Bucharest</>}
        actions={
          <>
            <FormField
              label={<>Show per-minute health checks</>}
              type="checkbox"
              checked={showMonitor}
              onChange={(e) => setShowMonitor(e.target.checked)}
            />
          </>
        }
      >
        <RemoteTable<any>
          key={String(showMonitor)}
          name="Maintenance history"
          endpoint={'/api/tables/operations?include_monitor=' + showMonitor}
          defaultSort="started_at"
          reloadToken={data ? Date.parse(data.checked_at) : reloadToken}
          rowId={(r) => r.id}
          columns={[
            {id: 'kind', label: 'OPERATION', value: (r) => r.kind},
            {
              id: 'status',
              label: 'STATUS',
              value: (r) => r.status,
              render: (r) => (
                <span
                  className={
                    'badge ' + (r.status === 'completed' ? 'green' : r.status === 'failed' ? 'orange' : 'neutral')
                  }
                >
                  {r.status}
                </span>
              ),
            },
            {id: 'started_at', label: 'STARTED', value: (r) => r.started_at, render: (r) => format(r.started_at)},
            {
              id: 'finished_at',
              label: 'FINISHED',
              value: (r) => r.finished_at ?? undefined,
              render: (r) => format(r.finished_at),
            },
            {
              id: 'outcome',
              label: 'OUTCOME',
              sortable: false,
              value: (r) => r.error_code ?? '',
              render: (r) => (
                <code>{r.error_code ?? (r.kind === 'backup' ? r.detail.name : JSON.stringify(r.detail))}</code>
              ),
            },
          ]}
        />
      </Card>
      <Card
        padding="none"
        title={<>Service telemetry</>}
        description={<>Route templates and aggregate counters. No visitor IDs, URLs, payloads or IP addresses.</>}
      >
        <CardGrid>
          {data?.telemetry.map((t: any) => (
            <MetricCard
              key={t.service}
              label={<>{t.service}</>}
              value={<>{t.requests.toLocaleString('en-GB')}</>}
              detail={
                <>
                  {t.errors} server errors · exporter {t.exporter_enabled ? 'configured' : 'off'}
                </>
              }
            />
          ))}
        </CardGrid>
      </Card>
    </>
  );
}
