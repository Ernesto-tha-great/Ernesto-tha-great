// Send 20 orders the way most apps do: fetch, and retry if it fails.
const API = process.env.API ?? 'http://localhost:8787';

async function placeOrder(sku: string, qty: number) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
