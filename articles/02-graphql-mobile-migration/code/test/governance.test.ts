import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { buildManifests, readSupportPolicy } from '../src/clients.js';
import { findBreakages, schemaWithout } from '../src/removal.js';
import { TrustedDocuments } from '../src/trusted.js';
import { UsageStore } from '../src/usage.js';
import { schema, typeDefs } from '../src/v2/schema.js';
import { hashOf, operation, send } from './helpers.js';

describe('field usage per app version', () => {
  it('shows which builds still call each deprecated field', async () => {
    const usage = new UsageStore();
    const app = createApp({ schemaVersion: 'v2', usage });
    await send(app, { client: 'android', version: '2.3', query: operation('android', '2.3', 'OrderHistory'), variables: { customerId: 'c_1' } });
    await send(app, { client: 'android', version: '3.0', query: operation('android', '3.0', 'OrderHistory'), variables: { first: 10 } });
    await send(app, { client: 'ios', version: '3.1', query: operation('ios', '3.1', 'OrderHistory'), variables: { first: 10 } });

    const report = new Map(usage.deprecationReport(schema).map((row) => [row.coordinate, row.clients.map((c) => c.client)]));
    assert.deepEqual(report.get('Order.created_at'), ['android@2.3']);
    assert.deepEqual(report.get('Product.price_cents')?.sort(), ['android@2.3', 'android@3.0']);
    assert.deepEqual(report.get('OrderItem.qty'), ['android@2.3']);
    assert.deepEqual(report.get('Query.customer'), []);
  });
});

describe('trusted documents', () => {
  const store = new TrustedDocuments(buildManifests());

  it('runs a persisted operation sent as a hash', async () => {
    const app = createApp({ schemaVersion: 'v2', trusted: { store, mode: 'strict' } });
    const result = await send(app, { client: 'ios', version: '3.1', persistedHash: hashOf('ios', '3.1', 'Profile') });
    assert.deepEqual(result.data, { viewer: { id: 'c_1', name: 'Amara Okafor' } });
  });

  it('rejects a hash no app build ever shipped', async () => {
    const app = createApp({ schemaVersion: 'v2', trusted: { store, mode: 'strict' } });
    const result = await send(app, { client: 'ios', version: '3.1', persistedHash: 'f'.repeat(64) });
    assert.equal(result.errors?.[0]?.extensions?.code, 'PERSISTED_QUERY_NOT_FOUND');
  });

  it('recognises an old build’s raw query text, even with different whitespace', async () => {
    const app = createApp({ schemaVersion: 'v2', trusted: { store, mode: 'strict' } });
    const squashed = operation('android', '2.3', 'Profile').replace(/\s+/g, ' ');
    const result = await send(app, { client: 'android', version: '2.3', query: squashed, variables: { customerId: 'c_1' } });
    assert.equal(result.errors, undefined);
    assert.equal(result.data.customer.name, 'Amara Okafor');
  });

  it('blocks hand-written queries in strict mode, and only logs them in report mode', async () => {
    const snooping = '{ customer(id: "c_1") { email } }';
    const strict = await send(createApp({ schemaVersion: 'v2', trusted: { store, mode: 'strict' } }), {
      client: 'curl', version: 'n/a', query: snooping,
    });
    assert.equal(strict.errors?.[0]?.extensions?.code, 'OPERATION_NOT_TRUSTED');

    const logged: string[] = [];
    const report = await send(
      createApp({ schemaVersion: 'v2', trusted: { store, mode: 'report', onUnknown: (doc) => logged.push(doc) } }),
      { client: 'curl', version: 'n/a', query: snooping },
    );
    assert.equal(report.data.customer.email, 'amara@example.com');
    assert.deepEqual(logged, [snooping]);
  });
});

describe('the removal gate', () => {
  const manifests = buildManifests();
  const support = readSupportPolicy();

  it('blocks removing a field the oldest supported build still uses', () => {
    const breakages = findBreakages(schemaWithout(typeDefs, ['Order.created_at']), manifests, support);
    assert.deepEqual(breakages.map((b) => `${b.client}@${b.version} ${b.operation}`), ['android@2.3 OrderHistory']);
  });

  it('catches the newer build that forgot to migrate', () => {
    const breakages = findBreakages(schemaWithout(typeDefs, ['Product.price_cents']), manifests, support);
    assert.deepEqual(
      breakages.map((b) => `${b.client}@${b.version}`).sort(),
      ['android@2.3', 'android@3.0'],
    );
  });

  it('lets an unused field go', () => {
    assert.deepEqual(findBreakages(schemaWithout(typeDefs, ['Customer.email']), manifests, support), []);
  });

  it('stops caring about a build once it drops out of the support policy', () => {
    const breakages = findBreakages(schemaWithout(typeDefs, ['Order.created_at']), manifests, { android: ['3.0'], ios: ['3.1'] });
    assert.deepEqual(breakages, []);
  });
});
