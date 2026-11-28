import type { CSSProperties, ReactNode } from 'react';
import { CallIcon, ScreenShareIcon, UsersIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { AdminNotice } from './AdminNotice';
import { AdminSection } from './AdminSection';
import { formatWhenShort } from './adminFormat';
import type { useAdminCallMetrics } from './adminResources';

export function CallMetricsSummary({ metrics, actions, showAccountsInCall }: {
  metrics: ReturnType<typeof useAdminCallMetrics>;
  actions?: ReactNode;
  showAccountsInCall?: boolean;
}) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const current = metrics.data?.info.current;
  const cards = [
    { label: t('metrics.activeCalls'), value: current?.calls, icon: CallIcon, color: 'var(--color-violet)' },
    { label: t('metrics.transmittingScreens'), value: current?.screens?.count, icon: ScreenShareIcon, color: 'var(--color-chart-1)' },
  ];
  if (showAccountsInCall) cards.push({ label: t('metrics.accountsInCall'), value: current?.accountsInCall, icon: UsersIcon, color: 'var(--color-chart-3)' });
  const content = (
    <dl className="grid grid-cols-2 gap-3 @[600px]:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div key={label} style={{ '--tile-color': color } as CSSProperties}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 rounded-lg border border-border-divider bg-fill-subtle px-4 py-3.5 last:odd:col-span-2 @[600px]:last:odd:col-span-1">
          <span className="admin-icon-tile row-span-2 size-10"><Icon size={20} aria-hidden /></span>
          <dt className="self-end text-caption font-medium text-text-muted">{label}</dt>
          <dd className="self-start break-words text-[1.5rem] leading-tight font-bold tracking-tight text-text-strong tabular-nums">
            {metrics.status === 'loading' ? <Skeleton className="h-6 w-12" /> : value === undefined ? t('metrics.unavailable') : number.format(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
  const observed = current && new Date(current.at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <AdminSection title={t('metrics.liveActivity')} description={observed && t('common.lastRead', { time: observed })} actions={actions}>
      {metrics.status === 'loading' ? <SkeletonGroup label={t('chrome.loading')}>{content}</SkeletonGroup> : content}
      {(metrics.refreshFailed || metrics.status === 'error' || metrics.status === 'missing') && (
        <AdminNotice tone="warning">{t(metrics.refreshFailed ? 'metrics.refreshFailed' : 'metrics.loadFailed')}</AdminNotice>
      )}
      {current?.screens?.stale && (
        <AdminNotice tone="warning">{t('metrics.screensStale', { time: formatWhenShort(current.screens.at, language) })}</AdminNotice>
      )}
    </AdminSection>
  );
}
