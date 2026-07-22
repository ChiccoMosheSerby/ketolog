import { useCallback, useEffect, useState } from 'react';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import { useAuth } from '../lib/auth.jsx';
import './Onboarding.scss';

// First-run product tour. Shown once after sign-up (see auth.jsx), replayable
// from settings. It spotlights the *real* elements in the app — switching to
// the right tab first — so the user learns where each feature actually lives.
// Anchors are tagged with data-tour="…"; tabs with data-tour-tab="…".
//
// The spotlight moves to whatever element a step points at, but the tooltip
// CARD stays docked in ONE fixed place (bottom-center) across steps, so the
// Next button never chases the user around the screen. The card only flips to
// the top edge when the spotlighted element sits where the bottom card would be
// — so it never covers the very thing it's describing.

const PAD = 8; // breathing room around the spotlighted element

// Switch the app to a given tab by clicking its real tab button. Works on both
// the desktop tab bar and the mobile carousel dots (same data attribute).
function selectTab(id) {
  document.querySelector(`[data-tour-tab="${id}"]`)?.click();
}

// Open the settings modal by clicking the real gear button (its onClick also
// closes the mobile drawer, so this works on both layouts). No-op if it is
// already open.
function openSettings() {
  if (document.querySelector('.settings-modal')) return;
  document.querySelector('[data-tour="settings"]')?.click();
}

// Close the settings modal via its own close button, so React state stays in
// sync. No-op if it is not open.
function closeSettings() {
  document.querySelector('.settings-modal .settings-close')?.click();
}

// Open/close the products-picker popup (המוצרים והארוחות שלי) by clicking its
// real 🧺 button / close button, for the step that tours the picker itself.
function openPicker() {
  if (document.querySelector('.picker-modal')) return;
  document.querySelector('[data-tour="shortcuts"]')?.click();
}
function closePicker() {
  document.querySelector('.picker-modal .picker-close')?.click();
}

export default function Onboarding() {
  const { user, dismissOnboarding } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  // The copy adapts to whether AI features are on for this account (own API
  // key / the owner) — the flows differ, so the tour teaches the right one.
  const steps = buildSteps(isMobile, !!user?.ai?.enabled);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect in viewport coords; null = no spotlight
  const [leaving, setLeaving] = useState(false);

  const step = steps[i];
  const last = i === steps.length - 1;

  const finish = useCallback(() => {
    closeSettings(); // don't leave the settings modal open behind the tour
    closePicker(); // nor the products-picker popup
    selectTab('today'); // leave the user on the main tab
    setLeaving(true);
    setTimeout(() => dismissOnboarding(), 200);
  }, [dismissOnboarding]);

  const next = useCallback(() => (last ? finish() : setI((n) => n + 1)), [last, finish]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Locate (and keep tracking) the current step's anchor element.
  useEffect(() => {
    const locate = () => {
      if (!step.anchor) return setRect(null);
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const start = () => {
      if (step.anchor) {
        document
          .querySelector(`[data-tour="${step.anchor}"]`)
          ?.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      locate();
    };

    if (step.tab) selectTab(step.tab);
    // Open the modal a step lives inside (settings / products picker); close
    // the others (e.g. when the user steps back out to a non-modal step).
    if (step.modal === 'settings') openSettings();
    else closeSettings();
    if (step.modal === 'picker') openPicker();
    else closePicker();
    setRect(null); // hide the old spotlight while the tab/carousel/modal transitions

    // Wait out the tab switch / carousel scroll / modal render before measuring,
    // then re-measure once more in case things were still settling.
    const delay = step.modal ? (isMobile ? 460 : 320) : step.tab ? (isMobile ? 520 : 340) : 70;
    const t1 = setTimeout(start, delay);
    const t2 = setTimeout(locate, delay + 280);
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [i, step.anchor, step.tab, step.modal, isMobile]);

  // Keyboard: arrows move (RTL-aware), Enter advances, Esc skips.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowLeft' || e.key === 'Enter') next();
      else if (e.key === 'ArrowRight') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, finish]);

  const spotStyle = rect && {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // The card normally docks bottom-center and stays put (so Next never moves).
  // Only inside the products-picker steps it may flip to the top edge, when the
  // spotlighted element (the picker's footer buttons) sits under the card.
  const CARD_ZONE = 340; // ≈ tallest card + its margin
  const dockTop =
    step.modal === 'picker' &&
    !!rect &&
    rect.top + rect.height > window.innerHeight - CARD_ZONE;

  return (
    <div className={'tour-root' + (leaving ? ' leaving' : '')} role="dialog" aria-modal="true">
      {rect ? <div className="tour-spot" style={spotStyle} /> : <div className="tour-veil" />}

      <div className={'tour-tip ' + (dockTop ? 'dock-top' : 'dock-bottom')}>
        <button className="tour-skip" onClick={finish} aria-label="דלג">
          דלג/י
        </button>

        <div className="tour-tip-head">
          <span className="tour-emoji">{step.emoji}</span>
          <h2>{step.title}</h2>
        </div>
        <p>{step.text}</p>

        <div className="tour-dots" role="tablist" aria-label="שלבים">
          {steps.map((_, n) => (
            <button
              key={n}
              className={'tour-dot' + (n === i ? ' active' : '')}
              aria-label={'שלב ' + (n + 1)}
              aria-selected={n === i}
              onClick={() => setI(n)}
            />
          ))}
        </div>

        <div className="tour-nav">
          <button
            className="btn ghost mini"
            onClick={back}
            disabled={i === 0}
            style={i === 0 ? { visibility: 'hidden' } : undefined}
          >
            הקודם
          </button>
          <span className="tour-count">
            {i + 1} / {steps.length}
          </span>
          <button className="btn mini" onClick={next}>
            {last ? 'יאללה, מתחילים' : 'הבא'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Each step points at a real element (anchor) and, if needed, the tab it lives
// in. Anchorless steps show centered over a veil (welcome / concepts that have
// no single element). Copy adapts to the device AND to whether AI features are
// on for this account (`aiOn`) — no-key users learn the free Claude-link flow,
// key users learn the in-app one. Ordered along the real usage flow:
// budget → nav → composing a meal (all entry points) → editing / reusing logged
// meals → journal → insights → the products catalog → settings (incl. what an
// API key adds and how to set it up).
function buildSteps(isMobile, aiOn) {
  const navHint = isMobile
    ? 'החלקה שמאלה/ימינה מחליפה ביניהן.'
    : 'לחיצה על לשונית מחליפה את התצוגה.';
  return [
    {
      emoji: '🥑',
      title: 'ברוכים הבאים ליומן קטו',
      text: 'בואו נכיר את כל הפיצ׳רים — איפה כל דבר נמצא ואיך משתמשים בו, צעד אחרי צעד לפי סדר העבודה האמיתי. ייקח כשתי דקות, וכל שלב מדגיש לך את האזור באפליקציה.',
    },
    {
      anchor: 'carb-ring',
      tab: 'today',
      emoji: '🎯',
      title: 'תקציב הפחמימות היומי',
      text: 'הטבעת מראה כמה פחמימות נטו צברת היום מול היעד שלך. כל עוד את/ה מתחת לקו — את/ה בירוק. את היעד האישי אפשר לשנות בהגדרות.',
    },
    {
      anchor: 'tabs',
      emoji: '🧭',
      title: 'הניווט הראשי',
      text: `כאן עוברים בין "היום", "תובנות" ו"המוצרים שלי". ${navHint}`,
    },
    {
      anchor: 'add-meal',
      tab: 'today',
      emoji: '🍳',
      title: 'הוספת ארוחה — הלב של היומן',
      text: 'כאן מוסיפים ארוחה ליומן, ויש כמה דרכים לעשות את זה: מוצרים שמורים בקליק, תיאור חופשי בטקסט, או שכפול מארוחות קודמות. בשלבים הבאים נעבור על כולן.',
    },
    {
      anchor: 'shortcuts',
      tab: 'today',
      emoji: '⚡',
      title: 'הדרך המהירה: המוצרים השמורים שלך',
      text: 'הכפתור פותח את המוצרים והתבניות שלך לפי קטגוריות. קליק מוסיף לפירוט הארוחה, והסכום מחושב מקומית מהערכים המדויקים שלך — מיידי, בלי AI ובלי עלות. בואו נציץ פנימה.',
    },
    {
      anchor: 'picker',
      tab: 'today',
      modal: 'picker',
      emoji: '🧺',
      title: 'המוצרים והארוחות שלי — מבפנים',
      text: 'כך נראית הרשימה (כאן עם נתוני דוגמה): המוצרים שלך מקובצים בקטגוריות, עם חיפוש ומיון לפי שימוש / פחמימות / א״ב. בואו נעבור על מה שעושים כאן.',
    },
    {
      anchor: 'picker-add',
      tab: 'today',
      modal: 'picker',
      emoji: '➕',
      title: 'מוסיפים מוצר בקליק',
      text: 'לחיצה על ➕ (או על שורת המוצר) מוסיפה אותו לפירוט הארוחה; עוד לחיצה מגדילה כמות. ★ מצמיד מוצר אהוב לראש הרשימה, ולחיצה על שם המוצר פותחת את חלון הפרטים שלו.',
    },
    {
      anchor: 'picker-cat',
      tab: 'today',
      modal: 'picker',
      emoji: '🗂️',
      title: 'קטגוריות',
      text: 'לחיצה על כותרת פותחת/סוגרת קטגוריה. קטגוריות שיצרתם ניתנות לשינוי שם (✎) ולמחיקה (✕). כדי להעביר מוצר לקטגוריה אחרת — פותחים את חלון הפרטים שלו (לחיצה על השורה) ובוחרים שם קטגוריה.',
    },
    {
      anchor: 'picker-new-cat',
      tab: 'today',
      modal: 'picker',
      emoji: '🆕',
      title: 'קטגוריה חדשה',
      text: 'הכפתור יוצר קטגוריה חדשה משלכם — היא מופיעה מיד ברשימה, ומעבירים אליה מוצרים דרך חלון הפרטים של כל מוצר. גם קלוד בוחר מהקטגוריות האלה כשמוסיפים מוצר חדש.',
    },
    {
      anchor: 'picker-done',
      tab: 'today',
      modal: 'picker',
      emoji: '✅',
      title: 'ובסוף — מאשרים',
      text: 'מה שבחרתם מצטבר בשורת הפירוט שלמטה. לחיצה על "סיום" סוגרת את הרשימה וחוזרת לטופס עם הפירוט מוכן — נשאר רק ללחוץ ✓ כדי לחשב ולרשום את הארוחה. יש כאן גם שכפול של כל ארוחות אתמול בלחיצה.',
    },
    {
      anchor: 'meal-desc',
      tab: 'today',
      emoji: '⌨️',
      title: 'או: כותבים מה אכלת',
      text: aiOn
        ? 'בשדה הזה כותבים תיאור חופשי, למשל: "חביתה מ-3 ביצים, פרוסת גאודה ומלפפון". לא צריך להזין ערכים — ה-AI מפרק לפריטים ומעריך פחמימות, שומן וחלבון בלחיצה אחת.'
        : 'בשדה הזה כותבים תיאור חופשי, למשל: "חביתה מ-3 ביצים, פרוסת גאודה ומלפפון". לא צריך להזין ערכים — החישוב נעשה בצ׳אט קלוד שלך (בחינם), ומיד נראה איך.',
    },
    {
      anchor: 'meal-submit',
      tab: 'today',
      emoji: '✅',
      title: 'הכפתור הראשי — חשב ורשום',
      text: aiOn
        ? 'לחיצה על ✓ מחשבת את המאקרו ורושמת את הארוחה ביומן בלחיצה אחת. אם הערכים כבר מולאו (ממוצרים שמורים או מקישור של קלוד) — הוא פשוט רושם.'
        : 'ארוחה שמורכבת רק ממוצרים שמורים — ✓ מחשב ורושם מיד. כתבתם טקסט חופשי? ✓ יפתח את קלוד עם כל הנתונים; קלוד יחזיר קישור שממלא את הטופס כאן — ואז ✓ רושם.',
    },
    ...(aiOn
      ? [
          {
            anchor: 'claude-submit',
            tab: 'today',
            emoji: '🤖',
            title: 'אותו חישוב — בקלוד שלך',
            text: 'רוצים לחשב בצ׳אט קלוד האישי במקום בתוך האפליקציה (ללא עלות API)? הכפתור פותח את קלוד עם כל הנתונים, וקלוד מחזיר קישור שממלא את הטופס כאן.',
          },
        ]
      : []),
    {
      anchor: 'product-submit',
      tab: 'today',
      emoji: '📦',
      title: 'מוצר חדש — מאותה תיבת טקסט',
      text: 'כותבים את פרטי המוצר (למשל: "יוגורט יווני 5%, גביע 150 גרם") ולוחצים 📦. קלוד מחשב ערכים, בוחר קטגוריה מהרשימה שלך, ומחזיר קישור שפותח כאן אישור — בודקים, מתקנים ומאשרים.',
    },
    ...(aiOn
      ? [
          {
            anchor: 'calc-only',
            tab: 'today',
            emoji: '🧮',
            title: 'חישוב בלבד — בלי לרשום',
            text: 'מחשב את המאקרו של מה שכתבתם ומציג את הפירוט — בלי לשמור ליומן. שימושי כשרוצים רק לבדוק כמה פחמימות יש במשהו לפני שמחליטים.',
          },
        ]
      : []),
    {
      anchor: 'reset-form',
      tab: 'today',
      emoji: '↺',
      title: 'איפוס הטופס',
      text: 'מנקה את תיבת הטקסט והערכים ומחזיר את התאריך להיום — התחלה נקייה לארוחה הבאה.',
    },
    {
      anchor: 'meal-time',
      tab: 'today',
      emoji: '🕐',
      title: 'עריכת שעת הארוחה',
      text: 'לכל ארוחה שנשמרה יש שעה. הקש/י על השעה כדי לתקן אותה — מקלידים ספרות בלבד (למשל 0930) והיא נשמרת כ-09:30, והארוחה מסתדרת מחדש לפי הסדר הכרונולוגי.',
    },
    {
      anchor: 'meal-to-product',
      tab: 'today',
      emoji: '📦',
      title: 'מארוחה שנרשמה — למוצר שמור',
      text: 'ליד כל ארוחה ביומן יש כפתור 📦 — לחיצה שומרת את הארוחה כולה כמוצר ברשימה שלך: נותנים שם קצר ומאשרים. ככה הקטלוג נבנה מהאוכל האמיתי שלך.',
    },
    {
      anchor: 'item-to-product',
      tab: 'today',
      emoji: '🧩',
      title: 'וגם פריט בודד מתוך הארוחה',
      text: 'בפירוט הארוחה, לכל מרכיב יש 📦 משלו — שומר רק אותו כמוצר, עם הערכים ליחידה שלו (ביצה, פרוסה, כוס…). מושלם למרכיבים שחוזרים בהרבה ארוחות: פעם אחת שומרים, ומאז מוסיפים בקליק.',
    },
    {
      anchor: 'meal-actions',
      tab: 'today',
      emoji: '⭐',
      title: 'עוד פעולות על ארוחה',
      text: 'בתוך ארוחה פתוחה: ★ שומר אותה כתבנית לשימוש חוזר, ⧉ משכפל אותה ליום הנבחר, ו-✕ מוחק. יש גם ➕ שמוסיף את הטקסט שלה לתיבת ההוספה — בסיס לארוחה דומה.',
    },
    ...(aiOn
      ? [
          {
            anchor: 'chat',
            tab: 'today',
            emoji: '💬',
            title: 'קֶטוֹ — העוזר/ת החכם/ה',
            text: 'מהבועה הזו שואלים אם מוצר מתאים לקיטו, מבקשים חלופה, שולחים תמונה — ואפילו מבקשים להוסיף ארוחה ליומן. קֶטוֹ רואה את היומן שלך ועונה לפי הנתונים האמיתיים.',
          },
        ]
      : []),
    {
      anchor: 'journal',
      tab: 'today',
      emoji: '📖',
      title: 'היומן — כל הימים הקודמים',
      text: 'תחת היום הנוכחי מתקפל היומן המלא. פותחים אותו כדי לדפדף אחורה, לקפוץ לתאריך, ולראות את הארוחות והמאקרו של כל יום.',
    },
    {
      anchor: 'insights',
      tab: 'insights',
      emoji: '📈',
      title: 'תובנות',
      text: aiOn
        ? 'לוח המחוונים המלא: ממוצעים ורצפים, התקדמות תקופת הקיטו, מאזן אנרגיה, מגמת משקל ושיאים — וגם דוחות AI שבועיים/חודשיים שנכתבים אוטומטית ומזהים מגמות והמלצות.'
        : 'לוח המחוונים המלא — ממוצעים ורצפים, התקדמות תקופת הקיטו, מאזן אנרגיה, מגמת משקל ושיאים — עובד תמיד, בלי AI. דוחות התובנות האוטומטיים (שבועי/חודשי) נוספים למי שמגדיר מפתח API — עוד רגע נראה איפה.',
    },
    {
      anchor: 'products',
      tab: 'products',
      emoji: '🧺',
      title: 'המוצרים שלי',
      text: 'הקטלוג האישי שלך: מוצרים קבועים עם הערכים המדויקים שלהם, מסודרים בקטגוריות. מוסיפים בכמה דרכים — ידנית מהאריזה, דרך 📦 בהוספת ארוחה, מתוך ארוחות שנרשמו, או בסריקת ברקוד. ככל שהקטלוג גדל, יותר ארוחות נרשמות בקליק ובחינם.',
    },
    {
      anchor: 'barcode',
      tab: 'products',
      emoji: '📷',
      title: 'סריקת ברקוד',
      text: aiOn
        ? 'מכוונים את המצלמה לברקוד המוצר והערכים נמשכים ממסד מזון עולמי, עם דיוק משופר של ה-AI (סיבים, תוויות). אפשר גם לזהות מוצר מצילום האריזה — 📷 צילום או 🖼️ תמונה.'
        : 'מכוונים את המצלמה לברקוד המוצר והערכים התזונתיים נמשכים ממסד מזון עולמי — עובד גם בלי מפתח AI (חישוב גולמי). עם מפתח API הדיוק משתפר ומתווסף גם זיהוי מוצר מצילום.',
    },
    {
      anchor: isMobile ? 'menu' : 'settings',
      emoji: '⚙️',
      title: 'הגדרות',
      text: isMobile
        ? 'כל ההגדרות האישיות נמצאות בתפריט (☰) כאן למעלה. בואו נפתח אותן ונעבור על מה שכדאי להגדיר בהתחלה.'
        : 'כל ההגדרות האישיות נמצאות מאחורי הכפתור הזה. בואו נפתח אותן ונעבור על מה שכדאי להגדיר בהתחלה.',
    },
    {
      anchor: 'set-target',
      modal: 'settings',
      emoji: '🎯',
      title: 'יעד יומי',
      text: 'זה תקציב הפחמימות נטו (בגרמים) שאת/ה מכוון/ת אליו בכל יום — בדרך כלל 20–30 גרם בקיטו. הטבעת בראש המסך נמדדת מול היעד הזה. אפשר לשנות בכל עת.',
    },
    {
      anchor: 'set-loss',
      modal: 'settings',
      emoji: '📉',
      title: 'יעד ירידה במשקל',
      text: 'כמה ק"ג לחודש את/ה רוצה לרדת (0 = שימור). מהיעד הזה נגזר אוטומטית תקציב הקלוריות היומי: השריפה המחושבת שלך פחות הגרעון שהיעד דורש — אין צורך להזין יעד קלוריות ידני.',
    },
    {
      anchor: 'set-body',
      modal: 'settings',
      emoji: '📏',
      title: 'גובה ושנת לידה',
      text: 'יחד עם המין והמשקל, הנתונים האלה נותנים הערכה ראשונית של שריפת הקלוריות שלך (נוסחת Mifflin-St Jeor) — עד שיצטברו מספיק שקילות ואז החישוב עובר לנתונים האמיתיים שלך.',
    },
    {
      anchor: 'set-keto',
      modal: 'settings',
      emoji: '📅',
      title: 'יעד קיטו',
      text: 'כמה חודשים את/ה מתכנן/ת להיות בקיטו. זה מזין את מד ההתקדמות של תקופת הקיטו בתובנות. אפס = בלי יעד תקופה.',
    },
    {
      anchor: 'set-weight',
      modal: 'settings',
      emoji: '⚖️',
      title: 'שקילה',
      text: 'כאן מזינים את המשקל — מומלץ פעמיים בשבוע, באותו בוקר. השקילות מזינות את מגמת המשקל בתובנות ואת חישוב שריפת הקלוריות האמיתית שלך, והשמירה מיידית.',
    },
    {
      anchor: 'set-ai',
      modal: 'settings',
      emoji: '🤖',
      title: 'תכונות AI — אופציונלי',
      text: aiOn
        ? 'ה-AI פעיל בחשבון שלך. כאן רואים את הסטטוס, את השימוש החודשי בדולרים, ומגדירים תקציב חודשי — תקבל/י התראה כשמתקרבים אליו, עוד לפני שהקרדיט נגמר.'
        : 'בלי מפתח — הכל עובד דרך קלוד בחינם. מי שמדביק כאן מפתח API של Anthropic (מ-console.anthropic.com) מקבל: חישוב ארוחה בלחיצה אחת בתוך האפליקציה, את הצ׳אט קֶטוֹ, דוחות תובנות אוטומטיים, זיהוי מוצר מתמונה וברקוד מדויק יותר. המפתח נבדק, נשמר מוצפן ורץ על חשבונך — ואפשר להגדיר תקציב חודשי עם התראה.',
    },
    // WhatsApp service disabled for all users — restore this step with it.
    // {
    //   anchor: 'set-wa',
    //   modal: 'settings',
    //   emoji: '💬',
    //   title: 'WhatsApp',
    //   text: 'מזינים כאן מספר WhatsApp (כולל קידומת מדינה, למשל 972501234567) כדי לרשום ארוחות ולקבל עדכונים דרך וואטסאפ. אחרי מילוי השדות לוחצים "שמור".',
    // },
  ];
}
