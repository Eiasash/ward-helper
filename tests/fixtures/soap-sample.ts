/**
 * De-identified real SOAP note body, as emitted by ward-helper's SOAP path
 * for an acute-ward daily round. Used as the Phase-1 regression fixture for
 * the AZMA 4-field segmenter (`splitSoapFields`).
 *
 * No PHI: no name, ת.ז., or DOB — demographics are the generic "בן 62"
 * capsule line the model produces. Structurally faithful to a real note:
 * full S/O/A capsule + "בעיות:" + *domain bullets, P ("לביצוע:"), and the
 * parenthesized goal header "תוכנית טיפול (יעדי טיפול):" that the generic
 * `splitIntoSections` mis-segments.
 */
export const SOAP_SAMPLE_BODY = `דיווח המטופל:
מרגיש סביר. ישן טוב בלילה. כאב בירך שמאל סביב הפצע הניתוחי, מאוזן עם הטיפול. שתן דרך קטטר, יציאות תקינות. ללא קוצר נשימה או כאבים בחזה. משתף פעולה עם הצוות.

בדיקה גופנית וממצאי עזר:
חום 37.0, ל"ד 138/72, דופק 82, סטורציה 97% באוויר חדר.
בהכרה מלאה, מתמצא, משתף פעולה.
קולות לב סדירים ללא איוושות. כניסת אוויר סימטרית דו"צ ללא חרחורים. בטן רכה, לא רגישה, פעולת מעיים תקינה.
ירך שמאל: פצע ניתוחי לאחר NONEXCISIONAL DEBRIDEMENT, חבישה יבשה, ללא הפרשה מוגלתית, ללא אריתמה מתפשטת.
גפיים: ללא בצקות. פיסטולה בזרוע שמאל - thrill ו-bruit תקינים. צנתר מרכזי לדיאליזה - אתר נקי, ללא סימני זיהום.
תחושה ותנועה בגפיים תחתונות שמורים, DP מורגש דו"צ.

מסקנה והערכה:
בן 62, נשוי, רקע של ESRD על המודיאליזה כרונית, סוכרת, ומצב לאחר קיבוע שבר סאב-טרוכנטרי שמאל שהסתבך בזיהום פצע עם MRSA. POD2 לאחר NONEXCISIONAL DEBRIDEMENT.

בעיות:
*זיהומית - זיהום פצע ניתוחי MRSA לאחר debridement, POD2.
*אורתופדית - מצב לאחר קיבוע שבר סאב-טרוכנטרי שמאל.
*כלייתי - ESRD על המודיאליזה כרונית. Cr 3.99.
*המטולוגית - Hb 8.8, אנמיה כרונית.
*מטבולית - סוכרת, גלוקוז 244 בבוקר.
*תזונתי - אלבומין 2.8.
*כאב - מאוזן עם BUPRENORPHINE TD.
*נוגדי קרישה - ENOXAPARIN מוחזק על רקע POD2.

לביצוע:
המשך VANCOMYCIN IV - לקחת רמה לפני מנה הבאה.
החלפת חבישה היום.
דיאליזה לפי תוכנית.

תוכנית טיפול (יעדי טיפול):
בן 62 לאחר debridement פצע ניתוחי מזוהם MRSA. מטרה לטיפול אנטיביוטי ממוקד וריפוי פצע.`;
