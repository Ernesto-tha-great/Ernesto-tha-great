import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { queue } from './offline';

export function useOfflineQueue() {
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await queue.flush();
    setPending(await queue.pending());

    // Come back when the next item is due. If iOS suspends the app, this timer
    // fires late or never, and that's fine: the schedule is saved with the items.
    const wakeAt = queue.nextWakeAt();
    if (wakeAt !== null) timer.current = setTimeout(flush, Math.max(0, wakeAt - Date.now()));
  }, []);

  useEffect(() => {
    void flush();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    // NetInfo only says *something* changed. The probe decides if it's worth sending.
    const stopNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flush();
    });
    return () => {
      appState.remove();
      stopNetInfo();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  const save = useCallback(
    async (path: string, body: unknown) => {
      await queue.enqueue(path, body); // on disk: safe to say "Saved"
      setPending(await queue.pending());
      void flush(); // the UI never waits for the network
    },
    [flush],
  );

  return { pending, save };
}
