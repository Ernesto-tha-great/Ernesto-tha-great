import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiCall } from './store';

export interface InstrumentOptions {
  record(call: ApiCall): void;
  /** Which account does this API key belong to? People rotate keys; accounts stay. */
  developerFor(apiKey: string): string | null;
  /** The route *template*, e.g. /v1/labels/:id. Raw paths make every label its own row. */
  routeOf(req: IncomingMessage): string;
}

/**
 * Records one api_call per request, after the response is sent. Works as plain
 * Node http middleware or as Express middleware: (req, res, next).
 */
export function instrument(options: InstrumentOptions) {
  return (req: IncomingMessage, res: ServerResponse, next?: () => void): void => {
    const at = new Date();
    res.on('finish', () => {
      const key = bearerToken(req);
      const developerId = key ? options.developerFor(key) : null;
      if (!key || !developerId) return; // anonymous traffic isn't a developer journey

      options.record({
        developerId,
        at,
        method: req.method ?? 'GET',
        route: options.routeOf(req),
        status: res.statusCode,
        keyMode: key.startsWith('sk_live_') ? 'live' : 'test',
        sdk: req.headers['user-agent'] ?? null,
      });
    });
    next?.();
  };
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
