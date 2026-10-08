/**
 * CI gate for any schema change: validate every operation shipped by every
 * supported app build against the schema in this commit. Catches removed
 * fields, renamed types, newly required arguments, all of it.
 *
 *   npm run check-schema
 */
import { buildSchema } from 'graphql';
import { buildManifests, readSupportPolicy } from '../src/clients.js';
import { findBreakages } from '../src/removal.js';
import { typeDefs } from '../src/v2/schema.js';

const support = readSupportPolicy();
const breakages = findBreakages(buildSchema(typeDefs), buildManifests(), support);
const builds = Object.entries(support).flatMap(([client, versions]) => versions.map((v) => `${client}@${v}`));

if (breakages.length === 0) {
  console.log(`✓ Schema is compatible with every supported build: ${builds.join(', ')}`);
  process.exit(0);
}

console.log('✗ This schema breaks supported app builds:\n');
for (const b of breakages) console.log(`  ${b.client}@${b.version}  ${b.operation}: ${b.message}`);
process.exit(1);
