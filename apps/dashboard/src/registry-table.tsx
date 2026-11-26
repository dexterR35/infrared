import {Button} from './components/button.js';
import {ArrowUpRight, LayoutTemplate} from 'lucide-react';
import {selectorURL} from '../../../packages/domain/matcher.js';
import {DataTable} from './data-table.js';
import {
  useInstallationChecks,
  InstallationStatus,
  InstallationDetails,
  InstallationCheckButton,
} from './installation-status.js';

export function RegistryTable({
  pages,
  onSelect,
  onToggle,
  resetKey,
  api,
  role,
  refresh,
}: {
  api: (url: string, body?: unknown, method?: string) => Promise<any>;
  role: string;
  refresh: number;
  pages: any[];
  onSelect: (id: string) => void;
  onToggle: (page: any) => void;
  resetKey: string;
}) {
  const checks = useInstallationChecks(
    api,
    refresh,
    JSON.stringify(pages.map((p) => [p.site_id, p.page_key, p.enabled, p.approval_state])),
  );
  return (
    <>
      {checks.error && (
        <div className="notice error" role="alert">
          {checks.error}
        </div>
      )}
      <DataTable
        name="Pages"
        data={pages}
        rowId={(p) => p.site_id + '/' + p.page_key}
        resetKey={resetKey}
        expandedLabel="More verification details"
        renderExpanded={(p) => <InstallationDetails status={checks.find(p)} />}
        columns={[
          {
            id: 'name',
            label: 'LANDING PAGE',
            value: (p) => p.name,
            render: (p) => (
              <Button variant="plain" className="page-name" onClick={() => onSelect(p.site_id + '/' + p.page_key)}>
                <span className={'page-favicon ' + (p.page_key.includes('christmas') ? 'purple' : '')}>
                  <LayoutTemplate size={19} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{selectorURL(p.selector)}</small>
                </span>
              </Button>
            ),
          },
          {
            id: 'installation',
            label: 'LINK / PIXEL / ACTIVITY',
            value: (p) => checks.find(p)?.collection ?? 'unchecked',
            render: (p) => <InstallationStatus status={checks.find(p)} variant="summary" />,
          },
          {
            id: 'check',
            label: 'VERIFY',
            sortable: false,
            value: (p) => p.page_key,
            render: (p) => <InstallationCheckButton page={p} checks={checks} role={role} />,
          },
          {
            id: 'environment',
            label: 'ENVIRONMENT',
            value: (p) => (p.enabled ? 'Website page' : 'Draft'),
            render: (p) => (
              <span className={'badge ' + (p.enabled ? 'blue' : 'neutral')}>
                {p.enabled ? 'Website page' : 'Draft'}
              </span>
            ),
          },
          {
            id: 'collection',
            label: 'COLLECTION',
            value: (p) =>
              p.enabled ? 'Collection enabled' : p.approval_state === 'pending' ? 'Pending approval' : 'Paused',
            render: (p) => (
              <Button
                variant="plain"
                className="status-button"
                onClick={() => onToggle(p)}
                title={p.enabled ? 'Pause collection' : 'Resume local collection'}
              >
                <span className={'badge ' + (p.enabled ? 'green' : 'neutral')}>
                  <span className="dot" />
                  {p.enabled ? 'Collection enabled' : p.approval_state === 'pending' ? 'Pending approval' : 'Paused'}
                </span>
              </Button>
            ),
          },

          {
            id: 'revision',
            label: 'REVISION',
            value: (p) => p.revision,
            render: (p) => <code className="revision">{p.revision}</code>,
          },
          {
            id: 'actions',
            label: '',
            sortable: false,
            value: (p) => p.page_key,
            render: (p) => (
              <Button variant="plain" className="row-action" onClick={() => onSelect(p.site_id + '/' + p.page_key)}>
                View heatmap <ArrowUpRight size={15} />
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}
