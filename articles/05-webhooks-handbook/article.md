# Building Reliable Webhooks With Node.js and TypeScript

*In this tutorial, we build both sides of a webhook system, the sender and the receiver, to the Standard Webhooks spec, one step at a time. Then we point a badly behaved receiver at it and count what survives.*

**Ernest Nnamdi** · Node.js · TypeScript · APIs

---

The first webhook integration I ever built was on the receiving end of a payments provider. It passed every test. Then, in its first week in production, one customer got two confirmation emails for a single payment, another customer got none, and the provider's dashboard insisted that every delivery had succeeded.

I spent an embarrassing amount of time convinced the provider was broken. It wasn't. The TL;DR of the issue was that all three things were true at once. Our handler had been slow to reply, so the provider timed out and sent the same event again, and we processed it twice. Another event arrived just as we were deploying: we replied "200 OK", the process restarted before it finished the work, and that payment was never recorded. From the provider's side, both requests had been handed over successfully.

I knew how webhooks worked, in theory: something happens, and someone sends you an HTTP request about it. What I didn't know was how many ways that one request can go wrong on its way from them to you.

In this tutorial, I'm going to show you how to build both sides of a webhook system, the sender and the receiver, in Node.js and TypeScript, following the [Standard Webhooks](https://www.standardwebhooks.com) specification. We'll sign every request, retry with backoff, keep customers from aiming our servers at our own network, store and deduplicate on the receiving side, handle events that arrive out of order, and catch up on the ones that never arrive. Then we'll test all of it against a receiver that fails on purpose.

### Okay, but what's a webhook, exactly?

That's a fair question. Think of the buzzer some restaurants hand you while you wait for a table. Without it, you'd walk up to the host every two minutes to ask whether your table is ready. With it, you sit down, and the buzzer goes off when it's time. Asking every two minutes is polling. The buzzer is a webhook.

In API terms, instead of your customers calling your API over and over to check whether an order has shipped, they give you a URL, and you send an HTTP request to it when the order ships. Payment providers, Git hosts and chat platforms all work this way.

### Sounds good, but what can go wrong?

Quite a lot. Here are three things you can't count on:

- **Exactly once.** If the receiver does the work and its reply gets lost on the way back, the sender can't tell that apart from a request that never arrived. The only safe thing to do is send it again. So receivers *will* see duplicates.
- **In order.** Retries and parallel requests reorder events. "Order shipped" can arrive before "order paid".
- **Never lost.** Receivers go down for longer than any retry schedule. Someone deploys a broken receiver on a Friday evening.

So we'll design around all three. We'll promise *at-least-once* delivery, give every event an ID so duplicates can be ignored, carry a version so late events can't undo newer ones, and give receivers a way to catch up on what they missed.

That being said, let's get to building!

## Prerequisites

- Node.js 22.13 or newer (we use its built-in SQLite module)
- Some familiarity with TypeScript and HTTP
- curl and a bash-style terminal (on Windows, use Git Bash or WSL)

## What Are We Building?

We'll build:

- signatures to the Standard Webhooks spec, checked against the official library
- a sender that writes every event in the same database transaction as the change it describes (an *outbox*)
- checks that stop a customer from pointing our servers at our own internal network
- a dispatcher that sends events, retries them with backoff and gives up gracefully
- a receiver that verifies, stores, deduplicates and applies events, in the right order
- an events feed, so the receiver can catch up on anything it missed
- a chaos script that compares all of it with the naive approach

Here's what the project will look like when we're done:

```text
webhooks-handbook/
  src/
    signing.ts          # Standard Webhooks signatures
    ssrf.ts             # keeps webhook URLs away from our own network
    sender/
      db.ts             # orders, events (the outbox), endpoints and deliveries
      dispatcher.ts     # sends deliveries, with retries
      api.ts            # orders, endpoints and the events feed
      main.ts           # runs the sender
    receiver/
      receiver.ts       # verifies, stores (the inbox) and applies webhooks
      main.ts           # runs the receiver
  scripts/
    sign.ts             # tries out signing
    outbox.ts           # tries out the outbox
    check-urls.ts       # tries out the URL checks
    chaos.ts            # the experiment at the end
```

## Step 1: Setting Up Our Project

Let's start by creating a folder for the project and installing what we need.

```bash
mkdir webhooks-handbook
cd webhooks-handbook
npm init -y
npm install undici@7
npm install --save-dev typescript@5 tsx @types/node@22 standardwebhooks
```

undici is the HTTP client behind Node's own `fetch`. We install it directly because we'll need to plug our own DNS check into it later. (Version 7 is the one that runs on every Node 22 release; version 8 needs Node 22.19 or newer.) `standardwebhooks` is the official library for the spec. We only use it to check that our signatures are right.

Open the folder in your code editor. In package.json, add `"type": "module"` and replace the `scripts` section, so those two parts look like this (leave the rest of the file, like your dependencies, as it is):

```json
{
  "type": "module",
  "scripts": {
    "sign": "node --no-warnings --import tsx scripts/sign.ts",
    "outbox": "node --no-warnings --import tsx scripts/outbox.ts",
    "check-urls": "node --no-warnings --import tsx scripts/check-urls.ts",
    "sender": "node --no-warnings --import tsx src/sender/main.ts",
    "receiver": "node --no-warnings --import tsx src/receiver/main.ts",
    "chaos": "node --no-warnings --import tsx scripts/chaos.ts",
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

## Step 2: Signing It

The receiver's URL is on the public internet, so anyone who finds it can send it a request. A signature is how the receiver knows a request really came from us and wasn't changed on the way.

Standard Webhooks defines exactly how to sign, which means receivers can use an off-the-shelf library instead of reverse-engineering ours:

![The webhook-id, webhook-timestamp and raw body joined with dots, signed with HMAC-SHA256 and sent in the webhook-signature header as v1,base64. During rotation two signatures are sent, separated by a space.](images/signature.svg)

Every request carries three headers: `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signature is an HMAC-SHA256 of the ID, the timestamp and the raw body joined with dots. Signing the ID and the timestamp along with the body means nobody can replay a captured body under a fresh timestamp or a different ID.

Create a folder called src, and in it, a file called signing.ts. Paste in the code below (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/signing.ts)):

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks signatures (https://www.standardwebhooks.com).
 *
 *   signed content:   `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature:        base64(HMAC-SHA256(secret, signed content))
 *   header value:     "v1,<signature>", space-separated when there are several
 *   secret format:    "whsec_" + base64(random bytes)
 */

export const SECRET_PREFIX = 'whsec_';
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

export function generateSecret(): string {
  return SECRET_PREFIX + randomBytes(24).toString('base64');
}

function keyOf(secret: string): Buffer {
  return Buffer.from(secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret, 'base64');
}

export function signature(secret: string, id: string, timestamp: number, body: string): string {
  const hmac = createHmac('sha256', keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${hmac}`;
}

/**
 * Signs with every secret you pass. During a key rotation you send two
 * signatures, so receivers on the old secret and the new one both verify.
 */
export function signHeaders(secrets: readonly string[], id: string, body: string, now = new Date()): WebhookHeaders {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': secrets.map((secret) => signature(secret, id, timestamp, body)).join(' '),
  };
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * Verifies a request on the receiving side. `body` must be the raw bytes as
 * they arrived. Parse JSON first and re-serialise it, and the signature will
 * (correctly) fail, because key order and whitespace are part of what was signed.
 */
export function verify(
  secret: string,
  body: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  options: { toleranceSeconds?: number; now?: Date } = {},
): void {
  const id = single(headers['webhook-id']);
  const timestamp = single(headers['webhook-timestamp']);
  const signatures = single(headers['webhook-signature']);
  if (!id || !timestamp || !signatures) throw new WebhookVerificationError('Missing webhook headers');

  // Replay protection: a captured request stops working after a few minutes.
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const sent = Number(timestamp);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!Number.isInteger(sent) || Math.abs(now - sent) > tolerance) {
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

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
```

Let's go through it:

- `generateSecret` makes a secret in the spec's format: `whsec_` followed by random bytes in base64.
- `signHeaders` builds the three headers. It takes a *list* of secrets and joins one signature per secret with a space. We'll see why when we rotate secrets in a moment.
- `verify` is the receiving side. It checks the timestamp is within five minutes, then compares every signature in the header with the one it expects.

Run `npm run typecheck` to make sure it compiles. Apart from npm's own two lines at the top, it shouldn't print anything. You can do this after every step.

The receiving side is where people usually slip up, and there are three classic mistakes. The first is verifying the *parsed* body: if your framework parses the JSON and you turn it back into a string, any change in key order or whitespace breaks the signature. You have to verify the raw bytes, exactly as they arrived. (In Express, that means `express.raw({ type: 'application/json' })` on your webhook route instead of `express.json()`.) The second is comparing signatures with `===`, which stops at the first different character and leaks how much of a forged signature was right through timing. `timingSafeEqual` takes the same time whatever the input. The third is skipping the timestamp check, which lets anyone who captures one valid request replay it forever.

Let's try it. Create a folder called scripts, and in it, a file called sign.ts:

```ts
/**
 * Signs a webhook, checks it with our verify() and with the official Standard
 * Webhooks library, then shows what tampering, replays and rotation look like.
 *
 *   npm run sign
 */
import { Webhook } from 'standardwebhooks';
import { generateSecret, signHeaders, verify } from '../src/signing';

const secret = generateSecret();
const body = JSON.stringify({ type: 'order.created', timestamp: new Date().toISOString(), data: { id: 'ord_1', status: 'created', version: 1 } });
const headers = signHeaders([secret], 'msg_1', body);
console.log(headers, '\n');

function check(label: string, run: () => void): void {
  try {
    run();
    console.log(`✓ ${label}`);
  } catch (err) {
    console.log(`✗ ${label}: ${(err as Error).message}`);
  }
}

check('our verify() accepts it', () => verify(secret, body, { ...headers }));
check('the official library accepts it', () => new Webhook(secret).verify(body, { ...headers }));
check('a changed body', () => verify(secret, body.replace('ord_1', 'ord_2'), { ...headers }));
check('the same request, ten minutes later', () => verify(secret, body, { ...headers }, { now: new Date(Date.now() + 10 * 60_000) }));

// Rotation: sign with the new secret and the old one, and receivers on either still verify.
const newSecret = generateSecret();
const rotated = signHeaders([newSecret, secret], 'msg_2', body);
console.log(`\nduring a rotation: ${rotated['webhook-signature']}\n`);
check('a receiver still on the old secret', () => verify(secret, body, { ...rotated }));
check('a receiver already on the new secret', () => verify(newSecret, body, { ...rotated }));
```

Run it:

```bash
npm run sign
```

```text
{
  'webhook-id': 'msg_1',
  'webhook-timestamp': '1791451170',
  'webhook-signature': 'v1,KeFwaLQOHkKxLXsbtbFSwaSvnm7SVxCgysTEKkjkdtU='
}

✓ our verify() accepts it
✓ the official library accepts it
✗ a changed body: No matching signature
✗ the same request, ten minutes later: Timestamp outside the tolerance window

during a rotation: v1,Fnu0d5JT596HO4uZE097vv3/Mg6wxeyCjNK9989PMcw= v1,7c9Ddfd8yS4BIGp4o1ujmNhNauOI7QAJcdSQxBAMTk4=

✓ a receiver still on the old secret
✓ a receiver already on the new secret
```

Your secrets and signatures will be different every time, but the ticks and crosses won't. The official library accepts our signatures, a changed body fails, and so does a request that's ten minutes old.

The last part is secret rotation. Secrets leak: people paste them in Slack and commit them in `.env.example`. Because the header can hold several signatures, rotating is just a period where we sign with both the new secret and the old one. Receivers on either secret keep working, and the customer can switch over whenever suits them, instead of everyone coordinating a deploy at exactly 3 p.m.

## Step 3: Writing the Event With the Change

Here's the version of webhooks most of us write first:

```ts
app.post('/orders', async (req, res) => {
  const order = await db.orders.create(req.body);
  await fetch(customer.webhookUrl, { method: 'POST', body: JSON.stringify(order) });
  res.status(201).json(order);
});
```

This can lose an event in several ways. The process crashes after the database commit but before the `fetch`. The `fetch` times out and nobody retries. The receiver is down for a deploy. Each time, the order exists and the customer never hears about it. Swap the two lines around, and it's worse: now you can announce an order that never got saved.

The fix is called a **transactional outbox**. We write the event in the same database transaction as the change, and send it later, from a separate loop. So either the order and its event are both saved, or neither is.

In the src folder, create a folder called sender, and in it, a file called db.ts. It's a long one, so copy it from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/db.ts).

It creates four tables: `orders` (our business data), `events` (the outbox), `endpoints` (the URLs customers registered, with their secrets) and `deliveries` (one job per event per endpoint). Here's the part that matters, where an order and its event are written together:

```ts
  createOrder(customer: string, totalCents: number, now = new Date()): OrderRow {
    return this.transaction(() => {
      const order: OrderRow = {
        id: `ord_${randomUUID().replace(/-/g, '').slice(0, 12)}`, customer, total_cents: totalCents,
        status: 'created', version: 1, updated_at: now.toISOString(),
      };
      this.sqlite.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)')
        .run(order.id, order.customer, order.total_cents, order.status, order.version, order.updated_at);
      this.recordEvent('order.created', order, now);
      return order;
    });
  }

  updateOrderStatus(orderId: string, status: string, now = new Date()): OrderRow {
    return this.transaction(() => {
      const current = this.sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRow | undefined;
      if (!current) throw new Error(`No order ${orderId}`);
      const order: OrderRow = { ...current, status, version: current.version + 1, updated_at: now.toISOString() };
      this.sqlite.prepare('UPDATE orders SET status = ?, version = ?, updated_at = ? WHERE id = ?')
        .run(order.status, order.version, order.updated_at, order.id);
      this.recordEvent('order.updated', order, now);
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

Three things are worth noticing here:

- The payload is turned into JSON once and stored as text. Every retry sends exactly the same bytes, which matters for the signature.
- Every event gets its ID when it's created (`msg_…`). That ID becomes the `webhook-id` header on every attempt, and it's what receivers deduplicate on.
- The `events` table is also an append-only log of everything that happened. We'll use that in Step 7.

The file also has `rotateSecret`, which adds a new secret to an endpoint and gives the old one 24 hours before it expires. During those 24 hours, the dispatcher signs with both.

We're using SQLite because it's built into Node 22, so there's no database to install. In Postgres or MySQL, it's the same idea: one transaction, three inserts.

Let's see it work. In the scripts folder, create outbox.ts:

```ts
/**
 * Creates an order, pays for it, and shows what the outbox recorded.
 *
 *   npm run outbox
 */
import { SenderDb } from '../src/sender/db';

const db = new SenderDb(); // in memory, so every run starts empty
db.addEndpoint('https://hooks.example.com/webhooks');
const order = db.createOrder('sam', 4200);
db.updateOrderStatus(order.id, 'paid');

console.table(db.sqlite.prepare('SELECT seq, id, type FROM events').all());
console.table(db.sqlite.prepare('SELECT event_seq, endpoint_id, attempts, status FROM deliveries').all());
console.log(db.eventsAfter(1)[0]!.payload);
```

Run it:

```bash
npm run outbox
```

```text
┌─────────┬─────┬────────────────────────────────────────┬─────────────────┐
│ (index) │ seq │ id                                     │ type            │
├─────────┼─────┼────────────────────────────────────────┼─────────────────┤
│ 0       │ 1   │ 'msg_e284c392dd2f4f83b548f40c72ac3699' │ 'order.created' │
│ 1       │ 2   │ 'msg_b5c8ff9bf82f4d8b86be46a03721bf55' │ 'order.updated' │
└─────────┴─────┴────────────────────────────────────────┴─────────────────┘
┌─────────┬───────────┬───────────────┬──────────┬───────────┐
│ (index) │ event_seq │ endpoint_id   │ attempts │ status    │
├─────────┼───────────┼───────────────┼──────────┼───────────┤
│ 0       │ 1         │ 'ep_87d4ea9a' │ 0        │ 'pending' │
│ 1       │ 2         │ 'ep_87d4ea9a' │ 0        │ 'pending' │
└─────────┴───────────┴───────────────┴──────────┴───────────┘
{"type":"order.updated","timestamp":"2026-10-08T09:19:30.775Z","data":{"id":"ord_315cac849de7","customer":"sam","total_cents":4200,"status":"paid","version":2,"updated_at":"2026-10-08T09:19:30.775Z"}}
```

Two business changes, two events, and a delivery job for each one, waiting to be sent. Notice that the event carries the order's `version`. We'll need that on the receiving side.

## Step 4: Not Letting Customers Aim Our Servers

Next, there's a security problem that's easy to miss. Our customers give us a URL, and our servers send requests to it. What if the URL is `http://169.254.169.254/latest/meta-data/`? On many cloud providers, that's the instance metadata service, and our dispatcher has just fetched our own credentials for whoever registered the endpoint. This is called server-side request forgery (SSRF).

We'll defend against it twice. The first check is cheap and happens when a customer registers a URL: https only, no usernames or passwords in the URL, and no IP addresses in private ranges. But that's not enough on its own, because a hostname can point anywhere. `hooks.attacker.example` can point at `10.0.0.5` today, or point somewhere harmless when it's registered and switch to an internal address later. (That second trick even has a name: DNS rebinding.) So the second check happens at the moment we connect, on the IP address the socket is actually about to connect to.

In the src folder, create ssrf.ts and paste in the code below (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/ssrf.ts)):

```ts
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * Your customers give you a URL and your servers make requests to it. Without
 * a guard, "https://169.254.169.254/latest/meta-data/" is a perfectly valid
 * webhook URL, and your dispatcher will happily fetch your cloud credentials.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 96], ['fc00::', 7], ['fe80::', 10]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  // ::ffff:127.0.0.1 is 127.0.0.1 wearing an IPv6 costume. Unwrap it first.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const family = isIP(address);
  if (family === 0) return false;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/** Cheap checks when the customer registers the URL. The real check happens at connect time. */
export function assertAcceptableUrl(raw: string, options: { allowHttp?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }
  if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError('Webhook URLs must use https');
  }
  if (url.username || url.password) throw new UnsafeUrlError('No credentials in webhook URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError(`${host} is a private address`);
  return url;
}

/**
 * An HTTP agent that refuses to connect to private addresses. The check runs
 * on the IP the socket actually connects to, after DNS, so a hostname that
 * resolves to 10.0.0.5 (or flips to it later: DNS rebinding) is caught too.
 */
export function createSafeAgent(options: { allowPrivate?: boolean; connectTimeoutMs?: number } = {}): Agent {
  return new Agent({
    connect: {
      timeout: options.connectTimeoutMs ?? 5_000,
      lookup(hostname, lookupOptions, callback) {
        dnsLookup(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
          if (err) return callback(err, [] as LookupAddress[]);
          const list = addresses as LookupAddress[];
          const unsafe = list.find((a) => isPrivateAddress(a.address));
          if (unsafe && !options.allowPrivate) {
            return callback(new UnsafeUrlError(`${hostname} resolves to private address ${unsafe.address}`), [] as LookupAddress[]);
          }
          // Node asks for every address when it tries IPv4 and IPv6 side by side; hand back what it asked for.
          if ((lookupOptions as { all?: boolean }).all) return callback(null, list);
          const first = list[0]!;
          return (callback as unknown as (e: null, address: string, family: number) => void)(null, first.address, first.family);
        });
      },
    },
  });
}
```

Let's go through it:

- `blocked` is a list of private and reserved address ranges, built with Node's `BlockList`.
- `isPrivateAddress` checks an address against it. It unwraps IPv4-mapped IPv6 addresses first, because `::ffff:127.0.0.1` is just `127.0.0.1` in disguise.
- `assertAcceptableUrl` is the registration check.
- `createSafeAgent` returns an undici `Agent` with its own DNS `lookup`. Every time the dispatcher opens a connection, our lookup resolves the hostname and refuses if any address it gets back is private.

Let's try both checks. In the scripts folder, create check-urls.ts and paste in the code below (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/check-urls.ts)):

```ts
/**
 * Runs some webhook URLs past both SSRF checks: the one when a customer
 * registers a URL, and the one when the dispatcher actually connects.
 *
 *   npm run check-urls
 */
import { fetch } from 'undici';
import { assertAcceptableUrl, createSafeAgent } from '../src/ssrf';

console.log('When a customer registers the URL:');
for (const url of [
  'https://hooks.example.com/webhooks',
  'http://hooks.example.com/webhooks',
  'https://admin:hunter2@hooks.example.com/webhooks',
  'https://169.254.169.254/latest/meta-data/',
  'https://[::ffff:127.0.0.1]/',
  'https://localhost/webhooks',
]) {
  try {
    assertAcceptableUrl(url);
    console.log(`  ✓ ${url}`);
  } catch (err) {
    console.log(`  ✗ ${url}: ${(err as Error).message}`);
  }
}

// localhost got through, because it's a name and not an IP. So let's try to connect to it.
console.log('\nWhen the dispatcher connects:');
const url = 'https://localhost/webhooks';
try {
  await fetch(url, { dispatcher: createSafeAgent() });
  console.log(`  ✓ ${url}`);
} catch (err) {
  const cause = (err as Error).cause;
  console.log(`  ✗ ${url}: ${cause instanceof Error ? cause.message : (err as Error).message}`);
}
```

Run it:

```bash
npm run check-urls
```

```text
When a customer registers the URL:
  ✓ https://hooks.example.com/webhooks
  ✗ http://hooks.example.com/webhooks: Webhook URLs must use https
  ✗ https://admin:hunter2@hooks.example.com/webhooks: No credentials in webhook URLs
  ✗ https://169.254.169.254/latest/meta-data/: 169.254.169.254 is a private address
  ✗ https://[::ffff:127.0.0.1]/: ::ffff:7f00:1 is a private address
  ✓ https://localhost/webhooks

When the dispatcher connects:
  ✗ https://localhost/webhooks: localhost resolves to private address 127.0.0.1
```

`https://localhost/webhooks` gets through registration, because it's a name and not an IP address. When the script then tries to connect to it through the safe agent, the DNS lookup returns 127.0.0.1, and the agent refuses before a connection is even opened.

## Step 5: Sending and Retrying

Now let's actually send something. The dispatcher is a loop that wakes up every second, picks the deliveries that are due, signs them and sends them. All of its state lives in the `deliveries` table, so if the process dies, a new one picks up exactly where the old one stopped.

How long to keep retrying is a judgement call. We'll use Svix's published schedule, which the Standard Webhooks spec points to: immediately, then after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours and 10 hours. That's a little over a day in total, which covers a receiver being down overnight without keeping a dead endpoint in our queue forever.

In the src/sender folder, create dispatcher.ts. It's long, so copy it from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/dispatcher.ts).

Here's how it decides what happens after a failed attempt:

```ts
  private fail(row: DueRow, error: string, final: boolean): 'retrying' | 'dead' {
    const attempts = row.attempts + 1;
    const exhausted = final || attempts >= this.schedule.length;
    // ±20% jitter so a recovered endpoint isn't hit by every retry in the same second.
    const delay = exhausted ? 0 : this.schedule[attempts]! * (0.8 + 0.4 * this.random());

    this.db.transaction(() => {
      this.db.sqlite.prepare('UPDATE deliveries SET attempts = ?, status = ?, next_attempt_at = ?, last_error = ? WHERE event_seq = ? AND endpoint_id = ?')
        .run(attempts, exhausted ? 'dead' : 'pending', Math.round(this.now() + delay), error, row.event_seq, row.endpoint_id);
      const { consecutive_failures } = this.db.sqlite
        .prepare('UPDATE endpoints SET consecutive_failures = consecutive_failures + 1 WHERE id = ? RETURNING consecutive_failures')
        .get(row.endpoint_id) as { consecutive_failures: number };
      if (this.options.disableAfter && consecutive_failures >= this.options.disableAfter) {
        this.db.sqlite.prepare("UPDATE endpoints SET status = 'disabled' WHERE id = ?").run(row.endpoint_id);
      }
    });
    return exhausted ? 'dead' : 'retrying';
  }
```

And here's what the rest of it does:

- **Claiming before sending.** Before it sends anything, `tick` pushes each delivery's next attempt past the request timeout. If another tick starts while we're still waiting for an answer (or you run two dispatchers), it won't pick the same delivery up and send it twice.
- **Jitter.** Each delay is multiplied by a random number between 0.8 and 1.2. If a receiver is down for ten minutes, hundreds of deliveries fail together. Without jitter, they'd all retry together too, and knock the receiver over again the moment it comes back.
- **A timeout on every request.** A receiver that accepts the connection and never answers would otherwise keep that delivery waiting forever. Ten seconds is plenty.
- **No redirects.** A `302` to an internal address would get around our SSRF checks, so the dispatcher sends with `redirect: 'manual'` and treats any 3xx as a failure.
- **`410 Gone` means stop.** The receiver is telling us the endpoint has been removed, so we disable it.
- **Endpoints that keep failing get disabled.** After 50 failed attempts in a row, we stop sending. In a real product, you'd also email the customer and show a big red banner on their dashboard.
- **Dead letters stay visible.** When a delivery runs out of attempts, it's marked `dead`, not deleted, so it can show up on a dashboard with a "resend" button.

Next, we need an API, so there's something to create orders with. In the src/sender folder, create api.ts and paste in the code below (it's also in [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/step-5-api.ts)):

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { assertAcceptableUrl, UnsafeUrlError } from '../ssrf';
import type { SenderDb } from './db';

/**
 * The sending side's HTTP API: a tiny orders service and endpoint management.
 */
export function createSenderApi(db: SenderDb, options: { allowHttpEndpoints?: boolean } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/orders') {
        const body = await readJson(req);
        return send(res, 201, db.createOrder(String(body.customer ?? 'anonymous'), Number(body.total_cents ?? 0)));
      }

      const statusMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
      if (req.method === 'PATCH' && statusMatch) {
        const body = await readJson(req);
        return send(res, 200, db.updateOrderStatus(statusMatch[1]!, String(body.status)));
      }

      if (req.method === 'POST' && url.pathname === '/endpoints') {
        const body = await readJson(req);
        const target = assertAcceptableUrl(String(body.url ?? ''), { allowHttp: options.allowHttpEndpoints });
        // The secret is shown once, now. Store it like a password on your side.
        return send(res, 201, db.addEndpoint(target.toString()));
      }

      const rotateMatch = url.pathname.match(/^\/endpoints\/([^/]+)\/rotate$/);
      if (req.method === 'POST' && rotateMatch) {
        return send(res, 200, { secret: db.rotateSecret(rotateMatch[1]!) });
      }

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return send(res, 422, { error: 'unsafe_url', message: err.message });
      return send(res, 400, { error: 'bad_request', message: (err as Error).message });
    }
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}
```

It's a tiny orders service: you can create an order, change its status, register a webhook endpoint (which runs our URL check) and rotate an endpoint's secret.

Finally, in the src/sender folder, create main.ts:

```ts
/**
 * Runs the sending side: the orders API on :4000 and the dispatcher, ticking
 * once a second.
 *
 *   npm run sender
 *   curl -X POST localhost:4000/endpoints -d '{"url":"http://localhost:4001/webhooks"}'
 *   curl -X POST localhost:4000/orders -d '{"customer":"sam","total_cents":4200}'
 */
import { createSafeAgent } from '../ssrf';
import { createSenderApi } from './api';
import { SenderDb } from './db';
import { DEFAULT_SCHEDULE_MS, Dispatcher } from './dispatcher';

const local = process.env.NODE_ENV !== 'production';
const db = new SenderDb(process.env.SENDER_DB ?? 'sender.db');
const dispatcher = new Dispatcher(db, {
  // Locally your receiver is on localhost, so private addresses are allowed. In production they never are.
  agent: createSafeAgent({ allowPrivate: local }),
  // And locally, nobody wants to wait five minutes for a retry, so the schedule is in seconds.
  scheduleMs: local ? [0, 1_000, 5_000, 10_000, 30_000] : DEFAULT_SCHEDULE_MS,
  disableAfter: 50,
});

createSenderApi(db, { allowHttpEndpoints: local }).listen(4000, () => console.log('sender API on http://localhost:4000'));

setInterval(async () => {
  const report = await dispatcher.tick();
  if (report.attempted) {
    const time = new Date().toISOString().slice(11, 19);
    console.log(`${time} dispatched ${report.attempted}: ${report.delivered} delivered, ${report.retrying} retrying, ${report.dead} dead`);
  }
}, 1_000);
```

It starts the API on port 4000 and runs the dispatcher once a second. Locally, the receiver is on localhost, so private addresses are allowed, and the retry schedule is in seconds, because nobody wants to wait five minutes to see a retry.

Let's run it:

```bash
npm run sender
```

In a second terminal, let's register an endpoint that points at the metadata service, then a real one, and create an order:

```bash
curl -s -X POST localhost:4000/endpoints -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
curl -s -X POST localhost:4000/endpoints -d '{"url":"http://localhost:4001/webhooks"}'
curl -s -X POST localhost:4000/orders -d '{"customer":"sam","total_cents":4200}'
```

Here's what each one printed:

```text
{"error":"unsafe_url","message":"169.254.169.254 is a private address"}
{"id":"ep_53698ce7","secret":"whsec_GdQZTpQqM1R9O14lQ0ruVOk2kBsqh6LS"}
{"id":"ord_8f7b61424496","customer":"sam","total_cents":4200,"status":"created","version":1,"updated_at":"2026-10-08T09:18:19.875Z"}
```

The metadata URL never makes it in. The second call gives us the endpoint's secret. Copy it somewhere, because we'll need it in the next step (and in a real product, this is the only time the customer would ever see it). Now look at the first terminal:

```text
sender API on http://localhost:4000
09:18:20 dispatched 1: 0 delivered, 1 retrying, 0 dead
09:18:21 dispatched 1: 0 delivered, 1 retrying, 0 dead
09:18:27 dispatched 1: 0 delivered, 1 retrying, 0 dead
09:18:38 dispatched 1: 0 delivered, 1 retrying, 0 dead
09:19:13 dispatched 1: 0 delivered, 0 retrying, 1 dead
```

Nothing is listening on port 4001 yet, so every attempt fails. You can see the schedule at work: an attempt straight away, then roughly 1, 5, 10 and 30 seconds apart, and then the delivery is marked dead. Remember Sam's order. We'll come back for it in Step 7.

Leave the sender running.

## Step 6: Receiving It Properly

Now the other side. If you're building a receiver, everything in this step applies to you, even if the sender gets none of the above right.

The receiver's job in the request handler is small: verify the request, write it down, and say thanks. The actual work happens afterwards. Why not do the work right there in the handler?

- **Speed.** The sender has a timeout. If your handler sends an email, charges a card and updates three tables before replying, a slow day turns into timeouts, retries and more duplicates.
- **Safety.** If the process crashes after replying but before finishing the work, the event is still written down, waiting. (That's exactly the bug from my payments story.)
- **Deduplication.** Duplicates get stopped at the database, before anything can run twice.

The place we write events down is called an **inbox**, and it's the receiver's mirror of the sender's outbox.

In the src folder, create a folder called receiver, and in it, a file called receiver.ts. It's long, so copy it from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/step-6-receiver.ts).

Here's the request handler:

```ts
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks') return reply(res, 404);
    const chaos = options.chaos?.(req) ?? 'ok';
    if (chaos === 'fail-before-store') return reply(res, 500);

    // Verify the raw bytes, exactly as they arrived.
    const raw = await readRaw(req);
    if (!verifiesWithAny(options.secrets, raw, req.headers)) {
      stats.rejected++;
      return reply(res, 401);
    }

    stats.received++;
    const fresh = options.db.store(String(req.headers['webhook-id']), raw.toString(), 'webhook');
    if (!fresh) stats.duplicates++;

    if (chaos === 'drop-after-store') return req.socket.destroy(); // stored, but the sender never hears back
    if (chaos === 'slow-after-store') await new Promise((resolve) => setTimeout(resolve, 3_000));

    // Acknowledge fast. The work happens off the request path.
    return reply(res, 204);
  });
```

It reads the raw bytes, verifies them with any of the secrets it knows (so you can keep the old one during a rotation), stores the event and replies `204`. Ignore the `chaos` lines for now: they let the experiment in Step 8 make this receiver misbehave on purpose.

And here's `store`, the inbox:

```ts
  /** Returns false when we've seen this webhook-id before. */
  store(webhookId: string, payload: string, source: 'webhook' | 'reconcile'): boolean {
    const { changes } = this.sqlite
      .prepare('INSERT OR IGNORE INTO inbox (webhook_id, payload, source, received_at) VALUES (?, ?, ?, ?)')
      .run(webhookId, payload, source, Date.now());
    return changes === 1;
  }
```

`webhook_id` is the inbox's primary key, so a duplicate delivery simply inserts nothing. The `204` goes back either way, because the sender doesn't care that we'd already seen it, only that we have it.

Then there's the order problem. Say an order goes from `paid` to `shipped`, and the `shipped` event happens to arrive first. If we apply events in the order they arrive, the order ends up `paid`, which is wrong. So `processInbox` lets the database refuse to go backwards:

```ts
      this.sqlite.prepare(`
        INSERT INTO orders (id, status, version) VALUES (?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET status = excluded.status, version = excluded.version
        WHERE excluded.version > orders.version`).run(event.data.id, event.data.status, event.data.version);
```

An event for version 2 that turns up after version 3 does nothing. If the API you're receiving from doesn't send versions, use the resource's `updated_at`, or treat the webhook as a nudge: ignore its data and fetch the current state from the API. That's slower, but much harder to get wrong, and it's what I'd do for anything involving money.

Now, in the src/receiver folder, create main.ts:

```ts
/**
 * Runs a receiver on :4001 that verifies, stores and processes webhooks.
 *
 *   WEBHOOK_SECRET=whsec_... npm run receiver
 */
import { createReceiver, ReceiverDb } from './receiver';

const secrets = (process.env.WEBHOOK_SECRET ?? '').split(',').filter(Boolean);
if (secrets.length === 0) {
  console.error('Set WEBHOOK_SECRET to the secret you got when you registered the endpoint.');
  process.exit(1);
}

const db = new ReceiverDb(process.env.RECEIVER_DB ?? 'receiver.db');
const { server } = createReceiver({ db, secrets });
server.listen(4001, () => console.log('receiver on http://localhost:4001/webhooks'));

setInterval(() => {
  const processed = db.processInbox();
  if (processed) {
    console.log(`processed ${processed} event${processed === 1 ? '' : 's'}`);
    console.table(db.orders());
  }
}, 500);
```

It starts the receiver on port 4001, and every half a second, it applies whatever is in the inbox and prints the orders it knows about.

In a new terminal, start it with the secret you copied in Step 5:

```bash
WEBHOOK_SECRET=whsec_your_secret_here npm run receiver
```

Back in the curl terminal, let's create an order for Ada, then mark it as paid. Replace `ord_your_order_id` with the ID the first call gives you:

```bash
curl -s -X POST localhost:4000/orders -d '{"customer":"ada","total_cents":1500}'
curl -s -X PATCH localhost:4000/orders/ord_your_order_id -d '{"status":"paid"}'
```

```text
{"id":"ord_7878dd7d6b82","customer":"ada","total_cents":1500,"status":"created","version":1,"updated_at":"2026-10-08T09:19:16.896Z"}
{"id":"ord_7878dd7d6b82","customer":"ada","total_cents":1500,"status":"paid","version":2,"updated_at":"2026-10-08T09:19:18.912Z"}
```

Here's the receiver:

```text
receiver on http://localhost:4001/webhooks
processed 1 event
┌─────────┬────────────────────┬───────────┬─────────┐
│ (index) │ id                 │ status    │ version │
├─────────┼────────────────────┼───────────┼─────────┤
│ 0       │ 'ord_7878dd7d6b82' │ 'created' │ 1       │
└─────────┴────────────────────┴───────────┴─────────┘
processed 1 event
┌─────────┬────────────────────┬────────┬─────────┐
│ (index) │ id                 │ status │ version │
├─────────┼────────────────────┼────────┼─────────┤
│ 0       │ 'ord_7878dd7d6b82' │ 'paid' │ 2       │
└─────────┴────────────────────┴────────┴─────────┘
```

Both events arrived, were verified, stored and applied. Now let's be an attacker and send the receiver a request with a made-up signature, printing only the status code it sends back:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4001/webhooks -H 'webhook-id: msg_fake' -H "webhook-timestamp: $(date +%s)" -H 'webhook-signature: v1,bm9wZQ==' -d '{}'
```

```text
401
```

Rejected. Notice that Sam's order from Step 5 isn't on the receiver at all. Its delivery died before the receiver existed.

## Step 7: Catching Up on Missed Events

We've done everything right, and we still lost Sam's order. That's going to happen in real life too: a receiver is down for two days over a holiday, the retries run out, and the deliveries are marked dead.

So we give receivers a way to catch up. Remember that the outbox is also an append-only log? Let's expose it. In src/sender/api.ts, add this right above the `return send(res, 404, ...)` line:

```ts
      if (req.method === 'GET' && url.pathname === '/events') {
        // The reconciliation feed: every event, in order, from a cursor.
        const after = Number(url.searchParams.get('after') ?? 0);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
        const events = db.eventsAfter(after, limit).map((e) => ({ seq: e.seq, id: e.id, payload: JSON.parse(e.payload) }));
        return send(res, 200, { events, next: events.at(-1)?.seq ?? after });
      }
```

It returns events in order, after a cursor. The receiver keeps track of the last one it saw and asks for everything after it.

Next, in src/receiver/receiver.ts, add this function right below `createReceiver`:

```ts
/**
 * Catch up on anything the webhooks didn't deliver: page through the sender's
 * events feed from where we last stopped.
 */
export async function reconcile(db: ReceiverDb, senderUrl: string): Promise<number> {
  let recovered = 0;
  for (;;) {
    const res = await fetch(`${senderUrl}/events?after=${db.cursor('events')}&limit=200`);
    if (!res.ok) throw new Error(`events feed returned ${res.status}`);
    const page = (await res.json()) as { events: Array<{ seq: number; id: string; payload: unknown }>; next: number };
    for (const event of page.events) {
      if (db.store(event.id, JSON.stringify(event.payload), 'reconcile')) recovered++;
    }
    if (page.events.length === 0) return recovered;
    db.setCursor('events', page.next);
  }
}
```

It pages through the feed and puts every event into the *same inbox* the webhooks use. Because the inbox is keyed by the event's ID, it doesn't matter whether an event arrives by webhook, through this feed or both. It's applied once.

Finally, replace src/receiver/main.ts with this:

```ts
/**
 * Runs a receiver on :4001 that verifies, stores and processes webhooks, and
 * catches up on anything it missed from the sender's events feed, on startup
 * and every 30 seconds.
 *
 *   WEBHOOK_SECRET=whsec_... npm run receiver
 */
import { createReceiver, reconcile, ReceiverDb } from './receiver';

const secrets = (process.env.WEBHOOK_SECRET ?? '').split(',').filter(Boolean);
if (secrets.length === 0) {
  console.error('Set WEBHOOK_SECRET to the secret you got when you registered the endpoint.');
  process.exit(1);
}

const db = new ReceiverDb(process.env.RECEIVER_DB ?? 'receiver.db');
const { server } = createReceiver({ db, secrets });
server.listen(4001, () => console.log('receiver on http://localhost:4001/webhooks'));

setInterval(() => {
  const processed = db.processInbox();
  if (processed) {
    console.log(`processed ${processed} event${processed === 1 ? '' : 's'}`);
    console.table(db.orders());
  }
}, 500);

// Catch up on anything the webhooks missed: once now, then every 30 seconds.
const senderUrl = process.env.SENDER_URL ?? 'http://localhost:4000';
async function catchUp(): Promise<void> {
  const recovered = await reconcile(db, senderUrl).catch((err) => (console.warn(`reconcile failed: ${err.message}`), 0));
  if (recovered) console.log(`reconciled ${recovered} event${recovered === 1 ? '' : 's'} the webhooks missed`);
}
void catchUp();
setInterval(catchUp, 30_000);
```

The receiver now catches up once when it starts, and then every 30 seconds. In production, every few minutes is plenty. (Also put the feed behind the same API keys as the rest of your API, and only show each customer their own events.)

Stop both servers (Ctrl+C), and start them again so they pick up the changes. Start the sender first, because the receiver reads its events feed as soon as it starts:

```bash
npm run sender
```

```bash
WEBHOOK_SECRET=whsec_your_secret_here npm run receiver
```

```text
receiver on http://localhost:4001/webhooks
reconciled 1 event the webhooks missed
processed 1 event
┌─────────┬────────────────────┬───────────┬─────────┐
│ (index) │ id                 │ status    │ version │
├─────────┼────────────────────┼───────────┼─────────┤
│ 0       │ 'ord_7878dd7d6b82' │ 'paid'    │ 2       │
│ 1       │ 'ord_8f7b61424496' │ 'created' │ 1       │
└─────────┴────────────────────┴───────────┴─────────┘
```

There's Sam's order! This was the receiver's first look at the feed, so it read it from the beginning. The inbox ignored the two events it already had from Ada's order, and the one event the webhooks never delivered went in and was applied. You can look at the feed yourself:

```bash
curl -s 'localhost:4000/events?after=0&limit=2'
```

```text
{"events":[{"seq":1,"id":"msg_f1b44aef32a64bf293249ba8e430a753","payload":{"type":"order.created","timestamp":"2026-10-08T09:18:19.875Z","data":{"id":"ord_8f7b61424496","customer":"sam","total_cents":4200,"status":"created","version":1,"updated_at":"2026-10-08T09:18:19.875Z"}}},{"seq":2,"id":"msg_3c07dad854c04ad0900ca02b8497eb98","payload":{"type":"order.created","timestamp":"2026-10-08T09:19:16.896Z","data":{"id":"ord_7878dd7d6b82","customer":"ada","total_cents":1500,"status":"created","version":1,"updated_at":"2026-10-08T09:19:16.896Z"}}}],"next":2}
```

Phew! That's the whole system. Let's see how it holds up when things go wrong on purpose.

## Step 8: Testing It Under Chaos

`npm run chaos` runs an experiment. It points two senders at the same badly behaved receiver. That receiver:

- fails 15% of requests outright
- does the work on 8% of them and then drops the connection, so the sender never hears back
- stalls past the sender's timeout on 4%
- fails every request for a second and a half in the middle, as if it were down

The workload is 150 orders, each created and then moved through `paid`, `shipped` and `delivered`, with the updates for different orders mixed together. That's 600 events.

The **naive** sender is the code from the start of Step 3, with three quick retries added, because that's what most of us add next. Its receiver applies whatever arrives, in the order it arrives. The **handbook** sender is everything we just built, with the retry schedule squeezed into about a second so the experiment finishes. At the end, the receiver catches up from the events feed once. The script counts every time each receiver applies an event, so both columns of the table are measured, not assumed.

In the scripts folder, create chaos.ts and paste in the code from [this gist](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/05-webhooks-handbook/gists/chaos.ts). It's the longest file in the project, so I won't paste it here.

Run it (it takes about 30 seconds, and saves its results in a results folder too):

```bash
npm run chaos
```

```text
Seed 7. 150 orders, each created then moved through paid → shipped → delivered.

| Approach | Events | Lost | Applied more than once | Wrong final order state | Recovered by reconciliation |
|---|---:|---:|---:|---:|---:|
| Naive: send inline, retry 3×, apply on arrival | 600 | 174 (29.0%) | 46 (7.7%) | 29 (19.3%) | 0 |
| Handbook: outbox, backoff, inbox, versions, reconcile | 600 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 4 |

The handbook receiver absorbed 73 duplicate deliveries without applying them twice.
Before it caught up from the events feed, 0 of its orders were in the wrong state.
```

![Bar chart comparing the two senders: the naive sender lost 29.0% of events, applied 7.7% more than once and left 19.3% of orders in the wrong state; the handbook sender scored 0% on all three.](images/chaos.svg)

The outage is timed by the clock, so your numbers will move a little from run to run.

Let's go through what happened. Almost all of the naive sender's losses happened during the 1.5-second outage, because its three retries come a few milliseconds apart, so they all land inside it too. The handbook sender's retries are spread out, so they land after it. Each of the naive receiver's double-applied events is the receiver doing the work and the sender never hearing back, either because the connection dropped or because the reply came after the sender's timeout. In a real app, that's "sent the confirmation email twice", 46 times. And almost one in five of its orders ended up in the wrong state, without a single error or warning.

On the handbook side, the inbox absorbed 73 duplicate deliveries without applying any of them twice, and 4 events only got through by way of the events feed. In this run, those had already been overtaken by newer updates to the same orders, so every order was right even before the receiver caught up. The feed matters when the event you missed is an order's last update, and then it's the only way that order ends up right.

## How It All Works

Let's review the whole flow:

![The whole system: the sender writes the order, event and delivery job in one transaction; a dispatcher signs and sends with retries through an SSRF-safe agent; the receiver verifies, stores in an inbox and acknowledges; a worker applies events with a version check; reconciliation reads the sender's events feed.](images/architecture.svg)

1. When something changes, the sender writes the change, the event and one delivery job per endpoint in a single transaction.
2. The dispatcher picks up due deliveries, signs them to the Standard Webhooks spec and sends them through an agent that refuses private addresses, without following redirects.
3. Failed deliveries are retried on a schedule with jitter, and marked dead when they run out of attempts.
4. The receiver verifies the raw body, stores the event in its inbox (ignoring duplicates) and replies straight away.
5. A worker applies events from the inbox, and the version check stops late events from undoing newer ones.
6. The receiver reads the sender's events feed on startup and on a schedule, so anything the webhooks missed still arrives, exactly once.

## Conclusion

In this tutorial, we built both sides of a webhook system to the Standard Webhooks spec: an outbox, signatures, SSRF checks, retries with backoff on the sending side, and an inbox, version checks and reconciliation on the receiving side. Then we watched it lose nothing under conditions where the naive version lost almost a third of its events. It's a long tutorial, but I wanted to cover both sides properly, since most of us only ever see one of them.

You can find the complete project, with tests, [here](https://github.com/Ernesto-tha-great/webhooks-handbook). If you run into any issues while following along, drop a comment or reach out to me. Thanks for reading!
