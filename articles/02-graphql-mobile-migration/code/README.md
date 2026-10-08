# graphql-mobile-migration

How to move a GraphQL API from a table-shaped schema to one shaped around your app's screens, without breaking the app versions that will never update.

This is the companion code for my article **Migrating a GraphQL Schema Without Breaking Legacy Mobile Clients**.

![Where 401 queries come from, and how DataLoader turns them into 3](./docs/images/n-plus-one.svg)

## What's in here

- **`src/v1/`**: the schema I'd have shipped on day one, with tables as types and one query per resolver. The order history screen costs 401 SQL statements.
- **`src/v2/`**: the client-shaped schema. It has `viewer`, cursor pagination and a `Money` type, and batches with DataLoader. Old fields are kept as `@deprecated` adapters on the new resolvers.
- **`src/usage.ts`**: a Yoga plugin that records which fields each `client@version` touches.
- **`src/trusted.ts`**: trusted documents. The server only runs operations that shipped in an app build, and it recognises old builds that send raw query text.
- **`src/removal.ts`**: works out whether a schema change breaks any supported build, using the manifests rather than traffic.
- **`clients/`**: the operations each app build shipped with (Android 2.3, Android 3.0, iOS 3.1), plus `support.json`.

## Quick start

You need Node 22.13 or newer (for the built-in `node:sqlite`).

```bash
git clone https://github.com/Ernesto-tha-great/graphql-mobile-migration.git
cd graphql-mobile-migration
npm install

npm test                                     # 15 tests
npm run dev                                  # GraphiQL at http://localhost:4000/graphql, usage at /usage
npm run manifest                             # rebuild manifests/ from clients/
npm run check-schema                         # does the current schema break any supported build?
npm run check-removal -- Product.price_cents # what if I deleted this field?
npm run measure && npm run chart             # statements and timings per scenario
```

To try the server against the old schema, run `SCHEMA=v1 npm run dev`. To reject anything that isn't in a manifest, use `TRUSTED_MODE=strict npm run dev`.

## Results

![SQL statements and median response time per scenario](./docs/images/measure.svg)

The same unchanged Android 2.3 query costs 401 statements on v1 and 3 on v2, and gets back byte-for-byte the same JSON (`test/compat.test.ts`). Timings come from an in-memory SQLite with 1 ms of simulated latency per statement and a pool of 10 connections, so run `npm run measure` to see the numbers on your own machine.

## Licence

MIT
