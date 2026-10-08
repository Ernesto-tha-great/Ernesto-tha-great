import { createSchema } from 'graphql-yoga';
import type { CustomerRow, Db, OrderItemRow, OrderRow, ProductRow } from '../db.js';

/**
 * The schema I'd have shipped on day one: the database, wearing a GraphQL costume.
 * Every table is a type, every column is a field, and every relationship is a
 * resolver that runs its own query.
 */
export const typeDefs = /* GraphQL */ `
  type Query {
    customer(id: ID!): Customer
    orders(customer_id: ID!): [Order]
    product(id: ID!): Product
  }

  type Customer {
    id: ID!
    name: String
    email: String
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

export interface V1Context {
  db: Db;
}

export const schema = createSchema<V1Context>({
  typeDefs,
  resolvers: {
    Query: {
      customer: (_, { id }: { id: string }, { db }) => db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', id),
      orders: (_, { customer_id }: { customer_id: string }, { db }) =>
        db.all<OrderRow>('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC', customer_id),
      product: (_, { id }: { id: string }, { db }) => db.get<ProductRow>('SELECT * FROM products WHERE id = ?', id),
    },
    Order: {
      // One query per order. 100 orders, 100 queries.
      order_items: (order: OrderRow, _, { db }) =>
        db.all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id),
    },
    OrderItem: {
      // One query per item. 300 items, 300 queries.
      product: (item: OrderItemRow, _, { db }) =>
        db.get<ProductRow>('SELECT * FROM products WHERE id = ?', item.product_id),
    },
  },
});
