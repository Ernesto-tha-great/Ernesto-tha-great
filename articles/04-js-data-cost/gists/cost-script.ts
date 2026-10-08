/**
 * Measures one page and prices it in the countries you name.
 *
 *   npm run cost -- https://en.wikipedia.org/wiki/Main_Page Kenya India Brazil
 */
import { chromium } from 'playwright';
import { costUsd, formatDuration, formatUsd, monthlyBytes, workSeconds } from '../src/cost';
import { loadMarket } from '../src/data';
import { measurePage } from '../src/measure';

const [url, ...countries] = process.argv.slice(2);
if (!url || countries.length === 0) {
  console.error('Usage: npm run cost -- <url> <country> [more countries]');
  process.exit(1);
}

const browser = await chromium.launch();
const result = await measurePage(browser, url);
await browser.close();

if (result.error || result.blocked || !result.cold || !result.warm) {
  console.error(`Couldn't measure ${url}: ${result.error ?? `blocked (${result.status}, "${result.title}")`}`);
  process.exit(2);
}

const market = loadMarket();
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
const month = monthlyBytes(result.cold.bytes, result.warm.bytes);
console.log(`${url}\nfirst visit ${mb(result.cold.bytes)}, repeat visit ${mb(result.warm.bytes)}, a month ${mb(month)}\n`);

for (const country of countries) {
  const usdPerGb = market.priceFor(country);
  const income = market.incomeFor(country);
  if (usdPerGb === undefined || !income) {
    console.log(`${country.padEnd(16)}no price or income data`);
    continue;
  }
  const firstVisit = costUsd(result.cold.bytes, usdPerGb);
  const aMonth = costUsd(month, usdPerGb);
  console.log(
    `${country.padEnd(16)}1 GB $${usdPerGb.toFixed(2)}` +
      `   first visit ${formatUsd(firstVisit)} (${formatDuration(workSeconds(firstVisit, income.gni))} of work)` +
      `   a month ${formatUsd(aMonth)} (${formatDuration(workSeconds(aMonth, income.gni))} of work)`,
  );
}
