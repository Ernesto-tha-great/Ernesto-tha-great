/**
 * Renders results/results.json as a static SVG for the article:
 * one small multiple per trace, one 100% stacked bar per strategy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Row {
  trace: string;
  source: string;
  strategy: string;
  actions: number;
  exactlyOnce: number;
  duplicated: number;
  lost: number;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const rows = JSON.parse(readFileSync(join(root, 'results/results.json'), 'utf8')) as Row[];
const out = process.argv[2] ?? join(root, 'docs/images/results.svg');

const TITLES: Record<string, string> = {
  'underground-commute': 'Underground commute (20 min)',
  'conference-wifi': 'Conference Wi-Fi with captive portal (15 min)',
  lift: 'Office lift (6 min)',
  'data-cap': 'SIM over its data cap (15 min)',
};
const ORDER = ['underground-commute', 'data-cap', 'conference-wifi', 'lift'];
const SEGMENTS = [
  { key: 'exactlyOnce', label: 'Exactly once', color: 'var(--good)' },
  { key: 'duplicated', label: 'Duplicated', color: 'var(--warning)' },
  { key: 'lost', label: 'Lost', color: 'var(--critical)' },
] as const;

const width = 1200;
const panelWidth = 560;
const labelWidth = 160;
const barWidth = 210;
const barHeight = 24;
const barGap = 16;
const panelHeight = 44 + 4 * (barHeight + barGap);
const top = 118;
const height = top + 2 * panelHeight + 36;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const parts: string[] = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">Delivery outcomes by strategy across four network traces</title>
<desc id="d">For each trace, a 100% stacked bar per strategy shows the share of user actions delivered exactly once, duplicated, or lost. The checked-luggage strategy delivers 100% exactly once on every trace.</desc>
<style>
  svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#8a8983; --rule:#e4e3de; --good:#0ca30c; --warning:#fab219; --critical:#d03b3b; }
  @media (prefers-color-scheme: dark) { svg { --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --ink-3:#8f8e86; --rule:#383835; } }
  text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: var(--ink); }
  .h1 { font-size: 22px; font-weight: 700; }
  .sub { font-size: 14px; fill: var(--ink-2); }
  .h2 { font-size: 15px; font-weight: 600; }
  .lbl { font-size: 13px; fill: var(--ink-2); }
  .val { font-size: 13px; font-weight: 600; }
  .note { font-size: 12px; fill: var(--ink-3); }
</style>
<rect width="100%" height="100%" fill="var(--surface)"/>
<text class="h1" x="40" y="44">How often did each order reach the server exactly once?</text>
<text class="sub" x="40" y="68">Share of user actions per outcome. 25 seeded runs per trace and strategy, synthetic traces.</text>`);

// Legend
let lx = 40;
for (const segment of SEGMENTS) {
  parts.push(`<rect x="${lx}" y="86" width="14" height="14" rx="3" fill="${segment.color}"/>`);
  parts.push(`<text class="lbl" x="${lx + 20}" y="98">${segment.label}</text>`);
  lx += 20 + segment.label.length * 7.4 + 24;
}

ORDER.forEach((trace, index) => {
  const px = 40 + (index % 2) * (panelWidth + 40);
  const py = top + Math.floor(index / 2) * panelHeight;
  parts.push(`<text class="h2" x="${px}" y="${py + 20}">${esc(TITLES[trace] ?? trace)}</text>`);

  rows
    .filter((row) => row.trace === trace)
    .forEach((row, i) => {
      const y = py + 36 + i * (barHeight + barGap);
      const bx = px + labelWidth;
      const clipId = `clip-${index}-${i}`;
      parts.push(`<text class="lbl" x="${px}" y="${y + barHeight / 2 + 4.5}">${esc(row.strategy)}</text>`);
      parts.push(`<clipPath id="${clipId}"><rect x="${bx}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4"/></clipPath>`);
      parts.push(`<g clip-path="url(#${clipId})">`);
      let x = bx;
      for (const segment of SEGMENTS) {
        const share = row[segment.key] / row.actions;
        if (share <= 0) continue;
        const w = share * barWidth;
        // 2px surface gap between neighbouring segments
        parts.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(0, w - 2).toFixed(1)}" height="${barHeight}" fill="${segment.color}"/>`);
        x += w;
      }
      parts.push('</g>');
      const once = (100 * row.exactlyOnce) / row.actions;
      const problems: string[] = [];
      if (row.duplicated) problems.push(`${((100 * row.duplicated) / row.actions).toFixed(1)}% dup`);
      if (row.lost) problems.push(`${((100 * row.lost) / row.actions).toFixed(1)}% lost`);
      parts.push(`<text class="val" x="${bx + barWidth + 12}" y="${y + barHeight / 2 + 4.5}">${once.toFixed(1)}%</text>`);
      if (problems.length) {
        parts.push(`<text class="note" x="${bx + barWidth + 62}" y="${y + barHeight / 2 + 4.5}">${problems.join(' · ')}</text>`);
      }
    });
});

parts.push(`<text class="note" x="40" y="${height - 24}">Source: bench/run.ts replaying the synthetic fixtures in sim/traces. Re-run with recorded traces before quoting these numbers.</text>`);
parts.push('</svg>');

writeFileSync(out, parts.join('\n') + '\n');
console.log(`wrote ${out}`);
