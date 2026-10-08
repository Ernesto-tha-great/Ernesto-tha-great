import { createSchema } from 'graphql-yoga';
import type { Db, OrderItemRow, OrderRow, ProductRow } from './db';

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
}

export const schema = createSchema<Context>({
  typeDefs,
  resolvers: {
    Query: {
      orders: (_, { customer_id }: { customer_id: string }, { db }) =>
        db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id),
      product: (_, { id }: { id: string }, { db }) => db.get<ProductRow>('SELECT * FROM products WHERE id = ?', id),
    },
    Order: {
      // One query per order.
      order_items: (order: OrderRow, _, { db }) =>
        db.all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id),
    },
    OrderItem: {
      // One query per item.
      product: (item: OrderItemRow, _, { db }) => db.get<ProductRow>('SELECT * FROM products WHERE id = ?', item.product_id),
    },
  },
});
