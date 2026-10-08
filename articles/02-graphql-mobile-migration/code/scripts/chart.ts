/** Draws results/measure.json as docs/images/measure.svg: two small panels, same scenarios. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Row { scenario: string; statements: number; medianMs: number; p95Ms: number }

const root = fileURLToPath(new URL('..', import.meta.url));
const rows = JSON.parse(readFileSync(join(root, 'results/measure.json'), 'utf8')) as Row[];
const out = process.argv[2] ?? join(root, 'docs/images/measure.svg');

const width = 1200;
const labelWidth = 330;
const barMax = 180;
const rowHeight = 46;
const panelTop = 140;
const height = panelTop + rows.length * rowHeight + 70;
const panels = [
  { x: 40, title: 'SQL statements per request', value: (r: Row) => r.statements, unit: '' },
  { x: 640, title: 'Median response time', value: (r: Row) => r.medianMs, unit: ' ms' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">Cost of the order history screen per schema</title>
<desc id="d">${rows.map((r) => `${esc(r.scenario)}: ${r.statements} statements, ${r.medianMs} ms median`).join('; ')}.</desc>
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#8a8983; --bar:#2a78d6; --rule:#e4e3de; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --ink-3:#8f8e86; --bar:#3987e5; --rule:#383835; } }
  text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: var(--ink); }
  .h1 { font-size: 22px; font-weight: 700; }
  .sub { font-size: 14px; fill: var(--ink-2); }
  .h2 { font-size: 15px; font-weight: 600; }
  .lbl { font-size: 13px; fill: var(--ink-2); }
  .val { font-size: 13px; font-weight: 600; }
  .note { font-size: 12px; fill: var(--ink-3); }
</style>
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">One screen, three ways</text>
<text class="sub" x="40" y="68">The order history screen. In-memory SQLite with 1 ms per statement and a pool of 10 connections; 30 runs each.</text>`];

for (const panel of panels) {
  const max = Math.max(...rows.map(panel.value));
  parts.push(`<text class="h2" x="${panel.x}" y="${panelTop - 30}">${panel.title}</text>`);
  rows.forEach((row, i) => {
    const y = panelTop + i * rowHeight;
    const value = panel.value(row);
    const w = Math.max(2, (value / max) * barMax);
    if (panel.x === 40) {
      parts.push(`<text class="lbl" x="${panel.x}" y="${y + 17}">${esc(row.scenario)}</text>`);
    }
    const bx = panel.x === 40 ? panel.x + labelWidth : panel.x;
    parts.push(`<rect x="${bx}" y="${y + 2}" width="${w.toFixed(1)}" height="22" rx="4" fill="var(--bar)"/>`);
    parts.push(`<text class="val" x="${bx + w + 10}" y="${y + 18}">${value}${panel.unit}</text>`);
  });
}

parts.push(`<text class="note" x="40" y="${height - 24}">Source: npm run measure. Absolute times depend on your machine; the ratio is the point.</text>`);
parts.push('</svg>');
writeFileSync(out, parts.join('\n') + '\n');
console.log(`wrote ${out}`);
