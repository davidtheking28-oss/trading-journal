(async function initApp() {
  // Returning from another page (e.g. the marketing site) always does a full
  // navigation — that part can't change without turning this into an SPA. But
  // flashing the login screen on every arrival, even for an already-signed-in
  // user, made it feel like a full logout+reload each time. getSession() below
  // resolves near-instantly for a cached session (local read, no network round
  // trip unless the token is near expiry) — so peek localStorage synchronously
  // for the likely session key first, and only show the auth overlay if a
  // session doesn't look present. Genuinely logged-out users still see it
  // immediately, same as before.
  const _sessionKey = 'sb-' + SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0] + '-auth-token';
  const _likelySignedIn = !!localStorage.getItem(_sessionKey);
  if (!_likelySignedIn) document.getElementById('auth-overlay').style.display = 'flex';

  // Always-on initializations (don't need auth)
  qaInit();
  initTabletTableHints();
  setTableDensity(localStorage.getItem('tj-table-density'));
  initMediaDB().catch(e => console.warn('[Screenshots] IndexedDB init failed:', e));
  ttScheduleMidnight();

  // Check for an existing Supabase session (persisted from last visit)
  const { data: { session } } = await _sb.auth.getSession();
  // The localStorage guess was wrong (stale/corrupt token) — fall back to the
  // overlay now instead of leaving the user staring at a blank shell.
  if (!session?.user && _likelySignedIn) document.getElementById('auth-overlay').style.display = 'flex';
  if (session?.user) {
    _currentSession = session;
    await _onAuthSuccess(session.user);
    _sendSessionToScreener();
  }
  // else auth overlay stays visible

  // Listen for future auth state changes (sign in / sign out / token refresh)
  _sb.auth.onAuthStateChange(async (event, session) => {
    if (session) _currentSession = session;
    if (event === 'SIGNED_IN' && !_currentUser && session?.user) {
      await _onAuthSuccess(session.user);
    }
    if (event === 'TOKEN_REFRESHED' && session) {
      _currentSession = session;
    }
    if (session) _sendSessionToScreener();
    // A password-reset email link lands here as its own event, not SIGNED_IN —
    // Supabase's client establishes the session automatically either way, but
    // without this the user was dropped straight into the dashboard with no
    // indication the reset link ever did anything: the old password stayed the
    // password, since nothing ever asked for a new one.
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      if (!_currentUser) await _onAuthSuccess(session.user);
      const settingsBtn = document.querySelector('.tab-btn[aria-label="Settings"]');
      switchTab('ibkr', settingsBtn);
      toast('הקישור אימת אותך — הזן סיסמה חדשה למטה', 'info');
      document.getElementById('pw-new')?.focus();
    }
    if (event === 'SIGNED_OUT') {
      _teardownRealtimeSync();
      _invResetSession();
      _currentUser = null;
      _currentSession = null;
      db = { stocks: [], crypto: [] };
      document.getElementById('auth-overlay').style.display = 'flex';
    }
  });
})();
