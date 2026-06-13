import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';

function AppGate() {
  const { user, loading, isAuthEnabled } = useAuth();

  if (!isAuthEnabled) return <Dashboard />;
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (!user) return <LoginPage />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}
