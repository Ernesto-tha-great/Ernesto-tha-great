# checked-luggage

A small write queue for React Native that makes sure every request reaches your server **exactly once**, even on trains, in lifts and on hotel Wi-Fi. It also ships a simulator that puts it through all three, so you can check that claim yourself.

This is the companion code for my article **Offline-First React Native: Building a Write Queue That Survives Bad Networks**.

![How a request travels from tap to server](./docs/images/architecture.svg)

## The idea in one paragraph

Treat every request like checked luggage. Write it to disk before telling the user it's saved (the receipt). Give it an idempotency key when it's created (the tag). Retry it with jittered backoff when it misses a flight. And have the server check the tag before doing any work, so a retried copy is never delivered twice.

## Quick start

You need Node 20 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/checked-luggage.git
cd checked-luggage
npm install

npm test          # 19 tests, including lost responses over real HTTP
npm run bench     # runs 4 bad-network scenarios against 4 approaches, 25 seeds each
npm run chart     # redraws docs/images/results.svg from the results
npm run server    # demo orders API on http://localhost:8787
```

Want the server to misbehave? `DROP_RESPONSE_RATE=0.5 npm run server` makes it do the work and then hang up on half the requests. Add `IGNORE_KEYS=1` to see what happens without idempotency keys. (Spoiler: duplicates.)

## What's in here

```text
src/          the library: OfflineQueue, HTTP transport, reachability probe, storage adapters
server/       demo orders API that checks idempotency keys before doing any work
sim/          a deterministic network simulator, plus the four approaches it compares
sim/traces/   the scenarios: underground commute, office lift, conference Wi-Fi, out of data
bench/        runs every scenario against every approach and draws the chart
test/         unit tests, plus end-to-end tests over real HTTP
example/      an Expo app wired up to the queue
```

## Results

![Delivery outcomes per scenario and approach](./docs/images/results.svg)

These come from the simulator, not from recordings of real phones. Every number is reproducible with `npm run bench`. To add your own scenario, drop a JSON file in a folder (the format is documented in `sim/trace.ts`) and run `npm run bench -- ./your-folder`.

## Use it in your app

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { OfflineQueue, createHttpTransport, createKeyValueStorage, createReachabilityProbe } from 'checked-luggage';

export const queue = new OfflineQueue({
  storage: createKeyValueStorage(AsyncStorage),
  transport: createHttpTransport({ baseUrl: API_URL }),
  probe: createReachabilityProbe({ url: `${API_URL}/generate_204` }),
  createId: () => Crypto.randomUUID(),
});

await queue.enqueue({ method: 'POST', path: '/orders', body: { sku: 'SKU-1', qty: 1 } });
await queue.flush();
```

Your server needs two endpoints: `POST /batch`, which returns one verdict per item, and `GET /generate_204`. `server/core.ts` shows the contract, and the article shows the Postgres version. For a full app, see [`example/`](./example).

## Licence

MIT. Break it, and tell me how.
