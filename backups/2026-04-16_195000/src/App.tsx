import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isDemo } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><span className="text-sm text-muted-foreground animate-pulse">Authenticating…</span></div>;
  if (!user && !isDemo) return <Navigate to="/auth" replace />;
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
        <Route path="/premium" element={<Suspense fallback={<PageLoader />}><Premium /></Suspense>} />
        <Route path="/premium/success" element={<Suspense fallback={<PageLoader />}><PremiumSuccess /></Suspense>} />
        <Route path="/premium/cancel" element={<Suspense fallback={<PageLoader />}><PremiumCancel /></Suspense>} />
      </Route>
      <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/terms" element={<Suspense fallback={<PageLoader />}><Legal /></Suspense>} />
      <Route path="/subscriptions" element={<Navigate to="/budget" replace />} />
      <Route path="/car-fund" element={<Navigate to="/savings" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <CookieBanner />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
