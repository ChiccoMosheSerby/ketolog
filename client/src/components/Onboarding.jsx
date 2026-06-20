import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import { useAuth } from '../lib/auth.jsx';
import './Onboarding.scss';

// First-run product tour. Shown once after sign-up (see auth.jsx), replayable
// from the menu. It spotlights the *real* elements in the app — switching to
// the right tab first — so the user learns where each feature actually lives.
// Anchors are tagged with data-tour="…"; tabs with data-tour-tab="…".

const PAD = 8; // breathing room around the spotlighted element
const GAP = 14; // distance between the element and the tooltip

// Switch the app to a given tab by clicking its real tab button. Works on both
// the desktop tab bar and the mobile carousel dots (same data attribute).
function selectTab(id) {
  document.querySelector(`[data-tour-tab="${id}"]`)?.click();
}

export default function Onboarding() {
  const { dismissOnboarding } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const steps = buildSteps(isMobile);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect in viewport coords; null = centered
  const [tip, setTip] = useState({ top: 0, left: 0, place: 'center', arrow: 0 });
  const [leaving, setLeaving] = useState(false);
  const tipRef = useRef(null);

  const step = steps[i];
  const last = i === steps.length - 1;

  const finish = useCallback(() => {
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
    setRect(null); // hide the old spotlight while the tab/carousel transitions

    // Wait out the tab switch / carousel scroll before measuring, then
    // re-measure once more in case the (animated) carousel was still settling.
    const delay = step.tab ? (isMobile ? 520 : 340) : 70;
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
  }, [i, step.anchor, step.tab, isMobile]);

  // Position the tooltip relative to the spotlight (or center it if no anchor).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { width: tw, height: th } = el.getBoundingClientRect();

    if (!rect) {
      setTip({ top: (vh - th) / 2, left: (vw - tw) / 2, place: 'center', arrow: 0 });
      return;
    }

    let place = 'bottom';
    let top = rect.top + rect.height + PAD + GAP;
    if (top + th > vh - 12) {
      const above = rect.top - PAD - GAP - th;
      if (above > 12) {
        place = 'top';
        top = above;
      } else {
        place = 'center';
        top = Math.max(12, (vh - th) / 2);
      }
    }
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, vw - tw - 12));
    const arrow = rect.left + rect.width / 2 - left; // arrow x within the tooltip
    setTip({ top, left, place, arrow: Math.max(18, Math.min(arrow, tw - 18)) });
  }, [rect, i]);

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

      <div
        ref={tipRef}
        className={'tour-tip place-' + tip.place}
        style={{ top: tip.top, left: tip.left }}
      >
        {tip.place !== 'center' && (
          <span className="tour-arrow" style={{ left: tip.arrow }} />
        )}

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
      text: 'בואו נכיר את הפיצ׳רים העיקריים — איפה כל דבר נמצא ואיך משתמשים בו. ייקח רק רגע.',
    },
    {
      anchor: 'carb-ring',
      tab: 'today',
      emoji: '🎯',
      title: 'תקציב הפחמימות היומי',
      text: 'הטבעת הזו מראה כמה פחמימות נטו צברת היום מול היעד שלך. כל עוד את/ה מתחת לקו — את/ה בירוק.',
    },
    {
      anchor: isMobile ? 'menu' : 'target',
      emoji: '⚖️',
      title: 'שינוי היעד היומי',
      text: isMobile
        ? 'היעד היומי הוא אישי. פותחים את התפריט (☰) כאן למעלה, ושם אפשר לשנות בכל רגע את יעד הפחמימות שלך — הטבעת תתעדכן בהתאם.'
        : 'היעד היומי הוא אישי. לחיצה על "יעד יומי" כאן פותחת עריכה מהירה — קובעים מספר חדש והטבעת מתעדכנת בהתאם.',
    },
    {
      anchor: 'tabs',
      emoji: '🧭',
      title: 'הניווט הראשי',
      text: `כאן עוברים בין "היום", "יומן" ו"המוצרים שלי". ${navHint}`,
    },
    {
      anchor: 'add-meal',
      tab: 'today',
      emoji: '🍳',
      title: 'הוספת ארוחה',
      text: 'כותבים תיאור חופשי של מה שאכלת, וה-AI מעריך פחמימות, שומן וחלבון. יש גם הקלטה קולית וכפתור לחישוב בלבד.',
    },
    {
      anchor: 'shortcuts',
      tab: 'today',
      emoji: '⚡',
      title: 'הוספה מהירה',
      text: 'מקום אחד מתקפל לכל הקיצורים: המוצרים השמורים שלך, תבניות ארוחה, ושכפול ארוחות אתמול. קליק מוסיף לפירוט הארוחה.',
    },
    {
      anchor: 'products',
      tab: 'products',
      emoji: '📦',
      title: 'המוצרים שלי',
      text: 'בלשונית הזו שומרים מוצרים קבועים שאת/ה אוכל/ת הרבה — הם יופיעו כתגיות מהירות בהוספת ארוחה.',
    },
    {
      anchor: 'barcode',
      tab: 'products',
      emoji: '📷',
      title: 'סריקת ברקוד',
      text: 'הכפתור הזה פותח את סורק הברקוד במצלמה — מכוונים אל הברקוד של המוצר וכל הערכים התזונתיים נמשכים אוטומטית. אפשר גם לזהות מוצר מתמונה או להקליד ברקוד ידנית.',
    },
    {
      anchor: 'chat',
      tab: 'today',
      emoji: '💬',
      title: 'קֶטוֹ — העוזר/ת החכם/ה',
      text: 'מהבועה הזו אפשר לשאול אם מוצר מתאים לקיטו, לבקש חלופה, לשלוח תמונה — ואפילו לבקש להוסיף ארוחה ליומן.',
    },
  ];
}
