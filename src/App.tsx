// Import statements
import React from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import DashboardLayout from '@/layouts/DashboardLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

// Lazy loaded components
const Dashboard = React.lazy(() => import('@/pages/Dashboard'));
const Budget = React.lazy(() => import('@/pages/Budget'));
const Debt = React.lazy(() => import('@/pages/Debt'));
const Transactions = React.lazy(() => import('@/pages/Transactions'));
const Savings = React.lazy(() => import('@/pages/Savings'));
const NetWorth = React.lazy(() => import('@/pages/NetWorth'));
const Forecast = React.lazy(() => import('@/pages/Forecast'));
const Settings = React.lazy(() => import('@/pages/Settings'));
const Premium = React.lazy(() => import('@/pages/Premium'));

const queryClient = new QueryClient();

// App component
const App = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <Router>
                <DashboardLayout>
                    <React.Suspense fallback={<div>Loading...</div>}>
                        <Routes>
                            <Route path="/dashboard" element={<ProtectedRoute element={<Dashboard />} />} />
                            <Route path="/budget" element={<ProtectedRoute element={<Budget />} />} />
                            <Route path="/debt" element={<ProtectedRoute element={<Debt />} />} />
                            <Route path="/transactions" element={<ProtectedRoute element={<Transactions />} />} />
                            <Route path="/savings" element={<ProtectedRoute element={<Savings />} />} />
                            <Route path="/net-worth" element={<ProtectedRoute element={<NetWorth />} />} />
                            <Route path="/forecast" element={<ProtectedRoute element={<Forecast />} />} />
                            <Route path="/settings" element={<ProtectedRoute element={<Settings />} />} />
                            <Route path="/premium" element={<ProtectedRoute element={<Premium />} />} />
                        </Routes>
                    </React.Suspense>
                </DashboardLayout>
            </Router>
        </QueryClientProvider>
    );
};

export default App;