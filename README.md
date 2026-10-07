# Trading Journal 2.0

יומן מסחר אישי — מעקב עסקאות, ניתוח ביצועים, סנכרון ברוקרים וניהול תיקי השקעות.

---

## גישה מהירה (מומלץ)

האתר זמין ישירות בלי שום התקנה:

**https://davidtheking28-oss.github.io/trading-journal/dashboard.html**

---

## הרצה מקומית (למפתחים)

אם אתה רוצה להריץ את הקוד מקומית אחרי clone:

### 1. Clone את הריפו

```bash
git clone https://github.com/davidtheking28-oss/trading-journal.git
cd trading-journal
```

### 2. הכנס את ה-Supabase credentials

פתח את `dashboard.html` בעורך טקסט, מצא את השורות האלה בתחילת הקובץ (שורות 55–56):

```js
const SUPABASE_URL  = '__SUPABASE_URL__';
const SUPABASE_ANON = '__SUPABASE_ANON__';
```

החלף אותן עם הערכים הבאים:

```js
const SUPABASE_URL  = 'https://fnklrqxwyeibfptaxewf.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // בקש מהבעלים
```

> ⚠️ את ה-ANON key בקש מהבעלים של האפליקציה — הוא לא מאוחסן בגיט מטעמי אבטחה.

### 3. פתח בדפדפן

הרץ שרת מקומי מתוך תיקיית הפרויקט:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

פתח את http://127.0.0.1:8000/dashboard.html. השרת נדרש לטעינת קובצי הקוד והמודולים.

---

## הרשמה

כדי להשתמש באפליקציה צריך ליצור חשבון דרך מסך הכניסה. כל משתמש רואה רק את הנתונים שלו.

## מבנה ובדיקות

העיצוב והמבנה נמצאים ב־`dashboard.html`. קוד ההתחברות, הדשבורד, ההשקעות והאתחול נמצא ב־`assets/js/`. אין שלב בנייה.

שמירת תיק השקעות מתבצעת בפעולה אטומית דרך `save_investment_portfolio`: כל השינויים נשמרים יחד, או כולם מתבטלים. הממשק מציג מצב שמירה, מאפשר ניסיון חוזר ומתריע על שינויים שלא נשמרו.

להוראות הבדיקות, כולל בדיקות דפדפן ללא חשבונות אמיתיים, ראה `tests/README.md`. כללי העבודה המעודכנים נמצאים ב־`AGENTS.md`.
