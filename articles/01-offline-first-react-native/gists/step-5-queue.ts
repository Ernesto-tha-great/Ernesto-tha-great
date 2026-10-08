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
}

export class OfflineQueue {
  private items: QueuedRequest[] = [];
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

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
}
