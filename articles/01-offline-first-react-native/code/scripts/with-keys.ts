// The same 20 orders, but every order gets its own idempotency key.
const API = process.env.API ?? 'http://localhost:8787';

async function placeOrder(sku: string, qty: number) {
  const key = crypto.randomUUID(); // one key per order, reused on every retry
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ sku, qty }),
      });
      if (res.ok) return;
    } catch {
      // network error: try again
    }
  }
  console.log(`Gave up on ${sku}`);
}

for (let i = 1; i <= 20; i++) {
  await placeOrder(`SKU-${i}`, 1);
}

try {
  const orders = (await (await fetch(`${API}/orders`)).json()) as Array<{ sku: string }>;
  const unique = new Set(orders.map((order) => order.sku)).size;
  console.log(`Tapped "Save" 20 times. The server has ${orders.length} orders for ${unique} different items.`);
} catch {
  console.log("Couldn't reach the server to count the orders.");
}
