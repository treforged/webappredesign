# TRE Forged — Budget OS

A precision personal finance webapp built with React, Vite, TypeScript, Supabase, shadcn/ui, Tailwind CSS, and Recharts.

## Setup

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your Supabase credentials
3. Install dependencies:
   ```bash
   npm install
   ```
4. Install shadcn/ui components (required — only skeleton and sonner are included):
   ```bash
   npx shadcn@latest init
   npx shadcn@latest add button tabs tooltip separator input sheet scroll-area select dialog dropdown-menu popover accordion alert-dialog avatar checkbox collapsible context-menu hover-card label menubar navigation-menu progress radio-group slider switch toast toggle toggle-group sidebar
   ```
5. Run dev server:
   ```bash
   npm run dev
   ```

## Supabase Setup

Your Supabase project needs these tables:
- `accounts`, `assets`, `liabilities`, `debts`, `savings_goals`, `car_funds`
- `transactions`, `recurring_rules`, `budget_items`, `subscriptions`
- `profiles`, `user_subscriptions`, `subscription_tiers`

See `src/integrations/supabase/types.ts` for the complete schema.

## Stripe (WIP)

Stripe checkout/webhook edge functions are stubbed in `supabase/functions/`. 
Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in your Supabase function env vars.

## Architecture

- **Pages**: Dashboard, Accounts, Budget Control, Transactions, Debt Payoff, Savings Goals, Net Worth, Forecast, Settings, Premium
- **Engine**: `src/lib/pay-schedule.ts` (unified pay schedule), `src/lib/credit-card-engine.ts` (debt payoff), `src/lib/scheduling.ts` (recurring events), `src/lib/debt-transaction-generator.ts` (forecast debt projections)
- **State**: React Query + Supabase realtime, with demo mode fallback data
- **Auth**: Supabase Auth with email/password
- **Design**: Dark theme, gold accent (`hsl(43, 56%, 52%)`), Outfit + Inter fonts, 2px border radius

© TRE Forged LLC
