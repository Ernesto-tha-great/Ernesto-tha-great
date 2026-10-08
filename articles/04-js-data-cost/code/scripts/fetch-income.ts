/**
 * Downloads GNI per capita (Atlas method, current US$) for our 50 countries
 * from the World Bank's open API, using the most recent year available for
 * each, and saves it to data/income.csv.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Country { iso3: string; name: string }
interface WorldBankRow { countryiso3code: string; country: { value: string }; date: string; value: number | null }

const countries = JSON.parse(readFileSync('countries.json', 'utf8')) as Country[];
const url =
  `https://api.worldbank.org/v2/country/${countries.map((c) => c.iso3).join(';')}` +
  '/indicator/NY.GNP.PCAP.CD?format=json&mrnev=1&per_page=200';

const res = await fetch(url);
if (!res.ok) throw new Error(`World Bank API returned ${res.status}`);
const [, rows] = (await res.json()) as [unknown, WorldBankRow[] | null];
if (!rows?.length) throw new Error('World Bank API returned no rows');

const byIso = new Map(rows.filter((r) => r.value !== null).map((r) => [r.countryiso3code, r]));
const missing = countries.filter((c) => !byIso.has(c.iso3)).map((c) => c.iso3);
if (missing.length) console.warn(`No GNI per capita for: ${missing.join(', ')}`);

mkdirSync('data', { recursive: true });
writeFileSync(
  'data/income.csv',
  ['iso3,year,gni_per_capita_usd', ...countries.filter((c) => byIso.has(c.iso3)).map((c) => {
    const row = byIso.get(c.iso3)!;
    return `${c.iso3},${row.date},${row.value}`;
  })].join('\n') + '\n',
);
writeFileSync('data/income.meta.json', JSON.stringify({ source: url, indicator: 'NY.GNP.PCAP.CD', fetchedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Saved GNI per capita for ${countries.length - missing.length} countries to data/income.csv`);
