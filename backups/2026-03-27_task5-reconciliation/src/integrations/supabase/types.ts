// ⚠️  This file should be regenerated from your Supabase project.
// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/integrations/supabase/types.ts
//
// The schema includes these tables:
// accounts, assets, budget_items, car_funds, debts, liabilities,
// profiles, recurring_rules, savings_goals, subscription_tiers,
// subscriptions, transactions, user_subscriptions

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string
          active: boolean
          apr: number | null
          balance: number
          created_at: string
          credit_limit: number | null
          id: string
          institution: string
          name: string
          notes: string | null
          payment_due_day: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string
          active?: boolean
          apr?: number | null
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          institution?: string
          name: string
          notes?: string | null
          payment_due_day?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          active?: boolean
          apr?: number | null
          balance?: number
          created_at?: string
          credit_limit?: number | null
          id?: string
          institution?: string
          name?: string
          notes?: string | null
          payment_due_day?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assets: {
        Row: { created_at: string; id: string; name: string; notes: string | null; type: string; updated_at: string; user_id: string; value: number }
        Insert: { created_at?: string; id?: string; name: string; notes?: string | null; type?: string; updated_at?: string; user_id: string; value?: number }
        Update: { created_at?: string; id?: string; name?: string; notes?: string | null; type?: string; updated_at?: string; user_id?: string; value?: number }
        Relationships: []
      }
      budget_items: {
        Row: { amount: number; category: string; created_at: string; id: string; label: string; updated_at: string; user_id: string }
        Insert: { amount?: number; category?: string; created_at?: string; id?: string; label: string; updated_at?: string; user_id: string }
        Update: { amount?: number; category?: string; created_at?: string; id?: string; label?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      car_funds: {
        Row: { created_at: string; current_saved: number; down_payment_goal: number; expected_apr: number; id: string; loan_term_months: number; monthly_insurance: number; target_price: number; tax_fees: number; updated_at: string; user_id: string; vehicle_name: string }
        Insert: { created_at?: string; current_saved?: number; down_payment_goal?: number; expected_apr?: number; id?: string; loan_term_months?: number; monthly_insurance?: number; target_price?: number; tax_fees?: number; updated_at?: string; user_id: string; vehicle_name: string }
        Update: { created_at?: string; current_saved?: number; down_payment_goal?: number; expected_apr?: number; id?: string; loan_term_months?: number; monthly_insurance?: number; target_price?: number; tax_fees?: number; updated_at?: string; user_id?: string; vehicle_name?: string }
        Relationships: []
      }
      debts: {
        Row: { apr: number; balance: number; created_at: string; credit_limit: number | null; id: string; min_payment: number; name: string; target_payment: number; updated_at: string; user_id: string }
        Insert: { apr?: number; balance?: number; created_at?: string; credit_limit?: number | null; id?: string; min_payment?: number; name: string; target_payment?: number; updated_at?: string; user_id: string }
        Update: { apr?: number; balance?: number; created_at?: string; credit_limit?: number | null; id?: string; min_payment?: number; name?: string; target_payment?: number; updated_at?: string; user_id?: string }
        Relationships: []
      }
      liabilities: {
        Row: { apr: number | null; balance: number; created_at: string; id: string; name: string; notes: string | null; type: string; updated_at: string; user_id: string }
        Insert: { apr?: number | null; balance?: number; created_at?: string; id?: string; name: string; notes?: string | null; type?: string; updated_at?: string; user_id: string }
        Update: { apr?: number | null; balance?: number; created_at?: string; id?: string; name?: string; notes?: string | null; type?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      profiles: {
        Row: { auto_generate_recurring: boolean | null; budget_start_day: number | null; cash_floor: number | null; compact_mode: boolean | null; created_at: string; currency: string | null; default_deposit_account: string | null; display_name: string | null; gross_income: number | null; id: string; is_premium: boolean | null; monthly_income_default: number | null; paycheck_day: number | null; paycheck_frequency: string | null; paycheck_start_date: string | null; show_cents: boolean | null; tax_rate: number | null; updated_at: string; user_id: string; weekly_gross_income: number | null }
        Insert: { auto_generate_recurring?: boolean | null; budget_start_day?: number | null; cash_floor?: number | null; compact_mode?: boolean | null; created_at?: string; currency?: string | null; default_deposit_account?: string | null; display_name?: string | null; gross_income?: number | null; id?: string; is_premium?: boolean | null; monthly_income_default?: number | null; paycheck_day?: number | null; paycheck_frequency?: string | null; paycheck_start_date?: string | null; show_cents?: boolean | null; tax_rate?: number | null; updated_at?: string; user_id: string; weekly_gross_income?: number | null }
        Update: { auto_generate_recurring?: boolean | null; budget_start_day?: number | null; cash_floor?: number | null; compact_mode?: boolean | null; created_at?: string; currency?: string | null; default_deposit_account?: string | null; display_name?: string | null; gross_income?: number | null; id?: string; is_premium?: boolean | null; monthly_income_default?: number | null; paycheck_day?: number | null; paycheck_frequency?: string | null; paycheck_start_date?: string | null; show_cents?: boolean | null; tax_rate?: number | null; updated_at?: string; user_id?: string; weekly_gross_income?: number | null }
        Relationships: []
      }
      recurring_rules: {
        Row: { active: boolean; amount: number; category: string; created_at: string; deposit_account: string | null; due_day: number; due_month: number | null; end_date: string | null; frequency: string; id: string; name: string; notes: string | null; payment_source: string | null; rule_type: string; start_date: string | null; updated_at: string; user_id: string }
        Insert: { active?: boolean; amount?: number; category?: string; created_at?: string; deposit_account?: string | null; due_day?: number; due_month?: number | null; end_date?: string | null; frequency?: string; id?: string; name: string; notes?: string | null; payment_source?: string | null; rule_type?: string; start_date?: string | null; updated_at?: string; user_id: string }
        Update: { active?: boolean; amount?: number; category?: string; created_at?: string; deposit_account?: string | null; due_day?: number; due_month?: number | null; end_date?: string | null; frequency?: string; id?: string; name?: string; notes?: string | null; payment_source?: string | null; rule_type?: string; start_date?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      savings_goals: {
        Row: { created_at: string; current_amount: number; goal_type: string; id: string; linked_account: string | null; monthly_contribution: number; name: string; target_amount: number; target_date: string | null; updated_at: string; user_id: string }
        Insert: { created_at?: string; current_amount?: number; goal_type?: string; id?: string; linked_account?: string | null; monthly_contribution?: number; name: string; target_amount?: number; target_date?: string | null; updated_at?: string; user_id: string }
        Update: { created_at?: string; current_amount?: number; goal_type?: string; id?: string; linked_account?: string | null; monthly_contribution?: number; name?: string; target_amount?: number; target_date?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      subscription_tiers: {
        Row: { created_at: string; features: Json | null; id: string; name: string; price_annual: number; price_monthly: number; stripe_price_id_annual: string | null; stripe_price_id_monthly: string | null }
        Insert: { created_at?: string; features?: Json | null; id?: string; name: string; price_annual?: number; price_monthly?: number; stripe_price_id_annual?: string | null; stripe_price_id_monthly?: string | null }
        Update: { created_at?: string; features?: Json | null; id?: string; name?: string; price_annual?: number; price_monthly?: number; stripe_price_id_annual?: string | null; stripe_price_id_monthly?: string | null }
        Relationships: []
      }
      subscriptions: {
        Row: { active: boolean; billing: string; cost: number; created_at: string; id: string; name: string; renewal_date: string | null; updated_at: string; user_id: string }
        Insert: { active?: boolean; billing?: string; cost?: number; created_at?: string; id?: string; name: string; renewal_date?: string | null; updated_at?: string; user_id: string }
        Update: { active?: boolean; billing?: string; cost?: number; created_at?: string; id?: string; name?: string; renewal_date?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
      transactions: {
        Row: { account: string | null; amount: number; category: string; created_at: string; date: string; id: string; note: string | null; payment_source: string | null; type: string; updated_at: string; user_id: string }
        Insert: { account?: string | null; amount: number; category: string; created_at?: string; date?: string; id?: string; note?: string | null; payment_source?: string | null; type: string; updated_at?: string; user_id: string }
        Update: { account?: string | null; amount?: number; category?: string; created_at?: string; date?: string; id?: string; note?: string | null; payment_source?: string | null; type?: string; updated_at?: string; user_id?: string }
        Relationships: []
      }
      user_subscriptions: {
        Row: { created_at: string; current_period_end: string | null; id: string; plan: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; subscription_status: string | null; updated_at: string; user_id: string }
        Insert: { created_at?: string; current_period_end?: string | null; id?: string; plan?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; subscription_status?: string | null; updated_at?: string; user_id: string }
        Update: { created_at?: string; current_period_end?: string | null; id?: string; plan?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null; subscription_status?: string | null; updated_at?: string; user_id?: string }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Insert: infer I } ? I : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I } ? I : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Update: infer U } ? U : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U } ? U : never
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
