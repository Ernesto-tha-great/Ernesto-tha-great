import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export interface CustomerRow { id: string; name: string; email: string }
export interface ProductRow { id: string; name: string; price_cents: number }
export interface OrderRow { id: string; customer_id: string; status: string; created_at: string }
export interface OrderItemRow { id: string; order_id: string; product_id: string; qty: number }

export interface DbOptions {
  /** Simulated round trip per statement. A Postgres call in the same region is roughly 1 ms. */
  latencyMs?: number;
  /** Max statements in flight at once, like a connection pool. */
  poolSize?: number;
  orders?: number;
  itemsPerOrder?: number;
}

/**
 * An in-memory SQLite database that counts every statement it runs. The count
 * is the number this whole project is about: it's how many trips to the
 * database one screen of the app costs.
 */
export class Db {
  statements = 0;
  private readonly sqlite = new DatabaseSync(':memory:');
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly options: DbOptions = {}) {
    seed(this.sqlite, options.orders ?? 100, options.itemsPerOrder ?? 3);
  }

  all<T>(sql: string, ...params: SQLInputValue[]): Promise<T[]> {
    return this.run(() => this.sqlite.prepare(sql).all(...params) as T[]);
  }

  async get<T>(sql: string, ...params: SQLInputValue[]): Promise<T | undefined> {
    return this.run(() => this.sqlite.prepare(sql).get(...params) as T | undefined);
  }

  resetCount(): void {
    this.statements = 0;
  }

  private async run<T>(query: () => T): Promise<T> {
    this.statements++;
    await this.acquire();
    try {
      if (this.options.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
      return query();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    const limit = this.options.poolSize ?? Infinity;
    if (this.active < limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => { this.active++; resolve(); }));
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

const ADJECTIVES = ['Organic', 'Roasted', 'Wireless', 'Recycled', 'Classic', 'Compact', 'Smoked', 'Linen'];
const NOUNS = ['coffee beans', 'headphones', 'notebook', 'tote bag', 'desk lamp'];

function seed(db: DatabaseSync, orderCount: number, itemsPerOrder: number): void {
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL);
    CREATE INDEX orders_by_customer ON orders (customer_id, created_at DESC, id DESC);
    CREATE INDEX items_by_order ON order_items (order_id);
  `);

  db.prepare('INSERT INTO customers VALUES (?, ?, ?)').run('c_1', 'Amara Okafor', 'amara@example.com');

  const product = db.prepare('INSERT INTO products VALUES (?, ?, ?)');
  for (let i = 1; i <= 40; i++) {
    const name = `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[i % NOUNS.length]}`;
    product.run(`p_${i}`, name, 499 + ((i * 731) % 9000));
  }

  const statuses = ['delivered', 'shipped', 'paid', 'pending', 'cancelled'];
  const order = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
  const item = db.prepare('INSERT INTO order_items VALUES (?, ?, ?, ?)');
  const start = Date.UTC(2026, 8, 30, 12, 0, 0);
  for (let o = 1; o <= orderCount; o++) {
    const createdAt = new Date(start - o * 7 * 3_600_000).toISOString();
    order.run(`o_${o}`, 'c_1', statuses[o % statuses.length]!, createdAt);
    for (let j = 1; j <= itemsPerOrder; j++) {
      item.run(`i_${o}_${j}`, `o_${o}`, `p_${((o * 7 + j * 3) % 40) + 1}`, 1 + ((o + j) % 3));
    }
  }
}
