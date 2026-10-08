import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createProbe } from './probe';
import { OfflineQueue, type QueuedRequest, type Storage } from './queue';

const API = 'https://your-api.example.com';
const KEY = 'offline-queue/v1';

// The same two methods as fileStorage, backed by AsyncStorage. The whole queue
// lives under one key, so every save replaces it in a single write.
const asyncStorage: Storage = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedRequest[]) : [];
  },
  async save(items) {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  },
};

export const queue = new OfflineQueue({
  baseUrl: API,
  storage: asyncStorage,
  probe: createProbe(`${API}/generate_204`),
  createId: randomUUID,
});
