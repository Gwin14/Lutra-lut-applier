import { File } from 'expo-file-system';

import { bakeGradeTexture } from '../color/bake';
import { getBuiltInLook } from '../color/looks';
import { bytesToBase64 } from '../color/lut';
import { dirs, fileSize } from '../lib/files';
import { sanitizeFilename } from '../lib/format';
import { hashString, uid } from '../lib/id';
import { loadAllUserLuts, userLookResolver } from '../lib/userLuts';
import { useLibrary } from '../store/library';
import { effectiveGrade, type Clip, type Project } from '../store/projects';
import type { ExportRecord } from '../store/exports';
import type { ExportPreset } from '../store/settings';
import { CONTAINER_EXT, type LutPayload, type RenderJob, type RenderOutput, type RenderSegment } from './protocol';

export type PreparedJob = {
  job: RenderJob;
  records: ExportRecord[];
  /** clipKey -> file uri, for serving engine reads. */
  sources: Record<string, string>;
};

export function lookName(lookId: string | null) {
  if (!lookId) return null;
  if (lookId.startsWith('user:')) return useLibrary.getState().userLuts.find((l) => l.id === lookId)?.name ?? 'LUT';
  return getBuiltInLook(lookId)?.name ?? null;
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Turns a project + export preset into an engine job. Bakes one LUT per unique
 * (input profile, grade) pair at export precision.
 */
export async function prepareJob(project: Project, clipIds: string[], preset: ExportPreset): Promise<PreparedJob> {
  await loadAllUserLuts();
  const clips = project.clips.filter((c) => clipIds.includes(c.id));
  if (!clips.length) throw new Error('Selecione ao menos um clipe.');

  const luts: Record<string, LutPayload> = {};
  const lutKeyFor = async (clip: Clip) => {
    const grade = effectiveGrade(project, clip);
    const key = hashString(`${clip.input}|${JSON.stringify(grade.adjust)}|${grade.lookId}|${grade.lookStrength}|${preset.lutPrecision}`);
    if (!luts[key]) {
      await yieldFrame();
      const tex = bakeGradeTexture(clip.input, grade, preset.lutPrecision, userLookResolver);
      luts[key] = { size: tex.size, cols: tex.cols, width: tex.width, height: tex.height, b64: bytesToBase64(tex.bytes) };
    }
    return key;
  };

  const sources: Record<string, string> = {};
  const segmentFor = async (clip: Clip, i: number, count: number): Promise<RenderSegment> => {
    const key = `clip_${i}`;
    sources[key] = clip.uri;
    const size = fileSize(clip.uri) || clip.size;
    if (!size) throw new Error(`O arquivo de "${clip.name}" não está mais disponível. Reimporte o clipe.`);
    const fade = preset.mode === 'merge' && preset.transition === 'fade' ? 0.35 : 0;
    const endsFade = preset.mode === 'merge' && preset.fadeEnds ? 0.6 : 0;
    return {
      clipKey: key,
      clipSize: size,
      start: clip.trim.start,
      end: clip.trim.end > clip.trim.start ? clip.trim.end : clip.duration,
      lutKey: await lutKeyFor(clip),
      effects: effectiveGrade(project, clip).effects,
      fadeIn: i === 0 ? endsFade : fade,
      fadeOut: i === count - 1 ? endsFade : fade,
    };
  };

  const jobId = uid();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const base = (name: string) => sanitizeFilename(name);
  const outputs: RenderOutput[] = [];
  const records: ExportRecord[] = [];
  const common = {
    container: preset.container,
    codec: preset.codec,
    aspect: project.aspect,
    resolution: preset.resolution,
    fps: preset.fps,
    quality: preset.quality,
    audio: preset.audio,
  };

  const makeRecord = (index: number, name: string, look: string | null): ExportRecord => {
    const file = new File(dirs.exports(), `${base(name)}_${stamp}_${index}.${CONTAINER_EXT[preset.container]}`);
    return {
      id: `${jobId}_${index}`,
      jobId,
      projectId: project.id,
      name,
      uri: file.uri,
      container: preset.container,
      codec: preset.codec,
      lookName: look,
      status: 'queued',
      progress: 0,
      width: 0,
      height: 0,
      fps: 0,
      frames: 0,
      duration: 0,
      size: 0,
      thumb: null,
      savedToPhotos: false,
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
    };
  };

  if (preset.mode === 'merge') {
    const segments: RenderSegment[] = [];
    for (let i = 0; i < clips.length; i++) segments.push(await segmentFor(clips[i], i, clips.length));
    const look = lookName(effectiveGrade(project, clips[0]).lookId);
    const name = `${project.name}${look ? ` ${look}` : ''}`;
    outputs.push({ index: 0, name, ...common, segments });
    records.push(makeRecord(0, name, look));
  } else {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const look = lookName(effectiveGrade(project, clip).lookId);
      const name = `${clip.name.replace(/\.[a-z0-9]+$/i, '')}${look ? ` ${look}` : ''}`;
      outputs.push({ index: i, name, ...common, segments: [await segmentFor(clip, i, 1)] });
      records.push(makeRecord(i, name, look));
    }
  }

  return { job: { id: jobId, luts, outputs }, records, sources };
}

/** Rough output size estimate for the export sheet. */
export function estimateJobBytes(project: Project, clipIds: string[], bitrate: (w: number, h: number) => number) {
  return project.clips
    .filter((c) => clipIds.includes(c.id))
    .reduce((n, c) => {
      const d = Math.max(0, (c.trim.end || c.duration) - c.trim.start);
      return n + (bitrate(c.width, c.height) * d) / 8 + 192000 * d / 8;
    }, 0);
}
