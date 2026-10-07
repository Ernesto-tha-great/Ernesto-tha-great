import type { QueuedRequest } from './types.js';

/** Where checked-in requests live between app launches. */
export interface QueueStorage {
  load(): Promise<QueuedRequest[]>;
  save(items: readonly QueuedRequest[]): Promise<void>;
}

/** For tests and the simulator. Survives a simulated app kill if you keep the instance. */
export class MemoryStorage implements QueueStorage {
  private snapshot = '[]';
  writes = 0;

  async load(): Promise<QueuedRequest[]> {
    return JSON.parse(this.snapshot) as QueuedRequest[];
  }

  async save(items: readonly QueuedRequest[]): Promise<void> {
    this.snapshot = JSON.stringify(items);
    this.writes++;
  }
}

/**
 * Anything with getItem/setItem: AsyncStorage directly, or a two-line MMKV wrapper.
 * The whole queue is one key, which keeps writes atomic on both libraries.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null | undefined;
  setItem(key: string, value: string): Promise<void> | void;
}

export function createKeyValueStorage(kv: KeyValueStore, key = 'checked-luggage/v1'): QueueStorage {
  return {
    async load() {
      const raw = await kv.getItem(key);
      return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
    },
    async save(items) {
      await kv.setItem(key, JSON.stringify(items));
    },
  };
}
