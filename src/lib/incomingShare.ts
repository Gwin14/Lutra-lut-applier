import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createVideoPlayer } from 'expo-video';

import { uid } from './id';
import type { VideoInput } from './media';

/**
 * Receiving shares needs the share extension / intent filters baked into a
 * native build. Expo Go and web don't have them, so we never touch the
 * experimental native calls there.
 */
export const canReceiveShares = process.env.EXPO_OS !== 'web' && Constants.executionEnvironment !== 'storeClient';

/** Host used by expo-sharing when the OS opens the app with shared content. */
export const SHARE_HOST = 'expo-sharing';

function isVideo(p: Sharing.ResolvedSharePayload) {
  return p.contentType === 'video' || (p.contentMimeType ?? '').startsWith('video/');
}

/** Copies the shared file into the app cache: the share container is temporary. */
function adopt(uri: string, name: string | null) {
  try {
    const dir = new Directory(Paths.cache, 'shared');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const ext = (name ?? uri).match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.mov';
    const dest = new File(dir, `${uid()}${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** Reads duration and size by loading the file into a throwaway player. */
function probe(uri: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const player = createVideoPlayer(uri);
    let settled = false;
    const finish = (v: { duration: number; width: number; height: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      player.release();
      resolve(v);
    };
    const sub = player.addListener('sourceLoad', (e) => {
      const size = e.availableVideoTracks[0]?.size;
      finish({ duration: e.duration, width: size?.width ?? 0, height: size?.height ?? 0 });
    });
    const timer = setTimeout(() => finish({ duration: player.duration || 0, width: 0, height: 0 }), 8000);
  });
}

/** Videos shared with the app (share sheet / share intent), ready for `clipFromAsset`. */
export async function takeSharedVideos(): Promise<VideoInput[]> {
  if (!canReceiveShares) return [];
  let payloads: Sharing.ResolvedSharePayload[] = [];
  try {
    payloads = await Sharing.getResolvedSharedPayloadsAsync();
  } catch {}
  // Copy first, then consume: clearing may drop the files in the share container,
  // and a later resume must not import the same videos again.
  const adopted = payloads.filter(isVideo).flatMap((p) => (p.contentUri ? [{ p, uri: adopt(p.contentUri, p.originalName) }] : []));
  try {
    Sharing.clearSharedPayloads();
  } catch {}
  const out: VideoInput[] = [];
  for (const { p, uri } of adopted) {
    const meta = await probe(uri);
    out.push({
      uri,
      fileName: p.originalName,
      duration: meta.duration * 1000,
      width: meta.width,
      height: meta.height,
      fileSize: p.contentSize ?? undefined,
    });
  }
  return out;
}
