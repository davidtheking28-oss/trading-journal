# IBKR Open Positions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse and display IBKR open positions from the Flex XML that's already fetched during broker sync.

**Architecture:** IBKR Flex XML already contains `<OpenPosition>` elements when the user adds the OpenPositions section to their query. We parse these alongside trades, store the snapshot in localStorage (keyed by userId), and render a table in the Overview tab. No Edge Function changes, no DB migration.

**Tech Stack:** Vanilla JS, DOMParser (already used for trades), localStorage, dashboard.html inline CSS/HTML.

## Global Constraints

- All changes are in `dashboard.html` only — single HTML file, no build step
- RTL layout (Hebrew) — `text-align: right` on table headers/cells
- Sensitive numbers must be wrapped in `<span class="sensitive">` and `applyPrivacy()` called after render
- No comments in code
- Use `var(--accent)`, `var(--green)`, `var(--red)`, `var(--text2)`, `var(--text3)` — no hardcoded hex
- Wrap any new CSS in the existing `<style>` block, near other IBKR styles (~line 1350)

---

### Task 1: Parse function + storage helpers

**Files:**
- Modify: `dashboard.html` — add `flexParseOpenPositions` near `flexParseXML` (~line 13467), add 3 storage helpers nearby

**Interfaces:**
- Produces: `flexParseOpenPositions(xml: string): OpenPosition[]`
  - `OpenPosition = { symbol, qty, markPrice, costBasis, unrealizedPnL, positionValue, currency, side }`
- Produces: `_saveOpenPositions(positions: OpenPosition[]): void`
- Produces: `_loadOpenPositions(): OpenPosition[]`
- Produces: `_openPositionsTs(): string | null`

- [ ] **Step 1: Add `flexParseOpenPositions` immediately after `flexParseXML` ends (~line 13467)**

```js
function flexParseOpenPositions(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('OpenPosition')]
    .map(el => ({
      symbol:        el.getAttribute('symbol') || '',
      qty:           +el.getAttribute('position') || 0,
      markPrice:     +el.getAttribute('markPrice') || 0,
      costBasis:     +el.getAttribute('costBasisPrice') || 0,
      unrealizedPnL: +el.getAttribute('fifoPnlUnrealized') || 0,
      positionValue: +el.getAttribute('positionValue') || 0,
      currency:      el.getAttribute('currency') || 'USD',
      side:          el.getAttribute('side') || 'Long',
    }))
    .filter(p => p.symbol && p.qty !== 0);
}
function _saveOpenPositions(positions) {
  if (!_currentUser) return;
  localStorage.setItem('ibkr_open_pos_' + _currentUser.id, JSON.stringify(positions));
  localStorage.setItem('ibkr_open_pos_ts_' + _currentUser.id, new Date().toISOString());
}
function _loadOpenPositions() {
  if (!_currentUser) return [];
  try { return JSON.parse(localStorage.getItem('ibkr_open_pos_' + _currentUser.id) || '[]'); } catch { return []; }
}
function _openPositionsTs() {
  if (!_currentUser) return null;
  return localStorage.getItem('ibkr_open_pos_ts_' + _currentUser.id);
}
```

- [ ] **Step 2: Verify `flexParseXML` ends with `return trades; }` at ~line 13466 before inserting**

---

### Task 2: Wire parse into `_flexFetch` and `_flexImportFromCache`

**Files:**
- Modify: `dashboard.html` — two injection points

**Interfaces:**
- Consumes: `flexParseOpenPositions(xml)` from Task 1
- Consumes: `_saveOpenPositions(positions)` from Task 1
- Consumes: `renderOpenPositions()` from Task 4 (forward call — function will exist by the time this runs in browser)

**`_flexFetch` location:** line ~11647, just before `return flexParseXML(xml);`
```js
  if (debug) return { xml, trades: flexParseXML(xml) };
  return flexParseXML(xml);
```
Change the last line to also parse and store positions:
```js
  if (debug) return { xml, trades: flexParseXML(xml) };
  _saveOpenPositions(flexParseOpenPositions(xml));
  renderOpenPositions();
  return flexParseXML(xml);
```

**`_flexImportFromCache` location:** line ~11813, just after `const trades = flexParseXML(row.xml);`
```js
    const trades = flexParseXML(row.xml);
```
Change to:
```js
    const trades = flexParseXML(row.xml);
    _saveOpenPositions(flexParseOpenPositions(row.xml));
    renderOpenPositions();
```

- [ ] **Step 1: Edit `_flexFetch` — add 2 lines before `return flexParseXML(xml)`**
- [ ] **Step 2: Edit `_flexImportFromCache` — add 2 lines after `const trades = flexParseXML(row.xml)`**

---

### Task 3: Update setup instructions text

**Files:**
- Modify: `dashboard.html` — two lines in the i18n strings (~line 10115 and ~10242)

**Current (EN, line 10115):**
```
set_ibkr_steps:'Create an Activity Flex Query → Period: Last 365 Calendar Days, Format: XML, Trades section with the "Trade ID" field → Copy the Token and Query ID',
```
**New (EN):**
```
set_ibkr_steps:'Create an Activity Flex Query → Period: Last 365 Calendar Days, Format: XML, add the Trades section (with "Trade ID") and the Open Positions section → Copy the Token and Query ID',
```

**Current (HE, line 10242):**
```
set_ibkr_steps:'צור Activity Flex Query → Period: Last 365 Calendar Days, פורמט: XML, סעיף Trades עם השדה "Trade ID" → העתק את Token ו-Query ID',
```
**New (HE):**
```
set_ibkr_steps:'צור Activity Flex Query → Period: Last 365 Calendar Days, פורמט: XML, הוסף סעיף Trades (עם "Trade ID") וסעיף Open Positions → העתק את Token ו-Query ID',
```

- [ ] **Step 1: Edit EN string at line ~10115**
- [ ] **Step 2: Edit HE string at line ~10242**

---

### Task 4: Add CSS for the open positions section

**Files:**
- Modify: `dashboard.html` — add CSS near other IBKR styles (~line 1350)

- [ ] **Step 1: Add CSS after `.ibkr-status-dot.disconnected` block (~line 1359)**

```css
  .open-pos-table th, .open-pos-table td { text-align: right; }
  .open-pos-table th { font-size: 10px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 10px; }
  .open-pos-table td { font-size: 13px; padding: 8px 10px; border-top: 1px solid rgba(255,255,255,0.04); }
  .open-pos-table tr:hover td { background: rgba(255,255,255,0.02); }
  .open-pos-table .sym-col { font-weight: 700; font-family: monospace; color: var(--text); }
  .open-pos-table .pos-green { color: var(--green); font-weight: 700; }
  .open-pos-table .pos-red   { color: var(--red);   font-weight: 700; }
```

---

### Task 5: Add HTML section in Overview tab + `renderOpenPositions` function

**Files:**
- Modify: `dashboard.html` — HTML at ~line 5600 (before `</div>` closing overview tab), JS near `renderOverview`

**HTML to add** (inside `#tab-overview`, after `.ov-main-grid` block at line ~5601, before `</div>` at line 5602):

```html
      <!-- Open Positions (IBKR) -->
      <div id="open-positions-section" style="display:none;margin-top:16px;margin-bottom:4px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div class="chart-title" style="margin-bottom:0;" data-i18n="open_pos_title">פוזיציות פתוחות</div>
          <span id="open-pos-ts" style="font-size:11px;color:var(--text3);"></span>
        </div>
        <div class="chart-card" style="padding:0;overflow:hidden;">
          <div id="open-pos-table-wrap"></div>
        </div>
      </div>
```

**`renderOpenPositions` function** (add near the end of `renderOverview`, or as a standalone function after it):

```js
function renderOpenPositions() {
  const section = document.getElementById('open-positions-section');
  if (!section) return;
  const positions = _loadOpenPositions();
  if (!positions.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const ts = _openPositionsTs();
  const tsEl = document.getElementById('open-pos-ts');
  if (tsEl && ts) {
    tsEl.textContent = new Date(ts).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  const wrap = document.getElementById('open-pos-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <table class="open-pos-table" style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th>סמל</th><th>כמות</th><th>מחיר עלות</th><th>מחיר שוק</th><th>שווי</th><th>רו"ה פתוח</th>
      </tr></thead>
      <tbody>
        ${positions.map(p => {
          const cls = p.unrealizedPnL >= 0 ? 'pos-green' : 'pos-red';
          const sign = p.unrealizedPnL >= 0 ? '+' : '';
          return `<tr>
            <td class="sym-col">${p.symbol}</td>
            <td><span class="sensitive">${Math.abs(p.qty).toLocaleString()}</span></td>
            <td><span class="sensitive">$${p.costBasis.toFixed(2)}</span></td>
            <td><span class="sensitive">$${p.markPrice.toFixed(2)}</span></td>
            <td><span class="sensitive">$${p.positionValue.toLocaleString('en', { maximumFractionDigits: 0 })}</span></td>
            <td class="${cls}"><span class="sensitive">${sign}$${p.unrealizedPnL.toFixed(0)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  applyPrivacy();
}
```

- [ ] **Step 1: Add HTML section before closing `</div>` of `#tab-overview` (~line 5602)**
- [ ] **Step 2: Add `renderOpenPositions()` function after `renderOverview` ends**
- [ ] **Step 3: Add `renderOpenPositions()` call at the end of `renderOverview()`**

---

### Task 6: Add i18n key for section title

**Files:**
- Modify: `dashboard.html` — two places in i18n strings

The section uses `data-i18n="open_pos_title"` — add this key to both EN and HE i18n objects.

EN (near line 10115, after `set_sync`):
```
open_pos_title: 'Open Positions (IBKR)',
```
HE (near line 10242, after `set_sync`):
```
open_pos_title: 'פוזיציות פתוחות (IBKR)',
```

- [ ] **Step 1: Add EN key**
- [ ] **Step 2: Add HE key**
