/**
 * Video files referenced in place (external SSD, iCloud Drive, SMB…) instead of
 * copied into the app, plus byte-level reads for the metadata probe.
 * Backed by the lutra-engine native module; without it (Expo Go, web) files
 * from Files are copied by expo-document-picker instead.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import LutraEngine from '../../modules/lutra-engine';
import type { ByteReader } from '../color/container';
import type { DecoderColor } from '../color/identify';

export const canReference = !!LutraEngine;

export type PickedFile = { uri: string; name: string; size: number; ref: string | null };

export async function pickFiles(copy: boolean, multiple = true): Promise<PickedFile[]> {
  if (LutraEngine) return JSON.parse(await LutraEngine.pickFiles(multiple, copy)) as PickedFile[];
  const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', multiple, copyToCacheDirectory: true });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? 0, ref: null }));
}

export type Resolved = { available: boolean; uri?: string; ref?: string };

export async function resolveRef(ref: string): Promise<Resolved> {
  if (!LutraEngine) return { available: false };
  try {
    return JSON.parse(await LutraEngine.resolveRef(ref)) as Resolved;
  } catch {
    return { available: false };
  }
}

export function releaseRef(ref: string) {
  try {
    LutraEngine?.releaseRef(ref);
  } catch {}
}

export async function makeLocal(uri: string): Promise<string> {
  if (!LutraEngine) throw new Error('Native module unavailable');
  return LutraEngine.makeLocal(uri);
}

export type MediaInfo = { duration: number; width: number; height: number; codec?: string } & { decoder: DecoderColor };

const TRANSFER: Record<string, DecoderColor['transfer']> = {
  // AVFoundation (kCMFormatDescriptionTransferFunction_*)
  AppleLog: 'applelog',
  ITU_R_2100_HLG: 'hlg',
  SMPTE_ST_2084_PQ: 'pq',
  ITU_R_709_2: '709',
  ITU_R_2020: '709',
  SMPTE_170M: '709',
  // Android (already normalised natively)
  applelog: 'applelog',
  hlg: 'hlg',
  pq: 'pq',
  '709': '709',
};
const PRIMARIES: Record<string, DecoderColor['primaries']> = {
  ITU_R_2020: '2020',
  ITU_R_709_2: '709',
  P3_D65: 'p3',
  DCI_P3: 'p3',
  '2020': '2020',
  '709': '709',
};

/** Size, duration and the OS decoder's colour description. Null when the OS can't open the file. */
export async function mediaInfo(uri: string): Promise<MediaInfo | null> {
  if (!LutraEngine) return null;
  try {
    const raw = JSON.parse(await LutraEngine.mediaInfo(uri)) as Record<string, unknown>;
    const transfer = typeof raw.transfer === 'string' ? (TRANSFER[raw.transfer] ?? 'other') : null;
    const primaries = typeof raw.primaries === 'string' ? (PRIMARIES[raw.primaries] ?? 'other') : null;
    return {
      duration: Number(raw.duration) || 0,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      codec: typeof raw.codec === 'string' ? raw.codec : undefined,
      decoder: { transfer, primaries, bitDepth: typeof raw.bitDepth === 'number' ? raw.bitDepth : null },
    };
  } catch {
    return null;
  }
}

/** Random-access reader for the container probe. */
export async function openReader(uri: string): Promise<ByteReader | null> {
  if (LutraEngine) {
    const size = await LutraEngine.fileSize(uri).catch(() => -1);
    if (size <= 0) return null;
    const native = LutraEngine;
    return { size, read: (offset, length) => native.readBytes(uri, offset, Math.min(length, size - offset)) };
  }
  if (process.env.EXPO_OS === 'web') return null;
  try {
    const f = new File(uri);
    if (!f.exists) return null;
    const size = f.size;
    return {
      size,
      read: async (offset, length) => {
        const h = f.open();
        try {
          h.offset = offset;
          return await h.readBytes(Math.min(length, size - offset));
        } finally {
          h.close();
        }
      },
    };
  } catch {
    return null;
  }
}

/** Size through the native module (reaches security-scoped files); -1 when unknown. */
export async function nativeFileSize(uri: string): Promise<number> {
  if (!LutraEngine) return -1;
  return LutraEngine.fileSize(uri).catch(() => -1);
}
