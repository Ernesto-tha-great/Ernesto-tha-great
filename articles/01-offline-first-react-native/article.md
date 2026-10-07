# Offline-First React Native: A Failure Taxonomy From Real Network Traces

*Treat every request like checked luggage: tag it, queue it, and make sure it never arrives twice.*

**By Ernest Nnamdi** · React Native, TypeScript, Networking · ~20 min read

> **Quick summary:** "Offline-first" usually means "we cache some reads". The hard part is writes. In this tutorial we build a small, durable request queue for React Native. It persists every write before telling the user "Saved", tags each one with an idempotency key, refuses to trust NetInfo, backs off with jitter, and copes with batches that half succeed. Then we replay four network traces against it, and against three simpler strategies, to see which failures each one survives.
>
> **Companion code:** [`checked-luggage`](./code), with the library, a demo API, the trace simulator and an Expo example. Every snippet below comes from it.

---

## Table of contents

1. [The bug report every mobile team gets](#the-bug-report-every-mobile-team-gets)
2. [The checked-luggage model](#the-checked-luggage-model)
3. [A failure taxonomy for mobile writes](#a-failure-taxonomy-for-mobile-writes)
4. [What we're building](#what-were-building)
5. [Step 1: Check in before you say "Saved"](#step-1-check-in-before-you-say-saved)
6. [Step 2: Tag every bag](#step-2-tag-every-bag)
7. [Step 3: Don't trust NetInfo](#step-3-dont-trust-netinfo)
8. [Step 4: Back off like you mean it](#step-4-back-off-like-you-mean-it)
9. [Step 5: Batches that half succeed](#step-5-batches-that-half-succeed)
10. [Step 6: Survive suspension and the app being killed](#step-6-survive-suspension-and-the-app-being-killed)
11. [Step 7: Wire it into the app](#step-7-wire-it-into-the-app)
12. [Replaying network traces](#replaying-network-traces)
13. [Results](#results)
14. [Trade-offs and what this doesn't solve](#trade-offs-and-what-this-doesnt-solve)
15. [Further reading](#further-reading)

---

## The bug report every mobile team gets

<!-- If you have a real story here, use it. A specific bug you shipped beats any general opener. -->

Sooner or later, every team that ships a mobile app with a "Save" button gets one of two bug reports:

- **"I placed the order and it never showed up."**
- **"I placed the order once and got charged twice."**

They look like opposite bugs, but they share a cause. In both cases the app treated the network as a function call: send the request, get an answer. On a phone, the network is closer to a postal service run by someone having a bad week. Requests vanish in tunnels. Responses vanish on the way back. Hotel Wi-Fi answers every request with a cheerful `200 OK` and a login page. And iOS will happily freeze your app halfway through a retry loop, then kill it to free memory.

Most "offline-first" advice focuses on reads: cache the data and show something while the network sulks. Writes are harder, because a write has to happen **exactly once**, and the network gives you no way to know whether it already has.

This tutorial is about writes.

## The checked-luggage model

Airlines solved this problem decades ago, with luggage.

| Luggage | Request queue |
|---|---|
| You check the bag in and get a receipt | The request is written to disk *before* the UI says "Saved" |
| The bag gets a tag with a unique number | The request gets an idempotency key |
| It missed its flight? It goes on the next one | Failed sends are retried, with backoff |
| Bags travel together in the hold | Requests are sent in batches |
| The destination checks tags, so a bag is never delivered twice | The server checks the key before doing the work |
| Unclaimable bags go to the lost-luggage desk | Requests the server rejects go to a dead-letter handler |

**Where the analogy breaks:** a retry doesn't move the bag. It *copies* it. If the first copy already arrived, only the tag tells the server it's looking at a duplicate. That one difference is why the tag matters more than anything else in this article.

## A failure taxonomy for mobile writes

Before writing any code, it helps to name the failures. Here are the eight I designed the queue around. The column that matters most is the third one: what NetInfo, React Native's standard connectivity library, reports while each failure is happening.

| # | Failure | NetInfo says | What a naive client does | The fix |
|---|---|---|---|---|
| 1 | **Total loss**: a tunnel or flight mode | offline | Shows an error. The write is gone unless the user retypes it | Persist before sending (Step 1) |
| 2 | **Lost response**: the server did the work, the reply died | online | Retries and creates a **duplicate** | Idempotency keys (Step 2) |
| 3 | **Captive portal**: hotel or conference Wi-Fi | online | Reads a `200 OK` HTML page as success, or burns retries | Probe and validate content (Step 3) |
| 4 | **Black hole**: one bar of signal, or a SIM over its data cap | online | Waits for a timeout, again and again | Probe with a short timeout and back off (Steps 3–4) |
| 5 | **Thundering herd**: everyone reconnects at once | online | Retries on the same schedule as every other phone | Full jitter (Step 4) |
| 6 | **Partial batch**: three items succeed, two fail | online | Retries all five, or none | Per-item verdicts (Step 5) |
| 7 | **Poison request**: the server will never accept it | online | Retries forever | Dead-letter on server rejection (Step 5) |
| 8 | **Suspension and kill**: iOS freezes the app, then reclaims it | n/a | Loses everything held in memory | Persisted schedule plus lifecycle hooks (Step 6) |

Notice how many rows say "online". NetInfo isn't broken. It answers a different question ("is there a network interface?") from the one you care about ("will my request reach my server?").

## What we're building

![Architecture of the checked-luggage queue: enqueue writes a tagged request to storage; a scheduler triggers flush, which probes the server, sends tagged batches and applies per-item verdicts; the server checks each tag before doing the work.](./images/architecture.svg)

There are three moving parts:

1. **`OfflineQueue`**, a small TypeScript class with no React Native dependencies. It owns persistence, scheduling, batching and verdicts.
2. **A server contract:** `POST /batch` takes tagged items and returns one verdict per item. `GET /generate_204` answers `204 No Content` for the reachability probe.
3. **A scheduler** in the app. It calls `flush()` when the app comes to the foreground, when NetInfo reports a change, and when the queue says its next item is due.

Here's the project layout:

```text
checked-luggage/
├── src/
│   ├── queue.ts            # OfflineQueue
│   ├── http-transport.ts   # POST /batch, with failure classification
│   ├── probe.ts            # GET /generate_204
│   ├── backoff.ts          # full jitter
│   └── storage.ts          # AsyncStorage / MMKV adapter
├── server/                 # demo orders API that honours tags
├── sim/                    # network simulator + traces
├── bench/                  # replays traces, renders the chart
├── test/                   # unit + end-to-end tests
└── example/                # Expo app
```

To follow along:

```bash
git clone <repo> && cd checked-luggage
npm install
npm test
```

## Step 1: Check in before you say "Saved"

The most important line in the whole queue is an `await` you might be tempted to skip:

```ts
// src/queue.ts
async enqueue(request: NewRequest): Promise<QueuedRequest> {
  await this.ready();
  const now = this.now();
  const item: QueuedRequest = {
    ...request,
    id: this.createId(),      // the luggage tag
    createdAt: now,
    attempts: 0,
    serverRetries: 0,
    nextAttemptAt: now,       // due immediately
  };
  this.items.push(item);
  await this.persist();       // on disk before we resolve
  return item;
}
```

`enqueue()` resolves only after the request is on disk. That gives the UI a clear contract: when the promise resolves, it's safe to say "Saved", because the request will survive a tunnel, a crash or a force-quit.

Storage is deliberately boring. The whole queue is stored as **one JSON value under one key**, so every write replaces the queue in a single operation:

```ts
// src/storage.ts
export function createKeyValueStorage(kv: KeyValueStore, key = 'checked-luggage/v1'): QueueStorage {
  return {
    async load() {
      const raw = await kv.getItem(key);
      return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
    },
    async save(items) {
      await kv.setItem(key, JSON.stringify(items));
    },
  };
}
```

AsyncStorage's `getItem` and `setItem` already match this interface. For MMKV, a two-line wrapper does the job.

One subtle bug is worth guarding against: two saves racing each other. Say `enqueue()` and `flush()` both call `persist()`, and the older snapshot finishes writing last. It overwrites the newer one, and a request quietly disappears. The fix is to chain the writes:

```ts
// src/queue.ts
private persist(): Promise<void> {
  const snapshot = this.items.map((item) => ({ ...item }));
  this.writeChain = this.writeChain.then(() => this.options.storage.save(snapshot));
  return this.writeChain;
}
```

> **Tip:** Keep the queue small and boring. A queue that holds thousands of items is a sync engine, and that's a different article. If yours grows that large, move it to SQLite, with one row per item.

## Step 2: Tag every bag

Here's failure #2 from the taxonomy, drawn out:

![Sequence diagram. Without a tag, a lost response makes the phone retry and the server creates a second order. With a tag, the server recognises the retry and returns the stored verdict without creating a new order.](./images/lost-response.svg)

From the phone's side, a lost request and a lost response look identical: a timeout. The phone has no way to tell them apart. Only the server can, and only if the request carries something that identifies it across retries. That's the idempotency key: a random ID generated **once, when the request is created**, and reused on every retry.

On the client, it's the `id` from Step 1. On the server, the rule is simple:

> **Check the tag *before* doing the work, and store the tag *together with* the work.**

```ts
// server/core.ts
if (this.options.honourIdempotencyKeys) {
  const previous = this.processed.get(item.id);
  if (previous) return previous; // a copy of a bag we already delivered
}

// In production, insert the idempotency key and the order in ONE transaction,
// with a unique constraint on the key. The Map plays that role here.
this.executions.push({ key: item.id, actionId, at: this.now() });

const result: ItemResult = { id: item.id, status: 'delivered' };
if (this.options.honourIdempotencyKeys) this.processed.set(item.id, result);
return result;
```

The demo uses a `Map`. In Postgres, the same idea looks like this:

```sql
CREATE TABLE idempotency_keys (
  key        uuid PRIMARY KEY,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

BEGIN;
-- If two copies arrive at once, the second insert waits for the first transaction,
-- then inserts nothing.
INSERT INTO idempotency_keys (key, result)
VALUES ($1, '{"status":"delivered"}')
ON CONFLICT (key) DO NOTHING;

-- If that inserted 0 rows, this is a copy: ROLLBACK and return the stored result.
-- Otherwise, do the real work in the same transaction:
INSERT INTO orders (sku, qty) VALUES ($2, $3);
COMMIT;
```

Putting the key and the order in the same transaction is the whole trick. If the order insert fails, the key goes with it, so the retry gets a real second chance instead of a stored "success" for work that never happened.

You can watch this happen over real HTTP. The test suite starts the demo API with `dropResponseRate: 0.5` and a random source that drops the *first* response:

```ts
// test/http.test.ts
it('creates a duplicate order when the server ignores the tag', async () => {
  const { service } = await deliverOneOrderThroughALostResponse(false);
  assert.equal(service.executions.length, 2, 'the same order was placed twice');
});

it('places the order exactly once when the server honours the tag', async () => {
  const { service } = await deliverOneOrderThroughALostResponse(true);
  assert.equal(service.executions.length, 1);
});
```

> **Note:** For single requests, the IETF's draft [`Idempotency-Key` header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) is the standard place to put the key. We send batches, so each item carries its own `id` in the body instead.

React Native has no `crypto.randomUUID()` out of the box, so pass one in. The example uses `expo-crypto`:

```ts
createId: () => Crypto.randomUUID(),
```

## Step 3: Don't trust NetInfo

NetInfo tells you whether the phone has a network interface. Failures #3 and #4 both happen with the interface up. So before sending a batch, the queue asks your own server something tiny:

```ts
// src/probe.ts
export function createReachabilityProbe(options: ProbeOptions): () => Promise<Reachability> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(options.url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
      // Followed or not, a redirect or a 200 login page both mean "not our server".
      return res.status === 204 ? 'online' : 'captive-portal';
    } catch {
      return 'offline';
    } finally {
      clearTimeout(timer);
    }
  };
}
```

This is the same trick Android uses for its own connectivity check. A `204 No Content` is hard to fake by accident. A captive portal either redirects you or serves its login page with a `200`, and both fail the check.

The transport makes the same check from a different angle. A response only counts if it's the JSON you expected:

```ts
// src/http-transport.ts
const contentType = res.headers.get('content-type') ?? '';
if (!contentType.includes('application/json')) {
  // A hotel Wi-Fi login page is a 200 OK too. Never trust a status code alone.
  throw new TransportError('captive-portal', `expected JSON, got ${res.status} ${contentType}`);
}
```

The most important design decision lives in `flush()`. **When the probe fails, no attempt is burned:**

```ts
// src/queue.ts
const heardRecently = this.now() - this.lastHeardFromServer < this.probeFreshnessMs;
if (this.options.probe && !heardRecently) {
  report.reachability = await this.options.probe();
  if (report.reachability !== 'online') {
    // The airport is closed. That isn't the luggage's fault, so no item
    // attempt is burned. The queue backs off its *checks* instead.
    this.probeFailures++;
    const delay = fullJitterDelay(this.probeFailures, this.baseDelayMs, this.maxDelayMs, this.random);
    this.notBefore = this.now() + Math.max(this.baseDelayMs, delay);
    return report;
  }
  // ...reset the probe backoff and carry on
}
```

Two details here came out of testing:

- **The probe costs a round trip.** On high-latency networks that is real time, so the queue skips the probe if the server answered anything in the last 30 seconds (`probeFreshnessMs`). On the conference Wi-Fi trace, this brought the median delivery time down from 2.8 s to 1.4 s, level with the strategies that don't probe at all.
- **Offline time shouldn't count against an item.** If every failed send while offline increased the item's backoff, a 10-minute tunnel would leave items waiting 60 seconds between tries *after* the train leaves. Backing off the probe instead keeps the item's own schedule fresh.

## Step 4: Back off like you mean it

When a train leaves a tunnel, every phone on it reconnects within the same second. If they all retry on the same exponential schedule (1 s, 2 s, 4 s…), they hit your API in synchronised waves. The fix is **full jitter**: pick a random delay between zero and the exponential ceiling.

```ts
// src/backoff.ts
export function fullJitterDelay(attempt: number, baseMs: number, capMs: number, random = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}
```

Marc Brooker's AWS write-up (linked in [Further reading](#further-reading)) compares the jitter variants. Full jitter does about as well as anything else at spreading load, and it's the simplest.

If the server asks for a pause with `Retry-After`, that wins over the random delay:

```ts
// src/queue.ts
private scheduleRetry(item: QueuedRequest, reason: string, minDelayMs = 0): void {
  item.attempts++;
  const delay = fullJitterDelay(item.attempts, this.baseDelayMs, this.maxDelayMs, this.random);
  item.nextAttemptAt = this.now() + Math.max(delay, minDelayMs);
  item.lastError = reason;
}
```

Notice `nextAttemptAt` is a **timestamp stored on the item**, not a `setTimeout`. That matters in Step 6.

## Step 5: Batches that half succeed

Sending one request per item is simple, but on a slow link each request pays the full round trip. So the queue sends batches of up to 20 (`maxBatchSize`), and the server answers with **one verdict per item**:

```json
{
  "results": [
    { "id": "7f3a…", "status": "delivered" },
    { "id": "91c0…", "status": "retry", "reason": "inventory service busy" },
    { "id": "c44e…", "status": "rejected", "reason": "unknown sku" }
  ]
}
```

Each verdict sends the item down a different path:

![State diagram. Queued goes to In flight when due and online. In flight goes to Delivered, to Waiting on a network failure or retry verdict, or to Dead letter when rejected or retried too often. Waiting returns to Queued when its backoff expires. A failed probe keeps the item Queued without burning an attempt.](./images/item-lifecycle.svg)

In code:

```ts
// src/queue.ts
const verdicts = new Map(results.map((result) => [result.id, result]));
for (const item of batch) {
  const verdict: ItemResult = verdicts.get(item.id) ?? {
    id: item.id,
    status: 'retry',
    reason: 'missing from batch response',
  };

  if (verdict.status === 'delivered') {
    this.remove(item);
    report.delivered++;
  } else if (verdict.status === 'rejected') {
    this.deadLetter(item, verdict.reason);
    report.deadLettered++;
  } else {
    item.serverRetries++;
    if (item.serverRetries >= this.maxServerRetries) {
      this.deadLetter(item, `server asked for ${item.serverRetries} retries: ${verdict.reason}`);
      report.deadLettered++;
    } else {
      this.scheduleRetry(item, verdict.reason);
      report.retrying++;
    }
  }
}
```

Three rules are hiding in that block:

1. **A missing verdict means "retry", never "delivered".** If the server forgets an item, assume it didn't happen. The tag makes it safe to send it again.
2. **Only the server can dead-letter an item.** Network failures (thrown `TransportError`s) back off forever. Five rejections from the server end it. A request should never go to the lost-luggage desk just because the airport was closed.
3. **When a batch fails at the network level, stop.** If batch one timed out, don't fire batches two to five into the same black hole:

```ts
} catch (err) {
  for (const item of batch) this.scheduleRetry(item, describe(err), retryAfterMs);
  this.lastHeardFromServer = 0; // whatever we knew about the network is stale now
  await this.persist();
  break;
}
```

Dead-lettered items are handed to `onDeadLetter`. **Show them to the user.** A silently dropped order is worse than an error message.

## Step 6: Survive suspension and the app being killed

Failure #8 is the one most hand-rolled retry loops miss. When the user locks the phone, iOS suspends your JavaScript. Timers stop. If memory runs short, the OS kills the app without warning. Whatever lived only in memory, including your retry loop and its pending requests, is gone.

The queue survives this because of two choices already made:

- Every item is **on disk** (Step 1).
- Every item's schedule is a **persisted timestamp**, `nextAttemptAt` (Step 4), not a timer.

So a timer is only a nudge. If it fires late, or never, nothing is lost. The next time the app comes to the foreground, `flush()` sends whatever is due. The scheduler hook wires that up:

```ts
// example/src/useOfflineQueue.ts
const flushAndReschedule = useCallback(async () => {
  if (timer.current) clearTimeout(timer.current);
  await queue.flush();
  await refresh();

  const wakeAt = queue.nextWakeAt();
  if (wakeAt !== null) {
    // A timer is only a nudge. If iOS suspends the app, it fires late or not at
    // all. The persisted nextAttemptAt keeps the schedule honest either way.
    timer.current = setTimeout(flushAndReschedule, Math.max(0, wakeAt - Date.now()));
  }
}, [refresh]);

useEffect(() => {
  void flushAndReschedule();

  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushAndReschedule();
  });

  // NetInfo is a hint that *something* changed, not proof that requests will work.
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) void flushAndReschedule();
  });

  return () => {
    appState.remove();
    unsubscribe();
    if (timer.current) clearTimeout(timer.current);
  };
}, [flushAndReschedule]);
```

`flush()` is also **single-flight**. If the AppState listener, the NetInfo listener and the timer all fire at the same moment, they share one flush instead of sending the same batch three times:

```ts
flush(): Promise<FlushReport> {
  this.inFlight ??= this.doFlush().finally(() => {
    this.inFlight = null;
  });
  return this.inFlight;
}
```

> **What about syncing in the background?** Both platforms offer scheduled background work: BGTaskScheduler on iOS and WorkManager on Android. Expo wraps them in a background-task module. It's worth adding, but treat it as a bonus. The OS decides when (and whether) your task runs, often no more than every 15 minutes. The foreground path above has to be correct on its own.

## Step 7: Wire it into the app

With the queue and the hook in place, the screen itself is almost boring, which is the point:

```tsx
// example/App.tsx
const { pending, submit } = useOfflineQueue();

const onSave = async () => {
  await submit({ method: 'POST', path: '/orders', body: { sku, qty: Number(qty) } });
  // Safe to say, because enqueue() only resolves once the order is on disk.
  setMessage('Saved. It will sync when the network lets it.');
};

// ...
<View style={[styles.badge, pending > 0 ? styles.badgeWaiting : styles.badgeClear]}>
  <Text style={styles.badgeText}>
    {pending === 0 ? 'Everything synced' : `${pending} waiting to send`}
  </Text>
</View>
```

The queue lives in its own module, so the whole app shares **one instance**. Two queues writing to the same storage key would overwrite each other's snapshots:

```ts
// example/src/queue.ts
export const queue = new OfflineQueue({
  storage: createKeyValueStorage(AsyncStorage),
  transport: createHttpTransport({ baseUrl: API_URL }),
  probe: createReachabilityProbe({ url: `${API_URL}/generate_204` }),
  createId: () => Crypto.randomUUID(),
  onDeadLetter: (item, reason) => {
    console.warn(`Could not deliver ${item.path} (${item.id}): ${reason}`);
  },
});
```

The example README walks through running it against the demo API, including how to make the server drop responses (`DROP_RESPONSE_RATE=0.5`) and ignore tags (`IGNORE_KEYS=1`), so you can watch duplicates appear and disappear on a real device.

## Replaying network traces

Unit tests prove each rule in isolation. They can't tell you how the rules behave together over twenty minutes of a bad network. For that, the repo has a small, deterministic network simulator.

### Describing a network

A trace is a timeline of link states, plus app lifecycle events:

```json
{
  "name": "underground-commute",
  "source": "synthetic",
  "segments": [
    { "seconds": 90,  "state": "up", "latencyMs": 120 },
    { "seconds": 150, "state": "down" },
    { "seconds": 20,  "state": "up", "latencyMs": 900, "lossRate": 0.4 },
    { "seconds": 60,  "state": "blackhole" }
  ],
  "events": [
    { "at": 640, "type": "suspend" },
    { "at": 700, "type": "kill" },
    { "at": 760, "type": "resume" }
  ]
}
```

Four states cover the taxonomy:

| State | Meaning | Taxonomy row |
|---|---|---|
| `up` | packets flow, with optional latency and loss | 2, 5, 6 |
| `down` | no interface; requests fail instantly | 1 |
| `blackhole` | looks connected, nothing comes back; requests time out | 4 |
| `captive` | every request gets an HTML login page with a `200` | 3 |

The detail that makes the simulator useful is how it treats loss on an `up` link. Half of the lost exchanges lose the **request**, so the server never sees it. The other half lose the **response**, after the server has done the work:

```ts
// sim/network.ts
const roll = this.random();
if (roll < loss / 2) {
  // Lost on the way out: the server never sees it.
  this.clock.advance(this.requestTimeoutMs);
  return { ok: false, kind: 'timeout' };
}
this.clock.advance(latency);
const value = serve();
if (roll < loss) {
  // Lost on the way back: the work is done, the phone doesn't know.
  this.clock.advance(this.requestTimeoutMs - latency);
  return { ok: false, kind: 'timeout' };
}
```

Time is simulated (`SimClock`) and randomness is seeded, so 400 runs finish in under a second and every run is reproducible.

### Four strategies

The benchmark replays every trace against four ways of sending the same user actions:

| Strategy | What it does |
|---|---|
| **Fire and forget** | `fetch()` on tap. If it fails, show an error |
| **Retry in memory** | the hand-rolled classic: exponential backoff, held in memory, no keys |
| **Durable queue, no tags** | this article's queue with persistence and jitter, but no idempotency keys and no probe |
| **Checked luggage** | the full queue: persisted, tagged, batched, probed |

### The traces

The repo ships four **synthetic** traces. Each is modelled on a common real-world pattern, and each stresses a different row of the taxonomy:

- **Underground commute (20 min):** stations, tunnels, weak platform edges, one "full bars, no data" stretch. The phone is pocketed twice, and the OS kills the app the second time.
- **Office lift (6 min):** 45 seconds of black hole, then a weak signal as the doors open.
- **Conference Wi-Fi (15 min):** a captive portal for four minutes, then a congested network with 15% loss.
- **SIM over its data cap (15 min):** nine minutes of black hole while NetInfo reports a connection.

<!-- TODO before publishing: record your own traces (or convert a public dataset such as Riiser et al.'s 3G commute traces) and re-run `npm run bench -- path/to/traces`. Replace the synthetic numbers below with recorded ones, or keep both and label them clearly. -->

To run your own:

```bash
npm run bench                       # synthetic fixtures
npm run bench -- ./my-traces        # your own JSON traces
npm run chart                       # regenerate images/results.svg
```

## Results

![Small multiples, one per trace, each with a 100% stacked bar per strategy showing the share of actions delivered exactly once, duplicated or lost. Checked luggage delivers 100% exactly once on all four traces.](./images/results.svg)

*Synthetic traces, 25 seeded runs per trace and strategy.*

| Trace | Fire and forget | Retry in memory | Durable, no tags | Checked luggage |
|---|---|---|---|---|
| Underground commute | 64.5% lost | 23.7% lost, 2.5% duplicated | 5.6% duplicated | **100% exactly once** |
| Conference Wi-Fi | 33.0% lost | 8.3% duplicated | 7.6% duplicated | **100% exactly once** |
| Office lift | 14.3% lost | 2.1% duplicated | 3.0% duplicated | **100% exactly once** |
| SIM over data cap | 52.7% lost | 100% exactly once | 100% exactly once | **100% exactly once** |

Four things stand out.

**1. Retries without persistence trade one bug for another.** On the commute, retrying in memory cut losses from 64.5% to 23.7%. The remaining losses are almost all the OS kill: everything held in memory went with the process.

**2. Persistence without tags just moves the bug.** The durable queue without keys lost nothing on any trace, but it duplicated 3–8% of orders wherever the network dropped responses. Those are your "charged twice" bug reports.

**3. The data-cap trace is the control.** A black hole never delivers anything, so it never loses a response either. With no lost responses there's nothing to duplicate, and every retrying strategy scores 100%. Duplicates come from *partial* failure, not from being offline.

**4. The probe pays for itself on long outages.** On the commute, the full queue's median delivery time was 52.2 s, against 70.2 s for the durable queue without a probe. Without the probe, every failed send during the tunnels increased the item's backoff, so items were still waiting long after the train reached a station. The cost shows up on the data-cap trace: there, the probe's extra round trip made the full queue's median 29.9 s, against 25.7 s for the queue without one.

> **Caveat:** these are synthetic traces. They model real patterns, but they aren't recordings. The simulator also makes simplifications: requests in a batch are sequential, and a segment change mid-request is ignored. Treat the numbers as a comparison between strategies under identical conditions, not as predictions for your users. The harness takes recorded traces unchanged, so if you can record your users' networks, do.

## Trade-offs and what this doesn't solve

- **Ordering.** Items are sent in queue order, but a retried item can land after a newer one. If order matters (a "create" followed by an "update"), either send dependent writes as one request or have the server reject out-of-order updates with a version number.
- **Conflicts.** This queue makes sure a write *arrives* exactly once. It doesn't decide what happens when two devices edit the same record offline. That's the territory of last-writer-wins, version vectors and CRDTs.
- **Storage limits and privacy.** Queued requests can contain personal data, and they sit on the device until delivered. Encrypt the storage if they're sensitive, cap the queue's size, and decide what to do when the cap is reached.
- **Key retention.** The server must remember keys at least as long as a client might retry. With a 60 s backoff cap and a phone that can sit in a drawer for a week, that's longer than you think. Seven days is a common choice.
- **Batch size.** Twenty items keeps each request small enough to finish on a weak link. On a reliable network, bigger batches are cheaper. Measure on yours.

## Conclusion

Every write from a phone needs four guarantees: it's on disk before the user is told it's saved, it carries a tag the server checks, the app finds out whether the server is really reachable before spending retries, and the retry schedule is stored rather than held in a timer. Get those right and both of the bug reports from the start of this article go away.

The library, the server, the simulator and the traces are all in the [companion repo](./code). The most useful contribution you could make is a recorded trace from a network that breaks your app.

## Further reading

- Marc Brooker, ["Exponential Backoff And Jitter"](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/), AWS Architecture Blog, 2015
- Brandur Leach, ["Implementing Stripe-like Idempotency Keys in Postgres"](https://brandur.org/idempotency-keys), 2017
- IETF HTTPAPI working group, [The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) (Internet-Draft)
- Riiser, Vigmostad, Griwodz and Halvorsen, "Commute Path Bandwidth Traces from 3G Networks: Analysis and Applications", ACM MMSys 2013. These are public, recorded commute traces you can convert for the harness.
- Netravali et al., "Mahimahi: Accurate Record-and-Replay for HTTP", USENIX ATC 2015. Use it to replay traces against a real device or emulator, not just the simulator.
- [`@react-native-community/netinfo`](https://github.com/react-native-netinfo/react-native-netinfo): read what `isConnected` and `isInternetReachable` actually promise
