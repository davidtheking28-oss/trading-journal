# Desktop visual review — 7 October 2026

Scope: desktop only for this pass, as requested. Local application reviewed at 1440×1000 with sample data and empty states in dark and light themes. The real Chart.js library was used for visual captures; regression tests stub external services. Main content was checked at the top and bottom, including secondary analytics and account settings.

| Tab | Coverage | Findings and recommendations |
| --- | --- | --- |
| Overview | Empty and populated KPIs, cumulative chart, calendar | Corrected numeric direction in calendar totals. Keep market indicators compact; add a clear unavailable-data label instead of English Unavailable in Hebrew mode. |
| Stocks / crypto | Stock and crypto scope, empty table, search, row expansion | Corrected hidden column tracks and 20-column spans in a 19-column table. Fixed the actions column absorbing spare width and removed the inherited 1600px minimum from the compact table and small summary tables. Larger column headings. Consider separating routine actions from duplicate cleanup. |
| Statistics | KPIs, win/loss, drawdown and R charts, secondary analytics | Fixed win/loss legend and tooltip denominators to use closed trades, matching chart segments and the headline. Larger monthly-table headings. Consider collapsing secondary analyses on desktop as an optional preference. |
| Market Pulse | Empty and populated sectors, index/meta cards, period selection | Corrected sign direction in index, podium, chips and sector values. Improved chip and label legibility. Consider eliminating duplicated Top/Bottom and sector-chip lists. |
| Missed opportunities | Empty list, populated month/year cards and reasons table | Simplified card surfaces and improved headings. Prefer a compact form with a larger reason field if this log grows. Follow-up quotes were mocked, so market-price accuracy was not assessed. |
| Investments | Empty and populated holdings, summary and allocations | Earlier visual changes retained; checked both themes and page overflow. Further changes should focus on allocation explanations rather than adding summary cards. |
| Profile / settings | Account, security, broker accordions, export controls | Improved secondary label readability. Consider putting Account first and completing Hebrew labels throughout broker/export sections. No credentials, security settings or live account data were changed. |
| Stock screener | Local iframe shell plus live external page | Live scan completed and returned results. Table and gallery were inspected. The criteria panel collapses for results. Recommend a brief active-filter summary while it is collapsed. This separate application was reviewed, not edited. Authenticated watchlist and journal handoff were not exercised against a real account. |

## Validation limits

This is a visual and interaction audit, not a verification of every integration. Broker sync, credential changes, two-factor enrollment, live writes and real-account watchlists were intentionally outside the test workflow. Synthetic data is used in screenshots. External quotes and market data in local tests are mocked; the external screener was inspected separately using public data.

## Regression coverage

The browser suite covers each available desktop tab, empty/populated data, both themes, page overflow, stock search, crypto scope, trade expansion, closed-trade win/loss percentages and Market Pulse periods. Existing investment save and account-switch checks are retained.

## המשך שיפורי העיצוב במחשב

בוצע: החשבון מוצג ראשון בהגדרות; כותרות המשנה של מקורות נתונים, ייבוא וייצוא תורגמו; מסך מגמות השוק מציג במחשב רשימת סקטורים אחת לצד סיכום רוחב השוק; הניתוחים הנוספים בסטטיסטיקות ניתנים לקיפול ופתיחה, ופתוחים כברירת מחדל במחשב. התנהגות הקיפול בטלפון נשמרה.

שיפור טבלת העסקאות: ארכיון וניקוי כפילויות רוכזו בתפריט פעולות נוספות במחשב; מוצג סיכום של סוג הנכס, התקופה והחיפוש. איפוס התקופה והחיפוש משמר את סוג הנכס. גם כפתור האיפוס במצב ללא תוצאות מנקה כעת חיפוש פעיל. נוספו בדיקות דפדפן לתפריט, לסיכום ולאיפוס.

נוספו במחשב הסברים על אומדן המזומן, בסיס חישוב האחוז המושקע, ההבדל בין יעד לחשיפה והמרווח עד יעד הקטגוריה. תוקן הסבר ישן שטען שלוח ההקצאה מחושב לפי עלות. הודעות חוסר נתונים וטעינה במדדי השוק ובחלונית הסקטור הותאמו לשפה שנבחרה.

## בדיקת נגישות, שימוש וקוד — 7 באוקטובר 2026

- תוקנה מסגרת המיקוד בשדות קלט, שנדרסה על ידי כלל עיצוב מאוחר; אומת במקלדת בשתי ערכות הצבעים.
- סדר ההגדרות במחשב תואם כעת את סדר הרכיבים במסמך כדי למנוע קפיצות בניווט במקלדת.
- טופס עסקה מזוהה כחלונית דיאלוג; המיקוד נכנס לשדה הסימבול וחוזר לכפתור הפתיחה בסגירה. נוספו תוויות נגישות לשדות ההשקעות.
- כל הלשוניות נבדקו ברוחב CSS של 720 פיקסלים, המקביל לפריסה של מסך 1440 בהגדלה של 200%; אין גלילה אופקית של הדף. זו בדיקת פריסה, לא בדיקת הגדלה באמצעות קורא מסך.
- סקירת הקוד איתרה ותיקנה השוואת תקופות שהשתמשה במסנן של טבלת העסקאות במקום במסנן הנכסים של המסך הראשי. בדיקת הרגרסיה מפעילה מסננים שונים בשתי הלשוניות.
- בדיקות: 228 בדיקות לוגיקה ו-12 בדיקות דפדפן עברו. פקודת הדפדפן הכוללת: node --test tests/browser.test.cjs tests/desktop-accessibility.test.cjs.
- תורגמו כותרת המעקב החודשי והנחיית שמירת המפתח. סקירת הניסוח השתמשה בסקיל design:ux-copy.
- נגישות: לא בוצעה בדיקה ידנית ב-NVDA או בדיקת ניגודיות מלאה לכל רכיב; אין כאן אישור עמידה מלא ב-WCAG.
- סקירת קוד עצמאית נוספת החזירה את תקלה בהשוואת התקופות ואז נעצרה עקב מגבלת שימוש; יתר הסקירה בוצעה על ידי הסוכן הראשי.
- שירותי ibkr/bybit והמשימות שלהם מופיעים ACTIVE. כלי לוגי Edge אינו זמין בגלל endpoint שהוסר ב-Supabase. סנכרון מאומת בחשבון אמיתי לא הופעל.

בדיקת תזמון בשרת: שש משימות IBKR/Bybit פעילות; ב-48 השעות האחרונות נרשמו 148 ריצות ללא כשל ברמת המתזמן. הצלחה זו מעידה על הרצת המשימות/שליחת הבקשות, ולא מוכיחה שכל ייבוא מהברוקר הושלם.

## סבב ניגודיות ואימות שרת נוסף

כלי axe-core (4.14.0) בדק ניגודיות טקסט, תוויות שדות ושמות כפתורים ב-28 שילובים: שבע לשוניות מקומיות, שתי ערכות צבעים, ומצב ריק/נתונים לדוגמה. האנימציות הושבתו בעת המדידה כדי להימנע מצבעי ביניים. מסנן המניות החיצוני, גרפי canvas, מצבי ריחוף, כל חלוניות המשנה וקורא מסך אינם מכוסים בסריקה זו.

תוקנו: כפתורי הפעולה במצבים ריקים, בחירת תקופה במגמות השוק, מחיר הסטופ, טקסט עזר במצבים ריקים, צבעי רווח והפסד בטבלאות ובלוח השנה, ספירת עסקאות שבועית ואחוזי רוחב השוק. הסריקה הסופית לא החזירה הפרות בכללים שנבדקו. אין מדובר באישור נגישות מלא.

אימות שרת בקריאה בלבד: בבדיקת broker_pnl_mismatch לא נמצאו פערים לא מוסברים מול ביצועי IBKR שבמטמון עבור השורות הכלולות בבדיקה; גם בדיקות כמות סגורה והיפוך מפוזיציה נסגרת החזירו אפס התרעות. לוג הסנכרון ב-48 השעות האחרונות מציג 96 ריצות Bybit ו-42 ריצות IBKR עם סטטוס ok וללא רשומות fail.

פער שנותר: שני דוחות במטמון המתינו לייבוא יותר מיומיים; ההמתנה הישנה ביותר החלה ב-18 בספטמבר 2026. הבדיקה מצרפית לכל הפרויקט ולא קושרת את ההתרעה לחשבון של המשתמש בשיחה. לא הופעל ייבוא, לא שונו עסקאות ולא נשלחו הודעות.

NVDA לא פעל בסביבה בעת הבדיקה; בדיקת הקראה ידנית עדיין נדרשת. השינויים לא פורסמו במסגרת סבב זה.

הרצת כל בדיקות הדפדפן והנגישות: npm test --prefix tests. התקנת תלויות הבדיקות כוללת מעתה את axe-core; קבצי הבדיקות ותלויותיהן אינם נכנסים לאתר המפורסם.

הכנה לפרסום: בדיקות הנגישות והניגודיות נכללות גם בשער הבדיקות של GitHub Actions. NVDA לא נמצא בנתיבי Program Files הרגילים; לא הותקן כלי מערכת חדש. שני חשבונות עם דוחות ממתינים מציגים משיכת IBKR תקינה ב-48 השעות האחרונות, אך זיהוי החשבון של המשתמש עדיין חסר.
