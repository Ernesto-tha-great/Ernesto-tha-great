import { buildASTSchema, parse, validate, visit, type GraphQLSchema } from 'graphql';
import type { SupportPolicy } from './clients.js';
import type { Manifest } from './trusted.js';

/** The schema you'd have if these fields were deleted from the SDL. */
export function schemaWithout(sdl: string, coordinates: readonly string[]): GraphQLSchema {
  const remove = new Set(coordinates);
  const pruned = visit(parse(sdl), {
    ObjectTypeDefinition(node) {
      return {
        ...node,
        fields: node.fields?.filter((field) => !remove.has(`${node.name.value}.${field.name.value}`)),
      };
    },
  });
  return buildASTSchema(pruned);
}

export interface Breakage {
  client: string;
  version: string;
  operation: string;
  message: string;
}

/**
 * Would any supported app version break? Validates every operation those
 * versions shipped against the candidate schema. No traffic needed: the
 * manifests already say exactly what each build can send.
 */
export function findBreakages(schema: GraphQLSchema, manifests: readonly Manifest[], support: SupportPolicy): Breakage[] {
  const breakages: Breakage[] = [];
  for (const manifest of manifests) {
    if (!support[manifest.client]?.includes(manifest.version)) continue;
    for (const document of Object.values(manifest.operations)) {
      const ast = parse(document);
      const operation = ast.definitions.find((def) => def.kind === 'OperationDefinition');
      const name = operation && 'name' in operation ? (operation.name?.value ?? 'anonymous') : 'anonymous';
      for (const error of validate(schema, ast)) {
        breakages.push({ client: manifest.client, version: manifest.version, operation: name, message: error.message });
      }
    }
  }
  return breakages;
}
