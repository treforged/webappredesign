import React, { Suspense } from 'react';
import ErrorBoundary from './ErrorBoundary';

const BudgetControl = React.lazy(() => import('./BudgetControl'));
const DebtPayoff = React.lazy(() => import('./DebtPayoff'));
const Accounts = React.lazy(() => import('./Accounts'));
const Transactions = React.lazy(() => import('./Transactions'));
const SavingsGoals = React.lazy(() => import('./SavingsGoals'));
const NetWorth = React.lazy(() => import('./NetWorth'));
const SettingsPage = React.lazy(() => import('./SettingsPage'));
const Premium = React.lazy(() => import('./Premium'));
const PremiumSuccess = React.lazy(() => import('./PremiumSuccess'));
const PremiumCancel = React.lazy(() => import('./PremiumCancel'));
const Forecast = React.lazy(() => import('./Forecast'));

function App() {
  return (
    <div className="App">
      <ErrorBoundary>
        <Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="/budget" element={<BudgetControl />} />
            <Route path="/debt" element={<DebtPayoff />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/savings-goals" element={<SavingsGoals />} />
            <Route path="/net-worth" element={<NetWorth />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/premium" element={<Premium />} />
            <Route path="/premium-success" element={<PremiumSuccess />} />
            <Route path="/premium-cancel" element={<PremiumCancel />} />
            <Route path="/forecast" element={<Forecast />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export default App;