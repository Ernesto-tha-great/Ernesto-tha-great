/**
 * Measures every site in sites.json and writes results/measurements.json.
 *
 *   npm run measure                 # all 50
 *   npm run measure -- Wikipedia    # just the ones whose name matches,
 *                                   # saved to results/measurements.wikipedia.json
 *                                   # so the full run stays intact
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { measureSite, type Site, type SiteMeasurement } from '../src/measure.js';

const filter = process.argv[2]?.toLowerCase();
const sites = (JSON.parse(readFileSync('sites.json', 'utf8')) as Site[]).filter((s) => !filter || s.name.toLowerCase().includes(filter));

const browser = await chromium.launch();
const browserVersion = browser.version();
const results: SiteMeasurement[] = [];
for (const site of sites) {
  let result = await measureSite(browser, site);
  if (result.error) result = await measureSite(browser, site); // one retry for flaky networks
  results.push(result);
  const mb = (b?: number) => (b === undefined ? '–' : `${(b / 1e6).toFixed(2)} MB`);
  console.log(
    `${site.name.padEnd(22)} cold ${mb(result.cold?.bytes).padStart(9)}  warm ${mb(result.warm?.bytes).padStart(9)}  ` +
      `${result.blocked ? 'BLOCKED ' : ''}${result.error ? `ERROR ${result.error}` : ''}`,
  );
}
await browser.close();

const out = filter ? `results/measurements.${filter.replace(/[^a-z0-9]+/g, '-')}.json` : 'results/measurements.json';
mkdirSync('results', { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      device: 'Moto G4 emulation (Playwright), en-US',
      browser: `Chromium ${browserVersion}`,
      where: process.env.GITHUB_ACTIONS ? 'GitHub Actions runner (ubuntu-latest)' : 'local machine',
      sites: results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nMeasured ${results.length} sites → ${out}`);
