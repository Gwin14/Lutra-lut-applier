import { SHARE_HOST } from '../lib/incomingShare';

/**
 * The share extension / share intent opens the app with an `expo-sharing`
 * host. Send it to the studio, which imports the videos like the widget
 * shortcut does. Every other link passes through untouched (Expo Go included).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (new URL(path, 'lutra://').hostname === SHARE_HOST) return `/?action=shared&t=${Date.now()}`;
  } catch {}
  return path;
}
