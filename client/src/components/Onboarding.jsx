import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

export default function Onboarding() {
  const { t } = useTranslation();
  const { dismissOnboarding } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const steps = buildSteps(isMobile, t);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null); // target rect in viewport coords; null = no spotlight
  const [leaving, setLeaving] = useState(false);

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
        <button className="tour-skip" onClick={finish} aria-label={t('onboarding.skipAria')}>
          {t('onboarding.skip')}
        </button>

        <div className="tour-tip-head">
          <span className="tour-emoji">{step.emoji}</span>
          <h2>{step.title}</h2>
        </div>
        <p>{step.text}</p>

        <div className="tour-dots" role="tablist" aria-label={t('onboarding.stepsAria')}>
          {steps.map((_, n) => (
            <button
              key={n}
              className={'tour-dot' + (n === i ? ' active' : '')}
              aria-label={t('onboarding.stepNumberAria', { number: n + 1 })}
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
            {t('onboarding.back')}
          </button>
          <span className="tour-count">
            {i + 1} / {steps.length}
          </span>
          <button className="btn mini" onClick={next}>
            {last ? t('onboarding.finish') : t('onboarding.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Each step points at a real element (anchor) and, if needed, the tab it lives
// in. The welcome step is anchorless (centered). Copy adapts to the device.
function buildSteps(isMobile, t) {
  // Products & the barcode scanner live in a dedicated tab on mobile, but sit at
  // the top of the "Today" grid on desktop — so point at the right place per device.
  const productsTab = isMobile ? 'products' : 'today';
  return [
    {
      emoji: '🥑',
      title: t('onboarding.welcomeTitle'),
      text: t('onboarding.welcomeBody'),
    },
    {
      anchor: 'carb-ring',
      tab: 'today',
      emoji: '🎯',
      title: t('onboarding.carbRingTitle'),
      text: t('onboarding.carbRingBody'),
    },
    {
      anchor: 'add-meal',
      tab: 'today',
      emoji: '🍳',
      title: t('onboarding.addMealTitle'),
      text: t('onboarding.addMealBody'),
    },
    {
      anchor: 'shortcuts',
      tab: 'today',
      emoji: '⚡',
      title: t('onboarding.shortcutsTitle'),
      text: t('onboarding.shortcutsBody'),
    },
    {
      anchor: 'chat',
      tab: 'today',
      emoji: '💬',
      title: t('onboarding.chatTitle'),
      text: t('onboarding.chatBody'),
    },
    {
      anchor: 'journal',
      tab: 'today',
      emoji: '📖',
      title: t('onboarding.journalTitle'),
      text: t('onboarding.journalBody'),
    },
    {
      anchor: 'tabs',
      emoji: '🧭',
      title: t('onboarding.navTitle'),
      text: isMobile ? t('onboarding.navBodyMobile') : t('onboarding.navBodyDesktop'),
    },
    {
      anchor: 'insights',
      tab: 'insights',
      emoji: '📈',
      title: t('onboarding.insightsTitle'),
      text: t('onboarding.insightsBody'),
    },
    {
      anchor: 'products',
      tab: productsTab,
      emoji: '📦',
      title: t('onboarding.productsTitle'),
      text: t('onboarding.productsBody'),
    },
    {
      anchor: 'barcode',
      tab: productsTab,
      emoji: '📷',
      title: t('onboarding.barcodeTitle'),
      text: t('onboarding.barcodeBody'),
    },
    {
      anchor: isMobile ? 'menu' : 'settings',
      emoji: '⚙️',
      title: t('onboarding.settingsTitle'),
      text: isMobile ? t('onboarding.settingsBodyMobile') : t('onboarding.settingsBodyDesktop'),
    },
  ];
}
