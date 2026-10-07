import { fullJitterDelay } from './backoff.js';
import type { QueueStorage } from './storage.js';
import {
  TransportError,
  type ItemResult,
  type NewRequest,
  type QueuedRequest,
  type Reachability,
  type Transport,
} from './types.js';

export interface OfflineQueueOptions {
  storage: QueueStorage;
  transport: Transport;
  /** Checked before a flush. Without it, the queue trusts whoever called flush(). */
  probe?: () => Promise<Reachability>;
  /** Skip the probe if the server answered us this recently. Default 30 s. */
  probeFreshnessMs?: number;
  maxBatchSize?: number;
  /** How many times the *server* may say "retry" before the item is dead-lettered. */
  maxServerRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  random?: () => number;
  createId?: () => string;
  onDelivered?: (item: QueuedRequest) => void;
  onDeadLetter?: (item: QueuedRequest, reason: string) => void;
}

export interface FlushReport {
  reachability: Reachability | 'unchecked';
  sent: number;
  delivered: number;
  retrying: number;
  deadLettered: number;
}

export class OfflineQueue {
  private items: QueuedRequest[] = [];
  private loading: Promise<void> | null = null;
  private inFlight: Promise<FlushReport> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** Failed reachability checks in a row, and when it's worth checking again. */
  private probeFailures = 0;
  private notBefore = 0;
  /** Last time the server answered (probe or batch). A recent answer makes the probe redundant. */
  private lastHeardFromServer = 0;

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly createId: () => string;
  private readonly maxBatchSize: number;
  private readonly maxServerRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly probeFreshnessMs: number;

  constructor(private readonly options: OfflineQueueOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.maxBatchSize = options.maxBatchSize ?? 20;
    this.maxServerRetries = options.maxServerRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.probeFreshnessMs = options.probeFreshnessMs ?? 30_000;
  }

  /**
   * Check-in. The request is tagged and written to storage *before* this resolves,
   * so it's safe to tell the user "Saved" the moment it does.
   */
  async enqueue(request: NewRequest): Promise<QueuedRequest> {
    await this.ready();
    const now = this.now();
    const item: QueuedRequest = {
      ...request,
      id: this.createId(),
      createdAt: now,
      attempts: 0,
      serverRetries: 0,
      nextAttemptAt: now,
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  /** Sends everything that is due. Concurrent callers share one flush. */
  flush(): Promise<FlushReport> {
    this.inFlight ??= this.doFlush().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * When the next flush is worth attempting, so the app can schedule a wake-up.
   * Accounts for both per-item backoff and backoff on failed reachability checks.
   */
  nextWakeAt(): number | null {
    if (this.items.length === 0) return null;
    const earliestItem = Math.min(...this.items.map((item) => item.nextAttemptAt));
    return Math.max(earliestItem, this.notBefore);
  }

  async pending(): Promise<readonly QueuedRequest[]> {
    await this.ready();
    return this.items.map((item) => ({ ...item }));
  }

  private async doFlush(): Promise<FlushReport> {
    await this.ready();
    const report: FlushReport = {
      reachability: 'unchecked',
      sent: 0,
      delivered: 0,
      retrying: 0,
      deadLettered: 0,
    };

    const due = this.items.filter((item) => item.nextAttemptAt <= this.now());
    if (due.length === 0) return report;

    const heardRecently = this.now() - this.lastHeardFromServer < this.probeFreshnessMs;
    if (this.options.probe && !heardRecently) {
      report.reachability = await this.options.probe();
      if (report.reachability !== 'online') {
        // The airport is closed. That isn't the luggage's fault, so no item
        // attempt is burned. The queue backs off its *checks* instead.
        this.probeFailures++;
        const delay = fullJitterDelay(this.probeFailures, this.baseDelayMs, this.maxDelayMs, this.random);
        this.notBefore = this.now() + Math.max(this.baseDelayMs, delay);
        return report;
      }
      this.probeFailures = 0;
      this.notBefore = 0;
      this.lastHeardFromServer = this.now();
    }

    for (const batch of chunk(due, this.maxBatchSize)) {
      report.sent += batch.length;

      let results: ItemResult[];
      try {
        results = await this.options.transport(batch);
      } catch (err) {
        const retryAfterMs = err instanceof TransportError ? err.retryAfterMs : undefined;
        for (const item of batch) this.scheduleRetry(item, describe(err), retryAfterMs);
        report.retrying += batch.length;
        this.lastHeardFromServer = 0; // whatever we knew about the network is stale now
        await this.persist();
        // The network just failed us. Don't fire the rest of the batches into it.
        break;
      }

      this.lastHeardFromServer = this.now();
      const verdicts = new Map(results.map((result) => [result.id, result]));
      for (const item of batch) {
        const verdict: ItemResult = verdicts.get(item.id) ?? {
          id: item.id,
          status: 'retry',
          reason: 'missing from batch response',
        };

        if (verdict.status === 'delivered') {
          this.remove(item);
          report.delivered++;
          this.options.onDelivered?.(item);
        } else if (verdict.status === 'rejected') {
          this.deadLetter(item, verdict.reason);
          report.deadLettered++;
        } else {
          item.serverRetries++;
          if (item.serverRetries >= this.maxServerRetries) {
            this.deadLetter(item, `server asked for ${item.serverRetries} retries: ${verdict.reason}`);
            report.deadLettered++;
          } else {
            this.scheduleRetry(item, verdict.reason);
            report.retrying++;
          }
        }
      }
      await this.persist();
    }

    return report;
  }

  private scheduleRetry(item: QueuedRequest, reason: string, minDelayMs = 0): void {
    item.attempts++;
    const delay = fullJitterDelay(item.attempts, this.baseDelayMs, this.maxDelayMs, this.random);
    item.nextAttemptAt = this.now() + Math.max(delay, minDelayMs);
    item.lastError = reason;
  }

  private deadLetter(item: QueuedRequest, reason: string): void {
    this.remove(item);
    this.options.onDeadLetter?.(item, reason);
  }

  private remove(item: QueuedRequest): void {
    this.items = this.items.filter((candidate) => candidate.id !== item.id);
  }

  private ready(): Promise<void> {
    this.loading ??= this.options.storage.load().then((stored) => {
      this.items = [...stored, ...this.items];
    });
    return this.loading;
  }

  /** Writes are chained so a slow save can never land after a newer one. */
  private persist(): Promise<void> {
    const snapshot = this.items.map((item) => ({ ...item }));
    this.writeChain = this.writeChain.then(() => this.options.storage.save(snapshot));
    return this.writeChain;
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function describe(err: unknown): string {
  if (err instanceof TransportError) return `${err.kind}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
