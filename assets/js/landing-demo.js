(() => {
  const video = document.getElementById('hero-video');
  const play = document.getElementById('demo-play');
  const enlarge = document.getElementById('demo-enlarge');
  const dialog = document.getElementById('demo-dialog');
  if (!video || !play || !enlarge || !dialog) return;
  const english = document.documentElement.lang === 'en';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => {
    play.textContent = video.paused ? (english ? 'Play demo' : 'הפעל הדגמה') : (english ? 'Pause demo' : 'עצור הדגמה');
    play.setAttribute('aria-pressed', String(!video.paused));
  };
  let inView = false, ready = false, userPaused = false;
  const tryPlay = () => { if (ready && inView && !userPaused && !motion.matches && !document.hidden && video.paused) video.play().catch(() => {}); };
  play.addEventListener('click', async () => {
    if (!video.paused) { userPaused = true; video.pause(); }
    else {
      userPaused = false;
      try { await video.play(); }
      catch { play.textContent = english ? 'Playback unavailable — try again' : 'הניגון לא זמין — נסה שוב'; }
    }
  });
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  document.addEventListener('visibilitychange', () => { if (document.hidden) video.pause(); else tryPlay(); });
  const observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (inView) tryPlay(); else video.pause(); });
  observer.observe(video);
  motion.addEventListener('change', () => { if (motion.matches) video.pause(); else tryPlay(); });
  const start = () => setTimeout(() => { ready = true; tryPlay(); }, 300);
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
  enlarge.addEventListener('click', () => { video.pause(); dialog.showModal(); });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { enlarge.focus(); tryPlay(); });
  sync();
})();
