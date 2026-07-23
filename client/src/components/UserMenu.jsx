import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.js';
import './UserMenu.scss';

// The header's account menu. Desktop: a person button that opens a small
// dropdown card — user name on top, then messages / usage / theme / settings /
// bug report, and logout at the bottom. In the mobile drawer the same items
// render as a flat list (variant="list").
//
// The tour opens settings via the 'ketolog:openSettings' event (see
// Onboarding.jsx), so nothing here needs to be visible for it to work.

// display name: profile name, or the email prefix as a fallback
export function displayName(user) {
  return user?.name?.trim() || user?.email?.split('@')[0] || '';
}

function MenuItems({ user, unread, openBugs, onAction, isAdmin }) {
  const { theme, toggle } = useTheme();
  const { logout } = useAuth();
  return (
    <>
      <div className="umenu-id">
        <span className="umenu-avatar" aria-hidden="true">
          {displayName(user).charAt(0).toUpperCase() || '?'}
        </span>
        <span className="umenu-who">
          <b>{displayName(user)}</b>
          <small>{user?.email}</small>
        </span>
      </div>

      <div className="umenu-sep" />

      <button className="umenu-item" onClick={() => onAction('messages')}>
        <span>📬 הודעות</span>
        {unread > 0 && <span className="umenu-badge">{unread}</span>}
      </button>

      {isAdmin && (
        <button className="umenu-item" onClick={() => onAction('usage')}>
          <span>💰 שימוש</span>
        </button>
      )}
      {isAdmin && (
        <button className="umenu-item" onClick={() => onAction('adminBugs')}>
          <span>🐞 דיווחי תקלות</span>
          {openBugs > 0 && <span className="umenu-badge">{openBugs}</span>}
        </button>
      )}

      <div className="umenu-sep" />

      <button className="umenu-item" onClick={toggle}>
        <span>{theme === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה'}</span>
      </button>
      <button className="umenu-item" data-tour="settings" onClick={() => onAction('settings')}>
        <span>⚙️ הגדרות</span>
      </button>
      {/* shortcut straight to the BYO-key field — hidden for the owner, who
          rides on the app's key and has no key input */}
      {!user?.ai?.canToggle && (
        <button className="umenu-item" onClick={() => onAction('apiKey')}>
          <span>🔑 מפתח API</span>
          {!user?.ai?.hasOwnKey && <span className="umenu-hint">לא הוגדר</span>}
        </button>
      )}
      <button className="umenu-item" onClick={() => onAction('bugReport')}>
        <span>🐞 דיווח על תקלה</span>
      </button>

      <div className="umenu-sep" />

      <button className="umenu-item umenu-logout" onClick={logout}>
        <span>התנתק</span>
      </button>
    </>
  );
}

export default function UserMenu({ unread = 0, openBugs = 0, onAction, variant = 'dropdown' }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  // anything waiting inside the menu lights up the trigger dot
  const attention = unread + (isAdmin ? openBugs : 0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on click-outside / Escape (dropdown only).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A chosen action closes the menu before opening its modal.
  const act = (what) => {
    setOpen(false);
    onAction(what);
  };

  if (variant === 'list') {
    return (
      <div className="umenu-list">
        <MenuItems user={user} unread={unread} openBugs={openBugs} onAction={onAction} isAdmin={isAdmin} />
      </div>
    );
  }

  return (
    <div className="umenu" ref={rootRef}>
      <button
        className="umenu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour="usermenu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="umenu-avatar" aria-hidden="true">
          {displayName(user).charAt(0).toUpperCase() || '?'}
        </span>
        <span className="umenu-name">{displayName(user)}</span>
        {attention > 0 && <span className="umenu-dot" aria-label={`${attention} עדכונים חדשים`} />}
        <span className="umenu-chev" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="umenu-pop" role="menu">
          <MenuItems user={user} unread={unread} openBugs={openBugs} onAction={act} isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}
