import {Card, CardGrid} from './components/card.js';

type Bucket = {key: string; views: number; activated: number; activation_rate: number};
type Breakdown = {rows: Bucket[]; other: {views: number}; unknown: number; suppressed_buckets: number};
const labels: Record<string, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  chromeos: 'ChromeOS',
  chrome: 'Chrome',
  safari: 'Safari',
  edge: 'Edge',
  firefox: 'Firefox',
  samsung: 'Samsung Internet',
  opera: 'Opera',
  other: 'Other',
  direct: 'Direct',
  search: 'Search',
  social: 'Social',
  referral: 'Referral',
  campaign: 'Campaign',
  email: 'Email',
};
const nice = (k: string) => labels[k] ?? k;
const country = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], {type: 'region'}).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

function Bars({title, data, format = nice}: {title: string; data?: Breakdown; format?: (k: string) => string}) {
  const rows = data?.rows ?? [],
    other = data?.other.views ?? 0,
    total = rows.reduce((n, r) => n + r.views, 0) + other;
  return (
    <Card title={title}>
      {!rows.length ? (
        <p className="ui-card-detail">Not enough views yet</p>
      ) : (
        <ul className="ui-card-meters">
          {rows.map((r) => (
            <li key={r.key}>
              <span>{format(r.key)}</span>
              <meter min={0} max={100} value={(100 * r.views) / total} aria-label={format(r.key)} />
              <b>{Math.round((100 * r.views) / total)}%</b>
            </li>
          ))}
          {other > 0 && (
            <li>
              <span>Other / small groups</span>
              <meter min={0} max={100} value={(100 * other) / total} aria-label="Other or small groups" />
              <b>{Math.round((100 * other) / total)}%</b>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

export function AudiencePanel({report, minimum}: {report: any; minimum: number}) {
  const a = report?.behaviour?.audience;
  if (!report || report.suppressed || !a) return null;
  // Screen sizes come straight from per-width view counts; small sizes are grouped like every other breakdown.
  const widths = (report.width_views ?? []) as {width: number; views: number}[],
    big = widths.filter((w) => w.views >= minimum),
    small = widths.filter((w) => w.views < minimum).reduce((n, w) => n + w.views, 0);
  const sizes: Breakdown = {
    rows: big
      .sort((x, y) => y.views - x.views)
      .map((w) => ({key: w.width + ' px', views: w.views, activated: 0, activation_rate: 0})),
    other: {views: small},
    unknown: 0,
    suppressed_buckets: 0,
  };
  return (
    <Card
      padding="none"
      aria-label="Audience"
      title={<>Audience</>}
      description={
        <>
          Who viewed this page in the selected period and device. Groups with fewer than {minimum} views are combined
          into “Other”.
        </>
      }
    >
      <CardGrid>
        <Bars title="Device" data={a.device} />
        <Bars title="Screen size" data={sizes} format={(k) => k} />
        <Bars title="Browser" data={a.browser} />
        <Bars title="Operating system" data={a.os} />
        <Bars title="Country" data={a.country} format={country} />
        <Bars title="Language" data={a.language} format={(k) => k.toUpperCase()} />
        <Bars title="Traffic source" data={a.channel} />
        <Bars title="Campaign (UTM)" data={a.utm_campaign} format={(k) => k} />
      </CardGrid>
      <p className="small-note">
        Only visitors who accepted analytics are counted. No browser or system versions, phone models, IP addresses or
        exact screen resolutions are stored.
      </p>
    </Card>
  );
}
