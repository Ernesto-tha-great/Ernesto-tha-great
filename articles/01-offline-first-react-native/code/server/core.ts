import type { ItemResult } from '../src/types.js';

export interface BatchItem {
  id: string;
  method: string;
  path: string;
  body: unknown;
}

interface OrderBody {
  sku?: unknown;
  qty?: unknown;
  /** Only the simulator sets this, to measure delivery. Real clients don't need it. */
  actionId?: unknown;
}

export interface Execution {
  key: string;
  actionId?: string;
  at: number;
}

export interface OrderServiceOptions {
  /** Turn this off to see what happens to clients that don't send tags. */
  honourIdempotencyKeys: boolean;
  now?: () => number;
}

/**
 * The server half of the deal. A queue can only avoid duplicates if the server
 * recognises a request it has already processed, so the tag has to be checked
 * *before* the side effect, and stored *with* it.
 */
export class OrderService {
  readonly executions: Execution[] = [];
  private readonly processed = new Map<string, ItemResult>();
  private readonly now: () => number;

  constructor(private readonly options: OrderServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  processBatch(items: readonly BatchItem[]): ItemResult[] {
    return items.map((item) => this.process(item));
  }

  private process(item: BatchItem): ItemResult {
    if (item.method !== 'POST' || item.path !== '/orders') {
      return { id: item.id, status: 'rejected', reason: `no route for ${item.method} ${item.path}` };
    }

    const body = (item.body ?? {}) as OrderBody;
    if (typeof body.sku !== 'string' || !Number.isInteger(body.qty) || (body.qty as number) <= 0) {
      return { id: item.id, status: 'rejected', reason: 'an order needs a sku and a positive integer qty' };
    }

    if (this.options.honourIdempotencyKeys) {
      const previous = this.processed.get(item.id);
      if (previous) return previous; // a copy of a bag we already delivered
    }

    // In production, insert the idempotency key and the order in ONE transaction,
    // with a unique constraint on the key. The Map plays that role here.
    this.executions.push({
      key: item.id,
      actionId: typeof body.actionId === 'string' ? body.actionId : undefined,
      at: this.now(),
    });

    const result: ItemResult = { id: item.id, status: 'delivered' };
    if (this.options.honourIdempotencyKeys) this.processed.set(item.id, result);
    return result;
  }
}
