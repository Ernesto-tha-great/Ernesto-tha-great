import { costUsd, monthlyBytes, workSeconds } from './cost.js';
import type { Market } from './data.js';

export interface BudgetLine {
  country: string;
  /** The most one first visit (empty cache) may cost someone in this country. */
  maxFirstVisitUsd?: number;
  /** The same limit in work time: seconds of average income. Fairer across countries than dollars. */
  maxFirstVisitWorkSeconds?: number;
  /** The most a month of use (one first visit, 149 repeat visits) may cost. */
  maxMonthlyUsd?: number;
}

export interface BudgetResult {
  country: string;
  firstVisitUsd: number | null;
  firstVisitWorkSeconds: number | null;
  monthlyUsd: number | null;
  failures: string[];
}

export function checkBudget(load: { coldBytes: number; warmBytes: number }, lines: readonly BudgetLine[], market: Market): BudgetResult[] {
  return lines.map((line) => {
    const price = market.priceFor(line.country);
    if (price === undefined) {
      return { country: line.country, firstVisitUsd: null, firstVisitWorkSeconds: null, monthlyUsd: null, failures: ['no price data'] };
    }
    const firstVisitUsd = costUsd(load.coldBytes, price);
    const monthlyUsd = costUsd(monthlyBytes(load.coldBytes, load.warmBytes), price);
    const income = market.incomeFor(line.country);
    const firstVisitWorkSeconds = income ? workSeconds(firstVisitUsd, income.gni) : null;

    const failures: string[] = [];
    if (line.maxFirstVisitUsd !== undefined && firstVisitUsd > line.maxFirstVisitUsd) failures.push('first visit');
    if (line.maxFirstVisitWorkSeconds !== undefined) {
      if (firstVisitWorkSeconds === null) failures.push('no income data');
      else if (firstVisitWorkSeconds > line.maxFirstVisitWorkSeconds) failures.push('work time');
    }
    if (line.maxMonthlyUsd !== undefined && monthlyUsd > line.maxMonthlyUsd) failures.push('month');
    return { country: line.country, firstVisitUsd, firstVisitWorkSeconds, monthlyUsd, failures };
  });
}
