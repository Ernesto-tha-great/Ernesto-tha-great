import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { schema } from '../src/schema';
import { UsageStore } from '../src/usage';

const run = promisify(execFile);
const query = (build: string) => readFile(`clients/${build}/OrderHistory.graphql`, 'utf8');

async function send(yoga: ReturnType<typeof createApp>, body: object, headers: Record<string, string> = {}) {
  const res = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer c_1', ...headers },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { data?: any; errors?: Array<{ extensions?: { code?: string } }> };
}

describe('the migrated schema', () => {
  it('still serves the Android 2.3 query, in 3 statements', async () => {
    const db = new Db();
    const result = await send(createApp({ db }), { query: await query('android/2.3'), variables: { customerId: 'c_1' } });
    assert.equal(result.errors, undefined);
    assert.equal(result.data.orders.length, 100);
    assert.equal(db.statements, 3);
  });

  it('serves the iOS 3.1 screen in 4 statements', async () => {
    const db = new Db();
    const result = await send(createApp({ db }), { query: await query('ios/3.1'), variables: { first: 20 } });
    assert.equal(result.errors, undefined);
    assert.equal(result.data.viewer.orders.edges.length, 20);
    assert.equal(db.statements, 4);
  });

  it('pages through every order without gaps or repeats', async () => {
    const yoga = createApp();
    const seen = new Set<string>();
    let after: string | null = null;
    do {
      const result = await send(yoga, { query: await query('ios/3.1'), variables: { first: 30, after } });
      const { edges, pageInfo } = result.data.viewer.orders;
      for (const edge of edges) seen.add(edge.node.id);
      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (after);
    assert.equal(seen.size, 100);
  });

  it("won't show one customer another customer's orders", async () => {
    const result = await send(createApp(), { query: '{ orders(customer_id: "c_1") { id } }' }, { authorization: 'Bearer c_2' });
    assert.equal(result.errors?.[0]?.extensions?.code, 'FORBIDDEN');
  });

  it('records which app versions still use deprecated fields', async () => {
    const usage = new UsageStore();
    const yoga = createApp({ usage });
    const headers = (name: string, version: string) => ({ 'apollographql-client-name': name, 'apollographql-client-version': version });
    await send(yoga, { query: await query('android/2.3'), variables: { customerId: 'c_1' } }, headers('android', '2.3'));
    await send(yoga, { query: await query('ios/3.1'), variables: { first: 5 } }, headers('ios', '3.1'));
    const report = usage.deprecationReport(schema);
    assert.deepEqual(report['Order.created_at'], { 'android 2.3': 1 });
    assert.deepEqual(report['Order.customer_id'], {});
  });
});

describe('check-schema', () => {
  const check = (...fields: string[]) => run('node', ['--no-warnings', '--import', 'tsx', 'scripts/check-schema.ts', ...fields]);

  it('passes for the schema as it is', async () => {
    const { stdout } = await check();
    assert.match(stdout, /safe for every app version/);
  });

  it('fails when a supported app version still uses a removed field', async () => {
    await assert.rejects(check('Product.price_cents'), (err: { code: number; stdout: string }) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /android 2\.3/);
      assert.match(err.stdout, /android 3\.0/);
      return true;
    });
  });

  it('passes when nobody uses the removed field', async () => {
    const { stdout } = await check('Order.customer_id');
    assert.match(stdout, /Removing Order.customer_id is safe/);
  });
});
