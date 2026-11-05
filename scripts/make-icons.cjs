/**
 * Renders the app icon set from one vector source: a round "lens" split by an
 * S-shaped tone curve. Below the curve the frame is flat, washed-out log
 * footage; above it the same frame after the grade, in the violet accent
 * family. The curve itself is the grading gesture, with one control node.
 * Run: node scripts/make-icons.cjs
 */
const { chromium } = require('playwright');
const path = require('node:path');

const BG = '#0B0B0C';

let uid = 0;
const lens = ({ s = 1, mono = false, glow = false } = {}) => {
  const id = `l${uid++}`;
  const R = 330 * s;
  const cx = 512, cy = 512;
  // Map unit coords ([-1,1], y down) onto the lens.
  const P = (x, y) => `${(cx + x * R).toFixed(1)},${(cy + y * R).toFixed(1)}`;
  // Tone curve: toe at lower-left, shoulder at upper-right, overshooting the
  // circle so the clip gives clean edges.
  const curve = `M ${P(-1.2, 0.5)} C ${P(0.15, 0.98)} ${P(-0.15, -0.98)} ${P(1.2, -0.5)}`;
  const graded = `${curve} L ${P(1.3, -1.3)} L ${P(-1.3, -1.3)} Z`;
  const node = [cx, cy];
  const stroke = 26 * s;

  if (mono) {
    // Monochrome (Android themed icons): solid lens with the curve cut out.
    return `<defs><mask id="${id}m"><rect width="1024" height="1024" fill="#fff"/>` +
      `<path d="${curve}" fill="none" stroke="#000" stroke-width="${stroke * 1.4}" stroke-linecap="round"/>` +
      `<circle cx="${node[0]}" cy="${node[1]}" r="${38 * s}" fill="#000"/></mask></defs>` +
      `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff" mask="url(#${id}m)"/>`;
  }

  return `<defs>
    <clipPath id="${id}c"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
    <linearGradient id="${id}g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#5A3FE0"/>
      <stop offset="0.55" stop-color="#9B7BFF"/>
      <stop offset="1" stop-color="#E7A6FF"/>
    </linearGradient>
    <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6A6A72"/>
      <stop offset="1" stop-color="#3C3C42"/>
    </linearGradient>
    <radialGradient id="${id}h" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7B61FF" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#7B61FF" stop-opacity="0"/>
    </radialGradient>
  </defs>` +
    (glow ? `<circle cx="${cx}" cy="${cy}" r="${R * 1.45}" fill="url(#${id}h)"/>` : '') +
    `<g clip-path="url(#${id}c)">
      <rect x="0" y="0" width="1024" height="1024" fill="url(#${id}f)"/>
      <path d="${graded}" fill="url(#${id}g)"/>
    </g>` +
    `<path d="${curve}" fill="none" stroke="${BG}" stroke-opacity="0.35" stroke-width="${stroke + 14 * s}" stroke-linecap="round" clip-path="url(#${id}c)"/>` +
    `<path d="${curve}" fill="none" stroke="#FFFFFF" stroke-width="${stroke}" stroke-linecap="round" clip-path="url(#${id}c)"/>` +
    `<circle cx="${node[0]}" cy="${node[1]}" r="${36 * s}" fill="#FFFFFF" stroke="${BG}" stroke-opacity="0.35" stroke-width="${7 * s}"/>` +
    `<circle cx="${node[0]}" cy="${node[1]}" r="${14 * s}" fill="#6E56F8"/>`;
};
const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}${body}</svg>`;

const outputs = [
  ['assets/icon.png', svg(lens({ s: 1.0, glow: true }), BG), 1024],
  ['assets/android-icon-foreground.png', svg(lens({ s: 0.76 })), 1024],
  ['assets/android-icon-background.png', svg('', BG), 1024],
  ['assets/android-icon-monochrome.png', svg(lens({ s: 0.76, mono: true })), 1024],
  ['assets/splash-icon.png', svg(lens({ s: 1.2 })), 1024],
  ['assets/favicon.png', svg(lens({ s: 1.35 }), BG), 48],
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
