// A per-symbol age-partitioned cache shared by two edge functions:
// personal-stem (5-day return, a number) and ohlc (a year of daily candles,
// an array). Split out because the partition is where a bug would hide
// silently: get it wrong in one direction and the whole focus list is
// refetched on every request (the state this replaced), get it wrong in the
// other and a symbol is served from data that is days old.
export type SymCacheEntry<T> = { r: T; ts: number };
export type SymCacheMap<T> = Record<string, SymCacheEntry<T>>;

export function partitionByAge<T>(
  map: SymCacheMap<T>,
  symbols: string[],
  ttlMs: number,
  maxStaleMs: number,
  now = Date.now(),
  // Callers with a specific shape in mind (personal-stem: must be a number;
  // ohlc: must be a non-empty array) should pass a stricter check. The
  // default only rejects a genuinely missing value.
  isValid: (v: T) => boolean = (v) => v !== undefined && v !== null,
): { missing: string[]; stale: string[]; fresh: string[] } {
  const missing: string[] = [], stale: string[] = [], fresh: string[] = [];
  for (const s of symbols) {
    const e = map[s];
    // A malformed entry counts as missing, not as fresh: `now - undefined` is
    // NaN and every comparison against it is false, which would otherwise land
    // the symbol in `fresh` and serve a value that isn't there.
    if (!e || typeof e.ts !== 'number' || !isValid(e.r)) { missing.push(s); continue; }
    const age = now - e.ts;
    if (age > maxStaleMs) missing.push(s);
    else if (age > ttlMs) stale.push(s);
    else fresh.push(s);
  }
  return { missing, stale, fresh };
}

// Symbols leave focus lists, so the shared row would grow forever without this.
export function pruneMap<T>(map: SymCacheMap<T>, maxStaleMs: number, now = Date.now()): SymCacheMap<T> {
  const out: SymCacheMap<T> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v.ts === 'number' && now - v.ts <= maxStaleMs) out[k] = v;
  }
  return out;
}
