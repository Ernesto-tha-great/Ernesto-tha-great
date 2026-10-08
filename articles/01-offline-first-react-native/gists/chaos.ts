// One bad afternoon, three ways of sending orders through it.
//
// 100 orders, one every 40 ms. The server hangs up on 25% of them after saving,
// goes down completely for 2 seconds in the middle, and the "app" is killed
// every 25 orders. Then we count what the server ended up with.
import { rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createOrdersServer } from '../server/app';
import { createProbe } from '../src/probe';
import { OfflineQueue } from '../src/queue';
import { fileStorage } from '../src/storage';

const ORDERS = 100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A seeded random, so every run drops the same requests. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

interface Approach {
  name: string;
  /** The user taps "Save". */
  tap(sku: string): void;
  /** The OS kills the app. Anything only in memory is gone. */
  kill(): void;
  /** The app is opened again later and gets a chance to finish. */
  finish(): Promise<void>;
}

async function run(makeApproach: (api: string) => Approach) {
  const { server, orders, setDown } = createOrdersServer({ dropRate: 0.25, random: seeded(42) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const api = `http://localhost:${(server.address() as AddressInfo).port}`;
  const approach = makeApproach(api);

  for (let i = 1; i <= ORDERS; i++) {
    if (i === 40) setDown(true); // the outage starts...
    if (i === 90) setDown(false); // ...and ends 2 seconds later
    approach.tap(`SKU-${i}`);
    await sleep(40);
    if (i % 25 === 0) approach.kill(); // a moment after "Saved", the OS kills the app
  }
  await approach.finish();

  server.closeAllConnections();
  server.close();

  const counts = new Map<string, number>();
  for (const order of orders) counts.set(order.sku, (counts.get(order.sku) ?? 0) + 1);
  const lost = ORDERS - counts.size;
  const duplicated = [...counts.values()].filter((n) => n > 1).length;
  return { name: approach.name, lost, duplicated, exactlyOnce: ORDERS - lost - duplicated };
}

// 1. What most apps do: fetch, retry three times, give up.
const naive = (api: string): Approach => {
  let generation = 0;
  return {
    name: 'fetch + 3 retries',
    tap(sku) {
      const born = generation;
      void (async () => {
        for (let attempt = 0; attempt < 3 && born === generation; attempt++) {
          try {
            const res = await fetch(`${api}/orders`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sku, qty: 1 }),
            });
            if (res.ok) return;
          } catch {}
        }
      })();
    },
    kill() {
      generation++; // every retry loop that's still running dies with the app
    },
    async finish() {
      await sleep(1_000);
    },
  };
};

// 2. Same retries, plus an idempotency key. Still only in memory.
const tagged = (api: string): Approach => {
  let generation = 0;
  return {
    name: 'retries + idempotency key',
    tap(sku) {
      const born = generation;
      const key = crypto.randomUUID();
      void (async () => {
        for (let attempt = 0; attempt < 3 && born === generation; attempt++) {
          try {
            const res = await fetch(`${api}/orders`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'idempotency-key': key },
              body: JSON.stringify({ sku, qty: 1 }),
            });
            if (res.ok) return;
          } catch {}
        }
      })();
    },
    kill() {
      generation++;
    },
    async finish() {
      await sleep(1_000);
    },
  };
};

// 3. The queue: tagged, on disk, backed off, probed.
const queued = (api: string): Approach => {
  const disk = fileStorage('chaos-queue.json');
  let generation = 0;
  const make = () => {
    const born = ++generation;
    const alive = () => born === generation;
    const probe = createProbe(`${api}/generate_204`, 500);
    return new OfflineQueue({
      baseUrl: api,
      // A killed app can't write to disk any more, and its next flush goes nowhere.
      storage: { load: () => disk.load(), save: async (items) => (alive() ? disk.save(items) : undefined) },
      probe: async () => alive() && (await probe()),
      timeoutMs: 1_000,
      baseDelayMs: 100,
      maxDelayMs: 2_000,
    });
  };
  let queue = make();
  return {
    name: 'the queue',
    tap(sku) {
      void queue.enqueue('/orders', { sku, qty: 1 }).then(() => queue.flush());
    },
    kill() {
      queue = make(); // a fresh launch: it only knows what's on disk
    },
    async finish() {
      const deadline = Date.now() + 15_000;
      while ((await queue.pending()) > 0 && Date.now() < deadline) {
        await queue.flush();
        await sleep(100);
      }
    },
  };
};

await rm('chaos-queue.json', { force: true });
const results = [await run(naive), await run(tagged), await run(queued)];
await rm('chaos-queue.json', { force: true });

console.table(results);
