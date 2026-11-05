import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useSettings } from '../store/settings';
import { dark, grade, light, type Palette } from './tokens';

const ScopeContext = createContext<{ palette: Palette; scheme: 'light' | 'dark' } | null>(null);

/** Forces a palette for a subtree (the editor's neutral grading surround). */
export function PaletteScope({ palette, scheme, children }: { palette: Palette; scheme: 'light' | 'dark'; children: ReactNode }) {
  return createElement(ScopeContext.Provider, { value: { palette, scheme } }, children);
}

export function useAppScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const pref = useSettings((s) => s.theme);
  if (pref !== 'system') return pref;
  return system === 'light' ? 'light' : 'dark';
}

export function useScheme(): 'light' | 'dark' {
  const scope = useContext(ScopeContext);
  const app = useAppScheme();
  return scope?.scheme ?? app;
}

export function usePalette(): Palette {
  const scope = useContext(ScopeContext);
  const app = useAppScheme();
  if (scope) return scope.palette;
  return app === 'dark' ? dark : light;
}

export const gradePalette = grade;
