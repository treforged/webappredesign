import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from '@capacitor/core';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { supabase } from '@/lib/supabase';
import DashboardLayout from "@/components/layout/DashboardLayout";
import CookieBanner from "@/components/shared/CookieBanner";
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";

const Transactions = lazy(() => import("@/pages/Transactions"));
const DebtPayoff = lazy(() => import("@/pages/DebtPayoff"));
const SavingsGoals = lazy(() => import("@/pages/SavingsGoals"));
const NetWorth = lazy(() => import("@/pages/NetWorth"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Premium = lazy(() => import("@/pages/Premium"));
const PremiumSuccess = lazy(() => import("@/pages/PremiumSuccess"));
const PremiumCancel = lazy(() => import("@/pages/PremiumCancel"));
const BudgetControl = lazy(() => import("@/pages/BudgetControl"));
const Forecast = lazy(() => import("@/pages/Forecast"));
const Accounts = lazy(() => import("@/pages/Accounts"));
const Legal = lazy(() => import("@/pages/Legal"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const AiAdvisor = lazy(() => import("@/pages/AiAdvisor"));
const PlaidOAuth = lazy(() => import("@/pages/PlaidOAuth"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Enable OS font-size accessibility scaling on native (Capacitor) platforms.
// index.css html.native overrides -webkit-text-size-adjust to none.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native');
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}

function ProtectedRoute({ children, skipOnboardingCheck }: { children: React.ReactNode; skipOnboardingCheck?: boolean }) {
  const { user, loading, isDemo } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><span className="text-sm text-muted-foreground animate-pulse">Authenticating…</span></div>;
  if (!user && !isDemo) return <Navigate to="/auth" replace />;
  if (!skipOnboardingCheck && user && !isDemo) {
    const done = localStorage.getItem(`forgenta:onboarding_done_${user.id}`);
    if (!done) return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/accounts" element={<Suspense fallback={<PageLoader />}><Accounts /></Suspense>} />
        <Route path="/budget" element={<Suspense fallback={<PageLoader />}><BudgetControl /></Suspense>} />
        <Route path="/transactions" element={<Suspense fallback={<PageLoader />}><Transactions /></Suspense>} />
        <Route path="/debt" element={<Suspense fallback={<PageLoader />}><DebtPayoff /></Suspense>} />
        <Route path="/savings" element={<Suspense fallback={<PageLoader />}><SavingsGoals /></Suspense>} />
        <Route path="/net-worth" element={<Suspense fallback={<PageLoader />}><NetWorth /></Suspense>} />
        <Route path="/forecast" element={<Suspense fallback={<PageLoader />}><Forecast /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        <Route path="/ai" element={<Suspense fallback={<PageLoader />}><AiAdvisor /></Suspense>} />
        <Route path="/premium" element={<Suspense fallback={<PageLoader />}><Premium /></Suspense>} />
        <Route path="/premium/success" element={<Suspense fallback={<PageLoader />}><PremiumSuccess /></Suspense>} />
        <Route path="/premium/cancel" element={<Suspense fallback={<PageLoader />}><PremiumCancel /></Suspense>} />
      </Route>
      <Route path="/onboarding" element={
        <ProtectedRoute skipOnboardingCheck>
          <Suspense fallback={<PageLoader />}><Onboarding /></Suspense>
        </ProtectedRoute>
      } />
      <Route path="/oauth" element={
        <ProtectedRoute skipOnboardingCheck>
          <Suspense fallback={<PageLoader />}><PlaidOAuth /></Suspense>
        </ProtectedRoute>
      } />
      <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/terms" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/refund" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/subscriptions" element={<Navigate to="/budget" replace />} />
      <Route path="/car-fund" element={<Navigate to="/savings" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: { remove: () => void } | null = null;

    CapApp.addListener('appUrlOpen', async (event) => {
      try {
        const incoming = new URL(event.url);
        const host = incoming.host;
        const path = incoming.pathname;

        // OAuth callback from Google / Apple
        if (host === 'auth-callback' || path.includes('auth-callback')) {
          const code = incoming.searchParams.get('code');

          // PKCE flow
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) {
              console.error('OAuth code exchange failed:', error);
              navigate('/auth', { replace: true });
              return;
            }

            navigate('/dashboard', { replace: true });
            return;
          }

          // Token/hash fallback
          const hash = incoming.hash.startsWith('#')
            ? incoming.hash.slice(1)
            : incoming.hash;

          const hashParams = new URLSearchParams(hash);
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');

          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });

            if (error) {
              console.error('OAuth session set failed:', error);
              navigate('/auth', { replace: true });
              return;
            }

            navigate('/dashboard', { replace: true });
            return;
          }

          navigate('/auth', { replace: true });
          return;
        }

        // Plaid OAuth return
        if (host === 'oauth' || path.includes('/oauth')) {
          navigate('/oauth', { replace: true });
        }
      } catch (err) {
        console.error('Deep link handling failed:', err);
      }
    }).then((handle) => {
      listener = handle;
    });

    return () => {
      listener?.remove();
    };
  }, [navigate]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      {Capacitor.isNativePlatform() ? (
        <MemoryRouter initialEntries={['/auth']}>
          <AuthProvider>
            <DeepLinkHandler />
            <AppRoutes />
            <CookieBanner />
          </AuthProvider>
        </MemoryRouter>
      ) : (
        <BrowserRouter>
          <AuthProvider>
            <DeepLinkHandler />
            <AppRoutes />
            <CookieBanner />
          </AuthProvider>
        </BrowserRouter>
      )}
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
