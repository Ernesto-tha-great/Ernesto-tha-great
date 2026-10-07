import { createApp } from './app.js';
import { OrderService } from './core.js';

const port = Number(process.env.PORT ?? 8787);
const dropResponseRate = Number(process.env.DROP_RESPONSE_RATE ?? 0);
const honourIdempotencyKeys = process.env.IGNORE_KEYS !== '1';

const service = new OrderService({ honourIdempotencyKeys });
createApp({ service, dropResponseRate }).listen(port, () => {
  console.log(`orders API on http://localhost:${port}`);
  console.log(`  idempotency keys: ${honourIdempotencyKeys ? 'honoured' : 'IGNORED'}`);
  console.log(`  dropped responses: ${(dropResponseRate * 100).toFixed(0)}%`);
});
