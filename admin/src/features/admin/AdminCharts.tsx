import { useId, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useLanguage } from '@/i18n/useLanguage';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { cn } from '@/shared/lib/utils';
import { barPath, capacityLevel, countTicks, labelEvery } from './chartScale';

export interface ChartPoint {
  key: string;
  /** under the column, short (`28/11`) */
  axisLabel: string;
  /** in the tooltip and the screen-reader list (`sex., 28 de nov.`) */
  fullLabel: string;
  /** null: no sample that day, drawn as a gap rather than a zero */
  value: number | null;
}

const LEVEL_COLOR = {
  normal: 'var(--color-accent-primary)',
  warning: 'var(--color-state-warning)',
  critical: 'var(--color-state-critical)',
} as const;

const PLOT_TOP = 14;
const AXIS_HEIGHT = 24;

/** One series over days, as a line with a wash under it (`line`) or as columns (`bar`). Hovering
 * a day shows its value; the same values are listed for screen readers, so nothing is in the
 * drawing alone. Missing days break the line instead of falling to zero. */
export function TimeSeriesChart({ label, points, kind, emptyText, formatValue, color = 'var(--color-chart-1)', height = 188 }: {
  label: string;
  points: ChartPoint[];
  kind: 'line' | 'bar';
  emptyText: string;
  /** the value as the tooltip and the list write it; a plain number by default */
  formatValue?: (value: number) => string;
  color?: string;
  height?: number;
}) {
  const language = useLanguage();
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(boxRef) || 480;
  const gradientId = `chart${useId().replace(/[^\w-]/g, '')}`;
  const [hovered, setHovered] = useState<number | null>(null);
  const compact = new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(language);
  const format = formatValue ?? ((value: number) => number.format(value));

  const values = points.map((p) => p.value);
  const hasData = values.some((v) => v !== null);
  const ticks = countTicks(Math.max(0, ...values.map((v) => v ?? 0)));
  const ceiling = ticks[ticks.length - 1];
  const left = 10 + Math.max(...ticks.map((tick) => compact.format(tick).length)) * 7;
  const right = 6;
  const baseline = height - AXIS_HEIGHT;
  const y = (value: number) => baseline - (value / ceiling) * (baseline - PLOT_TOP);
  const columnWidth = (width - left - right) / Math.max(1, points.length);
  const x = (index: number) => left + (index + 0.5) * columnWidth;
  const every = labelEvery(points.length, columnWidth);
  const barWidth = Math.max(3, Math.min(24, columnWidth * 0.62));

  // contiguous runs of observed days: one line and one wash each
  const runs: { index: number; value: number }[][] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    const previous = runs[runs.length - 1];
    if (previous && previous[previous.length - 1].index === index - 1) previous.push({ index, value: point.value });
    else runs.push([{ index, value: point.value }]);
  });
  const line = runs.map((run) => run.map(({ index, value }, i) => `${i === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`).join(' ')).join(' ');

  function track(event: ReactPointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width > 0 ? width / box.width : 1;
    const index = Math.floor(((event.clientX - box.left) * scale - left) / columnWidth);
    setHovered(index >= 0 && index < points.length ? index : null);
  }

  const hover = hovered === null ? null : points[hovered];
  const tooltipLeft = hovered === null ? 0 : Math.min(Math.max(x(hovered), 70), width - 70);
  const tooltipTop = hover?.value == null ? PLOT_TOP : Math.max(0, y(hover.value) - 12);

  return (
    <div ref={boxRef} className="relative">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full touch-pan-y overflow-visible text-caption tabular-nums select-none"
        onPointerMove={hasData ? track : undefined}
        onPointerDown={hasData ? track : undefined}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--color-chart-grid)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-text-faint">{compact.format(tick)}</text>
          </g>
        ))}
        {!hasData && <text x={(width + left) / 2} y={baseline / 2 + 6} textAnchor="middle" className="fill-text-muted text-label">{emptyText}</text>}
        {hasData && hovered !== null && (
          kind === 'bar'
            ? <rect x={x(hovered) - columnWidth / 2} y={PLOT_TOP} width={columnWidth} height={baseline - PLOT_TOP} rx={4} className="fill-fill-subtle" />
            : <line x1={x(hovered)} x2={x(hovered)} y1={PLOT_TOP} y2={baseline} stroke="var(--color-border-strong)" strokeWidth={1} shapeRendering="crispEdges" />
        )}
        {hasData && kind === 'line' && (
          <>
            {runs.filter((run) => run.length > 1).map((run) => (
              <path key={run[0].index} data-series="area" fill={`url(#${gradientId})`}
                d={`M ${x(run[0].index)} ${baseline} ${run.map(({ index, value }) => `L ${x(index)} ${y(value)}`).join(' ')} L ${x(run[run.length - 1].index)} ${baseline} Z`} />
            ))}
            <path data-series="line" d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {runs.flat().map(({ index, value }) => (
              <circle key={index} cx={x(index)} cy={y(value)} r={hovered === index ? 5.5 : 4} fill={color} stroke="var(--color-surface-panel)" strokeWidth={2} />
            ))}
          </>
        )}
        {hasData && kind === 'bar' && points.map((point, index) => point.value !== null && (
          point.value > 0
            ? <path key={point.key} data-series="bar" d={barPath(x(index) - barWidth / 2, y(point.value), barWidth, baseline - y(point.value))} fill={color}
                opacity={hovered === null || hovered === index ? 1 : 0.55} className="transition-opacity" />
            : <rect key={point.key} x={x(index) - barWidth / 2} y={baseline - 2} width={barWidth} height={2} rx={1} fill="var(--color-border-strong)" />
        ))}
        {points.map((point, index) => (index % every === (points.length - 1) % every) && (
          <text key={point.key} x={x(index)} y={height - 6} textAnchor="middle" className={hovered === index ? 'fill-text-primary' : 'fill-text-faint'}>{point.axisLabel}</text>
        ))}
      </svg>
      {hover && (
        <div aria-hidden className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border-default bg-surface-overlay px-3 py-2 shadow-lg shadow-black/40"
          style={{ left: tooltipLeft, top: tooltipTop }}>
          <p className="text-caption whitespace-nowrap text-text-muted">{hover.fullLabel}</p>
          <p className="mt-0.5 flex items-center gap-2 text-label font-semibold whitespace-nowrap text-text-strong tabular-nums">
            <span className="size-2.5 rounded-full" style={{ background: color }} />
            {hover.value === null ? emptyText : format(hover.value)}
          </p>
        </div>
      )}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.key}><time dateTime={point.key}>{point.axisLabel}</time>{' · '}{point.value === null ? emptyText : format(point.value)}</li>
        ))}
      </ul>
    </div>
  );
}

/** A small trend line for a stat tile: decoration beside a number that is already written out. */
export function Sparkline({ values, color = 'var(--color-chart-1)', className }: { values: number[]; color?: string; className?: string }) {
  const gradientId = `chart${useId().replace(/[^\w-]/g, '')}`;
  if (values.length < 2) return null;
  const width = 120;
  const height = 36;
  const peak = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const coords = values.map((value, i) => [i * step, height - 2 - (value / peak) * (height - 6)] as const);
  const line = coords.map(([cx, cy], i) => `${i === 0 ? 'M' : 'L'} ${cx} ${cy}`).join(' ');
  return (
    <svg aria-hidden viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('block h-9 w-full overflow-visible', className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface DonutSegment { key: string; label: string; value: number; color: string }

/** Parts of one whole (a queue by status, accounts by state), with the total in the middle. The
 * legend beside it names every part with its count and share, so colour is never the only cue;
 * hovering a part or its legend row puts that part in the middle. */
export function DonutChart({ label, segments, totalLabel, emptyText, size = 152, thickness = 16 }: {
  label: string;
  segments: DonutSegment[];
  /** under the total in the middle (`denúncias`) */
  totalLabel: string;
  emptyText: string;
  size?: number;
  thickness?: number;
}) {
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((segment) => segment.value > 0);
  const gap = visible.length > 1 ? 3 : 0;
  const lengths = visible.map((segment) => (segment.value / total) * circumference);
  const arcs = visible.map((segment, i) => ({
    segment,
    dash: Math.max(0.5, lengths[i] - gap),
    offset: lengths.slice(0, i).reduce((sum, length) => sum + length, 0),
  }));
  const focus = segments.find((segment) => segment.key === active);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="relative mx-auto flex-none @[420px]:mx-0" style={{ width: size, height: size }}>
        <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-fill-hover)" strokeWidth={thickness} />
          {arcs.map(({ segment, dash, offset: start }) => (
            <circle key={segment.key} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-start}
              opacity={active === null || active === segment.key ? 1 : 0.35}
              className="cursor-default transition-opacity"
              onPointerEnter={() => setActive(segment.key)} onPointerLeave={() => setActive(null)} />
          ))}
        </svg>
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-[1.625rem] leading-none font-bold tracking-tight text-text-strong tabular-nums">{number.format(focus ? focus.value : total)}</span>
          <span className="mt-1 max-w-[6.5rem] truncate text-caption text-text-muted">{focus ? focus.label : total === 0 ? emptyText : totalLabel}</span>
        </div>
      </div>
      <ul className="flex min-w-40 flex-1 flex-col gap-1">
        {segments.map((segment) => (
          <li key={segment.key} onPointerEnter={() => setActive(segment.key)} onPointerLeave={() => setActive(null)}
            className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-label transition-colors', active === segment.key && 'bg-fill-subtle')}>
            <span aria-hidden className="size-2.5 flex-none rounded-full" style={{ background: segment.color }} />
            <span className="min-w-0 flex-1 truncate text-text-secondary">{segment.label}</span>
            <span className="font-semibold text-text-strong tabular-nums">{number.format(segment.value)}</span>
            <span className="w-10 text-right text-caption text-text-muted tabular-nums">{total > 0 ? percent.format(segment.value / total) : '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How full a capacity is, as a three-quarter ring that turns amber near the limit and red at it.
 * Exposed as a meter; `valueText` says the same thing in words. */
export function RadialGauge({ label, value, max, valueText, caption, size = 112 }: {
  label: string;
  value: number;
  max: number;
  valueText: string;
  /** under the ring: what the number is out of (`12 de 500`) */
  caption?: string;
  size?: number;
}) {
  const language = useLanguage();
  const bounded = Math.max(0, Math.min(value, max));
  const ratio = max > 0 ? bounded / max : 0;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const sweep = 0.75;
  const circumference = 2 * Math.PI * radius;
  const track = circumference * sweep;
  const level = capacityLevel(max > 0 ? value / max : 0);
  const style = { '--gauge': LEVEL_COLOR[level] } as CSSProperties;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={bounded} aria-valuetext={valueText}
      className="flex min-w-0 flex-col items-center gap-2 text-center" style={style}>
      <div className="relative" style={{ width: size, height: size * 0.86 }}>
        <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="block rotate-135" style={{ width: size, height: size }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-fill-hover)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${track} ${circumference}`} />
          {ratio > 0 && (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--gauge)" strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${Math.max(0.01, track * ratio)} ${circumference}`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500" />
          )}
        </svg>
        <span aria-hidden className="absolute inset-x-0 top-[38%] -translate-y-1/2 text-[1.375rem] leading-none font-bold tracking-tight text-text-strong tabular-nums">
          {new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(max > 0 ? value / max : 0)}
        </span>
      </div>
      <div className="-mt-3 min-w-0">
        <p className="text-label font-semibold text-text-primary">{label}</p>
        {caption && <p className="text-caption text-text-muted tabular-nums">{caption}</p>}
      </div>
    </div>
  );
}

/** Where a gauge would be, for a capacity with no limit: the amount alone. */
export function UnboundedFigure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-[1.375rem] font-bold tracking-tight text-text-strong tabular-nums">{value}</span>
      <span className="text-label font-semibold text-text-primary">{label}</span>
      <span className="text-caption text-text-muted">{note}</span>
    </div>
  );
}
