import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ProfileId } from '../color/profiles';
import type { AspectId, ContainerId, QualityId, ResolutionId, VideoCodecId } from '../engine/protocol';

export type ExportPreset = {
  mode: 'separate' | 'merge';
  container: ContainerId;
  codec: VideoCodecId;
  resolution: ResolutionId;
  fps: number | 'source';
  quality: QualityId;
  audio: boolean;
  transition: 'cut' | 'fade';
  fadeEnds: boolean;
  lutPrecision: 33 | 65;
};

export const DEFAULT_EXPORT: ExportPreset = {
  mode: 'separate',
  container: 'mp4',
  codec: 'avc',
  resolution: 'source',
  fps: 'source',
  quality: 'high',
  audio: true,
  transition: 'cut',
  fadeEnds: false,
  lutPrecision: 65,
};

export type Settings = {
  /** UI language; 'system' follows the device (and iOS per-app language). */
  language: 'system' | 'pt' | 'en';
  theme: 'system' | 'light' | 'dark';
  haptics: boolean;
  autoDetectLog: boolean;
  preferredLog: ProfileId;
  previewQuality: 'fast' | 'balanced' | 'max';
  saveToPhotos: boolean;
  albumName: string;
  exportPreset: ExportPreset;
  defaultAspect: AspectId;
  /** Editor: 'large' trades preview size for a bigger controls area. */
  editorPanel: 'normal' | 'large';
  /** Finished (or skipped) the first-run introduction. */
  onboarded: boolean;
};

type SettingsStore = Settings & {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setExportPreset: (patch: Partial<ExportPreset>) => void;
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      language: 'system',
      theme: 'system',
      haptics: true,
      autoDetectLog: true,
      preferredLog: process.env.EXPO_OS === 'ios' ? 'applelog' : 'slog3',
      previewQuality: 'balanced',
      saveToPhotos: true,
      albumName: 'Lutra',
      exportPreset: DEFAULT_EXPORT,
      defaultAspect: 'original',
      editorPanel: 'normal',
      onboarded: false,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      setExportPreset: (patch) => set((s) => ({ exportPreset: { ...s.exportPreset, ...patch } })),
    }),
    {
      name: 'lutra.settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // Installs from before the introduction existed skip it.
      migrate: (state, version) => (version < 2 ? { ...(state as Settings), onboarded: true } : (state as Settings)),
      partialize: ({ set: _s, setExportPreset: _e, ...rest }) => rest,
    },
  ),
);

export const previewLutSize = (q: Settings['previewQuality']) => (q === 'fast' ? 17 : q === 'balanced' ? 25 : 33);

/** True once the persisted settings have been read from storage. */
export function useSettingsHydrated() {
  return useSyncExternalStore(
    (cb) => useSettings.persist.onFinishHydration(cb),
    () => useSettings.persist.hasHydrated(),
  );
}
