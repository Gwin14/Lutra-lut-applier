import * as Haptics from 'expo-haptics';

import { useSettings } from '../store/settings';

const enabled = () => useSettings.getState().haptics && process.env.EXPO_OS !== 'web';

/** Haptics are punctuation: one per user action, on the same frame as the visual. */
export const haptic = {
  selection() {
    if (enabled()) Haptics.selectionAsync().catch(() => {});
  },
  light() {
    if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium() {
    if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  success() {
    if (enabled()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning() {
    if (enabled()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  error() {
    if (enabled()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
