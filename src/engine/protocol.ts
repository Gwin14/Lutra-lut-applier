/**
 * Message protocol between the React Native host and the render engine.
 * Two engines speak it: the native module (modules/lutra-engine: AVFoundation +
 * Metal on iOS, MediaCodec + GLES on Android) and the WebView fallback for
 * Expo Go (WebCodecs + WebGL + mediabunny). The native engine reads and writes
 * files itself, so it never sends `read`/`write`.
 * Shared by all sides; keep it dependency-free.
 */
import type { Effects } from '../color/grade';

export type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1';
export type ContainerId = 'mp4' | 'mov' | 'webm';
export type AspectId = 'original' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '2.39:1';
export type ResolutionId = 'source' | '2160' | '1440' | '1080' | '720' | '540';
export type QualityId = 'low' | 'medium' | 'high' | 'max';

export type LutPayload = {
  size: number;
  cols: number;
  width: number;
  height: number;
  b64: string; // RGBA8
};

export type RenderSegment = {
  clipKey: string;
  clipSize: number;
  start: number; // seconds
  end: number; // seconds
  lutKey: string;
  effects: Effects;
  fadeIn: number; // seconds of fade-from-black at start (0 = cut)
  fadeOut: number;
};

export type RenderOutput = {
  index: number;
  name: string;
  container: ContainerId;
  codec: VideoCodecId;
  aspect: AspectId;
  resolution: ResolutionId;
  fps: number | 'source';
  quality: QualityId;
  audio: boolean;
  segments: RenderSegment[];
};

export type RenderJob = {
  id: string;
  luts: Record<string, LutPayload>;
  outputs: RenderOutput[];
};

export type EngineCaps = {
  /** Absent on the WebView engine. */
  backend?: 'native' | 'webview';
  gpu?: string;
  webcodecs: boolean;
  webgl: 1 | 2 | 0;
  video: Record<VideoCodecId, { hd: boolean; uhd: boolean }>;
  audio: { aac: boolean; opus: boolean };
  userAgent: string;
};

// RN -> engine
export type EngineCommand =
  | { type: 'probe' }
  | { type: 'render'; job: RenderJob }
  | { type: 'cancel' }
  | { type: 'readResult'; id: number; b64?: string; error?: string }
  | { type: 'writeAck'; id: number; error?: string };

// engine -> RN
export type EngineEvent =
  | { type: 'ready' }
  | { type: 'caps'; caps: EngineCaps }
  | { type: 'log'; message: string }
  | { type: 'read'; id: number; clipKey: string; start: number; end: number }
  | { type: 'write'; id: number; outIndex: number; position: number; b64: string }
  | { type: 'outputStart'; outIndex: number; width: number; height: number; fps: number; frames: number; codec: VideoCodecId; audio: 'copy' | 'encode' | 'none' }
  | { type: 'progress'; outIndex: number; frame: number; frames: number; fps: number }
  | { type: 'preview'; dataUrl: string }
  | { type: 'outputDone'; outIndex: number; duration: number; mime: string }
  | { type: 'outputError'; outIndex: number; message: string }
  | { type: 'jobDone'; canceled: boolean };

export const CONTAINER_CODECS: Record<ContainerId, VideoCodecId[]> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  mov: ['avc', 'hevc'],
  webm: ['vp9', 'av1'],
};

export const CONTAINER_EXT: Record<ContainerId, string> = { mp4: 'mp4', mov: 'mov', webm: 'webm' };
