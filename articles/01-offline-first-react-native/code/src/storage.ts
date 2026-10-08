import { readFile, rename, writeFile } from 'node:fs/promises';
import type { QueuedRequest, Storage } from './queue';

/** A JSON file on disk. On a phone, AsyncStorage or MMKV plays this part. */
export function fileStorage(path: string): Storage {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as QueuedRequest[];
      } catch {
        return [];
      }
    },
    async save(items) {
      // Write to a temporary file, then rename it over the old one. A rename is
      // atomic, so a crash mid-write can't leave half a file behind.
      await writeFile(`${path}.tmp`, JSON.stringify(items));
      await rename(`${path}.tmp`, path);
    },
  };
}
