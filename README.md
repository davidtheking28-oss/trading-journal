# Trading Journal 2.0

יומן מסחר אישי — מעקב עסקאות, ניתוח ביצועים, ויועץ השקעות מבוסס AI.

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

פשוט פתח את `dashboard.html` ישירות בדפדפן — אין צורך בשרת.

---

## הרשמה

כדי להשתמש באפליקציה צריך ליצור חשבון דרך מסך הכניסה. כל משתמש רואה רק את הנתונים שלו.
