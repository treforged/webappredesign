/**
 * Phase 3.2 — 401k auto-update hook
 *
 * On load, checks whether any paychecks have occurred since `profile.last_401k_update`.
 * For each missed paycheck, adds the 401k contribution (from deduction settings) to the
 * primary 401k account balance. Also compounds APY growth from the account's apy_rate
 * (or 7% default) over the elapsed days.
 *
 * Runs once per session when profile + accounts data are ready. No-ops for demo users.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { buildPayConfig, getPaychecksInMonth, getPaycheckGross } from '@/lib/pay-schedule';

const DEFAULT_401K_APY = 7; // fallback if account has no apy_rate set

function getDatesBetween(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1);
  while (cur <= to) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function getPaychecksBetween(profile: any, from: Date, to: Date): Date[] {
  const config = buildPayConfig(profile);
  const result: Date[] = [];
  // Iterate month by month between from and to
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth() + 1, 0);
  let cur = new Date(start);
  while (cur <= end) {
    const paychecks = getPaychecksInMonth(config, cur.getFullYear(), cur.getMonth());
    for (const p of paychecks) {
      if (p.date > from && p.date <= to) {
        result.push(p.date);
      }
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return result;
}

export function use401kAutoUpdate(
  profile: any,
  accounts: any[],
  isDemo: boolean,
) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (isDemo || !profile || accounts.length === 0) return;
    if (ranRef.current) return;

    const val401k = Number(profile.deduction_401k_value) || 0;
    if (val401k === 0) return; // no 401k deduction configured

    // Find the primary 401k account (highest balance if multiple)
    const retirement401k = accounts
      .filter((a: any) => a.active && a.account_type === '401k')
      .sort((a: any, b: any) => Number(b.balance) - Number(a.balance));
    if (retirement401k.length === 0) return;
    const primaryAccount = retirement401k[0];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastUpdate = profile.last_401k_update
      ? new Date(profile.last_401k_update + 'T00:00:00')
      : null;

    // First run: set last_401k_update to today without applying changes
    if (!lastUpdate) {
      supabase.from('profiles' as any)
        .update({ last_401k_update: today.toISOString().split('T')[0] })
        .eq('user_id', profile.user_id)
        .then(() => {});
      ranRef.current = true;
      return;
    }

    if (lastUpdate >= today) {
      ranRef.current = true;
      return; // already up to date
    }

    // Compute missed paychecks
    const missedPaychecks = getPaychecksBetween(profile, lastUpdate, today);
    if (missedPaychecks.length === 0) {
      // Still update the date so we don't keep rechecking
      supabase.from('profiles' as any)
        .update({ last_401k_update: today.toISOString().split('T')[0] })
        .eq('user_id', profile.user_id)
        .then(() => {});
      ranRef.current = true;
      return;
    }

    // Contribution per paycheck
    const payConfig = buildPayConfig(profile);
    const paycheckGross = getPaycheckGross(payConfig);
    const mode401k = profile.deduction_401k_mode || 'pct';
    const contribPerCheck = mode401k === 'pct'
      ? paycheckGross * (val401k / 100)
      : val401k;

    const totalContrib = contribPerCheck * missedPaychecks.length;

    // APY compounding over elapsed days
    const apyRate = Number(primaryAccount.apy_rate) || DEFAULT_401K_APY;
    const elapsedDays = Math.round((today.getTime() - lastUpdate.getTime()) / 86400000);
    const growthFactor = Math.pow(1 + apyRate / 100, elapsedDays / 365);

    const currentBalance = Number(primaryAccount.balance);
    const newBalance = Math.round((currentBalance * growthFactor + totalContrib) * 100) / 100;

    ranRef.current = true;

    Promise.all([
      supabase.from('accounts' as any)
        .update({ balance: newBalance })
        .eq('id', primaryAccount.id)
        .eq('user_id', profile.user_id),
      supabase.from('profiles' as any)
        .update({ last_401k_update: today.toISOString().split('T')[0] })
        .eq('user_id', profile.user_id),
    ]).then(() => {});
  }, [profile, accounts, isDemo]);
}
