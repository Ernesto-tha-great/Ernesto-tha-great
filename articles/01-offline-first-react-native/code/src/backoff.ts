/**
 * Exponential backoff with "full jitter": pick a random delay between zero and
 * the exponential ceiling. Spreading retries out stops every phone on the train
 * from hammering your API in the same second the train leaves the tunnel.
 *
 * See Marc Brooker, "Exponential Backoff And Jitter", AWS Architecture Blog (2015).
 */
export function fullJitterDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}
