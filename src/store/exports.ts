import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { ContainerId, EngineCaps, VideoCodecId } from '../engine/protocol';

export type ExportStatus = 'queued' | 'preparing' | 'rendering' | 'done' | 'failed' | 'canceled';

export type ExportRecord = {
  id: string;
  jobId: string;
  projectId: string;
  name: string;
  uri: string;
  container: ContainerId;
  codec: VideoCodecId | null;
  lookName: string | null;
  status: ExportStatus;
  progress: number; // 0..1
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  size: number;
  thumb: string | null;
  savedToPhotos: boolean;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
};

export type ActiveJob = {
  id: string;
  projectId: string;
  title: string;
  outputIds: string[];
  currentIndex: number;
  fps: number;
  preview: string | null;
  startedAt: number;
};

type ExportStore = {
  records: ExportRecord[];
  active: ActiveJob | null;
  caps: EngineCaps | null;
  engineReady: boolean;
  addRecords: (r: ExportRecord[]) => void;
  patchRecord: (id: string, patch: Partial<ExportRecord>) => void;
  removeRecord: (id: string) => void;
  setActive: (a: ActiveJob | null) => void;
  patchActive: (patch: Partial<ActiveJob>) => void;
  setCaps: (caps: EngineCaps) => void;
  setEngineReady: (ready: boolean) => void;
};

export const useExports = create<ExportStore>()(
  persist(
    (set) => ({
      records: [],
      active: null,
      caps: null,
      engineReady: false,
      addRecords: (r) => set((s) => ({ records: [...r, ...s.records] })),
      patchRecord: (id, patch) => set((s) => ({ records: s.records.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeRecord: (id) => set((s) => ({ records: s.records.filter((x) => x.id !== id) })),
      setActive: (active) => set({ active }),
      patchActive: (patch) => set((s) => (s.active ? { active: { ...s.active, ...patch } } : s)),
      setCaps: (caps) => set({ caps }),
      setEngineReady: (engineReady) => set({ engineReady }),
    }),
    {
      name: 'lutra.exports',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ records: s.records }),
      // A render cannot survive an app restart: mark interrupted ones on load.
      merge: (persisted, current) => {
        const p = persisted as Partial<ExportStore> | undefined;
        const records = (p?.records ?? []).map((r) =>
          r.status === 'done' || r.status === 'failed' || r.status === 'canceled'
            ? r
            : { ...r, status: 'failed' as const, error: 'Interrompido: o app foi fechado durante a exportação.' },
        );
        return { ...current, records };
      },
    },
  ),
);

/** Aggregate progress of the active job across its outputs. */
export function useActiveProgress() {
  return useExports(
    useShallow((s) => {
    const a = s.active;
    if (!a) return { progress: 0, finished: 0, count: 0, current: null as ExportRecord | null, active: false };
    const recs = s.records.filter((r) => a.outputIds.includes(r.id));
    const total = recs.reduce((n, r) => n + Math.max(r.frames, 1), 0);
    const done = recs.reduce((n, r) => n + Math.max(r.frames, 1) * (r.status === 'done' ? 1 : r.progress), 0);
    const finished = recs.filter((r) => r.status === 'done').length;
    return { progress: total ? done / total : 0, finished, count: recs.length, current: recs[a.currentIndex] ?? null, active: true };
    }),
  );
}
