# Offline-First React Native: Building a Write Queue That Survives Bad Networks

*Treat every request like checked luggage: tag it, queue it, and make sure it never arrives twice.*

**Ernest Nnamdi** · React Native · TypeScript · Networking

---

A while back I built a small order-taking app for a sales team. It worked perfectly on my desk, which, in hindsight, is the least interesting place a mobile app will ever run.

The first bug report was a screenshot from a train: two identical orders, same customer, same minute. The second, from a different rep that same week, was an order that never showed up at all. Opposite bugs, same app. I spent a weekend convinced the backend was haunted.

Reader, the backend was not haunted. The phone was doing exactly what phones do on trains, and my code was treating the network like a function call: send a request, get an answer. On a phone, the network behaves more like a postal service run by someone having a bad week. Requests vanish in tunnels. *Responses* vanish on the way back. Hotel Wi-Fi answers everything with a cheerful `200 OK` and a login page. And iOS will happily freeze your app halfway through a retry loop, then kill it to free up memory.

Most "offline-first" advice is about reads: cache the data and show something while the network sulks. Writes are the harder half, because a write has to happen **exactly once**, and the network gives you no way of knowing whether it already did.

So this article is about writes. We're going to build a small write queue for React Native, called `checked-luggage`. Then we'll run it, and three simpler approaches, through a simulator that recreates the kinds of bad networks your users walk into every day, to see which approach survives what.

Everything here is in the companion repo, [**github.com/Ernesto-tha-great/checked-luggage**](https://github.com/Ernesto-tha-great/checked-luggage), and every snippet below is lifted from it.

## The airline already solved this

Airlines figured this problem out decades ago, with luggage.

When you check a bag, you get a receipt before the bag goes anywhere. The bag gets a tag with a unique number. If it misses its flight, it goes on the next one. Bags travel together in the hold. At the other end, the tag means a bag can't be delivered to you twice. And if something can't be delivered at all, it ends up at the lost-luggage desk, not in a skip behind the terminal.

Swap "bag" for "request" and you have the whole design:

- **The receipt:** the request is written to disk *before* the UI says "Saved".
- **The tag:** every request gets an idempotency key when it's created, and keeps it through every retry.
- **The next flight:** failed sends are retried with backoff.
- **The hold:** requests travel in batches.
- **The tag check:** the server looks at the key *before* doing the work.
- **The lost-luggage desk:** requests the server refuses go to a dead-letter handler, where the user can see them.

The analogy breaks in one place, and it's the place that matters. A retry doesn't *move* the bag. It **copies** it. If the first copy already arrived, the tag is the only thing that tells the server it's looking at a duplicate. Keep that in your head; it's the reason Step 2 exists.

## Eight ways a write goes wrong

Before writing any code, I find it helps to name the failures. These are the eight I designed the queue around. Pay attention to the second column, which shows what NetInfo, React Native's go-to connectivity library, reports while each one is happening.

| # | Failure | NetInfo says | What a naive client does |
|---|---|---|---|
| 1 | **Total loss** (tunnel, flight mode) | offline | Shows an error; the write is gone unless the user retypes it |
| 2 | **Lost response** (the server did the work, the reply died) | online | Retries and creates a **duplicate** |
| 3 | **Captive portal** (hotel or conference Wi-Fi) | online | Treats a `200 OK` login page as success, or burns its retries |
| 4 | **Black hole** (one bar of signal, or a SIM out of data) | online | Waits for a timeout, again and again |
| 5 | **Thundering herd** (a whole train reconnects at once) | online | Retries on the same schedule as every other phone |
| 6 | **Partial batch** (three items succeed, two fail) | online | Retries all five, or none |
| 7 | **Poison request** (the server will never accept it) | online | Retries forever |
| 8 | **Suspend, then kill** (iOS freezes the app, then reclaims it) | – | Loses everything it was holding in memory |

Count the "online"s. NetInfo isn't lying to you. It's answering a different question ("does this phone have a network interface?") from the one you care about ("will my request reach my server?"). The fixes below map onto these rows, and I'll point back to them as we go.

## What we're building

![Architecture of the checked-luggage queue: enqueue writes a tagged request to storage; a scheduler triggers flush, which probes the server, sends tagged batches and applies per-item verdicts; the server checks each tag before doing the work.](./images/architecture.svg)

There are three pieces:

1. **`OfflineQueue`**, a small TypeScript class with no React Native dependencies. It handles persistence, scheduling, batching and the server's verdicts.
2. **A server contract.** `POST /batch` takes tagged items and returns one verdict per item, and `GET /generate_204` replies `204 No Content` so the app can check it's really talking to your server. The repo includes a demo server that does both.
3. **A scheduler** in the app that calls `flush()` when the app comes to the foreground, when NetInfo reports a change, and when the queue says something is due.

To follow along you'll need Node 20 or newer. A phone with Expo Go is optional; you only need it for the last step.

```bash
git clone https://github.com/Ernesto-tha-great/checked-luggage.git
cd checked-luggage
npm install
npm test        # 19 tests, a couple of them over real HTTP
```

## Step 1: Check in before you say "Saved"

The most important line in the whole queue is an `await` you'll be tempted to skip:

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
    nextAttemptAt: now,       // due straight away
  };
  this.items.push(item);
  await this.persist();       // on disk before we resolve
  return item;
}
```

`enqueue()` doesn't resolve until the request is on disk. That gives the UI a simple rule: when the promise resolves, it's safe to say "Saved", because that order will survive a tunnel, a crash or a force-quit. This is row 1 of the table, handled.

Storage is deliberately boring. The whole queue lives under **one key** as one JSON string, so every save replaces it in one go:

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

AsyncStorage already has `getItem` and `setItem`, so it plugs straight in. MMKV needs a two-line wrapper.

There's one sneaky bug to guard against: two saves racing each other. If `enqueue()` and `flush()` both save, and the *older* snapshot happens to finish writing last, it overwrites the newer one and a request quietly vanishes. (Ask me how I know.) The fix is to chain the writes, so they always land in the order they were made:

```ts
// src/queue.ts
private persist(): Promise<void> {
  const snapshot = this.items.map((item) => ({ ...item }));
  this.writeChain = this.writeChain.then(() => this.options.storage.save(snapshot));
  return this.writeChain;
}
```

If your queue ever holds thousands of items, you've built a sync engine, and you should move it to SQLite with one row per item. For a queue of pending writes, a single key is fine.

## Step 2: Tag every bag

This is the bug from that train screenshot, drawn out:

![Sequence diagram. Without a tag, a lost response makes the phone retry and the server creates a second order. With a tag, the server recognises the retry and returns the stored verdict without creating a new order.](./images/lost-response.svg)

From the phone's side, a lost request and a lost response look exactly the same: a timeout. The phone can't tell them apart. Only the server can, and only if every request carries something that stays the same across retries. That's the idempotency key: a random ID generated **once, when the request is created**, and sent again on every retry.

On the client, it's the `id` from Step 1. On the server, there's one rule:

> Check the tag *before* doing the work, and save the tag *together with* the work.

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

The demo server uses a `Map` to keep things readable. In Postgres it looks like this:

```sql
CREATE TABLE idempotency_keys (
  key        uuid PRIMARY KEY,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

BEGIN;
-- If two copies arrive together, the second insert waits for the first
-- transaction to finish, then inserts nothing.
INSERT INTO idempotency_keys (key, result)
VALUES ($1, '{"status":"delivered"}')
ON CONFLICT (key) DO NOTHING;

-- 0 rows inserted? It's a copy: ROLLBACK and return the stored result.
-- Otherwise, do the real work in the same transaction.
INSERT INTO orders (sku, qty) VALUES ($2, $3);
COMMIT;
```

The key and the order living in the *same* transaction is the whole trick. If the order insert fails, the key is rolled back with it, so the retry gets a real second chance instead of a stored "success" for work that never happened. Brandur Leach's write-up on Stripe-style idempotency keys (linked at the end) goes much deeper on this, and it's worth your evening.

You don't have to take my word for any of this. The test suite starts the demo server, makes it drop the *first* response on the floor, and checks what happens:

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

Two small notes. If you're sending one request at a time rather than batches, the IETF's draft `Idempotency-Key` header is the standard place to put the key. And React Native doesn't ship `crypto.randomUUID()`, so pass in your own ID generator; the example app uses `expo-crypto`.

## Step 3: Don't trust NetInfo

Rows 3 and 4 both happen with the network interface up, so NetInfo can't help you there. Instead, before sending a batch, the queue asks *your own server* something tiny:

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

I borrowed this trick from Android, which checks its own connectivity the same way. A `204 No Content` is hard to fake by accident. A captive portal either redirects you or serves its login page with a `200`, and both fail the check.

The transport is just as suspicious. A response only counts if it's the JSON we asked for:

```ts
// src/http-transport.ts
const contentType = res.headers.get('content-type') ?? '';
if (!contentType.includes('application/json')) {
  // A hotel Wi-Fi login page is a 200 OK too. Never trust a status code alone.
  throw new TransportError('captive-portal', `expected JSON, got ${res.status} ${contentType}`);
}
```

The decision I'm proudest of lives in `flush()`. **When the probe fails, no attempt is burned:**

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
  // ...reset the probe's backoff and carry on
}
```

Two details in there came straight out of testing:

- **The probe costs a round trip.** On a slow network that's real time, so the queue skips it if the server has answered anything in the last 30 seconds (`probeFreshnessMs`). On the simulated conference Wi-Fi, that one change cut the median delivery time from 2.8 s to 1.4 s, the same as approaches that never probe at all.
- **Time offline shouldn't count against a request.** If every failed send during a ten-minute tunnel made the request's backoff longer, it would still be waiting a full minute between tries *after* the train pulled into a station. Backing off the probe instead keeps the request's own schedule fresh. You'll see this pay off in the results.

## Step 4: Back off like you mean it

When a train comes out of a tunnel, every phone on it reconnects in the same second. If they all retry on the same schedule (1 s, 2 s, 4 s…), your API gets hit in neat, synchronised waves. That's row 5. The fix is **full jitter**: wait a random amount of time between zero and the exponential ceiling.

```ts
// src/backoff.ts
export function fullJitterDelay(attempt: number, baseMs: number, capMs: number, random = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}
```

Marc Brooker's post on the AWS Architecture Blog compares the different flavours of jitter. Full jitter spreads the load out about as well as any of them, and it's the simplest to write.

If the server says how long to wait, with a `Retry-After` header, that wins over the random number:

```ts
// src/queue.ts
private scheduleRetry(item: QueuedRequest, reason: string, minDelayMs = 0): void {
  item.attempts++;
  const delay = fullJitterDelay(item.attempts, this.baseDelayMs, this.maxDelayMs, this.random);
  item.nextAttemptAt = this.now() + Math.max(delay, minDelayMs);
  item.lastError = reason;
}
```

Notice that `nextAttemptAt` is a **timestamp saved on the item**, not a `setTimeout`. Hold that thought until Step 6.

## Step 5: Batches that half succeed

Sending one request per order is simple, but on a slow link each one pays a full round trip. So the queue sends batches of up to 20, and the server replies with **one verdict per item**:

```json
{
  "results": [
    { "id": "7f3a…", "status": "delivered" },
    { "id": "91c0…", "status": "retry", "reason": "inventory service busy" },
    { "id": "c44e…", "status": "rejected", "reason": "unknown sku" }
  ]
}
```

Each verdict sends a request down a different path:

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

There are three rules hiding in that block, covering rows 6 and 7:

1. **A missing verdict means "retry", never "delivered".** If the server forgets to mention an item, assume it didn't happen. The tag makes sending it again safe.
2. **Only the server can send a request to the lost-luggage desk.** Network failures back off forever. A clear "no" from the server, or too many "try again later"s, ends it. A request should never be thrown away because the *airport* was closed.
3. **If a batch fails at the network level, stop.** If batch one just timed out, don't fire batches two to five into the same black hole:

```ts
} catch (err) {
  for (const item of batch) this.scheduleRetry(item, describe(err), retryAfterMs);
  this.lastHeardFromServer = 0; // whatever we knew about the network is stale now
  await this.persist();
  break;
}
```

Dead-lettered requests go to an `onDeadLetter` callback. Please show them to the user. A silently dropped order is worse than an error message, and it's a much worse support ticket.

## Step 6: Survive being suspended and killed

Row 8 is the one most hand-rolled retry loops miss. Lock the phone and iOS suspends your JavaScript; timers stop. If memory gets tight, the OS kills the app without asking. Whatever lived only in memory goes with it: your retry loop, your pending requests, all of it.

The queue survives this because of two decisions we've already made. Every request is **on disk** (Step 1), and every request's schedule is a **saved timestamp** (Step 4), not a timer. That means a timer is only ever a nudge. If it fires late, or never fires at all, nothing is lost. The next time the app comes to the foreground, `flush()` sends whatever is due.

Here's the hook that wires that up in the app:

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

Three things can trigger a flush at the same moment: the app coming back, NetInfo, and the timer. So `flush()` is single-flight, meaning simultaneous callers share one flush instead of sending the same batch three times:

```ts
flush(): Promise<FlushReport> {
  this.inFlight ??= this.doFlush().finally(() => {
    this.inFlight = null;
  });
  return this.inFlight;
}
```

What about syncing while the app is in the background? Both platforms will run scheduled background work for you (BGTaskScheduler on iOS, WorkManager on Android), and Expo wraps both. It's worth adding, but treat it as a bonus: the OS decides when, and whether, your task runs, and that's often no more than once every 15 minutes. The foreground path above has to be correct on its own.

## Step 7: Wire it into the app

With the queue and the hook in place, the screen itself is almost boring. That's the goal:

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

Create the queue once, in its own module, and share that one instance across the app. Two queues writing to the same storage key would overwrite each other:

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

To try it on a real phone, start the demo server and point the Expo app at your laptop:

```bash
npm run server                                        # orders API on :8787
EXPO_PUBLIC_API_URL=http://<your-laptop-ip>:8787 npx expo start
```

Then be mean to it. Restart the server with `DROP_RESPONSE_RATE=0.5` and it will do the work and then hang up on half your requests. Every order still shows up exactly once at `GET /orders`. Add `IGNORE_KEYS=1` and watch the duplicates roll in. On iOS, the Network Link Conditioner in developer settings with 100% loss gives you a decent dead zone: NetInfo keeps saying "connected", the probe disagrees, and the badge counts your orders piling up. The example's README has the full walkthrough.

## Putting it through bad networks

Unit tests prove each rule on its own. They can't tell you how the rules behave *together* over twenty minutes of awful connectivity. I don't have a lab full of phones riding trains, so I did the next best thing: I wrote a small simulator that replays a bad network against the queue, and against three simpler approaches, on a fake clock.

### Describing a bad network

A scenario is a timeline of what the network is doing, plus what the app is doing:

```json
{
  "name": "underground-commute",
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

Four states cover the whole failure table:

- **`up`**: packets flow, with whatever latency and loss you give it (rows 2, 5 and 6)
- **`down`**: no network at all; requests fail instantly (row 1)
- **`blackhole`**: looks connected, nothing comes back; requests time out (row 4)
- **`captive`**: every request gets an HTML login page with a `200` (row 3)

The detail that makes the simulator worth anything is how it loses packets on an `up` link. Half of the losses drop the *request*, so the server never sees it. The other half drop the *response*, after the server has already done the work:

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

Time is simulated and every random number comes from a seed, so all 400 runs finish in under a second and give you the same numbers every time.

### Four scenarios, four approaches

The repo ships with four scenarios. Each one is modelled on a situation everyone has been in, and each leans on a different row of the table:

- **Underground commute (20 minutes):** signal at stations, nothing in the tunnels, weak signal at the platform edges, and one stretch of full bars with no data. The phone goes into a pocket twice, and the second time the OS kills the app.
- **Office lift (6 minutes):** a 45-second ride in a metal box, then a weak signal as the doors open.
- **Conference Wi-Fi (15 minutes):** a captive portal for the first four minutes, then a congested network losing 15% of packets.
- **Out of data (15 minutes):** the SIM hits its cap and nothing gets through for nine minutes, while NetInfo cheerfully reports a connection.

And four ways of sending the same user's orders:

- **Fire and forget:** `fetch()` on tap; if it fails, show an error.
- **Retry in memory:** the classic hand-rolled loop, with exponential backoff and no keys.
- **Durable, no tags:** this article's queue, saved to disk and jittered, but without idempotency keys or the probe.
- **Checked luggage:** the whole thing.

Run it yourself:

```bash
npm run bench     # replays every scenario against every approach, 25 seeds each
npm run chart     # redraws the chart below from the results
```

To try your own scenarios, drop JSON files in a folder and run `npm run bench -- ./my-scenarios`.

## What happened

![Small multiples, one per scenario, each with a 100% stacked bar per approach showing the share of orders delivered exactly once, duplicated or lost. Checked luggage delivers 100% exactly once in all four scenarios.](./images/results.svg)

| Scenario | Fire and forget | Retry in memory | Durable, no tags | Checked luggage |
|---|---|---|---|---|
| Underground commute | 64.5% lost | 23.7% lost, 2.5% duplicated | 5.6% duplicated | **100% exactly once** |
| Conference Wi-Fi | 33.0% lost | 8.3% duplicated | 7.6% duplicated | **100% exactly once** |
| Office lift | 14.3% lost | 2.1% duplicated | 3.0% duplicated | **100% exactly once** |
| Out of data | 52.7% lost | 100% exactly once | 100% exactly once | **100% exactly once** |

A few things jumped out at me.

**Retrying in memory swaps one bug for another.** On the commute, it cut losses from 64.5% to 23.7%. Nearly all of what's left is the moment the OS killed the app: everything held in memory died with the process. That's my second bug report, recreated on demand.

**Saving to disk without tags just moves the bug.** The durable queue without keys didn't lose a single order in any scenario, but it duplicated 3–8% of them wherever the network dropped responses. That's my *first* bug report. Seeing both of them reproduced in a simulator was oddly satisfying.

**Being offline doesn't cause duplicates; being *half* online does.** Look at the "out of data" row. A black hole never delivers anything, so it never loses a response, so there's nothing to duplicate, and every approach that retries scores 100%. Duplicates come from the network that *mostly* works.

**The probe pays for itself on long outages, and costs a little on short ones.** On the commute, the full queue's median delivery time was 52.2 seconds, against 70.2 for the durable queue without a probe. Without the probe, every failed send during the tunnels pushed the request's backoff higher, so requests were still waiting long after the train reached a station. The out-of-data scenario shows the other side: there, the extra round trip made the full queue a little slower, 29.9 seconds against 25.7.

One honest note on all of this: these are simulated networks, built to model situations we all recognise, not recordings from real phones. The simulator also simplifies a couple of things (requests in a batch go one after another, and a network change halfway through a request is ignored). So read the numbers as a fair fight between four approaches under identical conditions, not as a forecast for your users. If you can record your own users' networks, the harness will take them as they are, and I'd love to see the results.

## Wrapping up

If I could go back and tell weekend-me one thing, it would be this: every write from a phone needs four guarantees. It's on disk before the user is told it's saved. It carries a tag the server checks. The app finds out whether your server is really there before spending a retry. And its schedule is saved on disk rather than held in a timer. Get those four right and both of my bug reports go away.

The library, the demo server, the simulator and the scenarios are all in [the repo](https://github.com/Ernesto-tha-great/checked-luggage). If you break it, tell me how. That's the fun part.
