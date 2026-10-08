# How To Migrate a GraphQL Schema Without Breaking Old Mobile App Versions

*Mobile apps don't update when you deploy. In this tutorial, we reshape a GraphQL API around the app's screens, fix an N+1 problem on the way, and build a CI check that tells you when it's actually safe to delete a field.*

**Ernest Nnamdi** · GraphQL · TypeScript · Node.js

---

At Groupify, our backend ran on AWS Amplify. With Amplify, you describe your data with the `@model` directive, and you get a database table and a full GraphQL API for every type. So our first schema was our data model, field for field. We had an API in an afternoon, and I was very proud of that afternoon.

A few releases later, we wanted the API to look like the app's screens instead of our tables. The problem was that a web app updates the moment you deploy it. A mobile app updates when your users feel like it, and some of them never feel like it. Every version we had ever shipped was still out there, sending the exact queries it was built with. If we renamed a field, those versions broke.

The TL;DR of what I learned is that a GraphQL schema for a mobile app can only really grow. You add the new thing, keep the old thing working, watch who still uses it, and only delete it when you can prove nobody you support does.

In this tutorial, I'm going to show you how to do exactly that. We'll start with the kind of schema I shipped on day one, fix the performance problem it hides, reshape it around a real screen without breaking the old app, and finish with a check that runs in CI and fails any pull request that would break an app version you still support.

### Okay, but why can't I just deploy the new schema?

Because your old app versions can't see it.

Think of it like rearranging a supermarket. New customers will find the bread wherever you put it. Your regulars will walk straight to where it used to be, every single time. On the web, everyone gets the new layout the moment you deploy. On mobile, some of your users are still shopping in the layout from two years ago.

The GraphQL docs are pretty direct about this. From the [schema design page](https://graphql.org/learn/schema-design/#versioning):

> While there's nothing that prevents a GraphQL service from being versioned just like any other API, GraphQL takes a strong opinion on avoiding versioning by providing the tools for the continuous evolution of a GraphQL schema.

In other words, instead of shipping a v2 endpoint, you evolve one schema: new fields get added next to the old ones, and old fields get marked `@deprecated` until nobody needs them. GraphQL gives you `@deprecated` for exactly this. What it doesn't give you is a way to know when nobody needs a deprecated field any more, so that's what we'll build.

That being said, let's get to building!

## Prerequisites

- Node.js 22.13 or newer (we use its built-in SQLite module)
- Some familiarity with GraphQL and TypeScript
- curl and a bash-style terminal (on Windows, use Git Bash or WSL)

## What Are We Building?

We'll build:

- a small orders database that counts every statement it runs
- a GraphQL API, first shaped like the database, then reshaped around the app's order history screen
- DataLoader batching, to take one screen from 401 database statements down to 3
- field usage tracking, so you can see which app versions still use which deprecated fields
- a `check-schema` script that validates every query each supported app version ships against your schema, and a GitHub Actions workflow that runs it on every pull request

Here's what the project will look like when we're done:

```text
graphql-migration/
  src/
    db.ts                 # an in-memory SQLite database that counts statements
    schema.ts             # the GraphQL schema and resolvers
    loaders.ts            # DataLoader batching
    usage.ts              # which app versions use which fields
    app.ts                # the GraphQL server (GraphQL Yoga)
    main.ts               # starts it on port 4000
  clients/
    android/2.3/OrderHistory.graphql
    android/3.0/OrderHistory.graphql
    ios/3.1/OrderHistory.graphql
    support.json          # the app versions we still support
  scripts/
    count.ts              # counts database statements for one app's query
    check-schema.ts       # would this schema break a supported app version?
  .github/workflows/schema.yml
```

## Step 1: Setting Up Our Project

Let's start by creating a folder for the project and initialising it.

```bash
mkdir graphql-migration
cd graphql-migration
npm init -y
```

Next, we install GraphQL Yoga (our server), graphql and DataLoader, plus TypeScript, tsx and the Node.js types for development.

```bash
npm install graphql graphql-yoga dataloader
npm install --save-dev typescript tsx @types/node
```

If npm prints an audit warning, leave it for now. Don't run `npm audit fix --force`: it downgrades GraphQL Yoga to an old major version, and nothing in this tutorial will work.

Open the folder in your code editor. In package.json, set `"type"` to `"module"` (add it if it isn't there) and replace the `scripts` section with this:

```json
{
  "type": "module",
  "scripts": {
    "dev": "node --no-warnings --import tsx src/main.ts",
    "count": "node --no-warnings --import tsx scripts/count.ts",
    "check-schema": "node --no-warnings --import tsx scripts/check-schema.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

The `--no-warnings` flag hides the "SQLite is experimental" warning Node prints every time. Finally, create a tsconfig.json file in the root of the project:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "scripts", "test"]
}
```

## Step 2: A Database That Counts

To see what a schema costs, we need a database that tells us how hard it's working. Create a folder called src, and in it, a file called db.ts. Copy the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/db.ts) and paste it in. Here it is:

```ts
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
```

Here's what's going on:

- The `seed` function creates the four tables an online shop would have (customers, products, orders and order items) and fills them with one customer, 40 products and 100 orders of three items each.
- Every call to `all` or `get` adds one to `statements`. That number is what we'll watch for the rest of the tutorial.
- `latencyMs` and `poolSize` make the in-memory database behave a bit more like a real one. A real database is a network round trip away, and you can only have so many connections open at once.

## Step 3: The Schema You'd Ship on Day One

Let's start with the kind of schema I shipped: the database, wearing a GraphQL costume. Every table is a type, every column is a field, and every relationship is a resolver that runs its own query.

In the src folder, create schema.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/step-3-schema.ts):

```ts
import { createSchema } from 'graphql-yoga';
import type { Db, OrderItemRow, OrderRow, ProductRow } from './db';

export const typeDefs = /* GraphQL */ `
  type Query {
    orders(customer_id: ID!): [Order]
    product(id: ID!): Product
  }

  type Order {
    id: ID!
    customer_id: ID
    status: String
    created_at: String
    order_items: [OrderItem]
  }

  type OrderItem {
    id: ID!
    order_id: ID
    product_id: ID
    qty: Int
    product: Product
  }

  type Product {
    id: ID!
    name: String
    price_cents: Int
  }
`;

export interface Context {
  db: Db;
}

export const schema = createSchema<Context>({
  typeDefs,
  resolvers: {
    Query: {
      orders: (_, { customer_id }: { customer_id: string }, { db }) =>
        db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id),
      product: (_, { id }: { id: string }, { db }) => db.get<ProductRow>('SELECT * FROM products WHERE id = ?', id),
    },
    Order: {
      // One query per order.
      order_items: (order: OrderRow, _, { db }) =>
        db.all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id),
    },
    OrderItem: {
      // One query per item.
      product: (item: OrderItemRow, _, { db }) => db.get<ProductRow>('SELECT * FROM products WHERE id = ?', item.product_id),
    },
  },
});
```

Next, create app.ts. This is our GraphQL server. GraphQL Yoga takes a schema and a `context` function, and whatever `context` returns is handed to every resolver.

```ts
import { createYoga } from 'graphql-yoga';
import { Db } from './db';
import { schema } from './schema';

export interface AppOptions {
  db?: Db;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new Db();
  return createYoga({ schema, logging: false, context: () => ({ db }) });
}
```

And main.ts, to start it:

```ts
import { createServer } from 'node:http';
import { createApp } from './app';

const yoga = createApp();

createServer(yoga).listen(4000, () => console.log('GraphQL on http://localhost:4000/graphql'));
```

Run it:

```bash
npm run dev
```

You should see `GraphQL on http://localhost:4000/graphql`. In a second terminal, ask it for the orders (we'll only print the first 150 characters):

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{ orders(customer_id: \"c_1\") { id created_at } }"}' | head -c 150
```

```text
{"data":{"orders":[{"id":"o_1","created_at":"2026-09-30T05:00:00.000Z"},{"id":"o_2","created_at":"2026-09-29T22:00:00.000Z"},{"id":"o_3","created_at":
```

It works, and it looks fine. Now let's see what a real screen costs.

### Okay, but how do I know what the app sends?

Every mobile app ships with its queries baked in. If you use Apollo on iOS or Android, they're `.graphql` files in the app's source. Let's add the one version 2.3 of our Android app sends for its order history screen. Create clients/android/2.3/OrderHistory.graphql:

```graphql
query OrderHistory($customerId: ID!) {
  orders(customer_id: $customerId) {
    id
    status
    created_at
    order_items {
      qty
      product_id
      product {
        name
        price_cents
      }
    }
  }
}
```

Now we need something that sends that query and counts the database statements. In a new scripts folder, create count.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/count.ts):

```ts
// Sends one app version's OrderHistory query to our server (in-process, no
// network) and counts the trips it makes to the database.
//   npm run count -- android/2.3
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app';
import { Db } from '../src/db';

const build = process.argv[2] ?? 'android/2.3';
const [client, version] = build.split('/');
const query = await readFile(`clients/${build}/OrderHistory.graphql`, 'utf8');

// 1 ms per statement, 10 at a time: roughly a database in the same region.
const db = new Db({ latencyMs: 1, poolSize: 10 });
const yoga = createApp({ db });

const send = () =>
  yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer c_1',
      'apollographql-client-name': client!,
      'apollographql-client-version': version!,
    },
    body: JSON.stringify({ query, variables: { customerId: 'c_1', first: 100 } }),
  });

await send(); // a warm-up request, so we don't time the server starting up
db.statements = 0;

const started = performance.now();
const { data, errors } = (await (await send()).json()) as { data?: any; errors?: unknown };
const ms = performance.now() - started;

if (errors) {
  console.log(JSON.stringify(errors, null, 2));
  process.exit(1);
}
const orders = data.orders ?? data.viewer.orders.edges;
console.log(`${client} ${version}: ${orders.length} orders, ${db.statements} database statements, ${ms.toFixed(1)} ms`);
```

It runs the query against our app in-process (`yoga.fetch` doesn't need a network), once to warm up and once for real, with a database that takes 1 millisecond per statement and allows 10 at a time. Run it:

```bash
npm run count -- android/2.3
```

```text
android 2.3: 100 orders, 401 database statements, 61.5 ms
```

401 trips to the database, for one screen.

![With one query per resolver, 100 orders and 300 items cost 401 statements. With one batched query per level, they cost 3.](images/n-plus-one.svg)

This is the famous N+1 problem. One query gets the list of orders. Then the `order_items` resolver runs once *per order*: that's 100 more. Then the `product` resolver runs once *per item*: 300 more. The number of queries grows with the data, not with the query, so it gets worse the more your users order. A customer with 500 orders would cost 2,001 statements.

## Step 4: Batching With DataLoader

[DataLoader](https://github.com/graphql/dataloader) fixes this by waiting until every resolver at the same level has asked for what it needs, and then making one request for all of it. From its README:

> DataLoader will coalesce all individual loads which occur within a single frame of execution (a single tick of the event loop) and then call your batch function with all requested keys.

In other words, 100 calls to `load(orderId)` in the same tick become one `WHERE order_id IN (...)`. In the src folder, create loaders.ts:

```ts
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
```

There's one rule here you can't skip: the batch function has to return results *in the same order as the keys*, one per key. That's why each loader builds a map and then walks the keys, instead of returning the rows as they come out of the database.

Now let's use the loaders. Three things change in schema.ts: the imports, a `loaders` field in `Context`, and the resolvers, which now ask the loaders instead of the database. The type definitions stay exactly the same. Your updated schema.ts should look like this (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/step-4-schema.ts)):

```ts
import { createSchema } from 'graphql-yoga';
import type { Db, OrderItemRow, OrderRow } from './db';
import type { Loaders } from './loaders';

export const typeDefs = /* GraphQL */ `
  type Query {
    orders(customer_id: ID!): [Order]
    product(id: ID!): Product
  }

  type Order {
    id: ID!
    customer_id: ID
    status: String
    created_at: String
    order_items: [OrderItem]
  }

  type OrderItem {
    id: ID!
    order_id: ID
    product_id: ID
    qty: Int
    product: Product
  }

  type Product {
    id: ID!
    name: String
    price_cents: Int
  }
`;

export interface Context {
  db: Db;
  loaders: Loaders;
}

export const schema = createSchema<Context>({
  typeDefs,
  resolvers: {
    Query: {
      orders: (_, { customer_id }: { customer_id: string }, { db }) =>
        db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id),
      product: (_, { id }: { id: string }, { loaders }) => loaders.productById.load(id),
    },
    Order: {
      order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
    },
    OrderItem: {
      product: (item: OrderItemRow, _, { loaders }) => loaders.productById.load(item.product_id),
    },
  },
});
```

Finally, in app.ts, create a fresh set of loaders for every request:

```ts
import { createYoga } from 'graphql-yoga';
import { Db } from './db';
import { createLoaders } from './loaders';
import { schema } from './schema';

export interface AppOptions {
  db?: Db;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new Db();
  return createYoga({ schema, logging: false, context: () => ({ db, loaders: createLoaders(db) }) });
}
```

Run the count again:

```bash
npm run count -- android/2.3
```

```text
android 2.3: 100 orders, 3 database statements, 14.7 ms
```

From 401 statements to 3! One for the orders, one for all their items, and one for all the products, and we didn't touch the query. Your times will vary from run to run, but the statement count won't.

## Step 5: Reshaping the Schema Around the Screen

Now for the reshape. The order history screen doesn't want `created_at` and `price_cents`. It wants a date it can show, a formatted total, and pages of orders instead of all 100 at once. It also shouldn't have to tell the server whose orders it wants: the server already knows who's logged in.

The rule for the whole step is: **add, never rename**. Every new field goes in next to the old one, and every old field keeps working.

Replace everything in schema.ts with the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/schema.ts). It's a long file, so let's go through the important parts. First, the types:

```ts
export const typeDefs = /* GraphQL */ `
  type Query {
    viewer: Viewer
    product(id: ID!): Product

    orders(customer_id: ID!): [Order] @deprecated(reason: "Use viewer.orders.")
  }

  type Viewer {
    id: ID!
    name: String!
    orders(first: Int = 20, after: String): OrderConnection!
  }

  type OrderConnection {
    edges: [OrderEdge!]!
    pageInfo: PageInfo!
  }

  type OrderEdge {
    cursor: String!
    node: Order!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Money {
    "In the smallest unit: cents, pence, kobo."
    amount: Int!
    currency: String!
    formatted: String!
  }

  type Order {
    id: ID!
    status: String!
    placedAt: String!
    total: Money!
    lineItems: [OrderItem!]!

    customer_id: ID @deprecated(reason: "Orders are always the viewer's.")
    created_at: String @deprecated(reason: "Use placedAt.")
    order_items: [OrderItem] @deprecated(reason: "Use lineItems.")
  }

  type OrderItem {
    id: ID!
    quantity: Int!
    unitPrice: Money!
    product: Product!

    order_id: ID @deprecated(reason: "You already have the order.")
    product_id: ID @deprecated(reason: "Use product.id.")
    qty: Int @deprecated(reason: "Use quantity.")
  }

  type Product {
    id: ID!
    name: String!
    price: Money!

    price_cents: Int @deprecated(reason: "Use price.")
  }
`;
```

Here's how `viewer.orders` pages through the orders:

```ts
    Viewer: {
      orders: async (viewer: CustomerRow, { first, after }: { first: number; after?: string }, { db }) => {
        const limit = Math.min(Math.max(first, 1), 100);
        const cursor = after ? decodeCursor(after) : null;
        const rows = cursor
          ? await db.all<OrderRow>(
              `SELECT * FROM orders WHERE customer_id = ? AND (created_at, id) < (?, ?)
               ORDER BY created_at DESC, id DESC LIMIT ?`,
              viewer.id, cursor.createdAt, cursor.id, limit + 1,
            )
          : await db.all<OrderRow>(
              'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
              viewer.id, limit + 1,
            );

        // We asked for one extra row. If it came back, there's another page.
        const page = rows.slice(0, limit);
        const edges = page.map((order) => ({ cursor: encodeCursor(order), node: order }));
        return { edges, pageInfo: { hasNextPage: rows.length > limit, endCursor: edges.at(-1)?.cursor ?? null } };
      },
    },
```

A few things to note:

- `viewer` is the logged-in customer, and `viewer.orders` pages with a cursor (`first` and `after`), so the app can load 20 at a time.
- `Money` gives the app an amount, a currency and a ready-to-show string, so the app doesn't have to format prices itself.
- Every old field is still there, with an `@deprecated` reason that tells developers what to use instead.

The interesting part is what the old fields do now. Look at the resolvers for `Order`:

```ts
    Order: {
      placedAt: (order: OrderRow) => order.created_at,
      lineItems: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      total: async (order: OrderRow, _, { loaders }) => {
        const items = await loaders.itemsByOrderId.load(order.id);
        // Ask for every product at once, so they all land in the same batch.
        const products = await loaders.productById.loadMany(items.map((item) => item.product_id));
        let amount = 0;
        items.forEach((item, i) => {
          const product = products[i];
          if (product && !(product instanceof Error)) amount += item.qty * product.price_cents;
        });
        return money(amount);
      },
    },
```

`order_items` and `lineItems` use the same loader, so the old field doesn't need any code of its own. It's just another name for the new one, and any fix to `lineItems` reaches the old app too, for free.

The old `orders(customer_id)` query got one more change. Here are the `Query` resolvers:

```ts
    Query: {
      viewer: (_, __, { db, viewerId }) =>
        viewerId ? db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', viewerId) : null,
      product: (_, { id }: { id: string }, { loaders }) => loaders.productById.load(id),

      // The old field, still here for app versions that never update. It now
      // checks who's asking, which the first version never did.
      orders: (_, { customer_id }: { customer_id: string }, { db, viewerId }) => {
        if (viewerId !== customer_id) {
          throw createGraphQLError("You can only see your own orders", { extensions: { code: 'FORBIDDEN' } });
        }
        return db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id);
      },
    },
```

It now checks that you're asking for your own orders. The day-one version would happily return anyone's orders to anyone who knew their ID.

To know who's logged in, update app.ts so the context includes `viewerId`. We're using a pretend token (`Bearer c_1`) to keep things short. In your app, this is where your real auth goes.

```ts
import { createYoga } from 'graphql-yoga';
import { Db } from './db';
import { createLoaders } from './loaders';
import { schema } from './schema';

export interface AppOptions {
  db?: Db;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new Db();
  return createYoga({
    schema,
    logging: false,
    context: ({ request }) => ({ db, loaders: createLoaders(db), viewerId: viewerFrom(request) }),
  });
}

/** Demo auth: "Authorization: Bearer c_1". Swap in your real auth here. */
function viewerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
```

Now add the query version 3.1 of our iOS app sends, built on the new fields. Create clients/ios/3.1/OrderHistory.graphql:

```graphql
query OrderHistory($first: Int!, $after: String) {
  viewer {
    orders(first: $first, after: $after) {
      edges {
        node {
          id
          status
          placedAt
          total {
            formatted
          }
          lineItems {
            quantity
            unitPrice {
              formatted
            }
            product {
              id
              name
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

And count both apps against the same schema:

```bash
npm run count -- android/2.3
npm run count -- ios/3.1
```

```text
android 2.3: 100 orders, 3 database statements, 14.2 ms
ios 3.1: 100 orders, 4 database statements, 19.4 ms
```

The old app still works, untouched. The new one costs one extra statement, for the `viewer`. Restart `npm run dev` and try the new shape yourself:

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer c_1' \
  -d '{"query":"{ viewer { name orders(first: 2) { edges { node { id placedAt total { formatted } } } pageInfo { hasNextPage } } } }"}'
```

```json
{"data":{"viewer":{"name":"Amara Okafor","orders":{"pageInfo":{"hasNextPage":true},"edges":[{"node":{"id":"o_1","placedAt":"2026-09-30T05:00:00.000Z","total":{"formatted":"$352.05"}}},{"node":{"id":"o_2","placedAt":"2026-09-29T22:00:00.000Z","total":{"formatted":"$454.86"}}}]}}}}
```

And try reading someone else's orders through the old field:

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer c_2' \
  -d '{"query":"{ orders(customer_id: \"c_1\") { id } }"}'
```

```json
{"errors":[{"message":"You can only see your own orders","locations":[{"line":1,"column":3}],"path":["orders"],"extensions":{"code":"FORBIDDEN"}}],"data":{"orders":null}}
```

![The table-shaped v1 schema next to the screen-shaped v2, where new fields sit beside the old ones, which are now deprecated.](images/schema-shapes.svg)

## Step 6: Who's Still Using the Old Fields?

`@deprecated` tells developers not to use a field. It doesn't tell *you* whether anyone still does. For that, we need to watch real traffic.

We'll ask every app to send its name and version with each request. Apollo's client awareness feature uses two headers for this, `apollographql-client-name` and `apollographql-client-version`, so we'll use the same ones. Then, for every request, we'll record which fields the query touched.

In the src folder, create usage.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/usage.ts):

```ts
import { isObjectType, TypeInfo, visit, visitWithTypeInfo, type DocumentNode, type GraphQLSchema } from 'graphql';
import type { Plugin } from 'graphql-yoga';

/** "android 2.3", from two headers each app sends with every request. */
export function clientFrom(request: Request | undefined): string {
  const name = request?.headers.get('apollographql-client-name') ?? 'unknown';
  const version = request?.headers.get('apollographql-client-version') ?? 'unknown';
  return `${name} ${version}`;
}

/** Every "Type.field" an operation touches. */
export function fieldsUsed(schema: GraphQLSchema, document: DocumentNode): Set<string> {
  const typeInfo = new TypeInfo(schema);
  const fields = new Set<string>();
  visit(document, visitWithTypeInfo(typeInfo, {
    Field() {
      const parent = typeInfo.getParentType();
      const field = typeInfo.getFieldDef();
      if (parent && field && !field.name.startsWith('__')) fields.add(`${parent.name}.${field.name}`);
    },
  }));
  return fields;
}

export class UsageStore {
  /** "Order.created_at" -> "android 2.3" -> requests */
  private readonly usage = new Map<string, Map<string, number>>();

  record(client: string, fields: Iterable<string>): void {
    for (const field of fields) {
      const byClient = this.usage.get(field) ?? new Map<string, number>();
      byClient.set(client, (byClient.get(client) ?? 0) + 1);
      this.usage.set(field, byClient);
    }
  }

  /** For every deprecated field in the schema: which app versions still use it? */
  deprecationReport(schema: GraphQLSchema): Record<string, Record<string, number>> {
    const report: Record<string, Record<string, number>> = {};
    for (const type of Object.values(schema.getTypeMap())) {
      if (!isObjectType(type) || type.name.startsWith('__')) continue;
      for (const field of Object.values(type.getFields())) {
        if (field.deprecationReason == null) continue;
        const name = `${type.name}.${field.name}`;
        report[name] = Object.fromEntries(this.usage.get(name) ?? []);
      }
    }
    return report;
  }
}

/** Records which fields each app version touches, on every request. */
export function useFieldUsage(store: UsageStore): Plugin {
  return {
    onExecute({ args }) {
      const request = (args.contextValue as { request?: Request }).request;
      store.record(clientFrom(request), fieldsUsed(args.schema, args.document));
    },
  };
}
```

Here's what each part does:

- `clientFrom` reads the two headers and turns them into something like `android 2.3`.
- `fieldsUsed` walks the query with graphql-js's `TypeInfo`, which knows which type each field belongs to, and collects names like `Order.created_at`.
- `UsageStore` counts requests per field per app version, and `deprecationReport` lists every deprecated field in the schema with who's still using it.
- `useFieldUsage` is a GraphQL Yoga plugin that runs the whole thing on every request.

Now plug it into app.ts:

```ts
import { createYoga, type Plugin } from 'graphql-yoga';
import { Db } from './db';
import { createLoaders } from './loaders';
import { schema } from './schema';
import { useFieldUsage, type UsageStore } from './usage';

export interface AppOptions {
  db?: Db;
  usage?: UsageStore;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new Db();
  const plugins: Plugin[] = options.usage ? [useFieldUsage(options.usage)] : [];
  return createYoga({
    schema,
    plugins,
    logging: false,
    context: ({ request }) => ({ db, loaders: createLoaders(db), viewerId: viewerFrom(request) }),
  });
}

/** Demo auth: "Authorization: Bearer c_1". Swap in your real auth here. */
function viewerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
```

And add a `/usage` route to main.ts, so you can see the report:

```ts
import { createServer } from 'node:http';
import { createApp } from './app';
import { schema } from './schema';
import { UsageStore } from './usage';

const usage = new UsageStore();
const yoga = createApp({ usage });

createServer((req, res) => {
  if (req.url === '/usage') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(usage.deprecationReport(schema), null, 2));
    return;
  }
  return yoga(req, res);
}).listen(4000, () => console.log('GraphQL on http://localhost:4000/graphql'));
```

In a real backend, you'd send this to your metrics instead of keeping it in memory, but the idea is the same. Restart `npm run dev`, then pretend to be each app. These are trimmed-down versions of each app's query, to keep the commands short:

```bash
curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer c_1' \
  -H 'apollographql-client-name: android' -H 'apollographql-client-version: 2.3' \
  -d '{"query":"{ orders(customer_id: \"c_1\") { id status created_at order_items { qty product_id product { name price_cents } } } }"}' > /dev/null

curl -s localhost:4000/graphql -H 'content-type: application/json' -H 'authorization: Bearer c_1' \
  -H 'apollographql-client-name: ios' -H 'apollographql-client-version: 3.1' \
  -d '{"query":"{ viewer { orders(first: 20) { edges { node { id placedAt lineItems { quantity product { name price { formatted } } } } } } } }"}' > /dev/null

curl -s localhost:4000/usage
```

```json
{
  "Query.orders": {
    "android 2.3": 1
  },
  "Order.customer_id": {},
  "Order.created_at": {
    "android 2.3": 1
  },
  "Order.order_items": {
    "android 2.3": 1
  },
  "OrderItem.order_id": {},
  "OrderItem.product_id": {
    "android 2.3": 1
  },
  "OrderItem.qty": {
    "android 2.3": 1
  },
  "Product.price_cents": {
    "android 2.3": 1
  }
}
```

Now you know: Android 2.3 still uses six of the deprecated fields, and nobody uses `Order.customer_id` or `OrderItem.order_id`.

## Step 7: Proving a Removal Is Safe

Traffic only tells you about the apps that happened to open this week. Someone who opens version 3.0 once a month is still your user, and they'll still be upset if their order history breaks.

Thankfully, you already know exactly what every build can send. It's the `.graphql` files it shipped with. So instead of guessing, we can check: take the schema *as it would be* without a field, and validate every query from every supported build against it. If anything fails validation, deleting that field would break that build.

First, let's write down which app versions we still support. Create clients/support.json:

```json
{
  "android": ["2.3", "3.0"],
  "ios": ["3.1"]
}
```

Then add the query from Android 3.0, which moved to the new fields but still uses one old one. Create clients/android/3.0/OrderHistory.graphql:

```graphql
query OrderHistory($first: Int!, $after: String) {
  viewer {
    orders(first: $first, after: $after) {
      edges {
        node {
          id
          status
          placedAt
          total {
            formatted
          }
          lineItems {
            quantity
            product {
              id
              name
              price_cents
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

Now, in the scripts folder, create check-schema.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/gists/check-schema.ts):

```ts
// Would this schema break an app version we still support?
//   npm run check-schema                        # the schema as it is
//   npm run check-schema -- Order.created_at    # as if these fields were deleted
import { readdir, readFile } from 'node:fs/promises';
import { buildASTSchema, parse, validate, visit } from 'graphql';
import { typeDefs } from '../src/schema';

const remove = new Set(process.argv.slice(2));
const support = JSON.parse(await readFile('clients/support.json', 'utf8')) as Record<string, string[]>;

// The schema we'd have if those fields were deleted from the SDL.
const schema = buildASTSchema(
  visit(parse(typeDefs), {
    ObjectTypeDefinition(node) {
      return { ...node, fields: node.fields?.filter((field) => !remove.has(`${node.name.value}.${field.name.value}`)) };
    },
  }),
);

let broken = 0;
for (const [client, versions] of Object.entries(support)) {
  for (const version of versions) {
    const dir = `clients/${client}/${version}`;
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.graphql'))) {
      for (const error of validate(schema, parse(await readFile(`${dir}/${file}`, 'utf8')))) {
        broken++;
        console.log(`✗ ${client} ${version} ${file}: ${error.message}`);
      }
    }
  }
}

const change = remove.size ? `Removing ${[...remove].join(', ')}` : 'This schema';
if (broken > 0) {
  console.log(`\n${change} would break ${broken} operation${broken === 1 ? '' : 's'} in app versions we still support.`);
  process.exit(1);
}
console.log(`✓ ${change} is safe for every app version we still support.`);
```

It parses our type definitions, takes out any fields you pass on the command line, builds a schema from what's left, and runs graphql-js's `validate` on every operation of every supported build. Let's try it:

```bash
npm run check-schema
```

```text
✓ This schema is safe for every app version we still support.
```

```bash
npm run check-schema -- Order.created_at
```

```text
✗ android 2.3 OrderHistory.graphql: Cannot query field "created_at" on type "Order". Did you mean "placedAt"?

Removing Order.created_at would break 1 operation in app versions we still support.
```

```bash
npm run check-schema -- Product.price_cents
```

```text
✗ android 2.3 OrderHistory.graphql: Cannot query field "price_cents" on type "Product".
✗ android 3.0 OrderHistory.graphql: Cannot query field "price_cents" on type "Product".

Removing Product.price_cents would break 2 operations in app versions we still support.
```

```bash
npm run check-schema -- Order.customer_id
```

```text
✓ Removing Order.customer_id is safe for every app version we still support.
```

So `Order.customer_id` can go today. `Order.created_at` can go once you stop supporting Android 2.3. And `Product.price_cents` has to wait for both Android 2.3 and 3.0.

## Step 8: Running It in CI

Next, let's run the check on every pull request, so nobody has to remember to. Create .github/workflows/schema.yml:

```yaml
name: schema

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      # Fails the pull request if any app version we still support would break.
      - run: npm run check-schema
```

The finished project also runs its tests here. Once you have some, add `- run: npm test` above the last step.

Now, if anyone removes or renames a field that a supported app version still uses, the pull request goes red and tells them which app, which query and which field. And when you drop a version from support.json, the fields only it used become free to delete, and the check will tell you so.

![Deleting a field without breaking anyone: add the new field, deprecate the old one, watch who uses it, gate removals in CI, and only then delete it.](images/field-lifecycle.svg)

## Testing Our Migration

Phew! Let's run everything one more time, from the old app to the new:

```bash
npm run count -- android/2.3
npm run count -- android/3.0
npm run count -- ios/3.1
npm run check-schema
```

```text
android 2.3: 100 orders, 3 database statements, 15.9 ms
android 3.0: 100 orders, 4 database statements, 20.0 ms
ios 3.1: 100 orders, 4 database statements, 23.6 ms
✓ This schema is safe for every app version we still support.
```

Every app version works, and none of them costs more than four trips to the database.

## How It All Works

Let's review how the pieces fit together:

1. Every app version ships with its queries. We keep a copy of each supported version's `.graphql` files in the repo, and a list of supported versions in support.json.
2. New fields are added next to old ones. Old fields are marked `@deprecated` and re-implemented on top of the new resolvers, so there's only one code path, and the old app gets every performance fix the new one does.
3. DataLoader turns one-query-per-object into one-query-per-level, so a screen costs the same handful of statements whether a customer has 10 orders or 10,000.
4. Every request records which fields it used and which app version sent it, so `/usage` can tell you who still depends on each deprecated field.
5. `check-schema` validates every supported build's queries against the schema, with or without the fields you want to delete. CI runs it on every pull request, so nothing that breaks a supported app can be merged.

## Conclusion

It's a long tutorial, but the idea is simple: add new fields next to the old ones, watch who still uses the old ones, and let CI tell you when it's safe to delete them.

If I were taking this further, the next things I'd do are:

- Generate the `.graphql` files for each release automatically. Apollo iOS and Apollo Kotlin can both write out the operations a build contains, so CI can collect them on every release.
- Lock the server down to those operations with a safelist of trusted documents, so old builds can only ever send what they shipped with.
- Put a date in every deprecation reason, and drop app versions from support.json on a schedule, with an in-app prompt to update.

You can find the complete project [here](https://github.com/Ernesto-tha-great/graphql-mobile-migration). If you run into any issues while following along, drop a comment or reach out to me. Thanks for reading!
