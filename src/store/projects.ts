import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { DEFAULT_GRADE, type Adjustments, type Effects, type Grade } from '../color/grade';
import type { ProfileId } from '../color/profiles';
import type { AspectId } from '../engine/protocol';
import { uid } from '../lib/id';

export type Clip = {
  id: string;
  uri: string;
  name: string;
  duration: number; // seconds
  width: number;
  height: number;
  size: number;
  thumb: string | null;
  input: ProfileId;
  detection: { isLog: boolean; confidence: number } | null;
  trim: { start: number; end: number };
  /** Own grade, used only when the project is unlinked. */
  grade: Grade | null;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  clips: Clip[];
  grade: Grade;
  linked: boolean;
  aspect: AspectId;
};

type History = { past: Grade[]; future: Grade[] };

type ProjectStore = {
  projects: Project[];
  history: Record<string, History>; // keyed by `${projectId}:${clipId|'*'}`, not persisted
  create: (clips: Clip[], name?: string) => Project;
  remove: (id: string) => void;
  duplicate: (id: string) => Project | null;
  rename: (id: string, name: string) => void;
  addClips: (id: string, clips: Clip[]) => void;
  removeClip: (id: string, clipId: string) => void;
  moveClip: (id: string, clipId: string, dir: -1 | 1) => void;
  updateClip: (id: string, clipId: string, patch: Partial<Clip>) => void;
  setInputAll: (id: string, input: ProfileId) => void;
  setLinked: (id: string, linked: boolean, fromClipId?: string) => void;
  setAspect: (id: string, aspect: AspectId) => void;
  /** Live edit (no history). */
  editGrade: (id: string, clipId: string, patch: Partial<Grade>) => void;
  editAdjust: (id: string, clipId: string, patch: Partial<Adjustments>) => void;
  editEffects: (id: string, clipId: string, patch: Partial<Effects>) => void;
  /** Snapshot before a discrete change or at the start of a drag. */
  checkpoint: (id: string, clipId: string) => void;
  undo: (id: string, clipId: string) => void;
  redo: (id: string, clipId: string) => void;
  applyGradeToAll: (id: string, grade: Grade) => void;
};

export function effectiveGrade(p: Project, clip: Clip | undefined): Grade {
  if (!clip || p.linked) return p.grade;
  return clip.grade ?? p.grade;
}

const historyKey = (p: Project, clipId: string) => `${p.id}:${p.linked ? '*' : clipId}`;

function writeGrade(p: Project, clipId: string, next: Grade): Project {
  if (p.linked) return { ...p, grade: next, updatedAt: Date.now() };
  return {
    ...p,
    updatedAt: Date.now(),
    clips: p.clips.map((c) => (c.id === clipId ? { ...c, grade: next } : c)),
  };
}

export const useProjects = create<ProjectStore>()(
  persist(
    (set, get) => {
      const mutate = (id: string, fn: (p: Project) => Project) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? fn(p) : p)) }));
      const find = (id: string) => get().projects.find((p) => p.id === id);

      return {
        projects: [],
        history: {},
        create: (clips, name) => {
          const now = Date.now();
          const d = new Date(now);
          const project: Project = {
            id: uid(),
            name: name ?? `Lote ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
            createdAt: now,
            updatedAt: now,
            clips,
            grade: DEFAULT_GRADE,
            linked: true,
            aspect: 'original',
          };
          set((s) => ({ projects: [project, ...s.projects] }));
          return project;
        },
        remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
        duplicate: (id) => {
          const p = find(id);
          if (!p) return null;
          const now = Date.now();
          const copy: Project = { ...p, id: uid(), name: `${p.name} (cópia)`, createdAt: now, updatedAt: now, clips: p.clips.map((c) => ({ ...c, id: uid() })) };
          set((s) => ({ projects: [copy, ...s.projects] }));
          return copy;
        },
        rename: (id, name) => mutate(id, (p) => ({ ...p, name: name.trim() || p.name, updatedAt: Date.now() })),
        addClips: (id, clips) => mutate(id, (p) => ({ ...p, clips: [...p.clips, ...clips], updatedAt: Date.now() })),
        removeClip: (id, clipId) => mutate(id, (p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clipId), updatedAt: Date.now() })),
        moveClip: (id, clipId, dir) =>
          mutate(id, (p) => {
            const i = p.clips.findIndex((c) => c.id === clipId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= p.clips.length) return p;
            const clips = [...p.clips];
            [clips[i], clips[j]] = [clips[j], clips[i]];
            return { ...p, clips, updatedAt: Date.now() };
          }),
        updateClip: (id, clipId, patch) =>
          mutate(id, (p) => ({ ...p, updatedAt: Date.now(), clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) })),
        setInputAll: (id, input) => mutate(id, (p) => ({ ...p, updatedAt: Date.now(), clips: p.clips.map((c) => ({ ...c, input })) })),
        setLinked: (id, linked, fromClipId) =>
          mutate(id, (p) => {
            if (linked) {
              const source = p.clips.find((c) => c.id === fromClipId);
              return { ...p, linked: true, grade: source?.grade ?? p.grade, updatedAt: Date.now() };
            }
            return { ...p, linked: false, updatedAt: Date.now(), clips: p.clips.map((c) => ({ ...c, grade: c.grade ?? p.grade })) };
          }),
        setAspect: (id, aspect) => mutate(id, (p) => ({ ...p, aspect, updatedAt: Date.now() })),
        editGrade: (id, clipId, patch) =>
          mutate(id, (p) => writeGrade(p, clipId, { ...effectiveGrade(p, p.clips.find((c) => c.id === clipId)), ...patch })),
        editAdjust: (id, clipId, patch) =>
          mutate(id, (p) => {
            const g = effectiveGrade(p, p.clips.find((c) => c.id === clipId));
            return writeGrade(p, clipId, { ...g, adjust: { ...g.adjust, ...patch } });
          }),
        editEffects: (id, clipId, patch) =>
          mutate(id, (p) => {
            const g = effectiveGrade(p, p.clips.find((c) => c.id === clipId));
            return writeGrade(p, clipId, { ...g, effects: { ...g.effects, ...patch } });
          }),
        checkpoint: (id, clipId) => {
          const p = find(id);
          if (!p) return;
          const key = historyKey(p, clipId);
          const current = effectiveGrade(p, p.clips.find((c) => c.id === clipId));
          set((s) => {
            const h = s.history[key] ?? { past: [], future: [] };
            if (h.past[h.past.length - 1] === current) return s;
            return { history: { ...s.history, [key]: { past: [...h.past.slice(-49), current], future: [] } } };
          });
        },
        undo: (id, clipId) => {
          const p = find(id);
          if (!p) return;
          const key = historyKey(p, clipId);
          const h = get().history[key];
          if (!h?.past.length) return;
          const prev = h.past[h.past.length - 1];
          const current = effectiveGrade(p, p.clips.find((c) => c.id === clipId));
          set((s) => ({
            history: { ...s.history, [key]: { past: h.past.slice(0, -1), future: [current, ...h.future] } },
            projects: s.projects.map((x) => (x.id === id ? writeGrade(x, clipId, prev) : x)),
          }));
        },
        redo: (id, clipId) => {
          const p = find(id);
          if (!p) return;
          const key = historyKey(p, clipId);
          const h = get().history[key];
          if (!h?.future.length) return;
          const next = h.future[0];
          const current = effectiveGrade(p, p.clips.find((c) => c.id === clipId));
          set((s) => ({
            history: { ...s.history, [key]: { past: [...h.past, current], future: h.future.slice(1) } },
            projects: s.projects.map((x) => (x.id === id ? writeGrade(x, clipId, next) : x)),
          }));
        },
        applyGradeToAll: (id, grade) =>
          mutate(id, (p) => ({ ...p, grade, updatedAt: Date.now(), clips: p.clips.map((c) => ({ ...c, grade: p.linked ? c.grade : grade })) })),
      };
    },
    {
      name: 'lutra.projects',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ projects: s.projects }),
    },
  ),
);

export function useHistoryState(projectId: string, clipId: string | undefined) {
  return useProjects(
    useShallow((s) => {
      const p = s.projects.find((x) => x.id === projectId);
      if (!p || !clipId) return { canUndo: false, canRedo: false };
      const h = s.history[historyKey(p, clipId)];
      return { canUndo: !!h?.past.length, canRedo: !!h?.future.length };
    }),
  );
}
