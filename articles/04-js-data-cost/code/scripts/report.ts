/**
 * Joins results/measurements.json with data/prices.csv and data/income.csv
 * and writes results/report.md, results/summary.json and the charts in
 * docs/images.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { costUsd, formatDuration, formatUsd, median, monthlyBytes, workSeconds, WORK_HOURS_PER_YEAR } from '../src/cost.js';
import { loadMarket } from '../src/data.js';
import type { SiteMeasurement } from '../src/measure.js';

const measurements = JSON.parse(readFileSync('results/measurements.json', 'utf8')) as {
  measuredAt: string; device: string; browser: string; where: string; sites: SiteMeasurement[];
};
const priceMeta = JSON.parse(readFileSync('data/prices.meta.json', 'utf8')) as { edition: string; source: string };
const market = loadMarket();

// --- Sites ------------------------------------------------------------------
const usable = measurements.sites.filter((s) => !s.blocked && !s.error && s.cold && s.warm && s.cold.bytes > 50_000);
const excluded = measurements.sites.filter((s) => !usable.includes(s));

const sites = usable
  .map((s) => {
    const jsUnused = s.js && s.js.sourceBytes > 0 ? 1 - s.js.usedBytes / s.js.sourceBytes : 0;
    const jsBytes = s.js?.transferred ?? 0;
    return {
      name: s.name,
      coldBytes: s.cold!.bytes,
      warmBytes: s.warm!.bytes,
      jsBytes,
      jsUnused,
      // Coverage counts decoded source; we apply its ratio to the compressed bytes on the wire. An estimate.
      jsUnusedBytes: jsBytes * jsUnused,
      requests: s.cold!.requests,
      coldByType: s.cold!.byType,
      warmByType: s.warm!.byType,
    };
  })
  .sort((a, b) => b.coldBytes - a.coldBytes);

const medianCold = median(sites.map((s) => s.coldBytes));
const medianWarm = median(sites.map((s) => s.warmBytes));
const medianUnusedJs = median(sites.map((s) => s.jsUnusedBytes));
const heaviest = sites[0]!;
const totalCold = sites.reduce((sum, s) => sum + s.coldBytes, 0);
const totalJs = sites.reduce((sum, s) => sum + s.jsBytes, 0);
const totalUnusedJs = sites.reduce((sum, s) => sum + s.jsUnusedBytes, 0);

// Resource types a long-lived Cache-Control header could serve from cache on a
// repeat visit. HTML, API calls and beacons are left out: they usually change.
const CACHEABLE = ['Script', 'Image', 'Font', 'Stylesheet', 'Media'];
const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

const byType = new Map<string, number>();
for (const s of sites) for (const [type, bytes] of Object.entries(s.coldByType)) byType.set(type, (byType.get(type) ?? 0) + bytes);
const resourceTypes = [...byType].map(([type, bytes]) => ({ type, share: bytes / totalCold })).sort((a, b) => b.share - a.share);

const jsHeavySites = sites.filter((s) => s.jsBytes / s.coldBytes > 0.5).length;
const medianJs = median(sites.map((s) => s.jsBytes));
const videoSites = sites.filter((s) => (s.coldByType.Media ?? 0) > 100_000).map((s) => ({ name: s.name, mediaBytes: s.coldByType.Media! }));
const heaviestMedia = heaviest.coldByType.Media ?? 0;

// Share of a month's bytes that come from repeat visits, at 5 visits a day (the model) and at 1.
const repeatShare = (visitsPerDay: number) => {
  const repeats = visitsPerDay * 30 - 1;
  const repeatBytes = repeats * sum(sites.map((s) => s.warmBytes));
  return repeatBytes / (totalCold + repeatBytes);
};

const months = sites
  .map((s) => {
    const [topType, topBytes] = Object.entries(s.warmByType).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const uncacheableWarm = s.warmBytes - sum(CACHEABLE.map((t) => s.warmByType[t] ?? 0));
    return {
      name: s.name,
      coldBytes: s.coldBytes,
      warmBytes: s.warmBytes,
      monthBytes: monthlyBytes(s.coldBytes, s.warmBytes),
      topRepeatType: topType,
      topRepeatBytes: topBytes,
      // Upper bound for fix 3: every cacheable byte on the repeat visit comes from cache.
      monthBytesIfCached: monthlyBytes(s.coldBytes, uncacheableWarm),
    };
  })
  .sort((a, b) => b.monthBytes - a.monthBytes);

// --- Countries ----------------------------------------------------------------
const rows = market.countries
  .map((c) => ({ ...c, usdPerGb: market.priceFor(c.name), income: market.incomeFor(c.name) }))
  .filter((c): c is typeof c & { usdPerGb: number; income: { year: string; gni: number } } => c.usdPerGb !== undefined && c.income !== undefined)
  .map((c) => {
    const work = (bytes: number) => workSeconds(costUsd(bytes, c.usdPerGb), c.income.gni);
    return {
      name: c.name,
      usdPerGb: c.usdPerGb,
      gni: c.income.gni,
      gniYear: c.income.year,
      gbWorkSeconds: workSeconds(c.usdPerGb, c.income.gni),
      medianFirstVisitUsd: costUsd(medianCold, c.usdPerGb),
      medianFirstVisitWorkSeconds: work(medianCold),
      heaviestFirstVisitUsd: costUsd(heaviest.coldBytes, c.usdPerGb),
      heaviestFirstVisitWorkSeconds: work(heaviest.coldBytes),
      unusedJsPerMillionVisitsUsd: costUsd(medianUnusedJs * 1e6, c.usdPerGb),
    };
  })
  .sort((a, b) => b.gbWorkSeconds - a.gbWorkSeconds);
const spread = rows[0]!.gbWorkSeconds / rows.at(-1)!.gbWorkSeconds;
const spreadWithoutTop = rows[1]!.gbWorkSeconds / rows.at(-1)!.gbWorkSeconds;
const missingPrices = market.countries.filter((c) => market.priceFor(c.name) === undefined).map((c) => c.name);
const missingIncome = market.countries.filter((c) => market.incomeFor(c.name) === undefined).map((c) => c.name);

// --- Write ----------------------------------------------------------------------
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;
const pct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`;
const money = (x: number) => (x >= 100 ? `$${Math.round(x).toLocaleString('en-US')}` : formatUsd(x));

const summary = {
  measuredAt: measurements.measuredAt,
  priceEdition: priceMeta.edition,
  workHoursPerYear: WORK_HOURS_PER_YEAR,
  sitesMeasured: measurements.sites.length,
  sitesUsable: sites.length,
  excluded: excluded.map((s) => ({ name: s.name, reason: s.error ?? (s.blocked ? `blocked (${s.status}, "${s.title}")` : 'too small to be a real page') })),
  medianColdBytes: medianCold,
  medianWarmBytes: medianWarm,
  medianUnusedJsBytes: medianUnusedJs,
  heaviest,
  lightest: sites.at(-1),
  jsShareOfBytes: totalJs / totalCold,
  unusedJsShareOfBytes: totalUnusedJs / totalCold,
  unusedJsShareOfJs: totalUnusedJs / totalJs,
  unusedJsBytes: totalUnusedJs,
  medianJsBytes: medianJs,
  jsHeavySites,
  resourceTypes,
  videoSites,
  heaviestWithoutMediaBytes: heaviest.coldBytes - heaviestMedia,
  repeatShareOfMonth: { fiveVisitsADay: repeatShare(5), oneVisitADay: repeatShare(1) },
  months,
  workTimeSpread: { all: spread, withoutMostExpensive: spreadWithoutTop, mostExpensive: rows[0]!.name, secondMostExpensive: rows[1]!.name, cheapest: rows.at(-1)!.name },
  countries: rows,
  missingPrices,
  missingIncome,
};

mkdirSync('results', { recursive: true });
writeFileSync('results/summary.json', JSON.stringify(summary, null, 2) + '\n');

const md = [
  `# Results`,
  '',
  `Measured ${measurements.measuredAt.slice(0, 10)} from a ${measurements.where}, ${measurements.device}, ${measurements.browser}.`,
  `Prices: Cable.co.uk Worldwide Mobile Data Pricing, ${priceMeta.edition} edition. Income: World Bank GNI per capita (Atlas method), most recent year.`,
  '',
  `${sites.length} of ${measurements.sites.length} sites were usable. Median first visit: **${mb(medianCold)}**. Median repeat visit: **${mb(medianWarm)}**, ${(medianCold / medianWarm).toFixed(0)}× less.`,
  `JavaScript was ${pct(totalJs / totalCold)} of all bytes on first visits. An estimated ${pct(totalUnusedJs / totalCold)} of all bytes were JavaScript that didn't run during load: ${pct(totalUnusedJs / totalJs, 0)} of the JavaScript.`,
  '',
  '## Sites (first visit, heaviest first)',
  '',
  '| Site | First visit | Repeat visit | JavaScript | JS that didn\'t run during load | Requests |',
  '|---|---:|---:|---:|---:|---:|',
  ...sites.map((s) => `| ${s.name} | ${mb(s.coldBytes)} | ${mb(s.warmBytes)} | ${mb(s.jsBytes)} | ${pct(s.jsUnused, 0)} | ${s.requests} |`),
  '',
  excluded.length ? `Excluded: ${summary.excluded.map((e) => `${e.name} (${e.reason})`).join('; ')}.` : '',
  '',
  '## Countries: what a first visit costs',
  '',
  `Work time is the cost divided by average hourly income: GNI per capita spread over ${WORK_HOURS_PER_YEAR.toLocaleString('en-US')} working hours a year.`,
  `The median site's first visit is ${mb(medianCold)}; the heaviest, ${heaviest.name}, is ${mb(heaviest.coldBytes)}. The median site ships ${mb(medianUnusedJs)} of JavaScript that doesn't run during load.`,
  '',
  `| Country | 1 GB | 1 GB in work time | Median site, first visit | ${heaviest.name}, first visit | Unused JS, per million first visits |`,
  '|---|---:|---:|---:|---:|---:|',
  ...rows.map((r) =>
    `| ${r.name} | $${r.usdPerGb.toFixed(2)} | ${formatDuration(r.gbWorkSeconds)} | ${formatUsd(r.medianFirstVisitUsd)} · ${formatDuration(r.medianFirstVisitWorkSeconds)} | ${formatUsd(r.heaviestFirstVisitUsd)} · ${formatDuration(r.heaviestFirstVisitWorkSeconds)} | ${money(r.unusedJsPerMillionVisitsUsd)} |`),
  '',
  `1 GB costs ${Math.round(spread).toLocaleString('en-US')}× more work in ${rows[0]!.name} than in ${rows.at(-1)!.name}. Without ${rows[0]!.name}, the gap is ${Math.round(spreadWithoutTop).toLocaleString('en-US')}× (${rows[1]!.name} against ${rows.at(-1)!.name}).`,
  '',
  '## What the bytes are',
  '',
  '| Resource type | Share of first-visit bytes |',
  '|---|---:|',
  ...resourceTypes.filter((t) => t.share >= 0.005).map((t) => `| ${t.type} | ${pct(t.share)} |`),
  `| Everything else | ${pct(sum(resourceTypes.filter((t) => t.share < 0.005).map((t) => t.share)))} |`,
  '',
  `JavaScript was more than half of the first visit on ${jsHeavySites} of ${sites.length} sites. The median site downloaded ${mb(medianJs)} of it. In total, ${mb(totalUnusedJs)} of JavaScript didn't run during load.`,
  `Video and audio over 100 KB on a first visit: ${videoSites.map((v) => `${v.name} ${mb(v.mediaBytes)}`).join(', ')}. Without it, ${heaviest.name} would be ${mb(heaviest.coldBytes - heaviestMedia)} instead of ${mb(heaviest.coldBytes)} (${pct(heaviestMedia / heaviest.coldBytes, 0)} less).`,
  '',
  '## A month of use',
  '',
  `A month is 5 visits a day for 30 days: 1 first visit and 149 repeat visits. Repeat visits are ${pct(repeatShare(5), 0)} of all those bytes (${pct(repeatShare(1), 0)} at one visit a day).`,
  `The last column is an upper bound: the month if every ${CACHEABLE.join(', ').toLowerCase()} byte on the repeat visit came from cache.`,
  '',
  '| Site | First visit | Repeat visit | A month | Most re-downloaded on a repeat visit | A month, if cacheable types were cached |',
  '|---|---:|---:|---:|---|---:|',
  ...months.slice(0, 12).map((m) => `| ${m.name} | ${mb(m.coldBytes)} | ${mb(m.warmBytes)} | ${(m.monthBytes / 1e6).toFixed(0)} MB | ${mb(m.topRepeatBytes)} ${m.topRepeatType} | ${(m.monthBytesIfCached / 1e6).toFixed(0)} MB |`),
  '',
  missingPrices.length ? `No price data for: ${missingPrices.join(', ')}.` : '',
  missingIncome.length ? `No income data for: ${missingIncome.join(', ')}.` : '',
].join('\n');
writeFileSync('results/report.md', md + '\n');

// --- Charts ---------------------------------------------------------------------
mkdirSync('docs/images', { recursive: true });
writeFileSync('docs/images/site-weights.svg', siteWeightsChart());
writeFileSync('docs/images/work-time.svg', workTimeChart());
console.log(md);

function style(): string {
  return `<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#8a8983; --rule:#e4e3de; --js:#2a78d6; --js-unused:#9ec5f4; --other:#d6d5cf; --dot:#2a78d6; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --ink-3:#8f8e86; --rule:#33332f; --js:#3987e5; --js-unused:#1f4f86; --other:#4a4a46; --dot:#5598e7; } }
  text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: var(--ink); }
  .h1 { font-size: 22px; font-weight: 700; } .sub { font-size: 14px; fill: var(--ink-2); }
  .lbl { font-size: 12.5px; fill: var(--ink-2); } .val { font-size: 12px; font-weight: 600; } .note { font-size: 12px; fill: var(--ink-3); }
  .tick { font-size: 11.5px; fill: var(--ink-3); }
</style>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function siteWeightsChart(): string {
  const rowH = 22;
  const top = 116;
  const half = Math.ceil(sites.length / 2);
  const height = top + half * rowH + 50;
  const max = heaviest.coldBytes;
  const barMax = 300;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ${height}" width="1200" height="${height}" role="img" aria-labelledby="t d">
<title id="t">First-visit download size of ${sites.length} popular sites on a phone</title>
<desc id="d">Median ${mb(medianCold)}. Heaviest: ${esc(heaviest.name)} at ${mb(heaviest.coldBytes)}. Each bar splits JavaScript that ran during load, JavaScript that didn't, and everything else.</desc>
${style()}
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">What a first visit downloads</text>
<text class="sub" x="40" y="68">Bytes over the network for one page load on an emulated phone, empty cache, no scrolling. Median: ${mb(medianCold)}.</text>
<rect x="40" y="82" width="14" height="14" rx="3" fill="var(--js)"/><text class="lbl" x="60" y="94">JavaScript that ran</text>
<rect x="200" y="82" width="14" height="14" rx="3" fill="var(--js-unused)"/><text class="lbl" x="220" y="94">JavaScript that didn't run during load (estimated)</text>
<rect x="540" y="82" width="14" height="14" rx="3" fill="var(--other)"/><text class="lbl" x="560" y="94">Everything else</text>`];
  sites.forEach((s, i) => {
    const col = i < half ? 0 : 1;
    const row = i < half ? i : i - half;
    const x0 = 40 + col * 580;
    const y = top + row * rowH;
    const scale = (bytes: number) => (bytes / max) * barMax;
    const segments = [
      ['var(--js)', scale(s.jsBytes - s.jsUnusedBytes)],
      ['var(--js-unused)', scale(s.jsUnusedBytes)],
      ['var(--other)', scale(s.coldBytes - s.jsBytes)],
    ] as const;
    parts.push(`<text class="lbl" x="${x0}" y="${y + 14}">${esc(s.name)}</text>`);
    let x = x0 + 150;
    for (const [fill, w] of segments) {
      if (w >= 0.5) parts.push(`<rect x="${x.toFixed(1)}" y="${y + 3}" width="${w.toFixed(1)}" height="14" fill="${fill}"/>`);
      x += w;
    }
    parts.push(`<text class="val" x="${(x + 8).toFixed(1)}" y="${y + 14}">${mb(s.coldBytes)}</text>`);
  });
  parts.push(`<text class="note" x="40" y="${height - 18}">Measured ${measurements.measuredAt.slice(0, 10)} from a ${esc(measurements.where)}. Source: npm run measure, npm run report.</text>`, '</svg>');
  return parts.join('\n') + '\n';
}

function workTimeChart(): string {
  const rowH = 22;
  const top = 128;
  const half = Math.ceil(rows.length / 2);
  const height = top + half * rowH + 50;
  const plotX = 170;
  const plotW = 330;
  // Log scale: the values run from seconds to days, and that range is the story.
  const ticks: Array<[number, string]> = [[1, '1 s'], [10, '10 s'], [60, '1 min'], [600, '10 min'], [3600, '1 h'], [36_000, '10 h'], [360_000, '100 h']];
  const lo = Math.min(0, Math.log10(Math.min(...rows.map((r) => r.gbWorkSeconds))));
  const hi = Math.max(Math.log10(360_000), Math.log10(Math.max(...rows.map((r) => r.gbWorkSeconds))));
  const sx = (seconds: number) => ((Math.log10(Math.max(seconds, 10 ** lo)) - lo) / (hi - lo)) * plotW;

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 ${height}" width="1200" height="${height}" role="img" aria-labelledby="t d">
<title id="t">How long someone on average income works to pay for 1 GB of mobile data</title>
<desc id="d">${rows.slice(0, 4).map((r) => `${esc(r.name)} ${formatDuration(r.gbWorkSeconds)}`).join('; ')}, down to ${esc(rows.at(-1)!.name)} ${formatDuration(rows.at(-1)!.gbWorkSeconds)}. Log scale.</desc>
${style()}
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">The same gigabyte, a very different price</text>
<text class="sub" x="40" y="68">How long someone on average income works to pay for 1 GB of mobile data. Log scale: each gridline is ten times the last.</text>
<text class="sub" x="40" y="90">The median site's first visit (${mb(medianCold)}) is about 1/${Math.round(2 ** 30 / medianCold)} of that.</text>`];
  for (const col of [0, 1]) {
    const x0 = 40 + col * 580 + plotX;
    for (const [seconds, label] of ticks) {
      const x = x0 + sx(seconds);
      parts.push(`<line x1="${x.toFixed(1)}" y1="${top - 4}" x2="${x.toFixed(1)}" y2="${top + half * rowH}" stroke="var(--rule)" stroke-width="1"/>`);
      parts.push(`<text class="tick" x="${x.toFixed(1)}" y="${top - 10}" text-anchor="middle">${label}</text>`);
    }
  }
  rows.forEach((r, i) => {
    const col = i < half ? 0 : 1;
    const row = i < half ? i : i - half;
    const x0 = 40 + col * 580;
    const y = top + row * rowH;
    const cx = x0 + plotX + sx(r.gbWorkSeconds);
    parts.push(`<text class="lbl" x="${x0}" y="${y + 14}">${esc(r.name)}</text>`);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${y + 10}" r="5" fill="var(--dot)"/>`);
    parts.push(`<text class="val" x="${(cx + 10).toFixed(1)}" y="${y + 14}">${formatDuration(r.gbWorkSeconds)}</text>`);
  });
  parts.push(`<text class="note" x="40" y="${height - 18}">Prices: Cable.co.uk Worldwide Mobile Data Pricing (${priceMeta.edition}). Income: World Bank GNI per capita, Atlas method, over ${WORK_HOURS_PER_YEAR.toLocaleString('en-US')} working hours. Source: npm run report.</text>`, '</svg>');
  return parts.join('\n') + '\n';
}
