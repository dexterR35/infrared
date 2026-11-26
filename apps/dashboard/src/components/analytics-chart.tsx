import {Button} from './button.js';
import {Card} from './card.js';
import {useId, useState, type ReactNode} from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import {DataTable} from '../data-table.js';
import {Collapsible} from './collapsible.js';
import './analytics-chart.css';

const palette = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];
export type Row = Record<string, any>;
export type Series = {key: string; label: string; color?: string; dashed?: boolean};
const integer = (n: number) => new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0}).format(n);
const format = (n: number, unit: string) =>
  unit === '%'
    ? n.toFixed(1) + '%'
    : unit === 'ms'
      ? integer(n) + ' ms'
      : unit === 'score' || unit === 'decimal'
        ? n.toFixed(3)
        : integer(n);
const dateLabel = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s);

function HoverValues({active, payload, label, unit}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((p: any) => (
        <div key={p.dataKey}>
          <i style={{background: p.color}} />
          <span>{p.name}</span>
          <b>{p.value === null ? 'Unavailable' : format(Number(p.value), unit)}</b>
        </div>
      ))}
    </div>
  );
}

export function ChartPlot({
  rows,
  series,
  x = 'date',
  unit = 'count',
  kind = 'line',
  zoom = false,
  horizontal = false,
  stacked = false,
}: {
  rows: Row[];
  series: Series[];
  x?: string;
  unit?: string;
  kind?: 'line' | 'bar' | 'area';
  zoom?: boolean;
  horizontal?: boolean;
  stacked?: boolean;
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    id = useId();
  const visible = series.filter((s) => !hidden.includes(s.key));
  const hasNumbers = rows.some((r) => visible.some((s) => typeof r[s.key] === 'number'));
  const label = (value: any) => dateLabel(String(value));
  const yTick = (value: any) =>
    unit === '%'
      ? value + '%'
      : unit === 'score' || unit === 'decimal'
        ? Number(value).toFixed(2)
        : integer(Number(value));
  const margin = {top: 14, right: 18, bottom: 8, left: horizontal ? 0 : 2};
  const controls = (
    <div className="chart-legend" aria-label="Visible chart series">
      {series.map((s, i) => (
        <Button
          variant="plain"
          key={s.key}
          type="button"
          aria-pressed={!hidden.includes(s.key)}
          onClick={() =>
            setHidden((list) => (list.includes(s.key) ? list.filter((k) => k !== s.key) : [...list, s.key]))
          }
        >
          <i style={{background: s.color ?? palette[i % palette.length]}} />
          {s.label}
        </Button>
      ))}
    </div>
  );
  const axisX = (
    <XAxis
      dataKey={horizontal ? undefined : x}
      type={horizontal ? 'number' : 'category'}
      allowDecimals={false}
      tickFormatter={horizontal ? yTick : label}
      tick={{fill: 'var(--chart-axis)', fontSize: 11}}
      tickLine={false}
      axisLine={{stroke: 'var(--chart-grid)'}}
      minTickGap={26}
      domain={horizontal && unit === '%' ? [0, 100] : undefined}
    />
  );
  const axisY = (
    <YAxis
      dataKey={horizontal ? x : undefined}
      type={horizontal ? 'category' : 'number'}
      width={horizontal ? 142 : 48}
      tickFormatter={
        horizontal ? (v: any) => (String(v).length > 20 ? String(v).slice(0, 18) + '…' : String(v)) : yTick
      }
      tick={{fill: 'var(--chart-axis)', fontSize: 11}}
      tickLine={false}
      axisLine={false}
      allowDecimals={unit === 'ms' || unit === 'score' || unit === 'decimal'}
      domain={!horizontal && unit === '%' ? [0, 100] : !horizontal && unit === 'score' ? [0, 1] : undefined}
    />
  );
  const grid = (
    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 5" horizontal={!horizontal} vertical={horizontal} />
  );
  const tooltip = (
    <Tooltip
      content={<HoverValues unit={unit} />}
      cursor={kind === 'bar' ? {fill: 'var(--chart-cursor)'} : {stroke: 'var(--chart-axis)', strokeDasharray: '3 3'}}
    />
  );
  const brush =
    zoom && rows.length > 14 ? (
      <Brush
        dataKey={x}
        height={22}
        stroke="var(--chart-axis)"
        fill="var(--chart-brush)"
        tickFormatter={label}
        travellerWidth={8}
      />
    ) : null;
  const common = {data: rows, margin, accessibilityLayer: true};
  return (
    <>
      {controls}
      {hasNumbers ? (
        <div
          className="chart-canvas"
          style={horizontal ? {height: Math.max(180, rows.length * 32)} : undefined}
          aria-describedby={id}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {kind === 'bar' ? (
              <BarChart {...common} layout={horizontal ? 'vertical' : 'horizontal'}>
                {grid}
                {axisX}
                {axisY}
                {tooltip}
                {visible.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color ?? palette[series.indexOf(s) % palette.length]}
                    radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                    maxBarSize={36}
                    stackId={stacked ? 'total' : undefined}
                    isAnimationActive={false}
                  />
                ))}
                {brush}
              </BarChart>
            ) : kind === 'area' ? (
              <AreaChart {...common}>
                {grid}
                {axisX}
                {axisY}
                {tooltip}
                {visible.map((s) => (
                  <Area
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color ?? palette[series.indexOf(s) % palette.length]}
                    fill={s.color ?? palette[series.indexOf(s) % palette.length]}
                    fillOpacity={0.09}
                    strokeWidth={2.5}
                    dot={{r: 3}}
                    activeDot={{r: 5}}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                {brush}
              </AreaChart>
            ) : (
              <LineChart {...common}>
                {grid}
                {axisX}
                {axisY}
                {tooltip}
                {visible.map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color ?? palette[series.indexOf(s) % palette.length]}
                    strokeWidth={2.5}
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                    dot={{r: 3}}
                    activeDot={{r: 5}}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                {brush}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-empty">
          {visible.length
            ? 'No reportable observations for these series.'
            : 'Select a series above to show its observations.'}
        </div>
      )}
      <p className="chart-axis-note" id={id}>
        {unit === 'ms'
          ? 'Milliseconds'
          : unit === '%'
            ? 'Percent'
            : unit === 'score'
              ? 'Score · 0 to 1'
              : unit === 'decimal'
                ? 'Loss'
                : 'Observed counts'}
        {x === 'date' ? ' · calendar days in UTC' : ''}
        {brush ? ' · drag the lower handles to zoom' : ''}
      </p>
      <Collapsible className="chart-data" title="View chart data" lazy>
        <DataTable<Row>
          name="Chart data"
          data={rows}
          rowId={(r) => String(r[x]) + '-' + rows.indexOf(r)}
          resetKey={series.map((s) => s.key).join('|') + '|' + unit + '|' + rows[0]?.[x]}
          columns={[
            {id: x, label: x === 'date' ? 'DATE · UTC' : 'CATEGORY', value: (r) => r[x]},
            ...series.map((s) => ({
              id: s.key,
              label: s.label,
              value: (r: Row) => r[s.key] ?? undefined,
              render: (r: Row) => (typeof r[s.key] === 'number' ? format(r[s.key], unit) : 'Unavailable / suppressed'),
            })),
          ]}
        />
      </Collapsible>
    </>
  );
}

export function ChartCard({
  title,
  description,
  children,
  tools,
  note,
}: {
  title: string;
  description: string;
  children: ReactNode;
  tools?: ReactNode;
  note?: string;
}) {
  return (
    <Card
      title={title}
      description={description}
      actions={tools}
      footer={
        note ? (
          <Collapsible title="About this chart">
            <p>{note}</p>
          </Collapsible>
        ) : undefined
      }
    >
      {children}
    </Card>
  );
}
