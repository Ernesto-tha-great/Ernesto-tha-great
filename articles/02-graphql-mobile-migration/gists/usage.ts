import { isObjectType, TypeInfo, visit, visitWithTypeInfo, type DocumentNode, type GraphQLSchema } from 'graphql';
import type { Plugin } from 'graphql-yoga';

/** "android 2.3", from two headers each app sends with every request. */
export function clientFrom(request: Request | undefined): string {
  const name = request?.headers.get('apollographql-client-name') ?? 'unknown';
  const version = request?.headers.get('apollographql-client-version') ?? 'unknown';
  return `${name} ${version}`;
}

/** Every "Type.field" an operation touches. */
export function fieldsUsed(schema: GraphQLSchema, document: DocumentNode): Set<string> {
  const typeInfo = new TypeInfo(schema);
  const fields = new Set<string>();
  visit(document, visitWithTypeInfo(typeInfo, {
    Field() {
      const parent = typeInfo.getParentType();
      const field = typeInfo.getFieldDef();
      if (parent && field && !field.name.startsWith('__')) fields.add(`${parent.name}.${field.name}`);
    },
  }));
  return fields;
}

export class UsageStore {
  /** "Order.created_at" -> "android 2.3" -> requests */
  private readonly usage = new Map<string, Map<string, number>>();

  record(client: string, fields: Iterable<string>): void {
    for (const field of fields) {
      const byClient = this.usage.get(field) ?? new Map<string, number>();
      byClient.set(client, (byClient.get(client) ?? 0) + 1);
      this.usage.set(field, byClient);
    }
  }

  /** For every deprecated field in the schema: which app versions still use it? */
  deprecationReport(schema: GraphQLSchema): Record<string, Record<string, number>> {
    const report: Record<string, Record<string, number>> = {};
    for (const type of Object.values(schema.getTypeMap())) {
      if (!isObjectType(type) || type.name.startsWith('__')) continue;
      for (const field of Object.values(type.getFields())) {
        if (field.deprecationReason == null) continue;
        const name = `${type.name}.${field.name}`;
        report[name] = Object.fromEntries(this.usage.get(name) ?? []);
      }
    }
    return report;
  }
}

/** Records which fields each app version touches, on every request. */
export function useFieldUsage(store: UsageStore): Plugin {
  return {
    onExecute({ args }) {
      const request = (args.contextValue as { request?: Request }).request;
      store.record(clientFrom(request), fieldsUsed(args.schema, args.document));
    },
  };
}
