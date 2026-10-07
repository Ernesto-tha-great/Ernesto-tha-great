import NetInfo from '@react-native-community/netinfo';
import type { NewRequest } from 'checked-luggage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { queue } from './queue';

export function useOfflineQueue() {
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setPending((await queue.pending()).length);
  }, []);

  const flushAndReschedule = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await queue.flush();
    await refresh();

    const wakeAt = queue.nextWakeAt();
    if (wakeAt !== null) {
      // A timer is only a nudge. If iOS suspends the app, it fires late or not at
      // all. The persisted nextAttemptAt keeps the schedule honest either way.
      timer.current = setTimeout(flushAndReschedule, Math.max(0, wakeAt - Date.now()));
    }
  }, [refresh]);

  useEffect(() => {
    void flushAndReschedule();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushAndReschedule();
    });

    // NetInfo is a hint that *something* changed, not proof that requests will work.
    // The queue's probe decides that.
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flushAndReschedule();
    });

    return () => {
      appState.remove();
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flushAndReschedule]);

  const submit = useCallback(
    async (request: NewRequest) => {
      await queue.enqueue(request); // on disk before we say "Saved"
      await refresh();
      void flushAndReschedule(); // the UI never waits for the network
    },
    [refresh, flushAndReschedule],
  );

  return { pending, submit };
}
