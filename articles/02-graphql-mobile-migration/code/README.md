# Migrating a GraphQL schema without breaking old app versions

This is the finished code for my tutorial, **[How To Migrate a GraphQL Schema Without Breaking Old Mobile App Versions](https://github.com/Ernesto-tha-great/Ernesto-tha-great/blob/main/articles/02-graphql-mobile-migration/article.md)**.

If you're following along, build it from the article, step by step. This repo is here so you can check your work, or skip ahead.

![Same data, two shapes: the table-shaped schema next to the screen-shaped one, with the old fields kept as deprecated aliases](docs/images/schema-shapes.svg)

## Run it

You need Node.js 22.13 or newer.

```bash
git clone https://github.com/Ernesto-tha-great/graphql-mobile-migration.git
cd graphql-mobile-migration
npm install

npm run dev                            # GraphQL on http://localhost:4000/graphql, usage report on /usage
npm run count -- android/2.3           # one app version's order history query: statements and time
npm run check-schema                   # does every supported app version still validate?
npm run check-schema -- Order.created_at   # ...and if this field were deleted?
npm test                               # 8 tests
```

## What's in here

```text
src/        db.ts, schema.ts, loaders.ts, usage.ts, app.ts, main.ts
clients/    the OrderHistory query each app version ships, and support.json
scripts/    count.ts and check-schema.ts
test/       tests for the schema, paging, auth, usage and check-schema
```

## License

MIT
