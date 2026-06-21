import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import { useTheme } from '../lib/theme.js';
import CarbRing from './CarbRing.jsx';
import './Header.scss';

// The 3 live day summaries. `mini` shrinks them for the mobile top bar.
// "Today so far" is a circular gauge of today's net carbs against the budget.
function Stats({ stats, mini }) {
  return (
    <div className={'stats' + (mini ? ' stats-mini' : '')}>
      <div className="stat">
        <span className="num">{stats.avg}</span>
        <span className="lab">ממוצע יומי (גרם נטו)</span>
      </div>
      <div className="stat">
        <span className="num">{stats.days}</span>
        <span className="lab">ימים מתועדים</span>
      </div>
      <div className="stat stat-today" data-tour="carb-ring">
        <CarbRing
          consumed={stats.todayNum}
          target={stats.target}
          size={mini ? 40 : 50}
          stroke={mini ? 5 : 6}
        >
          <span className="ring-num">{stats.today}</span>
        </CarbRing>
        <span className="lab">היום מתוך {stats.target}</span>
      </div>
    </div>
  );
}

// Static keto ratio target — educational, not live data. On desktop it lives in
// the footer (its header slot is taken by the compact products panel); on mobile
// it stays in the drawer.
export function TargetLegend() {
  return (
    <div className="target target-mini">
      <div className="tt">היעד המאוזן בקיטו</div>
      <div className="target-bar">
        <i style={{ width: '72%', background: 'var(--olive)' }}></i>
        <i style={{ width: '23%', background: 'var(--protein)' }}></i>
        <i style={{ width: '5%', background: 'var(--amber)' }}></i>
      </div>
      <div className="target-legend">
        <span className="it">
          <span className="dot" style={{ background: 'var(--olive)' }}></span>שומן <b>70–75%</b>
        </span>
        <span className="it">
          <span className="dot" style={{ background: 'var(--protein)' }}></span>חלבון <b>20–25%</b>
        </span>
        <span className="it">
          <span className="dot" style={{ background: 'var(--amber)' }}></span>פחמ' <b>5–10%</b>
        </span>
      </div>
    </div>
  );
}

// Inline editor for the user's personal daily net-carb target.
function TargetSetting() {
  const { user, updateCarbTarget } = useAuth();
  const toast = useToast();
  const target = user?.dailyCarbTarget ?? 20;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(target));
  const [saving, setSaving] = useState(false);

  async function save() {
    const t = Number(val);
    if (!Number.isFinite(t) || t < 5 || t > 200) {
      toast('יעד יומי לא תקין (5–200 גרם)');
      return;
    }
    if (t !== target) {
      setSaving(true);
      try {
        await updateCarbTarget(t);
        toast('היעד היומי עודכן');
      } catch (e) {
        toast(e.message || 'העדכון נכשל');
      } finally {
        setSaving(false);
      }
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="target-set">
        <span>יעד יומי:</span>
        <input
          type="number"
          min="5"
          max="200"
          step="1"
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <button className="btn ghost mini" disabled={saving} onClick={save}>
          {saving ? '…' : 'שמור'}
        </button>
      </span>
    );
  }
  return (
    <button
      className="btn ghost mini"
      data-tour="target"
      onClick={() => {
        setVal(String(target));
        setEditing(true);
      }}
    >
      יעד יומי: {target} ג' ✎
    </button>
  );
}

function AccountActions({ onCopyData, onAction }) {
  const { user, logout, startOnboarding } = useAuth();
  const { theme, toggle } = useTheme();
  const replay = () => {
    startOnboarding();
    onAction?.(); // close the mobile drawer if open
  };
  return (
    <div className="userbar">
      <span className="uemail">{user?.email}</span>
      <TargetSetting />
      <button
        className="btn ghost mini"
        onClick={toggle}
        title={theme === 'dark' ? 'מצב בהיר' : 'מצב כהה'}
      >
        {theme === 'dark' ? '☀️ בהיר' : '🌙 כהה'}
      </button>
      <button className="btn ghost mini" onClick={replay}>
        סיור מודרך
      </button>
      <button className="btn ghost mini" onClick={onCopyData}>
        העתק נתונים
      </button>
      <button className="btn ghost mini" onClick={logout}>
        התנתק
      </button>
    </div>
  );
}

export default function Header({ stats, onCopyData }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer if we grow back to desktop.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  if (!isMobile) {
    return (
      <header className="top">
        <div className="headrow">
          <Stats stats={stats} />
          <AccountActions onCopyData={onCopyData} />
        </div>
      </header>
    );
  }

  return (
    <header className="top top-mobile">
      <div className="mbar">
        <button
          className="hamburger"
          aria-label="תפריט"
          aria-expanded={drawerOpen}
          data-tour="menu"
          onClick={() => setDrawerOpen(true)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <Stats stats={stats} mini />
      </div>

      <div className={'drawer-scrim' + (drawerOpen ? ' show' : '')} onClick={() => setDrawerOpen(false)} />
      <aside className={'drawer' + (drawerOpen ? ' open' : '')} aria-hidden={!drawerOpen}>
        <button className="drawer-close" aria-label="סגור" onClick={() => setDrawerOpen(false)}>
          ✕
        </button>
        <AccountActions onCopyData={onCopyData} onAction={() => setDrawerOpen(false)} />
        <TargetLegend />
      </aside>
    </header>
  );
}
