/**
 * Guarded facade over the widget extension.
 *
 * Expo Go does not ship the ExpoWidgets native module, so everything here is a
 * silent no-op there: the definitions module (which touches expo-widgets and
 * @expo/ui) is only required after the native module has been found.
 */
import { requireOptionalNativeModule } from 'expo';

import { BUILT_IN_LOOKS, LOOK_CATEGORIES, compileBuiltInLook, lookSwatches } from '../color/looks';
import type { LookWidgetProps, RenderActivityProps, RenderWidgetProps } from './definitions';

type Defs = typeof import('./definitions');

const nativeAvailable = process.env.EXPO_OS === 'ios' && requireOptionalNativeModule('ExpoWidgets') != null;

let defs: Defs | null | undefined;
function load(): Defs | null {
  if (!nativeAvailable) return null;
  if (defs === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      defs = require('./definitions') as Defs;
    } catch (e) {
      console.warn('[lutra] widgets unavailable', e);
      defs = null;
    }
  }
  return defs;
}

export const widgetsAvailable = nativeAvailable;

export function updateRenderWidget(props: RenderWidgetProps) {
  try {
    load()?.renderStatusWidget.updateSnapshot(props);
  } catch {}
}

/** Deterministic "look of the day" shared by the app and the widget. */
export function lookOfTheDay(date = new Date()) {
  const day = Math.floor(date.getTime() / 86400000);
  return BUILT_IN_LOOKS[day % BUILT_IN_LOOKS.length];
}

export function refreshLookWidget() {
  const d = load();
  if (!d) return;
  try {
    // Schedule a week of entries so the widget rotates without the app running.
    const entries = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setHours(0, 0, 5, 0);
      date.setDate(date.getDate() + i);
      const look = lookOfTheDay(date);
      const props: LookWidgetProps = {
        lookId: look.id,
        name: look.name,
        category: LOOK_CATEGORIES.find((c) => c.id === look.category)?.label ?? '',
        swatches: lookSwatches(compileBuiltInLook(look.id)),
        description: look.description,
      };
      return { date: i === 0 ? new Date() : date, props };
    });
    d.lookOfDayWidget.updateTimeline(entries);
  } catch {}
}

type Activity = { update(p: RenderActivityProps): Promise<void>; end(policy?: 'default' | 'immediate', p?: RenderActivityProps): Promise<void> };
let activity: Activity | null = null;

export function startRenderActivity(props: RenderActivityProps) {
  const d = load();
  if (!d) return;
  try {
    activity = d.renderActivity.start(props, 'lutra:///exports') as unknown as Activity;
  } catch {
    activity = null;
  }
}

export function updateRenderActivity(props: RenderActivityProps) {
  activity?.update(props).catch(() => {});
}

export function endRenderActivity(props?: RenderActivityProps) {
  activity?.end('default', props).catch(() => {});
  activity = null;
}

export type { RenderWidgetProps, RenderActivityProps };
