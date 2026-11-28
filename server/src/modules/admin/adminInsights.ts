import { gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { reports, servers, users } from '../../db/schema.js';
import { ADMIN_METRICS_TIME_ZONE, adminMetricsDays } from './adminCallMetrics.js';

const INSIGHT_DAYS = 30;
const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;

type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Day of a timestamp column in the admin calendar, as the `YYYY-MM-DD` that adminMetricsDays lists. */
const localDay = (column: typeof users.createdAt | typeof servers.createdAt) =>
  sql<string>`to_char(${column} at time zone ${ADMIN_METRICS_TIME_ZONE}, 'YYYY-MM-DD')`;

/** Midnight of a calendar day in the admin time zone, as an instant. */
const dayStart = (day: string) => sql`(${day}::date)::timestamp at time zone ${ADMIN_METRICS_TIME_ZONE}`;

/** Growth and moderation figures for the administration charts: accounts and servers created
 * per day over the last 30 days, the instance's server totals and the report queue by status.
 * Every count reads an indexed column or a small table; nothing here scans messages. */
export async function getAdminInsights(now = new Date()) {
  const days = adminMetricsDays(now, INSIGHT_DAYS);
  const since = dayStart(days[0]!);
  const accountDay = localDay(users.createdAt);
  const serverDay = localDay(servers.createdAt);
  const [accountRows, serverRows, serverTotals, reportRows] = await Promise.all([
    db.select({ day: accountDay, n: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, since)).groupBy(accountDay),
    db.select({ day: serverDay, n: sql<number>`count(*)::int` }).from(servers).where(gte(servers.createdAt, since)).groupBy(serverDay),
    db.select({
      total: sql<number>`count(*)::int`,
      suspended: sql<number>`count(*) filter (where ${servers.status} = 'suspended')::int`,
    }).from(servers),
    db.select({ status: reports.status, n: sql<number>`count(*)::int` }).from(reports).groupBy(reports.status),
  ]);
  const accountsByDay = new Map(accountRows.map((row) => [row.day, row.n]));
  const serversByDay = new Map(serverRows.map((row) => [row.day, row.n]));
  const reportCounts = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>;
  for (const row of reportRows) {
    if ((REPORT_STATUSES as readonly string[]).includes(row.status)) reportCounts[row.status as ReportStatus] = row.n;
  }
  return {
    timeZone: ADMIN_METRICS_TIME_ZONE,
    days: days.map((day) => ({ day, accounts: accountsByDay.get(day) ?? 0, servers: serversByDay.get(day) ?? 0 })),
    servers: { total: serverTotals[0]?.total ?? 0, suspended: serverTotals[0]?.suspended ?? 0 },
    reports: reportCounts,
  };
}
