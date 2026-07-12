import { useAuth } from './lib/auth.jsx';
import Login from './components/Login.jsx';
import Diary from './components/Diary.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import Onboarding from './components/Onboarding.jsx';
import AppLinkConfirm from './components/AppLinkConfirm.jsx';

export default function App() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <div className="empty">טוען…</div>;
  if (!user) return <Login />;

  return (
    <>
      <Diary />
      <ChatWidget />
      <AppLinkConfirm />
      {needsOnboarding && <Onboarding />}
    </>
  );
}
