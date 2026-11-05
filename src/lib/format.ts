const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i >= 2 ? nf1.format(v) : Math.round(v)} ${units[i]}`;
}

/** 0:07, 1:05, 1:02:09 */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 0:07.4 — for the scrubber. */
export function formatTimecode(seconds: number) {
  const tenths = Math.floor((seconds * 10) % 10);
  return `${formatDuration(seconds)}.${tenths}`;
}

export function formatResolution(w: number, h: number) {
  const short = Math.min(w, h);
  if (short >= 2100) return '4K';
  if (short >= 1400) return '1440p';
  if (short >= 1060) return '1080p';
  if (short >= 700) return '720p';
  return `${short}p`;
}

export function formatFps(fps: number) {
  return `${nf1.format(fps)} fps`;
}

export function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'ontem' : `há ${d} dias`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'calculando…';
  if (seconds < 60) return `${Math.ceil(seconds)} s restantes`;
  const m = Math.ceil(seconds / 60);
  return `${m} min restantes`;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function sanitizeFilename(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'lutra'
  );
}
