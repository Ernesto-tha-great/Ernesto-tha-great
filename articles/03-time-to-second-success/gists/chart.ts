/** Draws the sample report as two SVGs: the return curve and the cliffs. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Summary } from '../src/metrics';
import type { Cliff } from '../src/store';

const report = JSON.parse(readFileSync('results/sample-report.json', 'utf8')) as { summary: Summary; cliffs: Cliff[] };
mkdirSync('docs/images', { recursive: true });

const STYLE = `<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#8a8983; --rule:#e4e3de; --s1:#2a78d6; --s2:#eb6834; --bar:#2a78d6; --muted:#c9c8c2; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --ink-3:#8f8e86; --rule:#383835; --s1:#3987e5; --s2:#d95926; --bar:#3987e5; --muted:#4a4a46; } }
  text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: var(--ink); }
  .h1 { font-size: 22px; font-weight: 700; }
  .sub { font-size: 14px; fill: var(--ink-2); }
  .axis { font-size: 12px; fill: var(--ink-3); }
  .lbl { font-size: 13px; fill: var(--ink-2); }
  .val { font-size: 13px; font-weight: 600; }
  .note { font-size: 12px; fill: var(--ink-3); }
</style>`;

// --- 1. Return curve -------------------------------------------------------
{
  const width = 1200;
  const height = 520;
  const plot = { x: 90, y: 120, w: 900, h: 320 };
  const days = report.summary.curve.length - 1;
  const x = (day: number) => plot.x + (day / days) * plot.w;
  const y = (share: number) => plot.y + plot.h - share * plot.h;
  const path = (key: 'any' | 'unprompted') =>
    report.summary.curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const last = report.summary.curve.at(-1)!;

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">Share of developers with a second success, by days since their first</title>
<desc id="d">Sample cohort of ${report.summary.eligible} developers. By day 30, ${(100 * last.any).toFixed(1)}% had a second success; ${(100 * last.unprompted).toFixed(1)}% without a nudge in the previous 72 hours.</desc>
${STYLE}
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">Who comes back, and how fast</text>
<text class="sub" x="40" y="68">Cumulative share of developers with a second success, by days since their first. Sample cohort from scripts/sample.ts.</text>
<rect x="40" y="86" width="14" height="3" fill="var(--s1)"/><text class="lbl" x="60" y="92">Any second success</text>
<rect x="210" y="86" width="14" height="3" fill="var(--s2)"/><text class="lbl" x="230" y="92">Unprompted (no nudge in the 72 h before)</text>`];

  for (const share of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line x1="${plot.x}" x2="${plot.x + plot.w}" y1="${y(share)}" y2="${y(share)}" stroke="var(--rule)"/>`);
    parts.push(`<text class="axis" x="${plot.x - 12}" y="${y(share) + 4}" text-anchor="end">${share * 100}%</text>`);
  }
  for (const day of [0, 5, 10, 15, 20, 25, 30]) {
    parts.push(`<text class="axis" x="${x(day)}" y="${plot.y + plot.h + 22}" text-anchor="middle">day ${day}</text>`);
  }
  // The nudge goes out on day 3.
  parts.push(`<line x1="${x(3)}" x2="${x(3)}" y1="${plot.y}" y2="${plot.y + plot.h}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>`);
  parts.push(`<text class="axis" x="${x(3) + 6}" y="${plot.y + 14}">nudge email (day 3)</text>`);

  parts.push(`<path d="${path('any')}" fill="none" stroke="var(--s1)" stroke-width="2.5" stroke-linejoin="round"/>`);
  parts.push(`<path d="${path('unprompted')}" fill="none" stroke="var(--s2)" stroke-width="2.5" stroke-linejoin="round"/>`);
  parts.push(`<circle cx="${x(days)}" cy="${y(last.any)}" r="4.5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>`);
  parts.push(`<circle cx="${x(days)}" cy="${y(last.unprompted)}" r="4.5" fill="var(--s2)" stroke="var(--surface)" stroke-width="2"/>`);
  parts.push(`<text class="val" x="${x(days) + 12}" y="${y(last.any) + 5}">${(100 * last.any).toFixed(1)}%</text>`);
  parts.push(`<text class="val" x="${x(days) + 12}" y="${y(last.unprompted) + 5}">${(100 * last.unprompted).toFixed(1)}%</text>`);
  parts.push(`<text class="note" x="40" y="${height - 20}">Sample data with invented behaviour, generated to demonstrate the queries. Run npm run report -- events.db on your own events.</text>`);
  parts.push('</svg>');
  writeFileSync('docs/images/return-curve.svg', parts.join('\n') + '\n');
}

// --- 2. Cliffs -------------------------------------------------------------
{
  const stalled = report.cliffs.filter((c) => c.cohort === 'stalled');
  const total = stalled.reduce((sum, c) => sum + c.developers, 0);
  const rows = stalled.slice(0, 6);
  const width = 1200;
  const rowH = 44;
  const top = 120;
  const height = top + rows.length * rowH + 60;
  const labelW = 330;
  const barMax = 560;
  const max = Math.max(...rows.map((r) => r.developers));

  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">Last call within 30 days, for developers with a first success but no second</title>
<desc id="d">${rows.map((r) => `${r.status} ${r.keyMode} ${r.route}: ${r.developers}`).join('; ')}.</desc>
${STYLE}
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">Where developers who succeeded once stopped</text>
<text class="sub" x="40" y="68">The last call within 30 days made by each of the ${total} developers who had a first success but no second one. Sample data.</text>`];

  rows.forEach((row, i) => {
    const yy = top + i * rowH;
    const isError = row.status >= 400;
    const w = (row.developers / max) * barMax;
    parts.push(`<text class="lbl" x="40" y="${yy + 17}" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace">${row.status} ${row.keyMode.padEnd(4, ' ')} ${row.route}</text>`);
    parts.push(`<rect x="${40 + labelW}" y="${yy + 2}" width="${w.toFixed(1)}" height="22" rx="4" fill="${isError ? 'var(--bar)' : 'var(--muted)'}"/>`);
    parts.push(`<text class="val" x="${40 + labelW + w + 10}" y="${yy + 18}">${row.developers} <tspan class="axis">(${((100 * row.developers) / total).toFixed(1)}%)</tspan></text>`);
  });
  parts.push(`<text class="note" x="40" y="${height - 20}">Grey rows ended on a success: those developers went quiet without hitting an error. Blue rows ended on an error: those are the cliffs.</text>`);
  parts.push('</svg>');
  writeFileSync('docs/images/cliffs.svg', parts.join('\n') + '\n');
}

console.log('wrote docs/images/return-curve.svg and docs/images/cliffs.svg');
