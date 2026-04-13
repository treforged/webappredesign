/**
 * useRetirementAutoUpdate
 *
 * Generalizes the old use401kAutoUpdate to handle ALL retirement deductions
 * linked to accounts via the paycheck_deductions JSONB on profiles.
 *
 * Rules:
 *  - APY growth projection is always visible (handled in UI, not this hook)
 *  - Balance mutation (auto-increment) → premium users only
 *  - Plaid-linked accounts → Plaid handles balance; skip mutation, still show projection
 *  - Falls back to legacy deduction_401k_value column if paycheck_deductions is empty
 *  - Runs once per session when profile + accounts are ready; no-ops for demo users
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { buildPayConfig, getPaychecksInMonth, getPaycheckGross } from '@/lib/pay-schedule';
import { compoundGrowth } from '@/lib/retirement-projection';

const DEFAULT_RETIRE_APY = 7;
const RETIRE_ACCOUNT_TYPES = new Set(['401k', 'roth_ira', 'ira', 'brokerage', 'hsa']);

function getPaychecksBetween(profile: any, from: Date, to: Date): Date[] {
  const config = buildPayConfig(profile);
  const result: Date[] = [];
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  let cur = new Date(start);
  while (cur <= to) {
    const paychecks = getPaychecksInMonth(config, cur.getFullYear(), cur.getMonth());
    for (const p of paychecks) {
      if (p.date > from && p.date <= to) result.push(p.date);
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return result;
}

type DeductionEntry = {
  id: string;
  label: string;
  value: number;
  mode: 'flat' | 'pct';
  preTax: boolean;
  accountId?: string;
};

export function useRetirementAutoUpdate(
  profile: any,
  accounts: any[],
  isDemo: boolean,
  isPremium: boolean,
) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (isDemo || !profile || accounts.length === 0) return;
    if (ranRef.current) return;
    ranRef.current = true;

    // Only write balance changes for premium users
    if (!isPremium) return;

    // Build map of retirement accounts (id → account)
    const retireAccMap = new Map<string, any>(
      accounts
        .filter((a: any) => a.active && RETIRE_ACCOUNT_TYPES.has(a.account_type))
        .map((a: any) => [a.id as string, a]),
    );

    // Read deductions from new JSONB column
    const deductions: DeductionEntry[] = Array.isArray(profile.paycheck_deductions)
      ? profile.paycheck_deductions
      : [];

    type Pair = { deduction: DeductionEntry; account: any };
    let pairs: Pair[] = deductions
      .filter(d => d.value > 0 && d.accountId && retireAccMap.has(d.accountId))
      .map(d => ({ deduction: d, account: retireAccMap.get(d.accountId!)! }));

    // Fall back to legacy 401k columns if no linked deductions exist
    if (pairs.length === 0) {
      const val401k = Number(profile.deduction_401k_value) || 0;
      if (val401k > 0) {
        const primary = accounts
          .filter((a: any) => a.active && a.account_type === '401k')
          .sort((a: any, b: any) => Number(b.balance) - Number(a.balance))[0];
        if (primary) {
          pairs = [{
            deduction: {
              id: 'legacy-401k',
              label: '401(k) Traditional',
              value: val401k,
              mode: (profile.deduction_401k_mode || 'pct') as 'flat' | 'pct',
              preTax: true,
            },
            account: primary,
          }];
        }
      }
    }

    if (pairs.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastUpdate = profile.last_401k_update
      ? new Date(profile.last_401k_update + 'T00:00:00')
      : null;

    // First run ever: record today's date, no balance change
    if (!lastUpdate) {
      supabase.from('profiles' as any)
        .update({ last_401k_update: today.toISOString().split('T')[0] })
        .eq('user_id', profile.user_id)
        .then(() => {});
      return;
    }

    if (lastUpdate >= today) return; // already up to date

    const missedPaychecks = getPaychecksBetween(profile, lastUpdate, today);
    const elapsedDays = Math.round((today.getTime() - lastUpdate.getTime()) / 86400000);

    const payConfig = buildPayConfig(profile);
    const paycheckGross = getPaycheckGross(payConfig);

    const writes: PromiseLike<any>[] = [];

    for (const { deduction, account } of pairs) {
      // Skip Plaid-linked — Plaid sync handles balance updates
      if (account.plaid_item_id) continue;

      const contribPerCheck = deduction.mode === 'pct'
        ? paycheckGross * (deduction.value / 100)
        : deduction.value;
      const totalContrib = contribPerCheck * missedPaychecks.length;

      const apyRate = Number(account.apy_rate) || DEFAULT_RETIRE_APY;
      const currentBalance = Number(account.balance);
      const grownBalance = compoundGrowth(currentBalance, apyRate, elapsedDays);
      const newBalance = Math.round((grownBalance + totalContrib) * 100) / 100;

      writes.push(
        supabase.from('accounts' as any)
          .update({ balance: newBalance })
          .eq('id', account.id)
          .eq('user_id', profile.user_id)
          .then(() => {}),
      );
    }

    writes.push(
      supabase.from('profiles' as any)
        .update({ last_401k_update: today.toISOString().split('T')[0] })
        .eq('user_id', profile.user_id)
        .then(() => {}),
    );

    Promise.all(writes as Promise<any>[]).then(() => {});
  }, [profile, accounts, isDemo, isPremium]);
}
