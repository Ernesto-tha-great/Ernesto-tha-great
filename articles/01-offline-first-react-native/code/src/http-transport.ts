import { TransportError, type ItemResult, type Transport } from './types.js';

export interface HttpTransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Sends a batch to POST {baseUrl}/batch and expects one result per item back.
 * Anything that isn't a well-formed JSON verdict is a TransportError: the queue
 * backs off and tries again later, without counting it against the item.
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return async (batch) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await doFetch(`${options.baseUrl}/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify({
          items: batch.map(({ id, method, path, body }) => ({ id, method, path, body })),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new TransportError(
        controller.signal.aborted ? 'timeout' : 'offline',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429 || res.status >= 500) {
      throw new TransportError('server-unavailable', `HTTP ${res.status}`, parseRetryAfter(res));
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      // A hotel Wi-Fi login page is a 200 OK too. Never trust a status code alone.
      throw new TransportError('captive-portal', `expected JSON, got ${res.status} ${contentType}`);
    }

    if (!res.ok) {
      throw new TransportError('bad-response', `HTTP ${res.status} for the batch envelope`);
    }

    const payload = (await res.json()) as { results?: ItemResult[] };
    if (!Array.isArray(payload.results)) {
      throw new TransportError('bad-response', 'response had no results array');
    }
    return payload.results;
  };
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1_000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
