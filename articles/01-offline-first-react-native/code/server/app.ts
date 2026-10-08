import { createServer, type IncomingMessage } from 'node:http';

export interface Order {
  id: number;
  sku: string;
  qty: number;
}

export interface ServerOptions {
  /** Share of orders that get saved, and then the connection drops before the reply. */
  dropRate?: number;
  random?: () => number;
}

export function createOrdersServer(options: ServerOptions = {}) {
  const dropRate = options.dropRate ?? 0;
  const random = options.random ?? Math.random;

  const orders: Order[] = [];
  const replies = new Map<string, string>();
  let down = false;

  const server = createServer(async (req, res) => {
    if (down) {
      req.socket.destroy();
      return;
    }

    if (req.method === 'GET' && req.url === '/generate_204') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/orders') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(orders));
      return;
    }

    if (req.method === 'POST' && req.url === '/orders') {
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string' && replies.has(key)) {
        // We've seen this key before. Send the same answer, don't make a new order.
        res.writeHead(201, { 'content-type': 'application/json' }).end(replies.get(key));
        return;
      }

      const body = JSON.parse(await readBody(req)) as Partial<Order>;
      if (typeof body.sku !== 'string' || !Number.isInteger(body.qty) || body.qty! < 1) {
        res.writeHead(422, { 'content-type': 'application/json' }).end('{"error":"sku and qty are required"}');
        return;
      }

      const order: Order = { id: orders.length + 1, sku: body.sku, qty: body.qty! };
      orders.push(order);
      const reply = JSON.stringify(order);
      if (typeof key === 'string') replies.set(key, reply);

      if (random() < dropRate) {
        // The order is saved. The phone will never hear about it.
        req.socket.destroy();
        return;
      }

      res.writeHead(201, { 'content-type': 'application/json' }).end(reply);
      return;
    }

    res.writeHead(404).end();
  });

  return {
    server,
    orders,
    /** Simulate an outage: every request gets its connection dropped. */
    setDown(value: boolean) {
      down = value;
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
