import { useCallback, useEffect, useRef, useState } from 'react';
import { kcalZone } from '../lib/helpers.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import CarbRing from './CarbRing.jsx';
import SettingsModal from './SettingsModal.jsx';
import AdminUsage from './AdminUsage.jsx';
import UserMenu from './UserMenu.jsx';
import MessagesPanel from './MessagesPanel.jsx';
import BugReportModal from './BugReportModal.jsx';
import AdminBugs from './AdminBugs.jsx';
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
      {stats.avgKcal != null && (() => {
        const kz = kcalZone(stats.avgKcal, stats.kcalTarget);
        return (
          <div className="stat" title={kz?.cap}>
            <span className="num" style={kz ? { color: kz.color } : undefined}>
              ~{stats.avgKcal}
            </span>
            <span className="lab">
              {stats.kcalTarget ? `ממוצע קק"ל (יעד ${stats.kcalTarget})` : 'ממוצע קק"ל ליום'}
            </span>
          </div>
        );
      })()}
      <div className="stat stat-today" data-tour="carb-ring">
        <CarbRing
          consumed={stats.todayNum}
          target={stats.target}
          size={mini ? 34 : 38}
          stroke={mini ? 4 : 2}
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

export default function Header({ stats, onExport, onExportExcel, firstDate, days, onSaveWeight }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // when true, the settings modal opens scrolled to the AI/API-key section
  const [settingsFocusAi, setSettingsFocusAi] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminBugsOpen, setAdminBugsOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [msgsOpen, setMsgsOpen] = useState(false);
  const toast = useToast();
  // unread in-app messages — drives the badge in the user menu / hamburger dot
  const [unread, setUnread] = useState(0);
  // admin only: bug reports still waiting for an answer
  const [openBugs, setOpenBugs] = useState(0);
  // last-seen counts, so a mid-session increase can pop a toast (null = first
  // load — badges only, no toast for things that were already waiting)
  const seenRef = useRef(null);
  // the drawer stays mounted (it slides), so the trap keys off drawerOpen
  const drawerRef = useFocusTrap(drawerOpen);

  // Check the inbox on load and then every couple of minutes (volume is tiny).
  // A count that grew since the previous check means something new arrived —
  // surface it with a toast on top of the badge.
  const checkInbox = useCallback(() => {
    api
      .getMessages()
      .then((r) => {
        const bugs = r.openBugs || 0;
        setUnread(r.unread);
        setOpenBugs(bugs);
        const seen = seenRef.current;
        if (seen && r.unread > seen.unread) toast('📬 הודעה חדשה — פתחו את ההודעות בתפריט');
        else if (seen && bugs > seen.openBugs) toast('🐞 התקבל דיווח תקלה חדש');
        seenRef.current = { unread: r.unread, openBugs: bugs };
      })
      .catch(() => {});
  }, [toast]);

  useEffect(() => {
    checkInbox();
    const t = setInterval(checkInbox, 120_000);
    return () => clearInterval(t);
  }, [checkInbox]);

  // The guided tour (and anything else) can open settings without knowing where
  // the button lives — it now sits inside the user-menu dropdown.
  useEffect(() => {
    const openSettings = () => {
      setDrawerOpen(false);
      setSettingsOpen(true);
    };
    window.addEventListener('ketolog:openSettings', openSettings);
    return () => window.removeEventListener('ketolog:openSettings', openSettings);
  }, []);

  // One dispatcher for every user-menu item (dropdown + drawer list).
  const onMenuAction = useCallback((what) => {
    setDrawerOpen(false);
    if (what === 'messages') setMsgsOpen(true);
    else if (what === 'usage') setAdminOpen(true);
    else if (what === 'adminBugs') setAdminBugsOpen(true);
    else if (what === 'settings') setSettingsOpen(true);
    else if (what === 'apiKey') {
      setSettingsFocusAi(true);
      setSettingsOpen(true);
    } else if (what === 'bugReport') setBugOpen(true);
  }, []);
  const onMessagesRead = useCallback(() => {
    setUnread(0);
    if (seenRef.current) seenRef.current.unread = 0;
  }, []);

  // Close the drawer if we grow back to desktop.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // Escape closes the drawer, like every other popup.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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
      <SettingsModal
        open={settingsOpen}
        focusAi={settingsFocusAi}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocusAi(false);
        }}
        onExport={onExport}
        onExportExcel={onExportExcel}
        firstDate={firstDate}
        days={days}
        onSaveWeight={onSaveWeight}
      />
      <AdminUsage open={adminOpen} onClose={() => setAdminOpen(false)} />
      <AdminBugs
        open={adminBugsOpen}
        onClose={() => {
          setAdminBugsOpen(false);
          // replying/closing reports changes the open count — refresh the badge
          checkInbox();
        }}
      />
      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
      <MessagesPanel open={msgsOpen} onClose={() => setMsgsOpen(false)} onRead={onMessagesRead} />
    </>
  );

  if (!isMobile) {
    return (
      <header className="top">
        <div className="headrow">
          <Stats stats={stats} />
          <UserMenu unread={unread} openBugs={openBugs} onAction={onMenuAction} />
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
          {unread + openBugs > 0 && (
            <i className="ham-dot" aria-label={`${unread + openBugs} עדכונים חדשים`} />
          )}
        </button>
        <Stats stats={stats} mini />
      </div>

      <div className={'drawer-scrim' + (drawerOpen ? ' show' : '')} onClick={() => setDrawerOpen(false)} />
      <aside
        className={'drawer' + (drawerOpen ? ' open' : '')}
        aria-hidden={!drawerOpen}
        role="dialog"
        aria-modal="true"
        aria-label="תפריט"
        ref={drawerRef}
        tabIndex={-1}
      >
        <button className="drawer-close" aria-label="סגור" onClick={() => setDrawerOpen(false)}>
          ✕
        </button>
        <UserMenu variant="list" unread={unread} openBugs={openBugs} onAction={onMenuAction} />
        <TargetLegend />
      </aside>
      {modals}
    </header>
  );
}
