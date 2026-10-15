// US regular session is 9:30-16:15 ET (the extra 15 minutes let Yahoo finalize
// the daily bar). The two edges are the moments a daily-bar snapshot stops being
// the right one to show: a row taken before the open still holds yesterday as its
// newest bar, and one taken during the session holds a half-finished candle.
// Holidays are not modelled; one just costs an extra refetch.
const OPEN_MIN = 9 * 60 + 32, CLOSE_MIN = 16 * 60 + 15;
const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
});

function etParts(ms: number) {
  const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekend: p.weekday === 'Sat' || p.weekday === 'Sun', min: (+p.hour % 24) * 60 + +p.minute };
}

// The latest session edge (open, with two minutes of grace, or close) at or
// before `now`. A cached row refreshed before it describes the wrong session.
export function lastSessionBoundaryMs(now: number): number {
  const m = now - (now % 60000);
  let day = m - etParts(m).min * 60000;
  for (let i = 0; i < 8; i++, day -= 86400000) {
    if (etParts(day + 12 * 3600000).weekend) continue;
    for (const t of [day + CLOSE_MIN * 60000, day + OPEN_MIN * 60000]) if (t <= now) return t;
  }
  return 0;
}
