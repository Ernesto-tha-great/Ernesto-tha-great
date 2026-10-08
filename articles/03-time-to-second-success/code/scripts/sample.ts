/**
 * Generates a SAMPLE event log for 2,000 fictional developers of the Parcel API,
 * so you can run the report before you've wired up real events.
 *
 * The behaviour below is invented, and two drop-off points are deliberately
 * baked in (the webhook test step and the first live label). The point is to
 * show that the cliffs query finds them, not to tell you anything about
 * real developers. Your own data will have its own cliffs.
 *
 *   npm run sample            # writes sample.db
 */
import { rmSync } from 'node:fs';
import { EventStore } from '../src/store';

const OUT = process.argv[2] ?? 'sample.db';
const DEVELOPERS = 2000;
const SIGNUPS_FROM = Date.UTC(2026, 5, 1);
const SIGNUPS_TO = Date.UTC(2026, 7, 1);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

rmSync(OUT, { force: true });
const store = new EventStore(OUT);
const random = seeded(42);
const chance = (p: number) => random() < p;
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

store.transaction(() => {
  for (let n = 1; n <= DEVELOPERS; n++) simulateDeveloper(`dev_${String(n).padStart(4, '0')}`);
});
console.log(`wrote ${OUT}: ${DEVELOPERS} sample developers`);

function simulateDeveloper(id: string): void {
  const signedUp = SIGNUPS_FROM + random() * (SIGNUPS_TO - SIGNUPS_FROM);
  store.addDeveloper(id, new Date(signedUp));
  if (chance(0.18)) return; // signed up, never called the API

  // Time to first call: most within the hour, a long tail over a week.
  let t = signedUp + (chance(0.6) ? random() * HOUR : chance(0.6) ? random() * DAY : random() * 7 * DAY);
  const call = (method: string, route: string, status: number, keyMode: 'test' | 'live' = 'test') => {
    store.recordCall({ developerId: id, at: new Date(t), method, route, status, keyMode, sdk: pick(['parcel-node/2.1.0', 'parcel-python/1.8.2', 'curl/8.7.1']) });
    t += (0.5 + random() * 4) * MIN;
  };

  // Onboarding: a few stumbles before the first success, or giving up.
  call('GET', '/v1/me', 200);
  let succeeded = false;
  for (let attempt = 0; attempt < 6 && !succeeded; attempt++) {
    if (chance(attempt === 0 ? 0.22 : 0.08)) {
      call('GET', '/v1/rates', 401); // wrong key: copied the publishable key, or a stray space
    } else if (chance(0.18)) {
      call('POST', '/v1/labels', 422); // missing address field
    } else {
      if (chance(0.5)) call('GET', '/v1/rates', 200);
      else call('POST', '/v1/labels', 201);
      succeeded = true;
      break;
    }
    if (chance(0.25)) return; // gave up during onboarding
  }
  if (!succeeded) return;
  const firstSuccess = t;

  // The rest of the first session.
  for (let i = Math.floor(random() * 5); i > 0; i--) {
    const [method, route, status] = pick([['GET', '/v1/rates', 200], ['POST', '/v1/labels', 201], ['GET', '/v1/labels/:id', 200]] as const);
    call(method, route, status);
  }

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

  // Coming back: a small chance each day, boosted for a few days after a nudge.
  let nudgedAt: number | null = null;
  for (let day = 1; day <= 45; day++) {
    if (day === 3 && nudgedAt === null) {
      nudgedAt = firstSuccess + 3 * DAY;
      store.recordNudge(id, new Date(nudgedAt), 'email');
    }
    const boosted = nudgedAt !== null && day >= 3 && day < 6;
    if (!chance(boosted ? returnRate * 2.2 : returnRate)) continue;

    t = firstSuccess + day * DAY + random() * 10 * HOUR;
    if (chance(0.5)) {
      // Cliff #2 (baked in): the first live label fails until the sender address is verified.
      if (chance(0.4)) {
        call('POST', '/v1/labels', 422, 'live');
        if (chance(0.5)) return; // gave up on going live
      }
      call('POST', '/v1/labels', 201, 'live');
    } else {
      call('GET', '/v1/rates', 200);
    }
    return;
  }
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
