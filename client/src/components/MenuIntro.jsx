import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './Onboarding.scss'; // reuses the tour's spotlight + card styles

// One-time "what's new" spotlight for EXISTING users who just received the new
// header menu (messages, bug reports, API-key shortcut). Brand-new accounts
// skip it — their full onboarding tour already covers the menu. Dismissal is
// persisted per user in localStorage, like the tour's own flag.
const introKey = (email) => 'ketolog:menuIntro:' + (email || '').toLowerCase();
const onbKey = (email) => 'ketolog:onboarded:' + (email || '').toLowerCase();

export default function MenuIntro() {
  const { user, startOnboarding } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState(null);
  const [leaving, setLeaving] = useState(false);

  // Decide once per session whether this user should see the intro.
  useEffect(() => {
    if (!user?.email) return;
    let seen = null;
    let onb = null;
    try {
      seen = localStorage.getItem(introKey(user.email));
      onb = localStorage.getItem(onbKey(user.email));
    } catch {
      return; // storage unavailable — don't risk showing it on every load
    }
    if (seen) return;
    if (onb === 'pending') {
      // fresh sign-up: the full tour covers the menu — mark the intro done
      try {
        localStorage.setItem(introKey(user.email), 'done');
      } catch {
        /* ignore */
      }
      return;
    }
    setShow(true);
  }, [user]);

  // Spotlight the menu trigger (desktop) / hamburger (mobile) and track it.
  useEffect(() => {
    if (!show) return;
    const locate = () => {
      const el = document.querySelector(isMobile ? '[data-tour="menu"]' : '[data-tour="usermenu"]');
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    locate();
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [show, isMobile]);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(introKey(user?.email), 'done');
    } catch {
      /* ignore */
    }
    setLeaving(true);
    setTimeout(() => setShow(false), 200);
  }

  function openTour() {
    dismiss();
    startOnboarding();
  }

  const PAD = 6;
  const spotStyle = rect && {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  return (
    <div className={'tour-root' + (leaving ? ' leaving' : '')} role="dialog" aria-modal="true" aria-label="מה חדש">
      {rect ? <div className="tour-spot" style={spotStyle} /> : <div className="tour-veil" />}

      <div className="tour-tip dock-bottom">
        <button className="tour-skip" onClick={dismiss} aria-label="סגור">
          סגירה
        </button>

        <div className="tour-tip-head">
          <span className="tour-emoji">🎉</span>
          <h2>חדש: תפריט משתמש</h2>
        </div>
        <p>
          {isMobile ? 'התפריט (☰) כאן למעלה התחדש' : 'הכפתור המודגש כאן למעלה התחדש'} — עכשיו יש בו
          📬 הודעות (תשובות, עדכונים והודעות מערכת), 🐞 דיווח על תקלה עם צילומי מסך, 🔑 קיצור למפתח
          API, מצב בהיר/כהה והגדרות. הפירוט המלא מחכה לך בהודעות.
        </p>

        <div className="tour-nav" style={{ marginTop: 14 }}>
          <button className="btn ghost mini" onClick={openTour}>
            לסיור המעודכן
          </button>
          <button className="btn mini" onClick={dismiss}>
            הבנתי
          </button>
        </div>
      </div>
    </div>
  );
}
