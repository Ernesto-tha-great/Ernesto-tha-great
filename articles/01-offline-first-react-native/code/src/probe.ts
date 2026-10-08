/**
 * Asks your own server for an empty 204. Anything else (a login page, a
 * redirect, a timeout) means a request wouldn't get through right now.
 */
export function createProbe(url: string, timeoutMs = 5_000) {
  return async (): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
      return res.status === 204;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
