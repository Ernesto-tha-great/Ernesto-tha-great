import { createServer } from 'node:http';
import { createApp } from './app';
import { schema } from './schema';
import { UsageStore } from './usage';

const usage = new UsageStore();
const yoga = createApp({ usage });

createServer((req, res) => {
  if (req.url === '/usage') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(usage.deprecationReport(schema), null, 2));
    return;
  }
  return yoga(req, res);
}).listen(4000, () => console.log('GraphQL on http://localhost:4000/graphql'));
