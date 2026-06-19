import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './Header.scss';

// The 3 live day summaries. `mini` shrinks them for the mobile top bar.
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
      <div className="stat">
        <span className="num">{stats.today}</span>
        <span className="lab">היום עד כה</span>
      </div>
    </div>
  );
}

// Static keto ratio target — educational, not live data.
function TargetLegend() {
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

function AccountActions({ onCopyData }) {
  const { user, logout } = useAuth();
  return (
    <div className="userbar">
      <span className="uemail">{user?.email}</span>
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
          <TargetLegend />
        </div>
        <AccountActions onCopyData={onCopyData} />
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
        <AccountActions onCopyData={onCopyData} />
        <TargetLegend />
      </aside>
    </header>
  );
}
