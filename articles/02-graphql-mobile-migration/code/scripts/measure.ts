/**
 * How much does one screen cost? Runs the order history screen against each
 * schema with a database that behaves a bit more like a real one: every
 * statement takes ~1 ms and only 10 can run at once (a connection pool).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { Db } from '../src/db.js';
import { operation, send } from '../test/helpers.js';

const RUNS = Number(process.env.RUNS ?? 30);
const root = fileURLToPath(new URL('..', import.meta.url));

const scenarios = [
  {
    label: 'Android 2.3 on v1 (all 100 orders)',
    schemaVersion: 'v1' as const,
    request: { client: 'android', version: '2.3', query: operation('android', '2.3', 'OrderHistory'), variables: { customerId: 'c_1' } },
  },
  {
    label: 'Android 2.3 on v2, app unchanged (all 100 orders)',
    schemaVersion: 'v2' as const,
    request: { client: 'android', version: '2.3', query: operation('android', '2.3', 'OrderHistory'), variables: { customerId: 'c_1' } },
  },
  {
    label: 'iOS 3.1 on v2 (first 20 orders)',
    schemaVersion: 'v2' as const,
    request: { client: 'ios', version: '3.1', query: operation('ios', '3.1', 'OrderHistory'), variables: { first: 20 } },
  },
];

const rows = [];
for (const scenario of scenarios) {
  const db = new Db({ latencyMs: 1, poolSize: 10 });
  const app = createApp({ schemaVersion: scenario.schemaVersion, db });
  await send(app, scenario.request); // warm up

  const timings: number[] = [];
  let statements = 0;
  for (let i = 0; i < RUNS; i++) {
    db.resetCount();
    const start = performance.now();
    const result = await send(app, scenario.request);
    timings.push(performance.now() - start);
    statements = db.statements;
    if (result.errors) throw new Error(JSON.stringify(result.errors));
  }
  timings.sort((a, b) => a - b);
  rows.push({
    scenario: scenario.label,
    statements,
    medianMs: round(timings[Math.floor(RUNS / 2)]!),
    p95Ms: round(timings[Math.min(RUNS - 1, Math.floor(RUNS * 0.95))]!),
  });
}

const table = [
  `Each scenario run ${RUNS} times. Database: in-memory SQLite, 1 ms per statement, pool of 10.`,
  '',
  '| Scenario | SQL statements | Median | p95 |',
  '|---|---:|---:|---:|',
  ...rows.map((r) => `| ${r.scenario} | ${r.statements} | ${r.medianMs} ms | ${r.p95Ms} ms |`),
].join('\n');

console.log(table);
mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results/measure.md'), table + '\n');
writeFileSync(join(root, 'results/measure.json'), JSON.stringify(rows, null, 2) + '\n');

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
