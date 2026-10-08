import { backoff } from './backoff';

export interface QueuedRequest {
  /** A unique ID for this request. Sent as the Idempotency-Key header on every attempt. */
  id: string;
  path: string;
  body: unknown;
  attempts: number;
  /** Saved with the item, so a retry schedule survives the app being killed. */
  nextAttemptAt: number;
  lastError?: string;
}

/** Where the queue keeps its requests between launches. */
export interface Storage {
  load(): Promise<QueuedRequest[]>;
  save(items: QueuedRequest[]): Promise<void>;
}

export interface QueueOptions {
  baseUrl: string;
  storage: Storage;
  /** Makes the unique ID. On React Native, pass expo-crypto's randomUUID. */
  createId?: () => string;
  /** Asks your server if it's reachable before a flush. */
  probe?: () => Promise<boolean>;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onDeadLetter?: (item: QueuedRequest, reason: string) => void;
}

type Result = { outcome: 'delivered' } | { outcome: 'rejected' | 'retry'; reason: string };

export class OfflineQueue {
  private items: QueuedRequest[] = [];
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private probeFailures = 0;

  constructor(private readonly options: QueueOptions) {}

  /** Resolves once the request is on disk, so it's safe to tell the user "Saved". */
  async enqueue(path: string, body: unknown): Promise<QueuedRequest> {
    await this.load();
    const item: QueuedRequest = {
      id: this.options.createId?.() ?? crypto.randomUUID(),
      path,
      body,
      attempts: 0,
      nextAttemptAt: Date.now(),
    };
    this.items.push(item);
    await this.save();
    return item;
  }

  async pending(): Promise<number> {
    await this.load();
    return this.items.length;
  }

  /** When the next item is due, so the app knows when to try again. */
  nextWakeAt(): number | null {
    if (this.items.length === 0) return null;
    return Math.min(...this.items.map((item) => item.nextAttemptAt));
  }

  /** Sends everything that's due. Two callers at once share one flush. */
  flush(): Promise<void> {
    this.flushing ??= this.sendDue().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendDue(): Promise<void> {
    await this.load();
    const due = this.items.filter((item) => item.nextAttemptAt <= Date.now());
    if (due.length === 0) return;

    if (this.options.probe && !(await this.options.probe())) {
      // The server isn't reachable. That's not any item's fault, so no item
      // loses an attempt. We just wait longer before checking again.
      this.probeFailures++;
      const wait = Math.max(this.baseDelay, backoff(this.probeFailures, this.baseDelay, this.maxDelay));
      for (const item of due) item.nextAttemptAt = Date.now() + wait;
      await this.save();
      return;
    }
    this.probeFailures = 0;

    for (const item of due) {
      const result = await this.send(item);

      if (result.outcome === 'delivered') {
        this.remove(item);
      } else if (result.outcome === 'rejected') {
        // The server read it and said no. Retrying won't change its mind.
        this.remove(item);
        this.options.onDeadLetter?.(item, result.reason);
      } else {
        item.attempts++;
        item.lastError = result.reason;
        item.nextAttemptAt = Date.now() + backoff(item.attempts, this.baseDelay, this.maxDelay);
      }
      await this.save();

      // If the network just failed us, don't fire the rest of the queue into it.
      if (result.outcome === 'retry') break;
    }
  }

  private async send(item: QueuedRequest): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await fetch(`${this.options.baseUrl}${item.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': item.id },
        body: JSON.stringify(item.body),
        signal: controller.signal,
      });
      if (res.ok) return { outcome: 'delivered' };
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'retry', reason: `HTTP ${res.status}` };
      }
      return { outcome: 'rejected', reason: `HTTP ${res.status}: ${await res.text()}` };
    } catch (err) {
      return { outcome: 'retry', reason: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  private remove(item: QueuedRequest): void {
    this.items = this.items.filter((other) => other.id !== item.id);
  }

  /** Saves run one after another, so a double tap can't make two writes trip over each other. */
  private save(): Promise<void> {
    const items = this.items;
    this.saving = this.saving.catch(() => {}).then(() => this.options.storage.save(items));
    return this.saving;
  }

  private load(): Promise<void> {
    this.loading ??= this.options.storage.load().then((saved) => {
      this.items = [...saved, ...this.items];
    });
    return this.loading;
  }

  private get baseDelay() {
    return this.options.baseDelayMs ?? 1_000;
  }

  private get maxDelay() {
    return this.options.maxDelayMs ?? 60_000;
  }
}
