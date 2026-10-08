import { devices, type Browser, type CDPSession } from 'playwright';
import { summariseCoverage } from './coverage.js';

export interface Site {
  name: string;
  url: string;
}

export interface LoadStats {
  /** Bytes over the wire, headers included, as Chrome's network stack counted them. */
  bytes: number;
  requests: number;
  byType: Record<string, number>;
}

export interface SiteMeasurement {
  name: string;
  url: string;
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  /** Bot walls, error pages and "access denied" screens: excluded from the analysis. */
  blocked: boolean;
  cold: LoadStats | null;
  warm: LoadStats | null;
  js: { transferred: number; sourceBytes: number; usedBytes: number } | null;
  error?: string;
}

export interface MeasureOptions {
  timeoutMs?: number;
  /** How long the network has to be idle before we call the page "loaded". */
  quietMs?: number;
  /** Hard cap on waiting for quiet, for pages that never stop polling. */
  maxSettleMs?: number;
}

const BLOCKED = /access denied|just a moment|attention required|are you a robot|captcha|unusual traffic|blocked/i;

/** Counts every byte Chrome receives, by resource type, and tracks what's still in flight. */
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

  takeStats(): LoadStats {
    const stats = this.stats;
    this.stats = { bytes: 0, requests: 0, byType: {} };
    this.inflight.clear();
    return stats;
  }
}

async function settle(tracker: TransferTracker, quietMs: number, maxMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!tracker.busy && Date.now() - tracker.lastActivity >= quietMs) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Loads a page twice as a first-time mobile visitor would: once with an empty
 * cache, once more with whatever the first visit cached. No scrolling, no
 * clicking "accept": just what arrives before anyone touches the screen.
 */
export async function measureSite(browser: Browser, site: Site, options: MeasureOptions = {}): Promise<SiteMeasurement> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const quietMs = options.quietMs ?? 2_000;
  const maxSettleMs = options.maxSettleMs ?? 15_000;

  const context = await browser.newContext({ ...devices['Moto G4'], locale: 'en-US' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const tracker = new TransferTracker(cdp);

  const result: SiteMeasurement = {
    name: site.name, url: site.url, finalUrl: null, status: null, title: null, blocked: false, cold: null, warm: null, js: null,
  };

  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const response = await page.goto(site.url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    const coverage = await page.coverage.stopJSCoverage();

    result.status = response?.status() ?? null;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.blocked = (result.status ?? 0) >= 400 || BLOCKED.test(result.title ?? '');
    result.cold = tracker.takeStats();
    result.js = { transferred: result.cold.byType.Script ?? 0, ...summariseCoverage(coverage) };

    // Leave and come back, like a person would. (Chrome only revalidates the
    // HTML on a reload anyway; the detour keeps this an ordinary navigation.)
    await page.goto('about:blank');
    tracker.takeStats();
    await page.goto(site.url, { waitUntil: 'load', timeout: timeoutMs });
    await settle(tracker, quietMs, maxSettleMs);
    result.warm = tracker.takeStats();
  } catch (err) {
    result.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await context.close();
  }
  return result;
}
