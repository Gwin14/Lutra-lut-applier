import { ActionSheetIOS, Alert } from 'react-native';

import { tr } from '../i18n';

export type Action = { label: string; onPress: () => void; destructive?: boolean };

/**
 * Item actions: the native action sheet on iOS; on Android a native dialog
 * (Android has no action sheet primitive; dialogs show up to three buttons, so
 * longer lists are paged).
 */
export function showActions(title: string, actions: Action[], message?: string) {
  if (process.env.EXPO_OS === 'ios') {
    const options = [...actions.map((a) => a.label), tr().common.cancel];
    const destructiveButtonIndex = actions.map((a, i) => (a.destructive ? i : -1)).filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions(
      { title, message, options, cancelButtonIndex: options.length - 1, destructiveButtonIndex },
      (i) => {
        if (i < actions.length) actions[i].onPress();
      },
    );
    return;
  }
  const page = (start: number) => {
    const slice = actions.slice(start, start + 2);
    const rest = actions.length > start + 2;
    Alert.alert(title, message, [
      ...slice.map((a) => ({ text: a.label, style: a.destructive ? ('destructive' as const) : ('default' as const), onPress: a.onPress })),
      rest ? { text: tr().common.more, onPress: () => page(start + 2) } : { text: tr().common.cancel, style: 'cancel' as const },
    ]);
  };
  page(0);
}

/** Destructive confirm: always a separate step. */
export function confirmDestructive(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: tr().common.cancel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
