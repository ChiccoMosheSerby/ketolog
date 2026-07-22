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

export default function Onboarding() {
  const { dismissOnboarding } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const steps = buildSteps(isMobile);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect in viewport coords; null = no spotlight
  const [leaving, setLeaving] = useState(false);

  const step = steps[i];
  const last = i === steps.length - 1;

  const finish = useCallback(() => {
    closeSettings(); // don't leave the settings modal open behind the tour
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
    // Open the settings modal for steps that live inside it; close it otherwise
    // (e.g. when the user steps back out to an earlier, non-modal step).
    if (step.modal === 'settings') openSettings();
    else closeSettings();
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

  return (
    <div className={'tour-root' + (leaving ? ' leaving' : '')} role="dialog" aria-modal="true">
      {rect ? <div className="tour-spot" style={spotStyle} /> : <div className="tour-veil" />}

      <div className="tour-tip dock-bottom">
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
// in. The welcome step is anchorless (centered). Copy adapts to the device.
function buildSteps(isMobile) {
  const navHint = isMobile
    ? 'החלקה שמאלה/ימינה מחליפה ביניהן.'
    : 'לחיצה על לשונית מחליפה את התצוגה.';
  return [
    {
      emoji: '🥑',
      title: 'ברוכים הבאים ליומן קטו',
      text: 'בואו נכיר את כל הפיצ׳רים — איפה כל דבר נמצא ואיך משתמשים בו. ייקח פחות מדקה, וכל שלב מדגיש לך את האזור באפליקציה.',
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
      title: 'הוספת ארוחה',
      text: 'כאן מוסיפים ארוחה ליומן. בשלבים הבאים נראה בדיוק איך — מה כותבים ואיזה כפתור לוחצים.',
    },
    {
      anchor: 'meal-desc',
      tab: 'today',
      emoji: '⌨️',
      title: 'כותבים מה אכלת',
      text: 'בשדה הזה כותבים תיאור חופשי, למשל: "חביתה מ-3 ביצים, פרוסת גאודה ומלפפון". לא צריך להזין ערכים — ה-AI מפרק לפריטים ומעריך פחמימות, שומן וחלבון. יש גם 🎤 הקלטה קולית במקום להקליד.',
    },
    {
      anchor: 'shortcuts',
      tab: 'today',
      emoji: '⚡',
      title: 'הוספה מהירה מהמוצרים שלך',
      text: 'הכפתור פותח את כל המוצרים והארוחות השמורות שלך, מסודרים לפי קטגוריות. קליק מוסיף ישר לפירוט הארוחה — וגם שכפול הארוחות של אתמול נמצא שם.',
    },
    {
      anchor: 'meal-submit',
      tab: 'today',
      emoji: '✅',
      title: 'חשב והוסף ארוחה',
      text: 'לוחצים על "חשב והוסף ארוחה" — המערכת מחשבת את המאקרו ושומרת את הארוחה ליומן. רוצים רק לבדוק בלי לשמור? "חשב פחמימות בלבד" מציג את ההערכה מבלי לרשום.',
    },
    {
      anchor: 'meal-time',
      tab: 'today',
      emoji: '🕐',
      title: 'עריכת שעת הארוחה',
      text: 'לכל ארוחה שנשמרה יש שעה. הקש/י על השעה כדי לתקן אותה — מקלידים ספרות בלבד (למשל 0930) והיא נשמרת כ-09:30, והארוחה מסתדרת מחדש לפי הסדר הכרונולוגי.',
    },
    {
      anchor: 'chat',
      tab: 'today',
      emoji: '💬',
      title: 'קֶטוֹ — העוזר/ת החכם/ה',
      text: 'מהבועה הזו שואלים אם מוצר מתאים לקיטו, מבקשים חלופה, שולחים תמונה — ואפילו מבקשים להוסיף ארוחה ליומן. קֶטוֹ רואה את היומן שלך ועונה לפי הנתונים האמיתיים.',
    },
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
      title: 'תובנות חכמות',
      text: 'כאן חיים לוח המחוונים והדוחות: ממוצעים ורצפים, התקדמות תקופת הקיטו, ודוחות AI שבועיים/חודשיים שנכתבים אוטומטית ומזהים מגמות והמלצות — בלי שתצטרך/י לבקש.',
    },
    {
      anchor: 'products',
      tab: 'products',
      emoji: '📦',
      title: 'המוצרים שלי',
      text: 'שומרים כאן מוצרים קבועים שאת/ה אוכל/ת הרבה, עם הערכים התזונתיים שלהם. הם קופצים כתגיות מהירות בהוספת ארוחה — וה-AI משתמש בערכים המדויקים שלך.',
    },
    {
      anchor: 'barcode',
      tab: 'products',
      emoji: '📷',
      title: 'סריקת ברקוד',
      text: 'הכפתור פותח את סורק הברקוד במצלמה — מכוונים לברקוד המוצר וכל הערכים התזונתיים נמשכים אוטומטית. אפשר גם לזהות מוצר מתמונה או להקליד ברקוד ידנית.',
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
      anchor: 'set-keto',
      modal: 'settings',
      emoji: '📅',
      title: 'יעד קיטו',
      text: 'כמה חודשים את/ה מתכנן/ת להיות בקיטו. זה מזין את מד ההתקדמות של תקופת הקיטו בתובנות. אפס = בלי יעד תקופה.',
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
