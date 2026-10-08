import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Country {
  iso3: string;
  name: string;
}

// The price table and our country list don't always spell names the same way.
const ALIASES: Record<string, string[]> = {
  'United States': ['USA', 'United States of America'],
  'South Korea': ['Korea (South)', 'Korea, Republic of', 'Republic of Korea', 'Korea'],
  Netherlands: ['The Netherlands'],
  Vietnam: ['Viet Nam'],
  Tanzania: ['Tanzania, United Republic of'],
  Turkey: ['Türkiye', 'Turkiye'],
  'United Arab Emirates': ['UAE'],
};

export function readCsv(path: string): Array<Record<string, string>> {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const keys = header!.split(',');
  return lines.map((line) => {
    const values = [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]!).slice(0, keys.length);
    return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? '']));
  });
}

/** Prices (data/prices.csv) and income (data/income.csv), looked up by the country names in countries.json. */
export function loadMarket(dir = '.') {
  const countries = JSON.parse(readFileSync(join(dir, 'countries.json'), 'utf8')) as Country[];
  const prices = readCsv(join(dir, 'data/prices.csv')).map((r) => ({ country: r.country!, usdPerGb: Number(r.usd_per_gb) }));
  const income = new Map(readCsv(join(dir, 'data/income.csv')).map((r) => [r.iso3!, { year: r.year!, gni: Number(r.gni_per_capita_usd) }]));

  const priceFor = (name: string): number | undefined => {
    const names = [name, ...(ALIASES[name] ?? [])].map((n) => n.toLowerCase());
    return prices.find((p) => names.includes(p.country.toLowerCase()))?.usdPerGb;
  };
  const incomeFor = (name: string): { year: string; gni: number } | undefined => {
    const country = countries.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return country ? income.get(country.iso3) : undefined;
  };
  return { countries, priceFor, incomeFor };
}

export type Market = Pick<ReturnType<typeof loadMarket>, 'priceFor' | 'incomeFor'>;
