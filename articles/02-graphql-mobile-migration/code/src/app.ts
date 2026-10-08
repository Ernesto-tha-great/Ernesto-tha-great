import { createYoga, type Plugin } from 'graphql-yoga';
import { Db } from './db';
import { createLoaders } from './loaders';
import { schema } from './schema';
import { useFieldUsage, type UsageStore } from './usage';

export interface AppOptions {
  db?: Db;
  usage?: UsageStore;
}

export function createApp(options: AppOptions = {}) {
  const db = options.db ?? new Db();
  const plugins: Plugin[] = options.usage ? [useFieldUsage(options.usage)] : [];
  return createYoga({
    schema,
    plugins,
    logging: false,
    context: ({ request }) => ({ db, loaders: createLoaders(db), viewerId: viewerFrom(request) }),
  });
}

/** Demo auth: "Authorization: Bearer c_1". Swap in your real auth here. */
function viewerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
