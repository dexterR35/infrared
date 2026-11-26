import {FormField} from './components/form-field.js';
import {FilterBar, FilterFields} from './components/filter-bar.js';
import {Collapsible} from './components/collapsible.js';
import {deviceForWidth} from '../../../packages/domain/metrics.js';

type Props = {
  nav: string;
  pages: any[];
  experiments: any[];
  page: any;
  report: any;
  selected: string;
  device: string;
  width: string;
  campaign: string;
  experimentId: string;
  variant: string;
  mapping: string;
  revision: string;
  from: string;
  to: string;
  onPage: (value: string) => void;
  onDevice: (value: string) => void;
  onWidth: (value: string) => void;
  onCampaign: (value: string) => void;
  onExperiment: (value: string) => void;
  onVariant: (value: string) => void;
  onMapping: (value: string) => void;
  onRevision: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
};

export function HeatmapFilters(props: Props) {
  const {
    nav,
    pages,
    experiments,
    page,
    report,
    selected,
    device,
    width,
    campaign,
    experimentId,
    variant,
    mapping,
    revision,
    from,
    to,
  } = props;
  const pageExperiments = experiments.filter(
    (experiment) => experiment.site_id === page?.site_id && experiment.page_key === page?.page_key,
  );
  const observed = report?.width_views?.length
    ? report.width_views
    : (report?.widths ?? [390, 768, 1024, 1440, 1920]).map((value: number) => ({width: value}));
  const widths = [
    ...observed,
    ...(width && !observed.some((row: any) => String(row.width) === width) ? [{width: Number(width)}] : []),
  ]
    .filter((row: any) => deviceForWidth(row.width) === device)
    .sort((a: any, b: any) => a.width - b.width);
  const variants = [
    ...new Set([
      page?.variant,
      ...(report?.variants ?? []),
      ...pageExperiments.flatMap((experiment) => [experiment.control_variant, experiment.treatment_variant]),
    ]),
  ].filter(Boolean);
  const revisions = [...new Set([page?.revision, ...(report?.revisions ?? [])])].filter(Boolean);
  return (
    <FilterBar label="Page activity filters" columns={6}>
      <FormField
        category="select"
        label="Landing page"
        value={selected}
        onChange={(event) => props.onPage(event.target.value)}
        disabled={!pages.length}
      >
        {!pages.length && <option value="">No pages available</option>}
        {pages.map((item) => (
          <option key={item.site_id + '/' + item.page_key} value={item.site_id + '/' + item.page_key}>
            {item.name}
          </option>
        ))}
      </FormField>
      <FormField
        category="select"
        label="Device"
        value={device}
        onChange={(event) => props.onDevice(event.target.value)}
      >
        {['desktop', 'tablet', 'mobile'].map((value) => (
          <option key={value} value={value}>
            {value[0].toUpperCase() + value.slice(1)}
          </option>
        ))}
      </FormField>
      <FormField
        category="select"
        label="Viewport width"
        value={width}
        onChange={(event) => props.onWidth(event.target.value)}
      >
        <option value="">All {device} sizes · combined</option>
        {widths.map((row: any) => (
          <option key={row.width} value={row.width}>
            {row.width} px{row.views != null ? ` · ${row.views} ${row.views === 1 ? 'view' : 'views'}` : ''}
          </option>
        ))}
      </FormField>
      <FormField
        category="select"
        label="Approved campaign"
        value={campaign}
        onChange={(event) => props.onCampaign(event.target.value)}
      >
        <option value="">All campaign codes</option>
        {(page?.campaign_codes ?? ['unknown']).map((code: string) => (
          <option key={code} value={code}>
            {code === 'unknown' ? 'No campaign code (normal visits)' : code}
          </option>
        ))}
      </FormField>
      <FormField
        label="From · UTC"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(event) => props.onFrom(event.target.value)}
      />
      <FormField
        label="Through · UTC"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(event) => props.onTo(event.target.value)}
      />
      {['heatmaps', 'funnels', 'diagnostics', 'references', 'versions'].includes(nav) && (
        <Collapsible title="More filters" description="Experiment, variant, mapping and revision">
          <FilterFields>
            <FormField
              category="select"
              label="Experiment"
              aria-label="Heatmap experiment"
              value={experimentId}
              onChange={(event) => props.onExperiment(event.target.value)}
            >
              <option value="">All observed activity</option>
              {pageExperiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.name}
                </option>
              ))}
            </FormField>
            <FormField
              category="select"
              label="Variant"
              aria-label="Heatmap variant"
              value={variant || page?.variant || ''}
              onChange={(event) => props.onVariant(event.target.value)}
            >
              {!variants.length && <option value="">No variants observed</option>}
              {variants.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </FormField>
            {nav === 'heatmaps' && (
              <>
                <FormField
                  category="select"
                  label="Mapping"
                  aria-label="Heatmap mapping"
                  value={mapping}
                  onChange={(event) => props.onMapping(event.target.value)}
                >
                  <option value="document">Exact viewport positions</option>
                  <option value="element">Registered-element positions</option>
                </FormField>
                <FormField
                  category="select"
                  label="Revision"
                  aria-label="Page revision"
                  value={revision || page?.revision || ''}
                  onChange={(event) => props.onRevision(event.target.value)}
                >
                  {!revisions.length && <option value="">No revisions observed</option>}
                  {revisions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </FormField>
              </>
            )}
          </FilterFields>
        </Collapsible>
      )}
    </FilterBar>
  );
}
