import { useAuth } from './lib/auth.jsx';
import Login from './components/Login.jsx';
import Diary from './components/Diary.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import Onboarding from './components/Onboarding.jsx';
import AdminCatalog from './components/AdminCatalog.jsx';
import AppLinkConfirm from './components/AppLinkConfirm.jsx';

export default function App() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <div className="empty">טוען…</div>;
  if (!user) return <Login />;

  // /admin — the products-map / catalog-optimization page (admins only; the
  // server's SPA fallback serves index.html for any non-/api path).
  if (window.location.pathname === '/admin') {
    if (!user.isAdmin) {
      window.location.replace('/');
      return null;
    }
    return <AdminCatalog page onClose={() => (window.location.href = '/')} />;
  }

  return (
    <>
      <Diary />
      <ChatWidget />
      <AppLinkConfirm />
      {needsOnboarding && <Onboarding />}
    </>
  );
}
