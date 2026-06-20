import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const r = await api.login(email, password);
    setToken(r.token);
    setUser(r.user);
  }
  async function register(email, password) {
    const r = await api.register(email, password);
    setToken(r.token);
    setUser(r.user);
  }
  function logout() {
    setToken(null);
    setUser(null);
  }
  async function updateCarbTarget(dailyCarbTarget) {
    const r = await api.updateProfile({ dailyCarbTarget });
    setUser(r.user);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateCarbTarget }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
