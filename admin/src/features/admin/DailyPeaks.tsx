import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { TimeSeriesChart } from './AdminCharts';
import { AdminSection } from './AdminSection';
import type { CallMetricDay } from './adminApi';
import { chartDay } from './adminFormat';

/** The week's daily peak of one call metric, with the week's highest and today's beside the title. */
export function DailyPeaks({ title, days, metric, color, action }: {
  title: string;
  days: CallMetricDay[];
  metric: 'calls' | 'screens';
  color?: string;
  /** a link beside the figures, such as to the full history */
  action?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const points = days.map((day) => ({ key: day.day, value: day[metric], ...chartDay(day.day, language) }));
  const observed = points.flatMap((point) => point.value === null ? [] : [point.value]);
  const today = points[points.length - 1]?.value ?? null;
  return (
    <AdminSection title={title} actions={(observed.length > 0 || action) && (
      <div className="flex items-start gap-4">
      {observed.length > 0 && <dl className="flex gap-5 text-right">
        <div>
          <dt className="text-caption text-text-muted">{t('metrics.weekPeak')}</dt>
          <dd className="text-title font-semibold text-text-strong tabular-nums">{number.format(Math.max(...observed))}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('metrics.today')}</dt>
          <dd className="text-title font-semibold text-text-strong tabular-nums">{today === null ? '–' : number.format(today)}</dd>
        </div>
      </dl>}
      {action}
      </div>
    )}>
      <TimeSeriesChart label={title} kind="line" points={points} color={color} emptyText={t('metrics.noData')} />
    </AdminSection>
  );
}
