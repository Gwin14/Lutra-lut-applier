/**
 * Visual pass on the web build (react-native-web + CanvasKit) in headless
 * Chromium at iPhone size. Seeds persisted stores, then captures each screen
 * in light and dark. Usage: node tests/visual/screens.cjs <distDir> <outDir>
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const [dist, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dist, 'index.html');
  const data = fs.readFileSync(p);
  const range = req.headers.range;
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-').map(Number);
    const end = e || data.length - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${s}-${end}/${data.length}`, 'Content-Length': end - s + 1 });
    return res.end(data.subarray(s, end + 1));
  }
  res.end(data);
});

const now = Date.now();
const adjust = { exposure: 0, temperature: 0, tint: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, shadowHue: 200, shadowAmount: 0, highlightHue: 40, highlightAmount: 0, fade: 0 };
const effects = { vignette: 0, grain: 0, grainSize: 1.5, sharpen: 0 };
const clip = (id, file, name, input, dur) => ({ id, uri: `/dev/${file}.mp4`, name, duration: dur, width: 1280, height: 720, size: 220000, thumb: `/dev/${file}-thumb.jpg`, input, detection: { isLog: true, confidence: 0.86 }, trim: { start: 0, end: dur }, grade: null });
const projects = [
  { id: 'demo1', name: 'Viagem Lisboa', createdAt: now - 3600e3, updatedAt: now - 120e3, linked: true, aspect: 'original',
    clips: [clip('c1', 'clip', 'C0012.MP4', 'slog3', 6), clip('c2', 'clip2', 'C0013.MP4', 'slog3', 4), clip('c3', 'clip', 'IMG_4410.MOV', 'applelog', 6)],
    grade: { lookId: 'teal-orange', lookStrength: 85, adjust: { ...adjust, contrast: 12, vibrance: 10 }, effects: { ...effects, vignette: 25 } } },
  { id: 'demo2', name: 'Ensaio estúdio', createdAt: now - 86400e3 * 2, updatedAt: now - 86400e3, linked: true, aspect: '9:16',
    clips: [clip('d1', 'clip2', 'DJI_0042.MP4', 'dlog', 4)], grade: { lookId: 'golden-hour', lookStrength: 100, adjust, effects } },
];
const rec = (id, name, look, w, h, dur, size, codec, ago, saved) => ({ id, jobId: 'j', projectId: 'demo1', name, uri: '/dev/clip.mp4', container: 'mp4', codec, lookName: look, status: 'done', progress: 1, width: w, height: h, fps: 30, frames: dur * 30, duration: dur, size, thumb: '/dev/clip-thumb.jpg', savedToPhotos: saved, error: null, createdAt: now - ago, finishedAt: now - ago });
const records = [
  rec('r1', 'Viagem Lisboa Teal & Laranja', 'Teal & Laranja', 3840, 2160, 16, 186e6, 'hevc', 300e3, true),
  rec('r2', 'C0012 Teal & Laranja', 'Teal & Laranja', 1920, 1080, 6, 14.2e6, 'avc', 3600e3, true),
  { ...rec('r3', 'DJI_0042 Hora Dourada', 'Hora Dourada', 1080, 1920, 4, 0, 'avc', 86400e3, false), status: 'failed', error: 'Nenhum codec de vídeo disponível para MOV em 3840×2160.' },
];

const seed = (theme) => ({
  'lutra.projects': JSON.stringify({ state: { projects }, version: 1 }),
  'lutra.exports': JSON.stringify({ state: { records }, version: 1 }),
  'lutra.library': JSON.stringify({ state: { userLuts: [], favorites: ['teal-orange', 'nordic'], recipes: [], recentLooks: [] }, version: 1 }),
  'lutra.settings': JSON.stringify({ state: { theme, haptics: true, autoDetectLog: true, preferredLog: 'slog3', previewQuality: 'balanced', saveToPhotos: true, albumName: 'Lutra', exportPreset: { mode: 'separate', container: 'mp4', codec: 'avc', resolution: 'source', fps: 'source', quality: 'high', audio: true, transition: 'cut', fadeEnds: false, lutPrecision: 65 }, defaultAspect: 'original' }, version: 1 }),
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const shots = (process.env.SHOTS || 'studio,looks,exports,settings,editor,export,look').split(',');
  const routes = { studio: '/', looks: '/looks', exports: '/exports', settings: '/settings', editor: '/project/demo1', export: '/export/demo1', look: '/look/teal-orange' };
  for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, isMobile: true, hasTouch: true });
    const s = seed(theme);
    await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, s);
    for (const name of shots) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(base + routes[name], { waitUntil: 'networkidle' });
      await page.waitForTimeout(name === 'editor' || name === 'look' || name === 'looks' ? 4500 : 2000);
      if (process.env.TOOL && name === 'editor') {
        await page.getByRole('tab', { name: process.env.TOOL }).click().catch(() => {});
        await page.waitForTimeout(2500);
      }
      const file = path.join(out, `${name}${process.env.TOOL && name === 'editor' ? '-' + process.env.TOOL : ''}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file, errors.length ? `errors: ${errors.slice(0, 3).join(' | ').slice(0, 400)}` : 'ok');
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
