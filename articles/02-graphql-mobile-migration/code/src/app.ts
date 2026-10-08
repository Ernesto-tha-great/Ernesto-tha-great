import { createYoga, type Plugin } from 'graphql-yoga';
import { Db } from './db.js';
import { useTrustedDocuments, type TrustedDocuments, type TrustedMode } from './trusted.js';
import { useFieldUsage, type UsageStore } from './usage.js';
import { schema as v1Schema } from './v1/schema.js';
import { createLoaders } from './v2/loaders.js';
import { schema as v2Schema } from './v2/schema.js';

export interface AppOptions {
  schemaVersion: 'v1' | 'v2';
  db?: Db;
  usage?: UsageStore;
  trusted?: { store: TrustedDocuments; mode: TrustedMode; onUnknown?: (document: string) => void };
  graphiql?: boolean;
}

export function createApp(options: AppOptions) {
  const db = options.db ?? new Db();
  const plugins: Plugin[] = [];
  if (options.trusted) {
    plugins.push(useTrustedDocuments(options.trusted.store, options.trusted.mode, options.trusted.onUnknown));
  }
  if (options.usage) plugins.push(useFieldUsage(options.usage));

  const shared = { plugins, graphiql: options.graphiql ?? false, logging: false } as const;

  if (options.schemaVersion === 'v1') {
    return createYoga({ ...shared, schema: v1Schema, context: () => ({ db }) });
  }

  return createYoga({
    ...shared,
    schema: v2Schema,
    context: ({ request }) => ({ db, loaders: createLoaders(db), viewerId: viewerFrom(request) }),
  });
}

/** Demo auth: "Authorization: Bearer c_1". Use your real auth here. */
function viewerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
