import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { summarise } from '../src/metrics.js';
import { instrument } from '../src/middleware.js';
import { EventStore, type ApiCall } from '../src/store.js';

const T0 = Date.UTC(2026, 5, 1, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function fixture() {
  const store = new EventStore();
  const call = (developerId: string, offsetMs: number, route: string, status: number, keyMode: ApiCall['keyMode'] = 'test') =>
    store.recordCall({ developerId, at: new Date(T0 + offsetMs), method: 'GET', route, status, keyMode });

  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) store.addDeveloper(id, new Date(T0));

  // a: stumbles, succeeds, keeps going in the same session, comes back the next day.
  call('a', 5 * MIN, '/v1/rates', 401);
  call('a', 10 * MIN, '/v1/rates', 200);
  call('a', 2 * HOUR, '/v1/labels', 201);
  call('a', 30 * HOUR, '/v1/labels', 201);

  // b: succeeds, goes quiet, gets an email on day 3, comes back that afternoon.
  call('b', HOUR, '/v1/rates', 200);
  store.recordNudge('b', new Date(T0 + HOUR + 3 * DAY), 'email');
  call('b', HOUR + 3 * DAY + 5 * HOUR, '/v1/rates', 200);

  // c: succeeds, then trips over the webhook test and never returns.
  call('c', 20 * MIN, '/v1/labels', 201);
  call('c', 25 * MIN, '/v1/webhooks/test', 400);

  // d: never gets past authentication.
  call('d', 3 * MIN, '/v1/rates', 401);
  call('d', 4 * MIN, '/v1/rates', 401);

  // e: only ever calls an excluded route.
  call('e', 3 * MIN, '/v1/me', 200);

  // f: comes back, but after the 30-day horizon.
  call('f', 10 * MIN, '/v1/rates', 200);
  call('f', 31 * DAY, '/v1/rates', 200);

  return store;
}

const byId = (store: EventStore) => new Map(store.journeys().map((j) => [j.developerId, j]));
const seconds = (offsetMs: number) => (T0 + offsetMs) / 1000;

describe('journeys', () => {
  it('ignores the rest of the first session when looking for a second success', () => {
    const a = byId(fixture()).get('a')!;
    assert.equal(a.firstSuccess, seconds(10 * MIN));
    assert.equal(a.secondSuccess, seconds(30 * HOUR), 'the 2-hour call is the same session, not a second success');
    assert.equal(a.prompted, false);
  });

  it('marks a return within 72 hours of a nudge as prompted', () => {
    assert.equal(byId(fixture()).get('b')!.prompted, true);
  });

  it('does not count excluded routes as success', () => {
    assert.equal(byId(fixture()).get('e')!.firstSuccess, null);
  });

  it('does not count a return after the horizon', () => {
    const f = byId(fixture()).get('f')!;
    assert.notEqual(f.firstSuccess, null);
    assert.equal(f.secondSuccess, null);
  });
});

describe('cliffs', () => {
  it('reports the last call of developers who stalled, and of those who never got going', () => {
    const cliffs = fixture().cliffs(new Date(T0 + 60 * DAY));
    const stalled = cliffs.filter((c) => c.cohort === 'stalled').map((c) => `${c.status} ${c.route}`);
    const never = cliffs.filter((c) => c.cohort === 'never').map((c) => `${c.status} ${c.route}`);

    assert.ok(stalled.includes('400 /v1/webhooks/test'));
    assert.ok(stalled.includes('200 /v1/rates'), 'f returned too late, so it still counts as stalled');
    assert.ok(!stalled.some((row) => row.endsWith('/v1/labels') && row.startsWith('201')), 'a returned, so a is not a cliff');
    assert.deepEqual(never, ['401 /v1/rates']);
  });

  it('leaves out developers who are still inside the horizon', () => {
    assert.deepEqual(fixture().cliffs(new Date(T0 + 10 * DAY)), []);
  });
});

describe('summarise', () => {
  it('only judges developers who have had the full horizon to come back', () => {
    const store = fixture();
    const early = summarise(store.journeys(), new Date(T0 + 10 * DAY));
    const later = summarise(store.journeys(), new Date(T0 + 60 * DAY));

    assert.equal(early.eligible, 0);
    assert.equal(later.eligible, 4); // a, b, c, f
    assert.equal(later.ssr, 2 / 4); // a and b
    assert.equal(later.unpromptedSsr, 1 / 4); // only a
  });
});

describe('instrument()', () => {
  it('records the route template, status and key mode for authenticated calls only', async () => {
    const calls: ApiCall[] = [];
    const track = instrument({
      record: (call) => calls.push(call),
      developerFor: (key) => (key.endsWith('_sam') ? 'dev_sam' : null),
      routeOf: (req) => (req.url?.startsWith('/v1/labels/') ? '/v1/labels/:id' : (req.url ?? '')),
    });
    const server = createServer((req, res) => {
      track(req, res);
      res.writeHead(req.url === '/v1/labels/lbl_9' ? 200 : 404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await fetch(`${base}/v1/labels/lbl_9`, { headers: { authorization: 'Bearer sk_live_sam', 'user-agent': 'parcel-node/2.1.0' } });
    await fetch(`${base}/v1/nope`, { headers: { authorization: 'Bearer sk_test_sam' } });
    await fetch(`${base}/v1/labels/lbl_9`); // anonymous
    await fetch(`${base}/v1/labels/lbl_9`, { headers: { authorization: 'Bearer sk_test_stranger' } });
    server.close();

    assert.deepEqual(
      calls.map(({ developerId, route, status, keyMode, sdk }) => ({ developerId, route, status, keyMode, sdk })),
      [
        { developerId: 'dev_sam', route: '/v1/labels/:id', status: 200, keyMode: 'live', sdk: 'parcel-node/2.1.0' },
        { developerId: 'dev_sam', route: '/v1/nope', status: 404, keyMode: 'test', sdk: 'node' },
      ],
    );
  });
});
