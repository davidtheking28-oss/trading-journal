const fs = require('fs');
let h = fs.readFileSync('dashboard.html', 'utf8');
h = h.replace('__SUPABASE_URL__', process.env.SUPABASE_URL || '');
h = h.replace('__SUPABASE_ANON__', process.env.SUPABASE_ANON_KEY || '');
fs.writeFileSync('dashboard.html', h);
console.log('Replaced OK');
