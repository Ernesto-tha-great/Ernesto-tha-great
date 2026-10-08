# Migrating a GraphQL Schema Without Breaking Legacy Mobile Clients

*DataLoader, persisted queries, and the Android build that will never update.*

**Ernest Nnamdi** · GraphQL · Node.js · Mobile

---

The first GraphQL schema I shipped was my database wearing a GraphQL costume. Every table became a type, every column became a field, and every foreign key became a resolver that ran its own query. It looked tidy. The GraphiQL explorer was beautiful. I was very pleased with myself.

Then two things happened. The order history screen got slow enough that people noticed. And when I went to fix the schema, I realised I couldn't, because an Android release had already gone out with queries that depended on every one of those snake_case fields.

That's the bit nobody warns you about with GraphQL on mobile. On the web, a schema mistake lasts until your next deploy. On mobile, every query you ship lives on in someone's pocket, sometimes for years, because people don't update apps. You can't take it back. You can only outlive it.

This article walks through the migration I wish I'd planned from the start, using a small but complete project:

1. Fix the **shape**: move from a table-shaped schema to one shaped around what the app actually renders.
2. Fix the **cost**: get the order history screen from 401 SQL queries down to 3, using DataLoader.
3. Keep **old app versions** working the whole time, byte-for-byte, and make them faster for free.
4. Find out **who still calls an old field**, from live traffic and from what each app build shipped with.
5. Add a **CI check** that refuses to delete a field while a supported app version still uses it.

All the code is in [**github.com/Ernesto-tha-great/graphql-mobile-migration**](https://github.com/Ernesto-tha-great/graphql-mobile-migration). It uses GraphQL Yoga, DataLoader and Node's built-in SQLite, so there's no database to set up:

```bash
git clone https://github.com/Ernesto-tha-great/graphql-mobile-migration.git
cd graphql-mobile-migration
npm install
npm test          # 15 tests
npm run dev       # GraphiQL on http://localhost:4000/graphql
```

You'll need Node 22.13 or newer for `node:sqlite`.

## The database in a costume

Here's roughly what my first schema looked like. In the repo it's `src/v1/schema.ts`:

```graphql
type Query {
  customer(id: ID!): Customer
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
```

And the resolvers did exactly what the schema suggests:

```ts
// src/v1/schema.ts
Order: {
  // One query per order. 100 orders, 100 queries.
  order_items: (order: OrderRow, _, { db }) =>
    db.all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id),
},
OrderItem: {
  // One query per item. 300 items, 300 queries.
  product: (item: OrderItemRow, _, { db }) =>
    db.get<ProductRow>('SELECT * FROM products WHERE id = ?', item.product_id),
},
```

None of this is *wrong*, exactly. It just doesn't think about the screen at all. Look at what the schema lets slide: any client can pass any `customer_id`, nothing is non-null, there's no paging, and money is a bare integer called `price_cents` that every client has to remember to divide by 100.

The Android app (let's call it version 2.3) shipped with this query for its order history screen:

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

That query is now frozen. Somewhere, someone with automatic updates turned off will send exactly those characters to your server for the next three years.

## 401 queries for one screen

The demo database counts every SQL statement it runs, so we can ask it directly. For a customer with 100 orders of 3 items each:

```ts
// test/compat.test.ts
it('costs 401 SQL statements on the table-shaped v1 schema', async () => {
  const db = new Db();
  const result = await send(createApp({ schemaVersion: 'v1', db }), android23);
  assert.equal(result.data.orders.length, 100);
  assert.equal(db.statements, 1 + 100 + 300);
});
```

One query for the orders, one per order for its items, and one per item for its product. This is the famous N+1 problem, and GraphQL makes it very easy to write by accident, because each resolver only ever sees one object at a time.

![On the left, naive resolvers run 1 query for orders, 100 for items and 300 for products: 401 in total. On the right, DataLoader runs one batched query per level: 3 in total.](./images/n-plus-one.svg)

### DataLoader, and the one rule it has

DataLoader fixes this by waiting a moment before querying. Every `load(id)` call made in the same tick of the event loop gets collected, and then your batch function runs **once** with all the IDs:

```ts
// src/v2/loaders.ts
export function createLoaders(db: Db) {
  return {
    itemsByOrderId: new DataLoader<string, OrderItemRow[]>(
      async (orderIds) => {
        const rows = await db.all<OrderItemRow>(
          `SELECT * FROM order_items WHERE order_id IN (${placeholders(orderIds)}) ORDER BY id`,
          ...orderIds,
        );
        const byOrder = new Map<string, OrderItemRow[]>();
        for (const row of rows) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) ?? []), row]);
        // DataLoader's one rule: return results in the same order as the keys.
        return orderIds.map((id) => byOrder.get(id) ?? []);
      },
      { maxBatchSize: 500 },
    ),
    // productById looks the same
  };
}
```

A few things are worth calling out, because I got every one of them wrong at least once:

- **It's one query per level of the tree, not one query in total.** GraphQL resolves a level, then the level below it. Orders, then all the items, then all the products: three batches. That's still a huge win, because the count now grows with how *deep* the query is, not how much data there is.
- **The batch function must return results in the same order as the keys,** with exactly one entry per key. SQL doesn't return rows in `IN (...)` order, so you have to map them back yourself. Get this wrong and customer A sees customer B's line items.
- **Create a new set of loaders for every request.** A loader caches what it has loaded. Share one across requests and you've built a cache with no expiry that leaks data between users. In the repo, loaders are created in the context function, once per request.
- **Cap the batch size.** `maxBatchSize: 500` keeps you under the database's limit on query parameters.

## Reshaping around the screen

With batching sorted, I could fix the shape. The rule I use now: design the schema from the screens backwards, not from the tables forwards.

![Side by side: the v1 schema mirrors tables, while v2 starts from the viewer, adds connections and a Money type, and keeps the old fields as deprecated adapters.](./images/schema-shapes.svg)

The new entry point is `viewer`, the signed-in user, so clients stop passing customer IDs around entirely. Orders are paginated with cursors. Money is a proper type with a pre-formatted string, so three apps on three platforms stop disagreeing about rounding:

```graphql
type Query {
  viewer: Viewer
  product(id: ID!): Product

  customer(id: ID!): Customer @deprecated(reason: "Use viewer.")
  orders(customer_id: ID!): [Order] @deprecated(reason: "Use viewer.orders.")
}

type Viewer {
  id: ID!
  name: String!
  orders(first: Int = 20, after: String): OrderConnection!
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
```

The iOS app (version 3.1) was built against this schema, and its order history screen comes in at **4 statements**: the viewer, a page of orders, one batch of items and one batch of products.

### The changes that look safe and aren't

Notice what I *didn't* change. Some schema edits look harmless and will break old builds anyway. These are the ones I check for now:

- **Renaming a type.** `OrderItem` stays `OrderItem`, even though I'd love to call it `LineItem`. Old builds use type names in fragments (`... on OrderItem`), and Apollo's normalised cache uses `__typename` as part of its cache keys. Rename the type and those queries stop validating.
- **Changing a field's type, even to something "better".** I wanted `status` to be an enum. But an enum serialises as `PAID`, and the old app compares against `"paid"`. The old field has to keep returning exactly what it always returned.
- **Making an argument required.** Old queries don't send it, so they fail validation.
- **Changing a default value.** It's invisible in the schema diff, and it silently changes what old queries get back.

Some changes *are* safe: adding fields, adding types, and making an *output* field non-null (a client that handled `null` will cope fine with never seeing one).

## Keep the old fields, but make them cheap

Here's the trick that made this whole migration worth it. The deprecated fields don't sit on the old code paths. They're **re-implemented on top of the new resolvers**:

```ts
// src/v2/schema.ts
Order: {
  placedAt: (order: OrderRow) => order.created_at,
  lineItems: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
  order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
  // ...
},
```

`order_items` and `lineItems` share a loader. So the Android 2.3 build, which hasn't changed a single character, now goes through DataLoader too. This is the test I care about most in the whole repo:

```ts
// test/compat.test.ts
it('gets the exact same response from v2, in 3 statements instead of 401', async () => {
  const v1db = new Db();
  const v2db = new Db();
  const before = await send(createApp({ schemaVersion: 'v1', db: v1db }), android23);
  const after = await send(createApp({ schemaVersion: 'v2', db: v2db }), android23);

  assert.deepEqual(after, before, 'the old app cannot tell the difference');
  assert.equal(v2db.statements, 3);
});
```

The old app gets **the exact same JSON**, in 3 statements instead of 401. It got faster without an update.

While I was in there, I fixed something embarrassing. The v1 `orders(customer_id:)` field returned *anyone's* orders to *anyone* who asked. The legacy field on v2 now checks that the customer ID matches the signed-in viewer:

```ts
orders: (_, { customer_id }: { customer_id: string }, ctx) => {
  assertViewer(ctx, customer_id);
  return ctx.db.all<OrderRow>(
    'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC',
    customer_id,
  );
},
```

The old app only ever asks for its own user's orders, so it doesn't notice. Anyone poking at the API with someone else's ID now gets a `FORBIDDEN`, and there's a test for that too.

## Who's still calling `created_at`?

Deprecating a field is the easy part. Deleting it is where it gets scary, because you need to know nobody still uses it. Logs won't tell you; they show requests, not fields.

So the server records which fields each app version touches. Apollo's mobile clients can already send their name and version in the `apollographql-client-name` and `apollographql-client-version` headers, so I used those. A small Yoga plugin walks every operation it executes and records each `Type.field` it touches:

```ts
// src/usage.ts
export function fieldCoordinates(schema: GraphQLSchema, document: DocumentNode): Set<string> {
  const typeInfo = new TypeInfo(schema);
  const found = new Set<string>();
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const parent = typeInfo.getParentType();
        const field = typeInfo.getFieldDef();
        if (parent && field && !field.name.startsWith('__')) found.add(`${parent.name}.${field.name}`);
      },
    }),
  );
  return found;
}

export function useFieldUsage(store: UsageStore): Plugin {
  return {
    onExecute({ args }) {
      const request = (args.contextValue as { request?: Request }).request;
      store.record(clientFrom(request), fieldCoordinates(args.schema, args.document));
    },
  };
}
```

`TypeInfo` does the heavy lifting. As the visitor walks the query, it keeps track of which type each field belongs to, even through fragments and aliases. That's why the plugin can record `Order.created_at` rather than just `created_at`.

The dev server exposes the result at `/usage`. After an hour of traffic from three app versions, it looks like this (trimmed):

```json
[
  {
    "coordinate": "Order.created_at",
    "reason": "Use placedAt.",
    "clients": [{ "client": "android@2.3", "requests": 12, "lastSeen": "2026-10-01T09:12:00.000Z" }]
  },
  {
    "coordinate": "Product.price_cents",
    "reason": "Use price.",
    "clients": [
      { "client": "android@3.0", "requests": 40, "lastSeen": "2026-10-01T09:52:00.000Z" },
      { "client": "android@2.3", "requests": 12, "lastSeen": "2026-10-01T09:12:00.000Z" }
    ]
  },
  {
    "coordinate": "Query.customer",
    "reason": "Use viewer.",
    "clients": []
  }
]
```

Two things in that report surprised me.

First, **Android 3.0 still calls `price_cents`**. That's the "new" Android app, built against v2. Somebody (fine, me) migrated the order screen to `lineItems` and `total`, but left `price_cents` on the product, because it still worked. Deprecation warnings in your IDE are very easy to scroll past.

Second, **nobody called `Query.customer`**. You might think that means it's safe to delete. It isn't. Android 2.3 uses it on the profile screen, and nobody happened to open their profile during that hour. Traffic only tells you what *was* called. It can't tell you what *could* still be called by a build that hasn't phoned home this week.

For that, you need to know what each build shipped with.

## Trusted documents: every query a build can ever send

Most mobile apps don't build queries at runtime. Every operation is written at build time and compiled into the app. That means you can collect them all, per build, before the app even ships. Apollo Kotlin and Apollo iOS can both generate this list for you as an operation manifest. In the repo, each build's operations live in `clients/<platform>/<version>/`, and `npm run manifest` hashes them:

```json
{
  "client": "ios",
  "version": "3.1",
  "operations": {
    "2e4591da88fb40be…": "query OrderHistory($first: Int!, $after: String) { … }"
  }
}
```

A quick word on naming, because these two get mixed up a lot:

- **Automatic persisted queries (APQ)** are a *bandwidth* trick. The client sends a hash; if the server hasn't seen it, the client sends the full query, and the server remembers it. The server will register *anything*, so APQ gives you no security and tells you nothing about which queries exist.
- **Trusted documents** (sometimes called persisted operations) are an *allowlist*. The server only runs operations that were registered at build time. Anything else is rejected.

The plugin handles both kinds of client. Newer builds send a hash. Older builds, like Android 2.3, predate all of this and send the full query text, so the server hashes what they send and looks for it in the manifests:

```ts
// src/trusted.ts
onParams({ params, setParams }) {
  const hash = persistedHash(params.extensions);
  if (hash) {
    const document = store.get(hash);
    if (!document) {
      throw createGraphQLError('PersistedQueryNotFound', {
        extensions: { code: 'PERSISTED_QUERY_NOT_FOUND', http: { status: 400 } },
      });
    }
    setParams({ ...params, query: document });
    return;
  }

  if (params.query && !store.allowsRawDocument(params.query)) {
    onUnknown(params.query);
    if (mode === 'strict') {
      throw createGraphQLError('This operation is not in any shipped app build', {
        extensions: { code: 'OPERATION_NOT_TRUSTED', http: { status: 400 } },
      });
    }
  }
},
```

That raw-text check normalises the query before hashing it (`stripIgnoredCharacters`), so whitespace differences don't matter. You also get to retroactively allowlist an app that was built before you'd ever heard of trusted documents. That felt like cheating the first time it worked.

Don't flip this to `strict` on day one. Run in `report` mode first: unknown operations still execute, but they get logged. When the log has been quiet for a couple of weeks, your manifests are complete and you can turn on `strict`. At that point, someone pasting a hand-written query into your API (`{ customer(id: "c_1") { email } }`, say) gets turned away.

## A CI gate for deleting fields

Now the payoff. With every supported build's operations in hand, "is it safe to delete this field?" stops being a judgement call. Remove the field from the schema, then validate every operation from every supported build against the result:

```ts
// src/removal.ts
export function schemaWithout(sdl: string, coordinates: readonly string[]): GraphQLSchema {
  const remove = new Set(coordinates);
  const pruned = visit(parse(sdl), {
    ObjectTypeDefinition(node) {
      return {
        ...node,
        fields: node.fields?.filter((field) => !remove.has(`${node.name.value}.${field.name.value}`)),
      };
    },
  });
  return buildASTSchema(pruned);
}

export function findBreakages(schema: GraphQLSchema, manifests: readonly Manifest[], support: SupportPolicy): Breakage[] {
  const breakages: Breakage[] = [];
  for (const manifest of manifests) {
    if (!support[manifest.client]?.includes(manifest.version)) continue;
    for (const document of Object.values(manifest.operations)) {
      const ast = parse(document);
      // ...find the operation name
      for (const error of validate(schema, ast)) {
        breakages.push({ client: manifest.client, version: manifest.version, operation: name, message: error.message });
      }
    }
  }
  return breakages;
}
```

Which builds count as "supported" is a business decision, not a technical one, so it lives in a plain file that product people can edit:

```json
{
  "android": ["2.3", "3.0"],
  "ios": ["3.1"]
}
```

Here's what the gate says about the fields from earlier. These are real outputs from `npm run check-removal`:

```text
$ npm run check-removal -- Query.customer
✗ Removing Query.customer would break:

  android@2.3  Profile: Cannot query field "customer" on type "Query".

$ npm run check-removal -- Product.price_cents
✗ Removing Product.price_cents would break:

  android@2.3  OrderHistory: Cannot query field "price_cents" on type "Product".
  android@3.0  OrderHistory: Cannot query field "price_cents" on type "Product".

$ npm run check-removal -- Customer.email
✓ Safe to remove Customer.email: no supported app version uses it.
```

The first one is the field that live traffic said nobody used. The gate catches it straight away. The second catches the newer build that forgot to migrate.

`check-removal` is for asking "what if?" before you touch anything. In CI you don't even need a list of fields. `npm run check-schema` validates every supported build's operations against whatever schema is in the pull request, so it catches removed fields, renamed types and newly required arguments all at once. The repo's workflow runs it on every pull request:

```yaml
# .github/workflows/schema.yml
- run: npm test
# Fails the build if any supported app version's operations no longer validate.
- run: npm run check-schema
```

When I deleted `created_at` from the schema to test it, the build went red with exactly the message I'd want a teammate to see:

```text
✗ This schema breaks supported app builds:

  android@2.3  OrderHistory: Cannot query field "created_at" on type "Order". Did you mean "placedAt"?
```

And when Android 2.3 finally drops below whatever usage threshold your team agrees on, you take `"2.3"` out of the support file, run the gate again, and `created_at` is free to go.

![The lifecycle of a field: add the new field, deprecate the old one and re-implement it, watch usage per app version, gate removal in CI, then delete.](./images/field-lifecycle.svg)

## What it cost, and what it saved

To get honest timings, the measurement script makes the in-memory database behave a bit more like a real one: every statement takes about a millisecond, which is roughly a Postgres round trip in the same region, and only ten can run at once, like a connection pool.

![Bar charts of SQL statements per request and median response time: Android 2.3 on v1 runs 401 statements in 59.4 ms; the same unchanged app on v2 runs 3 statements in 7.8 ms; iOS 3.1 on v2 runs 4 statements in 7.1 ms.](./images/measure.svg)

| Scenario | SQL statements | Median | p95 |
|---|---:|---:|---:|
| Android 2.3 on v1 (all 100 orders) | 401 | 59.4 ms | 63.9 ms |
| Android 2.3 on v2, app unchanged (all 100 orders) | 3 | 7.8 ms | 8.5 ms |
| iOS 3.1 on v2 (first 20 orders) | 4 | 7.1 ms | 7.6 ms |

The timings will move around on your machine; run `npm run measure` and see. The ratio is the point. The old app got about seven times faster without shipping anything, and it still loads all 100 orders, because that's what its query asks for. The connection pool matters more than it looks: 401 statements queueing for 10 connections is how one slow screen becomes a slow *everything* on a busy afternoon.

## What I'd tell myself before shipping that first schema

- **Design from the screen, not the table.** You'll still end up batching, but you'll start from the right shape.
- **Have clients send their name and version from day one.** It costs two headers, and you'll want that data the first time you try to delete something.
- **Collect operation manifests from your very first release,** even if you never turn on strict mode. They're the only record of what a build that's gone quiet can still send.
- **Never delete a field on a hunch.** Deprecate it, re-implement it cheaply, watch the traffic, and let a script tell you when it's safe.

On the web, you get to fix your mistakes. On mobile, you have to make them cheap to keep around. Once I made peace with that, the rest was plumbing.

## Further reading

- [DataLoader](https://github.com/graphql/dataloader) by Lee Byron and contributors: the README explains batching and caching better than most blog posts
- Marc-André Giroux, *Production Ready GraphQL*, especially the chapters on schema design and evolution
- Shopify, [GraphQL Design Tutorial](https://github.com/Shopify/graphql-design-tutorial): designing a schema from the domain, not the database
- Relay, [GraphQL Cursor Connections Specification](https://relay.dev/graphql/connections.htm), the pagination shape used here
- Benjie Gillam, [GraphQL Trusted Documents](https://benjie.dev/graphql/trusted-documents), the clearest explanation of APQ versus trusted documents I've read
- The GraphQL specification, [`@deprecated`](https://spec.graphql.org/October2021/#sec--deprecated)
