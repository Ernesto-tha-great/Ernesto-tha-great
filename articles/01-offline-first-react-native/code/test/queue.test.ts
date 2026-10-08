import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createOrdersServer } from '../server/app';
import { backoff } from '../src/backoff';
import { createProbe } from '../src/probe';
import { OfflineQueue, type QueuedRequest, type Storage } from '../src/queue';
import { fileStorage } from '../src/storage';

function memoryStorage() {
  let saved = '[]';
  const storage: Storage & { saves: number } = {
    saves: 0,
    async load() {
      return JSON.parse(saved) as QueuedRequest[];
    },
    async save(items) {
      saved = JSON.stringify(items);
      storage.saves++;
    },
  };
  return storage;
}

let drops: boolean[] = [];
const api = createOrdersServer({ dropRate: 0.5, random: () => (drops.shift() ? 0 : 1) });
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => api.server.listen(0, resolve));
  baseUrl = `http://localhost:${(api.server.address() as AddressInfo).port}`;
});

after(() => {
  api.server.closeAllConnections();
  api.server.close();
});

const newQueue = (storage: Storage, extra = {}) =>
  new OfflineQueue({ baseUrl, storage, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 2_000, ...extra });

describe('OfflineQueue', () => {
  it('is on disk before enqueue resolves', async () => {
    const storage = memoryStorage();
    const queue = newQueue(storage);
    await queue.enqueue('/orders', { sku: 'disk', qty: 1 });
    assert.equal(storage.saves, 1);
    assert.equal((await storage.load())[0]!.path, '/orders');
  });

  it('retries a lost response without creating a second order', async () => {
    drops = [true]; // saved, then the connection drops
    const queue = newQueue(memoryStorage());
    await queue.enqueue('/orders', { sku: 'lost-reply', qty: 1 });

    await queue.flush();
    assert.equal(await queue.pending(), 1, 'the phone never heard back, so it keeps the order');

    await new Promise((resolve) => setTimeout(resolve, 5));
    await queue.flush();
    assert.equal(await queue.pending(), 0);
    assert.equal(api.orders.filter((order) => order.sku === 'lost-reply').length, 1);
  });

  it('gives up on a request the server rejects', async () => {
    const rejected: string[] = [];
    const queue = newQueue(memoryStorage(), { onDeadLetter: (_: QueuedRequest, reason: string) => rejected.push(reason) });
    await queue.enqueue('/orders', { sku: 'no-qty' });
    await queue.flush();
    assert.equal(await queue.pending(), 0);
    assert.match(rejected[0]!, /HTTP 422/);
  });

  it('survives the app being killed during an outage', async () => {
    const storage = memoryStorage();
    api.setDown(true);
    const first = newQueue(storage);
    await first.enqueue('/orders', { sku: 'outage', qty: 1 });
    await first.flush();

    api.setDown(false);
    const second = newQueue(storage); // a new process, reading from disk
    assert.equal(await second.pending(), 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await second.flush();
    assert.equal(await second.pending(), 0);
    assert.equal(api.orders.filter((order) => order.sku === 'outage').length, 1);
  });

  it("doesn't spend an item's attempts while the server is unreachable", async () => {
    const storage = memoryStorage();
    const queue = newQueue(storage, { probe: async () => false });
    await queue.enqueue('/orders', { sku: 'probe', qty: 1 });
    await queue.flush();
    const [item] = await storage.load();
    assert.equal(item!.attempts, 0);
    assert.ok(item!.nextAttemptAt > Date.now() - 1);
  });

  it('survives a double tap: two saves at once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'queue-'));
    const queue = newQueue(fileStorage(join(dir, 'queue.json')));
    await Promise.all([queue.enqueue('/orders', { sku: 'tap-1', qty: 1 }), queue.enqueue('/orders', { sku: 'tap-2', qty: 1 })]);
    const reopened = newQueue(fileStorage(join(dir, 'queue.json')));
    assert.equal(await reopened.pending(), 2);
  });

  it('shares one flush between callers', async () => {
    const queue = newQueue(memoryStorage());
    assert.equal(queue.flush(), queue.flush());
  });
});

describe('backoff', () => {
  it('stays between zero and a ceiling that doubles up to the cap', () => {
    assert.equal(backoff(1, 1_000, 60_000, () => 0.999), 999);
    assert.equal(backoff(3, 1_000, 60_000, () => 0.5), 2_000);
    assert.equal(backoff(20, 1_000, 60_000, () => 0.5), 30_000);
    assert.equal(backoff(5, 1_000, 60_000, () => 0), 0);
  });
});

describe('probe', () => {
  it('only trusts a 204 from your own server', async () => {
    assert.equal(await createProbe(`${baseUrl}/generate_204`)(), true);
    assert.equal(await createProbe(`${baseUrl}/orders`)(), false); // a 200 page, like a hotel login
    assert.equal(await createProbe('http://localhost:1/generate_204', 500)(), false);
  });
});
