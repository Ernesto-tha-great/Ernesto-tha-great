# time-to-second-success

Measure whether developers come back after their first successful API call, and find the exact step where they give up.

This is the companion code for my article **Time to Second Success: Measuring Developer Retention on API Platforms**. The metric's definition is in [`SPEC.md`](./SPEC.md).

![One developer's journey with TTFS and TTSS marked](./docs/images/timeline.svg)

## What's in here

```text
SPEC.md                 the metric definition: events, rules, defaults and why
sql/schema.sql          three tables: developers, api_calls, nudges
sql/journeys.sql        one row per developer: first success, second success, prompted?
sql/cliffs.sql          the last call before developers went quiet, by route, status and key mode
src/middleware.ts       records every authenticated API call (plain Node http or Express)
src/metrics.ts          TTFS, SSR30, unprompted SSR30, TTSS and the return curve
examples/parcel-api.ts  a tiny instrumented API to try it on
scripts/sample.ts       generates a SAMPLE cohort (invented behaviour, two planted cliffs)
scripts/report.ts       prints the numbers for any events database
```

## Quick start

You need Node 22.13 or newer (for the built-in `node:sqlite`).

```bash
git clone https://github.com/Ernesto-tha-great/time-to-second-success.git
cd time-to-second-success
npm install

npm test                      # 8 tests covering the edge cases in SPEC.md
npm run sample                # writes sample.db: 2,000 fictional developers
npm run report                # TTFS, SSR30, TTSS and the cliffs for the sample
npm run chart                 # redraws docs/images from the sample report
```

Try it on your own traffic:

```bash
npm run api                   # instrumented demo API on :3000, events go to events.db
curl -H "Authorization: Bearer sk_test_sam" "localhost:3000/v1/rates?from=10001&to=94103"
npm run report -- events.db   # your own journey
```

The SQL is plain SQLite. To run it on Postgres, swap `unixepoch(x)` for `extract(epoch from x)` and the named parameters for positional ones.

## About the sample data

`scripts/sample.ts` invents the behaviour of 2,000 developers and plants two drop-off points: a failing webhook test, and a first live label that fails until the sender address is verified. It exists to show that `cliffs.sql` finds them. Your own data will have its own cliffs.

![Where developers who succeeded once stopped](./docs/images/cliffs.svg)

## Licence

MIT
