/**
 * A network trace is a timeline of link states. Four states cover the failures
 * that matter to a mobile app:
 *
 *   up         packets flow, with some latency and loss
 *   down       no interface at all; requests fail instantly (NetInfo knows)
 *   blackhole  the phone looks connected but nothing comes back; requests time out
 *              (lifts, platforms with "one bar", a SIM over its data cap)
 *   captive    every request gets an HTML login page with a 200 OK (hotel and
 *              conference Wi-Fi before you sign in)
 */
export type LinkState = 'up' | 'down' | 'blackhole' | 'captive';

export interface Segment {
  seconds: number;
  state: LinkState;
  latencyMs?: number;
  /** For "up" segments: chance a request or its response is lost in transit. */
  lossRate?: number;
}

export type AppEvent = 'suspend' | 'resume' | 'kill';

export interface Trace {
  name: string;
  description: string;
  /** "synthetic" fixtures ship with the repo; "recorded" traces come from real devices. */
  source: 'synthetic' | 'recorded';
  segments: Segment[];
  events?: Array<{ at: number; type: AppEvent }>;
}

/** After the trace ends the simulator gives everyone a clean network to drain on. */
export const DRAIN_SEGMENT: Segment = { seconds: Infinity, state: 'up', latencyMs: 150, lossRate: 0 };

export function durationMs(trace: Trace): number {
  return trace.segments.reduce((total, segment) => total + segment.seconds * 1_000, 0);
}

export function segmentAt(trace: Trace, atMs: number): Segment {
  let start = 0;
  for (const segment of trace.segments) {
    const end = start + segment.seconds * 1_000;
    if (atMs < end) return segment;
    start = end;
  }
  return DRAIN_SEGMENT;
}
