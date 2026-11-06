import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { parseCube, CubeParseError } from '../color/cube';
import type { LookFn } from '../color/grade';
import { lookSwatches } from '../color/looks';
import { lutAsLook, resampleLut, type Lut3D } from '../color/lut';
import { tr } from '../i18n';
import { useLibrary, type UserLut } from '../store/library';
import { dirs } from './files';

const cache = new Map<string, Lut3D>();

/** Synchronous resolver used by the bake; LUTs are loaded ahead of time. */
export function userLookResolver(lookId: string): LookFn | null {
  const lut = cache.get(lookId);
  return lut ? lutAsLook(lut) : null;
}

export function isUserLutLoaded(id: string) {
  return cache.has(id);
}

export async function loadUserLut(entry: UserLut) {
  if (cache.has(entry.id)) return cache.get(entry.id)!;
  const text = await new File(entry.fileUri).text();
  const parsed = parseCube(text);
  // Big LUTs (65³+) are resampled for the preview bake; quality impact is negligible
  // because the grade is re-baked into its own lattice anyway.
  const lut = parsed.lut.size > 65 ? resampleLut(parsed.lut, 65) : parsed.lut;
  cache.set(entry.id, lut);
  return lut;
}

export async function loadAllUserLuts() {
  const { userLuts } = useLibrary.getState();
  await Promise.all(userLuts.map((l) => loadUserLut(l).catch(() => null)));
}

export type ImportResult = { imported: UserLut[]; errors: string[] };

export async function importCubeFiles(): Promise<ImportResult> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return { imported: [], errors: [] };
  const imported: UserLut[] = [];
  const errors: string[] = [];
  for (const asset of res.assets) {
    const name = asset.name.replace(/\.(cube|CUBE)$/, '');
    if (!/\.cube$/i.test(asset.name)) {
      errors.push(tr().luts.onlyCube(asset.name));
      continue;
    }
    try {
      const text = await new File(asset.uri).text();
      const parsed = parseCube(text);
      const dest = new File(dirs.luts(), `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.cube`);
      dest.create({ overwrite: true });
      dest.write(text);
      const entry = useLibrary.getState().addUserLut({
        name: parsed.title || name,
        fileUri: dest.uri,
        size: parsed.lut.size,
        sourceSize: parsed.sourceSize,
        kind: parsed.kind,
        swatches: lookSwatches(lutAsLook(parsed.lut)),
      });
      cache.set(entry.id, parsed.lut.size > 65 ? resampleLut(parsed.lut, 65) : parsed.lut);
      imported.push(entry);
    } catch (e) {
      errors.push(e instanceof CubeParseError ? tr().luts.withReason(asset.name, cubeErrorText(e)) : tr().luts.unreadable(asset.name));
    }
  }
  return { imported, errors };
}

function cubeErrorText(e: CubeParseError) {
  const m = tr().luts.cube;
  return e.code === 'tooFewPoints' ? m.tooFewPoints(e.size ?? 0) : m[e.code];
}

export function deleteUserLut(entry: UserLut) {
  try {
    const f = new File(entry.fileUri);
    if (f.exists) f.delete();
  } catch {}
  cache.delete(entry.id);
  useLibrary.getState().removeUserLut(entry.id);
}
