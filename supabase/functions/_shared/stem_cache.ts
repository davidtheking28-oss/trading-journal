// The per-symbol side of the personal STEM cache. Split out of the handler
// because the partition is where a bug would hide silently: get it wrong in one
// direction and the whole focus list is refetched on every request (the state
// this replaced), get it wrong in the other and a symbol is served from a bar
// that is days old.
export type StemEntry = { r: number; ts: number };
export type StemMap = Record<string, StemEntry>;

export function partitionByAge(
  map: StemMap, symbols: string[], ttlMs: number, maxStaleMs: number, now = Date.now(),
): { missing: string[]; stale: string[]; fresh: string[] } {
  const missing: string[] = [], stale: string[] = [], fresh: string[] = [];
  for (const s of symbols) {
    const e = map[s];
    // A malformed entry counts as missing, not as fresh: `now - undefined` is
    // NaN and every comparison against it is false, which would otherwise land
    // the symbol in `fresh` and serve a value that isn't there.
    if (!e || typeof e.r !== 'number' || typeof e.ts !== 'number') { missing.push(s); continue; }
    const age = now - e.ts;
    if (age > maxStaleMs) missing.push(s);
    else if (age > ttlMs) stale.push(s);
    else fresh.push(s);
  }
  return { missing, stale, fresh };
}

// Symbols leave focus lists, so the shared row would grow forever without this.
export function pruneMap(map: StemMap, maxStaleMs: number, now = Date.now()): StemMap {
  const out: StemMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v.ts === 'number' && now - v.ts <= maxStaleMs) out[k] = v;
  }
  return out;
}
