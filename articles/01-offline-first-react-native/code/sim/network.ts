import { TransportError, type Reachability, type Transport, type TransportFailure } from '../src/types.js';
import type { OrderService } from '../server/core.js';
import type { SimClock } from './clock.js';
import { segmentAt, type Trace } from './trace.js';

export type Exchange<T> = { ok: true; value: T } | { ok: false; kind: TransportFailure };

/**
 * Replays a trace against simulated HTTP exchanges. The important detail is the
 * difference between a lost *request* (the server never saw it) and a lost
 * *response* (the server did the work, the phone never heard back). Only the
 * second one creates duplicates, and only idempotency keys stop them.
 */
export class SimNetwork {
  constructor(
    private readonly trace: Trace,
    private readonly clock: SimClock,
    private readonly random: () => number,
    private readonly requestTimeoutMs = 15_000,
    private readonly probeTimeoutMs = 5_000,
  ) {}

  state() {
    return segmentAt(this.trace, this.clock.now());
  }

  exchange<T>(serve: () => T): Exchange<T> {
    const segment = this.state();
    const latency = segment.latencyMs ?? 150;

    switch (segment.state) {
      case 'down':
        this.clock.advance(50);
        return { ok: false, kind: 'offline' };
      case 'blackhole':
        this.clock.advance(this.requestTimeoutMs);
        return { ok: false, kind: 'timeout' };
      case 'captive':
        this.clock.advance(latency * 2);
        return { ok: false, kind: 'captive-portal' };
      case 'up': {
        const loss = segment.lossRate ?? 0;
        const roll = this.random();
        if (roll < loss / 2) {
          // Lost on the way out: the server never sees it.
          this.clock.advance(this.requestTimeoutMs);
          return { ok: false, kind: 'timeout' };
        }
        this.clock.advance(latency);
        const value = serve();
        if (roll < loss) {
          // Lost on the way back: the work is done, the phone doesn't know.
          this.clock.advance(this.requestTimeoutMs - latency);
          return { ok: false, kind: 'timeout' };
        }
        this.clock.advance(latency);
        return { ok: true, value };
      }
    }
  }

  probe(): Reachability {
    const segment = this.state();
    const latency = segment.latencyMs ?? 150;
    switch (segment.state) {
      case 'down':
        this.clock.advance(50);
        return 'offline';
      case 'blackhole':
        this.clock.advance(this.probeTimeoutMs);
        return 'offline';
      case 'captive':
        this.clock.advance(latency * 2);
        return 'captive-portal';
      case 'up':
        if (this.random() < (segment.lossRate ?? 0)) {
          this.clock.advance(this.probeTimeoutMs);
          return 'offline';
        }
        this.clock.advance(latency * 2);
        return 'online';
    }
  }
}

/** A Transport for OfflineQueue that goes through the simulated network. */
export function simTransport(network: SimNetwork, service: OrderService): Transport {
  return async (batch) => {
    const result = network.exchange(() =>
      service.processBatch(batch.map(({ id, method, path, body }) => ({ id, method, path, body }))),
    );
    if (!result.ok) throw new TransportError(result.kind, `simulated ${result.kind}`);
    return result.value;
  };
}
