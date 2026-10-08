import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifests, MANIFESTS_DIR } from '../src/clients.js';

mkdirSync(MANIFESTS_DIR, { recursive: true });
for (const manifest of buildManifests()) {
  const file = join(MANIFESTS_DIR, `${manifest.client}-${manifest.version}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${manifest.client}@${manifest.version}: ${Object.keys(manifest.operations).length} operations → ${file}`);
}
