import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  OfflineQueue,
  createHttpTransport,
  createKeyValueStorage,
  createReachabilityProbe,
} from 'checked-luggage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

/** One queue for the whole app. Two queues sharing a storage key would overwrite each other. */
export const queue = new OfflineQueue({
  storage: createKeyValueStorage(AsyncStorage),
  transport: createHttpTransport({ baseUrl: API_URL }),
  probe: createReachabilityProbe({ url: `${API_URL}/generate_204` }),
  // React Native has no crypto.randomUUID() by default; expo-crypto does.
  createId: () => Crypto.randomUUID(),
  onDeadLetter: (item, reason) => {
    // Surface this to the user. A silently dropped order is worse than an error.
    console.warn(`Could not deliver ${item.path} (${item.id}): ${reason}`);
  },
});
