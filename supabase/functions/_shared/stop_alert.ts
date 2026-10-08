// The stop shown in the investments table is 8% under the entry price. The same
// number is computed in assets/js/investments.js (INV_STOP_FACTOR); change both.
export const STOP_FACTOR = 0.92;

export type Holding = { symbol: string; entry_price: number | null };

export function stopPrice(entry: number | null | undefined): number | null {
  return typeof entry === 'number' && entry > 0 ? entry * STOP_FACTOR : null;
}

export function isStopHit(price: number | null | undefined, entry: number | null | undefined): boolean {
  const stop = stopPrice(entry);
  return stop !== null && typeof price === 'number' && price > 0 && price <= stop;
}

// `alerted` is the set of symbols already messaged and not yet recovered.
// Returns who to message now, and who has recovered above the stop (to re-arm).
// A symbol whose price could not be fetched is left exactly as it was.
export function planStopAlerts(
  holdings: Holding[],
  prices: Map<string, number>,
  alerted: Set<string>,
): { fire: { symbol: string; price: number; stop: number }[]; rearm: string[] } {
  const hitBySymbol = new Map<string, { price: number; stop: number }>();
  const known = new Set<string>();
  for (const h of holdings) {
    const price = prices.get(h.symbol);
    if (price === undefined) continue;
    known.add(h.symbol);
    if (isStopHit(price, h.entry_price)) {
      const stop = stopPrice(h.entry_price)!;
      const prev = hitBySymbol.get(h.symbol);
      if (!prev || stop > prev.stop) hitBySymbol.set(h.symbol, { price, stop });
    }
  }
  const fire = [...hitBySymbol].filter(([s]) => !alerted.has(s)).map(([symbol, v]) => ({ symbol, ...v }));
  const rearm = [...alerted].filter(s => known.has(s) && !hitBySymbol.has(s));
  return { fire, rearm };
}

export function buildStopMessage(fire: { symbol: string; price: number; stop: number }[]): string {
  const lines = fire.map(f => `• ${f.symbol} — מחיר $${f.price.toFixed(2)}, סטופ $${f.stop.toFixed(2)}`);
  return `🛑 הגעת לסטופ בהשקעות:\n${lines.join('\n')}`;
}
