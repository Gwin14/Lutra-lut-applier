import { router } from 'expo-router';
import { create } from 'zustand';

import { tr } from '../i18n';
import { takeSharedVideos } from '../lib/incomingShare';
import { clipFromAsset, pickVideos, type VideoInput } from '../lib/media';
import { haptic } from '../lib/haptics';
import { useProjects, type Clip } from '../store/projects';
import { useSettings } from '../store/settings';

type ImportState = { busy: boolean; done: number; total: number; error: string | null };

export const useImportState = create<ImportState>(() => ({ busy: false, done: 0, total: 0, error: null }));

async function analyze(assets: VideoInput[]) {
  const { autoDetectLog, preferredLog } = useSettings.getState();
  useImportState.setState({ busy: true, done: 0, total: assets.length, error: null });
  const clips: Clip[] = [];
  for (const a of assets) {
    clips.push(await clipFromAsset(a, { autoDetect: autoDetectLog, preferredLog }));
    useImportState.setState((s) => ({ done: s.done + 1 }));
  }
  return clips;
}

/** Picks videos with the system picker, analyses them and opens the editor. */
export function startNewBatch(opts: { lookId?: string } = {}) {
  return batchFrom(pickVideos, opts);
}

/** Same flow, for videos sent to Lutra from another app's share sheet. */
export function startBatchFromShare() {
  return batchFrom(takeSharedVideos, { eager: true });
}

/** `eager` shows progress while the source loads (no system UI covers the app). */
async function batchFrom(source: () => Promise<VideoInput[]>, opts: { lookId?: string; eager?: boolean } = {}) {
  if (useImportState.getState().busy) return;
  if (opts.eager) useImportState.setState({ busy: true, done: 0, total: 0, error: null });
  try {
    const assets = await source();
    if (!assets.length) {
      useImportState.setState({ busy: false });
      return;
    }
    const clips = await analyze(assets);
    const project = useProjects.getState().create(clips);
    if (opts.lookId) useProjects.getState().editGrade(project.id, clips[0].id, { lookId: opts.lookId, lookStrength: 100 });
    haptic.success();
    useImportState.setState({ busy: false });
    router.push({ pathname: '/project/[id]', params: { id: project.id } });
  } catch (e) {
    haptic.error();
    useImportState.setState({ busy: false, error: (e as Error)?.message ?? tr().project.importError });
  }
}

export async function addClipsTo(projectId: string) {
  if (useImportState.getState().busy) return [];
  try {
    const assets = await pickVideos();
    if (!assets.length) return [];
    const clips = await analyze(assets);
    useProjects.getState().addClips(projectId, clips);
    useImportState.setState({ busy: false });
    haptic.success();
    return clips;
  } catch (e) {
    useImportState.setState({ busy: false, error: (e as Error)?.message ?? tr().project.importError });
    return [];
  }
}
