import { createSchema } from 'graphql-yoga';
import type { Db, OrderItemRow, OrderRow } from './db';
import type { Loaders } from './loaders';

export const typeDefs = /* GraphQL */ `
  type Query {
    orders(customer_id: ID!): [Order]
    product(id: ID!): Product
  }

  type Order {
    id: ID!
    customer_id: ID
    status: String
    created_at: String
    order_items: [OrderItem]
  }

  type OrderItem {
    id: ID!
    order_id: ID
    product_id: ID
    qty: Int
    product: Product
  }

  type Product {
    id: ID!
    name: String
    price_cents: Int
  }
`;

export interface Context {
  db: Db;
  loaders: Loaders;
}

export const schema = createSchema<Context>({
  typeDefs,
  resolvers: {
    Query: {
      orders: (_, { customer_id }: { customer_id: string }, { db }) =>
        db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id),
      product: (_, { id }: { id: string }, { loaders }) => loaders.productById.load(id),
    },
    Order: {
      order_items: (order: OrderRow, _, { loaders }) => loaders.itemsByOrderId.load(order.id),
    },
    OrderItem: {
      product: (item: OrderItemRow, _, { loaders }) => loaders.productById.load(item.product_id),
    },
  },
});
