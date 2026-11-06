/**
 * Reads the colour-relevant metadata of a MOV/MP4 (ISO-BMFF / QuickTime)
 * file without decoding any video: codec, bit depth, CICP colour tags,
 * camera make/model, QuickTime/iTunes tags, vendor XML (Sony NRT) and the
 * vendor EXIF blocks some cameras embed (Fujifilm MVTG, Panasonic PANA).
 *
 * It only reads box headers plus the small metadata boxes, so a 40 GB ProRes
 * file on an external drive costs a few hundred KB of I/O.
 * Pure TS: runs in the app and in Node tests.
 */

export type ByteReader = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type Cicp = { primaries: number; transfer: number; matrix: number };

export type ContainerInfo = {
  codec: string | null;
  /** Compressor name from the sample entry, e.g. "Apple ProRes 422 HQ". */
  compressor: string | null;
  bitDepth: number | null;
  cicp: Cicp | null;
  make: string | null;
  model: string | null;
  software: string | null;
  /** Lowercased key -> value of every textual tag found (mdta keys, udta, XML items, EXIF). */
  tags: Record<string, string>;
};

const SKIP = new Set(['mdat', 'free', 'skip', 'wide', 'pnot', 'junk']);
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf', 'ilst', 'tapt']);
const VIDEO_ENTRIES = new Set([
  'avc1', 'avc3', 'hvc1', 'hev1', 'dvh1', 'dvhe', 'dva1', 'dvav', 'av01', 'vp09', 'mp4v',
  'apch', 'apcn', 'apcs', 'apco', 'ap4h', 'ap4x', 'aprh', 'aprn', 'jpeg', 'mjpa', 'mjpb', 'dvhp',
]);
const PRORES_DEPTH: Record<string, number> = { apch: 10, apcn: 10, apcs: 10, apco: 10, ap4h: 12, ap4x: 12, aprh: 12, aprn: 12 };

/** Biggest metadata box read whole; a long clip's `moov` (sample tables) can be several MB. */
const MAX_BOX = 48 * 1024 * 1024;

const latin1 = (b: Uint8Array, start = 0, end = b.length) => {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
};

function utf8(b: Uint8Array, start = 0, end = b.length) {
  const slice = b.subarray(start, end);
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(slice);
    } catch {}
  }
  return latin1(slice);
}

const clean = (s: string) => s.replace(/\0+$/g, '').replace(/[\0-\x08\x0b-\x1f]/g, '').trim();

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const type4 = (b: Uint8Array, o: number) => latin1(b, o, o + 4);

type Box = { type: string; start: number; header: number; end: number };

/** Children of `buf[from, to)`; tolerant of truncated tails. */
function* boxes(buf: Uint8Array, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(buf, o);
    const type = type4(buf, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) return;
      size = u32(buf, o + 8) * 2 ** 32 + u32(buf, o + 12);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header) return;
    const end = Math.min(to, o + size);
    yield { type, start: o, header, end };
    o += size;
  }
}

export async function probeContainer(reader: ByteReader): Promise<ContainerInfo> {
  const info: ContainerInfo = { codec: null, compressor: null, bitDepth: null, cicp: null, make: null, model: null, software: null, tags: {} };
  let offset = 0;
  let guard = 0;
  while (offset + 8 <= reader.size && guard++ < 4096) {
    const head = await reader.read(offset, 16);
    if (head.length < 8) break;
    let size = u32(head, 0);
    const type = type4(head, 4);
    let header = 8;
    if (size === 1 && head.length >= 16) {
      size = u32(head, 8) * 2 ** 32 + u32(head, 12);
      header = 16;
    } else if (size === 0) size = reader.size - offset;
    if (size < header || !/^[\x20-\x7e\xa9]{4}$/.test(type)) break;
    if (!SKIP.has(type)) {
      const len = Math.min(size, MAX_BOX, reader.size - offset);
      const buf = await reader.read(offset, len);
      parseBox(buf, { type, start: 0, header, end: buf.length }, info, false);
    }
    offset += size;
  }
  finalize(info);
  return info;
}

/** Parses an in-memory file (tests, small files). */
export function probeBuffer(buf: Uint8Array): ContainerInfo {
  const info: ContainerInfo = { codec: null, compressor: null, bitDepth: null, cicp: null, make: null, model: null, software: null, tags: {} };
  for (const b of boxes(buf, 0, buf.length)) if (!SKIP.has(b.type)) parseBox(buf, b, info, false);
  finalize(info);
  return info;
}

function finalize(info: ContainerInfo) {
  const t = info.tags;
  info.make ??= t['com.apple.quicktime.make'] ?? t['com.android.manufacturer'] ?? t['make'] ?? t['device.manufacturer'] ?? null;
  info.model ??= t['com.apple.quicktime.model'] ?? t['com.android.model'] ?? t['model'] ?? t['device.modelname'] ?? null;
  info.software ??= t['com.apple.quicktime.software'] ?? t['software'] ?? t['©swr'] ?? t['©too'] ?? null;
}

function setTag(info: ContainerInfo, key: string, value: string) {
  const v = clean(value);
  if (!v || v.length > 512) return;
  const k = key.toLowerCase();
  if (!(k in info.tags)) info.tags[k] = v;
}

function parseBox(buf: Uint8Array, box: Box, info: ContainerInfo, inVideo: boolean) {
  const body = box.start + box.header;
  const { type, end } = box;

  if (type === 'trak') {
    // Only the video track's sample entry matters; find its handler first.
    const isVideo = findHandler(buf, body, end) === 'vide';
    for (const c of boxes(buf, body, end)) parseBox(buf, c, info, isVideo);
    return;
  }
  if (CONTAINERS.has(type)) {
    for (const c of boxes(buf, body, end)) parseBox(buf, c, info, inVideo);
    return;
  }
  if (type === 'meta') return parseMeta(buf, body, end, info);
  if (type === 'stsd') {
    if (!inVideo) return;
    for (const e of boxes(buf, body + 8, end)) parseSampleEntry(buf, e, info);
    return;
  }
  if (type === 'uuid' || type === 'xml ' || type === 'XMP_') return scanXml(buf, body, end, info);
  if (type === 'MVTG') return parseTiff(buf, body + 16, end, info, true, body + 16);
  if (type === 'PANA' || type === 'LEIC') return parsePana(buf, body, end, info);
  if (type.charCodeAt(0) === 0xa9) {
    // QuickTime international text: [u16 len][u16 lang][text]...; iTunes style has a 'data' child.
    const txt = readUdtaText(buf, body, end);
    if (txt) {
      const key = type === '©mak' ? 'make' : type === '©mod' ? 'model' : type === '©swr' ? 'software' : type;
      setTag(info, key, txt);
    }
    return;
  }
  if (type === 'FIRM' || type === 'LENS' || type === 'CAME' || type === 'manu' || type === 'modl') {
    setTag(info, type, latin1(buf, body, end));
  }
}

function findHandler(buf: Uint8Array, from: number, to: number): string | null {
  for (const b of boxes(buf, from, to)) {
    if (b.type === 'mdia') return findHandler(buf, b.start + b.header, b.end);
    if (b.type === 'hdlr') return type4(buf, b.start + b.header + 8);
  }
  return null;
}

function readUdtaText(buf: Uint8Array, body: number, end: number): string | null {
  if (end - body >= 16 && type4(buf, body + 4) === 'data') return utf8(buf, body + 16, Math.min(end, body + u32(buf, body)));
  if (end - body < 4) return null;
  const len = u16(buf, body);
  if (len > 0 && body + 4 + len <= end) return utf8(buf, body + 4, body + 4 + len);
  return utf8(buf, body, end);
}

function parseSampleEntry(buf: Uint8Array, e: Box, info: ContainerInfo) {
  if (!VIDEO_ENTRIES.has(e.type) || info.codec) return;
  info.codec = e.type;
  const p = e.start + e.header;
  // VisualSampleEntry: 6 reserved, 2 dref, 16 pre-defined/version/vendor/quality,
  // 4 w/h, 8 resolution, 4 data size, 2 frame count, 32 compressor, 2 depth, 2 colour table.
  if (p + 78 > e.end) return;
  const nameLen = buf[p + 42];
  if (nameLen > 0 && nameLen < 32) info.compressor = clean(latin1(buf, p + 43, p + 43 + nameLen)) || null;
  if (PRORES_DEPTH[e.type]) info.bitDepth = PRORES_DEPTH[e.type];
  for (const c of boxes(buf, p + 78, e.end)) {
    const b = c.start + c.header;
    if (c.type === 'colr' && c.end - b >= 10) {
      const kind = type4(buf, b);
      if (kind === 'nclx' || kind === 'nclc') info.cicp = { primaries: u16(buf, b + 4), transfer: u16(buf, b + 6), matrix: u16(buf, b + 8) };
    } else if (c.type === 'hvcC' && c.end - b > 18) {
      info.bitDepth = (buf[b + 17] & 7) + 8;
    } else if (c.type === 'avcC' && c.end - b > 1) {
      const profile = buf[b + 1];
      info.bitDepth ??= profile === 110 || profile === 122 || profile === 244 ? 10 : 8;
    } else if (c.type === 'av1C' && c.end - b > 2) {
      const f = buf[b + 2];
      info.bitDepth = f & 0x40 ? (f & 0x20 ? 12 : 10) : 8;
    } else if (c.type === 'vpcC' && c.end - b > 6) {
      info.bitDepth = buf[b + 6] >> 4;
      if (c.end - b > 10) info.cicp ??= { primaries: buf[b + 7], transfer: buf[b + 8], matrix: buf[b + 9] };
    }
  }
}

/** `meta`: ISO full box (with handler) or QuickTime atom (no version field). */
function parseMeta(buf: Uint8Array, body: number, end: number, info: ContainerInfo) {
  let p = body;
  if (end - p >= 12 && type4(buf, p + 4) !== 'hdlr' && u32(buf, p) === 0) p += 4;
  let keys: string[] = [];
  for (const c of boxes(buf, p, end)) {
    const b = c.start + c.header;
    if (c.type === 'keys') {
      keys = [];
      const count = u32(buf, b + 4);
      let o = b + 8;
      for (let i = 0; i < count && o + 8 <= c.end; i++) {
        const size = u32(buf, o);
        if (size < 8) break;
        keys.push(utf8(buf, o + 8, Math.min(c.end, o + size)));
        o += size;
      }
    } else if (c.type === 'ilst') {
      for (const item of boxes(buf, b, c.end)) {
        const idx = u32(buf, item.start + 4);
        const name = keys.length && idx >= 1 && idx <= keys.length ? keys[idx - 1] : type4(buf, item.start + 4);
        for (const d of boxes(buf, item.start + item.header, item.end)) {
          if (d.type !== 'data') continue;
          const db = d.start + d.header;
          const dtype = u32(buf, db) & 0xffffff;
          // 1 UTF-8, 2 UTF-16, 4/5 legacy text; numbers are kept as decimal strings.
          if (dtype === 1 || dtype === 4 || dtype === 5) setTag(info, name, utf8(buf, db + 8, d.end));
          else if (dtype === 21 || dtype === 22) {
            let v = 0;
            for (let i = db + 8; i < d.end && i < db + 16; i++) v = v * 256 + buf[i];
            setTag(info, name, String(v));
          }
          break;
        }
      }
    } else if (c.type === 'xml ' || c.type === 'XMP_') {
      scanXml(buf, b, c.end, info);
    }
  }
  // Sony keeps its NonRealTimeMeta XML in a 'meta' with handler 'nrtm'; scan anything left.
  scanXml(buf, p, end, info);
}

function scanXml(buf: Uint8Array, from: number, to: number, info: ContainerInfo) {
  // Find '<' followed by a letter or '?', then decode the text run.
  let start = -1;
  for (let i = from; i < to - 5; i++) {
    if (buf[i] === 0x3c && (buf[i + 1] === 0x3f || (buf[i + 1] | 0x20) >= 0x61)) {
      const head = latin1(buf, i, Math.min(to, i + 6));
      if (head.startsWith('<?xml') || head.startsWith('<NonRe') || head.startsWith('<x:xmp') || head.startsWith('<rdf:')) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return;
  let stop = start;
  while (stop < to && buf[stop] !== 0) stop++;
  parseXmlText(utf8(buf, start, stop), info);
}

/** Pulls `name/value` pairs out of XML: `<Item name="X" value="Y"/>`, `<X value="Y"/>`, attributes, `<X>Y</X>`. */
export function parseXmlText(xml: string, info: ContainerInfo) {
  const itemRe = /<(\w[\w:.-]*)\s+([^>]*?)\/?>/g;
  const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const el = m[1];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
    if (attrs.name && attrs.value !== undefined) setTag(info, attrs.name, attrs.value);
    else if (attrs.value !== undefined) setTag(info, el, attrs.value);
    for (const [k, v] of Object.entries(attrs)) if (k !== 'name' && k !== 'value') setTag(info, `${el}.${k}`, v);
  }
  const textRe = /<([\w:.-]+)>([^<]{1,200})<\/\1>/g;
  while ((m = textRe.exec(xml))) setTag(info, m[1], m[2]);
}

// ---------------------------------------------------------------------------
// TIFF/EXIF (Fujifilm MVTG, Panasonic PANA)

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

function parseTiff(buf: Uint8Array, ifdStart: number, end: number, info: ContainerInfo, littleEndian: boolean, base: number) {
  readIfd(buf, ifdStart, end, info, littleEndian, base, 0, '');
}

function readIfd(buf: Uint8Array, at: number, end: number, info: ContainerInfo, le: boolean, base: number, depth: number, prefix: string) {
  if (depth > 3 || at < 0 || at + 2 > end) return;
  const r16 = (o: number) => (le ? buf[o] | (buf[o + 1] << 8) : u16(buf, o));
  const r32 = (o: number) => (le ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) + buf[o + 3] * 0x1000000 : u32(buf, o));
  const count = r16(at);
  if (count > 1000) return;
  for (let i = 0; i < count; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > end) return;
    const tag = r16(e);
    const typ = r16(e + 2);
    const n = r32(e + 4);
    const size = (TYPE_SIZE[typ] ?? 1) * n;
    const valAt = size <= 4 ? e + 8 : base + r32(e + 8);
    if (valAt < 0 || valAt + size > end) continue;
    const key = `${prefix}0x${tag.toString(16).padStart(4, '0')}`;
    if (tag === 0x8769) {
      readIfd(buf, base + r32(e + 8), end, info, le, base, depth + 1, prefix);
    } else if (tag === 0x927c) {
      parseMakerNote(buf, valAt, end, info, le, base, depth);
    } else if (typ === 2) {
      setTag(info, key, latin1(buf, valAt, valAt + size));
      if (tag === 0x010f && !prefix) info.make ??= clean(latin1(buf, valAt, valAt + size)) || null;
      if (tag === 0x0110 && !prefix) info.model ??= clean(latin1(buf, valAt, valAt + size)) || null;
    } else if (typ === 3 || typ === 8) {
      setTag(info, key, String(r16(valAt)));
    } else if (typ === 4 || typ === 9) {
      setTag(info, key, String(r32(valAt)));
    } else if (typ === 1 || typ === 7) {
      if (n <= 4) setTag(info, key, String(buf[valAt]));
    }
  }
}

function parseMakerNote(buf: Uint8Array, at: number, end: number, info: ContainerInfo, le: boolean, base: number, depth: number) {
  const head = latin1(buf, at, Math.min(end, at + 12));
  if (head.startsWith('FUJIFILM')) {
    // Always little-endian; IFD offset and value offsets relative to the note.
    const off = buf[at + 8] | (buf[at + 9] << 8) | (buf[at + 10] << 16) | (buf[at + 11] << 24);
    readIfd(buf, at + off, end, info, true, at, depth + 1, 'fuji.');
  } else if (head.startsWith('Panasonic')) {
    readIfd(buf, at + 12, end, info, le, base, depth + 1, 'panasonic.');
  }
}

function parsePana(buf: Uint8Array, body: number, end: number, info: ContainerInfo) {
  const make = clean(latin1(buf, body, Math.min(end, body + 22)));
  if (/^(LEICA|Panasonic)/.test(make)) info.make ??= make;
  // An embedded JPEG with EXIF (and the Panasonic maker note) follows the header.
  for (let i = body; i < Math.min(end - 10, body + 4096); i++) {
    if (buf[i] === 0x45 && latin1(buf, i, i + 6) === 'Exif\0\0') {
      const tiff = i + 6;
      const le = buf[tiff] === 0x49;
      const r32 = (o: number) => (le ? buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24) : u32(buf, o));
      info.make ??= 'Panasonic';
      readIfd(buf, tiff + r32(tiff + 4), end, info, le, tiff, 0, '');
      return;
    }
  }
}
