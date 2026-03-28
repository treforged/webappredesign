import { Transaction, Debt, SavingsGoal, CarFund, Asset, Liability } from './types';

const now = new Date();
const y = now.getFullYear();
const m = now.getMonth();

function d(day: number, monthOffset = 0) {
  return new Date(y, m + monthOffset, day).toISOString().split('T')[0];
}

// ── Demo Transactions — a realistic month of activity ──────────────
export const demoTransactions: Omit<Transaction, 'id' | 'user_id' | 'created_at'>[] = [
  // Income — deposited to Chase Checking (d1)
  { date: d(3), type: 'income', amount: 1462.50, category: 'Other', account: 'Checking', note: 'Weekly Paycheck', payment_source: 'account:d1' },
  { date: d(10), type: 'income', amount: 1462.50, category: 'Other', account: 'Checking', note: 'Weekly Paycheck', payment_source: 'account:d1' },
  { date: d(17), type: 'income', amount: 1462.50, category: 'Other', account: 'Checking', note: 'Weekly Paycheck', payment_source: 'account:d1' },
  // Expenses — fixed (paid from Chase Checking d1)
  { date: d(1), type: 'expense', amount: 1400, category: 'Bills', account: 'Checking', note: 'Rent', payment_source: 'account:d1' },
  { date: d(3), type: 'expense', amount: 120, category: 'Bills', account: 'Checking', note: 'Electric & water', payment_source: 'account:d1' },
  { date: d(14), type: 'expense', amount: 280, category: 'Car', account: 'Checking', note: 'Car Insurance', payment_source: 'account:d1' },
  // Expenses — variable (charged to Chase Sapphire d7)
  { date: d(5), type: 'expense', amount: 320, category: 'Groceries', account: 'Credit Card', note: 'Weekly groceries', payment_source: 'account:d7' },
  { date: d(6), type: 'expense', amount: 55, category: 'Gas', account: 'Credit Card', note: 'Shell station', payment_source: 'account:d7' },
  { date: d(7), type: 'expense', amount: 45, category: 'Dining', account: 'Credit Card', note: 'Dinner out', payment_source: 'account:d7' },
  { date: d(12), type: 'expense', amount: 30, category: 'Entertainment', account: 'Credit Card', note: 'Movie tickets', payment_source: 'account:d7' },
  { date: d(15), type: 'expense', amount: 65, category: 'Dining', account: 'Credit Card', note: 'Lunch meetings', payment_source: 'account:d7' },
  // Subscriptions (charged to Chase Sapphire d7)
  { date: d(4), type: 'expense', amount: 85, category: 'Subscriptions', account: 'Credit Card', note: 'Streaming + gym', payment_source: 'account:d7' },
  // One-time upcoming — car down payment 4 months out (from Chase Checking d1)
  { date: d(15, 4), type: 'expense', amount: 5000, category: 'Car', account: 'Checking', note: 'Car down payment (planned)', payment_source: 'account:d1' },
];

// ── Demo Debts ─────────────────────────────────────────────
export const demoDebts: (Omit<Debt, 'id' | 'user_id' | 'created_at'> & { credit_limit?: number })[] = [
  { name: 'Chase Sapphire', balance: 3200, apr: 22.99, min_payment: 75, target_payment: 400, credit_limit: 10000 },
  { name: 'Discover It', balance: 800, apr: 18.99, min_payment: 25, target_payment: 200, credit_limit: 5000 },
];

// ── Demo Savings Goals ─────────────────────────────────────
export const demoSavingsGoals: Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Emergency Fund', target_amount: 15000, current_amount: 12800, monthly_contribution: 300, target_date: d(1, 8) },
  { name: 'Vacation Fund', target_amount: 3000, current_amount: 850, monthly_contribution: 150, target_date: d(1, 15) },
];

// ── Demo Car Funds ─────────────────────────────────────────
export const demoCarFunds: Omit<CarFund, 'id' | 'user_id' | 'created_at'>[] = [
  {
    vehicle_name: '2024 Honda Civic',
    target_price: 28000,
    tax_fees: 2000,
    down_payment_goal: 5600,
    current_saved: 3200,
    monthly_insurance: 180,
    expected_apr: 5.9,
    loan_term_months: 60,
  },
];

// ── Demo Assets ────────────────────────────────────────────
export const demoAssets: Omit<Asset, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Home Equity', type: 'property', value: 45000, notes: 'Approximate equity' },
];

// ── Demo Liabilities ───────────────────────────────────────
export const demoLiabilities: Omit<Liability, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Student Loan', type: 'student_loan', balance: 18000, apr: 5.5, notes: 'Federal direct' },
];
