# Time to second success

This is the finished code for my tutorial, **[Time to Second Success: Measuring Developer Retention on API Platforms](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/article.md)**.

If you're following along, build it from the article, step by step. This repo is here so you can check your work, or skip ahead.

![Cumulative share of sample developers with a second success by day, with and without a nudge](docs/images/return-curve.svg)

## Run it

You need Node.js 22.13 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/time-to-second-success.git
cd time-to-second-success
npm install

npm run sample     # 2,000 invented developers, written to sample.db
npm run journeys   # one row per developer
npm run report     # TTFS, SSR30, TTSS and the cliffs
npm run chart      # redraws the charts in docs/images
npm run api        # a tiny shipping-label API that records every call to events.db
npm test           # 8 tests
```

The sample is invented, with two drop-off points baked in on purpose so you can see the cliffs query find them. It says nothing about real developers. To measure your own API, record calls with `src/middleware.ts` and run `npm run report -- events.db`.

## What's in here

```text
sql/        schema.sql, journeys.sql, cliffs.sql
src/        store.ts, middleware.ts, metrics.ts
examples/   parcel-api.ts
scripts/    calls.ts, sample.ts, journeys.ts, report.ts, chart.ts
test/       tests for the definitions and the queries
```

## License

MIT
