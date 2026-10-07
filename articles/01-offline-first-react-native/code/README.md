# checked-luggage

A durable, idempotent offline request queue for React Native, plus a harness that replays network traces against it.

This is the companion code for **Offline-First React Native: A Failure Taxonomy From Real Network Traces**. The article lives in [`../article.md`](../article.md).

```
Tap Save → enqueue() → tag + write to disk → flush() → probe → tagged batch → server checks the tag → verdicts
```

## What's in here

| Path | What it is |
|---|---|
| `src/` | The library: `OfflineQueue`, HTTP transport, reachability probe, storage adapters |
| `server/` | A demo orders API that honours idempotency keys (and can be told not to) |
| `sim/` | A deterministic network simulator and four client strategies to compare |
| `sim/traces/` | Synthetic trace fixtures: underground commute, lift, captive-portal Wi-Fi, data cap |
| `bench/` | Replays every trace against every strategy and renders the results chart |
| `test/` | Unit tests plus end-to-end tests over real HTTP |
| `example/` | An Expo app wired to the queue |

## Run it

```bash
npm install
npm test          # 19 tests, including lost responses over real HTTP
npm run bench     # replays sim/traces/*.json, writes results/results.md
npm run chart     # renders ../images/results.svg from the results
npm run server    # demo API on :8787 (DROP_RESPONSE_RATE=0.5 and IGNORE_KEYS=1 to misbehave)
```

To replay your own traces, drop JSON files in a folder and run `npm run bench -- path/to/folder`. The format is documented in `sim/trace.ts`.

## Use the library

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
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

Your server must accept `POST /batch` and return one verdict per item. See `server/core.ts` for the contract.

## Licence

MIT
