export type Transaction = {
  id: string;
  user_id: string;
  date: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  note: string;
  payment_source?: string;
  created_at: string;
};

export type Debt = {
  id: string;
  user_id: string;
  name: string;
  balance: number;
  apr: number;
  min_payment: number;
  target_payment: number;
  credit_limit?: number;
  created_at: string;
};

export type SavingsGoal = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  monthly_contribution: number;
  target_date: string;
  created_at: string;
};

export type CarFund = {
  id: string;
  user_id: string;
  vehicle_name: string;
  target_price: number;
  tax_fees: number;
  down_payment_goal: number;
  current_saved: number;
  monthly_insurance: number;
  expected_apr: number;
  loan_term_months: number;
  created_at: string;
};

export type Profile = {
  id: string;
  display_name: string;
  currency: string;
  monthly_income_default: number;
  budget_start_day: number;
  show_cents: boolean;
  compact_mode: boolean;
  is_premium: boolean;
  created_at: string;
};

export type Asset = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  value: number;
  notes: string;
  created_at: string;
};

export type Liability = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  balance: number;
  apr: number;
  notes: string;
  created_at: string;
};

export const CATEGORIES = [
  'Bills', 'Groceries', 'Gas', 'Dining', 'Entertainment',
  'Subscriptions', 'Debt Payments', 'Savings', 'Investing',
  'Car', 'Travel', 'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const PAYMENT_SOURCES = ['credit_card', 'bank_account', 'cash'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  credit_card: 'Credit Card',
  bank_account: 'Bank Account',
  cash: 'Cash',
};

export const ASSET_TYPES = [
  'Checking', 'Savings', 'Brokerage', 'Retirement', 'Cash', 'Vehicle', 'Other',
] as const;

export const LIABILITY_TYPES = [
  'Credit Card', 'Student Loan', 'Auto Loan', 'Personal Loan', 'Other',
] as const;

export const CATEGORY_ICONS: Record<string, string> = {
  Bills: 'Receipt',
  Groceries: 'ShoppingCart',
  Gas: 'Fuel',
  Dining: 'UtensilsCrossed',
  Entertainment: 'Gamepad2',
  Subscriptions: 'Repeat',
  'Debt Payments': 'Landmark',
  Savings: 'PiggyBank',
  Investing: 'TrendingUp',
  Car: 'Car',
  Travel: 'Plane',
  Other: 'MoreHorizontal',
};
