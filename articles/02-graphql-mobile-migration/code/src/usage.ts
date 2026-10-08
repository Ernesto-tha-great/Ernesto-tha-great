import {
  isObjectType,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type GraphQLSchema,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';

/** "android@2.3", from the headers Apollo's mobile clients already know how to send. */
export function clientFrom(request: Request | undefined): string {
  const name = request?.headers.get('apollographql-client-name') ?? 'unknown';
  const version = request?.headers.get('apollographql-client-version') ?? 'unknown';
  return `${name}@${version}`;
}

/** Every schema coordinate ("Type.field") an operation touches. */
export function fieldCoordinates(schema: GraphQLSchema, document: DocumentNode): Set<string> {
  const typeInfo = new TypeInfo(schema);
  const found = new Set<string>();
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const parent = typeInfo.getParentType();
        const field = typeInfo.getFieldDef();
        if (parent && field && !field.name.startsWith('__')) found.add(`${parent.name}.${field.name}`);
      },
    }),
  );
  return found;
}

export interface Usage {
  client: string;
  requests: number;
  lastSeen: string;
}

export class UsageStore {
  private readonly usage = new Map<string, Map<string, Usage>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(client: string, coordinates: Iterable<string>): void {
    const lastSeen = this.now().toISOString();
    for (const coordinate of coordinates) {
      const byClient = this.usage.get(coordinate) ?? new Map<string, Usage>();
      const entry = byClient.get(client) ?? { client, requests: 0, lastSeen };
      entry.requests++;
      entry.lastSeen = lastSeen;
      byClient.set(client, entry);
      this.usage.set(coordinate, byClient);
    }
  }

  clientsUsing(coordinate: string): Usage[] {
    return [...(this.usage.get(coordinate)?.values() ?? [])].sort((a, b) => b.requests - a.requests);
  }

  /** For every deprecated field in the schema: who is still calling it? */
  deprecationReport(schema: GraphQLSchema): Array<{ coordinate: string; reason: string; clients: Usage[] }> {
    const report = [];
    for (const type of Object.values(schema.getTypeMap())) {
      if (!isObjectType(type) || type.name.startsWith('__')) continue;
      for (const field of Object.values(type.getFields())) {
        if (field.deprecationReason == null) continue;
        const coordinate = `${type.name}.${field.name}`;
        report.push({ coordinate, reason: field.deprecationReason, clients: this.clientsUsing(coordinate) });
      }
    }
    return report;
  }
}

/** Records which fields each client version touches, on every request. */
export function useFieldUsage(store: UsageStore): Plugin {
  return {
    onExecute({ args }) {
      const request = (args.contextValue as { request?: Request }).request;
      store.record(clientFrom(request), fieldCoordinates(args.schema, args.document));
    },
  };
}
