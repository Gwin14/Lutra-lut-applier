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
   * shaders: { glslVertex, glslFragment, msl }.
   */
  render(job: string, sources: string, destinations: string, shaders: string): void;
  cancel(): void;
}

/** Null where the native module is not linked (Expo Go, web). */
export default requireOptionalNativeModule<LutraEngineNative>('LutraEngine');
