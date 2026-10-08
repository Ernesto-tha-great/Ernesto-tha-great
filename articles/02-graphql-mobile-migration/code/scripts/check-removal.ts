/**
 * CI gate: can these fields be deleted without breaking an app version we
 * still support?
 *
 *   npm run check-removal -- Order.created_at OrderItem.qty
 */
import { buildManifests, readSupportPolicy } from '../src/clients.js';
import { findBreakages, schemaWithout } from '../src/removal.js';
import { typeDefs } from '../src/v2/schema.js';

const coordinates = process.argv.slice(2).flatMap((arg) => arg.split(',')).filter(Boolean);
if (coordinates.length === 0) {
  console.error('usage: npm run check-removal -- Type.field [Type.field ...]');
  process.exit(2);
}

const breakages = findBreakages(schemaWithout(typeDefs, coordinates), buildManifests(), readSupportPolicy());

if (breakages.length === 0) {
  console.log(`✓ Safe to remove ${coordinates.join(', ')}: no supported app version uses ${coordinates.length === 1 ? 'it' : 'them'}.`);
  process.exit(0);
}

console.log(`✗ Removing ${coordinates.join(', ')} would break:\n`);
for (const b of breakages) console.log(`  ${b.client}@${b.version}  ${b.operation}: ${b.message}`);
process.exit(1);
