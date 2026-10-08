import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { Db } from '../src/db.js';
import { operation, send } from './helpers.js';

const orderHistory = operation('ios', '3.1', 'OrderHistory');

describe('the client-shaped v2 schema', () => {
  it('renders the order history screen in 4 statements, one per level of the tree', async () => {
    const db = new Db();
    const result = await send(createApp({ schemaVersion: 'v2', db }), {
      client: 'ios', version: '3.1', query: orderHistory, variables: { first: 20 },
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.data.viewer.orders.edges.length, 20);
    // viewer + orders page + one batch of items + one batch of products
    assert.equal(db.statements, 4);
  });

  it('computes totals from line items and unit prices', async () => {
    const result = await send(createApp({ schemaVersion: 'v2' }), {
      client: 'ios', version: '3.1', query: orderHistory, variables: { first: 5 },
    });
    for (const { node } of result.data.viewer.orders.edges) {
      const sum = node.lineItems.reduce(
        (total: number, item: any) => total + item.quantity * Number(item.unitPrice.formatted.replace(/[$,]/g, '')),
        0,
      );
      assert.equal(node.total.formatted, `$${sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }
  });

  it('pages with cursors, without gaps or repeats', async () => {
    const app = createApp({ schemaVersion: 'v2' });
    const seen = new Set<string>();
    let after: string | null = null;
    let pages = 0;
    do {
      const result = await send(app, { client: 'ios', version: '3.1', query: orderHistory, variables: { first: 30, after } });
      const { edges, pageInfo } = result.data.viewer.orders;
      for (const edge of edges) {
        assert.ok(!seen.has(edge.node.id), `order ${edge.node.id} came back twice`);
        seen.add(edge.node.id);
      }
      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      pages++;
    } while (after);

    assert.equal(seen.size, 100);
    assert.equal(pages, 4);
  });
});
