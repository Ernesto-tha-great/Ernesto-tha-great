# Time to Second Success: Measuring Developer Retention on API Platforms

*Time to first hello world tells you how good your onboarding is. It doesn't tell you whether anyone stays. In this tutorial, we instrument an API, define a "second success", and build the SQL and TypeScript to measure it and find where developers drop off.*

**Ernest Nnamdi** · Developer Relations · SQL · TypeScript

---

At Celo, I co-built Celo Composer, and the pitch fit in one line: deploy an application in under five minutes. We were very proud of that number, and we worked hard to keep it there. Later, when I ran Stackshift, our eight-week developer cohort, the first week was always the exciting one. Everybody shipped something.

What I couldn't answer as easily was the next question: how many of those developers came back the week after, on their own, and built something else? We were very good at measuring how fast someone got started. We were much worse at knowing whether they stayed.

The TL;DR of it is that "time to first hello world" measures your onboarding, and that's it. A developer can have a great first five minutes and never come back. So in this tutorial, I'm going to show you how to measure the thing that comes after: the **second success**. We'll instrument a small API, record every call, define a first and a second success precisely, and build the queries that tell you how many developers come back, how long it takes them, and where the ones who don't come back got stuck.

### Okay, but what's a "success"?

That's totally fair, because "success" sounds fluffy. Here, it means something very boring: an API call that returned a 2xx, on a route that actually does something. Calling `/v1/health` proves the API is up, and calling `/v1/me` proves your key works. Neither proves you built anything, so those don't count.

- A developer's **first success** is their first 2xx on a real route.
- Their **second success** is a 2xx that comes at least 24 hours after the first, and within 30 days of it. The 24 hours matter: three calls in the same afternoon are one session, not three visits.
- A second success is **prompted** if you sent them something (an email, a DM from your DevRel team) in the 72 hours before it.

Think of a gym. Getting people through the door the first time is easy: free trial, friendly staff, a tour. Whether the gym is any good shows up the next week, when people come back without anyone calling them to remind them. That's what "unprompted" is for.

![One developer's month: signup, a failed call, a first success, a nudge email on day 3, then a second success, with time to first success and time to second success marked.](images/timeline.svg)

From those definitions, we get four numbers:

- **TTFS** (time to first success): from signup to first success.
- **SSR30** (second success rate, 30 days): of the developers who had a first success at least 30 days ago, the share who had a second within 30 days.
- **Unprompted SSR30**: the same, counting only second successes nobody nudged.
- **TTSS** (time to second success): from first success to second.

### Sounds good, but why not just count active developers?

Because "active" counts everyone who made a call, including the people who are stuck. A developer hammering the same failing endpoint for three days is very active. They're also about to leave.

That being said, let's get to building!

## Prerequisites

- Node.js 22.13 or newer (we use its built-in SQLite module)
- Some familiarity with SQL and TypeScript
- curl and a bash-style terminal (on Windows, use Git Bash or WSL)

## What Are We Building?

We'll build:

- three tables that record developers, API calls and nudges
- middleware that records every call to an API, and a small shipping-label API to try it on
- a generator for 2,000 sample developers, so we have something to measure
- a SQL query that turns calls into one row per developer: signup, first success, second success
- a report with TTFS, SSR30 and TTSS
- a second query that finds the "cliffs": the last call developers made before they went quiet

Here's what the project will look like when we're done:

```text
time-to-second-success/
  sql/
    schema.sql          # the tables
    journeys.sql        # one row per developer
    cliffs.sql          # where developers stopped
  src/
    store.ts            # records events and runs the queries
    middleware.ts       # records every API call
    metrics.ts          # turns journeys into numbers
  examples/
    parcel-api.ts       # a tiny shipping-label API to measure
  scripts/
    calls.ts            # prints recorded calls
    sample.ts           # 2,000 sample developers
    journeys.ts         # prints a few journeys
    report.ts           # the numbers, and the cliffs
```

## Step 1: Setting Up Our Project

Let's start by creating a folder for the project and initialising it.

```bash
mkdir time-to-second-success
cd time-to-second-success
npm init -y
npm install --save-dev typescript tsx @types/node
```

Open the folder in your code editor. In package.json, add `"type": "module"` and replace the `scripts` section, so those two parts look like this (leave the rest of the file, like your dependencies, as it is):

```json
{
  "type": "module",
  "scripts": {
    "api": "node --no-warnings --import tsx examples/parcel-api.ts",
    "calls": "node --no-warnings --import tsx scripts/calls.ts",
    "sample": "node --no-warnings --import tsx scripts/sample.ts",
    "journeys": "node --no-warnings --import tsx scripts/journeys.ts",
    "report": "node --no-warnings --import tsx scripts/report.ts",
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
  "exclude": ["node_modules"]
}
```

## Step 2: The Tables

The whole measurement runs on three tables, plus a list of routes that don't count. Create a folder called sql, and in it, a file called schema.sql:

```sql
-- Works on SQLite 3.38+. For Postgres, see the note at the top of journeys.sql.
CREATE TABLE IF NOT EXISTS developers (
  id           TEXT PRIMARY KEY,
  signed_up_at TEXT NOT NULL            -- ISO 8601, UTC
);

CREATE TABLE IF NOT EXISTS api_calls (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,           -- ISO 8601, UTC
  method       TEXT NOT NULL,
  route        TEXT NOT NULL,           -- the route template, e.g. /v1/labels/:id
  status       INTEGER NOT NULL,
  key_mode     TEXT NOT NULL,           -- 'test' or 'live'
  sdk          TEXT                     -- e.g. 'parcel-node/2.1.0', from the User-Agent
);
CREATE INDEX IF NOT EXISTS api_calls_by_developer ON api_calls (developer_id, at);

CREATE TABLE IF NOT EXISTS nudges (
  developer_id TEXT NOT NULL,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL            -- 'email', 'in_app', 'devrel_dm', ...
);
CREATE INDEX IF NOT EXISTS nudges_by_developer ON nudges (developer_id, at);

-- Calls that prove nothing about building with the API.
CREATE TABLE IF NOT EXISTS excluded_routes (route TEXT PRIMARY KEY);
INSERT OR IGNORE INTO excluded_routes VALUES ('/v1/health'), ('/v1/me'), ('/v1/oauth/token');
```

Here's what each one is for:

- `developers` holds one row per account, with when they signed up.
- `api_calls` holds one row per request. Note `route`: it's the route *template*, like `/v1/labels/:id`, not the raw path. Otherwise every label anyone ever looks up becomes its own row in your reports.
- `nudges` holds everything you did to bring someone back: emails, in-app messages, DMs.
- `excluded_routes` lists the routes that don't count as a success, because calling them proves nothing about building with your API.

Next, we need something to write to those tables. Create a folder called src, and in it, a file called store.ts:

```ts
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

export interface ApiCall {
  developerId: string;
  at: Date;
  method: string;
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  sdk?: string | null;
}

/** Records what developers do, and asks questions about it. */
export class EventStore {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(sql('schema.sql'));
  }

  addDeveloper(id: string, signedUpAt: Date): void {
    this.db.prepare('INSERT OR IGNORE INTO developers VALUES (?, ?)').run(id, signedUpAt.toISOString());
  }

  recordCall(call: ApiCall): void {
    this.db
      .prepare('INSERT INTO api_calls VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(call.developerId, call.at.toISOString(), call.method, call.route, call.status, call.keyMode, call.sdk ?? null);
  }

  recordNudge(developerId: string, at: Date, kind: string): void {
    this.db.prepare('INSERT INTO nudges VALUES (?, ?, ?)').run(developerId, at.toISOString(), kind);
  }
}
```

It opens (or creates) a SQLite database file, runs schema.sql, and gives us one method for each of the three tables. Run `npm run typecheck` to make sure it compiles. Apart from npm's own two lines at the top, it shouldn't print anything. You can do this after every step.

## Step 3: Recording Every API Call

Now we need the calls themselves. The cleanest place to record them is in middleware, after the response has been sent, so we know the status code and we don't delay the response.

In the src folder, create middleware.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/middleware.ts):

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiCall } from './store';

export interface InstrumentOptions {
  record(call: ApiCall): void;
  /** Which account does this API key belong to? People rotate keys; accounts stay. */
  developerFor(apiKey: string): string | null;
  /** The route *template*, e.g. /v1/labels/:id. Raw paths make every label its own row. */
  routeOf(req: IncomingMessage): string;
}

/**
 * Records one api_call per request, after the response is sent. Works as plain
 * Node http middleware or as Express middleware: (req, res, next).
 */
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

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
```

Three details here are worth getting right in your own API:

- `developerFor` maps an API key to an account. Developers rotate keys, but their account stays the same, so we always record the account.
- `routeOf` returns the route template, for the reason we saw in Step 2.
- `keyMode` records whether the call used a test key or a live key. As you'll see later, a lot of developers fall off right at the step where they switch.

To try it, we need an API. Create a folder called examples, and in it, a file called parcel-api.ts. Copy the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/parcel-api.ts) and paste it in. It's a tiny shipping-label API: you can get rates, create labels and register a webhook.

```ts
/**
 * A tiny shipping-label API, instrumented. Run it, curl it, then run the report
 * against events.db to watch your own journey show up.
 *
 *   npm run api
 *   curl -H "Authorization: Bearer sk_test_sam" "localhost:3000/v1/rates?from=10001&to=94103"
 *   npm run report -- events.db
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { instrument } from '../src/middleware';
import { EventStore } from '../src/store';

const store = new EventStore(process.env.EVENTS_DB ?? 'events.db');

const ACCOUNTS: Record<string, string> = {
  sk_test_sam: 'dev_sam',
  sk_live_sam: 'dev_sam',
  sk_test_maya: 'dev_maya',
};
for (const developer of new Set(Object.values(ACCOUNTS))) store.addDeveloper(developer, new Date());

const ROUTES: Array<{ method: string; template: string; pattern: RegExp }> = [
  { method: 'GET', template: '/v1/health', pattern: /^\/v1\/health$/ },
  { method: 'GET', template: '/v1/me', pattern: /^\/v1\/me$/ },
  { method: 'GET', template: '/v1/rates', pattern: /^\/v1\/rates$/ },
  { method: 'POST', template: '/v1/labels', pattern: /^\/v1\/labels$/ },
  { method: 'GET', template: '/v1/labels/:id', pattern: /^\/v1\/labels\/[^/]+$/ },
  { method: 'POST', template: '/v1/webhooks', pattern: /^\/v1\/webhooks$/ },
  { method: 'POST', template: '/v1/webhooks/test', pattern: /^\/v1\/webhooks\/test$/ },
];

function match(req: IncomingMessage) {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  return ROUTES.find((route) => route.method === req.method && route.pattern.test(path));
}

const track = instrument({
  record: (call) => store.recordCall(call),
  developerFor: (key) => ACCOUNTS[key] ?? null,
  routeOf: (req) => match(req)?.template ?? 'unmatched',
});

const webhooks = new Map<string, string>();
let nextLabel = 1;

createServer(async (req, res) => {
  track(req, res);
  const route = match(req);
  if (!route) return send(res, 404, { error: 'not_found' });
  if (route.template === '/v1/health') return send(res, 200, { ok: true });

  const key = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const developer = ACCOUNTS[key];
  if (!developer) return send(res, 401, { error: 'invalid_api_key', hint: 'Use a key from your dashboard, e.g. sk_test_sam' });
  const live = key.startsWith('sk_live_');
  const body = req.method === 'POST' ? await readJson(req) : {};

  switch (route.template) {
    case '/v1/me':
      return send(res, 200, { developer, mode: live ? 'live' : 'test' });
    case '/v1/rates':
      return send(res, 200, { rates: [{ service: 'standard', amount: 795 }, { service: 'express', amount: 1495 }] });
    case '/v1/labels': {
      const from = body.from as { postcode?: string; verified?: boolean } | undefined;
      if (!from?.postcode || !(body.to as { postcode?: string } | undefined)?.postcode) {
        return send(res, 422, { error: 'missing_address', hint: 'Both from.postcode and to.postcode are required' });
      }
      if (live && !from.verified) {
        // The step where test mode and live mode quietly disagree.
        return send(res, 422, { error: 'address_unverified', hint: 'Verify your sender address in the dashboard first' });
      }
      return send(res, 201, { id: `lbl_${nextLabel++}`, pdf: 'https://example.com/label.pdf' });
    }
    case '/v1/labels/:id':
      return send(res, 200, { id: req.url?.split('/').pop(), status: 'in_transit' });
    case '/v1/webhooks': {
      const url = String(body.url ?? '');
      if (!url.startsWith('https://')) return send(res, 422, { error: 'webhook_url_must_be_https' });
      webhooks.set(developer, url);
      return send(res, 201, { url });
    }
    case '/v1/webhooks/test':
      if (!webhooks.has(developer)) return send(res, 400, { error: 'no_webhook_registered' });
      return send(res, 200, { delivered: true });
  }
}).listen(3000, () => console.log('Parcel API on http://localhost:3000 (events → events.db)'));

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload) + '\n');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
```

Notice the `address_unverified` error. In test mode, any address works. In live mode, your sender address has to be verified first. That's the kind of thing test mode and live mode quietly disagree about, and it'll come back later.

Finally, create a folder called scripts, and in it, a file called calls.ts, so we can see what got recorded:

```ts
// Prints the API calls recorded so far.
//   npm run calls              # events.db
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2] ?? 'events.db');
console.table(db.prepare('SELECT developer_id, method, route, status, key_mode FROM api_calls ORDER BY at').all());
```

Start the API:

```bash
npm run api
```

In a second terminal, be Sam, a developer trying the API for the first time. Sam forgets an address, gets rates, creates a label, then tries their live key:

```bash
curl -s localhost:3000/v1/labels -X POST -H 'Authorization: Bearer sk_test_sam' -H 'content-type: application/json' -d '{"from":{"postcode":"10001"}}'
curl -s "localhost:3000/v1/rates?from=10001&to=94103" -H 'Authorization: Bearer sk_test_sam'
curl -s localhost:3000/v1/labels -X POST -H 'Authorization: Bearer sk_test_sam' -H 'content-type: application/json' -d '{"from":{"postcode":"10001"},"to":{"postcode":"94103"}}'
curl -s localhost:3000/v1/labels -X POST -H 'Authorization: Bearer sk_live_sam' -H 'content-type: application/json' -d '{"from":{"postcode":"10001"},"to":{"postcode":"94103"}}'
```

```text
{"error":"missing_address","hint":"Both from.postcode and to.postcode are required"}
{"rates":[{"service":"standard","amount":795},{"service":"express","amount":1495}]}
{"id":"lbl_1","pdf":"https://example.com/label.pdf"}
{"error":"address_unverified","hint":"Verify your sender address in the dashboard first"}
```

Now stop the API (Ctrl+C) and look at what we recorded:

```bash
npm run calls
```

```text
┌─────────┬──────────────┬────────┬──────────────┬────────┬──────────┐
│ (index) │ developer_id │ method │ route        │ status │ key_mode │
├─────────┼──────────────┼────────┼──────────────┼────────┼──────────┤
│ 0       │ 'dev_sam'    │ 'POST' │ '/v1/labels' │ 422    │ 'test'   │
│ 1       │ 'dev_sam'    │ 'GET'  │ '/v1/rates'  │ 200    │ 'test'   │
│ 2       │ 'dev_sam'    │ 'POST' │ '/v1/labels' │ 201    │ 'test'   │
│ 3       │ 'dev_sam'    │ 'POST' │ '/v1/labels' │ 422    │ 'live'   │
└─────────┴──────────────┴────────┴──────────────┴────────┴──────────┘
```

Four calls, all attributed to Sam's account, with the route, the status and which kind of key they used.

## Step 4: A Sample of 2,000 Developers

Sam alone isn't going to tell us much. To build and check our queries, we need a crowd. So let's generate one.

I want to be upfront about this part: **the sample is invented**. The behaviour in it is made up, and I've deliberately baked in two places where developers drop off, so we can check that our queries find them. It tells you nothing about real developers. Your own data will have its own drop-offs, and finding those is the whole point.

The generator writes thousands of rows, so let's give the store a way to wrap them in one transaction. Add this method at the end of the `EventStore` class in store.ts:

```ts
  transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
```

Now, in the scripts folder, create sample.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/sample.ts). It's long, so I won't paste all of it here.

Each sample developer signs up, maybe makes a few mistakes (a wrong key, a missing address), maybe reaches a first success, and maybe comes back later. Here are the two drop-offs I baked in:

```ts
  // Cliff #1 (baked in): webhook setup fails for a third of the people who try it.
  let returnRate = 0.07;
  if (chance(0.45)) {
    call('POST', '/v1/webhooks', 201);
    if (chance(0.35)) {
      call('POST', '/v1/webhooks/test', 400);
      returnRate *= 0.3;
    } else {
      call('POST', '/v1/webhooks/test', 200);
    }
  }
```

```ts
      // Cliff #2 (baked in): the first live label fails until the sender address is verified.
      if (chance(0.4)) {
        call('POST', '/v1/labels', 422, 'live');
        if (chance(0.5)) return; // gave up on going live
      }
      call('POST', '/v1/labels', 201, 'live');
```

The generator also emails anyone who had a first success but hasn't come back three days later, and makes them a bit more likely to come back over the next three days. Run it:

```bash
npm run sample
```

```text
wrote sample.db: 2000 sample developers
```

## Step 5: One Row per Developer

Here's the heart of the whole thing. In the sql folder, create journeys.sql and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/journeys.sql):

```sql
-- One row per developer: signup, first success, second success, and whether
-- the second success was prompted by a nudge. All times are unix seconds.
--
-- Parameters: :return_gap, :nudge_window, :horizon (seconds).
-- Postgres: store the times as timestamptz instead of TEXT, replace
-- unixepoch(x) with extract(epoch from x), and use $1, $2, $3 for the
-- parameters. cliffs.sql needs the same changes. In schema.sql,
-- INSERT OR IGNORE becomes INSERT ... ON CONFLICT DO NOTHING.
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
  d.id                                  AS developer_id,
  unixepoch(d.signed_up_at)             AS signed_up,
  f.t                                   AS first_success,
  ss.t                                  AS second_success,
  CASE WHEN ss.t IS NULL THEN NULL
       ELSE EXISTS (
         SELECT 1 FROM nudges n
         WHERE n.developer_id = d.id
           AND unixepoch(n.at) BETWEEN ss.t - :nudge_window AND ss.t
       )
  END                                   AS prompted
FROM developers d
LEFT JOIN first_success f  ON f.developer_id = d.id
LEFT JOIN second_success ss ON ss.developer_id = d.id
ORDER BY d.id;
```

Let's go through it one piece at a time:

- `successes` is every 2xx call on a route that isn't excluded, with its time in seconds.
- `first_success` is each developer's earliest success.
- `second_success` is each developer's earliest success that's at least `:return_gap` after the first (24 hours) and at most `:horizon` after it (30 days).
- The final `SELECT` gives one row per developer, including the ones who never succeeded at all, which is why it's a `LEFT JOIN`. The `prompted` column checks whether there's a nudge in the `:nudge_window` (72 hours) before the second success.

The query uses SQLite's `unixepoch()` on text timestamps. If you're on Postgres, the comment at the top of the file lists what to change: `timestamptz` columns instead of text, `extract(epoch from ...)` instead of `unixepoch()`, and numbered parameters.

Now let's run it from TypeScript. In store.ts, add these types right above the `/** Records what developers do, and asks questions about it. */` comment:

```ts
export interface Params {
  /** Seconds. A success counts as "second" only if it's at least this long after the first. */
  returnGap: number;
  /** Seconds. A nudge this soon before the second success makes it "prompted". */
  nudgeWindow: number;
  /** Seconds after the first success within which a second success counts. */
  horizon: number;
}

export const DEFAULT_PARAMS: Params = {
  returnGap: 24 * 3600,
  nudgeWindow: 72 * 3600,
  horizon: 30 * 86400,
};

export interface Journey {
  developerId: string;
  signedUp: number;
  firstSuccess: number | null;
  secondSuccess: number | null;
  prompted: boolean | null;
}
```

And this method at the end of the class:

```ts
  journeys(params: Params = DEFAULT_PARAMS): Journey[] {
    const rows = this.db.prepare(sql('journeys.sql')).all({
      return_gap: params.returnGap,
      nudge_window: params.nudgeWindow,
      horizon: params.horizon,
    }) as Array<{ developer_id: string; signed_up: number; first_success: number | null; second_success: number | null; prompted: number | null }>;

    return rows.map((row) => ({
      developerId: row.developer_id,
      signedUp: row.signed_up,
      firstSuccess: row.first_success,
      secondSuccess: row.second_success,
      prompted: row.prompted === null ? null : row.prompted === 1,
    }));
  }
```

`DEFAULT_PARAMS` holds our definitions (24 hours, 72 hours, 30 days), in seconds. Keeping them as parameters means you can try a different definition without touching the SQL.

To see a few rows, create scripts/journeys.ts:

```ts
// One row per developer: signup, first success, second success.
//   npm run journeys            # sample.db
import { EventStore } from '../src/store';

const store = new EventStore(process.argv[2] ?? 'sample.db');
const journeys = store.journeys();
const date = (t: number | null) => (t === null ? '' : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' '));

console.table(
  journeys.slice(0, 8).map((j) => ({
    developer: j.developerId,
    'signed up': date(j.signedUp),
    'first success': date(j.firstSuccess),
    'second success': date(j.secondSuccess),
    prompted: j.prompted ?? '',
  })),
);
console.log(`${journeys.length} developers, ${journeys.filter((j) => j.firstSuccess).length} with a first success, ${journeys.filter((j) => j.secondSuccess).length} with a second.`);
```

Run it:

```bash
npm run journeys
```

```text
┌─────────┬────────────┬────────────────────┬────────────────────┬────────────────────┬──────────┐
│ (index) │ developer  │ signed up          │ first success      │ second success     │ prompted │
├─────────┼────────────┼────────────────────┼────────────────────┼────────────────────┼──────────┤
│ 0       │ 'dev_0001' │ '2026-07-07 16:00' │ '2026-07-08 21:24' │ ''                 │ ''       │
│ 1       │ 'dev_0002' │ '2026-06-11 13:16' │ '2026-06-11 14:10' │ '2026-06-14 17:50' │ true     │
│ 2       │ 'dev_0003' │ '2026-07-14 21:29' │ '2026-07-14 22:17' │ '2026-07-18 08:02' │ true     │
│ 3       │ 'dev_0004' │ '2026-06-26 04:25' │ ''                 │ ''                 │ ''       │
│ 4       │ 'dev_0005' │ '2026-07-10 22:25' │ '2026-07-10 23:05' │ '2026-07-19 06:10' │ false    │
│ 5       │ 'dev_0006' │ '2026-06-21 12:46' │ ''                 │ ''                 │ ''       │
│ 6       │ 'dev_0007' │ '2026-06-14 11:23' │ '2026-06-14 12:23' │ '2026-06-17 15:34' │ true     │
│ 7       │ 'dev_0008' │ '2026-06-24 04:13' │ '2026-06-27 06:05' │ '2026-07-15 06:58' │ false    │
└─────────┴────────────┴────────────────────┴────────────────────┴────────────────────┴──────────┘
2000 developers, 1428 with a first success, 1095 with a second.
```

Phew! Every developer is one row: when they signed up, when they first succeeded, when (and if) they came back, and whether something nudged them. Developer 0004 never got a first success. Developer 0001 came back the next day, tried to create a live label, got a `422` and left. Hold on to that one. Those two are the ones the rest of this tutorial is about.

## Step 6: Turning Rows Into Numbers

Now let's turn those rows into the four numbers. In the src folder, create metrics.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/metrics.ts):

```ts
import { DEFAULT_PARAMS, type Journey, type Params } from './store';

export interface Summary {
  developers: number;
  reachedFirstSuccess: number;
  /** Developers whose first success is at least `horizon` old: the denominator for SSR30. */
  eligible: number;
  ssr: number;
  unpromptedSsr: number;
  ttfs: { p50: number; p90: number };
  ttss: { p50: number; p90: number };
  /** Cumulative share of eligible developers with a second success, by day after first success. */
  curve: Array<{ day: number; any: number; unprompted: number }>;
}

const HOUR = 3600;
const DAY = 86400;

export function summarise(journeys: readonly Journey[], asOf: Date, params: Params = DEFAULT_PARAMS): Summary {
  const asOfSeconds = Math.floor(asOf.getTime() / 1000);
  const withFirst = journeys.filter((j) => j.firstSuccess !== null);
  // Only judge developers who've had the full horizon to come back.
  const eligible = withFirst.filter((j) => j.firstSuccess! <= asOfSeconds - params.horizon);
  const returned = eligible.filter((j) => j.secondSuccess !== null);
  const unprompted = returned.filter((j) => j.prompted === false);

  const days = Math.round(params.horizon / DAY);
  const curve = Array.from({ length: days + 1 }, (_, day) => {
    const by = (j: Journey) => j.secondSuccess! - j.firstSuccess! <= day * DAY;
    return {
      day,
      any: share(returned.filter(by).length, eligible.length),
      unprompted: share(unprompted.filter(by).length, eligible.length),
    };
  });

  return {
    developers: journeys.length,
    reachedFirstSuccess: withFirst.length,
    eligible: eligible.length,
    ssr: share(returned.length, eligible.length),
    unpromptedSsr: share(unprompted.length, eligible.length),
    ttfs: percentiles(withFirst.map((j) => (j.firstSuccess! - j.signedUp) / HOUR)),
    ttss: percentiles(returned.map((j) => (j.secondSuccess! - j.firstSuccess!) / DAY)),
    curve,
  };
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function percentiles(values: number[]): { p50: number; p90: number } {
  if (values.length === 0) return { p50: Number.NaN, p90: Number.NaN };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return { p50: at(0.5), p90: at(0.9) };
}
```

There's one line in here that's easy to get wrong, and it's this one:

```ts
const eligible = withFirst.filter((j) => j.firstSuccess! <= asOfSeconds - params.horizon);
```

If someone had their first success yesterday, they haven't had 30 days to come back yet. Count them, and your SSR30 looks worse every time you have a good week of signups. So we only judge developers whose first success is at least 30 days old.

The `curve` is the share of eligible developers with a second success by each day after their first. We'll use it for a chart later.

We also want to know how many developers made any call at all. Add this method at the end of the `EventStore` class:

```ts
  /** Developers who made at least one API call, successful or not. */
  callers(): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT developer_id) AS n FROM api_calls').get() as { n: number }).n;
  }
```

Now the report. In the scripts folder, create report.ts:

```ts
/**
 * Prints TTFS, SSR30 and TTSS for an events database.
 *
 *   npm run report                    # sample.db, as of 2026-09-30
 *   npm run report -- events.db now   # your own events, as of right now
 */
import { summarise } from '../src/metrics';
import { DEFAULT_PARAMS, EventStore } from '../src/store';

const path = process.argv[2] ?? 'sample.db';
const asOf = process.argv[3] === 'now' || path !== 'sample.db' ? new Date() : new Date(Date.UTC(2026, 8, 30));

const store = new EventStore(path);
const summary = summarise(store.journeys(), asOf);

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const hours = (h: number) => (Number.isNaN(h) ? '–' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
const days = (d: number) => (Number.isNaN(d) ? '–' : `${d.toFixed(1)} days`);

console.log(`\n${path}, as of ${asOf.toISOString().slice(0, 10)}`);
console.log(`(return gap ${DEFAULT_PARAMS.returnGap / 3600} h, nudge window ${DEFAULT_PARAMS.nudgeWindow / 3600} h, horizon ${DEFAULT_PARAMS.horizon / 86400} days)\n`);
console.log(`Developers                    ${summary.developers}`);
console.log(`Made at least one call        ${store.callers()}`);
console.log(`Reached a first success       ${summary.reachedFirstSuccess}`);
console.log(`TTFS  p50 / p90               ${hours(summary.ttfs.p50)} / ${hours(summary.ttfs.p90)}`);
console.log(`Eligible for SSR30            ${summary.eligible}`);
console.log(`SSR30                         ${pct(summary.ssr)}`);
console.log(`SSR30, unprompted only        ${pct(summary.unpromptedSsr)}`);
console.log(`TTSS  p50 / p90               ${days(summary.ttss.p50)} / ${days(summary.ttss.p90)}`);
```

For the sample, it measures "as of" 30 September 2026, so the numbers don't change depending on the day you run it. Run it:

```bash
npm run report
```

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
```

So what's it telling us?

- 1,614 of 2,000 developers made a call, and 1,428 got a first success. The median developer got there in 52 minutes. The slowest 10% took 69 hours or more.
- 76.7% came back for a second success within 30 days. But only 47.2% came back without a nudge in the 72 hours before. The gap between those two numbers is the most your emails can take credit for. Some of those developers would have come back anyway.
- The median developer came back after 5.4 days.

Remember, these are invented numbers. The point is the shape of the report, not the values.

## Step 7: Finding the Cliffs

The report tells you *how many* developers didn't come back. It doesn't tell you *why*. For that, let's look at the last call each of them made before going quiet. If a lot of developers made the same failing call and then stopped, that error is probably why they left. I call those cliffs.

In the sql folder, create cliffs.sql and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/cliffs.sql):

```sql
-- Where did developers stop? For each group, the last call each developer made,
-- counted by route, status and key mode.
--
--   stalled: reached a first success, but no second one within :horizon
--   never:   made calls but never reached a first success
--
-- Each developer's window starts at their first success (or, for "never", their
-- first call) and lasts :horizon. We look at the last call inside it, and only
-- count developers whose window has closed by :as_of (unix seconds), so people
-- who are still mid-evaluation don't show up as drop-offs.
WITH
successes AS (
  SELECT developer_id, unixepoch(at) AS t
  FROM api_calls
  WHERE status BETWEEN 200 AND 299
    AND route NOT IN (SELECT route FROM excluded_routes)
),
first_success AS (
  SELECT developer_id, MIN(t) AS t FROM successes GROUP BY developer_id
),
returned AS (
  SELECT DISTINCT s.developer_id
  FROM successes s JOIN first_success f ON f.developer_id = s.developer_id
  WHERE s.t >= f.t + :return_gap AND s.t <= f.t + :horizon
),
callers AS (
  SELECT developer_id, MIN(unixepoch(at)) AS first_call FROM api_calls GROUP BY developer_id
),
groups AS (
  SELECT c.developer_id,
         CASE WHEN f.developer_id IS NULL THEN 'never' ELSE 'stalled' END AS cohort,
         COALESCE(f.t, c.first_call) AS window_start
  FROM callers c
  LEFT JOIN first_success f ON f.developer_id = c.developer_id
  WHERE COALESCE(f.t, c.first_call) <= :as_of - :horizon
    AND c.developer_id NOT IN (SELECT developer_id FROM returned)
),
last_calls AS (
  SELECT g.cohort, a.route, a.status, a.key_mode,
         ROW_NUMBER() OVER (PARTITION BY a.developer_id ORDER BY a.at DESC) AS rn
  FROM api_calls a JOIN groups g ON g.developer_id = a.developer_id
  WHERE a.route NOT IN (SELECT route FROM excluded_routes)
    AND unixepoch(a.at) <= g.window_start + :horizon
)
SELECT cohort, route, status, key_mode AS keyMode, COUNT(*) AS developers
FROM last_calls
WHERE rn = 1
GROUP BY cohort, route, status, key_mode
ORDER BY cohort, developers DESC;
```

It splits the developers who didn't come back into two groups. "Stalled" developers had a first success but no second one within 30 days. "Never" developers made calls but never succeeded. Each developer gets a 30-day window, starting from their first success (or their first call, if they never had one). The query finds the last call they made inside that window, and counts those last calls by route, status and key mode. Like the report, it skips anyone whose 30 days aren't up yet.

The `AS keyMode` near the end renames the column, so the rows come back in the same camelCase as the rest of our TypeScript.

In store.ts, add a `Cliff` type below `Journey`:

```ts
export interface Cliff {
  cohort: 'stalled' | 'never';
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  developers: number;
}
```

And one more method at the end of the class:

```ts
  cliffs(asOf: Date, params: Params = DEFAULT_PARAMS): Cliff[] {
    return this.db.prepare(sql('cliffs.sql')).all({
      return_gap: params.returnGap,
      horizon: params.horizon,
      as_of: Math.floor(asOf.getTime() / 1000),
    }) as unknown as Cliff[];
  }
```

That's the last change to store.ts. Here's the whole file, so you can check yours against it (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/store.ts)):

```ts
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');

export interface ApiCall {
  developerId: string;
  at: Date;
  method: string;
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  sdk?: string | null;
}

export interface Params {
  /** Seconds. A success counts as "second" only if it's at least this long after the first. */
  returnGap: number;
  /** Seconds. A nudge this soon before the second success makes it "prompted". */
  nudgeWindow: number;
  /** Seconds after the first success within which a second success counts. */
  horizon: number;
}

export const DEFAULT_PARAMS: Params = {
  returnGap: 24 * 3600,
  nudgeWindow: 72 * 3600,
  horizon: 30 * 86400,
};

export interface Journey {
  developerId: string;
  signedUp: number;
  firstSuccess: number | null;
  secondSuccess: number | null;
  prompted: boolean | null;
}

export interface Cliff {
  cohort: 'stalled' | 'never';
  route: string;
  status: number;
  keyMode: 'test' | 'live';
  developers: number;
}

/** Records what developers do, and asks questions about it. */
export class EventStore {
  readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(sql('schema.sql'));
  }

  addDeveloper(id: string, signedUpAt: Date): void {
    this.db.prepare('INSERT OR IGNORE INTO developers VALUES (?, ?)').run(id, signedUpAt.toISOString());
  }

  recordCall(call: ApiCall): void {
    this.db
      .prepare('INSERT INTO api_calls VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(call.developerId, call.at.toISOString(), call.method, call.route, call.status, call.keyMode, call.sdk ?? null);
  }

  recordNudge(developerId: string, at: Date, kind: string): void {
    this.db.prepare('INSERT INTO nudges VALUES (?, ?, ?)').run(developerId, at.toISOString(), kind);
  }

  transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  journeys(params: Params = DEFAULT_PARAMS): Journey[] {
    const rows = this.db.prepare(sql('journeys.sql')).all({
      return_gap: params.returnGap,
      nudge_window: params.nudgeWindow,
      horizon: params.horizon,
    }) as Array<{ developer_id: string; signed_up: number; first_success: number | null; second_success: number | null; prompted: number | null }>;

    return rows.map((row) => ({
      developerId: row.developer_id,
      signedUp: row.signed_up,
      firstSuccess: row.first_success,
      secondSuccess: row.second_success,
      prompted: row.prompted === null ? null : row.prompted === 1,
    }));
  }

  /** Developers who made at least one API call, successful or not. */
  callers(): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT developer_id) AS n FROM api_calls').get() as { n: number }).n;
  }

  cliffs(asOf: Date, params: Params = DEFAULT_PARAMS): Cliff[] {
    return this.db.prepare(sql('cliffs.sql')).all({
      return_gap: params.returnGap,
      horizon: params.horizon,
      as_of: Math.floor(asOf.getTime() / 1000),
    }) as unknown as Cliff[];
  }
}
```

Finally, in scripts/report.ts, add `const cliffs = store.cliffs(asOf);` right below the `summary` line, and add this to the end of the file:

```ts
for (const cohort of ['stalled', 'never'] as const) {
  const rows = cliffs.filter((c) => c.cohort === cohort);
  const total = rows.reduce((sum, r) => sum + r.developers, 0);
  console.log(`\nLast call within 30 days: ${cohort === 'stalled' ? 'had a first success, but no second one' : 'never reached a first success'} (${total})`);
  for (const row of rows.slice(0, 6)) {
    console.log(`  ${String(row.developers).padStart(4)}  ${pct(row.developers / total).padStart(6)}  ${row.status}  ${row.keyMode.padEnd(4)}  ${row.route}`);
  }
}
```

Run the report again:

```bash
npm run report
```

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

Last call within 30 days: had a first success, but no second one (333)
   120   36.0%  400  test  /v1/webhooks/test
    97   29.1%  422  live  /v1/labels
    45   13.5%  200  test  /v1/webhooks/test
    29    8.7%  200  test  /v1/rates
    23    6.9%  201  test  /v1/labels
    19    5.7%  200  test  /v1/labels/:id

Last call within 30 days: never reached a first success (186)
    95   51.1%  401  test  /v1/rates
    91   48.9%  422  test  /v1/labels
```

There they are! Of the 333 developers who had a first success but no second one, 120 stopped on a failing webhook test. Another 97 came back to go live, got a `422` from a *live* `POST /v1/labels` (the unverified address) and stopped there, just like developer 0001. Those are exactly the two drop-offs I baked into the sample, and the query found both of them without being told where to look.

The rows that end on a 2xx are developers who went quiet without hitting an error. There's no single fix for those. The rows that end on an error are the ones you can do something about. In a real API, you'd go and read your docs for verifying a sender address and testing a webhook, and you'd probably find out why.

The "never" group says something too: half of them stopped on a `401`, which in the sample means they used the wrong key. That's usually a docs problem, or a dashboard that makes the wrong key too easy to copy.

## Drawing It

If you'd rather see this than read it, the finished project has a script that draws the return curve and the cliffs as SVG. If you want it, add `"chart": "node --no-warnings --import tsx scripts/chart.ts"` to your scripts, copy scripts/chart.ts from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/chart.ts), and update report.ts so it saves its results for the chart. Here's the whole file, with a new import at the top and a new block at the bottom (also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/03-time-to-second-success/gists/report.ts)):

```ts
/**
 * Prints TTFS, SSR30, TTSS and the drop-off cliffs for an events database.
 *
 *   npm run report                    # sample.db, as of 2026-09-30
 *   npm run report -- events.db now   # your own events, as of right now
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { summarise } from '../src/metrics';
import { DEFAULT_PARAMS, EventStore } from '../src/store';

const path = process.argv[2] ?? 'sample.db';
const asOf = process.argv[3] === 'now' || path !== 'sample.db' ? new Date() : new Date(Date.UTC(2026, 8, 30));

const store = new EventStore(path);
const summary = summarise(store.journeys(), asOf);
const cliffs = store.cliffs(asOf);

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const hours = (h: number) => (Number.isNaN(h) ? '–' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
const days = (d: number) => (Number.isNaN(d) ? '–' : `${d.toFixed(1)} days`);

console.log(`\n${path}, as of ${asOf.toISOString().slice(0, 10)}`);
console.log(`(return gap ${DEFAULT_PARAMS.returnGap / 3600} h, nudge window ${DEFAULT_PARAMS.nudgeWindow / 3600} h, horizon ${DEFAULT_PARAMS.horizon / 86400} days)\n`);
console.log(`Developers                    ${summary.developers}`);
console.log(`Made at least one call        ${store.callers()}`);
console.log(`Reached a first success       ${summary.reachedFirstSuccess}`);
console.log(`TTFS  p50 / p90               ${hours(summary.ttfs.p50)} / ${hours(summary.ttfs.p90)}`);
console.log(`Eligible for SSR30            ${summary.eligible}`);
console.log(`SSR30                         ${pct(summary.ssr)}`);
console.log(`SSR30, unprompted only        ${pct(summary.unpromptedSsr)}`);
console.log(`TTSS  p50 / p90               ${days(summary.ttss.p50)} / ${days(summary.ttss.p90)}`);

for (const cohort of ['stalled', 'never'] as const) {
  const rows = cliffs.filter((c) => c.cohort === cohort);
  const total = rows.reduce((sum, r) => sum + r.developers, 0);
  console.log(`\nLast call within 30 days: ${cohort === 'stalled' ? 'had a first success, but no second one' : 'never reached a first success'} (${total})`);
  for (const row of rows.slice(0, 6)) {
    console.log(`  ${String(row.developers).padStart(4)}  ${pct(row.developers / total).padStart(6)}  ${row.status}  ${row.keyMode.padEnd(4)}  ${row.route}`);
  }
}

if (path === 'sample.db') {
  mkdirSync('results', { recursive: true });
  writeFileSync('results/sample-report.json', JSON.stringify({ asOf, params: DEFAULT_PARAMS, summary, cliffs }, null, 2) + '\n');
}
```

Then run `npm run report` and `npm run chart`:

![Cumulative share of sample developers with a second success by day: 76.7% with any second success by day 30, 47.2% unprompted.](images/return-curve.svg)

![The last call within 30 days of each of the 333 sample developers with a first success but no second: 120 stopped on a failing webhook test, 97 on a 422 from a live label.](images/cliffs.svg)

Look at the blue line right after day 3: that jump is the nudge email. The orange line, the unprompted one, goes flat for those three days. That's by definition: anyone who comes back within 72 hours of a nudge counts as prompted.

## How It All Works

Let's review the whole pipeline:

1. The middleware records every API call after its response goes out: which account, which route template, which status, test or live.
2. journeys.sql turns those calls into one row per developer: signup, first success, second success, and whether a nudge came right before the second.
3. metrics.ts turns those rows into TTFS, SSR30, unprompted SSR30 and TTSS, only judging developers who've had 30 days to come back.
4. cliffs.sql finds the last call each developer who didn't come back made in their 30-day window, and groups them, so the errors that end the most journeys float to the top.

## Conclusion

In this tutorial, we recorded every call to an API, defined a first and a second success, and built queries that tell us how many developers come back, how long it takes them, and where the ones who don't come back got stuck. Time to first success is still worth tracking. It's just the first half of the story.

If I were rolling this out on a real API, the next things I'd do are:

- Point the middleware at your production traffic (or your API gateway's logs), and run the report weekly.
- Record every nudge you send, so the prompted and unprompted numbers mean something.
- Split the report by SDK. The `sdk` column is already there, and a cliff that only shows up in one SDK is usually a bug in that SDK.

You can find the complete project [here](https://github.com/Ernesto-tha-great/time-to-second-success). If you run into any issues while following along, drop a comment or reach out to me. Thanks for reading!
