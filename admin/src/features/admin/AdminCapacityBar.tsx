import { capacityLevel } from './chartScale';

const FILL = { normal: 'bg-accent-primary', warning: 'bg-state-warning', critical: 'bg-state-critical' } as const;

export function AdminCapacityBar({ value, max, label, valueText }: {
  value: number;
  max: number;
  label?: string;
  valueText?: string;
}) {
  if (!(max > 0)) return null;
  const bounded = Math.max(0, Math.min(value, max));
  const percent = (bounded / max) * 100;
  const accessibility = label
    ? { role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': bounded, 'aria-valuetext': valueText }
    : { 'aria-hidden': true };

  return (
    <div {...accessibility} className="h-2 overflow-hidden rounded-full bg-fill-hover">
      <div
        className={`h-full rounded-full ${FILL[capacityLevel(value / max)]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
