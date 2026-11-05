import { Directory, File, Paths } from 'expo-file-system';

function ensureDir(...parts: string[]) {
  const dir = new Directory(Paths.document, ...parts);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const dirs = {
  exports: () => ensureDir('exports'),
  luts: () => ensureDir('luts'),
  stills: () => ensureDir('stills'),
};

export function fileSize(uri: string) {
  try {
    const f = new File(uri);
    return f.exists ? f.size : 0;
  } catch {
    return 0;
  }
}

export function fileExists(uri: string) {
  if (process.env.EXPO_OS === 'web') return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

export function directorySize(getDir: () => Directory) {
  try {
    return getDir().size ?? 0;
  } catch {
    return 0;
  }
}
