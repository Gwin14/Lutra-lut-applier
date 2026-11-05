import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Grade } from '../color/grade';
import type { ProfileId } from '../color/profiles';
import { uid } from '../lib/id';

export type UserLut = {
  id: string; // `user:<uid>`
  name: string;
  fileUri: string;
  size: number;
  sourceSize: number;
  kind: '3d' | '1d';
  createdAt: number;
  swatches: string[];
};

export type Recipe = {
  id: string;
  name: string;
  grade: Grade;
  input: ProfileId | null;
  createdAt: number;
};

type LibraryStore = {
  userLuts: UserLut[];
  favorites: string[];
  recipes: Recipe[];
  recentLooks: string[];
  addUserLut: (lut: Omit<UserLut, 'id' | 'createdAt'>) => UserLut;
  removeUserLut: (id: string) => void;
  renameUserLut: (id: string, name: string) => void;
  toggleFavorite: (lookId: string) => void;
  pushRecent: (lookId: string) => void;
  addRecipe: (name: string, grade: Grade, input: ProfileId | null) => Recipe;
  removeRecipe: (id: string) => void;
};

export const useLibrary = create<LibraryStore>()(
  persist(
    (set) => ({
      userLuts: [],
      favorites: [],
      recipes: [],
      recentLooks: [],
      addUserLut: (lut) => {
        const entry: UserLut = { ...lut, id: `user:${uid()}`, createdAt: Date.now() };
        set((s) => ({ userLuts: [entry, ...s.userLuts] }));
        return entry;
      },
      removeUserLut: (id) =>
        set((s) => ({ userLuts: s.userLuts.filter((l) => l.id !== id), favorites: s.favorites.filter((f) => f !== id) })),
      renameUserLut: (id, name) => set((s) => ({ userLuts: s.userLuts.map((l) => (l.id === id ? { ...l, name } : l)) })),
      toggleFavorite: (lookId) =>
        set((s) => ({
          favorites: s.favorites.includes(lookId) ? s.favorites.filter((f) => f !== lookId) : [lookId, ...s.favorites],
        })),
      pushRecent: (lookId) => set((s) => ({ recentLooks: [lookId, ...s.recentLooks.filter((l) => l !== lookId)].slice(0, 8) })),
      addRecipe: (name, grade, input) => {
        const r: Recipe = { id: uid(), name, grade, input, createdAt: Date.now() };
        set((s) => ({ recipes: [r, ...s.recipes] }));
        return r;
      },
      removeRecipe: (id) => set((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) })),
    }),
    { name: 'lutra.library', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);
