/**
 * Exponential backoff with full jitter: wait a random time between zero and
 * an exponentially growing ceiling. The randomness spreads retries out, so a
 * thousand phones coming out of the same tunnel don't hit your API together.
 */
export function backoff(attempt: number, baseMs = 1_000, capMs = 60_000, random = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}
