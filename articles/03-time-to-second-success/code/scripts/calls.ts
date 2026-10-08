// Prints the API calls recorded so far.
//   npm run calls              # events.db
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2] ?? 'events.db');
console.table(db.prepare('SELECT developer_id, method, route, status, key_mode FROM api_calls ORDER BY at').all());
