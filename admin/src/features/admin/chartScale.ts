/** Clean y-axis ticks for whole-number counts: 0 up to the first multiple of a 1/2/5 step that
 * covers `max`, in at most `count` steps. An empty or all-zero series still gets a 0–1 axis. */
export function countTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** Every how many columns an x-axis label fits, so labels never touch; the last column is
 * always labelled (the day the reader looks for first). */
export function labelEvery(columns: number, columnWidth: number, minGap = 46): number {
  if (columns <= 1 || columnWidth <= 0) return 1;
  return Math.max(1, Math.ceil(minGap / columnWidth));
}

/** How full a capacity is, for the colour of its meter: calm, nearly full, or at the limit. */
export function capacityLevel(ratio: number): 'normal' | 'warning' | 'critical' {
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.75) return 'warning';
  return 'normal';
}

/** A bar's outline: square at the baseline, a `radius` rounded data end. */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottom = y + height;
  return `M ${x} ${bottom} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + width - r} Q ${x + width} ${y} ${x + width} ${y + r} V ${bottom} Z`;
}
