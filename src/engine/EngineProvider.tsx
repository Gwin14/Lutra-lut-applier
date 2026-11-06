import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, FileMode, type FileHandle } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { Album, Asset, requestPermissionsAsync } from 'expo-media-library';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView as WebViewBase, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import LutraEngine from '../../modules/lutra-engine';
import { base64ToBytes } from '../color/lut';
import { tr } from '../i18n';
import { haptic } from '../lib/haptics';
import { formatEta } from '../lib/format';
import { thumbnailAt } from '../lib/media';
import { useExports } from '../store/exports';
import { useSettings } from '../store/settings';
import { endRenderActivity, startRenderActivity, updateRenderActivity, updateRenderWidget } from '../widgets';
import { ENGINE_HTML } from './engineHtml.generated';
import { localizeEngineError } from './errors';
import type { PreparedJob } from './jobs';
import type { EngineCommand, EngineEvent } from './protocol';
import { NATIVE_SHADERS } from './shader';

/** Native engine (development/production builds); null in Expo Go and on web, which fall back to the WebView. */
const NATIVE = process.env.EXPO_OS === 'web' ? null : LutraEngine;

type EngineApi = {
  enqueue: (prepared: PreparedJob, title: string, projectId: string) => void;
  cancel: () => void;
  probe: () => void;
};

// React 19.3 typings reject the class component's JSX signature; the runtime is fine.
const WebView = WebViewBase as unknown as React.ComponentType<WebViewProps & { ref?: React.Ref<WebViewBase> }>;
type WebView = WebViewBase;

const EngineContext = createContext<EngineApi | null>(null);

export function useEngine() {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine outside EngineProvider');
  return ctx;
}

type Running = {
  prepared: PreparedJob;
  title: string;
  handles: Map<number, FileHandle>;
  startedAt: number;
  lastWidget: number;
};

/**
 * Hosts the render engine: the native module when it is linked, otherwise an
 * invisible WebView (Expo Go) whose I/O is served from here (byte-range reads
 * of the source clips and positioned writes of the outputs). Both emit the same
 * EngineEvents. Jobs run one at a time; the queue survives navigation (not app restarts).
 */
export function EngineProvider({ children }: { children: ReactNode }) {
  const web = useRef<WebView>(null);
  const queue = useRef<{ prepared: PreparedJob; title: string; projectId: string }[]>([]);
  const running = useRef<Running | null>(null);
  const onEventRef = useRef<(evt: EngineEvent) => void>(() => {});

  const send = useCallback((cmd: EngineCommand) => {
    if (NATIVE) {
      const native = NATIVE;
      if (cmd.type === 'probe') {
        native
          .probe()
          .then((json) => onEventRef.current({ type: 'caps', caps: JSON.parse(json) }))
          .catch((e) => __DEV__ && console.warn('[engine] probe failed', e));
      } else if (cmd.type === 'cancel') {
        native.cancel();
      } else if (cmd.type === 'render') {
        const r = running.current;
        const destinations: Record<string, string> = {};
        r?.prepared.job.outputs.forEach((o, i) => {
          destinations[String(o.index)] = r.prepared.records[i].uri;
        });
        try {
          native.render(JSON.stringify(cmd.job), JSON.stringify(r?.prepared.sources ?? {}), JSON.stringify(destinations), JSON.stringify(NATIVE_SHADERS));
        } catch (e) {
          onEventRef.current({ type: 'outputError', outIndex: -1, message: String((e as Error)?.message ?? e) });
          onEventRef.current({ type: 'jobDone', canceled: false });
        }
      }
      return;
    }
    web.current?.injectJavaScript(`window.__lutraEngine && window.__lutraEngine.receive(${JSON.stringify(JSON.stringify(cmd))}); true;`);
  }, []);

  const pump = useCallback(() => {
    if (running.current || !useExports.getState().engineReady) return;
    const next = queue.current.shift();
    if (!next) return;
    const { prepared, title, projectId } = next;
    running.current = { prepared, title, handles: new Map(), startedAt: Date.now(), lastWidget: 0 };
    const store = useExports.getState();
    store.setActive({
      id: prepared.job.id,
      projectId,
      title,
      outputIds: prepared.records.map((r) => r.id),
      currentIndex: 0,
      fps: 0,
      preview: null,
      startedAt: Date.now(),
    });
    activateKeepAwakeAsync('lutra-render').catch(() => {});
    startRenderActivity({ title, progress: 0, finished: 0, total: prepared.records.length, eta: tr().format.starting });
    send({ type: 'render', job: prepared.job });
  }, [send]);

  const recordFor = (outIndex: number) => {
    const r = running.current;
    return r ? r.prepared.records[r.prepared.job.outputs.findIndex((o) => o.index === outIndex)] : undefined;
  };

  const syncWidgets = useCallback((force = false) => {
    const r = running.current;
    if (!r) return;
    const now = Date.now();
    if (!force && now - r.lastWidget < 4000) return;
    r.lastWidget = now;
    const s = useExports.getState();
    const recs = s.records.filter((x) => r.prepared.records.some((p) => p.id === x.id));
    const total = recs.reduce((n, x) => n + Math.max(x.frames, 1), 0);
    const done = recs.reduce((n, x) => n + Math.max(x.frames, 1) * (x.status === 'done' ? 1 : x.progress), 0);
    const progress = total ? done / total : 0;
    const finished = recs.filter((x) => x.status === 'done').length;
    const elapsed = (now - r.startedAt) / 1000;
    const eta = progress > 0.02 ? formatEta((elapsed / progress) * (1 - progress)) : tr().format.etaCalculating;
    updateRenderWidget({ state: 'rendering', progress, title: r.title, detail: eta, finished, total: recs.length, exportedToday: exportedToday() });
    updateRenderActivity({ title: r.title, progress, finished, total: recs.length, eta });
  }, []);

  const finishJob = useCallback(
    (canceled: boolean) => {
      const r = running.current;
      if (!r) return;
      for (const h of r.handles.values()) {
        try {
          h.close();
        } catch {}
      }
      const s = useExports.getState();
      for (const rec of r.prepared.records) {
        const cur = s.records.find((x) => x.id === rec.id);
        if (cur && (cur.status === 'queued' || cur.status === 'rendering' || cur.status === 'preparing')) {
          s.patchRecord(rec.id, { status: canceled ? 'canceled' : 'failed', error: canceled ? null : cur.error ?? tr().exports.unknownFailure });
          if (canceled) deleteQuietly(rec.uri);
        }
      }
      const recs = useExports.getState().records.filter((x) => r.prepared.records.some((p) => p.id === x.id));
      const ok = recs.filter((x) => x.status === 'done').length;
      if (canceled) haptic.warning();
      else if (ok === recs.length) haptic.success();
      else haptic.error();
      updateRenderWidget({
        state: ok > 0 ? 'done' : 'failed',
        progress: 1,
        title: r.title,
        detail: ok > 0 ? tr().exports.nOfMExported(ok, recs.length) : tr().exports.exportFailed,
        finished: ok,
        total: recs.length,
        exportedToday: exportedToday(),
      });
      endRenderActivity({ title: r.title, progress: 1, finished: ok, total: recs.length, eta: canceled ? tr().exports.canceledShort : tr().exports.doneShort });
      deactivateKeepAwake('lutra-render').catch(() => {});
      running.current = null;
      s.setActive(null);
      pump();
    },
    [pump],
  );

  const onEvent = useCallback(
    async (evt: EngineEvent) => {
      const s = useExports.getState();
      switch (evt.type) {
        case 'ready':
          s.setEngineReady(true);
          send({ type: 'probe' });
          pump();
          break;
        case 'caps':
          s.setCaps(evt.caps);
          break;
        case 'log':
          if (__DEV__) console.log('[engine]', evt.message);
          break;
        case 'read': {
          const r = running.current;
          const uri = r?.prepared.sources[evt.clipKey];
          if (!uri) {
            send({ type: 'readResult', id: evt.id, error: 'unknown file' });
            break;
          }
          try {
            const b64 = await LegacyFS.readAsStringAsync(uri, {
              encoding: LegacyFS.EncodingType.Base64,
              position: evt.start,
              length: evt.end - evt.start,
            });
            send({ type: 'readResult', id: evt.id, b64 });
          } catch (e) {
            send({ type: 'readResult', id: evt.id, error: String((e as Error)?.message ?? e) });
          }
          break;
        }
        case 'write': {
          const r = running.current;
          const rec = recordFor(evt.outIndex);
          if (!r || !rec) {
            send({ type: 'writeAck', id: evt.id, error: 'no destination' });
            break;
          }
          try {
            let h = r.handles.get(evt.outIndex);
            if (!h) {
              const f = new File(rec.uri);
              if (!f.exists) f.create({ intermediates: true });
              h = f.open(FileMode.ReadWrite);
              r.handles.set(evt.outIndex, h);
            }
            h.offset = evt.position;
            await h.writeBytes(base64ToBytes(evt.b64));
            send({ type: 'writeAck', id: evt.id });
          } catch (e) {
            send({ type: 'writeAck', id: evt.id, error: String((e as Error)?.message ?? e) });
          }
          break;
        }
        case 'outputStart': {
          const rec = recordFor(evt.outIndex);
          if (!rec) break;
          s.patchRecord(rec.id, { status: 'rendering', width: evt.width, height: evt.height, fps: evt.fps, frames: evt.frames, codec: evt.codec });
          s.patchActive({ currentIndex: running.current!.prepared.records.indexOf(rec) });
          syncWidgets(true);
          break;
        }
        case 'progress': {
          const rec = recordFor(evt.outIndex);
          if (!rec) break;
          s.patchRecord(rec.id, { progress: evt.frames ? evt.frame / evt.frames : 0 });
          s.patchActive({ fps: evt.fps });
          syncWidgets();
          break;
        }
        case 'preview':
          s.patchActive({ preview: evt.dataUrl });
          break;
        case 'outputDone': {
          const r = running.current;
          const rec = recordFor(evt.outIndex);
          if (!r || !rec) break;
          const h = r.handles.get(evt.outIndex);
          try {
            h?.close();
          } catch {}
          r.handles.delete(evt.outIndex);
          const size = (() => {
            try {
              return new File(rec.uri).size;
            } catch {
              return 0;
            }
          })();
          s.patchRecord(rec.id, { status: 'done', progress: 1, duration: evt.duration, size, finishedAt: Date.now() });
          // Post-processing that does not block the next output.
          (async () => {
            const thumb = await thumbnailAt(rec.uri, Math.min(1, evt.duration / 3), 0.5);
            if (thumb) useExports.getState().patchRecord(rec.id, { thumb: thumb.uri });
            if (useSettings.getState().saveToPhotos && rec.container !== 'webm') {
              const saved = await saveToPhotos(rec.uri);
              useExports.getState().patchRecord(rec.id, { savedToPhotos: saved });
            }
          })();
          syncWidgets(true);
          break;
        }
        case 'outputError': {
          const r = running.current;
          if (evt.outIndex < 0 && r) {
            for (const rr of r.prepared.records) s.patchRecord(rr.id, { status: 'failed', error: localizeEngineError(evt.message) });
            break;
          }
          const rec = recordFor(evt.outIndex);
          if (!rec) break;
          s.patchRecord(rec.id, { status: 'failed', error: localizeEngineError(evt.message) });
          const h = r?.handles.get(evt.outIndex);
          try {
            h?.close();
          } catch {}
          r?.handles.delete(evt.outIndex);
          deleteQuietly(rec.uri);
          break;
        }
        case 'jobDone':
          finishJob(evt.canceled);
          break;
      }
    },
    [finishJob, pump, send, syncWidgets],
  );

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!NATIVE) return;
    const sub = NATIVE.addListener('onEvent', ({ json }) => {
      try {
        onEventRef.current(JSON.parse(json));
      } catch {}
    });
    onEventRef.current({ type: 'ready' });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let evt: EngineEvent;
      try {
        evt = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      onEvent(evt);
    },
    [onEvent],
  );

  const api = useMemo<EngineApi>(
    () => ({
      enqueue: (prepared, title, projectId) => {
        useExports.getState().addRecords(prepared.records);
        queue.current.push({ prepared, title, projectId });
        pump();
      },
      cancel: () => {
        if (running.current) send({ type: 'cancel' });
      },
      probe: () => send({ type: 'probe' }),
    }),
    [pump, send],
  );

  useEffect(
    () => () => {
      deactivateKeepAwake('lutra-render').catch(() => {});
    },
    [],
  );

  return (
    <EngineContext.Provider value={api}>
      {children}
      {process.env.EXPO_OS === 'web' || NATIVE ? null : (
      <View pointerEvents="none" style={styles.host} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WebView
          ref={web}
          // An https origin makes the page a secure context, which WebCodecs requires.
          source={{ html: ENGINE_HTML, baseUrl: 'https://engine.lutra.app/' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          webviewDebuggingEnabled={__DEV__}
          onContentProcessDidTerminate={() => {
            useExports.getState().setEngineReady(false);
            if (running.current) {
              for (const rr of running.current.prepared.records) {
                useExports.getState().patchRecord(rr.id, { status: 'failed', error: tr().exports.engineKilled });
              }
              finishJob(false);
            }
            web.current?.reload();
          }}
          onRenderProcessGone={() => {
            useExports.getState().setEngineReady(false);
            if (running.current) finishJob(false);
            web.current?.reload();
          }}
          style={styles.web}
        />
      </View>
      )}
    </EngineContext.Provider>
  );
}

function exportedToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return useExports.getState().records.filter((r) => r.status === 'done' && (r.finishedAt ?? 0) >= start.getTime()).length;
}

function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

export async function saveToPhotos(uri: string): Promise<boolean> {
  try {
    const perm = await requestPermissionsAsync(true);
    if (!perm.granted) return false;
    const albumName = useSettings.getState().albumName || 'Lutra';
    const asset = await Asset.create(uri);
    try {
      const album = await Album.get(albumName);
      if (album) await album.add(asset);
      else await Album.create(albumName, [asset]);
    } catch {
      // The asset is already in the library; the album is a nicety.
    }
    return true;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 2, height: 2, left: 0, top: 0, opacity: 0.01, overflow: 'hidden' },
  web: { width: 2, height: 2, backgroundColor: 'transparent' },
});
