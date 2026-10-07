import { OfflineQueue } from '../src/queue.js';
import { MemoryStorage } from '../src/storage.js';
import type { OrderService } from '../server/core.js';
import type { SimClock } from './clock.js';
import { simTransport, type SimNetwork } from './network.js';

export interface UserAction {
  actionId: string;
  createdAt: number;
  sku: string;
  qty: number;
}

export interface StrategyContext {
  clock: SimClock;
  network: SimNetwork;
  service: OrderService;
  random: () => number;
}

/** One way of getting a user's action to the server. */
export interface Strategy {
  userAction(action: UserAction): Promise<void>;
  /** Called once a simulated second while the app is in the foreground. */
  tick(): Promise<void>;
  /** The OS killed the app. Whatever lived only in memory is gone. */
  kill(): Promise<void>;
  /** The app came back to the foreground (or was relaunched after a kill). */
  resume(): Promise<void>;
  /** NetInfo says the interface changed. A hint, not the truth. */
  connectivityHint(): Promise<void>;
}

export interface StrategyDefinition {
  name: string;
  summary: string;
  /** Whether the server deduplicates for this client (it can only if the client sends tags). */
  sendsIdempotencyKeys: boolean;
  create(ctx: StrategyContext): Strategy;
}

let counter = 0;
const freshKey = () => `req-${++counter}`;

const orderItem = (action: UserAction, id: string) => ({
  id,
  method: 'POST',
  path: '/orders',
  body: { sku: action.sku, qty: action.qty, actionId: action.actionId },
});

/** A. Call fetch when the user taps Save. If it fails, show an error. */
const fireAndForget: StrategyDefinition = {
  name: 'Fire and forget',
  summary: 'fetch() on tap, no retry',
  sendsIdempotencyKeys: false,
  create: ({ network, service }) => ({
    async userAction(action) {
      network.exchange(() => service.processBatch([orderItem(action, freshKey())]));
    },
    async tick() {},
    async kill() {},
    async resume() {},
    async connectivityHint() {},
  }),
};

/** B. The hand-rolled classic: retry with exponential backoff, kept in memory. */
const retryInMemory: StrategyDefinition = {
  name: 'Retry in memory',
  summary: 'exponential backoff, in-memory, no keys',
  sendsIdempotencyKeys: false,
  create: ({ clock, network, service }) => {
    let pending: Array<{ action: UserAction; attempts: number; nextAt: number }> = [];

    const send = (action: UserAction) => network.exchange(() => service.processBatch([orderItem(action, freshKey())])).ok;

    return {
      async userAction(action) {
        if (!send(action)) pending.push({ action, attempts: 1, nextAt: clock.now() + 1_000 });
      },
      async tick() {
        for (const entry of [...pending]) {
          if (entry.nextAt > clock.now()) continue;
          if (send(entry.action)) {
            pending = pending.filter((candidate) => candidate !== entry);
          } else {
            entry.attempts++;
            entry.nextAt = clock.now() + Math.min(60_000, 1_000 * 2 ** entry.attempts);
          }
        }
      },
      async kill() {
        pending = [];
      },
      async resume() {},
      async connectivityHint() {},
    };
  },
};

/** C. A durable queue that survives kills, but sends no idempotency keys. */
const durableNoKeys: StrategyDefinition = {
  name: 'Durable queue, no tags',
  summary: 'persisted + jittered backoff, server cannot dedupe',
  sendsIdempotencyKeys: false,
  create: (ctx) => durableQueueStrategy(ctx, { probe: false, batchSize: 20 }),
};

/** D. Checked luggage: durable, tagged, batched, and checks the network before sending. */
const checkedLuggage: StrategyDefinition = {
  name: 'Checked luggage',
  summary: 'persisted + tags + batching + reachability probe',
  sendsIdempotencyKeys: true,
  create: (ctx) => durableQueueStrategy(ctx, { probe: true, batchSize: 20 }),
};

function durableQueueStrategy(
  { clock, network, service, random }: StrategyContext,
  config: { probe: boolean; batchSize: number },
): Strategy {
  const storage = new MemoryStorage(); // stands in for disk: it survives kill()
  const build = () =>
    new OfflineQueue({
      storage,
      transport: simTransport(network, service),
      probe: config.probe ? async () => network.probe() : undefined,
      maxBatchSize: config.batchSize,
      now: clock.now,
      random,
      createId: freshKey,
    });

  let queue = build();
  const flushIfDue = async () => {
    const wake = queue.nextWakeAt();
    if (wake !== null && wake <= clock.now()) await queue.flush();
  };

  return {
    async userAction(action) {
      await queue.enqueue({ method: 'POST', path: '/orders', body: { sku: action.sku, qty: action.qty, actionId: action.actionId } });
      await queue.flush();
    },
    tick: flushIfDue,
    async kill() {
      queue = build(); // a fresh process: it reloads from storage on first use
    },
    async resume() {
      await queue.flush();
    },
    async connectivityHint() {
      await queue.flush();
    },
  };
}

export const STRATEGIES: StrategyDefinition[] = [fireAndForget, retryInMemory, durableNoKeys, checkedLuggage];
