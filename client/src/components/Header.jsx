import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import CarbRing from './CarbRing.jsx';
import SettingsModal from './SettingsModal.jsx';
import AdminUsage from './AdminUsage.jsx';
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

// Compact identity bar: email, a gear that opens the settings modal, and logout.
// Everything else (target, keto goal, WhatsApp, gender, theme, tour, export)
// lives inside the settings modal now.
function UserBar({ onOpenSettings, onOpenAdmin }) {
  const { user, logout } = useAuth();
  return (
    <div className="userbar">
      <span className="uemail">{user?.email}</span>
      {user?.isAdmin && (
        <button className="btn ghost mini" onClick={onOpenAdmin} title="שימוש ועלויות">
          💰 שימוש
        </button>
      )}
      {user?.isAdmin && (
        <a className="btn ghost mini" href="/admin" title="מפת מוצרים — ניהול הקטלוג">
          🗺️ מוצרים
        </a>
      )}
      <button className="btn ghost mini" onClick={onOpenSettings} title="הגדרות" data-tour="settings">
        ⚙ הגדרות
      </button>
      <button className="btn ghost mini" onClick={logout}>
        התנתק
      </button>
    </div>
  );
}

export default function Header({ stats, onExport }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

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

  const modals = (
    <>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onExport={onExport} />
      <AdminUsage open={adminOpen} onClose={() => setAdminOpen(false)} />
    </>
  );

  if (!isMobile) {
    return (
      <header className="top">
        <div className="headrow">
          <Stats stats={stats} />
          <UserBar
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAdmin={() => setAdminOpen(true)}
          />
        </div>
        {modals}
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
        <UserBar
          onOpenSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
          onOpenAdmin={() => { setDrawerOpen(false); setAdminOpen(true); }}
        />
        <TargetLegend />
      </aside>
      {modals}
    </header>
  );
}
