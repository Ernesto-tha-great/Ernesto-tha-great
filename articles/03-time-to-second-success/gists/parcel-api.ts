/**
 * A tiny shipping-label API, instrumented. Run it, curl it, then run the report
 * against events.db to watch your own journey show up.
 *
 *   npm run api
 *   curl -H "Authorization: Bearer sk_test_sam" "localhost:3000/v1/rates?from=10001&to=94103"
 *   npm run report -- events.db
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { instrument } from '../src/middleware';
import { EventStore } from '../src/store';

const store = new EventStore(process.env.EVENTS_DB ?? 'events.db');

const ACCOUNTS: Record<string, string> = {
  sk_test_sam: 'dev_sam',
  sk_live_sam: 'dev_sam',
  sk_test_maya: 'dev_maya',
};
for (const developer of new Set(Object.values(ACCOUNTS))) store.addDeveloper(developer, new Date());

const ROUTES: Array<{ method: string; template: string; pattern: RegExp }> = [
  { method: 'GET', template: '/v1/health', pattern: /^\/v1\/health$/ },
  { method: 'GET', template: '/v1/me', pattern: /^\/v1\/me$/ },
  { method: 'GET', template: '/v1/rates', pattern: /^\/v1\/rates$/ },
  { method: 'POST', template: '/v1/labels', pattern: /^\/v1\/labels$/ },
  { method: 'GET', template: '/v1/labels/:id', pattern: /^\/v1\/labels\/[^/]+$/ },
  { method: 'POST', template: '/v1/webhooks', pattern: /^\/v1\/webhooks$/ },
  { method: 'POST', template: '/v1/webhooks/test', pattern: /^\/v1\/webhooks\/test$/ },
];

function match(req: IncomingMessage) {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  return ROUTES.find((route) => route.method === req.method && route.pattern.test(path));
}

const track = instrument({
  record: (call) => store.recordCall(call),
  developerFor: (key) => ACCOUNTS[key] ?? null,
  routeOf: (req) => match(req)?.template ?? 'unmatched',
});

const webhooks = new Map<string, string>();
let nextLabel = 1;

createServer(async (req, res) => {
  track(req, res);
  const route = match(req);
  if (!route) return send(res, 404, { error: 'not_found' });
  if (route.template === '/v1/health') return send(res, 200, { ok: true });

  const key = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  const developer = ACCOUNTS[key];
  if (!developer) return send(res, 401, { error: 'invalid_api_key', hint: 'Use a key from your dashboard, e.g. sk_test_sam' });
  const live = key.startsWith('sk_live_');
  const body = req.method === 'POST' ? await readJson(req) : {};

  switch (route.template) {
    case '/v1/me':
      return send(res, 200, { developer, mode: live ? 'live' : 'test' });
    case '/v1/rates':
      return send(res, 200, { rates: [{ service: 'standard', amount: 795 }, { service: 'express', amount: 1495 }] });
    case '/v1/labels': {
      const from = body.from as { postcode?: string; verified?: boolean } | undefined;
      if (!from?.postcode || !(body.to as { postcode?: string } | undefined)?.postcode) {
        return send(res, 422, { error: 'missing_address', hint: 'Both from.postcode and to.postcode are required' });
      }
      if (live && !from.verified) {
        // The step where test mode and live mode quietly disagree.
        return send(res, 422, { error: 'address_unverified', hint: 'Verify your sender address in the dashboard first' });
      }
      return send(res, 201, { id: `lbl_${nextLabel++}`, pdf: 'https://example.com/label.pdf' });
    }
    case '/v1/labels/:id':
      return send(res, 200, { id: req.url?.split('/').pop(), status: 'in_transit' });
    case '/v1/webhooks': {
      const url = String(body.url ?? '');
      if (!url.startsWith('https://')) return send(res, 422, { error: 'webhook_url_must_be_https' });
      webhooks.set(developer, url);
      return send(res, 201, { url });
    }
    case '/v1/webhooks/test':
      if (!webhooks.has(developer)) return send(res, 400, { error: 'no_webhook_registered' });
      return send(res, 200, { delivered: true });
  }
}).listen(3000, () => console.log('Parcel API on http://localhost:3000 (events → events.db)'));

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
