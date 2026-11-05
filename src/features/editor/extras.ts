import { FilterMode, ImageFormat, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { bakeGradeLut } from '../../color/bake';
import { serializeCube } from '../../color/cube';
import type { Grade } from '../../color/grade';
import type { ProfileId } from '../../color/profiles';
import { saveToPhotos } from '../../engine/EngineProvider';
import { aspectValue, coverCrop } from '../../engine/geometry';
import { lookName } from '../../engine/jobs';
import { tr } from '../../i18n';
import { profileText } from '../../i18n/content';
import type { AspectId } from '../../engine/protocol';
import { dirs } from '../../lib/files';
import { sanitizeFilename } from '../../lib/format';
import { userLookResolver } from '../../lib/userLuts';
import type { Clip } from '../../store/projects';
import { fxVector, gradeEffect } from '../../preview/effect';
import { bakeCached } from '../../preview/lutImage';

/** Renders the graded frame at full resolution through the same shader. */
export async function exportStill(clip: Clip, grade: Grade, aspect: AspectId, timeSec: number, format: 'png' | 'jpeg') {
  const thumb = await VideoThumbnails.getThumbnailAsync(clip.uri, { time: Math.round(timeSec * 1000), quality: 1 });
  const data = await Skia.Data.fromURI(thumb.uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  const effect = gradeEffect();
  const lut = bakeCached(clip.input, grade, 33);
  if (!img || !effect || !lut) throw new Error(tr().editor.frameReadFailed);
  const iw = img.width();
  const ih = img.height();
  const crop = coverCrop(iw, ih, aspectValue(aspect, iw, ih));
  const outW = Math.round(iw * crop[2]);
  const outH = Math.round(ih * crop[3]);
  const surface = Skia.Surface.MakeOffscreen(outW, outH) ?? Skia.Surface.Make(outW, outH);
  if (!surface) throw new Error(tr().editor.frameNoMemory);
  const t = lut.tex;
  const uniforms = [outW, outH, iw, ih, 0, ...crop, t.size, t.cols, t.width, t.height, ...fxVector(grade.effects), -1, 0, 0, 0, timeSec, 1];
  const shader = effect.makeShaderWithChildren(uniforms, [
    img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
    lut.image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
  ]);
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, outW, outH), paint);
  surface.flush();
  const b64 = surface.makeImageSnapshot().encodeToBase64(format === 'png' ? ImageFormat.PNG : ImageFormat.JPEG, 95);
  const file = new File(dirs.stills(), `${sanitizeFilename(clip.name)}_${Date.now()}.${format === 'png' ? 'png' : 'jpg'}`);
  file.create({ overwrite: true });
  file.write(b64, { encoding: 'base64' });
  const saved = await saveToPhotos(file.uri);
  return { uri: file.uri, saved, width: outW, height: outH };
}

/** Bakes the complete grade (input transform + look + adjustments) into a .cube. */
export async function exportGradeCube(input: ProfileId, grade: Grade, size: 33 | 65, projectName: string) {
  const lut = bakeGradeLut(input, grade, size, userLookResolver);
  const look = lookName(grade.lookId);
  const t = tr().editor;
  const profile = profileText(input);
  const title = `${projectName}${look ? ` - ${look}` : ''}`;
  const text = serializeCube(lut, title, [
    t.cubeExportedBy,
    t.cubeInput(profile.name, profile.gamutLabel),
    t.cubeApply,
  ]);
  const file = new File(dirs.luts(), `${sanitizeFilename(title)}_${size}.cube`);
  file.create({ overwrite: true });
  file.write(text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { dialogTitle: t.shareLut, mimeType: 'application/octet-stream', UTI: 'public.data' });
  }
  return file.uri;
}
