// Plays the part of the app: saves some orders, then tries to send them.
//   npx tsx scripts/place-orders.ts 5    # save 5 new orders
//   npx tsx scripts/place-orders.ts 0    # save nothing, just send what's waiting
import { readFile } from 'node:fs/promises';
import { createProbe } from '../src/probe';
import { OfflineQueue, type QueuedRequest } from '../src/queue';
import { fileStorage } from '../src/storage';

const API = process.env.API ?? 'http://localhost:8787';

const queue = new OfflineQueue({
  baseUrl: API,
  storage: fileStorage('queue.json'),
  probe: createProbe(`${API}/generate_204`),
});

const count = Number(process.argv[2] ?? 5);
for (let i = 1; i <= count; i++) {
  await queue.enqueue('/orders', { sku: `SKU-${Date.now()}-${i}`, qty: 1 });
}
await queue.flush();
await showQueue();

/** Prints what's in queue.json right now. */
async function showQueue() {
  const items = JSON.parse(await readFile('queue.json', 'utf8').catch(() => '[]')) as QueuedRequest[];
  console.log(`${items.length} in the queue`);
  if (items.length === 0) return;
  console.table(
    items.map((item) => ({
      attempts: item.attempts,
      'next try in': `${Math.max(0, (item.nextAttemptAt - Date.now()) / 1000).toFixed(1)} s`,
      'last error': item.lastError ?? '',
    })),
  );
}
