import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENTS_DIR } from '../src/clients.js';
import { sha256 } from '../src/trusted.js';

export function operation(client: string, version: string, name: string): string {
  return readFileSync(join(CLIENTS_DIR, client, version, `${name}.graphql`), 'utf8');
}

interface Fetcher {
  fetch(input: string, init?: RequestInit): Promise<Response> | Response;
}

export interface SendOptions {
  client: string;
  version: string;
  viewer?: string;
  query?: string;
  persistedHash?: string;
  variables?: Record<string, unknown>;
}

/** Sends a request the way a mobile client would: headers, body, all of it. */
export async function send(app: Fetcher, options: SendOptions) {
  const body: Record<string, unknown> = { variables: options.variables ?? {} };
  if (options.query) body.query = options.query;
  if (options.persistedHash) body.extensions = { persistedQuery: { version: 1, sha256Hash: options.persistedHash } };

  const response = await app.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.viewer ?? 'c_1'}`,
      'apollographql-client-name': options.client,
      'apollographql-client-version': options.version,
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { data?: any; errors?: Array<{ message: string; extensions?: { code?: string } }> };
}

export const hashOf = (client: string, version: string, name: string) => sha256(operation(client, version, name));
