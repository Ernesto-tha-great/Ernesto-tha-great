/** The shape Playwright's page.coverage.stopJSCoverage() returns (V8 block coverage). */
export interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

export interface CoverageEntry {
  url: string;
  source?: string;
  functions: Array<{ ranges: CoverageRange[] }>;
}

/**
 * How much of a script actually ran. V8 reports nested ranges with the outer
 * range first, so painting them in order lets each inner range overwrite its
 * parent: a function that never ran is 0 even inside a script that did.
 */
export function executedBytes(entry: CoverageEntry): { total: number; used: number } {
  const total = entry.source?.length ?? 0;
  if (total === 0) return { total: 0, used: 0 };

  const ran = new Uint8Array(total);
  for (const fn of entry.functions) {
    for (const range of fn.ranges) {
      ran.fill(range.count > 0 ? 1 : 0, range.startOffset, Math.min(range.endOffset, total));
    }
  }

  let used = 0;
  for (const byte of ran) used += byte;
  return { total, used };
}

export function summariseCoverage(entries: readonly CoverageEntry[]): { sourceBytes: number; usedBytes: number } {
  let sourceBytes = 0;
  let usedBytes = 0;
  for (const entry of entries) {
    const { total, used } = executedBytes(entry);
    sourceBytes += total;
    usedBytes += used;
  }
  return { sourceBytes, usedBytes };
}
