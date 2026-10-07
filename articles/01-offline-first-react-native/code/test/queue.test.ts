import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullJitterDelay } from '../src/backoff.js';
import { OfflineQueue } from '../src/queue.js';
import { MemoryStorage } from '../src/storage.js';
import { TransportError, type ItemResult, type QueuedRequest, type Transport } from '../src/types.js';

const order = { method: 'POST' as const, path: '/orders', body: { sku: 'SKU-1', qty: 1 } };

function setup(transport: Transport, extra: Partial<ConstructorParameters<typeof OfflineQueue>[0]> = {}) {
  let t = 1_000_000;
  let n = 0;
  const storage = new MemoryStorage();
  const deadLetters: Array<{ item: QueuedRequest; reason: string }> = [];
  const queue = new OfflineQueue({
    storage,
    transport,
    now: () => t,
    random: () => 0.5,
    createId: () => `id-${++n}`,
    onDeadLetter: (item, reason) => deadLetters.push({ item, reason }),
    ...extra,
  });
  return { queue, storage, deadLetters, advance: (ms: number) => (t += ms), now: () => t };
}

const deliverAll: Transport = async (batch) => batch.map((item) => ({ id: item.id, status: 'delivered' as const }));

describe('fullJitterDelay', () => {
  it('stays between zero and the capped exponential ceiling', () => {
    assert.equal(fullJitterDelay(1, 1_000, 60_000, () => 0.999), 999);
    assert.equal(fullJitterDelay(4, 1_000, 60_000, () => 0.999), 7_992);
    assert.equal(fullJitterDelay(20, 1_000, 60_000, () => 0.999), 59_940);
    assert.equal(fullJitterDelay(3, 1_000, 60_000, () => 0), 0);
  });
});

describe('OfflineQueue', () => {
  it('persists a request before enqueue() resolves', async () => {
    const { queue, storage } = setup(deliverAll);
    await queue.enqueue(order);
    const onDisk = await storage.load();
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0]!.id, 'id-1');
  });

  it('removes delivered items and retries only the failed part of a batch', async () => {
    const transport: Transport = async (batch) =>
      batch.map((item, i): ItemResult =>
        i % 2 === 0 ? { id: item.id, status: 'delivered' } : { id: item.id, status: 'retry', reason: 'db busy' },
      );
    const { queue } = setup(transport);
    for (let i = 0; i < 4; i++) await queue.enqueue(order);

    const report = await queue.flush();
    assert.equal(report.delivered, 2);
    assert.equal(report.retrying, 2);
    assert.deepEqual((await queue.pending()).map((item) => item.id), ['id-2', 'id-4']);
  });

  it('treats a missing verdict as "retry", never as "delivered"', async () => {
    const { queue } = setup(async () => []);
    await queue.enqueue(order);
    const report = await queue.flush();
    assert.equal(report.retrying, 1);
    assert.equal((await queue.pending()).length, 1);
  });

  it('backs off on network failures but never dead-letters because of them', async () => {
    const { queue, deadLetters, advance } = setup(async () => {
      throw new TransportError('offline', 'no route to host');
    });
    await queue.enqueue(order);
    for (let i = 0; i < 50; i++) {
      await queue.flush();
      advance(120_000);
    }
    const [item] = await queue.pending();
    assert.equal(deadLetters.length, 0);
    assert.equal(item!.attempts, 50);
    assert.equal(item!.serverRetries, 0);
  });

  it('honours Retry-After as a minimum delay', async () => {
    const { queue, now } = setup(async () => {
      throw new TransportError('server-unavailable', 'HTTP 503', 30_000);
    });
    await queue.enqueue(order);
    await queue.flush();
    assert.equal(queue.nextWakeAt(), now() + 30_000);
  });

  it('dead-letters items the server rejects', async () => {
    const { queue, deadLetters } = setup(async (batch) =>
      batch.map((item) => ({ id: item.id, status: 'rejected' as const, reason: 'invalid sku' })),
    );
    await queue.enqueue(order);
    await queue.flush();
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0]!.reason, 'invalid sku');
    assert.equal((await queue.pending()).length, 0);
  });

  it('dead-letters after the server asks for too many retries', async () => {
    const { queue, deadLetters, advance } = setup(
      async (batch) => batch.map((item) => ({ id: item.id, status: 'retry' as const, reason: 'locked' })),
      { maxServerRetries: 3 },
    );
    await queue.enqueue(order);
    for (let i = 0; i < 3; i++) {
      await queue.flush();
      advance(120_000);
    }
    assert.equal(deadLetters.length, 1);
  });

  it('does not burn attempts while the probe says we are offline', async () => {
    let calls = 0;
    const { queue, now } = setup(
      async (batch) => {
        calls++;
        return deliverAll(batch);
      },
      { probe: async () => 'captive-portal' },
    );
    await queue.enqueue(order);
    const report = await queue.flush();

    assert.equal(report.reachability, 'captive-portal');
    assert.equal(calls, 0);
    assert.equal((await queue.pending())[0]!.attempts, 0);
    assert.ok(queue.nextWakeAt()! > now(), 'the next check is pushed into the future');
  });

  it('shares one flush between concurrent callers', async () => {
    let calls = 0;
    const { queue } = setup(async (batch) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return deliverAll(batch);
    });
    await queue.enqueue(order);
    await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
    assert.equal(calls, 1);
  });

  it('picks up where it left off after the app is killed', async () => {
    const first = setup(async () => {
      throw new TransportError('offline', 'tunnel');
    });
    await first.queue.enqueue(order);
    await first.queue.flush();

    const relaunched = new OfflineQueue({ storage: first.storage, transport: deliverAll, now: () => Number.MAX_SAFE_INTEGER });
    const report = await relaunched.flush();
    assert.equal(report.delivered, 1);
  });

  it('splits large queues into batches and stops after a network failure', async () => {
    const sizes: number[] = [];
    let calls = 0;
    const { queue } = setup(
      async (batch) => {
        sizes.push(batch.length);
        if (++calls === 2) throw new TransportError('timeout', 'lift');
        return deliverAll(batch);
      },
      { maxBatchSize: 10 },
    );
    for (let i = 0; i < 35; i++) await queue.enqueue(order);
    const report = await queue.flush();
    assert.deepEqual(sizes, [10, 10]);
    assert.equal(report.delivered, 10);
    assert.equal((await queue.pending()).length, 25);
  });
});
