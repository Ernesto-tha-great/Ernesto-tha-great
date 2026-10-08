import { createGraphQLError, createSchema } from 'graphql-yoga';
import type { CustomerRow, Db, OrderItemRow, OrderRow, ProductRow } from '../db.js';
import type { Loaders } from './loaders.js';

/**
 * The schema the app actually wanted: shaped around screens, not tables.
 * The old fields are still here, marked @deprecated and re-implemented on top
 * of the new resolvers, so app versions that will never update keep working.
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    viewer: Viewer
    product(id: ID!): Product

    customer(id: ID!): Customer @deprecated(reason: "Use viewer.")
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
    "In minor units: cents, pence, kobo."
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

  type Customer {
    id: ID!
    name: String
    email: String
  }
`;

export interface V2Context {
  db: Db;
  loaders: Loaders;
  viewerId: string | null;
}

const MAX_PAGE = 50;

export const schema = createSchema<V2Context>({
  typeDefs,
  resolvers: {
    Query: {
      viewer: (_, __, { db, viewerId }) =>
        viewerId ? db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', viewerId) : null,
      product: (_, { id }: { id: string }, { loaders }) => loaders.productById.load(id),

      // Legacy: Android 2.x still calls these. Same answers as before, but now
      // they check who's asking, which v1 never did.
      customer: (_, { id }: { id: string }, ctx) => {
        assertViewer(ctx, id);
        return ctx.db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', id);
      },
      orders: (_, { customer_id }: { customer_id: string }, ctx) => {
        assertViewer(ctx, customer_id);
        return ctx.db.all<OrderRow>(
          'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC',
          customer_id,
        );
      },
    },

    Viewer: {
      orders: async (viewer: CustomerRow, { first, after }: { first: number; after?: string }, { db }) => {
        const limit = Math.min(Math.max(first, 1), MAX_PAGE);
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

        const page = rows.slice(0, limit);
        const edges = page.map((order) => ({ cursor: encodeCursor(order), node: order }));
        return {
          edges,
          pageInfo: { hasNextPage: rows.length > limit, endCursor: edges.at(-1)?.cursor ?? null },
        };
      },
    },

    Order: {
      placedAt: (order: OrderRow) => order.created_at,
      lineItems: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
      total: async (order: OrderRow, _, { loaders }) => {
        const items = await loaders.itemsByOrderId.load(order.id);
        const products = await loaders.productById.loadMany(items.map((item) => item.product_id));
        const amount = items.reduce((sum, item, i) => {
          const product = products[i];
          return product && !(product instanceof Error) ? sum + item.qty * product.price_cents : sum;
        }, 0);
        return money(amount);
      },
    },

    OrderItem: {
      quantity: (item: OrderItemRow) => item.qty,
      product: async (item: OrderItemRow, _, { loaders }) => {
        const product = await loaders.productById.load(item.product_id);
        if (!product) throw createGraphQLError(`Product ${item.product_id} not found`);
        return product;
      },
      unitPrice: async (item: OrderItemRow, _, { loaders }) => {
        const product = await loaders.productById.load(item.product_id);
        return money(product?.price_cents ?? 0);
      },
    },

    Product: {
      price: (product: ProductRow) => money(product.price_cents),
    },
  },
});

function assertViewer(ctx: V2Context, customerId: string): void {
  if (ctx.viewerId !== customerId) {
    throw createGraphQLError('Not allowed to read another customer’s data', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

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
