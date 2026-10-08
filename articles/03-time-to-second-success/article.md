# Time to Second Success: Measuring Developer Retention on API Platforms

*Everyone tracks the first API call. The second one is where developers decide to stay.*

**Ernest Nnamdi** · Developer Relations · Product Analytics · SQL

---

A while back, my team spent a whole quarter making our first-call experience faster. We rewrote the quickstart, pre-filled a test key into every copy-paste snippet, fixed the two error messages people kept tripping over, and got the median time from signup to first successful API call from fourteen minutes down to under four. We put the number on a slide. People clapped.

Three months later, the number of developers actively using the API hadn't moved.

We'd made the front door faster, and nobody had checked whether people were walking straight back out of it. "Time to first hello world" is a great metric for the first five minutes of a relationship. It tells you nothing about the next thirty days, and the next thirty days are where the business is.

So I started measuring something else: **the second success.** Not the first working call, but the next one, made on a different day, ideally without us nagging them into it. This article covers how to define it, instrument it with three tables and a bit of middleware, compute it in SQL, and use it to find the exact step where developers give up.

The code is all in [**github.com/Ernesto-tha-great/time-to-second-success**](https://github.com/Ernesto-tha-great/time-to-second-success). It runs on Node's built-in SQLite, so there's nothing to set up:

```bash
git clone https://github.com/Ernesto-tha-great/time-to-second-success.git
cd time-to-second-success
npm install
npm test                  # 8 tests, including the edge cases below
npm run sample && npm run report
```

You'll need Node 22.13 or newer.

## The first date problem

I'll be upfront: this isn't a brand-new idea. Dave McClure's "pirate metrics" (AARRR) have had *activation* and *retention* as separate stages since 2007, and Phil Leggetter's AAARRRP framework brought them into developer relations. Time to Second Success is activation and retention, with a definition sharp enough that two people running the same query get the same number.

That sharpness is the point. "Retention" in a lot of DevRel dashboards ends up meaning "had any API traffic this month". That counts the CI pipeline that calls your sandbox every night, and it counts the developer who came back only because your lifecycle email told them to. Neither of those is a developer who decided your API is worth building on.

Time to first call is the first date. The question is whether they call you back.

## The definition

Here's one developer's first month, with every rule marked on it:

![A timeline of one developer: signup, a 401, the first success, more calls in the same session, at least 24 hours of quiet, a nudge email on day 3 and a second success that afternoon. TTFS runs from signup to first success; TTSS from first success to second success.](./images/timeline.svg)

The full definition is in [`SPEC.md`](https://github.com/Ernesto-tha-great/time-to-second-success/blob/main/SPEC.md) in the repo. The short version:

- **A success** is a `2xx` response on a *meaningful* route. Health checks, `GET /me` and token exchange don't count. Your API answering "yes, you exist" isn't the developer building anything.
- **First success (FS)** is the developer's earliest success.
- **Second success (SS)** is their earliest success **at least 24 hours after the first**, and within 30 days of it. The gap is what makes it a *second* success and not just the rest of the first afternoon. Twelve calls in one sitting is one good afternoon, not twelve.
- A second success is **prompted** if you sent that developer a nudge (an email, an in-app message, a DM from someone like me) in the 72 hours before it. Otherwise it's **unprompted**.

From those, four numbers:

| Metric | What it tells you |
|---|---|
| **TTFS** (signup → first success), p50 and p90 | How long the front door is |
| **SSR30**: share of developers with a first success who had a second within 30 days | Whether the front door leads anywhere |
| **Unprompted SSR30** | How much of that is the product, and how much is your email team |
| **TTSS** (first → second success), p50 and p90 | How long the decision takes |

SSR30 is the headline. If I could only put one number on a DevRel team's dashboard, it would be this one.

The three thresholds (a 24-hour gap, a 72-hour nudge window and a 30-day horizon) are defaults, not laws. Change them if your product needs it. Just change them for everyone, and write the values down next to every number you report.

## Step 1: Instrument it (three tables)

You don't need an analytics vendor for this. You need three tables:

```sql
-- sql/schema.sql
CREATE TABLE developers (
  id           TEXT PRIMARY KEY,
  signed_up_at TEXT NOT NULL            -- ISO 8601, UTC
);

CREATE TABLE api_calls (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,
  method       TEXT NOT NULL,
  route        TEXT NOT NULL,           -- the route template, e.g. /v1/labels/:id
  status       INTEGER NOT NULL,
  key_mode     TEXT NOT NULL,           -- 'test' or 'live'
  sdk          TEXT                     -- from the User-Agent
);

CREATE TABLE nudges (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL            -- 'email', 'in_app', 'devrel_dm', ...
);
```

Three details in there will save you a painful rewrite later:

- **`developer_id` is the account, not the API key.** People rotate keys, and a rotated key shouldn't look like a new developer.
- **`route` is the template, not the raw path.** `/v1/labels/:id`, not `/v1/labels/lbl_8f2a`. Otherwise every label gets its own row in your reports and the cliffs query becomes useless.
- **`key_mode` matters more than you'd think.** You'll see why in Step 4.

The `api_calls` rows come from a small piece of middleware that runs after each response has been sent. It works with plain Node `http` or as Express middleware:

```ts
// src/middleware.ts
export function instrument(options: InstrumentOptions) {
  return (req: IncomingMessage, res: ServerResponse, next?: () => void): void => {
    const at = new Date();
    res.on('finish', () => {
      const key = bearerToken(req);
      const developerId = key ? options.developerFor(key) : null;
      if (!key || !developerId) return; // anonymous traffic isn't a developer journey

      options.record({
        developerId,
        at,
        method: req.method ?? 'GET',
        route: options.routeOf(req),
        status: res.statusCode,
        keyMode: key.startsWith('sk_live_') ? 'live' : 'test',
        sdk: req.headers['user-agent'] ?? null,
      });
    });
    next?.();
  };
}
```

Wiring it into a server takes three functions: one to store the call, one to map a key to an account, and one to name the route.

```ts
// examples/parcel-api.ts
const track = instrument({
  record: (call) => store.recordCall(call),
  developerFor: (key) => ACCOUNTS[key] ?? null,
  routeOf: (req) => match(req)?.template ?? 'unmatched',
});
```

The repo includes a tiny, fully instrumented shipping-label API so you can watch events land:

```bash
npm run api
curl -H "Authorization: Bearer sk_test_sam" "localhost:3000/v1/rates?from=10001&to=94103"
npm run report -- events.db
```

A note on consent: these are server-side logs of how people use your API, which you're almost certainly keeping already to run it. Mention the analytics use in your privacy notice. If you ever collect the same data *client-side*, through an SDK, check whether you need consent under the UK's PECR or the EU's ePrivacy rules. Server-side is the simpler path.

## Step 2: One row per developer

The whole definition fits in one query. It builds up in four steps:

```sql
-- sql/journeys.sql
WITH
successes AS (
  SELECT developer_id, unixepoch(at) AS t
  FROM api_calls
  WHERE status BETWEEN 200 AND 299
    AND route NOT IN (SELECT route FROM excluded_routes)
),
first_success AS (
  SELECT developer_id, MIN(t) AS t
  FROM successes
  GROUP BY developer_id
),
second_success AS (
  SELECT s.developer_id, MIN(s.t) AS t
  FROM successes s
  JOIN first_success f ON f.developer_id = s.developer_id
  WHERE s.t >= f.t + :return_gap
    AND s.t <= f.t + :horizon
  GROUP BY s.developer_id
)
SELECT
  d.id                       AS developer_id,
  unixepoch(d.signed_up_at)  AS signed_up,
  f.t                        AS first_success,
  ss.t                       AS second_success,
  CASE WHEN ss.t IS NULL THEN NULL
       ELSE EXISTS (
         SELECT 1 FROM nudges n
         WHERE n.developer_id = d.id
           AND unixepoch(n.at) BETWEEN ss.t - :nudge_window AND ss.t
       )
  END                        AS prompted
FROM developers d
LEFT JOIN first_success f   ON f.developer_id = d.id
LEFT JOIN second_success ss ON ss.developer_id = d.id;
```

`successes` filters out the noise. `first_success` is a plain `MIN`. `second_success` is the same `MIN`, but only over successes that fall between the gap and the horizon. And `prompted` asks one question: did we nudge this person in the 72 hours before they came back?

That's SQLite. For Postgres, swap `unixepoch(x)` for `extract(epoch from x)` and the named parameters for `$1`, `$2`, `$3`.

The edge cases are where definitions like this usually go wrong, so each one has a test. Here's the one that checks the 24-hour gap:

```ts
// test/metric.test.ts
// a: stumbles, succeeds, keeps going in the same session, comes back the next day.
call('a', 5 * MIN, '/v1/rates', 401);
call('a', 10 * MIN, '/v1/rates', 200);
call('a', 2 * HOUR, '/v1/labels', 201);
call('a', 30 * HOUR, '/v1/labels', 201);

it('ignores the rest of the first session when looking for a second success', () => {
  const a = byId(fixture()).get('a')!;
  assert.equal(a.firstSuccess, seconds(10 * MIN));
  assert.equal(a.secondSuccess, seconds(30 * HOUR), 'the 2-hour call is the same session, not a second success');
  assert.equal(a.prompted, false);
});
```

There are tests for the nudge window, for excluded routes, and for the developer who comes back on day 31 (too late to count).

## Step 3: Turn rows into numbers, carefully

Turning those rows into SSR30 is mostly arithmetic. There's one trap, and I fell straight into it the first time.

If a developer had their first success yesterday, they haven't had 30 days to come back yet. Count them as "didn't return" and your SSR30 is biased low. It's worst for your newest cohorts, which are exactly the ones you're trying to improve. So the denominator only includes developers whose first success is at least a full horizon old:

```ts
// src/metrics.ts
const withFirst = journeys.filter((j) => j.firstSuccess !== null);
// Only judge developers who've had the full horizon to come back.
const eligible = withFirst.filter((j) => j.firstSuccess! <= asOfSeconds - params.horizon);
const returned = eligible.filter((j) => j.secondSuccess !== null);
const unprompted = returned.filter((j) => j.prompted === false);
```

This means SSR30 always lags by 30 days. That's annoying, but it's honest. TTFS is the number you can watch move this week.

## Step 4: Find the cliffs

A low SSR30 tells you *that* you have a problem. The cliffs query tells you *where*.

Take every developer who had a first success but never a second. Look at the **last call they made**. Group those calls by route, status and key mode. If lots of people's last call is the same error on the same route, that step is a cliff:

```sql
-- sql/cliffs.sql (the important part)
last_calls AS (
  SELECT g.cohort, a.route, a.status, a.key_mode,
         ROW_NUMBER() OVER (PARTITION BY a.developer_id ORDER BY a.at DESC) AS rn
  FROM api_calls a JOIN groups g ON g.developer_id = a.developer_id
  WHERE a.route NOT IN (SELECT route FROM excluded_routes)
)
SELECT cohort, route, status, key_mode, COUNT(*) AS developers
FROM last_calls
WHERE rn = 1
GROUP BY cohort, route, status, key_mode
ORDER BY cohort, developers DESC;
```

The `groups` CTE splits developers into two cohorts: **stalled** (had a first success, never came back) and **never** (made calls, never succeeded at all). It also leaves out anyone still inside their 30 days, for the same reason as before.

## What it looks like

To show the whole thing end to end, the repo includes `scripts/sample.ts`. It generates an event log for 2,000 fictional developers of the shipping-label API.

I want to be clear about what that is. The behaviour is **invented**. I deliberately built two drop-off points into it: a webhook test step that fails for a third of the people who try it, and a first *live* label that fails until the sender's address is verified. The point is to check that the queries find what I planted, not to tell you anything about real developers. Your own data will have its own cliffs.

Here's the real output from `npm run report` on that sample:

```text
sample.db, as of 2026-09-30
(return gap 24 h, nudge window 72 h, horizon 30 days)

Developers                    2000
Made at least one call        1614
Reached a first success       1428
TTFS  p50 / p90               52 min / 69.3 h
Eligible for SSR30            1428
SSR30                         76.7%
SSR30, unprompted only        47.2%
TTSS  p50 / p90               5.4 days / 20.3 days

Last call before going quiet: had a first success, never came back (333)
   109   32.7%  422  live  /v1/labels
    86   25.8%  400  test  /v1/webhooks/test
    60   18.0%  200  test  /v1/rates
    51   15.3%  201  live  /v1/labels
    10    3.0%  200  test  /v1/webhooks/test
     9    2.7%  200  test  /v1/labels/:id

Last call before going quiet: never reached a first success (186)
    95   51.1%  401  test  /v1/rates
    91   48.9%  422  test  /v1/labels
```

Both planted cliffs are at the top of the stalled list. Notice the `live` in the top row: without the `key_mode` column, that 422 would blur into the onboarding 422s at the bottom, and you'd go and fix the wrong thing. That one column is the difference between "our label endpoint is confusing" and "our sandbox lets you skip a step that production enforces", which are two very different bugs.

The grey rows below are fine. Those developers' last call *worked*; they just didn't come back.

![Bar chart of the last call before going quiet, for developers who never returned. 422 live /v1/labels and 400 test /v1/webhooks/test are the largest error rows.](./images/cliffs.svg)

The return curve shows how the decision plays out over the month:

![Cumulative share of developers with a second success by day since first success. Any return reaches 76.7% by day 30; unprompted returns reach 47.2%. A dashed line marks the nudge email on day 3.](./images/return-curve.svg)

The gap between the two lines is your nudge doing its job. In this sample, the email on day 3 produces a jump that the unprompted line never gets. That's fine; nudges are part of the product. But if your SSR30 looks healthy and your *unprompted* SSR30 doesn't, you have a marketing engine propping up a product problem, and it's worth knowing which one you're reporting to the board.

## What I'd do with this as a team lead

The metric's job is to change what a team works on, so here's how I'd use it:

- **Put SSR30 next to TTFS on the same dashboard.** A team that only owns the first date will keep optimising the first date.
- **Review the top three cliffs every month,** and turn each one into a ticket with an owner. Most cliffs aren't DevRel problems: they're an error message, a sandbox/production mismatch, or a docs page that stops one step too early.
- **Report prompted and unprompted separately.** The unprompted number is product health; the prompted share is how well your lifecycle messaging works. Both matter, but they're different conversations.
- **Set targets on the cliffs, not on SSR30 itself.** Once a measure becomes a target, people find ways to move the number without fixing anything (that's Goodhart's law). "Halve the drop-off at the live label step" is much harder to game than "raise SSR30 by five points", and it actually fixes something.

## Traps I've seen

- **CI pipelines look exactly like loyal developers.** A test suite that calls your sandbox every night will produce a "second success" every single day. Exclude keys you know are used by CI, or filter on the user agent.
- **Teams aren't individuals.** If your accounts are shared workspaces, decide whether you're measuring people or teams, and stick to it.
- **Changing the thresholds rewrites history.** If you change the gap or the horizon, recompute every past cohort, or your trend line will show an improvement that's really just a definition change.

## Wrapping up

My team's four-minute quickstart wasn't a waste; a short front door matters. But it was only half the job, and for a quarter we only measured that half. Time to Second Success is how I measure the other half now: three tables, one middleware, two queries, and a monthly look at where people give up.

The spec, the SQL, the middleware and the sample are all in [the repo](https://github.com/Ernesto-tha-great/time-to-second-success). If you run it on your own API, I'd genuinely love to hear what your top cliff turned out to be.

## Further reading

- Dave McClure, "Startup Metrics for Pirates: AARRR!" (2007), where activation and retention first got separate names
- Phil Leggetter, the AAARRRP developer relations strategy framework
- Mary Thengvall, *The Business Value of Developer Relations* (Apress, 2018)
- Marilyn Strathern's phrasing of Goodhart's law: "When a measure becomes a target, it ceases to be a good measure" (1997)
- SQLite documentation, [Window Functions](https://www.sqlite.org/windowfunctions.html), for `ROW_NUMBER()` and friends
