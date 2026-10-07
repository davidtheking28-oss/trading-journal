(() => {
  const control = window.__test = { delay: 0, calls: [] };
  const db = window.__testDB = {
    portfolios: [
      { id: 'portfolio-a', user_id: 'user-a', name: 'תיק א', is_default: true },
      { id: 'portfolio-b', user_id: 'user-a', name: 'תיק ב', is_default: false },
      { id: 'portfolio-c', user_id: 'user-b', name: 'תיק ג', is_default: true },
    ],
    investments: ['a','b','c'].map((k, i) => ({ user_id: i === 2 ? 'user-b' : 'user-a', portfolio_id: 'portfolio-' + k,
      portfolio_total: 1000, currency: '$', deposits: [], alloc_targets: {}, updated_at: 'stamp-0' })),
    investment_holdings: ['a','b','c'].map((k, i) => ({ id: 'holding-' + k, user_id: i === 2 ? 'user-b' : 'user-a',
      portfolio_id: 'portfolio-' + k, symbol: ['AAA','BBB','CCC'][i], entry_shares: 1, entry_price: 10, position: 0 })),
  };
  const user = id => ({ id, email: id + '@example.test', user_metadata: { full_name: 'Test Trader' } });
  let current = sessionStorage.getItem('test-user');
  let authCallback = () => {};
  const session = () => current ? { user: user(current), access_token: 'test-token', expires_at: 9999999999 } : null;
  const query = table => {
    const filters = {};
    let single = false, operation = 'select', values;
    const q = {
      select() { return q; }, eq(k, v) { filters[k] = v; return q; }, order() { return q; }, limit() { return q; },
      gte() { return q; }, lte() { return q; }, in() { return q; }, is() { return q; }, not() { return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      insert(v) { operation = 'insert'; values = v; return q; }, update(v) { operation = 'update'; values = v; return q; },
      upsert(v) { operation = 'upsert'; values = v; return q; }, delete() { operation = 'delete'; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'user_settings') return { data: { onboarding_done: true, order_id_notice_seen: true }, error: null };
          const found = (db[table] || []).filter(row => Object.entries(filters).every(([k,v]) => row[k] === v));
          if (operation === 'update') found.forEach(row => Object.assign(row, values));
          return { data: structuredClone(single ? found[0] || null : found), error: null, count: found.length };
        }).then(resolve, reject);
      },
    };
    return q;
  };
  const client = {
    from: query,
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email }) => {
        current = email.startsWith('b@') ? 'user-b' : 'user-a';
        sessionStorage.setItem('test-user', current);
        return { data: { user: user(current), session: session() }, error: null };
      },
      signOut: async () => { current = null; sessionStorage.removeItem('test-user'); await authCallback('SIGNED_OUT', null); return { error: null }; },
      updateUser: async () => ({ data: { user: user(current) }, error: null }),
    },
    channel() { const channel = { on() { return channel; }, subscribe() { return channel; } }; return channel; },
    removeChannel: async () => {},
    rpc: async (name, params) => {
      if (name !== 'save_investment_portfolio') return { data: name === 'my_broker_sync_health' ? [] : null, error: null };
      control.calls.push(structuredClone(params));
      if (control.delay) await new Promise(r => setTimeout(r, control.delay));
      try {
        const res = await fetch('/__test_rpc', { method: 'POST', body: JSON.stringify(params) });
        if (!res.ok) return { data: null, error: { message: 'Server unavailable' } };
        const saved = await res.json();
        const row = db.investments.find(r => r.portfolio_id === params.p_portfolio_id && r.user_id === current);
        if (!row) return { data: null, error: { message: 'Wrong account' } };
        Object.assign(row, { portfolio_total: params.p_portfolio_total, updated_at: saved.updated_at });
        db.investment_holdings = db.investment_holdings.filter(h => h.portfolio_id !== row.portfolio_id);
        params.p_holdings.forEach((h, i) => db.investment_holdings.push({ ...h, user_id: current, portfolio_id: row.portfolio_id, position: i }));
        return { data: saved, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };
  window.supabase = { createClient: () => client };
})();
