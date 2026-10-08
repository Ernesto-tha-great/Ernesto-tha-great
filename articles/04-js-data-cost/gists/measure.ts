import { devices, type Browser, type CDPSession } from 'playwright';
import { summariseCoverage } from './coverage';

export interface LoadStats {
  /** Bytes over the wire, headers included, as Chrome's network stack counted them. */
  bytes: number;
  requests: number;
  byType: Record<string, number>;
}

export interface PageMeasurement {
  url: string;
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  /** Bot walls, error pages and "access denied" screens. */
  blocked: boolean;
  /** The first visit, with an empty cache. */
  cold: LoadStats | null;
  /** The repeat visit, with whatever the first visit cached. */
  warm: LoadStats | null;
  /** JavaScript on the first visit: bytes on the wire, and characters of source that did and didn't run. */
  js: { transferred: number; sourceBytes: number; usedBytes: number } | null;
  error?: string;
}

export interface MeasureOptions {
  timeoutMs?: number;
  /** How long the network has to be quiet before we call the page "loaded". */
  quietMs?: number;
  /** The longest we'll wait for quiet, for pages that never stop talking. */
  maxSettleMs?: number;
}

const BLOCKED = /access denied|just a moment|attention required|are you a robot|captcha|unusual traffic|blocked/i;

/** Counts every byte Chrome receives, by resource type, and keeps track of what's still in flight. */
class TransferTracker {
  private types = new Map<string, string>();
  private inflight = new Set<string>();
  private stats: LoadStats = { bytes: 0, requests: 0, byType: {} };
  lastActivity = Date.now();

  constructor(cdp: CDPSession) {
    cdp.on('Network.requestWillBeSent', (e) => {
      this.inflight.add(e.requestId);
      this.lastActivity = Date.now();
    });
    cdp.on('Network.responseReceived', (e) => {
      this.types.set(e.requestId, e.type ?? 'Other');
    });
    cdp.on('Network.loadingFinished', (e) => {
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
      const type = this.types.get(e.requestId) ?? 'Other';
      this.stats.bytes += e.encodedDataLength;
      this.stats.requests += 1;
      this.stats.byType[type] = (this.stats.byType[type] ?? 0) + e.encodedDataLength;
    });
    cdp.on('Network.loadingFailed', (e) => {
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
    });
  }

  get busy(): boolean {
    return this.inflight.size > 0;
  }

  /** Returns the counts so far and starts again from zero. */
  takeStats(): LoadStats {
    const stats = this.stats;
    this.stats = { bytes: 0, requests: 0, byType: {} };
    this.inflight.clear();
    return stats;
  }
}

/** Waits until nothing has been in flight for `quietMs`, or until `maxMs` is up. */
async function settle(tracker: TransferTracker, quietMs: number, maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!tracker.busy && Date.now() - tracker.lastActivity >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Loads a page twice, the way someone on a phone would: once with an empty
 * cache, then again with whatever the first visit cached. No scrolling, no
 * clicking "accept": just what arrives before anyone touches the screen.
 */
export async function measurePage(browser: Browser, url: string, options: MeasureOptions = {}): Promise<PageMeasurement> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const quietMs = options.quietMs ?? 2_000;
  const maxSettleMs = options.maxSettleMs ?? 15_000;

  const context = await browser.newContext({ ...devices['Moto G4'], locale: 'en-US' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracker = new TransferTracker(cdp);

  const result: PageMeasurement = { url, finalUrl: null, status: null, title: null, blocked: false, cold: null, warm: null, js: null };

  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    const coverage = await page.coverage.stopJSCoverage();

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.blocked = (result.status ?? 0) >= 400 || BLOCKED.test(result.title);
    result.cold = tracker.takeStats();
    result.js = { transferred: result.cold.byType.Script ?? 0, ...summariseCoverage(coverage) };

    // Leave and come back, like a person would.
    await page.goto('about:blank');
    tracker.takeStats();
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    result.warm = tracker.takeStats();
  } catch (err) {
    result.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}
