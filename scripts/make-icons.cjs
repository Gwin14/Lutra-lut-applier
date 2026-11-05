/**
 * Renders the app icon set from one vector source: an isometric "LUT cube"
 * (a 3D LUT is literally a colour cube) with flat faces in the amber accent
 * family on the editor's neutral background. Run: node scripts/make-icons.cjs
 */
const { chromium } = require('playwright');
const path = require('node:path');

const BG = '#0B0B0C';
const cube = ({ s = 1, mono = false, lattice = false } = {}) => {
  // Isometric cube centred at 512,512, edge length 300*s.
  const r = 300 * s;
  const cx = 512, cy = 512;
  const dx = r * Math.cos(Math.PI / 6), dy = r / 2;
  const top = [[cx, cy - r], [cx + dx, cy - dy], [cx, cy], [cx - dx, cy - dy]];
  const left = [[cx - dx, cy - dy], [cx, cy], [cx, cy + r], [cx - dx, cy + dy]];
  const right = [[cx, cy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx, cy + r]];
  const poly = (p, fill) => `<polygon points="${p.map((q) => q.join(',')).join(' ')}" fill="${fill}"/>`;
  const f = mono ? ['#FFFFFF', '#FFFFFF', '#FFFFFF'] : ['#FFB23F', '#B86A0C', '#6B3C06'];
  let grid = '';
  if (lattice && !mono) {
    // Lattice lines hint at LUT nodes (3x3 per face).
    const line = (a, b) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${BG}" stroke-opacity="0.28" stroke-width="${6 * s}"/>`;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const face of [top, left, right]) {
      for (const t of [1 / 3, 2 / 3]) {
        grid += line(lerp(face[0], face[1], t), lerp(face[3], face[2], t));
        grid += line(lerp(face[0], face[3], t), lerp(face[1], face[2], t));
      }
    }
  }
  const edge = mono ? '' : `<polyline points="${[[cx - dx, cy - dy], [cx, cy], [cx + dx, cy - dy]].map((q) => q.join(',')).join(' ')}" fill="none" stroke="${BG}" stroke-width="${10 * s}"/><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + r}" stroke="${BG}" stroke-width="${10 * s}"/>`;
  return poly(top, f[0]) + poly(left, f[1]) + poly(right, f[2]) + grid + edge;
};
const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${body}</svg>`;

const outputs = [
  ['assets/icon.png', svg(cube({ s: 1.05 }), BG), 1024],
  ['assets/android-icon-foreground.png', svg(cube({ s: 0.72 })), 1024],
  ['assets/android-icon-background.png', svg('', BG), 1024],
  ['assets/android-icon-monochrome.png', svg(cube({ s: 0.72, mono: true })), 1024],
  ['assets/splash-icon.png', svg(cube({ s: 1.2 })), 1024],
  ['assets/favicon.png', svg(cube({ s: 1.25, lattice: false }), BG), 48],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const [file, markup, size] of outputs) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
    const buf = await page.locator('svg').screenshot({ omitBackground: true });
    if (size !== 1024) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/png;base64,${buf.toString('base64')}" width="${size}" height="${size}"></body></html>`);
      await page.locator('img').screenshot({ path: path.join(__dirname, '..', file), omitBackground: true });
      await page.setViewportSize({ width: 1024, height: 1024 });
    } else {
      require('node:fs').writeFileSync(path.join(__dirname, '..', file), buf);
    }
    console.log('wrote', file);
  }
  await browser.close();
})();
