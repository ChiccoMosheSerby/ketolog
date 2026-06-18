import { useAuth } from './lib/auth.jsx';
import Login from './components/Login.jsx';
import Diary from './components/Diary.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">טוען…</div>;
  return user ? <Diary /> : <Login />;
}
