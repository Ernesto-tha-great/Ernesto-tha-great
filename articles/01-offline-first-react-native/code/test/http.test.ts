import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { createApp } from '../server/app.js';
import { OrderService } from '../server/core.js';
import { createHttpTransport } from '../src/http-transport.js';
import { createReachabilityProbe } from '../src/probe.js';
import { OfflineQueue } from '../src/queue.js';
import { MemoryStorage } from '../src/storage.js';
import { TransportError } from '../src/types.js';

const servers: Server[] = [];
after(() => servers.forEach((server) => server.close()));

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Drops the response to the first batch, then behaves. */
function dropFirstResponse() {
  let calls = 0;
  return () => (++calls === 1 ? 0 : 1);
}

async function deliverOneOrderThroughALostResponse(honourIdempotencyKeys: boolean) {
  const service = new OrderService({ honourIdempotencyKeys });
  const baseUrl = await listen(createApp({ service, dropResponseRate: 0.5, random: dropFirstResponse() }));
  const queue = new OfflineQueue({
    storage: new MemoryStorage(),
    transport: createHttpTransport({ baseUrl, timeoutMs: 2_000 }),
    baseDelayMs: 1,
    maxDelayMs: 1,
  });

  await queue.enqueue({ method: 'POST', path: '/orders', body: { sku: 'SKU-7', qty: 2 } });
  const first = await queue.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await queue.flush();
  return { service, first, second };
}

describe('lost responses, end to end over real HTTP', () => {
  it('creates a duplicate order when the server ignores the tag', async () => {
    const { service, first, second } = await deliverOneOrderThroughALostResponse(false);
    assert.equal(first.retrying, 1);
    assert.equal(second.delivered, 1);
    assert.equal(service.executions.length, 2, 'the same order was placed twice');
  });

  it('places the order exactly once when the server honours the tag', async () => {
    const { service, first, second } = await deliverOneOrderThroughALostResponse(true);
    assert.equal(first.retrying, 1);
    assert.equal(second.delivered, 1);
    assert.equal(service.executions.length, 1);
  });
});

describe('createHttpTransport', () => {
  it('treats a 200 HTML page as a captive portal, not a success', async () => {
    const baseUrl = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Welcome to Hotel Wi-Fi</h1>');
      }),
    );
    const transport = createHttpTransport({ baseUrl });
    await assert.rejects(
      transport([]),
      (err: unknown) => err instanceof TransportError && err.kind === 'captive-portal',
    );
  });

  it('reads Retry-After from a 503', async () => {
    const baseUrl = await listen(
      createServer((_req, res) => {
        res.writeHead(503, { 'retry-after': '12' }).end();
      }),
    );
    const transport = createHttpTransport({ baseUrl });
    await assert.rejects(
      transport([]),
      (err: unknown) => err instanceof TransportError && err.kind === 'server-unavailable' && err.retryAfterMs === 12_000,
    );
  });
});

describe('createReachabilityProbe', () => {
  it('says online only for a 204 from our own endpoint', async () => {
    const baseUrl = await listen(createApp({ service: new OrderService({ honourIdempotencyKeys: true }) }));
    assert.equal(await createReachabilityProbe({ url: `${baseUrl}/generate_204` })(), 'online');
  });

  it('spots a captive portal that redirects to a login page', async () => {
    const baseUrl = await listen(
      createServer((_req, res) => {
        res.writeHead(302, { location: 'http://login.example/' }).end();
      }),
    );
    assert.equal(await createReachabilityProbe({ url: `${baseUrl}/generate_204` })(), 'captive-portal');
  });

  it('says offline when nothing answers', async () => {
    const probe = createReachabilityProbe({ url: 'http://127.0.0.1:9/generate_204', timeoutMs: 500 });
    assert.equal(await probe(), 'offline');
  });
});
