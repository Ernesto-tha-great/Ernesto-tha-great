import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkBudget } from '../src/budget';
import { costUsd, formatDuration, formatUsd, monthlyBytes, workSeconds, BYTES_PER_GB, VISITS_PER_MONTH } from '../src/cost';
import { executedBytes } from '../src/coverage';
import { loadMarket } from '../src/data';

describe('executedBytes', () => {
  it('lets an inner range that never ran override the outer range that did', () => {
    const source = 'x'.repeat(100);
    const result = executedBytes({
      url: 'app.js',
      source,
      functions: [
        { ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] }, // the script itself ran
        { ranges: [{ startOffset: 20, endOffset: 60, count: 0 }] }, // a function that never did
        { ranges: [{ startOffset: 70, endOffset: 90, count: 3 }, { startOffset: 75, endOffset: 80, count: 0 }] }, // a branch never taken
      ],
    });
    assert.deepEqual(result, { total: 100, used: 100 - 40 - 5 });
  });

  it('treats a script with no source as empty', () => {
    assert.deepEqual(executedBytes({ url: 'x.js', functions: [] }), { total: 0, used: 0 });
  });
});

describe('cost', () => {
  it('prices bytes in binary gigabytes', () => {
    assert.equal(costUsd(BYTES_PER_GB, 2.5), 2.5);
    assert.equal(costUsd(BYTES_PER_GB / 4, 2), 0.5);
  });

  it('models a month as one cold visit and the rest warm', () => {
    assert.equal(monthlyBytes(1000, 10), 1000 + (VISITS_PER_MONTH - 1) * 10);
  });

  it('turns dollars into work time at average hourly income', () => {
    // $20,800 a year over 2,080 hours is $10 an hour, so $5 is half an hour.
    assert.equal(workSeconds(5, 20_800), 1800);
  });

  it('formats durations from seconds to hours', () => {
    assert.equal(formatDuration(2.66), '2.7 s');
    assert.equal(formatDuration(17.2), '17 s');
    assert.equal(formatDuration(408), '6.8 min');
    assert.equal(formatDuration(1680), '28 min');
    assert.equal(formatDuration(122_400), '34 h');
    assert.equal(formatDuration(0.04), '< 0.1 s');
  });

  it('formats money down to fractions of a cent', () => {
    assert.equal(formatUsd(43.75), '$43.75');
    assert.equal(formatUsd(0.0094), '0.94¢');
    assert.equal(formatUsd(0.00002), '< 0.01¢');
  });
});

describe('market data', () => {
  function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'market-'));
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'countries.json'), JSON.stringify([{ iso3: 'NLD', name: 'Netherlands' }, { iso3: 'KEN', name: 'Kenya' }]));
    writeFileSync(join(dir, 'data/prices.csv'), 'country,usd_per_gb\n"Caribbean Netherlands",2.71\n"The Netherlands",1.61\n"Kenya",0.59\n');
    writeFileSync(join(dir, 'data/income.csv'), 'iso3,year,gni_per_capita_usd\nNLD,2025,68530\nKEN,2025,2200\n');
    return dir;
  }

  it('matches price-table spellings to our country names, exactly', () => {
    const market = loadMarket(fixture());
    assert.equal(market.priceFor('Netherlands'), 1.61); // not Caribbean Netherlands
    assert.equal(market.priceFor('Atlantis'), undefined);
    assert.deepEqual(market.incomeFor('Kenya'), { year: '2025', gni: 2200 });
  });

  it('fails a budget on money, work time, or a month of use', () => {
    const market = loadMarket(fixture());
    const page = { coldBytes: 0.01 * BYTES_PER_GB, warmBytes: 0 }; // 10 MB-ish: 0.59¢ in Kenya
    const [kenya, nowhere] = checkBudget(page, [
      { country: 'Kenya', maxFirstVisitUsd: 0.01, maxFirstVisitWorkSeconds: 5, maxMonthlyUsd: 0.001 },
      { country: 'Atlantis', maxFirstVisitUsd: 1 },
    ], market);
    assert.ok(Math.abs(kenya!.firstVisitUsd! - 0.0059) < 1e-9);
    // $2,200 a year is about $1.06 an hour, so 0.59¢ is about 20 seconds.
    assert.equal(Math.round(kenya!.firstVisitWorkSeconds!), 20);
    assert.deepEqual(kenya!.failures, ['work time', 'month']);
    assert.deepEqual(nowhere!.failures, ['no price data']);
  });
});
