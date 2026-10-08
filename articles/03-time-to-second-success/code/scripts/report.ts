/**
 * Prints TTFS, SSR30, TTSS and the drop-off cliffs for an events database.
 *
 *   npm run report                    # sample.db, as of 2026-09-30
 *   npm run report -- events.db now   # your own events, as of right now
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { summarise } from '../src/metrics.js';
import { DEFAULT_PARAMS, EventStore } from '../src/store.js';

const path = process.argv[2] ?? 'sample.db';
const asOf = process.argv[3] === 'now' || path !== 'sample.db' ? new Date() : new Date(Date.UTC(2026, 8, 30));

const store = new EventStore(path);
const summary = summarise(store.journeys(), asOf);
const cliffs = store.cliffs(asOf);

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const hours = (h: number) => (Number.isNaN(h) ? '–' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
const days = (d: number) => (Number.isNaN(d) ? '–' : `${d.toFixed(1)} days`);

console.log(`\n${path}, as of ${asOf.toISOString().slice(0, 10)}`);
console.log(`(return gap ${DEFAULT_PARAMS.returnGap / 3600} h, nudge window ${DEFAULT_PARAMS.nudgeWindow / 3600} h, horizon ${DEFAULT_PARAMS.horizon / 86400} days)\n`);
console.log(`Developers                    ${summary.developers}`);
console.log(`Made at least one call        ${store.callers()}`);
console.log(`Reached a first success       ${summary.reachedFirstSuccess}`);
console.log(`TTFS  p50 / p90               ${hours(summary.ttfs.p50)} / ${hours(summary.ttfs.p90)}`);
console.log(`Eligible for SSR30            ${summary.eligible}`);
console.log(`SSR30                         ${pct(summary.ssr)}`);
console.log(`SSR30, unprompted only        ${pct(summary.unpromptedSsr)}`);
console.log(`TTSS  p50 / p90               ${days(summary.ttss.p50)} / ${days(summary.ttss.p90)}`);

for (const cohort of ['stalled', 'never'] as const) {
  const rows = cliffs.filter((c) => c.cohort === cohort);
  const total = rows.reduce((sum, r) => sum + r.developers, 0);
  console.log(`\nLast call before going quiet: ${cohort === 'stalled' ? 'had a first success, never came back' : 'never reached a first success'} (${total})`);
  for (const row of rows.slice(0, 6)) {
    console.log(`  ${String(row.developers).padStart(4)}  ${pct(row.developers / total).padStart(6)}  ${row.status}  ${row.key_mode.padEnd(4)}  ${row.route}`);
  }
}

if (path === 'sample.db') {
  mkdirSync('results', { recursive: true });
  writeFileSync('results/sample-report.json', JSON.stringify({ asOf, params: DEFAULT_PARAMS, summary, cliffs }, null, 2) + '\n');
}
