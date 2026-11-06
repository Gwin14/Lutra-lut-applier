// Runs the pure-TS colour-science tests; `--engine` also runs the WebView
// engine end-to-end in headless Chromium (needs ffmpeg + Playwright).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'lutra-tests-'));
const run = async (entry, args = [], external = []) => {
  const out = join(tmp, entry.replace(/\W+/g, '_') + '.cjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', outfile: out, logLevel: 'warning', external });
  execFileSync('node', [out, ...args], { stdio: 'inherit' });
};

await run('tests/color.test.ts');
await run('tests/metadata.test.ts');

if (process.argv.includes('--engine')) {
  const media = join(tmp, 'media');
  mkdirSync(media);
  const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { cwd: media });
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'a_h264.mp4']);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '1.6', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p10le', '-b:v', '1M', '-c:a', 'libopus', '-shortest', 'b_vp9_10bit.webm']);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'tmp.mp4']);
  ff(['-display_rotation', '90', '-i', 'tmp.mp4', '-c', 'copy', 'c_rot90.mp4']);
  execFileSync('node', ['scripts/build-engine.mjs'], { stdio: 'inherit' });
  await run('tests/engine/harness.ts', [media], ['playwright']);
}
