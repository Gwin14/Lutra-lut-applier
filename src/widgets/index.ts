/**
 * Guarded facade over the widget extension.
 *
 * Expo Go does not ship the ExpoWidgets native module, so everything here is a
 * silent no-op there: the definitions module (which touches expo-widgets and
 * @expo/ui) is only required after the native module has been found.
 */
import { requireOptionalNativeModule } from 'expo';

import { BUILT_IN_LOOKS, compileBuiltInLook, lookSwatches } from '../color/looks';
import { tr } from '../i18n';
import { categoryLabel, lookText } from '../i18n/content';
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

/** Render widget state as the app knows it; the localized `text` is added here. */
export type RenderWidgetState = Omit<RenderWidgetProps, 'text'>;

let lastRender: RenderWidgetState | null = null;

function renderText(p: RenderWidgetState): RenderWidgetProps['text'] {
  const t = tr().widgets;
  return {
    inline: p.exportedToday > 0 ? t.exportedTodayInline(p.exportedToday) : t.newBatchInline,
    heading: p.state === 'rendering' ? t.exporting : p.state === 'done' ? t.exported : 'Lutra',
    caption: t.exportedToday(p.exportedToday),
  };
}

export function updateRenderWidget(state: RenderWidgetState) {
  lastRender = state;
  const d = load();
  if (!d) return;
  try {
    d.renderStatusWidget.updateSnapshot({ ...state, text: renderText(state) });
  } catch {}
}

/** Re-sends every widget's strings after a language change. */
export function refreshWidgetsLanguage() {
  if (!load()) return;
  updateRenderWidget(
    lastRender && lastRender.state !== 'rendering'
      ? lastRender
      : lastRender ?? { state: 'idle', progress: 0, title: '', detail: tr().widgets.tapToCreate, finished: 0, total: 0, exportedToday: 0 },
  );
  refreshLookWidget();
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
      const text = lookText(look);
      const props: LookWidgetProps = {
        lookId: look.id,
        name: text.name,
        category: categoryLabel(look.category),
        swatches: lookSwatches(compileBuiltInLook(look.id)),
        description: text.description,
        heading: tr().widgets.lookOfDay,
      };
      return { date: i === 0 ? new Date() : date, props };
    });
    d.lookOfDayWidget.updateTimeline(entries);
  } catch {}
}

type Activity = {
  update(p: RenderActivityProps): Promise<void>;
  end(policy?: 'default' | 'immediate' | { after: Date }, p?: RenderActivityProps): Promise<void>;
};
let activity: Activity | null = null;

/** How long the final state stays on the Lock Screen / Dynamic Island after a finished export. */
const DONE_LINGER_MS = 8000;

/** Live Activity state; the localized subtitle is added here. */
export type RenderActivityState = Omit<RenderActivityProps, 'subtitle'>;

const withSubtitle = (p: RenderActivityState): RenderActivityProps => ({ ...p, subtitle: tr().widgets.readyOf(p.finished, p.total, p.eta) });

export function startRenderActivity(props: RenderActivityState) {
  const d = load();
  if (!d) return;
  // One export at a time: never leave a previous activity behind.
  if (activity) endRenderActivity(undefined, true);
  try {
    activity = d.renderActivity.start(withSubtitle(props), 'lutra:///exports') as unknown as Activity;
  } catch {
    activity = null;
  }
}

export function updateRenderActivity(props: RenderActivityState) {
  activity?.update(withSubtitle(props)).catch(() => {});
}

/**
 * Ends the current activity. A finished export shows its final state for a few
 * seconds and then leaves on its own; a canceled one leaves right away.
 */
export function endRenderActivity(props?: RenderActivityState, immediate = false) {
  const policy = immediate ? 'immediate' : { after: new Date(Date.now() + DONE_LINGER_MS) };
  activity?.end(policy, props ? withSubtitle(props) : undefined).catch(() => {});
  activity = null;
}

/** Ends activities left over by a previous run of the app (killed mid-export, crash, reload). */
export function endStaleRenderActivities() {
  const d = load();
  if (!d) return;
  try {
    for (const a of d.renderActivity.getInstances()) a.end('immediate').catch(() => {});
  } catch {}
  activity = null;
}

export type { RenderWidgetProps, RenderActivityProps };
