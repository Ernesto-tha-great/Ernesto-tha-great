// Would this schema break an app version we still support?
//   npm run check-schema                        # the schema as it is
//   npm run check-schema -- Order.created_at    # as if these fields were deleted
import { readdir, readFile } from 'node:fs/promises';
import { buildASTSchema, parse, validate, visit } from 'graphql';
import { typeDefs } from '../src/schema';

const remove = new Set(process.argv.slice(2));
const support = JSON.parse(await readFile('clients/support.json', 'utf8')) as Record<string, string[]>;

// The schema we'd have if those fields were deleted from the SDL.
const schema = buildASTSchema(
  visit(parse(typeDefs), {
    ObjectTypeDefinition(node) {
      return { ...node, fields: node.fields?.filter((field) => !remove.has(`${node.name.value}.${field.name.value}`)) };
    },
  }),
);

let broken = 0;
for (const [client, versions] of Object.entries(support)) {
  for (const version of versions) {
    const dir = `clients/${client}/${version}`;
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.graphql'))) {
      for (const error of validate(schema, parse(await readFile(`${dir}/${file}`, 'utf8')))) {
        broken++;
        console.log(`✗ ${client} ${version} ${file}: ${error.message}`);
      }
    }
  }
}

const change = remove.size ? `Removing ${[...remove].join(', ')}` : 'This schema';
if (broken > 0) {
  console.log(`\n${change} would break ${broken} operation${broken === 1 ? '' : 's'} in app versions we still support.`);
  process.exit(1);
}
console.log(`✓ ${change} is safe for every app version we still support.`);
