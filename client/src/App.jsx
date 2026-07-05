import { useTranslation } from 'react-i18next';
import { useAuth } from './lib/auth.jsx';
import Login from './components/Login.jsx';
import Diary from './components/Diary.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import Onboarding from './components/Onboarding.jsx';

export default function App() {
  const { user, loading, needsOnboarding } = useAuth();
  const { t } = useTranslation();
  if (loading) return <div className="empty">{t('app.loading')}</div>;
  if (!user) return <Login />;
  return (
    <>
      <Diary />
      <ChatWidget />
      {needsOnboarding && <Onboarding />}
    </>
  );
}
