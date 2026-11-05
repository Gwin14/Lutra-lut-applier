/**
 * Entry point. On web, React Native Skia needs CanvasKit (WASM) loaded before
 * any route module touches Skia, so routes are required after it resolves.
 * Native platforms go straight to Expo Router.
 */
if (process.env.EXPO_OS === 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-router/entry');
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-router/entry');
}
