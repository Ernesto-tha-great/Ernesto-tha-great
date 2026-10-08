import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { TrustedDocuments, type TrustedMode } from './trusted.js';
import { UsageStore } from './usage.js';
import { schema } from './v2/schema.js';

const port = Number(process.env.PORT ?? 4000);
const version = process.env.SCHEMA === 'v1' ? 'v1' : 'v2';
const mode = (process.env.TRUSTED_MODE ?? 'report') as TrustedMode;

const usage = new UsageStore();
const trusted = TrustedDocuments.fromDirectory(fileURLToPath(new URL('../manifests', import.meta.url)));
const yoga = createApp({
  schemaVersion: version,
  usage,
  trusted: { store: trusted, mode, onUnknown: (doc) => console.warn('untrusted operation:\n' + doc) },
  graphiql: true,
});

createServer((req, res) => {
  if (req.url === '/usage') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(usage.deprecationReport(schema), null, 2));
    return;
  }
  return yoga(req, res);
}).listen(port, () => {
  console.log(`GraphQL (${version}) on http://localhost:${port}/graphql`);
  console.log(`  trusted documents: ${mode}, ${trusted.manifests.length} manifests loaded`);
  console.log(`  deprecated-field usage: http://localhost:${port}/usage`);
});
