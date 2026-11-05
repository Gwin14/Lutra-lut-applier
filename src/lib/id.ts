let counter = 0;

/** Short, sortable, collision-resistant id (no native crypto needed). */
export function uid() {
  counter = (counter + 1) % 1296;
  return Date.now().toString(36) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 7);
}

/** Stable small hash for cache keys. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
