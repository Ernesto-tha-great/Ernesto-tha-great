/** Carriers sell data in binary gigabytes (1 GB = 1024 MB), so we price it the same way. */
export const BYTES_PER_GB = 2 ** 30;

/**
 * "Using a site" for a month: five visits a day for 30 days. The first visit
 * has an empty cache; the other 149 get whatever the cache saved.
 */
export const VISITS_PER_MONTH = 150;

/** A 40-hour week, 52 weeks a year. Only used to turn yearly income into an hourly figure. */
export const WORK_HOURS_PER_YEAR = 2080;

export function costUsd(bytes: number, usdPerGb: number): number {
  return (bytes / BYTES_PER_GB) * usdPerGb;
}

export function monthlyBytes(coldBytes: number, warmBytes: number): number {
  return coldBytes + (VISITS_PER_MONTH - 1) * warmBytes;
}

/**
 * How long someone on the country's average income works to earn `usd`:
 * GNI per capita spread evenly over a working year. It's an average, not a
 * wage, and it flatters every country with a wide income gap.
 */
export function workSeconds(usd: number, gniPerCapitaUsd: number): number {
  return usd / (gniPerCapitaUsd / WORK_HOURS_PER_YEAR / 3600);
}

export function formatDuration(seconds: number): string {
  if (seconds < 0.1) return '< 0.1 s';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

export function formatUsd(usd: number): string {
  if (usd < 0.0001) return '< 0.01¢';
  return usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(2)}`;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
