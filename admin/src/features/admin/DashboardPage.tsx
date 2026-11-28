import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/i18n/useLanguage';
import { categoryLabel } from '@/features/reports/reportCategories';
import { AppLink } from '@/shared/ui/app-link';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ArrowRightIcon, CallIcon, CaretRightIcon, CheckCircleIcon, PulseIcon, RefreshIcon, SquaresFourIcon, UsersIcon, WarningIcon, type IconComponent } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { formatFileSize } from '@/shared/lib/formatBytes';
import { AdminNotice } from './AdminNotice';
import { DonutChart, RadialGauge, Sparkline, TimeSeriesChart, UnboundedFigure } from './AdminCharts';
import { DailyPeaks } from './DailyPeaks';
import { AdminPageTitle, AdminSection } from './AdminSection';
import { AuditList } from './adminUi';
import { AuditListSkeleton } from './AdminSkeletons';
import { fetchAdminReports, fetchAudit, type AdminInsights, type AdminReportRow, type Page, type SystemInfo } from './adminApi';
import { chartDay, formatWhenShort } from './adminFormat';
import { useAdminDetail } from './useAdminDetail';
import { useAdminCallMetrics, useAdminInsights, useAdminSystem } from './adminResources';

const readAudit = () => fetchAudit({}, null);
const readReports = () => fetchAdminReports({ status: 'open' }, null);

const REPORT_COLORS = {
  open: 'var(--color-state-warning)',
  reviewing: 'var(--color-chart-1)',
  resolved: 'var(--color-state-good)',
  dismissed: 'var(--color-surface-500)',
} as const;

/** A headline number with the colour of its area, what it is out of, and its trend when there is one. */
function StatCard({ icon: Icon, color, label, value, detail, to, trend, meter }: {
  icon: IconComponent;
  color: string;
  label: string;
  value?: string;
  detail?: ReactNode;
  to: string;
  trend?: number[];
  meter?: number;
}) {
  return (
    <AppLink to={to} style={{ '--tile-color': color } as CSSProperties}
      className="admin-panel group @container relative flex min-w-0 flex-col gap-3 overflow-hidden p-3.5 focus-ring transition-colors hover:border-border-strong @[640px]:gap-4 @[640px]:p-5">
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-[0.07] blur-2xl" style={{ background: color }} />
      <div className="flex items-center justify-between gap-2">
        <span className="admin-icon-tile size-8 @[15rem]:size-9"><Icon size={18} aria-hidden /></span>
        <CaretRightIcon size={16} aria-hidden className="text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" />
      </div>
      <div className="flex min-w-0 flex-col gap-2 @[15rem]:flex-row @[15rem]:items-end @[15rem]:justify-between @[15rem]:gap-3">
        <div className="min-w-0">
          <p className="text-caption font-medium text-text-muted @[15rem]:text-label">{label}</p>
          <div className="mt-1 text-[clamp(1.5rem,1.2rem+1vw,2rem)] leading-tight font-bold tracking-tight wrap-anywhere text-text-strong tabular-nums">
            {value ?? <Skeleton className="my-1.5 h-6 w-16" />}
          </div>
          {detail
            ? <p className="mt-1 text-caption wrap-anywhere text-text-muted">{detail}</p>
            : value === undefined && <Skeleton shape="text" className="mt-2 h-2.5 w-24" />}
        </div>
        {trend && <Sparkline values={trend} color={color} className="w-full flex-none @[15rem]:w-24 @[20rem]:w-28" />}
      </div>
      {meter !== undefined && (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-fill-hover">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%`, background: color }} />
        </div>
      )}
    </AppLink>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <AppLink to={to} className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'h-7 gap-1.5 px-2 text-text-secondary [&_svg]:size-3.5' })}>
      {children}<ArrowRightIcon size={14} aria-hidden />
    </AppLink>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p className="my-auto py-6 text-center text-label text-text-muted">{children}</p>;
}

function ChartSkeleton() {
  return <Skeleton className="h-47 w-full rounded-lg" />;
}

function Headline({ system, insights, callMetrics }: {
  system?: SystemInfo;
  insights?: AdminInsights;
  callMetrics: ReturnType<typeof useAdminCallMetrics>;
}) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const current = callMetrics.data?.info.current;
  const accounts = system?.accounts;
  const online = current?.onlineAccounts ?? system?.connections.onlineAccounts;
  const newAccounts = insights?.days.reduce((sum, day) => sum + day.accounts, 0);
  const newServers = insights?.days.reduce((sum, day) => sum + day.servers, 0);

  return (
    <div className="grid grid-cols-2 gap-3 @[1100px]:grid-cols-4 @[760px]:gap-4">
      <StatCard icon={UsersIcon} color="var(--color-chart-1)" label={t('overview.totalAccounts')} to="/admin/users"
        value={accounts && number.format(accounts.total)}
        detail={newAccounts !== undefined
          ? t('overview.lastMonth', { formatted: number.format(newAccounts) })
          : accounts && t('overview.newAccounts', { count: accounts.newLastHour, formatted: number.format(accounts.newLastHour) })}
        trend={insights?.days.map((day) => day.accounts)} />
      <StatCard icon={PulseIcon} color="var(--color-chart-3)" label={t('overview.onlineNow')} to="/admin/system"
        value={online === undefined ? undefined : number.format(online)}
        detail={accounts && online !== undefined && accounts.total > 0 && t('overview.onlineShare', { percent: percent.format(online / accounts.total) })}
        meter={accounts && online !== undefined && accounts.total > 0 ? online / accounts.total : undefined} />
      <StatCard icon={CallIcon} color="var(--color-violet)" label={t('metrics.activeCalls')} to="/admin/call-metrics"
        value={current && number.format(current.calls)}
        detail={current && [
          t('overview.inCall', { count: current.accountsInCall, formatted: number.format(current.accountsInCall) }),
          current.screens && t('overview.screens', { count: current.screens.count, formatted: number.format(current.screens.count) }),
        ].filter(Boolean).join(' · ')} />
      <StatCard icon={SquaresFourIcon} color="var(--color-chart-2)" label={t('nav.servers')} to="/admin/servers"
        value={insights && number.format(insights.servers.total)}
        detail={newServers !== undefined && t('overview.lastMonth', { formatted: number.format(newServers) })}
        trend={insights?.days.map((day) => day.servers)} />
    </div>
  );
}

function SignupsChart({ insights, status }: { insights?: AdminInsights; status: ReturnType<typeof useAdminInsights>['status'] }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const total = insights?.days.reduce((sum, day) => sum + day.accounts, 0);
  return (
    <AdminSection title={t('overview.signupsTitle')}
      description={insights && t('overview.signupsDescription', { timeZone: insights.timeZone })}
      actions={total !== undefined && (
        <div className="text-right">
          <p className="text-caption text-text-muted">{t('overview.inThirtyDays')}</p>
          <p className="text-title font-semibold text-text-strong tabular-nums">{number.format(total)}</p>
        </div>
      )}>
      {insights
        ? <TimeSeriesChart kind="bar" label={t('overview.signupsTitle')} emptyText={t('metrics.noData')}
            points={insights.days.map((day) => ({ key: day.day, value: day.accounts, ...chartDay(day.day, language) }))}
            formatValue={(value) => t('overview.signupsValue', { count: value, formatted: number.format(value) })} />
        : status === 'loading' ? <ChartSkeleton /> : <Unavailable>{t('overview.insightsUnavailable')}</Unavailable>}
    </AdminSection>
  );
}

function CapacityPanel({ info }: { info?: SystemInfo }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const percent = (value: number, max: number) => new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(value / max);
  const { connections, storage } = info ?? {};
  return (
    <AdminSection title={t('overview.capacity')} actions={<PanelLink to="/admin/system">{t('overview.viewSystem')}</PanelLink>}>
      {connections && storage ? (
        <div className="grid flex-1 grid-cols-2 place-items-center gap-4 py-2">
          {connections.max > 0
            ? <RadialGauge label={t('common.liveConnections')} value={connections.live} max={connections.max}
                valueText={t('overview.gaugeValue', { percent: percent(connections.live, connections.max) })}
                caption={t('overview.gaugeOf', { value: number.format(connections.live), max: number.format(connections.max) })} />
            : <UnboundedFigure label={t('common.liveConnections')} value={number.format(connections.live)} note={t('overview.noLimit')} />}
          {storage.maxBytes > 0
            ? <RadialGauge label={t('common.storage')} value={storage.usedBytes} max={storage.maxBytes}
                valueText={t('overview.gaugeValue', { percent: percent(storage.usedBytes, storage.maxBytes) })}
                caption={t('overview.gaugeOf', { value: formatFileSize(storage.usedBytes, language), max: formatFileSize(storage.maxBytes, language) })} />
            : <UnboundedFigure label={t('common.storage')} value={formatFileSize(storage.usedBytes, language)} note={t('overview.noLimit')} />}
        </div>
      ) : <div className="grid grid-cols-2 place-items-center gap-4 py-4"><Skeleton shape="circle" className="size-24" /><Skeleton shape="circle" className="size-24" /></div>}
    </AdminSection>
  );
}

function ReportsPanel({ insights, reports }: { insights?: AdminInsights; reports: ReturnType<typeof useAdminDetail<Page<AdminReportRow>>> }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  return (
    <AdminSection title={t('overview.reportsTitle')} actions={<PanelLink to="/admin/reports">{t('overview.viewQueue')}</PanelLink>}>
      {insights && (
        <DonutChart label={t('overview.reportsTitle')} totalLabel={t('overview.reportsTotal')} emptyText={t('overview.noReports')}
          segments={(['open', 'reviewing', 'resolved', 'dismissed'] as const).map((status) => ({
            key: status, label: t(`status.${status}`), value: insights.reports[status], color: REPORT_COLORS[status],
          }))} />
      )}
      <div className={cn(insights && 'border-t border-border-divider pt-4')}>
        <p className="mb-1 text-caption font-semibold tracking-[0.04em] text-text-muted uppercase">{t('overview.openReports')}</p>
        {reports.status === 'ready' && reports.data
          ? <ReportPreview reports={reports.data.items} language={language} />
          : reports.status === 'loading'
            ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={2} /></SkeletonGroup>
            : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
      </div>
    </AdminSection>
  );
}

function ReportPreview({ reports, language }: { reports: AdminReportRow[]; language: string }) {
  const { t } = useTranslation('admin');
  if (!reports.length) {
    return (
      <p className="flex items-center gap-2 py-2 text-label text-text-muted">
        <CheckCircleIcon size={16} aria-hidden className="text-green" />{t('overview.noOpenReports')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border-divider">
      {reports.slice(0, 3).map((report) => (
        <li key={report.id}>
          <AppLink to={`/admin/reports/${encodeURIComponent(report.id)}`} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 focus-ring transition-colors hover:bg-fill-subtle">
            <span aria-hidden className="size-2 flex-none rounded-full bg-state-warning" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-semibold text-text-primary group-hover:text-accent-text">{report.targetLabel || report.targetId}</span>
              <span className="block text-caption text-text-muted">{categoryLabel(report.category)} · <time dateTime={report.createdAt}>{formatWhenShort(report.createdAt, language)}</time></span>
            </span>
            <CaretRightIcon size={16} aria-hidden className="shrink-0 text-text-muted" />
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** `ok` false is a problem to look at; `neutral` rows are counts, not health. */
function HealthRow({ ok, neutral, label, value }: { ok?: boolean; neutral?: boolean; label: string; value: string }) {
  const Icon = ok ? CheckCircleIcon : WarningIcon;
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      {neutral
        ? <span aria-hidden className="grid size-4.5 flex-none place-items-center"><span className="size-2 rounded-full bg-text-faint" /></span>
        : <Icon size={18} weight="fill" aria-hidden className={cn('flex-none', ok ? 'text-green' : 'text-yellow')} />}
      <dt className="min-w-0 flex-1 text-label font-medium text-text-primary">{label}</dt>
      <dd className="text-label text-text-muted tabular-nums">{value}</dd>
    </div>
  );
}

function ServiceSummary({ info, insights }: { info: SystemInfo; insights?: AdminInsights }) {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const number = new Intl.NumberFormat(language);
  const { accounts } = info;
  const signupsPaused = accounts.newPerHourCap > 0 && accounts.newLastHour >= accounts.newPerHourCap;
  return (
    <dl className="flex flex-col divide-y divide-border-divider">
      <HealthRow ok={info.livekit.configured} label={t('system.calls')} value={t(info.livekit.configured ? 'common.configured' : 'common.notConfigured')} />
      <HealthRow ok={info.outbox.failed === 0} label={t('system.outbox')}
        value={t('system.outboxValue', { pending: number.format(info.outbox.pending), failed: number.format(info.outbox.failed) })} />
      <HealthRow ok={!signupsPaused} label={t('system.newLastHour')}
        value={accounts.newPerHourCap > 0 ? t('overview.gaugeOf', { value: number.format(accounts.newLastHour), max: number.format(accounts.newPerHourCap) }) : number.format(accounts.newLastHour)} />
      <HealthRow neutral label={t('overview.suspendedAccounts')} value={number.format(accounts.suspended)} />
      {insights && <HealthRow neutral label={t('overview.suspendedServers')} value={number.format(insights.servers.suspended)} />}
      <HealthRow ok={accounts.activeAdmins > 0} label={t('system.activeAdmins')} value={number.format(accounts.activeAdmins)} />
    </dl>
  );
}

export function DashboardPage() {
  const { t } = useTranslation('admin');
  const language = useLanguage();
  const system = useAdminSystem();
  const callMetrics = useAdminCallMetrics();
  const insights = useAdminInsights();
  const audit = useAdminDetail('overview-audit', readAudit);
  const reports = useAdminDetail('overview-reports', readReports);
  const loading = system.status === 'loading' || audit.status === 'loading' || reports.status === 'loading';
  const refreshing = system.refreshing || insights.refreshing || audit.refreshing || reports.refreshing;
  const systemFailed = system.status === 'error' || system.status === 'missing';
  const activityUnavailable = audit.status === 'error' || audit.status === 'missing' || reports.status === 'error' || reports.status === 'missing';
  const stale = system.refreshFailed || insights.refreshFailed || audit.refreshFailed || reports.refreshFailed;
  const insightData = insights.data?.info;

  function refresh() {
    void system.refresh();
    void callMetrics.refresh();
    void insights.refresh();
    if (audit.status === 'ready') void audit.refresh();
    else audit.reload();
    if (reports.status === 'ready') void reports.refresh();
    else reports.reload();
  }

  return (
    <>
      <AdminPageTitle
        title={t('nav.overview')}
        description={t('overview.subtitle')}
        actions={(
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {system.data && (
              <span className="inline-flex items-center gap-2 text-caption text-text-muted">
                <span aria-hidden className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-green opacity-60 motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-green" />
                </span>
                {t('common.lastRead', { time: new Date(system.data.at).toLocaleTimeString(language) })}
              </span>
            )}
            <Button type="button" variant="secondary" className="h-9" disabled={loading || refreshing} onClick={refresh}>
              <RefreshIcon aria-hidden className={cn('size-4', refreshing && 'motion-safe:animate-spin')} />
              {t(refreshing ? 'chrome.refreshing' : 'chrome.refresh')}
            </Button>
          </div>
        )}
      />
      {(systemFailed || activityUnavailable || stale) && (
        <AdminNotice tone="warning">
          {t(systemFailed ? 'overview.metricsUnavailable' : activityUnavailable ? 'overview.activityUnavailable' : 'overview.stale')}
        </AdminNotice>
      )}
      {system.status === 'loading'
        ? <SkeletonGroup label={t('chrome.loading')}><Headline callMetrics={callMetrics} /></SkeletonGroup>
        : <Headline system={system.data?.info} insights={insightData} callMetrics={callMetrics} />}

      <div className="grid gap-4 @[960px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <SignupsChart insights={insightData} status={insights.status} />
        {!systemFailed && <CapacityPanel info={system.data?.info} />}
      </div>

      <div className="grid gap-4 @[960px]:grid-cols-2">
        {callMetrics.data
          ? <DailyPeaks title={t('overview.callPeaks')} days={callMetrics.data.info.history} metric="calls" color="var(--color-violet)"
              action={<PanelLink to="/admin/call-metrics">{t('metrics.viewHistory')}</PanelLink>} />
          : (
            <AdminSection title={t('overview.callPeaks')} actions={<PanelLink to="/admin/call-metrics">{t('metrics.viewHistory')}</PanelLink>}>
              {callMetrics.status === 'loading' ? <ChartSkeleton /> : <Unavailable>{t('metrics.loadFailed')}</Unavailable>}
            </AdminSection>
          )}
        <ReportsPanel insights={insightData} reports={reports} />
      </div>

      <div className="grid gap-4 @[960px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <AdminSection title={t('overview.recentActivity')} actions={<PanelLink to="/admin/audit">{t('overview.viewAudit')}</PanelLink>}>
          {audit.status === 'ready' && audit.data
            ? <AuditList items={audit.data.items.slice(0, 6)} compact />
            : audit.status === 'loading'
              ? <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton /></SkeletonGroup>
              : <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>}
        </AdminSection>
        <AdminSection title={t('common.services')} actions={<PanelLink to="/admin/system">{t('overview.viewSystem')}</PanelLink>}>
          {system.data
            ? <ServiceSummary info={system.data.info} insights={insightData} />
            : systemFailed
              ? <p className="text-label text-text-muted">{t('chrome.loadFailed')}</p>
              : <SkeletonGroup label={t('chrome.loading')}><AuditListSkeleton rows={3} /></SkeletonGroup>}
        </AdminSection>
      </div>
    </>
  );
}
