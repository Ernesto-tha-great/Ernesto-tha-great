import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, type Manifest } from './trusted.js';

export const CLIENTS_DIR = fileURLToPath(new URL('../clients', import.meta.url));
export const MANIFESTS_DIR = fileURLToPath(new URL('../manifests', import.meta.url));

/** Which app versions we still promise not to break. */
export type SupportPolicy = Record<string, string[]>;

export function readSupportPolicy(dir = CLIENTS_DIR): SupportPolicy {
  return JSON.parse(readFileSync(join(dir, 'support.json'), 'utf8')) as SupportPolicy;
}

/**
 * Reads clients/<client>/<version>/*.graphql. In a real project these come out
 * of each app's build: Apollo Kotlin and Apollo iOS can both write an
 * operation manifest for you.
 */
export function readClientOperations(dir = CLIENTS_DIR): Array<{ client: string; version: string; name: string; document: string }> {
  const operations = [];
  for (const client of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const version of readdirSync(join(dir, client.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const file of readdirSync(join(dir, client.name, version.name)).filter((name) => name.endsWith('.graphql'))) {
        operations.push({
          client: client.name,
          version: version.name,
          name: file.replace(/\.graphql$/, ''),
          document: readFileSync(join(dir, client.name, version.name, file), 'utf8'),
        });
      }
    }
  }
  return operations;
}

export function buildManifests(dir = CLIENTS_DIR): Manifest[] {
  const manifests = new Map<string, Manifest>();
  for (const op of readClientOperations(dir)) {
    const key = `${op.client}@${op.version}`;
    const manifest = manifests.get(key) ?? { client: op.client, version: op.version, operations: {} };
    manifest.operations[sha256(op.document)] = op.document;
    manifests.set(key, manifest);
  }
  return [...manifests.values()];
}
