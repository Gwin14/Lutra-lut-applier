/**
 * Live availability of each clip's file (not persisted).
 *
 * Copied clips can vanish when the system purges caches; referenced clips go
 * missing while their drive is unplugged or the file is moved, and come back
 * on their own. Screens showing clips call `useFileWatcher`, which re-checks
 * on focus, when the app returns to the foreground and, while anything is
 * missing, every few seconds — so plugging the SSD back in just works.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { fileExists } from '../lib/files';
import { resolveRef } from '../lib/fileRefs';
import { useProjects, type Clip } from './projects';

export type FileStatus = 'ok' | 'missing';

type Store = { status: Record<string, FileStatus> };

export const useFileStatus = create<Store>(() => ({ status: {} }));

const RETRY_MS = 3000;

function setStatus(clipId: string, s: FileStatus) {
  if (useFileStatus.getState().status[clipId] === s) return;
  useFileStatus.setState((st) => ({ status: { ...st.status, [clipId]: s } }));
}

/** Checks one clip; for references this also re-opens access (iOS) and stores a moved/refreshed location. */
export async function checkClip(projectId: string, clip: Clip): Promise<boolean> {
  if (!clip.ref) {
    const ok = fileExists(clip.uri);
    setStatus(clip.id, ok ? 'ok' : 'missing');
    return ok;
  }
  const r = await resolveRef(clip.ref);
  if (r.available && r.uri) {
    if (r.uri !== clip.uri || (r.ref && r.ref !== clip.ref)) {
      useProjects.getState().relinkClip(projectId, clip.id, { uri: r.uri, ref: r.ref ?? clip.ref });
    }
    setStatus(clip.id, 'ok');
    return true;
  }
  setStatus(clip.id, 'missing');
  return false;
}

export async function checkProject(projectId: string) {
  const p = useProjects.getState().projects.find((x) => x.id === projectId);
  if (!p) return [];
  const results = await Promise.all(p.clips.map((c) => checkClip(projectId, c)));
  return p.clips.filter((_, i) => !results[i]);
}

async function checkMissing(projectId: string) {
  const p = useProjects.getState().projects.find((x) => x.id === projectId);
  if (!p) return;
  const { status } = useFileStatus.getState();
  await Promise.all(p.clips.filter((c) => status[c.id] === 'missing').map((c) => checkClip(projectId, c)));
}

export function useClipStatus(clipId: string | undefined): FileStatus | undefined {
  return useFileStatus((s) => (clipId ? s.status[clipId] : undefined));
}

export function useFileWatcher(projectId: string) {
  // Re-run when the set of files changes (added, removed, relinked).
  const signature = useProjects((s) => s.projects.find((p) => p.id === projectId)?.clips.map((c) => `${c.id}:${c.ref ?? c.uri}`).join('|') ?? '');
  const anyMissing = useFileStatus((s) => signature.split('|').some((entry) => s.status[entry.split(':')[0]] === 'missing'));

  useEffect(() => {
    checkProject(projectId);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') checkProject(projectId);
    });
    return () => sub.remove();
  }, [projectId, signature]);

  useEffect(() => {
    if (!anyMissing) return;
    const iv = setInterval(() => checkMissing(projectId), RETRY_MS);
    return () => clearInterval(iv);
  }, [projectId, anyMissing]);
}
