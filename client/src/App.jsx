import { useAuth } from './lib/auth.jsx';
import Login from './components/Login.jsx';
import Diary from './components/Diary.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import Onboarding from './components/Onboarding.jsx';
import MenuIntro from './components/MenuIntro.jsx';
import AppLinkConfirm from './components/AppLinkConfirm.jsx';
import { AppSkeleton } from './components/Skeleton.jsx';

export default function App() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) return <AppSkeleton />;
  if (!user) return <Login />;

  return (
    <>
      <Diary />
      {/* the keto chat runs on the account's AI key — hidden when AI is off */}
      {user?.ai?.enabled && <ChatWidget />}
      <AppLinkConfirm />
      {needsOnboarding && <Onboarding />}
      {/* one-time "what's new" spotlight for existing users (new header menu) */}
      {!needsOnboarding && <MenuIntro />}
    </>
  );
}
