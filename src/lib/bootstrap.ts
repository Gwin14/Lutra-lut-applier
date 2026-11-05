/**
 * Native entry: straight to Expo Router. The web variant (bootstrap.web.ts)
 * loads CanvasKit first; keeping it in a separate file stops Metro from
 * bundling the WASM loader (which imports Node's `fs`) on iOS/Android.
 */
import 'expo-router/entry';
