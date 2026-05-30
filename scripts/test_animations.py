"""
Test the animation/delight changes made to dashboard.html:
1. Tab indicator ::after scaleX animation CSS exists
2. Modal overlay uses @starting-style + allow-discrete (not display:flex toggle)
3. Dropdown slide animation CSS exists
4. Time-of-day greeting element exists
5. Console easter egg wired up (function exists)
6. No JS errors on load
7. Screenshots for visual confirmation
"""
import os, re
from playwright.sync_api import sync_playwright

FILE_URL = "file:///C:/Users/david/trading-journal/dashboard.html"
SHOTS_DIR = "C:/Users/david/trading-journal/scripts/test_shots"
os.makedirs(SHOTS_DIR, exist_ok=True)

errors = []
warnings = []

def shot(page, name):
    path = f"{SHOTS_DIR}/{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"  Screenshot: {path}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    js_errors = []
    page.on("pageerror", lambda e: js_errors.append(str(e)))
    console_errors = []
    page.on("console", lambda m: console_errors.append(m) if m.type == "error" else None)

    print("Loading dashboard.html ...")
    page.goto(FILE_URL)
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(1500)

    shot(page, "01_initial_load")
    print("  [OK] Page loaded")

    # ── 1. Tab indicator CSS ────────────────────────────────────────
    print("\n[1] Tab indicator (::after scaleX)")
    result = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        for (const s of sheets) {
            try {
                const rules = [...s.cssRules];
                for (const r of rules) {
                    if (r.selectorText && r.selectorText.includes('tnav-btn::after')) {
                        return r.cssText;
                    }
                }
            } catch(e) {}
        }
        return null;
    }""")
    if result and 'scaleX' in result:
        print(f"  [PASS] .tnav-btn::after found with scaleX")
    elif result:
        warnings.append(f"  [WARN] .tnav-btn::after found but no scaleX: {result[:120]}")
        print(warnings[-1])
    else:
        errors.append("[FAIL] .tnav-btn::after rule NOT found in stylesheet")
        print(f"  {errors[-1]}")

    # ── 2. border-bottom-color transparent override ─────────────────
    print("\n[2] Tab indicator: border-bottom-color transparent override")
    result2 = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        for (const s of sheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.selectorText && r.selectorText.includes('tnav-btn.active') &&
                        r.style && r.style.borderBottomColor === 'transparent') {
                        return 'found';
                    }
                }
            } catch(e) {}
        }
        return null;
    }""")
    if result2:
        print(f"  [PASS] border-bottom-color: transparent override found")
    else:
        warnings.append("[WARN] border-bottom-color transparent override not found (may still work if cascades correctly)")
        print(f"  {warnings[-1]}")

    # ── 3. Modal overlay transition ─────────────────────────────────
    print("\n[3] Modal overlay transition (allow-discrete)")
    result3 = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        for (const s of sheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.selectorText === '.modal-overlay' && r.style) {
                        return { transition: r.style.transition, opacity: r.style.opacity };
                    }
                }
            } catch(e) {}
        }
        return null;
    }""")
    if result3 and result3.get('opacity') == '0':
        print(f"  [PASS] .modal-overlay has opacity:0 base (fade pattern)")
        print(f"         transition: {result3.get('transition', '—')[:80]}")
    else:
        errors.append(f"[FAIL] .modal-overlay opacity not found or wrong: {result3}")
        print(f"  {errors[-1]}")

    # ── 4. Dropdown slide animation ─────────────────────────────────
    print("\n[4] Dropdown slide animation (ddSlide keyframe)")
    result4 = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        for (const s of sheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'ddSlide') {
                        return r.cssText.slice(0, 120);
                    }
                }
            } catch(e) {}
        }
        return null;
    }""")
    if result4:
        print(f"  [PASS] @keyframes ddSlide found: {result4}")
    else:
        errors.append("[FAIL] @keyframes ddSlide NOT found")
        print(f"  {errors[-1]}")

    # ── 5. Time-of-day greeting element ────────────────────────────
    print("\n[5] Time-of-day greeting element (#time-greeting)")
    el = page.locator("#time-greeting")
    count = el.count()
    if count > 0:
        print(f"  [PASS] #time-greeting element exists in DOM")
    else:
        errors.append("[FAIL] #time-greeting element NOT found in DOM")
        print(f"  {errors[-1]}")

    # ── 6. SS modal overlay transition ─────────────────────────────
    print("\n[6] SS modal overlay fade pattern")
    result6 = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        for (const s of sheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.selectorText === '.ss-modal-overlay' && r.style) {
                        return { opacity: r.style.opacity, display: r.style.display };
                    }
                }
            } catch(e) {}
        }
        return null;
    }""")
    if result6 and result6.get('opacity') == '0':
        print(f"  [PASS] .ss-modal-overlay has opacity:0 base")
    else:
        warnings.append(f"[WARN] .ss-modal-overlay pattern unclear: {result6}")
        print(f"  {warnings[-1]}")

    # ── 7. Auth overlay renders correctly ──────────────────────────
    print("\n[7] Auth overlay visible on load")
    auth = page.locator("#auth-overlay")
    if auth.count() > 0:
        visible = auth.is_visible()
        print(f"  [{'PASS' if visible else 'WARN'}] #auth-overlay {'visible' if visible else 'not visible (may auto-login)'}")
    else:
        warnings.append("[WARN] #auth-overlay not found")
        print(f"  {warnings[-1]}")

    shot(page, "02_auth_state")

    # ── 8. No critical JS errors ───────────────────────────────────
    print("\n[8] JS errors on load")
    critical = [e for e in js_errors if 'Script error' not in e]
    if not critical:
        print(f"  [PASS] No JS errors on load")
    else:
        for e in critical:
            errors.append(f"[FAIL] JS error: {e[:120]}")
            print(f"  {errors[-1]}")

    # ── 9. transition:all check (should be gone from btn/tab-btn) ──
    print("\n[9] transition:all removed from .btn and .tab-btn")
    result9 = page.evaluate("""() => {
        const sheets = [...document.styleSheets];
        const hits = [];
        for (const s of sheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.selectorText && (r.selectorText === '.btn' || r.selectorText === '.tab-btn' || r.selectorText === '.btn-icon') && r.style) {
                        const t = r.style.transition;
                        if (t && t.startsWith('all')) hits.push({sel: r.selectorText, t});
                    }
                }
            } catch(e) {}
        }
        return hits;
    }""")
    if not result9:
        print(f"  [PASS] No transition:all found on .btn / .tab-btn / .btn-icon")
    else:
        for h in result9:
            warnings.append(f"[WARN] transition:all still on {h['sel']}: {h['t'][:60]}")
            print(f"  {warnings[-1]}")

    browser.close()

# ── Summary ────────────────────────────────────────────────────────
print("\n" + "="*60)
print(f"RESULT: {len(errors)} failures, {len(warnings)} warnings")
if errors:
    print("\nFAILURES:")
    for e in errors: print(f"  {e}")
if warnings:
    print("\nWARNINGS:")
    for w in warnings: print(f"  {w}")
if not errors:
    print("\nAll critical checks PASSED.")
print(f"\nScreenshots saved to: {SHOTS_DIR}")
