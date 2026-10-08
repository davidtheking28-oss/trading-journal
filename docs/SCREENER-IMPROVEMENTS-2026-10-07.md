# שיפורי ביצועים ואמינות במסנן — 7 באוקטובר 2026

השינויים נמצאים מקומית בפרויקט `C:/Users/david/stock-screener`. לא בוצעו commit, push, פרסום Pages או שינוי פונקציות שרת. האתר שבתוך היומן מצביע לגרסה המפורסמת, ולכן עדיין לא מציג את השינויים המקומיים.

## השינויים

### שימוש חוזר בנתוני מחיר שכבר אומתו

`_ohlcDraw` משתמש כעת ב־`_galleryBarsFromValidated` כדי לטעון את חלון הגרף מנתוני השנה שכבר נטענו לצורך `validateExact`. אם אותה מניה נמצאת בקבוצת אימות פעילה, הגרף ממתין לבקשה המשותפת במקום לפתוח בקשה נוספת. הנתונים חייבים להיות טריים ותקינים. חלון הגרף נשאר 90 ימים וההיסטוריה המקורית נשמרת בשלמותה לאימות. נתונים חסרים או ישנים ממשיכים במסלול הטעינה הרגיל.

### ביטול עבודה של סריקה שהוחלפה

נוספו בדיקות AbortSignal בתחילת האימות, לפני קבוצות בקשות ובתוך לולאת המניות. מעבר לסריקה חדשה עוצר קבוצות שטרם נשלחו וחישובים שכבר אינם נחוצים. בקשות פעילות שכבר נשלחו עשויות עדיין להשלים בצד השרת; אין טענה לביטול עבודה חיצונית שכבר התחילה.

### בידוד פעולות לפי חשבון

נוספו זהות משתמש ודור חשבון לכל פעולה רגישה. תשובות טעינה, שמירת היסטוריה, כישלונות שמירת מעקב, העדפות וביצועים נבדקות לפני החלתן. מעבר A→B→A ויציאה מבטלים את ההקשר הישן. מזהה המשתמש המקורי משמש בכתיבות ההיסטוריה, ומאזין שינוי החשבון נרשם לפני המתנה לטעינת הנתונים הראשונית. ניסיון סנכרון מעקב שנכשל משאיר את סימון השינוי המקומי להמשך ניסיון.

### הכנת משאבי פתיחה

נוספו preconnect לשני מקורות ספריות קיימים ו־preload לגופן העברי המקומי. שינויים אלו מקדימים גילוי משאבים; השפעתם על זמן פתיחה ברשת חיה עדיין לא נמדדה. גרסאות הספריות והנוסחאות לא השתנו.

## מדידה מבוקרת

שישה גרפים של ספריית Lightweight Charts האמיתית, עם נתוני OHLC סינתטיים שכבר נמצאים במטמון האימות ותגובה מדומה עם השהיה של 75ms:

| מדד | לפני | אחרי |
|---|---:|---:|
| בקשות OHLC נוספות | 6 | 0 |
| זמן יצירת ששת הגרפים | 149ms | 18ms |
| גרפים שנוצרו | 6 | 6 |
| מספר נרות במקור האימות | 250 | 250 |
| שגיאות JavaScript | 0 | 0 |

זו מדידת תרחיש אחת, לא חציון של עומס משתמשים ולא מדידת סריקה חיה. היא מאמתת הסרת כפילות בקשות. המספרים אינם מייצגים האצה באותו יחס של האתר כולו. פירוט: `screener-chart-benchmark.json`.

## בדיקות

- 258 בדיקות הלוגיקה המקוריות עברו בקוד הדף האמיתי.
- 14 בדיקות חדשות עברו: חשבון מקורי, החלפה, חזרה לחשבון קודם, יציאה, תגובת טעינה ישנה, היסטוריה ישנה, מטמון טרי/ישן/חסר, חלון גרף ושמירת המקור, בקשה משותפת וביטול לפני ובאמצע טעינה.
- בדיקות הרגרסיה נכשלו מול הגרסה הישנה ועברו לאחר השינוי.
- בדיקות אלו נוספו לפרויקט המסנן (`tests/improvements.js`) וחוברו ל־`tests/run-tests.py`, שרץ גם ב־CI הקיים.
- 32 בדיקות השרת של המסנן עברו; לא שונו פונקציות שרת.
- בדיקת הגרפים יצרה שישה גרפים אמיתיים ללא שגיאות ושמרה צילום אחרי השינוי.
- פקודת Python המקומית אינה זמינה להרצה מלאה משום שחבילת Python Playwright חסרה. הבדיקות הורצו דרך Node Playwright, על אותם קובצי assertions וקוד הדף. לא נטען שהרצת Python עברה.

כלי ההרצה המקומיים ביומן: `tests/verify-screener-improvements.cjs` ו־`tests/benchmark-screener-charts.cjs`. הם מיועדים לבדיקת פרויקט המסנן הנפרד ואינם נכללים בחבילת CI של היומן.

## איכות המסנן בהמשך

לא הוכח שדירוג חדש יניב תוצאות טובות יותר, ולכן משקלי הציון והספים נשמרו. השיפור הנוכחי הוא ביצועים ואמינות הנתונים. לפני שינוי אלגוריתם מומלץ:

1. להציג ליד מועמד אילו תנאים אומתו מול OHLC, אילו נשענים על קירוב ואילו נתונים חסרים.
2. למדוד שינויי דירוג על נתונים היסטוריים, עם יקום מניות מתאים למועד המדידה ובלי להשתמש במידע עתידי; להשוות לכמה תקופות ולמדד ייחוס קבוע.
3. להבחין בין נתונים שמורים לנתונים עדכניים ולהציג זמן הנתונים כשהאימות והמחיר מגיעים ממקורות שונים.
4. להוסיף כיסוי לבקשות batch שנכשלות, נתונים חלקיים ואימות שלא הושלם לפני מעבר למסנן אחר.

ממצאי העיצוב ומגבלת המטמון הציבורי שתועדו בדוחות הקודמים נותרו מחוץ לשינוי הזה.

## Remaining findings fixed locally
- Desktop: screen selectors remain visible with collapsed criteria; advanced SEPA conditions grouped; expanded form no longer clips; email field and settings spacing styled; single-screen field widths bounded; gallery empty state spans the grid; first-seen label clarified.
- Exact validation: partial candidates labelled, price date shown, preliminary candidates not persisted as final results, validation failure no longer recorded as completed review.
- Universe fetch rejects failed ADR query rather than computing RS on incomplete data.
- scan-universe accepts only three canonical supported queries, bounds request bytes, memory cache keys and rate-map size, rejects other methods. Server tests added to Pages CI gate.
- Validation: 258 existing + 22 improvement browser checks passed in Chromium with mocked boundaries (Node harness); 38 Deno tests passed; scan-universe type check passed. Original Python runner not run locally. Desktop expanded criteria screenshot inspected.
- All screener changes remain local; no Pages push or Edge deployment performed. No real account data used.

## Expanded desktop checks
- Previous release b0369d5: Pages and Edge workflows succeeded; live HTML returned HTTP 200 and included account guards, advanced filters and validation notes.
- Additional local fix: advanced chart modal follows light theme and iframe has accessible title. Regression reproduced before fix; keyboard focus entry/return passed.
- 68 desktop checks (64 screen/theme/layout/watch combinations with 36 synthetic rows plus 4 modal checks) added to tests/desktop.js and Python CI runner. Total Chromium checks: 348 passed, no page errors.
- Live three-sample screener initial load: 676–1003 ms, FCP 616–800 ms; no JS errors. These are unauthenticated initial loads, not scan completion or load tests. Journal initial load also sampled without account.
- Full WCAG certification, screen-reader listening, real-account watch data, concurrent upstream load and all possible filter parameter combinations remain outside this verification. Synthetic account fixtures do not establish real-account integration correctness.
- New modal change and desktop test additions remain local, not published.

## Accessibility and publication follow-up
- User chose synthetic data, no real test account available. No real-account integration validation claimed.
- Fixed inactive fundamental fields: native disabled state excludes keyboard editing; labels stay readable. Restoring enabled state tested.
- 350 regression checks passed; 32 axe WCAG 2 A/AA and 2.1 AA tagged audits across all eight screeners and two themes, results/login, had zero detected violations. Runs wait for animation completion and reset polluted test state.
- Local 1000-row stress fixture: first 120 table rows rendered in 11ms and gallery completed 1000 cards in 140ms in one sample. This is a local rendering check, not multi-user/backend capacity certification.
- Published commit ca967ac; Pages verification pending at this log entry. No actual NVDA/VoiceOver listening test performed; automatic checks are not accessibility certification.
Pages run 37683481867 completed successfully (both tests and deploy). Live publication verification follows in the chat.
