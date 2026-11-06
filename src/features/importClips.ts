import { router } from 'expo-router';
import { Alert } from 'react-native';
import { create } from 'zustand';

import { tr } from '../i18n';
import { canReference, makeLocal, pickFiles, releaseRef } from '../lib/fileRefs';
import { takeSharedVideos } from '../lib/incomingShare';
import { clipFromAsset, pickVideos, type VideoInput } from '../lib/media';
import { haptic } from '../lib/haptics';
import { checkClip } from '../store/fileStatus';
import { useProjects, type Clip } from '../store/projects';
import { useSettings } from '../store/settings';
import { showActions } from '../ui/actions';

type ImportState = { busy: boolean; done: number; total: number; error: string | null };

export const useImportState = create<ImportState>(() => ({ busy: false, done: 0, total: 0, error: null }));

/** Clips being copied into the app ("Copy to app" on a referenced clip). */
export const useCopyState = create<{ copying: Record<string, true> }>(() => ({ copying: {} }));

export type ImportSource = 'library' | 'files';

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

/** Files app / document provider: referenced in place unless the user chose to copy. */
async function pickFromFiles(): Promise<VideoInput[]> {
  const copy = !canReference || useSettings.getState().filesImport === 'copy';
  const files = await pickFiles(copy);
  return files.map((f) => ({ uri: f.uri, ref: f.ref, fileName: f.name, fileSize: f.size || undefined, duration: null, width: 0, height: 0 }));
}

const SOURCES: Record<ImportSource, () => Promise<VideoInput[]>> = { library: pickVideos, files: pickFromFiles };

/** Photos or Files? On web there's only one picker. */
export function chooseSource(run: (source: ImportSource) => void) {
  if (process.env.EXPO_OS === 'web') return run('library');
  const t = tr().importSource;
  showActions(t.title, [
    { label: t.library, onPress: () => run('library') },
    { label: t.files, onPress: () => run('files') },
  ], canReference && useSettings.getState().filesImport === 'reference' ? t.filesHint : undefined);
}

/** Picks videos, analyses them and opens the editor. */
export function startNewBatch(opts: { lookId?: string; source?: ImportSource } = {}) {
  if (!opts.source) return chooseSource((source) => startNewBatch({ ...opts, source }));
  return batchFrom(SOURCES[opts.source], opts);
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

export async function addClipsTo(projectId: string, source?: ImportSource): Promise<Clip[]> {
  if (!source) {
    return new Promise((resolve) => chooseSource((s) => resolve(addClipsTo(projectId, s))));
  }
  if (useImportState.getState().busy) return [];
  try {
    const assets = await SOURCES[source]();
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

function stillUsed(ref: string) {
  return useProjects.getState().projects.some((p) => p.clips.some((c) => c.ref === ref));
}

/** Points a clip at a file the user locates again (moved, renamed, other drive). */
export async function relocateClip(projectId: string, clip: Clip) {
  try {
    const [f] = await pickFiles(false, false);
    if (!f) return;
    const old = clip.ref;
    useProjects.getState().relinkClip(projectId, clip.id, { uri: f.uri, ref: f.ref, size: f.size || clip.size });
    if (old && old !== f.ref && !stillUsed(old)) releaseRef(old);
    const fresh = useProjects.getState().projects.find((p) => p.id === projectId)?.clips.find((c) => c.id === clip.id);
    if (fresh) await checkClip(projectId, fresh);
    haptic.success();
  } catch (e) {
    haptic.error();
    Alert.alert(tr().common.error, (e as Error)?.message ?? String(e));
  }
}

/** Copies a referenced clip into the app so it no longer depends on the drive. */
export async function copyClipIntoApp(projectId: string, clip: Clip) {
  if (!clip.ref || useCopyState.getState().copying[clip.id]) return;
  const t = tr().editor;
  if (!(await checkClip(projectId, clip))) {
    Alert.alert(t.refMissingTitle, t.refMissingMessage);
    return;
  }
  useCopyState.setState((s) => ({ copying: { ...s.copying, [clip.id]: true } }));
  try {
    const current = useProjects.getState().projects.find((p) => p.id === projectId)?.clips.find((c) => c.id === clip.id) ?? clip;
    const uri = await makeLocal(current.uri);
    useProjects.getState().relinkClip(projectId, clip.id, { uri, ref: null });
    if (!stillUsed(clip.ref)) releaseRef(clip.ref);
    await checkClip(projectId, { ...current, uri, ref: null });
    haptic.success();
  } catch (e) {
    haptic.error();
    Alert.alert(t.copyFailed, (e as Error)?.message ?? String(e));
  } finally {
    useCopyState.setState((s) => {
      const { [clip.id]: _, ...rest } = s.copying;
      return { copying: rest };
    });
  }
}
