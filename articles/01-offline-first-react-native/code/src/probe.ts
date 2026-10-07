import type { Reachability } from './types.js';

export interface ProbeOptions {
  /** An endpoint you control that answers 204 No Content with an empty body. */
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * NetInfo tells you the phone has a network interface. It can't tell you whether
 * a request will reach your server. A captive portal answers everything with a
 * login page; a phone over its data cap often keeps a connection that goes nowhere.
 * The only honest answer is to ask your own server something tiny.
 *
 * Android does the same with its connectivity check: a 204 means the internet is
 * really there, and anything else means someone is in the way.
 */
export function createReachabilityProbe(options: ProbeOptions): () => Promise<Reachability> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(options.url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
      // Followed or not, a redirect or a 200 login page both mean "not our server".
      return res.status === 204 ? 'online' : 'captive-portal';
    } catch {
      return 'offline';
    } finally {
      clearTimeout(timer);
    }
  };
}
