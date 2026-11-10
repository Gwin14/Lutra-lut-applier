/**
 * Free plan export allowance: a generous monthly count of exported videos.
 *
 * Kept apart from the export records so deleting an export never gives the
 * allowance back, and counted only when a render finishes so failed or
 * cancelled renders cost nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useProStore } from './pro';

/** Videos a free user can export each calendar month. */
export const FREE_MONTHLY_EXPORTS = 15;
/** From this many left, the export sheet starts warning ahead of the limit. */
export const QUOTA_WARN_AT = 5;

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

type QuotaStore = {
  month: string;
  used: number;
  countExport: () => void;
};

export const useQuota = create<QuotaStore>()(
  persist(
    (set) => ({
      month: monthKey(),
      used: 0,
      countExport: () =>
        set((s) => {
          const month = monthKey();
          return { month, used: (s.month === month ? s.used : 0) + 1 };
        }),
    }),
    {
      name: 'lutra.quota',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => ({ month: s.month, used: s.used }),
    },
  ),
);

/** First day of next month: when the allowance starts over. */
export function quotaResetsAt(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

const remainingFrom = (month: string, used: number) => Math.max(0, FREE_MONTHLY_EXPORTS - (month === monthKey() ? used : 0));

/** Exports left this month; null when the user has Pro (no limit). */
export function useExportsLeft(): number | null {
  const isPro = useProStore((s) => s.isPro);
  const left = useQuota((s) => remainingFrom(s.month, s.used));
  return isPro ? null : left;
}

export function exportsLeft(): number | null {
  if (useProStore.getState().isPro) return null;
  const { month, used } = useQuota.getState();
  return remainingFrom(month, used);
}
