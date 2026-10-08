import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { useOfflineQueue } from './lib/useOfflineQueue';

export default function App() {
  const { pending, save } = useOfflineQueue();
  const [sku, setSku] = useState('');
  const [message, setMessage] = useState('');

  async function onSave() {
    await save('/orders', { sku, qty: 1 });
    setSku('');
    setMessage('Saved'); // true the moment save() resolves: it's on disk
  }

  return (
    <View style={{ padding: 24, gap: 12 }}>
      <TextInput placeholder="SKU" value={sku} onChangeText={setSku} style={{ borderWidth: 1, padding: 8 }} />
      <Button title="Save order" onPress={onSave} disabled={!sku} />
      <Text>{message}</Text>
      {pending > 0 && <Text>{pending} waiting to sync</Text>}
    </View>
  );
}
