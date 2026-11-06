import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { frameStats, judgeLog, suggestProfile, type LogVerdict } from '../color/detect';
import type { ProfileId } from '../color/profiles';
import type { Clip } from '../store/projects';
import { intlTag, tr } from '../i18n';
import { fileSize } from './files';
import { uid } from './id';

export async function pickVideos(): Promise<ImagePicker.ImagePickerAsset[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: true,
    selectionLimit: 30,
    orderedSelection: true,
    quality: 1,
    // Never transcode: log footage must arrive bit-exact (10-bit, original gamma).
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (res.canceled) return [];
  return res.assets.filter((a) => a.type === 'video' || a.duration);
}

export async function thumbnailAt(uri: string, seconds: number, quality = 0.6) {
  try {
    const t = await VideoThumbnails.getThumbnailAsync(uri, { time: Math.max(0, Math.round(seconds * 1000)), quality });
    return t;
  } catch {
    return null;
  }
}

/** Decodes an image file and returns small RGBA8 pixels (top-left origin). */
export async function readPixels(imageUri: string, maxW = 128) {
  const data = await Skia.Data.fromURI(imageUri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) return null;
  const w = Math.min(maxW, img.width());
  const h = Math.max(1, Math.round((img.height() / img.width()) * w));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  canvas.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), paint);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const px = snap.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px || !(px instanceof Uint8Array)) return null;
  return { pixels: px, width: w, height: h };
}

export async function analyzeLog(imageUri: string): Promise<LogVerdict | null> {
  try {
    const px = await readPixels(imageUri, 96);
    if (!px) return null;
    return judgeLog(frameStats(px.pixels));
  } catch {
    return null;
  }
}

/** The fields a clip needs; picker assets and shared files both provide them. */
export type VideoInput = Pick<ImagePicker.ImagePickerAsset, 'uri' | 'duration' | 'fileName' | 'width' | 'height' | 'fileSize'>;

export async function clipFromAsset(
  asset: VideoInput,
  opts: { autoDetect: boolean; preferredLog: ProfileId },
): Promise<Clip> {
  const duration = (asset.duration ?? 0) / 1000;
  const thumb = await thumbnailAt(asset.uri, Math.min(1, duration * 0.3));
  const verdict = opts.autoDetect && thumb ? await analyzeLog(thumb.uri) : null;
  const input = opts.autoDetect ? suggestProfile(asset.fileName, verdict, opts.preferredLog) : opts.preferredLog;
  return {
    id: uid(),
    uri: asset.uri,
    name: asset.fileName ?? tr().project.defaultClipName(new Date().toLocaleTimeString(intlTag())),
    duration,
    width: asset.width,
    height: asset.height,
    size: asset.fileSize ?? fileSize(asset.uri),
    thumb: thumb?.uri ?? null,
    input,
    detection: verdict ? { isLog: verdict.isLog, confidence: verdict.confidence } : null,
    trim: { start: 0, end: duration },
    grade: null,
  };
}
