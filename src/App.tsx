import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth/AuthProvider';
import { HouseholdProvider, useHousehold } from './household/HouseholdProvider';
import { isConfigured } from './lib/supabase';
import { LoadingState, ErrorState } from './components/ui/ui';
import { AppShell } from './components/layout/AppShell';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages';
import { WelcomePage } from './pages/WelcomePage';
import { JoinPage } from './pages/JoinPage';
import { DashboardPage } from './pages/DashboardPage';

const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const CleaningPage = lazy(() => import('./pages/CleaningPage'));
const ShoppingPage = lazy(() => import('./pages/ShoppingPage'));
const MealsPage = lazy(() => import('./pages/MealsPage'));
const BudgetPage = lazy(() => import('./pages/BudgetPage'));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'));
const PetsPage = lazy(() => import('./pages/PetsPage'));
const PlantsPage = lazy(() => import('./pages/PlantsPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function RequireHousehold({ children }: { children: ReactNode }) {
  const { household, loading, error, reload } = useHousehold();
  if (loading) return <LoadingState />;
  if (error) return <div className="p-4"><ErrorState error={error} onRetry={() => void reload()} /></div>;
  if (!household) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function NotConfigured() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-xl font-bold">HomeHub</h1>
      <p className="text-slate-700">{t('setup.notConfigured')}</p>
    </div>
  );
}

export function App() {
  if (!isConfigured) return <NotConfigured />;
  const page = (node: ReactNode) => <Suspense fallback={<LoadingState />}>{node}</Suspense>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/*" element={
        <RequireAuth>
          <HouseholdProvider>
            <Routes>
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="/join/:token" element={<JoinPage />} />
              <Route path="/*" element={
                <RequireHousehold>
                  <AppShell>
                    <Routes>
                      <Route index element={<DashboardPage />} />
                      <Route path="tasks" element={page(<TasksPage />)} />
                      <Route path="tasks/:occurrenceId" element={page(<TaskDetailPage />)} />
                      <Route path="cleaning" element={page(<CleaningPage />)} />
                      <Route path="shopping" element={page(<ShoppingPage />)} />
                      <Route path="meals" element={page(<MealsPage />)} />
                      <Route path="budget" element={page(<BudgetPage />)} />
                      <Route path="vehicles/*" element={page(<VehiclesPage />)} />
                      <Route path="pets/*" element={page(<PetsPage />)} />
                      <Route path="plants/*" element={page(<PlantsPage />)} />
                      <Route path="calendar" element={page(<CalendarPage />)} />
                      <Route path="settings" element={page(<SettingsPage />)} />
                      <Route path="notifications" element={page(<NotificationsPage />)} />
                      <Route path="activity" element={page(<ActivityPage />)} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AppShell>
                </RequireHousehold>
              } />
            </Routes>
          </HouseholdProvider>
        </RequireAuth>
      } />
    </Routes>
  );
}
