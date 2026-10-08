# Offline-First in Practice: Building a Write Queue for React Native With TypeScript

*Bad connections make mobile apps lose some requests and send others twice. In this tutorial, we build a small queue that fixes both, one step at a time.*

**Ernest Nnamdi** · React Native · TypeScript · Node.js

---

When I was building the mobile app at Groupify, we shipped fast: seven versions in about a year. Somewhere along the line, a user sent us a screenshot of something they had created showing up twice, identical in every way. A few days later, someone else reported that something they had created never showed up at all.

I spent an embarrassing amount of time looking for a bug in our GraphQL resolvers. They were fine. The TL;DR of the issue was that our users were saving things on bad connections. Sometimes the request reached our server, the record got created, and the response died somewhere on its way back to the phone. The app showed an error, so the user did what any reasonable human would do and tapped "Save" again. Other times, the request never left the phone at all, and once the app was closed, it was gone for good.

I knew about offline-first apps and idempotency in theory. I could even explain both in an interview. But I had never actually needed either, because everything I'd built until then had been tested on office Wi-Fi.

In this tutorial, I'm going to show you how to build a small write queue for React Native that fixes both problems: requests that get lost, and requests that get sent twice. We'll build and test everything in Node.js first, so you don't need a phone to follow along, and then we'll plug it into an Expo app at the end.

### Okay, but what's wrong with fetch and a retry?

Nothing, until the response gets lost.

You've probably had this happen with a banking app. You send money, the screen spins for a while, and then it tells you something went wrong. Did the money leave your account? You don't know. If you send it again, you might pay twice. If you don't, the person might never get paid.

Your app is in exactly that position every time a request times out. A timeout tells you that *you* didn't get an answer. It doesn't tell you whether the server did the work.

![Without an idempotency key, a retry after a lost response creates a second order. With a key, the server recognises the retry and sends back the saved reply.](images/lost-response.svg)

The fix has a fancy name: idempotency. The HTTP specification, [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods), defines it like so:

> A request method is considered "idempotent" if the intended effect on the server of multiple identical requests with that method is the same as the effect for a single such request.

In other words, sending a request twice should do the same thing as sending it once. `GET` and `PUT` already behave like that. `POST`, which is what you use to create things, does not. So we'll make it behave that way ourselves: every request gets a unique key, and the server remembers which keys it has already handled. Stripe's API works like this, and there's an [IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) that aims to standardise the `Idempotency-Key` header we'll be using.

### Sounds good, but why do we need a queue?

Because a key only fixes the duplicates. If the app is killed while it's still retrying, or the connection is down for longer than a few quick retries, the request is simply gone. To fix that, a request has to be written to disk *before* you tell the user it's saved, and something has to keep trying to send it, patiently, until the server answers.

That something is our queue. That being said, let's get to building!

## Prerequisites

- Node.js 20 or newer
- Some familiarity with TypeScript
- curl and a bash-style terminal (on Windows, use Git Bash or WSL)
- For the last section, an Expo app, if you want to see it running on a phone

## What Are We Building?

We'll build:

- a small orders API that, on purpose, sometimes saves an order and then hangs up before replying
- two scripts that show how plain `fetch` with retries duplicates and loses orders
- an `OfflineQueue` class that saves every request to disk, sends it with an idempotency key, backs off between retries and checks that your server is actually reachable before sending
- a chaos script that throws an outage and a few app restarts at all of it, and counts what survives
- a React Native hook that runs the queue inside an Expo app

Here's what the project will look like when we're done:

```text
offline-queue/
  server/
    app.ts            # the orders API
    main.ts           # starts it on port 8787
  src/
    queue.ts          # the OfflineQueue class
    storage.ts        # saves the queue to a JSON file
    backoff.ts        # how long to wait between retries
    probe.ts          # checks that your server is reachable
  scripts/
    naive.ts          # fetch + retries
    with-keys.ts      # fetch + retries + an idempotency key
    place-orders.ts   # plays the part of the app
    chaos.ts          # one bad afternoon, three approaches
  package.json
  tsconfig.json
```

## Step 1: Setting Up Our Project

Let's start by creating a folder for the project and initialising it.

```bash
mkdir offline-queue
cd offline-queue
npm init -y
```

Next, we install TypeScript, the Node.js types and tsx, which lets us run TypeScript files directly without a build step.

```bash
npm install --save-dev typescript tsx @types/node
```

Open the folder in VS Code (or your favourite code editor). In package.json, set `"type"` to `"module"` (add it if it isn't there) and replace the `scripts` section with the one below. The `"type": "module"` line is important: it lets us use `import` and top-level `await` in our scripts.

```json
{
  "name": "offline-queue",
  "type": "module",
  "scripts": {
    "server": "tsx server/main.ts",
    "naive": "tsx scripts/naive.ts",
    "with-keys": "tsx scripts/with-keys.ts",
    "orders": "tsx scripts/place-orders.ts",
    "chaos": "tsx scripts/chaos.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

Finally, create a tsconfig.json file in the root of the project and paste in the code below.

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
  "include": ["server", "src", "scripts", "test"]
}
```

We're using `"moduleResolution": "Bundler"` so our imports don't need `.js` extensions. That way, the same files will work in React Native later without any changes.

## Step 2: Building a Server That Hangs Up on You

To test a queue, we need a server that misbehaves the same way a bad connection does. Create a folder called server, and in it, a file called app.ts. Paste in the code below.

```ts
import { createServer, type IncomingMessage } from 'node:http';

export interface Order {
  id: number;
  sku: string;
  qty: number;
}

export interface ServerOptions {
  /** Share of orders that get saved, and then the connection drops before the reply. */
  dropRate?: number;
  random?: () => number;
}

export function createOrdersServer(options: ServerOptions = {}) {
  const dropRate = options.dropRate ?? 0;
  const random = options.random ?? Math.random;

  const orders: Order[] = [];
  let down = false;

  const server = createServer(async (req, res) => {
    if (down) {
      req.socket.destroy();
      return;
    }

    if (req.method === 'GET' && req.url === '/generate_204') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/orders') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(orders));
      return;
    }

    if (req.method === 'POST' && req.url === '/orders') {
      const body = JSON.parse(await readBody(req)) as Partial<Order>;
      if (typeof body.sku !== 'string' || !Number.isInteger(body.qty) || body.qty! < 1) {
        res.writeHead(422, { 'content-type': 'application/json' }).end('{"error":"sku and qty are required"}');
        return;
      }

      const order: Order = { id: orders.length + 1, sku: body.sku, qty: body.qty! };
      orders.push(order);

      if (random() < dropRate) {
        // The order is saved. The phone will never hear about it.
        req.socket.destroy();
        return;
      }

      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(order));
      return;
    }

    res.writeHead(404).end();
  });

  return {
    server,
    orders,
    /** Simulate an outage: every request gets its connection dropped. */
    setDown(value: boolean) {
      down = value;
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
```

The `createOrdersServer` function gives us a tiny orders API with three routes:

- `GET /generate_204` replies with an empty 204. We'll use it in Step 8, so ignore it for now.
- `GET /orders` lists every order the server has saved.
- `POST /orders` saves an order, as long as it has a `sku` and a `qty`.

The interesting part is `dropRate`. After saving an order, the server rolls a die, and if it loses, it destroys the connection instead of replying. The order is saved, but the phone never hears about it. That's the banking app moment from earlier, on demand.

It also returns a `setDown` function, which makes the server drop every request without saving anything. We'll use that later to fake an outage.

Next, create a main.ts file in the same folder to start the server:

```ts
import { createOrdersServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const { server } = createOrdersServer({ dropRate: Number(process.env.DROP_RATE ?? 0.3) });

server.listen(port, () => {
  console.log(`Orders API on http://localhost:${port}`);
});
```

Let's run it.

```bash
npm run server
```

You should see `Orders API on http://localhost:8787`. Leave that terminal running, open a second one, and send four orders with curl:

```bash
for i in 1 2 3 4; do
  curl -sS -X POST localhost:8787/orders -H 'content-type: application/json' -d "{\"sku\":\"SKU-$i\",\"qty\":1}"
  echo
done
```

Here's what I got. Yours will be a little different, because the hang-ups are random.

```text
curl: (52) Empty reply from server
{"id":2,"sku":"SKU-2","qty":1}
{"id":3,"sku":"SKU-3","qty":1}
curl: (52) Empty reply from server
```

curl says it got nothing back for SKU-1 and SKU-4. Now ask the server what it actually saved:

```bash
curl localhost:8787/orders
```

```json
[{"id":1,"sku":"SKU-1","qty":1},{"id":2,"sku":"SKU-2","qty":1},{"id":3,"sku":"SKU-3","qty":1},{"id":4,"sku":"SKU-4","qty":1}]
```

All four are there. The two "failed" orders weren't failures at all.

## Step 3: Sending Orders the Usual Way

Now let's see what the usual approach does with a server like this. Create a folder called scripts, and in it, a file called naive.ts.

```ts
// Send 20 orders the way most apps do: fetch, and retry if it fails.
const API = process.env.API ?? 'http://localhost:8787';

async function placeOrder(sku: string, qty: number) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, qty }),
      });
      if (res.ok) return;
    } catch {
      // network error: try again
    }
  }
  console.log(`Gave up on ${sku}`);
}

for (let i = 1; i <= 20; i++) {
  await placeOrder(`SKU-${i}`, 1);
}

try {
  const orders = (await (await fetch(`${API}/orders`)).json()) as Array<{ sku: string }>;
  const unique = new Set(orders.map((order) => order.sku)).size;
  console.log(`Tapped "Save" 20 times. The server has ${orders.length} orders for ${unique} different items.`);
} catch {
  console.log("Couldn't reach the server to count the orders.");
}
```

This is what most apps do: send the request, and if it fails, try again, up to three times. The script places 20 orders, then asks the server how many it ended up with. Restart the server first (Ctrl+C, then `npm run server` again) so it starts with an empty list, then run:

```bash
npm run naive
```

```text
Tapped "Save" 20 times. The server has 27 orders for 20 different items.
```

Seven of those are duplicates. Every time the server hung up after saving, the script assumed the order had failed and sent it again. Your numbers will be different, because the hang-ups are random. You might even see a "Gave up on SKU-7" line or two: that's an order that was saved three times, while the script thinks it was never saved at all.

Now stop the server and run the script one more time:

```text
Gave up on SKU-1
Gave up on SKU-2
...
Gave up on SKU-20
Couldn't reach the server to count the orders.
```

Three quick retries are over in milliseconds. If the connection is gone for longer than that, every single order is lost. So the usual approach gives us both of our bugs: duplicates when replies get lost, and lost orders when the network goes away.

## Step 4: Adding Idempotency Keys

Let's fix the duplicates first. This is a change on the server: it needs to remember every key it has seen, together with the reply it sent.

In server/app.ts, add a `replies` map right below the `orders` array:

```ts
  const orders: Order[] = [];
  const replies = new Map<string, string>();
```

Then update the `POST /orders` handler so it checks the key before doing anything, and saves the reply under that key after creating the order. Your handler should now look like this:

```ts
    if (req.method === 'POST' && req.url === '/orders') {
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string' && replies.has(key)) {
        // We've seen this key before. Send the same answer, don't make a new order.
        res.writeHead(201, { 'content-type': 'application/json' }).end(replies.get(key));
        return;
      }

      const body = JSON.parse(await readBody(req)) as Partial<Order>;
      if (typeof body.sku !== 'string' || !Number.isInteger(body.qty) || body.qty! < 1) {
        res.writeHead(422, { 'content-type': 'application/json' }).end('{"error":"sku and qty are required"}');
        return;
      }

      const order: Order = { id: orders.length + 1, sku: body.sku, qty: body.qty! };
      orders.push(order);
      const reply = JSON.stringify(order);
      if (typeof key === 'string') replies.set(key, reply);

      if (random() < dropRate) {
        // The order is saved. The phone will never hear about it.
        req.socket.destroy();
        return;
      }

      res.writeHead(201, { 'content-type': 'application/json' }).end(reply);
      return;
    }
```

Two things to note here:

- The key check happens *before* the order is created. If the server saw the key, it sends back the exact reply it sent the first time and stops there.
- The reply is saved *before* the dice roll. So when the connection drops, the retry still finds the saved reply.

In a real backend, `replies` would be a table with a unique constraint on the key, written in the same transaction as the order. Our `Map` plays that role here.

Next, create scripts/with-keys.ts. It's the same as naive.ts, with one difference: each order gets a key, and the key is reused on every retry.

```ts
// The same 20 orders, but every order gets its own idempotency key.
const API = process.env.API ?? 'http://localhost:8787';

async function placeOrder(sku: string, qty: number) {
  const key = crypto.randomUUID(); // one key per order, reused on every retry
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ sku, qty }),
      });
      if (res.ok) return;
    } catch {
      // network error: try again
    }
  }
  console.log(`Gave up on ${sku}`);
}

for (let i = 1; i <= 20; i++) {
  await placeOrder(`SKU-${i}`, 1);
}

try {
  const orders = (await (await fetch(`${API}/orders`)).json()) as Array<{ sku: string }>;
  const unique = new Set(orders.map((order) => order.sku)).size;
  console.log(`Tapped "Save" 20 times. The server has ${orders.length} orders for ${unique} different items.`);
} catch {
  console.log("Couldn't reach the server to count the orders.");
}
```

Restart the server and run it:

```bash
npm run with-keys
```

```text
Tapped "Save" 20 times. The server has 20 orders for 20 different items.
```

No more duplicates. But stop the server and run it again, and you'll get the same wall of "Gave up on…" as before. The key fixed the duplicates. It did nothing for the orders we lost. For that, we need the queue.

## Step 5: Saving Requests Before Sending Them

The first rule of our queue is simple: a request goes to disk *before* we tell the user it's saved. If the app is killed a second later, the request is still there when it opens again.

Create a folder called src, and in it, a file called queue.ts. Paste in the code below.

```ts
export interface QueuedRequest {
  /** A unique ID for this request. Sent as the Idempotency-Key header on every attempt. */
  id: string;
  path: string;
  body: unknown;
  attempts: number;
  /** Saved with the item, so a retry schedule survives the app being killed. */
  nextAttemptAt: number;
  lastError?: string;
}

/** Where the queue keeps its requests between launches. */
export interface Storage {
  load(): Promise<QueuedRequest[]>;
  save(items: QueuedRequest[]): Promise<void>;
}

export interface QueueOptions {
  baseUrl: string;
  storage: Storage;
  /** Makes the unique ID. On React Native, pass expo-crypto's randomUUID. */
  createId?: () => string;
}

export class OfflineQueue {
  private items: QueuedRequest[] = [];
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly options: QueueOptions) {}

  /** Resolves once the request is on disk, so it's safe to tell the user "Saved". */
  async enqueue(path: string, body: unknown): Promise<QueuedRequest> {
    await this.load();
    const item: QueuedRequest = {
      id: this.options.createId?.() ?? crypto.randomUUID(),
      path,
      body,
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    this.items.push(item);
    await this.save();
    return item;
  }

  async pending(): Promise<number> {
    await this.load();
    return this.items.length;
  }

  /** Saves run one after another, so a double tap can't make two writes trip over each other. */
  private save(): Promise<void> {
    const items = this.items;
    this.saving = this.saving.catch(() => {}).then(() => this.options.storage.save(items));
    return this.saving;
  }

  private load(): Promise<void> {
    this.loading ??= this.options.storage.load().then((saved) => {
      this.items = [...saved, ...this.items];
    });
    return this.loading;
  }
}
```

Here's what's going on:

- `QueuedRequest` is what we store for every request. The `id` doubles as the idempotency key, so a request keeps the same key for its whole life, across retries and app restarts.
- `Storage` is anything that can load and save the list. On a phone, that'll be AsyncStorage. Here, it'll be a JSON file.
- `enqueue` loads whatever is already saved, adds the new request, and saves the whole list. It only resolves once the save is done, which is what makes it safe to show "Saved" right after.
- `load` reads the saved list once, the first time anything needs it. If you enqueue something before the load finishes, the new request is kept after the saved ones.
- `save` lines the writes up, one after another. If the user double-taps "Save", two writes would otherwise run at the same time and trip over each other.

Now for the storage. In the src folder, create a file called storage.ts.

```ts
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { QueuedRequest, Storage } from './queue';

/** A JSON file on disk. On a phone, AsyncStorage or MMKV plays this part. */
export function fileStorage(path: string): Storage {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as QueuedRequest[];
      } catch {
        return [];
      }
    },
    async save(items) {
      // Write to a temporary file, then rename it over the old one. A rename is
      // atomic, so a crash mid-write can't leave half a file behind.
      await writeFile(`${path}.tmp`, JSON.stringify(items));
      await rename(`${path}.tmp`, path);
    },
  };
}
```

The temporary file and rename might look like overkill, but they matter. If the app crashes halfway through writing the file, you'd otherwise be left with half a JSON file and an empty queue.

To see it work, we need something to play the part of the app. In the scripts folder, create place-orders.ts.

```ts
// Plays the part of the app: saves some orders, then tries to send them.
//   npx tsx scripts/place-orders.ts 5    # save 5 new orders
//   npx tsx scripts/place-orders.ts 0    # save nothing, just send what's waiting
import { readFile } from 'node:fs/promises';
import { OfflineQueue, type QueuedRequest } from '../src/queue';
import { fileStorage } from '../src/storage';

const API = process.env.API ?? 'http://localhost:8787';

const queue = new OfflineQueue({
  baseUrl: API,
  storage: fileStorage('queue.json'),
});

const count = Number(process.argv[2] ?? 5);
for (let i = 1; i <= count; i++) {
  await queue.enqueue('/orders', { sku: `SKU-${Date.now()}-${i}`, qty: 1 });
}
await showQueue();

/** Prints what's in queue.json right now. */
async function showQueue() {
  const items = JSON.parse(await readFile('queue.json', 'utf8').catch(() => '[]')) as QueuedRequest[];
  console.log(`${items.length} in the queue`);
  if (items.length === 0) return;
  console.table(
    items.map((item) => ({
      attempts: item.attempts,
      'next try in': `${Math.max(0, (item.nextAttemptAt - Date.now()) / 1000).toFixed(1)} s`,
      'last error': item.lastError ?? '',
    })),
  );
}
```

It saves however many orders you ask for, then prints what's in queue.json. Run it twice:

```bash
npm run orders -- 3
npm run orders -- 2
```

```text
3 in the queue
┌─────────┬──────────┬─────────────┬────────────┐
│ (index) │ attempts │ next try in │ last error │
├─────────┼──────────┼─────────────┼────────────┤
│ 0       │ 0        │ '0.0 s'     │ ''         │
│ 1       │ 0        │ '0.0 s'     │ ''         │
│ 2       │ 0        │ '0.0 s'     │ ''         │
└─────────┴──────────┴─────────────┴────────────┘
5 in the queue
┌─────────┬──────────┬─────────────┬────────────┐
│ (index) │ attempts │ next try in │ last error │
├─────────┼──────────┼─────────────┼────────────┤
│ 0       │ 0        │ '0.0 s'     │ ''         │
│ 1       │ 0        │ '0.0 s'     │ ''         │
│ 2       │ 0        │ '0.0 s'     │ ''         │
│ 3       │ 0        │ '0.0 s'     │ ''         │
│ 4       │ 0        │ '0.0 s'     │ ''         │
└─────────┴──────────┴─────────────┴────────────┘
```

Two separate runs of the script, which is basically two launches of the app, and the queue remembers all five. Nothing gets sent yet, though. Let's fix that.

## Step 6: Sending What's in the Queue

Back in src/queue.ts, we need a few more things. First, two new options in `QueueOptions`, a timeout and a callback for requests the server rejects:

```ts
export interface QueueOptions {
  baseUrl: string;
  storage: Storage;
  /** Makes the unique ID. On React Native, pass expo-crypto's randomUUID. */
  createId?: () => string;
  timeoutMs?: number;
  onDeadLetter?: (item: QueuedRequest, reason: string) => void;
}
```

Right below `QueueOptions`, add a type for the three ways a send can end:

```ts
type Result = { outcome: 'delivered' } | { outcome: 'rejected' | 'retry'; reason: string };
```

In the class, add a `flushing` field below `saving`:

```ts
  private flushing: Promise<void> | null = null;
```

Then add these methods to the class, right below `pending()`:

```ts
  /** Sends everything that's due. Two callers at once share one flush. */
  flush(): Promise<void> {
    this.flushing ??= this.sendDue().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendDue(): Promise<void> {
    await this.load();
    const due = this.items.filter((item) => item.nextAttemptAt <= Date.now());
    if (due.length === 0) return;

    for (const item of due) {
      const result = await this.send(item);

      if (result.outcome === 'delivered') {
        this.remove(item);
      } else if (result.outcome === 'rejected') {
        // The server read it and said no. Retrying won't change its mind.
        this.remove(item);
        this.options.onDeadLetter?.(item, result.reason);
      } else {
        item.attempts++;
        item.lastError = result.reason;
        item.nextAttemptAt = Date.now();
      }
      await this.save();

      // If the network just failed us, don't fire the rest of the queue into it.
      if (result.outcome === 'retry') break;
    }
  }

  private async send(item: QueuedRequest): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.options.baseUrl}${item.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': item.id },
        body: JSON.stringify(item.body),
        signal: controller.signal,
      });
      if (res.ok) return { outcome: 'delivered' };
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'retry', reason: `HTTP ${res.status}` };
      }
      return { outcome: 'rejected', reason: `HTTP ${res.status}: ${await res.text()}` };
    } catch (err) {
      return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private remove(item: QueuedRequest): void {
    this.items = this.items.filter((other) => other.id !== item.id);
  }
```

Let's walk through them:

- `flush` is what the app calls whenever it thinks it's a good time to send: on launch, when the network comes back, after saving something new. If a flush is already running, a second caller just gets the same promise. Without that, two flushes could send the same request at the same time.
- `sendDue` goes through every request that's due, in order. A 2xx means delivered, so it's removed. A 4xx means the server read the request and said no, so retrying won't help: it's removed and handed to `onDeadLetter`, so the app can tell the user. Anything else, like a network error, a timeout, a 408, a 429 or a 5xx, means "try again later".
- After every request, it saves the list, so if the app dies halfway through a flush, nothing that wasn't delivered is forgotten. A request that was delivered just before the crash might get sent again, but that's exactly the case the key takes care of.
- If a send fails because of the network, it stops. There's no point firing the next twenty requests into a connection that just failed.
- `send` adds the `Idempotency-Key` header and gives up after `timeoutMs`. We're using an `AbortController` with a timer rather than `AbortSignal.timeout()`, because the second one isn't available in every React Native version.

Finally, in scripts/place-orders.ts, add `await queue.flush();` right above `await showQueue();`.

Make sure the server is stopped, delete queue.json (it still has the orders from Step 5), and save five orders:

```bash
npm run orders -- 5
```

```text
5 in the queue
┌─────────┬──────────┬─────────────┬────────────────┐
│ (index) │ attempts │ next try in │ last error     │
├─────────┼──────────┼─────────────┼────────────────┤
│ 0       │ 1        │ '0.0 s'     │ 'fetch failed' │
│ 1       │ 0        │ '0.0 s'     │ ''             │
│ 2       │ 0        │ '0.0 s'     │ ''             │
│ 3       │ 0        │ '0.0 s'     │ ''             │
│ 4       │ 0        │ '0.0 s'     │ ''             │
└─────────┴──────────┴─────────────┴────────────────┘
```

The first order failed, and the queue stopped there instead of trying the other four. Now start the server, and run `npm run orders -- 0` (save nothing, just send) until the queue is empty. For me, it took two runs:

```text
1 in the queue
┌─────────┬──────────┬─────────────┬────────────────┐
│ (index) │ attempts │ next try in │ last error     │
├─────────┼──────────┼─────────────┼────────────────┤
│ 0       │ 1        │ '0.0 s'     │ 'fetch failed' │
└─────────┴──────────┴─────────────┴────────────────┘
0 in the queue
```

On the first run, one of the replies got dropped, so the queue kept that order and tried it again on the second run. Now count what the server saved:

```bash
curl -s localhost:8787/orders
```

You should see exactly five orders. The one whose reply got dropped was sent twice, but thanks to the key, the server only made it once.

Phew! The queue works. But there's a problem hiding in that `'0.0 s'` column.

## Step 7: Backing Off Between Retries

Right now, a failed request is due again immediately. On a phone, `flush` gets called a lot: every time the network flickers, every time the app comes to the foreground. With no wait between retries, a phone in a tunnel will hammer your server the moment it gets a signal. Now picture a few thousand phones coming out of the same tunnel.

The usual fix is exponential backoff: wait 1 second, then 2, then 4, and so on, up to a cap. But if everyone backs off on the same schedule, they all come back at the same moment anyway. Marc Brooker's post [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) on the AWS Architecture Blog compares a few ways of adding randomness, and one of the two clear winners is "full jitter": wait a random time between zero and the exponential ceiling. It's also the simplest.

In the src folder, create backoff.ts:

```ts
/**
 * Exponential backoff with full jitter: wait a random time between zero and
 * an exponentially growing ceiling. The randomness spreads retries out, so a
 * thousand phones coming out of the same tunnel don't hit your API together.
 */
export function backoff(attempt: number, baseMs = 1_000, capMs = 60_000, random = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}
```

Back in queue.ts, import it at the top of the file:

```ts
import { backoff } from './backoff';
```

Add two options to `QueueOptions`, below `timeoutMs`:

```ts
  baseDelayMs?: number;
  maxDelayMs?: number;
```

In `sendDue`, replace the line `item.nextAttemptAt = Date.now();` with:

```ts
        item.nextAttemptAt = Date.now() + backoff(item.attempts, this.baseDelay, this.maxDelay);
```

And at the bottom of the class, add two getters for the defaults: one second to start with, and never more than a minute.

```ts
  private get baseDelay() {
    return this.options.baseDelayMs ?? 1_000;
  }

  private get maxDelay() {
    return this.options.maxDelayMs ?? 60_000;
  }
```

While we're here, let's add one more method, right above the comment for `flush()`. The app will use it later to know when to try again:

```ts
  /** When the next item is due, so the app knows when to try again. */
  nextWakeAt(): number | null {
    if (this.items.length === 0) return null;
    return Math.min(...this.items.map((item) => item.nextAttemptAt));
  }
```

Notice that `nextAttemptAt` is saved with the request. If the app is killed in the middle of a backoff, the schedule is still there when it opens again.

Stop the server, delete queue.json, and save three orders, then flush twice more:

```bash
npm run orders -- 3
npm run orders -- 0
npm run orders -- 0
```

```text
3 in the queue
┌─────────┬──────────┬─────────────┬────────────────┐
│ (index) │ attempts │ next try in │ last error     │
├─────────┼──────────┼─────────────┼────────────────┤
│ 0       │ 1        │ '0.4 s'     │ 'fetch failed' │
│ 1       │ 0        │ '0.0 s'     │ ''             │
│ 2       │ 0        │ '0.0 s'     │ ''             │
└─────────┴──────────┴─────────────┴────────────────┘
3 in the queue
┌─────────┬──────────┬─────────────┬────────────────┐
│ (index) │ attempts │ next try in │ last error     │
├─────────┼──────────┼─────────────┼────────────────┤
│ 0       │ 2        │ '0.7 s'     │ 'fetch failed' │
│ 1       │ 0        │ '0.0 s'     │ ''             │
│ 2       │ 0        │ '0.0 s'     │ ''             │
└─────────┴──────────┴─────────────┴────────────────┘
3 in the queue
┌─────────┬──────────┬─────────────┬────────────────┐
│ (index) │ attempts │ next try in │ last error     │
├─────────┼──────────┼─────────────┼────────────────┤
│ 0       │ 2        │ '0.0 s'     │ 'fetch failed' │
│ 1       │ 1        │ '0.7 s'     │ 'fetch failed' │
│ 2       │ 0        │ '0.0 s'     │ ''             │
└─────────┴──────────┴─────────────┴────────────────┘
```

Each failure now buys some time before the next try, and the time grows. Your numbers will differ, because of the jitter. That's the jitter doing its job.

Look at the "attempts" column, though. Every one of those failures was the network's fault, not the order's. If the connection is down for an hour, every order racks up attempts for nothing. As you could probably predict, that's the next thing we fix.

## Step 8: Checking That Your Server Is Actually There

Your phone can say it's connected when it isn't. Hotel and airport Wi-Fi often hand every request a login page with a 200 status. A phone over its data cap can keep a connection that goes nowhere. React Native's NetInfo does have an `isInternetReachable` flag, and by default it works it out by fetching a Google page. That tells you Google is reachable. It doesn't tell you your API is.

Android has the same problem, and solves it by asking a server for an empty `204 No Content` response. If it gets anything else, someone is in the way. We'll do the same, against our own server. That's what the `/generate_204` route from Step 2 was for.

In the src folder, create probe.ts:

```ts
/**
 * Asks your own server for an empty 204. Anything else (a login page, a
 * redirect, a timeout) means a request wouldn't get through right now.
 */
export function createProbe(url: string, timeoutMs = 5_000) {
  return async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
      return res.status === 204;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
```

Only an actual 204 counts as "online". In Node, `redirect: 'manual'` also stops `fetch` from following a captive portal's redirect to its login page. React Native's `fetch` follows redirects anyway, and that's fine: whatever page it lands on, it won't be a 204.

Now let's wire it into the queue. Add a `probe` option to `QueueOptions`, below `createId`:

```ts
  /** Asks your server if it's reachable before a flush. */
  probe?: () => Promise<boolean>;
```

Add a counter to the class, below `flushing`:

```ts
  private probeFailures = 0;
```

Then, in `sendDue`, add the probe check right below `if (due.length === 0) return;`, so that part looks like this:

```ts
    if (due.length === 0) return;

    if (this.options.probe && !(await this.options.probe())) {
      // The server isn't reachable. That's not any item's fault, so no item
      // loses an attempt. We just wait longer before checking again.
      this.probeFailures++;
      const wait = Math.max(this.baseDelay, backoff(this.probeFailures, this.baseDelay, this.maxDelay));
      for (const item of due) item.nextAttemptAt = Date.now() + wait;
      await this.save();
      return;
    }
    this.probeFailures = 0;
```

If the probe fails, no request loses an attempt. The queue just pushes every due request back, and waits longer each time the probe keeps failing.

Finally, in scripts/place-orders.ts, import the probe and pass it to the queue:

```ts
import { createProbe } from '../src/probe';
```

```ts
const queue = new OfflineQueue({
  baseUrl: API,
  storage: fileStorage('queue.json'),
  probe: createProbe(`${API}/generate_204`),
});
```

Stop the server, delete queue.json, save three orders, then flush again:

```bash
npm run orders -- 3
npm run orders -- 0
```

```text
3 in the queue
┌─────────┬──────────┬─────────────┬────────────┐
│ (index) │ attempts │ next try in │ last error │
├─────────┼──────────┼─────────────┼────────────┤
│ 0       │ 0        │ '1.0 s'     │ ''         │
│ 1       │ 0        │ '1.0 s'     │ ''         │
│ 2       │ 0        │ '1.0 s'     │ ''         │
└─────────┴──────────┴─────────────┴────────────┘
3 in the queue
┌─────────┬──────────┬─────────────┬────────────┐
│ (index) │ attempts │ next try in │ last error │
├─────────┼──────────┼─────────────┼────────────┤
│ 0       │ 0        │ '0.5 s'     │ ''         │
│ 1       │ 0        │ '0.5 s'     │ ''         │
│ 2       │ 0        │ '0.5 s'     │ ''         │
└─────────┴──────────┴─────────────┴────────────┘
```

Zero attempts, and no errors on the orders themselves. The second run didn't even try, because nothing was due yet. Start the server again, wait a second, and run `npm run orders -- 0`. You'll get `0 in the queue` (if a reply gets dropped on the way back, there'll be one left; run it once more), and the server will have exactly three orders.

Your project should look exactly like mine if you've followed the above steps. Here's the complete src/queue.ts, in case anything went missing along the way:

```ts
import { backoff } from './backoff';

export interface QueuedRequest {
  /** A unique ID for this request. Sent as the Idempotency-Key header on every attempt. */
  id: string;
  path: string;
  body: unknown;
  attempts: number;
  /** Saved with the item, so a retry schedule survives the app being killed. */
  nextAttemptAt: number;
  lastError?: string;
}

/** Where the queue keeps its requests between launches. */
export interface Storage {
  load(): Promise<QueuedRequest[]>;
  save(items: QueuedRequest[]): Promise<void>;
}

export interface QueueOptions {
  baseUrl: string;
  storage: Storage;
  /** Makes the unique ID. On React Native, pass expo-crypto's randomUUID. */
  createId?: () => string;
  /** Asks your server if it's reachable before a flush. */
  probe?: () => Promise<boolean>;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onDeadLetter?: (item: QueuedRequest, reason: string) => void;
}

type Result = { outcome: 'delivered' } | { outcome: 'rejected' | 'retry'; reason: string };

export class OfflineQueue {
  private items: QueuedRequest[] = [];
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private probeFailures = 0;

  constructor(private readonly options: QueueOptions) {}

  /** Resolves once the request is on disk, so it's safe to tell the user "Saved". */
  async enqueue(path: string, body: unknown): Promise<QueuedRequest> {
    await this.load();
    const item: QueuedRequest = {
      id: this.options.createId?.() ?? crypto.randomUUID(),
      path,
      body,
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    this.items.push(item);
    await this.save();
    return item;
  }

  async pending(): Promise<number> {
    await this.load();
    return this.items.length;
  }

  /** When the next item is due, so the app knows when to try again. */
  nextWakeAt(): number | null {
    if (this.items.length === 0) return null;
    return Math.min(...this.items.map((item) => item.nextAttemptAt));
  }

  /** Sends everything that's due. Two callers at once share one flush. */
  flush(): Promise<void> {
    this.flushing ??= this.sendDue().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendDue(): Promise<void> {
    await this.load();
    const due = this.items.filter((item) => item.nextAttemptAt <= Date.now());
    if (due.length === 0) return;

    if (this.options.probe && !(await this.options.probe())) {
      // The server isn't reachable. That's not any item's fault, so no item
      // loses an attempt. We just wait longer before checking again.
      this.probeFailures++;
      const wait = Math.max(this.baseDelay, backoff(this.probeFailures, this.baseDelay, this.maxDelay));
      for (const item of due) item.nextAttemptAt = Date.now() + wait;
      await this.save();
      return;
    }
    this.probeFailures = 0;

    for (const item of due) {
      const result = await this.send(item);

      if (result.outcome === 'delivered') {
        this.remove(item);
      } else if (result.outcome === 'rejected') {
        // The server read it and said no. Retrying won't change its mind.
        this.remove(item);
        this.options.onDeadLetter?.(item, result.reason);
      } else {
        item.attempts++;
        item.lastError = result.reason;
        item.nextAttemptAt = Date.now() + backoff(item.attempts, this.baseDelay, this.maxDelay);
      }
      await this.save();

      // If the network just failed us, don't fire the rest of the queue into it.
      if (result.outcome === 'retry') break;
    }
  }

  private async send(item: QueuedRequest): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.options.baseUrl}${item.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': item.id },
        body: JSON.stringify(item.body),
        signal: controller.signal,
      });
      if (res.ok) return { outcome: 'delivered' };
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'retry', reason: `HTTP ${res.status}` };
      }
      return { outcome: 'rejected', reason: `HTTP ${res.status}: ${await res.text()}` };
    } catch (err) {
      return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private remove(item: QueuedRequest): void {
    this.items = this.items.filter((other) => other.id !== item.id);
  }

  /** Saves run one after another, so a double tap can't make two writes trip over each other. */
  private save(): Promise<void> {
    const items = this.items;
    this.saving = this.saving.catch(() => {}).then(() => this.options.storage.save(items));
    return this.saving;
  }

  private load(): Promise<void> {
    this.loading ??= this.options.storage.load().then((saved) => {
      this.items = [...saved, ...this.items];
    });
    return this.loading;
  }

  private get baseDelay() {
    return this.options.baseDelayMs ?? 1_000;
  }

  private get maxDelay() {
    return this.options.maxDelayMs ?? 60_000;
  }
}
```

## Testing Our Queue

Stopping and starting a server by hand only tells us so much. So let's give the queue a properly bad afternoon, and see how it compares with the two scripts from Steps 3 and 4.

Create scripts/chaos.ts and paste in the code below.

```ts
// One bad afternoon, three ways of sending orders through it.
//
// 100 orders, one every 40 ms. The server hangs up on 25% of them after saving,
// goes down completely for 2 seconds in the middle, and the "app" is killed
// every 25 orders. Then we count what the server ended up with.
import { rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createOrdersServer } from '../server/app';
import { createProbe } from '../src/probe';
import { OfflineQueue } from '../src/queue';
import { fileStorage } from '../src/storage';

const ORDERS = 100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A seeded random, so every run drops the same requests. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

interface Approach {
  name: string;
  /** The user taps "Save". */
  tap(sku: string): void;
  /** The OS kills the app. Anything only in memory is gone. */
  kill(): void;
  /** The app is opened again later and gets a chance to finish. */
  finish(): Promise<void>;
}

async function run(makeApproach: (api: string) => Approach) {
  const { server, orders, setDown } = createOrdersServer({ dropRate: 0.25, random: seeded(42) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const api = `http://localhost:${(server.address() as AddressInfo).port}`;
  const approach = makeApproach(api);

  for (let i = 1; i <= ORDERS; i++) {
    if (i === 40) setDown(true); // the outage starts...
    if (i === 90) setDown(false); // ...and ends 2 seconds later
    approach.tap(`SKU-${i}`);
    await sleep(40);
    if (i % 25 === 0) approach.kill(); // a moment after "Saved", the OS kills the app
  }
  await approach.finish();

  server.closeAllConnections();
  server.close();

  const counts = new Map<string, number>();
  for (const order of orders) counts.set(order.sku, (counts.get(order.sku) ?? 0) + 1);
  const lost = ORDERS - counts.size;
  const duplicated = [...counts.values()].filter((n) => n > 1).length;
  return { name: approach.name, lost, duplicated, exactlyOnce: ORDERS - lost - duplicated };
}

// 1. What most apps do: fetch, retry three times, give up.
const naive = (api: string): Approach => {
  let generation = 0;
  return {
    name: 'fetch + 3 retries',
    tap(sku) {
      const born = generation;
      void (async () => {
        for (let attempt = 0; attempt < 3 && born === generation; attempt++) {
          try {
            const res = await fetch(`${api}/orders`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sku, qty: 1 }),
            });
            if (res.ok) return;
          } catch {}
        }
      })();
    },
    kill() {
      generation++; // every retry loop that's still running dies with the app
    },
    async finish() {
      await sleep(1_000);
    },
  };
};

// 2. Same retries, plus an idempotency key. Still only in memory.
const tagged = (api: string): Approach => {
  let generation = 0;
  return {
    name: 'retries + idempotency key',
    tap(sku) {
      const born = generation;
      const key = crypto.randomUUID();
      void (async () => {
        for (let attempt = 0; attempt < 3 && born === generation; attempt++) {
          try {
            const res = await fetch(`${api}/orders`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'idempotency-key': key },
              body: JSON.stringify({ sku, qty: 1 }),
            });
            if (res.ok) return;
          } catch {}
        }
      })();
    },
    kill() {
      generation++;
    },
    async finish() {
      await sleep(1_000);
    },
  };
};

// 3. The queue: tagged, on disk, backed off, probed.
const queued = (api: string): Approach => {
  const disk = fileStorage('chaos-queue.json');
  let generation = 0;
  const make = () => {
    const born = ++generation;
    const alive = () => born === generation;
    const probe = createProbe(`${api}/generate_204`, 500);
    return new OfflineQueue({
      baseUrl: api,
      // A killed app can't write to disk any more, and its next flush goes nowhere.
      storage: { load: () => disk.load(), save: async (items) => (alive() ? disk.save(items) : undefined) },
      probe: async () => alive() && (await probe()),
      timeoutMs: 1_000,
      baseDelayMs: 100,
      maxDelayMs: 2_000,
    });
  };
  let queue = make();
  return {
    name: 'the queue',
    tap(sku) {
      void queue.enqueue('/orders', { sku, qty: 1 }).then(() => queue.flush());
    },
    kill() {
      queue = make(); // a fresh launch: it only knows what's on disk
    },
    async finish() {
      const deadline = Date.now() + 15_000;
      while ((await queue.pending()) > 0 && Date.now() < deadline) {
        await queue.flush();
        await sleep(100);
      }
    },
  };
};

await rm('chaos-queue.json', { force: true });
const results = [await run(naive), await run(tagged), await run(queued)];
await rm('chaos-queue.json', { force: true });

console.table(results);
```

Here's what the script does:

- It starts its own copy of the server on a random port, with a 25% chance of hanging up after saving each order. The random numbers are seeded, so every run drops the same requests.
- It places 100 orders, one every 40 milliseconds. Between orders 40 and 90, the server goes down completely, which works out to about two seconds.
- Every 25 orders, a moment after the user saw "Saved", the "app" is killed. For the first two approaches, any retry still running in memory dies with it. For the queue, a new `OfflineQueue` takes over, and it only knows what's on disk. The old one can't write to disk any more, and its next flush goes nowhere, just like a dead app.
- At the end, the queue gets a chance to finish sending, like an app being opened again later. Then we count what the server ended up with.

Run it. It takes about 16 seconds.

```bash
npm run chaos
```

```text
┌─────────┬─────────────────────────────┬──────┬────────────┬─────────────┐
│ (index) │ name                        │ lost │ duplicated │ exactlyOnce │
├─────────┼─────────────────────────────┼──────┼────────────┼─────────────┤
│ 0       │ 'fetch + 3 retries'         │ 50   │ 15         │ 35          │
│ 1       │ 'retries + idempotency key' │ 50   │ 0          │ 50          │
│ 2       │ 'the queue'                 │ 0    │ 0          │ 100         │
└─────────┴─────────────────────────────┴──────┴────────────┴─────────────┘
```

Fetch with retries lost half of the orders and saved 15 of them more than once. Adding a key fixed every duplicate, but it lost the same 50 orders: the ones placed during the outage. Three instant retries are over long before the server comes back, and once they're done, nothing remembers the order. The queue wrote every order to disk before saying "Saved", waited out the outage, survived four restarts, and delivered all 100, exactly once.

The finished project also has unit tests for each of these behaviours. If you clone it, `npm test` runs them.

## Using the Queue in React Native

Finally, let's put the queue in an app. If you don't have an Expo app yet, create one with the blank TypeScript template:

```bash
npx create-expo-app@latest offline-orders --template blank-typescript
cd offline-orders
```

Then install the three packages we need:

```bash
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo expo-crypto
```

Create a lib folder and copy three files from our project into it: src/queue.ts, src/backoff.ts and src/probe.ts. You don't need storage.ts, because on a phone, AsyncStorage takes its place.

In the lib folder, create offline.ts:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createProbe } from './probe';
import { OfflineQueue, type QueuedRequest, type Storage } from './queue';

const API = 'https://your-api.example.com';
const KEY = 'offline-queue/v1';

// The same two methods as fileStorage, backed by AsyncStorage. The whole queue
// lives under one key, so every save replaces it in a single write.
const asyncStorage: Storage = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  },
  async save(items) {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  },
};

export const queue = new OfflineQueue({
  baseUrl: API,
  storage: asyncStorage,
  probe: createProbe(`${API}/generate_204`),
  createId: randomUUID,
});
```

Replace `https://your-api.example.com` with your API's address. Your server needs the same two things ours has: a `/generate_204` route, and the idempotency key check from Step 4.

We're passing `randomUUID` from expo-crypto because React Native doesn't have `crypto.randomUUID()` built in.

Next, create lib/useOfflineQueue.ts:

```ts
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { queue } from './offline';

export function useOfflineQueue() {
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await queue.flush();
    setPending(await queue.pending());

    // Come back when the next item is due. If iOS suspends the app, this timer
    // fires late or never, and that's fine: the schedule is saved with the items.
    const wakeAt = queue.nextWakeAt();
    if (wakeAt !== null) timer.current = setTimeout(flush, Math.max(0, wakeAt - Date.now()));
  }, []);

  useEffect(() => {
    void flush();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    // NetInfo only says *something* changed. The probe decides if it's worth sending.
    const stopNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flush();
    });
    return () => {
      appState.remove();
      stopNetInfo();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const save = useCallback(
    async (path: string, body: unknown) => {
      await queue.enqueue(path, body); // on disk: safe to say "Saved"
      setPending(await queue.pending());
      void flush(); // the UI never waits for the network
    },
    [flush],
  );

  return { pending, save };
}
```

The hook flushes the queue in three situations: when the screen mounts, when the app comes back to the foreground, and when NetInfo says the network changed. NetInfo is only a hint here. The probe decides whether it's actually worth sending.

After every flush, it sets a timer for the next request that's due. If iOS suspends the app, that timer fires late or not at all, and that's fine: the schedule is saved with the requests, so the next flush picks up where it left off.

Finally, replace App.tsx with a screen that uses it:

```tsx
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { useOfflineQueue } from './lib/useOfflineQueue';

export default function App() {
  const { pending, save } = useOfflineQueue();
  const [sku, setSku] = useState('');
  const [message, setMessage] = useState('');

  async function onSave() {
    await save('/orders', { sku, qty: 1 });
    setSku('');
    setMessage('Saved'); // true the moment save() resolves: it's on disk
  }

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <TextInput placeholder="SKU" value={sku} onChangeText={setSku} style={{ borderWidth: 1, padding: 8 }} />
      <Button title="Save order" onPress={onSave} disabled={!sku} />
      <Text>{message}</Text>
      {pending > 0 && <Text>{pending} waiting to sync</Text>}
    </View>
  );
}
```

If your app uses Expo Router, put this in app/index.tsx instead, and change the import to `../lib/useOfflineQueue`.

`save()` resolves as soon as the order is on disk, so "Saved" is true the moment it shows, network or no network. Try it on a real device: turn on airplane mode, save a couple of orders, then turn it off and watch the "waiting to sync" count go down.

## How It All Works

Let's review how the different pieces work together:

![The life of one request: queued on disk, sent with its key, then delivered, rejected on a 4xx, or waiting with backoff on a network error.](images/item-lifecycle.svg)

1. The user taps "Save". `enqueue` gives the request a unique ID and writes it to disk before resolving, so the app can say "Saved" straight away.
2. `flush` runs on launch, on resume, on network changes and on a timer. It asks the probe first. If your server doesn't answer with a 204, every due request waits a little longer, and none of them loses an attempt.
3. If the server is reachable, each due request is sent with its ID in the `Idempotency-Key` header.
4. A 2xx removes it from the queue. A 4xx removes it and tells the app why. A network error, a 408, a 429 or a 5xx keeps it, with a backoff that grows after every failure.
5. On the server, a key it has seen before gets the saved reply back, and no new order. So a retry after a lost response can never create a second order.

## Conclusion

That was a lot of code for something your users will hopefully never notice, which is kind of the point. When the network is bad, nothing they save gets lost, and nothing gets saved twice.

If I were taking this further, the next things I'd do are:

- Store idempotency keys in your database, in the same transaction as the order, with a unique constraint on the key.
- Expire old keys after a day or so. Stripe, for example, removes them once they're at least 24 hours old.
- Show users which of their changes are still waiting to sync, so they're never left guessing.

You can find the complete project [here](https://github.com/Ernesto-tha-great/checked-luggage). If you run into any issues while following along, drop a comment or reach out to me. Thanks for reading!
