import {ArrowDown, BarChart3, ShieldCheck} from 'lucide-react';
import {Card} from './components/card.js';

const number = (value: number) => new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0}).format(value);
export function HeatmapInsights({report}: {report: any}) {
  const summary = report && !report.suppressed ? report.summary : null,
    quality = report && !report.suppressed ? report.quality : null;
  return (
    <aside className="insights">
      <Card title="At a glance" icon={BarChart3} footer="Observations of tracked views, with best-effort delivery.">
        <p className="ui-card-detail">THIS SELECTED COHORT</p>
        <strong className="ui-card-value">{summary ? number(summary.activated_views) : '—'}</strong>
        <p className="ui-card-detail">activated views</p>
        <p>
          Views with an observed <code>{report?.page?.primary_action_id ?? 'primary'}</code> action. Completion is not
          inferred.
        </p>
        <dl className="ui-card-facts">
          <div>
            <dt>Qualified CTA exposure</dt>
            <dd>{summary ? number(summary.exposed_views) : '—'}</dd>
          </div>
          <div>
            <dt>Exposed-view activation</dt>
            <dd>{summary?.exposed_views ? summary.exposed_activation_rate.toFixed(1) + '%' : '—'}</dd>
          </div>
          <div>
            <dt>Average visible time</dt>
            <dd>{summary ? Math.round(summary.avg_visible_seconds) + 's' : '—'}</dd>
          </div>
        </dl>
      </Card>
      <Card
        title="Scroll reach"
        icon={ArrowDown}
        description="Share of viewport segments reaching each depth."
        footer="Reach is not proof of reading."
      >
        <div className="ui-card-meters">
          {[25, 50, 75, 100].map((depth) => {
            const observation =
              report && !report.suppressed ? report.scroll?.find((row: any) => row.depth === depth) : null;
            const value = observation?.percent;
            return (
              <div key={depth}>
                <span>{depth}%</span>
                <meter min={0} max={100} value={value ?? 0} aria-label={'Segments reaching ' + depth + '% depth'} />
                <b>{value != null ? Math.round(value) + '%' : '—'}</b>
              </div>
            );
          })}
        </div>
      </Card>
      <Card
        title="Map coverage"
        icon={ShieldCheck}
        footer={
          quality
            ? `${quality.sample_rate * 100}% sample · Aggregation v${quality.aggregation_version}`
            : 'No reportable coverage yet'
        }
      >
        <dl className="ui-card-facts">
          {[
            ['Mapped observations', 'mapped'],
            ['Incompatible layout', 'incompatible'],
            ['Unsupported geometry', 'unsupported'],
          ].map(([label, key]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{quality ? number(quality[key] ?? 0) : '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </aside>
  );
}
