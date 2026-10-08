/**
 * A performance budget in money instead of kilobytes. Loads your page the
 * same way the study does, prices it in the countries you name, and exits 1
 * when it costs more than you said it could.
 *
 *   npm run budget -- budget.json                         # the URL in the file
 *   npm run budget -- budget.json https://example.com/    # or any other page
 *
 * Needs data/prices.csv and data/income.csv (npm run fetch:prices, npm run fetch:income).
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { checkBudget, type BudgetLine } from '../src/budget';
import { formatDuration, formatUsd } from '../src/cost';
import { loadMarket } from '../src/data';
import { measurePage } from '../src/measure';

const config = JSON.parse(readFileSync(process.argv[2] ?? 'budget.json', 'utf8')) as { url: string; budgets: BudgetLine[] };
const url = process.argv[3] ?? config.url;

const browser = await chromium.launch();
const result = await measurePage(browser, url);
await browser.close();

if (result.error || result.blocked || !result.cold || !result.warm) {
  console.error(`Couldn't measure ${url}: ${result.error ?? `blocked (${result.status}, "${result.title}")`}`);
  process.exit(2);
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
console.log(`${url}\nfirst visit ${mb(result.cold.bytes)}, repeat visit ${mb(result.warm.bytes)}\n`);

const results = checkBudget({ coldBytes: result.cold.bytes, warmBytes: result.warm.bytes }, config.budgets, loadMarket());
for (const r of results) {
  if (r.firstVisitUsd === null || r.monthlyUsd === null) {
    console.log(`✗ ${r.country.padEnd(15)} no price data`);
    continue;
  }
  const work = r.firstVisitWorkSeconds === null ? '' : ` (${formatDuration(r.firstVisitWorkSeconds)} of work)`;
  const verdict = r.failures.length ? `  over budget: ${r.failures.join(', ')}` : '';
  console.log(`${r.failures.length ? '✗' : '✓'} ${r.country.padEnd(15)} first visit ${formatUsd(r.firstVisitUsd)}${work}, a month ${formatUsd(r.monthlyUsd)}${verdict}`);
}
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
