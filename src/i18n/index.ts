/**
 * Tiny typed i18n. Dictionaries are plain objects (strings and formatter
 * functions), so every key and parameter is checked by TypeScript.
 *
 *   const t = useT();          // in components: re-renders on language change
 *   t.studio.newBatch.title
 *   t.common.clips(3)          // "3 clipes" / "3 clips"
 *
 *   tr().format.now            // outside React (stores, engine, widgets)
 */
import { getLocales, useLocales } from 'expo-localization';

import { useSettings } from '../store/settings';
import { en } from './en';
import { pt, type Dict } from './pt';

export type Lang = 'pt' | 'en';
export type LangPref = 'system' | Lang;
export type { Dict };

export const LANGS: Lang[] = ['pt', 'en'];
const DICTS: Record<Lang, Dict> = { pt, en };

/** Native name of each language, shown in its own language in the picker. */
export const LANG_NAMES: Record<Lang, string> = { pt: 'Português', en: 'English' };

function systemLocale() {
  try {
    return getLocales()[0];
  } catch {
    return undefined;
  }
}

export function systemLang(): Lang {
  const code = systemLocale()?.languageCode?.toLowerCase();
  return code === 'pt' ? 'pt' : 'en';
}

export function resolveLang(pref: LangPref | undefined): Lang {
  return pref && pref !== 'system' ? pref : systemLang();
}

export function currentLang(): Lang {
  return resolveLang(useSettings.getState().language);
}

/** BCP-47 tag for Intl / toLocale* calls, keeping the user's region when it matches. */
export function intlTag(lang: Lang = currentLang()): string {
  const sys = systemLocale();
  if (sys?.languageCode?.toLowerCase() === lang && sys.languageTag) return sys.languageTag;
  return lang === 'pt' ? 'pt-BR' : 'en-US';
}

/** Current dictionary, for code outside React components. */
export function tr(): Dict {
  return DICTS[currentLang()];
}

/** Current language; subscribes to the setting and to OS locale changes. */
export function useLang(): Lang {
  const pref = useSettings((s) => s.language);
  useLocales();
  return resolveLang(pref);
}

/** Current dictionary; components using it re-render when the language changes. */
export function useT(): Dict {
  return DICTS[useLang()];
}

/** Locale-aware decimal formatting (comma in pt, dot in en). */
export function formatNumber(v: number, maxDigits = 1, minDigits = 0) {
  return new Intl.NumberFormat(intlTag(), { maximumFractionDigits: maxDigits, minimumFractionDigits: minDigits }).format(v);
}
