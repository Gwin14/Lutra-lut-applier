/**
 * Lutra render engine — runs inside a WebView (Expo Go compatible: no custom
 * native code). Bundled by scripts/build-engine.mjs into a single HTML string.
 *
 * Pipeline per output:
 *   bytes (bridged from RN on demand) -> mediabunny demux -> WebCodecs decode
 *   -> WebGL (raw Y'CbCr planes + baked grade LUT + effects) -> WebCodecs encode
 *   -> mediabunny mux -> bytes streamed back to RN, written to disk.
 */
import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  CanvasSource,
  CustomSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type EncodedPacket,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type VideoSample,
} from 'mediabunny';

import { coverCrop, estimateBitrate, outputSize, aspectValue, snapFrameRate } from '../../src/engine/geometry';
import type {
  EngineCaps,
  EngineCommand,
  EngineEvent,
  LutPayload,
  RenderJob,
  RenderOutput,
  VideoCodecId,
} from '../../src/engine/protocol';
import { CONTAINER_CODECS } from '../../src/engine/protocol';
import { GLSL_FRAGMENT_RGB, GLSL_FRAGMENT_YUV, GLSL_VERTEX } from '../../src/engine/shader';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    __lutraEngine: { receive(json: string): void };
    __lutraTestSink?: (evt: EngineEvent) => void;
  }
}

// ---------------------------------------------------------------- bridge --

function bytesToBase64(bytes: Uint8Array) {
  const anyBytes = bytes as any;
  if (typeof anyBytes.toBase64 === 'function') return anyBytes.toBase64() as string;
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}

function base64ToBytes(b64: string) {
  const U8 = Uint8Array as any;
  if (typeof U8.fromBase64 === 'function') return U8.fromBase64(b64) as Uint8Array;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function send(evt: EngineEvent) {
  const json = JSON.stringify(evt);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(json);
  else window.__lutraTestSink?.(evt);
}

function log(message: string) {
  send({ type: 'log', message });
}

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function request<T>(build: (id: number) => EngineEvent): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send(build(id));
  });
}

function settle(id: number, error: string | undefined, value: unknown) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error) p.reject(new Error(error));
  else p.resolve(value);
}

async function readBytes(clipKey: string, start: number, end: number): Promise<Uint8Array> {
  const b64 = await request<string>((id) => ({ type: 'read', id, clipKey, start, end }));
  return base64ToBytes(b64);
}

// ---------------------------------------------------------------- WebGL --

type Program = { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> };

class Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  isGL2: boolean;
  rgb: Program;
  yuv: Program;
  frameTex: WebGLTexture;
  planes: WebGLTexture[];
  lutTex: WebGLTexture;
  lut: LutPayload | null = null;
  scratch: Uint8Array = new Uint8Array(0);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16;
    this.canvas.height = 16;
    document.getElementById('stage')?.appendChild(this.canvas);
    const opts: WebGLContextAttributes = { preserveDrawingBuffer: true, alpha: false, antialias: false, premultipliedAlpha: false };
    const gl2 = this.canvas.getContext('webgl2', opts) as WebGL2RenderingContext | null;
    const gl = (gl2 ?? this.canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('@noWebgl');
    this.gl = gl;
    this.isGL2 = !!gl2;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.rgb = this.compile(GLSL_FRAGMENT_RGB, ['uFrameTex']);
    this.yuv = this.compile(GLSL_FRAGMENT_YUV, ['uPlaneY', 'uPlaneU', 'uPlaneV', 'uPlaneFmt', 'uYuvRange', 'uYuvMat', 'uChromaSize']);
    this.frameTex = this.texture(gl.LINEAR);
    this.planes = [this.texture(gl.NEAREST), this.texture(gl.NEAREST), this.texture(gl.NEAREST)];
    this.lutTex = this.texture(gl.LINEAR);
  }

  private texture(filter: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private compile(fragment: string, extra: string[]): Program {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, GLSL_VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    const loc: Program['loc'] = {};
    for (const n of ['uOut', 'uRaw', 'uRot', 'uCrop', 'uLut', 'uFx', 'uView', 'uMisc', 'uLutTex', ...extra]) {
      loc[n] = gl.getUniformLocation(prog, n);
    }
    return { prog, loc };
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  setLut(lut: LutPayload) {
    if (this.lut === lut) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.isGL2) (gl as WebGL2RenderingContext).pixelStorei((gl as WebGL2RenderingContext).UNPACK_ROW_LENGTH, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.width, lut.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, base64ToBytes(lut.b64));
    this.lut = lut;
  }

  /** Uploads a decoded frame; returns which program to use and raw size. */
  async upload(sample: VideoSample): Promise<{ program: Program; rawW: number; rawH: number; yuv?: number[] }> {
    const gl = this.gl;
    const fmt = sample.format;
    const w = sample.codedWidth;
    const h = sample.codedHeight;
    const vis = sample.visibleRect;
    const rawW = vis?.width || w;
    const rawH = vis?.height || h;
    if (fmt === 'I420' || fmt === 'I420P10' || fmt === 'NV12') {
      const size = sample.allocationSize();
      if (this.scratch.byteLength < size) this.scratch = new Uint8Array(size);
      const buf = this.scratch.subarray(0, size);
      const layout = await sample.copyTo(buf);
      const ten = fmt === 'I420P10';
      const bpp = ten ? 2 : 1;
      const cw = Math.ceil(rawW / 2);
      const ch = Math.ceil(rawH / 2);
      const planeDefs =
        fmt === 'NV12'
          ? [
              { w: rawW, h: rawH, comps: 1 },
              { w: cw, h: ch, comps: 2 },
            ]
          : [
              { w: rawW, h: rawH, comps: 1 },
              { w: cw, h: ch, comps: 1 },
              { w: cw, h: ch, comps: 1 },
            ];
      planeDefs.forEach((p, i) => {
        const texComps = ten ? 2 : p.comps;
        const rowBytes = p.w * p.comps * bpp;
        const stride = layout[i].stride;
        let data = buf.subarray(layout[i].offset, layout[i].offset + stride * (p.h - 1) + rowBytes);
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.planes[i]);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (stride !== rowBytes) {
          if (this.isGL2) {
            (gl as WebGL2RenderingContext).pixelStorei((gl as WebGL2RenderingContext).UNPACK_ROW_LENGTH, stride / (bpp * p.comps));
          } else {
            const packed = new Uint8Array(rowBytes * p.h);
            for (let y = 0; y < p.h; y++) packed.set(buf.subarray(layout[i].offset + y * stride, layout[i].offset + y * stride + rowBytes), y * rowBytes);
            data = packed;
          }
        } else if (this.isGL2) {
          (gl as WebGL2RenderingContext).pixelStorei((gl as WebGL2RenderingContext).UNPACK_ROW_LENGTH, 0);
        }
        const format = texComps === 2 ? gl.LUMINANCE_ALPHA : gl.LUMINANCE;
        gl.texImage2D(gl.TEXTURE_2D, 0, format, p.w, p.h, 0, format, gl.UNSIGNED_BYTE, data);
      });
      if (this.isGL2) (gl as WebGL2RenderingContext).pixelStorei((gl as WebGL2RenderingContext).UNPACK_ROW_LENGTH, 0);
      // NV12 chroma samples in a two-channel texture still need linear filtering.
      if (fmt === 'NV12' || !ten) {
        for (let i = 0; i < planeDefs.length; i++) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
      }
      return { program: this.yuv, rawW, rawH, yuv: yuvParams(sample, ten, fmt === 'NV12' ? 2 : ten ? 1 : 0, cw, ch) };
    }
    // Packed RGB(A) frames: let the browser upload directly.
    const source = sample.toCanvasImageSource();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    return { program: this.rgb, rawW, rawH };
  }

  draw(
    up: { program: Program; rawW: number; rawH: number; yuv?: number[] },
    u: { rot: number; crop: number[]; fx: number[]; time: number; mul: number },
  ) {
    const gl = this.gl;
    const { prog, loc } = up.program;
    gl.useProgram(prog);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(loc.uOut, this.canvas.width, this.canvas.height);
    gl.uniform2f(loc.uRaw, up.rawW, up.rawH);
    gl.uniform1f(loc.uRot, u.rot);
    gl.uniform4fv(loc.uCrop, u.crop);
    const lut = this.lut!;
    gl.uniform4f(loc.uLut, lut.size, lut.cols, lut.width, lut.height);
    gl.uniform4fv(loc.uFx, u.fx);
    gl.uniform4f(loc.uView, -1, 0, 0, 0);
    gl.uniform2f(loc.uMisc, u.time, u.mul);
    gl.uniform1i(loc.uLutTex, 4);
    if (up.yuv) {
      gl.uniform1i(loc.uPlaneY, 0);
      gl.uniform1i(loc.uPlaneU, 1);
      gl.uniform1i(loc.uPlaneV, 2);
      gl.uniform1f(loc.uPlaneFmt, up.yuv[0]);
      gl.uniform4f(loc.uYuvRange, up.yuv[1], up.yuv[2], up.yuv[3], up.yuv[4]);
      gl.uniform4f(loc.uYuvMat, up.yuv[5], up.yuv[6], up.yuv[7], up.yuv[8]);
      gl.uniform2f(loc.uChromaSize, up.yuv[9], up.yuv[10]);
    } else {
      gl.uniform1i(loc.uFrameTex, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** [fmt, sY, oY, sC, oC, crR, cbG, crG, cbB, chromaW, chromaH] for the YUV shader. */
function yuvParams(sample: VideoSample, ten: boolean, fmt: number, cw: number, ch: number) {
  const cs = sample.colorSpace;
  const full = cs?.fullRange === true;
  const max = ten ? 1023 : 255;
  const sh = ten ? 4 : 1;
  const range = full
    ? [1 / max, 0, 1 / max, -(128 * sh) / max]
    : [1 / (219 * sh), -(16 * sh) / (219 * sh), 1 / (224 * sh), -(128 * sh) / (224 * sh)];
  // Untagged streams: SD is conventionally BT.601, HD and up BT.709.
  const vis = sample.visibleRect;
  const hd = (vis?.height || sample.codedHeight) >= 720 || (vis?.width || sample.codedWidth) >= 1280;
  const m: string = cs?.matrix ?? (hd ? 'bt709' : 'smpte170m');
  const mat =
    m === 'bt2020-ncl'
      ? [1.4746, 0.16455, 0.57135, 1.8814]
      : m === 'smpte170m' || m === 'bt470bg'
        ? [1.402, 0.344136, 0.714136, 1.772]
        : [1.5748, 0.1873, 0.4681, 1.8556];
  return [fmt, ...range, ...mat, cw, ch];
}

// ------------------------------------------------------------- caps probe --

async function probe(): Promise<EngineCaps> {
  const webcodecs = typeof (window as any).VideoEncoder === 'function' && typeof (window as any).VideoDecoder === 'function';
  let webgl: 0 | 1 | 2 = 0;
  try {
    const c = document.createElement('canvas');
    webgl = c.getContext('webgl2') ? 2 : c.getContext('webgl') ? 1 : 0;
  } catch {}
  const video = {} as EngineCaps['video'];
  for (const codec of ['avc', 'hevc', 'vp9', 'av1'] as VideoCodecId[]) {
    const test = async (width: number, height: number) => {
      if (!webcodecs) return false;
      try {
        return await canEncodeVideo(codec, { width, height, bitrate: estimateBitrate(width, height, 30, 'high', codec) });
      } catch {
        return false;
      }
    };
    video[codec] = { hd: await test(1920, 1080), uhd: await test(3840, 2160) };
  }
  const audioTest = async (codec: 'aac' | 'opus') => {
    try {
      return webcodecs && (await canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }));
    } catch {
      return false;
    }
  };
  return { webcodecs, webgl, video, audio: { aac: await audioTest('aac'), opus: await audioTest('opus') }, userAgent: navigator.userAgent };
}

// ---------------------------------------------------------------- render --

let canceled = false;
let activeOutput: Output | null = null;
let renderer: Renderer | null = null;
let lastPreview = 0;

function sendPreview(r: Renderer) {
  const now = performance.now();
  if (now - lastPreview < 900) return;
  lastPreview = now;
  try {
    const w = 320;
    const h = Math.max(2, Math.round((r.canvas.height / r.canvas.width) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(r.canvas, 0, 0, w, h);
    send({ type: 'preview', dataUrl: c.toDataURL('image/jpeg', 0.6) });
  } catch {}
}

type OpenClip = { input: Input; video: InputVideoTrack; audio: InputAudioTrack | null; displayW: number; displayH: number; fps: number };

async function openClip(key: string, size: number): Promise<OpenClip> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new CustomSource({
      getSize: () => size,
      read: (start, end) => readBytes(key, start, end),
      maxCacheSize: 64 * 1024 * 1024,
    }),
  });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('@noVideoTrack');
  if (!(await video.canDecode())) {
    // Coded messages ('@code|arg|arg') are localized by the app (src/engine/errors.ts).
    throw new Error(`@cannotDecode|${video.codec ?? ''}`);
  }
  const audio = await input.getPrimaryAudioTrack();
  const rot = video.rotation;
  const sw = video.squarePixelWidth || video.codedWidth;
  const sh = video.squarePixelHeight || video.codedHeight;
  const swap = rot === 90 || rot === 270;
  let fps = 30;
  try {
    fps = snapFrameRate((await video.computePacketStats(120)).averagePacketRate);
  } catch {}
  return { input, video, audio, displayW: swap ? sh : sw, displayH: swap ? sw : sh, fps };
}

function makeFormat(container: RenderOutput['container']) {
  if (container === 'webm') return new WebMOutputFormat();
  if (container === 'mov') return new MovOutputFormat({ fastStart: false });
  return new Mp4OutputFormat({ fastStart: false });
}

async function pickCodec(out: RenderOutput, width: number, height: number, fps: number) {
  const order = [out.codec, ...CONTAINER_CODECS[out.container].filter((c) => c !== out.codec)];
  for (const codec of order) {
    try {
      const bitrate = estimateBitrate(width, height, fps, out.quality, codec);
      if (await canEncodeVideo(codec, { width, height, bitrate, frameRate: fps })) return { codec, bitrate };
    } catch {}
  }
  throw new Error(`@noEncoder|${out.container.toUpperCase()}|${width}×${height}`);
}

async function renderOutput(job: RenderJob, out: RenderOutput) {
  const r = (renderer ??= new Renderer());
  const clips = new Map<string, OpenClip>();
  try {
    for (const seg of out.segments) if (!clips.has(seg.clipKey)) clips.set(seg.clipKey, await openClip(seg.clipKey, seg.clipSize));
    const first = clips.get(out.segments[0].clipKey)!;
    const fps = out.fps === 'source' ? first.fps : out.fps;
    const { width, height } = outputSize(first.displayW, first.displayH, out.aspect, out.resolution);
    const outAspect = aspectValue(out.aspect, first.displayW, first.displayH);
    const { codec, bitrate } = await pickCodec(out, width, height, fps);

    // Audio strategy: copy packets when every clip shares a container-friendly codec.
    let wantCodec: 'aac' | 'opus' = out.container === 'webm' ? 'opus' : 'aac';
    let audioMode: 'copy' | 'encode' | 'none' = 'none';
    if (out.audio) {
      const tracks = out.segments.map((s) => clips.get(s.clipKey)!.audio);
      const present = tracks.filter((t): t is InputAudioTrack => !!t);
      if (present.length) {
        const a0 = present[0];
        const same = present.every((t) => t.codec === a0.codec && t.sampleRate === a0.sampleRate && t.numberOfChannels === a0.numberOfChannels);
        if (same && a0.codec === wantCodec && present.length === tracks.length) audioMode = 'copy';
        else if (await canEncodeAudio(wantCodec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }).catch(() => false)) audioMode = 'encode';
        else if (out.container === 'mp4' && same && a0.codec === 'opus' && present.length === tracks.length) {
          // Opus in MP4 is valid; better than dropping the soundtrack.
          wantCodec = 'opus';
          audioMode = 'copy';
        } else if (out.container === 'mp4' && (await canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }).catch(() => false))) {
          wantCodec = 'opus';
          audioMode = 'encode';
        }
      }
    }

    const frames = out.segments.reduce((n, s) => n + Math.max(1, Math.round((s.end - s.start) * fps)), 0);
    r.resize(width, height);
    send({ type: 'outputStart', outIndex: out.index, width, height, fps, frames, codec, audio: audioMode });

    const writable = new WritableStream<StreamTargetChunk>({
      write: async (chunk) => {
        await request((id) => ({ type: 'write', id, outIndex: out.index, position: chunk.position, b64: bytesToBase64(chunk.data) }));
      },
    });
    const output = new Output({ format: makeFormat(out.container), target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    activeOutput = output;
    const videoSource = new CanvasSource(r.canvas, { codec, bitrate, keyFrameInterval: 2, latencyMode: 'quality' });
    output.addVideoTrack(videoSource, { frameRate: fps });

    let copySource: EncodedAudioPacketSource | null = null;
    let encodeSource: AudioSampleSource | null = null;
    let audioMetaSent = false;
    if (audioMode === 'copy') {
      copySource = new EncodedAudioPacketSource(wantCodec);
      output.addAudioTrack(copySource);
    } else if (audioMode === 'encode') {
      encodeSource = new AudioSampleSource({ codec: wantCodec, bitrate: 192000, transform: { numberOfChannels: 2, sampleRate: 48000 } });
      output.addAudioTrack(encodeSource);
    }
    await output.start();

    let done = 0;
    let offset = 0;
    const t0 = performance.now();
    let lastProgress = 0;

    for (let si = 0; si < out.segments.length; si++) {
      const seg = out.segments[si];
      const clip = clips.get(seg.clipKey)!;
      r.setLut(job.luts[seg.lutKey]);
      const segFrames = Math.max(1, Math.round((seg.end - seg.start) * fps));
      const crop = coverCrop(clip.displayW, clip.displayH, outAspect);
      const fx = [seg.effects.vignette / 100, seg.effects.grain / 100, seg.effects.grainSize, seg.effects.sharpen / 100];
      const rot = (clip.video.rotation / 90) | 0;

      // Audio pump, advanced in lock-step with video so the muxer interleaves.
      let audioPump: ((until: number) => Promise<void>) | null = null;
      if (clip.audio && (copySource || encodeSource)) {
        const track = clip.audio;
        if (copySource) {
          const pktSink = new EncodedPacketSink(track);
          const startPkt = (await pktSink.getPacket(seg.start)) ?? undefined;
          const it = pktSink.packets(startPkt)[Symbol.asyncIterator]();
          const config = await track.getDecoderConfig();
          let pendingPkt: EncodedPacket | null = null;
          let finished = false;
          audioPump = async (until) => {
            while (!finished) {
              const next = pendingPkt ?? (await it.next()).value;
              pendingPkt = null;
              if (!next) {
                finished = true;
                break;
              }
              if (next.timestamp < seg.start) continue;
              if (next.timestamp >= seg.end) {
                finished = true;
                break;
              }
              const ts = offset + (next.timestamp - seg.start);
              if (ts > until) {
                pendingPkt = next;
                break;
              }
              await copySource!.add(next.clone({ timestamp: ts }), audioMetaSent ? undefined : { decoderConfig: config ?? undefined });
              audioMetaSent = true;
            }
          };
        } else {
          const it = new AudioSampleSink(track).samples(seg.start, seg.end)[Symbol.asyncIterator]();
          let pendingSample: any = null;
          let finished = false;
          audioPump = async (until) => {
            while (!finished) {
              const s = pendingSample ?? (await it.next()).value;
              pendingSample = null;
              if (!s) {
                finished = true;
                break;
              }
              const ts = offset + Math.max(0, s.timestamp - seg.start);
              if (ts > until) {
                pendingSample = s;
                break;
              }
              s.setTimestamp(ts);
              await encodeSource!.add(s);
              s.close();
            }
          };
        }
      }

      const sink = new VideoSampleSink(clip.video);
      const stamps = function* () {
        for (let k = 0; k < segFrames; k++) yield seg.start + (k + 0.5) / fps;
      };
      let k = 0;
      let lastUpload: Awaited<ReturnType<Renderer['upload']>> | null = null;
      for await (const sample of sink.samplesAtTimestamps(stamps())) {
        if (canceled) {
          sample?.close();
          break;
        }
        if (sample) {
          lastUpload = await r.upload(sample);
          sample.close();
        }
        const local = k / fps;
        const remain = (segFrames - k) / fps;
        let mul = 1;
        if (seg.fadeIn > 0) mul = Math.min(mul, local / seg.fadeIn);
        if (seg.fadeOut > 0) mul = Math.min(mul, remain / seg.fadeOut);
        if (lastUpload) r.draw(lastUpload, { rot, crop, fx, time: offset + local, mul: Math.max(0, Math.min(1, mul)) });
        const ts = offset + k / fps;
        await videoSource.add(ts, 1 / fps);
        if (audioPump) await audioPump(ts + 0.5);
        k++;
        done++;
        const now = performance.now();
        if (now - lastProgress > 250) {
          lastProgress = now;
          send({ type: 'progress', outIndex: out.index, frame: done, frames, fps: done / ((now - t0) / 1000) });
          sendPreview(r);
        }
      }
      if (canceled) break;
      if (audioPump) await audioPump(Number.POSITIVE_INFINITY);
      offset += segFrames / fps;
    }

    if (canceled) {
      await output.cancel();
      return;
    }
    videoSource.close();
    copySource?.close();
    encodeSource?.close();
    await output.finalize();
    send({ type: 'progress', outIndex: out.index, frame: frames, frames, fps: done / ((performance.now() - t0) / 1000) });
    send({ type: 'outputDone', outIndex: out.index, duration: offset, mime: await output.getMimeType() });
  } finally {
    activeOutput = null;
    for (const c of clips.values()) c.input.dispose();
  }
}

async function runJob(job: RenderJob) {
  canceled = false;
  for (const out of job.outputs) {
    if (canceled) break;
    try {
      await renderOutput(job, out);
    } catch (e) {
      if (!canceled) send({ type: 'outputError', outIndex: out.index, message: (e as Error)?.message ?? String(e) });
    }
  }
  send({ type: 'jobDone', canceled });
}

// ---------------------------------------------------------------- entry --

window.__lutraEngine = {
  receive(json: string) {
    let cmd: EngineCommand;
    try {
      cmd = JSON.parse(json);
    } catch {
      return;
    }
    switch (cmd.type) {
      case 'probe':
        probe().then((caps) => send({ type: 'caps', caps }));
        break;
      case 'render':
        runJob(cmd.job).catch((e) => {
          send({ type: 'outputError', outIndex: -1, message: String(e?.message ?? e) });
          send({ type: 'jobDone', canceled: false });
        });
        break;
      case 'cancel':
        canceled = true;
        activeOutput?.cancel().catch(() => {});
        for (const [id] of pending) settle(id, 'cancelado', undefined);
        break;
      case 'readResult':
        settle(cmd.id, cmd.error, cmd.b64);
        break;
      case 'writeAck':
        settle(cmd.id, cmd.error, true);
        break;
    }
  },
};

window.addEventListener('error', (e) => log('erro: ' + e.message));
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => log('rejection: ' + String(e.reason?.message ?? e.reason)));
send({ type: 'ready' });
