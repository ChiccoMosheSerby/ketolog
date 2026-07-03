import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken } from './api.js';

const AuthContext = createContext(null);

// First-run tour state is persisted per-user so it survives a refresh
// (including mid-tour) but never re-appears once finished or skipped.
//   absent   → existing user, never offered the tour (don't auto-show)
//   'pending'→ signed up, tour not yet completed (auto-show, even after reload)
//   'done'   → completed or skipped (don't auto-show)
const onbKey = (email) => (email ? 'ketolog:onboarded:' + email.toLowerCase() : null);
function readOnb(email) {
  const k = onbKey(email);
  try {
    return k ? localStorage.getItem(k) : null;
  } catch {
    return null;
  }
}
function writeOnb(email, val) {
  const k = onbKey(email);
  try {
    if (k) localStorage.setItem(k, val);
  } catch {
    /* storage unavailable — fall back to in-memory state only */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // First-run product tour: shown once, right after a successful sign-up.
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setUser(r.user);
        // Resume an unfinished tour after a reload.
        if (readOnb(r.user?.email) === 'pending') setNeedsOnboarding(true);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const r = await api.login(email, password);
    setToken(r.token);
    setUser(r.user);
    if (readOnb(r.user?.email) === 'pending') setNeedsOnboarding(true);
  }
  async function register(email, password) {
    const r = await api.register(email, password);
    // Non-admin sign-ups come back without a token — the account is created but
    // awaits admin approval. Surface the message instead of logging them in.
    if (!r.token) return { pending: true, message: r.message };
    setToken(r.token);
    setUser(r.user);
    writeOnb(r.user?.email, 'pending');
    setNeedsOnboarding(true);
    return { pending: false };
  }
  // Request a password-reset email. Returns the server's generic message; never
  // reveals whether the address has an account. Doesn't touch auth state.
  async function forgotPassword(email) {
    const r = await api.forgotPassword(email);
    return r?.message || '';
  }
  // Replay the tour on demand (e.g. from the menu). Doesn't touch the
  // saved 'done'/'pending' flag — dismissing it will settle that again.
  function startOnboarding() {
    setNeedsOnboarding(true);
  }
  function dismissOnboarding() {
    writeOnb(user?.email, 'done');
    setNeedsOnboarding(false);
  }
  function logout() {
    setToken(null);
    setUser(null);
    setNeedsOnboarding(false);
  }
  async function updateCarbTarget(dailyCarbTarget) {
    const r = await api.updateProfile({ dailyCarbTarget });
    setUser(r.user);
  }
  async function updateKetoGoal({ ketoGoalMonths }) {
    const r = await api.updateProfile({ ketoGoalMonths });
    setUser(r.user);
  }
  async function updateWhatsapp(whatsappPhone) {
    const r = await api.updateProfile({ whatsappPhone });
    setUser(r.user);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        forgotPassword,
        logout,
        updateCarbTarget,
        updateKetoGoal,
        updateWhatsapp,
        needsOnboarding,
        startOnboarding,
        dismissOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
