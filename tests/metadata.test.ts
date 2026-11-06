import assert from 'node:assert/strict';
import { probeBuffer, probeContainer } from '../src/color/container';
import { identifyProfile } from '../src/color/identify';
import type { LogVerdict } from '../src/color/detect';

let failures = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', (e as Error).message); }
};

// --- tiny ISO-BMFF writer -------------------------------------------------
const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat();
  return [...be32(body.length + 8), ...enc(type), ...body];
};
const full = (type: string, ...parts: number[][]) => box(type, [0, 0, 0, 0], ...parts);

function videoEntry(codec: string, children: number[][], compressor = '') {
  const name = new Array(32).fill(0);
  name[0] = compressor.length;
  enc(compressor).forEach((c, i) => (name[i + 1] = c));
  const head = [...new Array(6).fill(0), ...be16(1), ...new Array(16).fill(0), ...be16(1920), ...be16(1080), ...be32(0x480000), ...be32(0x480000), ...be32(0), ...be16(1), ...name, ...be16(24), ...be16(0xffff)];
  return box(codec, head, ...children);
}
const colr = (p: number, t: number, m: number) => box('colr', enc('nclx'), be16(p), be16(t), be16(m), [0]);
const hvcC = (depth: number) => box('hvcC', [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, depth - 8, depth - 8, 0, 0, 0, 0]);

function movie(entry: number[], extra: number[][] = []) {
  const hdlr = full('hdlr', be32(0), enc('vide'), new Array(12).fill(0), [0]);
  const stsd = full('stsd', be32(1), entry);
  const trak = box('trak', box('mdia', hdlr, box('minf', box('stbl', stsd))));
  // An audio track first, so the parser must pick the video one.
  const audio = box('trak', box('mdia', full('hdlr', be32(0), enc('soun'), new Array(12).fill(0), [0]), box('minf', box('stbl', full('stsd', be32(1), box('mp4a', new Array(28).fill(0)))))));
  return new Uint8Array([...box('ftyp', enc('qt  '), be32(0)), ...box('mdat', new Array(64).fill(7)), ...box('moov', audio, trak, ...extra)]);
}

function mdta(pairs: [string, string][]) {
  const keys = full('keys', be32(pairs.length), ...pairs.map(([k]) => box('mdta', enc(k))));
  const ilst = box('ilst', ...pairs.map(([, v], i) => [...be32(8 + 16 + v.length), ...be32(i + 1), ...box('data', be32(1), be32(0), enc(v))]));
  return box('meta', box('hdlr', be32(0), be32(0), enc('mdta'), new Array(12).fill(0), [0]), keys, ilst);
}

const LOGGY: LogVerdict = { isLog: true, confidence: 0.7, stats: { p02: 0.1, p50: 0.4, p98: 0.7, meanSaturation: 0.1 } };
const FLAT_NO: LogVerdict = { isLog: false, confidence: 0.2, stats: { p02: 0, p50: 0.5, p98: 1, meanSaturation: 0.4 } };
const id = (buf: Uint8Array, verdict: LogVerdict | null = LOGGY, decoder = null) =>
  identifyProfile({ container: probeBuffer(buf), decoder, verdict, preferredLog: 'clog3' });

(async () => {
  await test('reads codec, bit depth and CICP of the video track', () => {
    const info = probeBuffer(movie(videoEntry('hvc1', [hvcC(10), colr(9, 18, 9)], 'HEVC')));
    assert.equal(info.codec, 'hvc1');
    assert.equal(info.bitDepth, 10);
    assert.deepEqual(info.cicp, { primaries: 9, transfer: 18, matrix: 9 });
    assert.equal(info.compressor, 'HEVC');
  });

  await test('HLG transfer tag → HLG from metadata, even if the frame looks flat', () => {
    const r = id(movie(videoEntry('hvc1', [colr(9, 18, 9)])), FLAT_NO);
    assert.equal(r.input, 'hlg');
    assert.equal(r.detection.source, 'metadata');
  });

  await test('Sony NRT XML: CaptureGammaEquation decides, model is reported', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><NonRealTimeMeta><Device manufacturer="Sony" modelName="ILCE-7SM3"/><AcquisitionRecord><Group name="CameraUnitMetadataSet"><Item name="CaptureGammaEquation" value="s-log3-cine"/><Item name="CaptureColorPrimaries" value="S-Gamut3.Cine"/></Group></AcquisitionRecord></NonRealTimeMeta>';
    const nrtm = full('meta', box('hdlr', be32(0), enc('nrtm'), new Array(12).fill(0), [0]), full('xml ', enc(xml), [0]));
    const buf = movie(videoEntry('avc1', [colr(1, 1, 1)]));
    const withXml = new Uint8Array([...buf, ...nrtm]);
    const r = id(withXml, FLAT_NO);
    assert.equal(r.input, 'slog3');
    assert.equal(r.detection.source, 'metadata');
    assert.match(r.detection.evidence ?? '', /s-log3-cine/);
    assert.equal(r.detection.camera, 'Sony ILCE-7SM3');
  });

  await test('Sony XML saying rec709 / S-Cinetone wins over a flat-looking frame', () => {
    for (const g of ['rec709', 's-cinetone']) {
      const xml = `<?xml version="1.0"?><NonRealTimeMeta><Device manufacturer="Sony" modelName="ILCE-7M4"/><Item name="CaptureGammaEquation" value="${g}"/></NonRealTimeMeta>`;
      const r = id(new Uint8Array([...movie(videoEntry('avc1', [])), ...full('meta', full('xml ', enc(xml)))]), LOGGY);
      assert.equal(r.input, 'rec709', g);
      assert.equal(r.detection.isLog, false);
    }
  });

  await test('Fujifilm MVTG maker note VideoRecordingMode → F-Log2', () => {
    // MakerNote: "FUJIFILM" + LE offset 12 + IFD { 0x3803: 0x30 }.
    const note = [...enc('FUJIFILM'), ...le32(12), ...le16(1), ...le16(0x3803), ...le16(4), ...le32(1), ...le32(0x30), ...le32(0)];
    // IFD0 { Make, ExifIFD } -> ExifIFD { MakerNote }; offsets relative to IFD0 start.
    const make = enc('FUJIFILM\0');
    const ifd0Size = 2 + 2 * 12 + 4;
    const makeAt = ifd0Size;
    const exifAt = makeAt + make.length;
    const exifSize = 2 + 12 + 4;
    const noteAt = exifAt + exifSize;
    const ifd0 = [...le16(2), ...le16(0x010f), ...le16(2), ...le32(make.length), ...le32(makeAt), ...le16(0x8769), ...le16(4), ...le32(1), ...le32(exifAt), ...le32(0)];
    const exif = [...le16(1), ...le16(0x927c), ...le16(7), ...le32(note.length), ...le32(noteAt), ...le32(0)];
    const mvtg = box('MVTG', new Array(16).fill(0), ifd0, make, exif, note);
    const r = id(movie(videoEntry('avc1', []), [box('udta', mvtg)]), FLAT_NO);
    assert.equal(r.input, 'flog2');
    assert.equal(r.detection.source, 'metadata');
    assert.match(r.detection.camera ?? '', /FUJIFILM/);
  });

  await test('Apple: BT.2020 without HLG transfer → Apple Log; Rec.709 tags → Rec.709', () => {
    const tags = mdta([['com.apple.quicktime.make', 'Apple'], ['com.apple.quicktime.model', 'iPhone 16 Pro']]);
    const log = id(movie(videoEntry('apch', [colr(9, 2, 9)]), [tags]), FLAT_NO);
    assert.equal(log.input, 'applelog');
    assert.equal(log.detection.source, 'metadata');
    assert.equal(log.detection.camera, 'Apple iPhone 16 Pro');
    const sdr = id(movie(videoEntry('hvc1', [colr(1, 1, 1)]), [tags]), LOGGY);
    assert.equal(sdr.input, 'rec709');
    const hdr = id(movie(videoEntry('hvc1', [colr(9, 18, 9)]), [tags]), LOGGY);
    assert.equal(hdr.input, 'hlg');
  });

  await test('decoder transfer function (Apple Log) is trusted', () => {
    const r = identifyProfile({ container: probeBuffer(movie(videoEntry('hvc1', []))), decoder: { transfer: 'applelog', primaries: '2020', bitDepth: 10 }, verdict: FLAT_NO, preferredLog: 'slog3' });
    assert.equal(r.input, 'applelog');
    assert.equal(r.detection.source, 'metadata');
  });

  await test('gamma-named tag from other vendors (e.g. Blackmagic/ARRI keys)', () => {
    const r = id(movie(videoEntry('apch', []), [mdta([['com.blackmagic-design.camera.gamma', 'Blackmagic Design Film'], ['com.apple.quicktime.make', 'Blackmagic Design']])]), FLAT_NO);
    assert.equal(r.input, 'bmdfilm5');
    const a = id(movie(videoEntry('apch', []), [mdta([['com.arri.camera.ColorGammaSxS', 'LOG-C'], ['com.apple.quicktime.model', 'ALEXA Mini']])]), FLAT_NO);
    assert.equal(a.input, 'logc3');
  });

  await test('free-text tags never decide (titles, comments)', () => {
    const r = id(movie(videoEntry('avc1', []), [mdta([['com.apple.quicktime.title', 'S-Log3'], ['com.apple.quicktime.comment', 'vlog']])]), FLAT_NO);
    assert.equal(r.detection.source, 'image');
    assert.equal(r.input, 'rec709');
  });

  await test('camera named but curve not: brand picks the log, frame decides log-or-not', () => {
    const udta = box('udta', box('©mak', be16(5), be16(0), enc('Canon')), box('©mod', be16(7), be16(0), enc('EOS R5C')));
    const yes = id(movie(videoEntry('avc1', []), [udta]), LOGGY);
    assert.equal(yes.input, 'clog3');
    assert.equal(yes.detection.source, 'camera');
    assert.equal(yes.detection.camera, 'Canon EOS R5C');
    const no = id(movie(videoEntry('avc1', []), [udta]), FLAT_NO);
    assert.equal(no.input, 'rec709');
    const gp = id(movie(videoEntry('hvc1', [], 'GoPro H.265 encoder')), LOGGY);
    assert.equal(gp.input, 'protune');
  });

  await test('nothing identifiable: frame + default log; the file name plays no part', () => {
    const r = id(movie(videoEntry('avc1', [])), LOGGY);
    assert.equal(r.input, 'clog3');
    assert.equal(r.detection.source, 'image');
  });

  await test('probeContainer reads only box headers + metadata (skips mdat)', async () => {
    const buf = movie(videoEntry('hvc1', [colr(9, 18, 9)]));
    let readBytes = 0;
    const info = await probeContainer({ size: buf.length, read: async (o, l) => { readBytes += l; return buf.subarray(o, o + l); } });
    assert.equal(info.cicp?.transfer, 18);
    assert.ok(readBytes < buf.length + 64, `read ${readBytes} of ${buf.length}`);
  });

  if (failures) {
    console.log(`\n${failures} failing`);
    process.exit(1);
  }
})();
