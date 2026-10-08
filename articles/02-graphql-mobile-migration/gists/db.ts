import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export interface CustomerRow { id: string; name: string; email: string }
export interface ProductRow { id: string; name: string; price_cents: number }
export interface OrderRow { id: string; customer_id: string; status: string; created_at: string }
export interface OrderItemRow { id: string; order_id: string; product_id: string; qty: number }

export interface DbOptions {
  /** Pretend every statement takes this long, like a round trip to a real database. */
  latencyMs?: number;
  /** How many statements can run at once, like a connection pool. */
  poolSize?: number;
}

/**
 * An in-memory SQLite database that counts every statement it runs. That count
 * is the number this whole tutorial is about: how many trips to the database
 * one screen of the app costs.
 */
export class Db {
  statements = 0;
  private readonly sqlite = new DatabaseSync(':memory:');
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly options: DbOptions = {}) {
    seed(this.sqlite);
  }

  all<T>(sql: string, ...params: SQLInputValue[]): Promise<T[]> {
    return this.run(() => this.sqlite.prepare(sql).all(...params) as T[]);
  }

  get<T>(sql: string, ...params: SQLInputValue[]): Promise<T | undefined> {
    return this.run(() => this.sqlite.prepare(sql).get(...params) as T | undefined);
  }

  private async run<T>(query: () => T): Promise<T> {
    this.statements++;
    await this.acquire();
    try {
      if (this.options.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
      return query();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < (this.options.poolSize ?? Infinity)) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => { this.active++; resolve(); }));
  }
}

/** One customer, 40 products, 100 orders with 3 items each. */
function seed(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL);
    CREATE INDEX orders_by_customer ON orders (customer_id, created_at DESC, id DESC);
    CREATE INDEX items_by_order ON order_items (order_id);
  `);
  db.prepare('INSERT INTO customers VALUES (?, ?, ?)').run('c_1', 'Amara Okafor', 'amara@example.com');

  const names = ['Roasted coffee beans', 'Wireless headphones', 'Linen notebook', 'Recycled tote bag', 'Desk lamp'];
  const product = db.prepare('INSERT INTO products VALUES (?, ?, ?)');
  for (let i = 1; i <= 40; i++) product.run(`p_${i}`, `${names[i % names.length]} #${i}`, 499 + ((i * 731) % 9000));

  const statuses = ['delivered', 'shipped', 'paid', 'pending', 'cancelled'];
  const order = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
  const item = db.prepare('INSERT INTO order_items VALUES (?, ?, ?, ?)');
  const start = Date.UTC(2026, 8, 30, 12, 0, 0);
  for (let o = 1; o <= 100; o++) {
    order.run(`o_${o}`, 'c_1', statuses[o % statuses.length]!, new Date(start - o * 7 * 3_600_000).toISOString());
    for (let j = 1; j <= 3; j++) item.run(`i_${o}_${j}`, `o_${o}`, `p_${((o * 7 + j * 3) % 40) + 1}`, 1 + ((o + j) % 3));
  }
}
