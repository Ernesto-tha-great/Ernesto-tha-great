import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace, type RunResult } from '../sim/run-trace.js';
import { STRATEGIES } from '../sim/strategies.js';
import type { Trace } from '../sim/trace.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const traceDir = process.argv[2] ?? join(root, 'sim/traces');
const seeds = Number(process.env.SEEDS ?? 25);

const traces: Trace[] = readdirSync(traceDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(traceDir, file), 'utf8')) as Trace);

interface Row {
  trace: string;
  source: Trace['source'];
  strategy: string;
  actions: number;
  exactlyOnce: number;
  duplicated: number;
  lost: number;
  p50: number | null;
  p95: number | null;
}

const rows: Row[] = [];
for (const trace of traces) {
  for (const strategy of STRATEGIES) {
    const totals: RunResult = { actions: 0, exactlyOnce: 0, duplicated: 0, lost: 0, deliveryLatencies: [] };
    for (let seed = 1; seed <= seeds; seed++) {
      const result = await runTrace(trace, strategy, { seed });
      totals.actions += result.actions;
      totals.exactlyOnce += result.exactlyOnce;
      totals.duplicated += result.duplicated;
      totals.lost += result.lost;
      totals.deliveryLatencies.push(...result.deliveryLatencies);
    }
    rows.push({
      trace: trace.name,
      source: trace.source,
      strategy: strategy.name,
      actions: totals.actions,
      exactlyOnce: totals.exactlyOnce,
      duplicated: totals.duplicated,
      lost: totals.lost,
      p50: percentile(totals.deliveryLatencies, 0.5),
      p95: percentile(totals.deliveryLatencies, 0.95),
    });
  }
}

const markdown = toMarkdown(rows, seeds);
console.log(markdown);
mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results/results.md'), markdown);
writeFileSync(join(root, 'results/results.json'), JSON.stringify(rows, null, 2));

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)}%`;
}

function seconds(value: number | null): string {
  return value === null ? '–' : `${value.toFixed(1)} s`;
}

function toMarkdown(all: Row[], seedCount: number): string {
  const lines: string[] = [`Results over ${seedCount} seeded runs per trace and strategy.`, ''];
  for (const trace of [...new Set(all.map((row) => row.trace))]) {
    const traceRows = all.filter((row) => row.trace === trace);
    lines.push(`### ${trace} (${traceRows[0]!.source})`, '');
    lines.push('| Strategy | Actions | Exactly once | Duplicated | Lost | p50 delivery | p95 delivery |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const row of traceRows) {
      lines.push(
        `| ${row.strategy} | ${row.actions} | ${pct(row.exactlyOnce, row.actions)} | ${pct(row.duplicated, row.actions)} | ${pct(row.lost, row.actions)} | ${seconds(row.p50)} | ${seconds(row.p95)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
