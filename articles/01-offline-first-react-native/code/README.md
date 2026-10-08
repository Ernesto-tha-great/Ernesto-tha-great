# Offline write queue for React Native

This is the finished code for my tutorial, **[Offline-First in Practice: Building a Write Queue for React Native With TypeScript](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/01-offline-first-react-native/article.md)**.

If you're following along, build it from the article, step by step. This repo is here so you can check your work, or skip ahead.

![Without an idempotency key, a retry after a lost response creates a second order. With one, the server sends back the saved reply.](docs/images/lost-response.svg)

## Run it

You need Node.js 20 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/checked-luggage.git
cd checked-luggage
npm install

npm run server        # an orders API on :8787 that sometimes hangs up after saving
npm run naive         # fetch + retries: watch the duplicates pile up
npm run with-keys     # the same, with idempotency keys
npm run orders -- 5   # the queue: save 5 orders, then send what it can
npm run chaos         # all three approaches through one bad afternoon
npm test              # 9 tests
```

`npm run chaos` should print this (it's seeded, so the numbers don't change):

```text
┌─────────┬─────────────────────────────┬──────┬────────────┬─────────────┐
│ (index) │ name                        │ lost │ duplicated │ exactlyOnce │
├─────────┼─────────────────────────────┼──────┼────────────┼─────────────┤
│ 0       │ 'fetch + 3 retries'         │ 50   │ 15         │ 35          │
│ 1       │ 'retries + idempotency key' │ 50   │ 0          │ 50          │
│ 2       │ 'the queue'                 │ 0    │ 0          │ 100         │
└─────────┴─────────────────────────────┴──────┴────────────┴─────────────┘
```

## What's in here

```text
server/         the orders API, with idempotency keys
src/            the queue: queue.ts, storage.ts, backoff.ts, probe.ts
scripts/        naive.ts, with-keys.ts, place-orders.ts, chaos.ts
test/           unit tests
expo-example/   the React Native side: App.tsx and lib/ (copy src/queue.ts, backoff.ts and probe.ts into lib)
```

## License

MIT
