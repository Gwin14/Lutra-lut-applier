import { NativeModule, requireOptionalNativeModule } from 'expo';

type LutraEngineEvents = {
  /** `json` is a serialized EngineEvent (src/engine/protocol.ts). */
  onEvent(event: { json: string }): void;
};

declare class LutraEngineNative extends NativeModule<LutraEngineEvents> {
  /** Serialized EngineCaps. */
  probe(): Promise<string>;
  /**
   * Starts a job; progress and results arrive as `onEvent`. All arguments are JSON:
   * job: RenderJob, sources: clipKey -> file uri, destinations: outIndex -> file uri,
   * shaders: { glslVertex, glslFragment, msl }; labels (iOS): { title, subtitle } for the
   * system UI of the background export.
   */
  render(job: string, sources: string, destinations: string, shaders: string, labels?: string): void;
  cancel(): void;

  /**
   * Opens the system file browser on videos. JSON `[{ uri, name, size, ref }]`;
   * with `copy` the files are copied into the app and `ref` is null, otherwise
   * `ref` is a persistent reference (iOS bookmark / Android document URI).
   */
  pickFiles(multiple: boolean, copy: boolean): Promise<string>;
  /** JSON `{ available, uri?, ref? }`; `ref` when the reference had to be refreshed. */
  resolveRef(ref: string): Promise<string>;
  releaseRef(ref: string): void;
  /** Copies an accessible file into the app's documents; returns the new file uri. */
  makeLocal(uri: string): Promise<string>;
  /** Bytes, or -1 when unreadable. */
  fileSize(uri: string): Promise<number>;
  readBytes(uri: string, offset: number, length: number): Promise<Uint8Array>;
  /** JSON `{ duration, width, height, codec?, transfer?, primaries?, matrix?, bitDepth? }`. */
  mediaInfo(uri: string): Promise<string>;
}

/** Null where the native module is not linked (Expo Go, web). */
export default requireOptionalNativeModule<LutraEngineNative>('LutraEngine');
