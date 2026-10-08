import { DEFAULT_PARAMS, type Journey, type Params } from './store.js';

export interface Summary {
  developers: number;
  reachedFirstSuccess: number;
  /** Developers whose first success is at least `horizon` old: the denominator for SSR30. */
  eligible: number;
  ssr: number;
  unpromptedSsr: number;
  ttfs: { p50: number; p90: number };
  ttss: { p50: number; p90: number };
  /** Cumulative share of eligible developers with a second success, by day after first success. */
  curve: Array<{ day: number; any: number; unprompted: number }>;
}

const HOUR = 3600;
const DAY = 86400;

export function summarise(journeys: readonly Journey[], asOf: Date, params: Params = DEFAULT_PARAMS): Summary {
  const asOfSeconds = Math.floor(asOf.getTime() / 1000);
  const withFirst = journeys.filter((j) => j.firstSuccess !== null);
  // Only judge developers who've had the full horizon to come back.
  const eligible = withFirst.filter((j) => j.firstSuccess! <= asOfSeconds - params.horizon);
  const returned = eligible.filter((j) => j.secondSuccess !== null);
  const unprompted = returned.filter((j) => j.prompted === false);

  const days = Math.round(params.horizon / DAY);
  const curve = Array.from({ length: days + 1 }, (_, day) => {
    const by = (j: Journey) => j.secondSuccess! - j.firstSuccess! <= day * DAY;
    return {
      day,
      any: share(returned.filter(by).length, eligible.length),
      unprompted: share(unprompted.filter(by).length, eligible.length),
    };
  });

  return {
    developers: journeys.length,
    reachedFirstSuccess: withFirst.length,
    eligible: eligible.length,
    ssr: share(returned.length, eligible.length),
    unpromptedSsr: share(unprompted.length, eligible.length),
    ttfs: percentiles(withFirst.map((j) => (j.firstSuccess! - j.signedUp) / HOUR)),
    ttss: percentiles(returned.map((j) => (j.secondSuccess! - j.firstSuccess!) / DAY)),
    curve,
  };
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function percentiles(values: number[]): { p50: number; p90: number } {
  if (values.length === 0) return { p50: Number.NaN, p90: Number.NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return { p50: at(0.5), p90: at(0.9) };
}
