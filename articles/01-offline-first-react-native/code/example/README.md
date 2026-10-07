# Example: an Expo app using checked-luggage

A one-screen order form. Orders are saved to the queue instantly and sync when the network allows.

## Run it

```bash
# 1. Start the demo API (from the repo root)
npm run server

# 2. Create an Expo app and copy these files into it
npx create-expo-app@latest orders-demo --template blank-typescript
cp -r example/App.tsx example/src orders-demo/

# 3. Install the native pieces and the queue
cd orders-demo
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo expo-crypto
npm install ../   # or the published package, once you publish it

# 4. Point the app at your machine (a phone can't reach "localhost" on your laptop)
EXPO_PUBLIC_API_URL=http://192.168.1.20:8787 npx expo start
```

## Break it on purpose

- **Lost responses:** restart the API with `DROP_RESPONSE_RATE=0.5 npm run server`. Every order still appears exactly once in `GET /orders`.
- **No tags:** add `IGNORE_KEYS=1` as well, and watch the duplicates appear.
- **Dead zone:** on iOS, turn on *Settings → Developer → Network Link Conditioner* with 100% loss. NetInfo still says "connected"; the probe disagrees, orders queue up, and the badge shows them waiting.
