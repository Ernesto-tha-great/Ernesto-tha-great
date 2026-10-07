import { createServer, type IncomingMessage, type Server } from 'node:http';
import { OrderService, type BatchItem } from './core.js';

export interface AppOptions {
  service: OrderService;
  /**
   * Probability of processing a batch and then dropping the connection before the
   * response leaves. This is the failure that turns naive retries into duplicates.
   */
  dropResponseRate?: number;
  random?: () => number;
}

export function createApp(options: AppOptions): Server {
  const random = options.random ?? Math.random;

  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/generate_204') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/orders') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ executions: options.service.executions }));
      return;
    }

    if (req.method === 'POST' && req.url === '/batch') {
      let items: BatchItem[];
      try {
        const parsed = JSON.parse(await readBody(req)) as { items?: BatchItem[] };
        if (!Array.isArray(parsed.items)) throw new Error('items must be an array');
        items = parsed.items;
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
        return;
      }

      const results = options.service.processBatch(items);

      if (random() < (options.dropResponseRate ?? 0)) {
        // The order is saved. The phone will never know.
        req.socket.destroy();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  });
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
