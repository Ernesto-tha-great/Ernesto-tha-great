import { createOrdersServer } from './app';

const port = Number(process.env.PORT ?? 8787);
const { server } = createOrdersServer({ dropRate: Number(process.env.DROP_RATE ?? 0.3) });

server.listen(port, () => {
  console.log(`Orders API on http://localhost:${port}`);
});
