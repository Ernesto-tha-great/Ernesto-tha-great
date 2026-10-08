// Sends one app version's OrderHistory query to our server (in-process, no
// network) and counts the trips it makes to the database.
//   npm run count -- android/2.3
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app';
import { Db } from '../src/db';

const build = process.argv[2] ?? 'android/2.3';
const [client, version] = build.split('/');
const query = await readFile(`clients/${build}/OrderHistory.graphql`, 'utf8');

// 1 ms per statement, 10 at a time: roughly a database in the same region.
const db = new Db({ latencyMs: 1, poolSize: 10 });
const yoga = createApp({ db });

const send = () =>
  yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer c_1',
      'apollographql-client-name': client!,
      'apollographql-client-version': version!,
    },
    body: JSON.stringify({ query, variables: { customerId: 'c_1', first: 100 } }),
  });

await send(); // a warm-up request, so we don't time the server starting up
db.statements = 0;

const started = performance.now();
const { data, errors } = (await (await send()).json()) as { data?: any; errors?: unknown };
const ms = performance.now() - started;

if (errors) {
  console.log(JSON.stringify(errors, null, 2));
  process.exit(1);
}
const orders = data.orders ?? data.viewer.orders.edges;
console.log(`${client} ${version}: ${orders.length} orders, ${db.statements} database statements, ${ms.toFixed(1)} ms`);
