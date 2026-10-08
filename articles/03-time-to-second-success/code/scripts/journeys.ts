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
