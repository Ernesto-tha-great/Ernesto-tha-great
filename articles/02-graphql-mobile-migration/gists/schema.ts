import { createGraphQLError, createSchema } from 'graphql-yoga';
import type { CustomerRow, Db, OrderItemRow, OrderRow, ProductRow } from './db';
import type { Loaders } from './loaders';

export const typeDefs = /* GraphQL */ `
  type Query {
    viewer: Viewer
    product(id: ID!): Product

    orders(customer_id: ID!): [Order] @deprecated(reason: "Use viewer.orders.")
  }

  type Viewer {
    id: ID!
    name: String!
    orders(first: Int = 20, after: String): OrderConnection!
  }

  type OrderConnection {
    edges: [OrderEdge!]!
    pageInfo: PageInfo!
  }

  type OrderEdge {
    cursor: String!
    node: Order!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type Money {
    "In the smallest unit: cents, pence, kobo."
    amount: Int!
    currency: String!
    formatted: String!
  }

  type Order {
    id: ID!
    status: String!
    placedAt: String!
    total: Money!
    lineItems: [OrderItem!]!

    customer_id: ID @deprecated(reason: "Orders are always the viewer's.")
    created_at: String @deprecated(reason: "Use placedAt.")
    order_items: [OrderItem] @deprecated(reason: "Use lineItems.")
  }

  type OrderItem {
    id: ID!
    quantity: Int!
    unitPrice: Money!
    product: Product!

    order_id: ID @deprecated(reason: "You already have the order.")
    product_id: ID @deprecated(reason: "Use product.id.")
    qty: Int @deprecated(reason: "Use quantity.")
  }

  type Product {
    id: ID!
    name: String!
    price: Money!

    price_cents: Int @deprecated(reason: "Use price.")
  }
`;

export interface Context {
  db: Db;
  loaders: Loaders;
  viewerId: string | null;
}

export const schema = createSchema<Context>({
  typeDefs,
  resolvers: {
    Query: {
      viewer: (_, __, { db, viewerId }) =>
        viewerId ? db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', viewerId) : null,
      product: (_, { id }: { id: string }, { loaders }) => loaders.productById.load(id),

      // The old field, still here for app versions that never update. It now
      // checks who's asking, which the first version never did.
      orders: (_, { customer_id }: { customer_id: string }, { db, viewerId }) => {
        if (viewerId !== customer_id) {
          throw createGraphQLError("You can only see your own orders", { extensions: { code: 'FORBIDDEN' } });
        }
        return db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id);
      },
    },

    Viewer: {
      orders: async (viewer: CustomerRow, { first, after }: { first: number; after?: string }, { db }) => {
        const limit = Math.min(Math.max(first, 1), 100);
        const cursor = after ? decodeCursor(after) : null;
        const rows = cursor
          ? await db.all<OrderRow>(
              `SELECT * FROM orders WHERE customer_id = ? AND (created_at, id) < (?, ?)
               ORDER BY created_at DESC, id DESC LIMIT ?`,
              viewer.id, cursor.createdAt, cursor.id, limit + 1,
            )
          : await db.all<OrderRow>(
              'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
              viewer.id, limit + 1,
            );

        // We asked for one extra row. If it came back, there's another page.
        const page = rows.slice(0, limit);
        const edges = page.map((order) => ({ cursor: encodeCursor(order), node: order }));
        return { edges, pageInfo: { hasNextPage: rows.length > limit, endCursor: edges.at(-1)?.cursor ?? null } };
      },
    },

    Order: {
      placedAt: (order: OrderRow) => order.created_at,
      lineItems: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      total: async (order: OrderRow, _, { loaders }) => {
        const items = await loaders.itemsByOrderId.load(order.id);
        // Ask for every product at once, so they all land in the same batch.
        const products = await loaders.productById.loadMany(items.map((item) => item.product_id));
        let amount = 0;
        items.forEach((item, i) => {
          const product = products[i];
          if (product && !(product instanceof Error)) amount += item.qty * product.price_cents;
        });
        return money(amount);
      },
    },

    OrderItem: {
      quantity: (item: OrderItemRow) => item.qty,
      unitPrice: async (item: OrderItemRow, _, { loaders }) => money((await loaders.productById.load(item.product_id))?.price_cents ?? 0),
      product: async (item: OrderItemRow, _, { loaders }) => {
        const product = await loaders.productById.load(item.product_id);
        if (!product) throw createGraphQLError(`Product ${item.product_id} not found`);
        return product;
      },
    },

    Product: {
      price: (product: ProductRow) => money(product.price_cents),
    },
  },
});

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function money(amount: number) {
  return { amount, currency: 'USD', formatted: formatter.format(amount / 100) };
}

function encodeCursor(order: OrderRow): string {
  return Buffer.from(`${order.created_at}|${order.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id) throw createGraphQLError('Invalid cursor', { extensions: { code: 'BAD_USER_INPUT' } });
  return { createdAt, id };
}
