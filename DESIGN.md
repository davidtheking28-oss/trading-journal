---
name: Trading Journal 2.0
description: יומן מסחר אישי — נקי, מקצועי, רגוע
colors:
  accent: "#818cf8"
  accent-deep: "#6366f1"
  profit: "#2dd4a0"
  loss: "#ff6b8a"
  warning: "#fbbf24"
  bg: "#0a0a0a"
  surface: "#111111"
  surface-low: "#0d0d0d"
  text-primary: "#f1f5f9"
  text-secondary: "#a8b8cc"
  text-muted: "#8896a8"
  border: "rgba(255,255,255,0.06)"
  border-strong: "rgba(255,255,255,0.10)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    letterSpacing: "0.8px"
rounded:
  sm: "8px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "#6366f1"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "9px 18px"
  button-primary-hover:
    backgroundColor: "#818cf8"
  button-secondary:
    backgroundColor: "rgba(255,255,255,0.06)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "9px 18px"
  button-danger:
    backgroundColor: "rgba(255,71,87,0.12)"
    textColor: "{colors.loss}"
    rounded: "{rounded.sm}"
    padding: "9px 18px"
---

# Design System: Trading Journal 2.0

## 1. Overview

**Creative North Star: "The Analyst's Desk"**

זהו מערכת עיצוב של כלי מקצועי שמכבד את זמן המשתמש. הממשק אפל, שקט, ומצמצם כל תחרות עם הנתונים עצמם. כמו שולחן עבודה נקי — כל אלמנט יש לו סיבה להיות שם, ולא יותר. הצבעים, הצללים, והריווח נבחרו כדי לייצר תחושת רוגע ובטחון, לא התרגשות.

הגישה היא "מקצועיות שקטה": indigo מוגבל לפרטים קריטיים, ירוק ואדום רק לP&L, ושאר המשטח כמעט מונוכרומטי. העיצוב לא מגיימיפי, לא מנסה להמריץ — הוא מניח שהמשתמש יודע מה הוא עושה.

**Key Characteristics:**
- משטח כמעט-שחור עם שכבות עדינות של אפור כהה
- accent indigo מופיע בפחות מ-10% מהמסך
- ירוק/אדום רק לביטוי P&L — לא כקישוט
- ריווח נדיב, היררכיה ברורה, בלי רעש ויזואלי
- RTL עברית כברירת מחדל

## 2. Colors: The Silent Palette

פלטה מונוכרומטית כמעט-שחורה עם accent indigo יחיד וצמד ירוק/אדום פונקציונלי בלבד.

### Primary
- **Soft Indigo** (`#818cf8`): accent ראשי — כפתורים primary, אינדיקטור tab פעיל, focus glow, פרטי hover
- **Deep Indigo** (`#6366f1`): gradient base לכפתורים, hover states כהים יותר

### Secondary (Semantic only)
- **Profit Green** (`#2dd4a0`): P&L חיובי בלבד — ערכים, badges, שורות
- **Loss Red** (`#ff6b8a`): P&L שלילי בלבד — ערכים, badges, שורות
- **Caution Yellow** (`#fbbf24`): התראות, ערכים זהירים, stop-loss קרוב

### Neutral
- **Near Black** (`#0a0a0a`): רקע הגוף — ניטרלי לחלוטין, ללא תזה
- **Deep Surface** (`#0d0d0d`): nav, sidebar, שכבת בסיס
- **Card Surface** (`#111111`): כרטיסים, טבלאות, panels
- **Primary Text** (`#f1f5f9`): טקסט ראשי
- **Secondary Text** (`#a8b8cc`): טקסט משני, תוויות
- **Muted Text** (`#8896a8`): metadata, timestamps, עזר
- **Border Subtle** (`rgba(255,255,255,0.06)`): גבולות שטחיים
- **Border Strong** (`rgba(255,255,255,0.10)`): גבולות דגש

**The One Accent Rule.** ה-indigo מופיע על פחות מ-10% מכל מסך. הנדירות שלו היא הנקודה — הוא מסמן פעולה, לא עיצוב.

**The Semantic Color Rule.** ירוק ואדום אסורים כקישוט. הם תשמורת לנתוני P&L בלבד. שימוש אחר מדלל את המשמעות.

## 3. Typography

**Display Font:** Plus Jakarta Sans (fallback: Inter, system-ui, sans-serif)
**Body Font:** Plus Jakarta Sans (אחיד — פונט יחיד לכל המערכת)
**Condensed Font:** Barlow Condensed (לתוויות קומפקטיות בלבד)

**Character:** פונט humanist-geometric שמשלב קריאות גבוהה עם אופי מקצועי. לא קר מדי, לא חם מדי — בדיוק נכון לדשבורד נתונים.

### Hierarchy
- **Display** (700, 17px, -0.3px): כותרת header, שם האפליקציה
- **Title** (600–700, 14–15px, normal): כותרות section, שמות קארד
- **Body** (400–500, 14px, 1.5): תוכן טבלה, תיאורים
- **Label** (700, 10–10.5px, 0.8px, UPPERCASE): כותרות עמודות, תוויות filter

**The Tabular Numerics Rule.** כל מספר כספי חייב להיות עם `font-variant-numeric: tabular-nums` — יישור עמודות הוא קריאות נתונים.

## 4. Elevation

המערכת משתמשת בשכבות תוני אפור (tonal layering) כשיטה ראשית לעומק, עם צללים כחיזוק שמרני. כל surface מעל הרקע בגוון אחד בהיר יותר — לא קפיצה דרמטית.

### Shadow Vocabulary
- **Surface Low** (`var(--shadow-sm)` = `0 1px 3px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)`): כרטיסים בסיסיים במצב מנוחה
- **Surface Mid** (`var(--shadow-md)` = `0 4px 12px rgba(0,0,0,0.65), 0 12px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)`): modals, panels מורמים
- **Surface High** (`var(--shadow-lg)` = `0 8px 24px rgba(0,0,0,0.75), 0 20px 48px rgba(0,0,0,0.6)`): dropdowns, toasts
- **Accent Glow** (`0 8px 32px rgba(129,140,248,0.12)`): כפתורים primary בלבד

**The Flat-By-Default Rule.** Surfaces נחות שטוחים. צללים מגיעים רק כתגובה למצב (hover, elevation, focus) — לא כקישוט.

## 5. Components

### Buttons
- **Shape:** פינות עגולות עדינות (8px)
- **Primary:** gradient indigo `#6366f1 → #818cf8`, טקסט לבן, padding `9px 18px`, glow `rgba(129,140,248,0.3)` בצל
- **Hover:** `translateY(-1px)` + glow מתחזק — תנועה מינימלית, תגובה ברורה
- **Secondary:** רקע `rgba(255,255,255,0.06)`, גבול `border2`, hover מכהה ב-1 שלב
- **Danger:** רקע אדום ב-12% opacity, צבע `--red`, גבול מוקף אדום 25%
- **Export/Green:** variant עם רקע ירוק 10%, צבע `--green`

### Cards / Containers
- **Corner Style:** עגול (14px — `--radius2`)
- **Background:** `#111111` (`--card`) — אחיד, ללא gradient
- **Shadow:** `--shadow-sm` במנוחה
- **Border:** `rgba(255,255,255,0.06)` — גבול עדין שמגדיר קצה בלי להכריז
- **Internal Padding:** `20–28px`

### Table
- **Container:** `--card` עם `border-radius: 14px`, `overflow: auto`
- **Header:** sticky, רקע `#0b0b0e`, גבול תחתון `rgba(129,140,248,0.15)` — רמז indigo אחד
- **Row hover:** `rgba(129,140,248,0.05)` — עדין מאוד
- **Profit row:** `rgba(0,209,122,0.03)` רגיל → `0.07` בhover
- **Loss row:** `rgba(255,71,87,0.03)` רגיל → `0.07` בhover

### Navigation (Tabs)
- **Style:** רקע `#0b0b0e`, tabs שטוחים עם padding `14px 20px`
- **Default:** `var(--text2)`, ללא גבול תחתון
- **Hover:** `var(--text)` + רקע `rgba(129,140,248,0.06)`, border-radius עליון בלבד
- **Active:** `var(--accent)`, `border-bottom: 2px solid var(--accent)`

### Form Inputs / Selects
- **Style:** רקע `var(--bg)`, גבול `--border2`, radius `8px`
- **Focus:** גבול `--accent` + `box-shadow: 0 0 0 3px rgba(129,140,248,0.12)`
- **Font:** 12px, weight 500

### Badges (Long / Short)
- **Long (L):** רקע ירוק `rgba(52,211,153,0.12)`, צבע `--green`, padding `2px 8px`, radius `4px`
- **Short (S):** רקע אדום `rgba(248,113,113,0.12)`, צבע `--red`

## 6. Do's and Don'ts

### Do:
- **Do** השתמש ב-indigo (`#818cf8`) לפעולות ופרטים אינטראקטיביים בלבד — לא לקישוט
- **Do** שמור על ירוק ואדום לנתוני P&L בלבד — המשמעות הסמנטית שלהם היא הנכס
- **Do** הוסף `font-variant-numeric: tabular-nums` לכל תצוגת מספר כספי
- **Do** השתמש ב-`var(--radius2)` (14px) לקונטיינרים גדולים, `var(--radius)` (8px) לאלמנטים קטנים
- **Do** שמור על היררכיה ברורה: `--text` → `--text2` → `--text3` בלי לדלג שלב
- **Do** הוסף `cursor: pointer` לכל אלמנט לחיץ

### Don't:
- **Don't** הוסף gradient text או `background-clip: text` — זה לא ה-aesthetic של הפרויקט (כבר קיים בheader title — לא להרחיב לאלמנטים אחרים)
- **Don't** השתמש בירוק או אדום לאלמנטים שאינם קשורים לביצועי מסחר — Robinhood-ification של העיצוב
- **Don't** עצב ממשק גיימיפי — אנימציות חגיגה, סמלי emoji, צבעים קמעונאיים (Trading212-style)
- **Don't** צפוף widgets — spacing נדיב הוא לא בזבוז, הוא רוגע
- **Don't** הוסף צללים דקורטיביים — צל מופיע רק כתגובה למצב
- **Don't** שנה את סדר הקומפוננטים או מבנה הנתונים הקיים — עקביות מעל חידוש
