// `npm run metrics`: prints a usage report from the Worker's Analytics Engine dataset,
// through Cloudflare's SQL API. See README "Metrics" for the columns.
//
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with Account Analytics:
// Read), from the environment or `server/.env.metrics.local`. `-- --dev` reads the dev Worker's.

import * as v from 'valibot';

const dev = process.argv.includes('--dev');
const DATASET = dev ? 'sequence_metrics_dev' : 'sequence_metrics';
/** Analytics Engine keeps 3 months; a week more so the first week isn't cut short. */
const DAYS = 91;
/** How long a connection lasts without renewing: 60 days, plus 30 days' grace. */
const CONNECTED_DAYS = 90;
const ACTIVE_DAYS = 30;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) {
  console.error(
    'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (see server/README.md "Metrics").',
  );
  process.exit(1);
}

// ClickHouse's JSON format sends some numbers as strings.
const Cell = v.union([v.string(), v.number(), v.null()]);
const Answer = v.object({ data: v.array(v.record(v.string(), Cell)) });
type Row = Readonly<Record<string, string | number | null>>;

/** Runs one query. */
async function query(sql: string): Promise<readonly Row[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: `${sql} FORMAT JSON`,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Analytics Engine answered ${response.status}: ${text}`);
  return v.parse(Answer, JSON.parse(text)).data;
}

const num = (cell: Row[string] | undefined): number => Number(cell ?? 0);
const since = (days: number): string => `timestamp > NOW() - INTERVAL '${days}' DAY`;
/** Counts events, adjusting for sampling (Analytics Engine samples only at high volume). */
const events = (where: string): string => `sumIf(_sample_interval, ${where})`;

const WEEKLY = `
  SELECT
    toStartOfWeek(timestamp) AS week,
    ${events("blob1 = 'batch'")} AS uploads,
    ${events("blob1 = 'frame'")} AS images,
    ${events("blob1 = 'post' AND blob4 = 'posted'")} AS posted,
    ${events("blob1 = 'post' AND blob4 = 'failed'")} AS failed,
    ${events("blob1 = 'post' AND blob4 = 'cancelled'")} AS cancelled,
    ${events("blob1 = 'connect'")} AS signins
  FROM ${DATASET}
  WHERE ${since(DAYS)}
  GROUP BY week
  ORDER BY week`;

const WEEKLY_USERS = `
  SELECT toStartOfWeek(timestamp) AS week, count(DISTINCT blob2) AS users
  FROM ${DATASET}
  WHERE blob1 = 'batch' AND ${since(DAYS)}
  GROUP BY week`;

const distinctUsers = (kinds: readonly string[], days: number): string => `
  SELECT count(DISTINCT blob2) AS users
  FROM ${DATASET}
  WHERE blob1 IN (${kinds.map((k) => `'${k}'`).join(', ')}) AND ${since(days)}`;

const [weekly, weeklyUsers, connected, active] = await Promise.all([
  query(WEEKLY),
  query(WEEKLY_USERS),
  // Any of these means the app held a working connection then.
  query(distinctUsers(['connect', 'renew', 'batch'], CONNECTED_DAYS)),
  query(distinctUsers(['batch'], ACTIVE_DAYS)),
]);

const usersByWeek = new Map(weeklyUsers.map((r) => [String(r.week), num(r.users)]));
const COLUMNS = [
  'Week of',
  'Users',
  'Sign-ins',
  'Uploads',
  'Images',
  'Posted',
  'Failed',
  'Cancelled',
  'No result',
] as const;

/** The counted columns, after the week and its users. */
const COUNTS = ['signins', 'uploads', 'images', 'posted', 'failed', 'cancelled', 'open'] as const;
type Counts = Record<(typeof COUNTS)[number], number>;

function counts(r: Row): Counts {
  const reported = num(r.posted) + num(r.failed) + num(r.cancelled);
  return {
    signins: num(r.signins),
    uploads: num(r.uploads),
    images: num(r.images),
    posted: num(r.posted),
    failed: num(r.failed),
    cancelled: num(r.cancelled),
    // Uploads the app never reported on: closed mid-post, or an app from before reporting.
    open: Math.max(0, num(r.uploads) - reported),
  };
}

const total: Counts = {
  signins: 0,
  uploads: 0,
  images: 0,
  posted: 0,
  failed: 0,
  cancelled: 0,
  open: 0,
};
const rows: string[][] = weekly.map((r) => {
  const week = String(r.week);
  const c = counts(r);
  for (const key of COUNTS) total[key] += c[key];
  return [
    week.slice(0, 10),
    String(usersByWeek.get(week) ?? 0),
    ...COUNTS.map((k) => String(c[k])),
  ];
});
rows.push(['Total', '', ...COUNTS.map((k) => String(total[k]))]);

/** Left-aligns the first column and right-aligns the rest. */
function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const all = [header, ...body];
  const widths = header.map((_, i) => Math.max(...all.map((row) => (row[i] ?? '').length)));
  return all
    .map((row) =>
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
        .join('  '),
    )
    .join('\n');
}

console.log(`Sequence server metrics (${DATASET}), the last ${Math.round(DAYS / 7)} weeks\n`);
console.log(weekly.length > 0 ? table(COLUMNS, rows) : 'No events yet.');
console.log(`
Users: people who uploaded that week. Uploads: posting attempts. Images: images stored.
No result: uploads the app didn't report back on (closed mid-post, or an older app).

Connected users (signed in, renewed, or uploaded in the last ${CONNECTED_DAYS} days): ${num(connected[0]?.users)}
Active users (uploaded in the last ${ACTIVE_DAYS} days): ${num(active[0]?.users)}`);
