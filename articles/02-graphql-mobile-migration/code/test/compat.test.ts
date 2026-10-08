import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { Db } from '../src/db.js';
import { operation, send } from './helpers.js';

const legacyOrderHistory = operation('android', '2.3', 'OrderHistory');
const android23 = { client: 'android', version: '2.3', query: legacyOrderHistory, variables: { customerId: 'c_1' } };

describe('the Android 2.3 build that will never update', () => {
  it('costs 401 SQL statements on the table-shaped v1 schema', async () => {
    const db = new Db();
    const result = await send(createApp({ schemaVersion: 'v1', db }), android23);
    assert.equal(result.data.orders.length, 100);
    assert.equal(db.statements, 1 + 100 + 300);
  });

  it('gets the exact same response from v2, in 3 statements instead of 401', async () => {
    const v1db = new Db();
    const v2db = new Db();
    const before = await send(createApp({ schemaVersion: 'v1', db: v1db }), android23);
    const after = await send(createApp({ schemaVersion: 'v2', db: v2db }), android23);

    assert.deepEqual(after, before, 'the old app cannot tell the difference');
    assert.equal(v2db.statements, 3);
  });

  it('can no longer read someone else’s orders, which v1 happily allowed', async () => {
    const v1 = await send(createApp({ schemaVersion: 'v1' }), { ...android23, viewer: 'c_999' });
    const v2 = await send(createApp({ schemaVersion: 'v2' }), { ...android23, viewer: 'c_999' });
    assert.equal(v1.data.orders.length, 100);
    assert.equal(v2.errors?.[0]?.extensions?.code, 'FORBIDDEN');
  });
});
