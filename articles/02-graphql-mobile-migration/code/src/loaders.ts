import DataLoader from 'dataloader';
import type { Db, OrderItemRow, ProductRow } from './db';

/**
 * One set of loaders per request. A loader caches what it loads, so sharing
 * one between requests would leak one user's data into another's response.
 */
export function createLoaders(db: Db) {
  return {
    itemsByOrderId: new DataLoader<string, OrderItemRow[]>(async (orderIds) => {
      const rows = await db.all<OrderItemRow>(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders(orderIds)}) ORDER BY id`,
        ...orderIds,
      );
      const byOrder = new Map<string, OrderItemRow[]>();
      for (const row of rows) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) ?? []), row]);
      // DataLoader's one rule: return the results in the same order as the keys.
      return orderIds.map((id) => byOrder.get(id) ?? []);
    }),

    productById: new DataLoader<string, ProductRow | null>(async (ids) => {
      const rows = await db.all<ProductRow>(`SELECT * FROM products WHERE id IN (${placeholders(ids)})`, ...ids);
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id) ?? null);
    }),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}
