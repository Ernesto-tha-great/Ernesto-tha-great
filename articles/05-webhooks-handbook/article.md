# The Webhooks Handbook: Reliable Delivery With Node.js and TypeScript

*Signing, retrying and apologising for HTTP calls you send to servers you've never met.*

**Ernest Nnamdi** · Node.js · TypeScript · APIs

---

The first webhook integration I ever built was the receiving end of a payments provider. It passed every test. Then, in its first week in production, one customer got two confirmation emails for one payment, another got none, and the provider's dashboard insisted every single delivery had succeeded.

All three of those things were true at once. That was the week I learned a webhook isn't a function call. It's a promise: *"I'll tell you when something happens."* (The kind your API makes, not the kind you `await`.) And like most promises, it's easy to make and surprisingly hard to keep.

This handbook builds both sides of that promise, sender and receiver, in Node.js and TypeScript, following the [Standard Webhooks](https://www.standardwebhooks.com) specification. By the end you'll have:

- an **outbox**, so you never lose an event between your database and your HTTP client
- **signatures** that the official Standard Webhooks library accepts, verified on the raw body with a constant-time comparison
- **SSRF protection**, because your customers choose where your servers send requests
- **retries** on a sensible schedule, with jitter and dead letters
- **secret rotation** with no downtime
- a receiver with an **inbox** that turns duplicates into no-ops
- **version checks**, so events arriving out of order can't undo each other
- a **reconciliation feed** for the events you'll still miss, because you will

Then we'll point a deliberately broken receiver at it and count what survives.

The code is in [**github.com/Ernesto-tha-great/webhooks-handbook**](https://github.com/Ernesto-tha-great/webhooks-handbook). It needs Node 22.13 or newer (for the built-in SQLite) and nothing else:

```bash
git clone https://github.com/Ernesto-tha-great/webhooks-handbook.git
cd webhooks-handbook
npm install
npm test        # 18 tests
npm run chaos   # the experiment at the end of this handbook
```

## Table of contents

1. [What a webhook actually promises](#what-a-webhook-actually-promises)
2. [Chapter 1: Write the event with the change](#chapter-1-write-the-event-with-the-change)
3. [Chapter 2: Sign it](#chapter-2-sign-it)
4. [Chapter 3: Don't let customers aim your servers](#chapter-3-dont-let-customers-aim-your-servers)
5. [Chapter 4: Retry like you mean it](#chapter-4-retry-like-you-mean-it)
6. [Chapter 5: Rotate secrets without breaking anyone](#chapter-5-rotate-secrets-without-breaking-anyone)
7. [Chapter 6: Receive it properly](#chapter-6-receive-it-properly)
8. [Chapter 7: When events arrive out of order](#chapter-7-when-events-arrive-out-of-order)
9. [Chapter 8: The events you'll still miss](#chapter-8-the-events-youll-still-miss)
10. [Chapter 9: Prove it](#chapter-9-prove-it)
11. [The checklist](#the-checklist)

![The whole system: the sender writes the order, event and delivery job in one transaction; a dispatcher signs and sends with retries through an SSRF-safe agent; the receiver verifies, stores in an inbox and acknowledges; a worker applies events with a version check; reconciliation reads the sender's events feed.](./images/architecture.svg)

## What a webhook actually promises

Before writing any code, let's be honest about the contract, because most webhook bugs come from promising more than the network can deliver.

**At least once, not exactly once.** If the receiver processes your request and the response gets lost on the way back, you can't tell that apart from a request that never arrived. Your only safe move is to send it again. So receivers *will* see duplicates, and the system has to be designed so duplicates don't matter.

**Not in order.** Retries, parallel deliveries and network jitter all reorder events. "Order shipped" can arrive before "order paid".

**Not "never lost".** Endpoints go down for longer than your retry schedule. Someone deploys a broken receiver on a Friday evening. You need a way for receivers to catch up on what they missed.

Everything in this handbook follows from those three sentences. If you take one thing away, make it this: promise at-least-once delivery, give every event an ID, and give receivers a way to reconcile.

## Chapter 1: Write the event with the change

Here's the version of webhooks most of us write first:

```ts
app.post('/orders', async (req, res) => {
  const order = await db.orders.create(req.body);
  await fetch(customer.webhookUrl, { method: 'POST', body: JSON.stringify(order) }); // 😬
  res.status(201).json(order);
});
```

Count the ways this loses an event. The process crashes after the database commit but before the `fetch`. The `fetch` times out and nobody retries. The receiver is down for a deploy. Each time, the order exists and the customer never hears about it. Flip the order of the two lines and it's worse: now you can announce an order that never committed.

The fix is the **transactional outbox**: write the event *in the same transaction* as the change, and send it later, from a separate process. If the transaction commits, the event exists. If it rolls back, the event never existed. There's no window where one is true and the other isn't.

```ts
// src/sender/db.ts
createOrder(customer: string, totalCents: number, now = new Date()): OrderRow {
  return this.transaction(() => {
    const order: OrderRow = {
      id: `ord_${randomUUID().slice(0, 12)}`, customer, total_cents: totalCents,
      status: 'created', version: 1, updated_at: now.toISOString(),
    };
    this.sqlite.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)')
      .run(order.id, order.customer, order.total_cents, order.status, order.version, order.updated_at);
    this.recordEvent('order.created', order, now);
    return order;
  });
}

/** The outbox write: the event and one delivery job per active endpoint, inside the caller's transaction. */
private recordEvent(type: string, data: OrderRow, now: Date): void {
  const id = `msg_${randomUUID().replace(/-/g, '')}`;
  const payload = JSON.stringify({ type, timestamp: now.toISOString(), data });
  const { lastInsertRowid } = this.sqlite
    .prepare('INSERT INTO events (id, type, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(id, type, payload, now.toISOString());
  this.sqlite
    .prepare(`INSERT INTO deliveries (event_seq, endpoint_id, next_attempt_at)
              SELECT ?, id, ? FROM endpoints WHERE status = 'active'`)
    .run(lastInsertRowid, now.getTime());
}
```

Three things are worth noticing.

1. **The payload is serialised once and stored as text.** Every retry sends exactly the same bytes, which matters for signatures in a minute.
2. **Every event gets its ID at creation time** (`msg_…`). That ID becomes the `webhook-id` header, and it's the thing receivers deduplicate on. Never generate a new ID per attempt.
3. **The `events` table does double duty.** It's the outbox, and it's also an append-only log that receivers can page through later (Chapter 8).

The repo uses SQLite to stay dependency-free. In Postgres or MySQL it's the same idea: one transaction, three inserts.

## Chapter 2: Sign it

Your receiver's URL is on the public internet. Anyone who finds it can POST to it. The signature is how the receiver knows a request really came from you and wasn't changed on the way.

Standard Webhooks defines the format, so receivers can use an off-the-shelf library instead of reverse-engineering yours:

![The webhook-id, webhook-timestamp and raw body joined with dots, signed with HMAC-SHA256 and sent in the webhook-signature header as v1,base64. During rotation two signatures are sent, separated by a space.](./images/signature.svg)

The sending side is short:

```ts
// src/signing.ts
export function signature(secret: string, id: string, timestamp: number, body: string): string {
  const hmac = createHmac('sha256', keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${hmac}`;
}

export function signHeaders(secrets: readonly string[], id: string, body: string, now = new Date()): WebhookHeaders {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': secrets.map((secret) => signature(secret, id, timestamp, body)).join(' '),
  };
}
```

The ID and the timestamp are signed along with the body. That stops an attacker from replaying a captured body under a fresh timestamp, or under a different event ID.

The receiving side is where people usually slip up, so here it is in full:

```ts
// src/signing.ts
export function verify(secret: string, body: string | Buffer, headers: Record<string, string | string[] | undefined>, options = {}): void {
  const id = single(headers['webhook-id']);
  const timestamp = single(headers['webhook-timestamp']);
  const signatures = single(headers['webhook-signature']);
  if (!id || !timestamp || !signatures) throw new WebhookVerificationError('Missing webhook headers');

  // Replay protection: a captured request stops working after a few minutes.
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const sent = Number(timestamp);
  if (!Number.isInteger(sent) || Math.abs(now - sent) > (options.toleranceSeconds ?? 300)) {
    throw new WebhookVerificationError('Timestamp outside the tolerance window');
  }

  const expected = Buffer.from(signature(secret, id, sent, body.toString()).slice('v1,'.length), 'base64');
  for (const candidate of signatures.split(' ')) {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) continue;
    const received = Buffer.from(value, 'base64');
    // Constant-time comparison: === leaks how many leading bytes matched.
    if (received.length === expected.length && timingSafeEqual(received, expected)) return;
  }
  throw new WebhookVerificationError('No matching signature');
}
```

The three mistakes I see most often in receivers:

- **Verifying the parsed body.** If your framework parses the JSON and you re-serialise it to check the signature, any difference in key order or whitespace breaks it. Verify the **raw bytes** exactly as they arrived. In Express, that means `express.raw({ type: 'application/json' })` on the webhook route instead of `express.json()`.
- **Comparing with `===`.** String comparison stops at the first different character, and the time that takes leaks information. `crypto.timingSafeEqual` takes the same time whatever the input. It throws if the lengths differ, hence the length check first.
- **Skipping the timestamp check.** Without it, someone who captures one valid request can replay it forever.

Since the whole point of a standard is that other people's code can verify your webhooks, the test suite checks that both directions work against the official `standardwebhooks` package:

```ts
// test/signing.test.ts
it('produces signatures the official library accepts', () => {
  const secret = generateSecret();
  const headers = signHeaders([secret], 'msg_1', body);
  assert.doesNotThrow(() => new Webhook(secret).verify(body, { ...headers }));
});
```

## Chapter 3: Don't let customers aim your servers

This is the part of webhooks that keeps security teams up at night. Your customers give you a URL, and your servers make requests to it. What if the URL is `http://169.254.169.254/latest/meta-data/`? On many cloud providers, that's the instance metadata service, and your dispatcher has just fetched your own credentials for whoever registered the endpoint. That's server-side request forgery (SSRF).

There are two layers of defence. The first is a cheap check when the URL is registered: https only, no embedded credentials, and no IP literals in private ranges.

```ts
// src/ssrf.ts
export function assertAcceptableUrl(raw: string, options: { allowHttp?: boolean } = {}): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError('Webhook URLs must use https');
  }
  if (url.username || url.password) throw new UnsafeUrlError('No credentials in webhook URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError(`${host} is a private address`);
  return url;
}
```

That's not enough on its own, because a hostname can resolve to anything. `hooks.attacker.example` can point at `10.0.0.5` today, or point somewhere harmless at registration time and then switch to an internal address later. That second trick is called DNS rebinding.

So the real check happens at the **moment of connection**, on the IP address the socket actually connects to. undici (the HTTP client behind Node's `fetch`) lets you swap in your own DNS lookup:

```ts
// src/ssrf.ts
export function createSafeAgent(options: { allowPrivate?: boolean } = {}): Agent {
  return new Agent({
    connect: {
      lookup(hostname, lookupOptions, callback) {
        dnsLookup(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
          if (err) return callback(err, []);
          const unsafe = addresses.find((a) => isPrivateAddress(a.address));
          if (unsafe && !options.allowPrivate) {
            return callback(new UnsafeUrlError(`${hostname} resolves to private address ${unsafe.address}`), []);
          }
          // ...hand back the addresses undici asked for
        });
      },
    },
  });
}
```

Two smaller rules complete the picture. First, **don't follow redirects**: a `302` to an internal address is the oldest trick in the book, so the dispatcher sends with `redirect: 'manual'` and treats any 3xx as a failure. Second, unwrap IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1` is just `127.0.0.1` in disguise) before checking them.

The test for this starts a real server on localhost and checks that the safe agent refuses to reach it through the name `localhost`. That name sails through the registration check, because it's a name and not an IP.

## Chapter 4: Retry like you mean it

The dispatcher is a loop that wakes up every second, picks deliveries that are due, and sends them. Its whole state lives in the `deliveries` table, so if the process dies, a new one picks up exactly where the old one stopped.

How long to keep retrying is a judgement call. I use Svix's published schedule, which the Standard Webhooks spec points to: immediately, then 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours. That covers roughly a day and a half, which is long enough to survive a receiver's bad deploy and a night's sleep, and short enough that a dead endpoint doesn't haunt your queue forever.

```ts
// src/sender/dispatcher.ts
export const DEFAULT_SCHEDULE_MS = [0, 5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000];

private fail(row: DueRow, error: string, final: boolean): 'retrying' | 'dead' {
  const attempts = row.attempts + 1;
  const exhausted = final || attempts >= this.schedule.length;
  // ±20% jitter so a recovered endpoint isn't hit by every retry in the same second.
  const delay = exhausted ? 0 : this.schedule[attempts]! * (0.8 + 0.4 * this.random());
  // ...update the delivery, count consecutive failures, maybe disable the endpoint
}
```

The details that make a dispatcher well-behaved:

- **Jitter.** If a receiver is down for ten minutes, hundreds of deliveries fail together. Without jitter, they all retry together too, and you knock the receiver over again the moment it comes back.
- **A timeout on every request.** A receiver that accepts the connection and never answers would otherwise tie up your dispatcher forever. Ten seconds is plenty. Receivers should reply quickly and do the real work later (Chapter 6).
- **`410 Gone` means stop.** Treat it as the customer saying "I've removed this endpoint", and disable it.
- **Disable endpoints that keep failing.** After a long run of consecutive failures, stop sending and tell the customer, ideally by email and with a big red banner on their dashboard. A broken endpoint you keep hammering helps nobody.
- **Dead letters are visible.** When a delivery runs out of attempts, it's marked `dead`, not deleted. Show it on the customer's dashboard with a "resend" button.

## Chapter 5: Rotate secrets without breaking anyone

Secrets leak. People paste them into Slack, commit them in `.env.example`, and leave companies. You need to be able to rotate an endpoint's secret without a window where webhooks fail to verify.

Standard Webhooks makes this neat: the signature header can hold several signatures, separated by spaces, and the receiver accepts the request if *any* of them matches. So rotation is just a period where you sign with both secrets:

```ts
// src/sender/db.ts
rotateSecret(endpointId: string, overlapHours = 24, now = new Date()): string {
  const endpoint = this.endpoint(endpointId);
  const expiresAt = new Date(now.getTime() + overlapHours * 3_600_000).toISOString();
  const current = JSON.parse(endpoint.secrets).map((s) => ({ ...s, expiresAt: s.expiresAt ?? expiresAt }));
  const secret = generateSecret();
  this.sqlite.prepare('UPDATE endpoints SET secrets = ? WHERE id = ?')
    .run(JSON.stringify([{ secret, expiresAt: null }, ...current]), endpointId);
  return secret;
}
```

For 24 hours, every webhook carries two signatures. The customer swaps their receiver over to the new secret whenever suits them inside that window. Nobody has to coordinate a deploy at exactly 3 p.m.

## Chapter 6: Receive it properly

Now the other side. If you're building a receiver, everything that follows applies to you even if the sender gets none of the above right.

The receiver's job in the request handler is small: **verify, write it down, say thanks.** The actual processing happens afterwards.

```ts
// src/receiver/receiver.ts
const server = createServer(async (req, res) => {
  // Verify the raw bytes, exactly as they arrived.
  const raw = await readRaw(req);
  if (!verifiesWithAny(options.secrets, raw, req.headers)) return reply(res, 401);

  const fresh = options.db.store(String(req.headers['webhook-id']), raw.toString(), 'webhook');
  if (!fresh) stats.duplicates++;

  // Acknowledge fast. The work happens off the request path.
  return reply(res, 204);
});
```

The `store` call is the **inbox**, the receiver's mirror of the sender's outbox:

```ts
store(webhookId: string, payload: string, source: 'webhook' | 'reconcile'): boolean {
  const { changes } = this.sqlite
    .prepare('INSERT OR IGNORE INTO inbox (webhook_id, payload, source, received_at) VALUES (?, ?, ?, ?)')
    .run(webhookId, payload, source, Date.now());
  return changes === 1;
}
```

`webhook_id` is the primary key, so a duplicate delivery simply inserts nothing. The 204 goes back either way, because the sender doesn't care that you'd already seen it, only that you have it.

Why write it down before replying, rather than processing it right there in the handler?

- **Speed.** The sender has a timeout. If your handler sends an email, charges a card and updates three tables before replying, a slow day turns into timeouts, retries and more duplicates.
- **Safety.** If your process crashes after replying 204 but before finishing the work, the event is still in the inbox, waiting.
- **Deduplication.** Duplicates stop at the primary key, before any side effect can run twice.

A worker then drains the inbox in the background. In the repo it's a `setInterval`; in your app it might be a queue consumer.

## Chapter 7: When events arrive out of order

Say an order goes from `paid` to `shipped`, and the `shipped` event happens to be delivered first. If your worker applies events in the order they arrived, the order ends up `paid`, which is the wrong answer, delivered with total confidence.

The fix is to carry a version in the data and let the database refuse to go backwards:

```ts
// src/receiver/receiver.ts
this.sqlite.prepare(`
  INSERT INTO orders (id, status, version) VALUES (?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET status = excluded.status, version = excluded.version
  WHERE excluded.version > orders.version`).run(event.data.id, event.data.status, event.data.version);
```

An event for version 2 that turns up after version 3 does nothing. The sender bumps the version in the same transaction as the change, so the numbers always line up with the truth.

If your sender doesn't include versions, use the resource's `updated_at`. Or treat the webhook as a nudge: ignore its data, and fetch the resource's current state from the API. That last approach is slower but impossible to get wrong, and it's what I'd recommend for anything involving money.

## Chapter 8: The events you'll still miss

You've done everything right, and you'll still miss events. The receiver is down for two days over a holiday, the retries run out, and the deliveries are marked dead. Now what?

You give receivers a way to catch up. Remember that the outbox doubles as an append-only log? Expose it:

```ts
// src/sender/api.ts
if (req.method === 'GET' && url.pathname === '/events') {
  // The reconciliation feed: every event, in order, from a cursor.
  const after = Number(url.searchParams.get('after') ?? 0);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
  const events = db.eventsAfter(after, limit).map((e) => ({ seq: e.seq, id: e.id, payload: JSON.parse(e.payload) }));
  return send(res, 200, { events, next: events.at(-1)?.seq ?? after });
}
```

The receiver pages through it from where it last stopped, and feeds anything new into the same inbox the webhooks use:

```ts
// src/receiver/receiver.ts
export async function reconcile(db: ReceiverDb, senderUrl: string): Promise<number> {
  let recovered = 0;
  for (;;) {
    const res = await fetch(`${senderUrl}/events?after=${db.cursor('events')}&limit=200`);
    const page = await res.json();
    for (const event of page.events) {
      if (db.store(event.id, JSON.stringify(event.payload), 'reconcile')) recovered++;
    }
    if (page.events.length === 0) return recovered;
    db.setCursor('events', page.next);
  }
}
```

Because reconciliation uses the same inbox and the same IDs, it doesn't matter whether an event arrives by webhook, by reconciliation or both. It's processed once. The repo's receiver reconciles every 30 seconds; in practice, every few minutes plus once on startup is plenty.

(In production, put the feed behind the same API keys as the rest of your API, and only show each customer their own events.)

## Chapter 9: Prove it

Claims are cheap, so `npm run chaos` runs an experiment. It points two senders at the same badly behaved receiver. That receiver:

- fails 15% of requests outright
- does the work on 8% and then drops the connection, so the sender never hears back
- stalls past the sender's timeout on 4%
- goes completely down for a second and a half in the middle

The workload is 150 orders, each created and then moved through `paid`, `shipped` and `delivered`, with the updates interleaved across orders. That's 600 events.

The **naive** sender is the code from the start of Chapter 1, with three quick retries added, because that's what most of us add next. Its receiver applies whatever arrives, in the order it arrives.

The **handbook** sender is everything above, with the retry schedule compressed from a day and a half into about a second so the experiment finishes. Halfway through, it throws away its dispatcher and starts a new one, to simulate a crash and restart. At the end, the receiver reconciles once.

![Bar chart comparing the two senders: the naive sender lost 29.7% of events, applied 7.3% more than once and left 20% of orders in the wrong state; the handbook sender scored 0% on all three.](./images/chaos.svg)

| Approach | Events | Lost | Applied more than once | Orders in the wrong final state | Recovered by reconciliation |
|---|---:|---:|---:|---:|---:|
| Naive: send inline, retry 3×, apply on arrival | 600 | 178 (29.7%) | 44 (7.3%) | 30 of 150 (20.0%) | – |
| Handbook | 600 | 0 | 0 | 0 | 3 |

The handbook receiver also absorbed **73 duplicate deliveries** without applying any of them twice.

A few things are worth pulling out of that table:

- **Quick retries don't survive outages.** Almost all of the naive sender's losses happened during the 1.5-second outage. Three retries a few milliseconds apart all landed inside it. Backoff is what turns "down for a moment" into "slightly late".
- **Every duplicate is a dropped response.** Each of those 44 double-applied events was the receiver doing the work and the sender never hearing about it. Picture "sent the confirmation email twice", 44 times.
- **Out-of-order delivery is a correctness bug, not a cosmetic one.** One in five orders ended up in the wrong state on the naive receiver. Nothing errored and nothing logged a warning. It was just wrong.
- **Reconciliation is the safety net, not the plan.** Only 3 events needed it, but without it those three orders would be stuck forever.

The experiment's outage is based on wall-clock time, so your exact counts will wobble slightly from run to run. The zeros won't.

## The checklist

**If you send webhooks:**

- [ ] Write events in the same transaction as the change (outbox)
- [ ] Give every event a stable ID, and reuse it on every retry
- [ ] Sign to the Standard Webhooks spec, including the ID and timestamp
- [ ] Check URLs at registration *and* at connect time; never follow redirects
- [ ] Retry with backoff and jitter; time out every request
- [ ] Keep dead letters visible, and give customers a resend button
- [ ] Support several signatures at once, so secrets can rotate
- [ ] Expose an events feed so receivers can reconcile

**If you receive webhooks:**

- [ ] Verify the raw body, in constant time, with a timestamp tolerance
- [ ] Store before you acknowledge; acknowledge before you process
- [ ] Deduplicate on `webhook-id`
- [ ] Use versions (or re-fetch) so late events can't undo newer ones
- [ ] Reconcile on startup and on a schedule

## Further reading

- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), and its steering committee's reasoning for each choice
- Chris Richardson, [Pattern: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- OWASP, [Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- Svix's documentation on [retry schedules](https://docs.svix.com/retries), where the schedule in Chapter 4 comes from
- ngrok, [webhooks.fyi](https://webhooks.fyi), a field guide to how real providers do all of the above
