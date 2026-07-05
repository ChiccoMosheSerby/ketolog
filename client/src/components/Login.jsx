import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth.jsx';
import { applyLang } from '../lib/i18n.js';
import Logo from './Logo.jsx';
import './Login.scss';

export default function Login() {
  const { login, register, forgotPassword } = useAuth();
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Language for the new account (required at sign-up). Defaults to the current
  // UI language; picking it also flips the auth screen live via applyLang.
  const [language, setLanguage] = useState(i18n.language === 'en' ? 'en' : 'he');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  // Switch view, clearing any leftover messages so they don't bleed across modes.
  function switchMode(next) {
    setErr('');
    setInfo('');
    setMode(next);
  }

  // Live-preview the chosen sign-up language on the auth screen itself.
  function chooseLanguage(next) {
    setLanguage(next);
    applyLang(next);
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else if (mode === 'forgot') {
        const msg = await forgotPassword(email);
        setInfo(msg || t('login.resetSent'));
      } else {
        const r = await register(email, password, language);
        // Pending accounts aren't signed in — show the "awaiting approval" note.
        if (r?.pending) setInfo(r.message || t('login.pendingApproval'));
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const sub =
    mode === 'login' ? t('login.subLogin') : mode === 'register' ? t('login.subRegister') : t('login.subForgot');
  const submitLabel =
    mode === 'login' ? t('login.doLogin') : mode === 'register' ? t('login.doRegister') : t('login.doForgot');

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo size={72} className="auth-logo" />
        <h1>KetoLog</h1>
        <p className="sub">{sub}</p>
        <form onSubmit={submit}>
          <div className="fld wide">
            <label>{t('login.email')}</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {mode !== 'forgot' && (
            <div className="fld wide" style={{ marginTop: 10 }}>
              <label>{t('login.password')}</label>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}
          {mode === 'register' && (
            <div className="fld wide" style={{ marginTop: 10 }}>
              <label>{t('login.languageLabel')}</label>
              <div className="auth-lang">
                <button
                  type="button"
                  className={language === 'en' ? 'on' : ''}
                  onClick={() => chooseLanguage('en')}
                >
                  {t('login.languageEnglish')}
                </button>
                <button
                  type="button"
                  className={language === 'he' ? 'on' : ''}
                  onClick={() => chooseLanguage('he')}
                >
                  {t('login.languageHebrew')}
                </button>
              </div>
            </div>
          )}
          {mode === 'login' && (
            <button type="button" className="auth-forgot" onClick={() => switchMode('forgot')}>
              {t('login.forgot')}
            </button>
          )}
          {err && <div className="auth-err">{err}</div>}
          {info && <div className="auth-info">{info}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%' }}>
            {busy ? '…' : submitLabel}
          </button>
        </form>
        {mode === 'forgot' ? (
          <button className="auth-switch" onClick={() => switchMode('login')}>
            {t('login.backToLogin')}
          </button>
        ) : (
          <button className="auth-switch" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? t('login.noAccount') : t('login.haveAccount')}
          </button>
        )}
      </div>
    </div>
  );
}
