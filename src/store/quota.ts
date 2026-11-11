/**
 * Free plan export allowance: up to a fixed number of videos per export batch.
 *
 * There is no running count: every export starts fresh, so the free plan never
 * "runs out". The limit applies to the clips selected for one export, whether
 * they come out as separate files or merged into one video.
 */
import { useProStore } from './pro';

/** Videos a free user can put in a single export batch. */
export const FREE_BATCH_LIMIT = 8;

/** Max videos per batch; null when the user has Pro (no limit). */
export function useBatchLimit(): number | null {
  const isPro = useProStore((s) => s.isPro);
  return isPro ? null : FREE_BATCH_LIMIT;
}

export function batchLimit(): number | null {
  return useProStore.getState().isPro ? null : FREE_BATCH_LIMIT;
}
