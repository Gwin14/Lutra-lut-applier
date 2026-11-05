/**
 * Web entry. React Native Skia needs CanvasKit (WASM) loaded before any route
 * module touches Skia, so routes are required after it resolves.
 */
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('expo-router/entry');
});
