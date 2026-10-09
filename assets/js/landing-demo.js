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
  play.addEventListener('click', async () => {
    if (!video.paused) video.pause();
    else {
      try { await video.play(); }
      catch { play.textContent = english ? 'Playback unavailable — try again' : 'הניגון לא זמין — נסה שוב'; }
    }
  });
  video.addEventListener('play', sync);
  video.addEventListener('pause', sync);
  document.addEventListener('visibilitychange', () => { if (document.hidden) video.pause(); });
  const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) video.pause(); });
  observer.observe(video);
  motion.addEventListener('change', () => { if (motion.matches) video.pause(); });
  enlarge.addEventListener('click', () => { video.pause(); dialog.showModal(); });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => enlarge.focus());
  sync();
})();
