import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useOfflineQueue } from './src/useOfflineQueue';

export default function App() {
  const { pending, submit } = useOfflineQueue();
  const [sku, setSku] = useState('SKU-1');
  const [qty, setQty] = useState('1');
  const [message, setMessage] = useState<string | null>(null);

  const onSave = async () => {
    await submit({ method: 'POST', path: '/orders', body: { sku, qty: Number(qty) } });
    // Safe to say, because enqueue() only resolves once the order is on disk.
    setMessage('Saved. It will sync when the network lets it.');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>New order</Text>

      <Text style={styles.label}>SKU</Text>
      <TextInput style={styles.input} value={sku} onChangeText={setSku} autoCapitalize="characters" />

      <Text style={styles.label}>Quantity</Text>
      <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="number-pad" />

      <Pressable style={styles.button} onPress={onSave}>
        <Text style={styles.buttonText}>Save order</Text>
      </Pressable>

      {message && <Text style={styles.message}>{message}</Text>}

      <View style={[styles.badge, pending > 0 ? styles.badgeWaiting : styles.badgeClear]}>
        <Text style={styles.badgeText}>
          {pending === 0 ? 'Everything synced' : `${pending} waiting to send`}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 8, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 14, color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  button: { marginTop: 16, backgroundColor: '#1d4ed8', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  message: { marginTop: 8, color: '#166534' },
  badge: { marginTop: 'auto', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'center' },
  badgeWaiting: { backgroundColor: '#fef3c7' },
  badgeClear: { backgroundColor: '#dcfce7' },
  badgeText: { fontSize: 14, fontWeight: '600' },
});
