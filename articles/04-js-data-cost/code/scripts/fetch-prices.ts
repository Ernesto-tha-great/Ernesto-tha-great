/**
 * Downloads the average price of 1 GB of mobile data, per country, from
 * Cable.co.uk's Worldwide Mobile Data Pricing table and saves it to
 * data/prices.csv. Run in CI; the numbers are theirs, credited in the README.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = 'https://www.cable.co.uk/mobiles/worldwide-data-pricing/';

const res = await fetch(SOURCE, {
  headers: { 'user-agent': 'Mozilla/5.0 (js-data-cost research; +https://github.com/Ernesto-tha-great/js-data-cost)' },
});
if (!res.ok) throw new Error(`${SOURCE} returned ${res.status}`);
const html = await res.text();

const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
  .map((match) => match[0])
  .find((candidate) => /Average price of 1GB/i.test(candidate) && /<td>\s*\d+\s*<\/td>/.test(candidate));
if (!table) throw new Error('Could not find the per-country price table. The page layout may have changed.');

const rows = [...table.matchAll(/<tr>\s*<td>\s*(\d+)\s*<\/td>\s*<td>([^<]+)<\/td>\s*<td>\s*([\d.]+)\s*<\/td>\s*<\/tr>/gi)].map((m) => ({
  rank: Number(m[1]),
  country: decode(m[2]!.trim()),
  usdPerGb: Number(m[3]),
}));
if (rows.length < 100) throw new Error(`Only parsed ${rows.length} rows; refusing to write a partial file.`);

const edition = html.match(/worldwide-data-pricing\/(\d{4})\//)?.[1] ?? 'unknown';

mkdirSync('data', { recursive: true });
writeFileSync('data/prices.csv', ['country,usd_per_gb', ...rows.map((r) => `"${r.country}",${r.usdPerGb}`)].join('\n') + '\n');
writeFileSync(
  'data/prices.meta.json',
  JSON.stringify({ source: SOURCE, edition, countries: rows.length, fetchedAt: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`Saved ${rows.length} countries (edition ${edition}) to data/prices.csv`);

function decode(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
}
