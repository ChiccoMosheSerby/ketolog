import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import Logo from './Logo.jsx';
import './Login.scss';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else {
        const r = await register(email, password);
        // Pending accounts aren't signed in — show the "awaiting approval" note.
        if (r?.pending) setInfo(r.message || 'החשבון שלך ממתין לאישור מנהל.');
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo size={72} className="auth-logo" />
        <h1>KetoLog</h1>
        <p className="sub">{mode === 'login' ? 'התחברות לחשבון' : 'יצירת חשבון חדש'}</p>
        <form onSubmit={submit}>
          <div className="fld wide">
            <label>אימייל</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="fld wide" style={{ marginTop: 10 }}>
            <label>סיסמה</label>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && <div className="auth-err">{err}</div>}
          {info && <div className="auth-info">{info}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%' }}>
            {busy ? '…' : mode === 'login' ? 'התחבר' : 'הירשם'}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setErr('');
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? 'אין לך חשבון? הירשם' : 'יש לך כבר חשבון? התחבר'}
        </button>
      </div>
    </div>
  );
}
