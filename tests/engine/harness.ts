/**
 * End-to-end test of the WebView render engine in headless Chromium.
 * Plays the role of the React Native host: serves byte-range reads from disk,
 * writes positioned chunks to the output files, collects progress events.
 *
 *   npx esbuild tests/engine/harness.ts --bundle --platform=node --outfile=<tmp>/h.cjs && node <tmp>/h.cjs <mediaDir>
 */
import { readFileSync, openSync, readSync, writeSync, closeSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bakeGradeTexture } from '../../src/color/bake';
import { DEFAULT_GRADE } from '../../src/color/grade';
import { bytesToBase64, identityLut, lutToTexture } from '../../src/color/lut';
import type { EngineEvent, RenderJob } from '../../src/engine/protocol';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright');

const media = process.argv[2];
const outDir = join(media, 'out');
mkdirSync(outDir, { recursive: true });
const html = readFileSync(join(process.cwd(), 'engine/dist-engine.html'), 'utf8');

const lutPayload = (tex: ReturnType<typeof lutToTexture>) => ({ size: tex.size, cols: tex.cols, width: tex.width, height: tex.height, b64: bytesToBase64(tex.bytes) });
const NOFX = { vignette: 0, grain: 0, grainSize: 1.5, sharpen: 0 };

async function main() {
  const browser = await chromium.launch({ args: ['--enable-features=WebCodecs', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const events: EngineEvent[] = [];
  const fds = new Map<string, number>();
  const outFds = new Map<number, number>();
  let resolveDone: (v: boolean) => void = () => {};
  let resolveCaps: (v: any) => void = () => {};
  let currentJob: RenderJob | null = null;
  const outPath = (i: number) => join(outDir, `${currentJob!.id}_${i}.${currentJob!.outputs.find((o) => o.index === i)!.container}`);

  const reply = (cmd: unknown) => page.evaluate((json: string) => (window as any).__lutraEngine.receive(json), JSON.stringify(cmd));

  await page.exposeFunction('__nodeSink', async (evt: EngineEvent) => {
    if (evt.type !== 'read' && evt.type !== 'write' && evt.type !== 'preview') events.push(evt);
    switch (evt.type) {
      case 'log': console.log('   [engine]', evt.message); break;
      case 'caps': resolveCaps(evt.caps); break;
      case 'read': {
        let fd = fds.get(evt.clipKey);
        if (fd === undefined) { fd = openSync(join(media, evt.clipKey), 'r'); fds.set(evt.clipKey, fd); }
        const buf = Buffer.alloc(evt.end - evt.start);
        const n = readSync(fd, buf, 0, buf.length, evt.start);
        await reply({ type: 'readResult', id: evt.id, b64: buf.subarray(0, n).toString('base64') });
        break;
      }
      case 'write': {
        let fd = outFds.get(evt.outIndex);
        if (fd === undefined) { fd = openSync(outPath(evt.outIndex), 'w'); outFds.set(evt.outIndex, fd); }
        const data = Buffer.from(evt.b64, 'base64');
        writeSync(fd, data, 0, data.length, evt.position);
        await reply({ type: 'writeAck', id: evt.id });
        break;
      }
      case 'outputError': console.log('   outputError', evt.outIndex, evt.message); break;
      case 'outputStart': console.log('   start', JSON.stringify(evt)); break;
      case 'outputDone': {
        const fd = outFds.get(evt.outIndex);
        if (fd !== undefined) { closeSync(fd); outFds.delete(evt.outIndex); }
        console.log('   done', JSON.stringify(evt));
        break;
      }
      case 'jobDone': resolveDone(evt.canceled); break;
    }
  });
  await page.addInitScript(() => { (window as any).__lutraTestSink = (e: unknown) => (window as any).__nodeSink(e); });
  page.on('console', (m: any) => console.log('   [console]', m.text()));
  page.on('pageerror', (e: any) => console.log('   [pageerror]', e.message));
  // WebCodecs needs a secure context — the app loads the page with an https baseUrl too.
  await page.route('https://engine.lutra.test/**', (r: any) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://engine.lutra.test/');

  const capsP = new Promise((r) => (resolveCaps = r));
  await reply({ type: 'probe' });
  const caps: any = await capsP;
  console.log('caps', JSON.stringify(caps.video), JSON.stringify(caps.audio), 'webgl', caps.webgl);

  const size = (f: string) => statSync(join(media, f)).size;
  const identity = lutPayload(lutToTexture(identityLut(17)));
  const graded = lutPayload(bakeGradeTexture('rec709', { ...DEFAULT_GRADE, lookId: 'classic-bw' }, 33, () => null));

  const run = async (job: RenderJob) => {
    currentJob = job;
    const p = new Promise<boolean>((r) => (resolveDone = r));
    const t0 = Date.now();
    await reply({ type: 'render', job });
    const canceled = await p;
    console.log(`job ${job.id} finished in ${Date.now() - t0} ms canceled=${canceled}`);
  };

  const videoCodec = caps.video.avc.hd ? 'avc' : 'vp9';
  const container = videoCodec === 'avc' ? 'mp4' : 'webm';

  // 1 · separate exports: 3 clips, different codecs/bit depth/rotation, B&W look on one.
  await run({
    id: 'separate',
    luts: { id: identity, bw: graded },
    outputs: [
      { index: 0, name: 'a', container, codec: videoCodec, aspect: 'original', resolution: 'source', fps: 'source', quality: 'medium', audio: true,
        segments: [{ clipKey: 'a_h264.mp4', clipSize: size('a_h264.mp4'), start: 0.5, end: 1.5, lutKey: 'bw', effects: NOFX, fadeIn: 0, fadeOut: 0 }] },
      { index: 1, name: 'b', container, codec: videoCodec, aspect: 'original', resolution: 'source', fps: 'source', quality: 'medium', audio: true,
        segments: [{ clipKey: 'b_vp9_10bit.webm', clipSize: size('b_vp9_10bit.webm'), start: 0, end: 1.6, lutKey: 'id', effects: NOFX, fadeIn: 0, fadeOut: 0 }] },
      { index: 2, name: 'c', container, codec: videoCodec, aspect: 'original', resolution: 'source', fps: 'source', quality: 'medium', audio: true,
        segments: [{ clipKey: 'c_rot90.mp4', clipSize: size('c_rot90.mp4'), start: 0, end: 1, lutKey: 'id', effects: NOFX, fadeIn: 0, fadeOut: 0 }] },
    ],
  });

  // 2 · merge into one 9:16 file at 30 fps with fades and a vignette.
  await run({
    id: 'merged',
    luts: { id: identity, bw: graded },
    outputs: [{
      index: 0, name: 'merged', container, codec: videoCodec, aspect: '9:16', resolution: '720', fps: 30, quality: 'high', audio: true,
      segments: [
        { clipKey: 'a_h264.mp4', clipSize: size('a_h264.mp4'), start: 0, end: 2, lutKey: 'id', effects: { ...NOFX, vignette: 60 }, fadeIn: 0, fadeOut: 0.3 },
        { clipKey: 'b_vp9_10bit.webm', clipSize: size('b_vp9_10bit.webm'), start: 0, end: 1.6, lutKey: 'bw', effects: NOFX, fadeIn: 0.3, fadeOut: 0 },
      ],
    }],
  });

  await browser.close();
  for (const f of ['separate_0', 'separate_1', 'separate_2', 'merged_0']) {
    const file = join(outDir, `${f}.${container}`);
    try {
      const info = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames,sample_rate:format=duration', '-of', 'compact', file]).toString().trim();
      console.log(f, '\n  ', info.replace(/\n/g, '\n   '));
    } catch (e) { console.log(f, 'PROBE FAILED', (e as Error).message); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
