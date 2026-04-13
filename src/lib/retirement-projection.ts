/**
 * Retirement projection math — single source of truth used by
 * NetWorth, Forecast, and useRetirementAutoUpdate.
 */

/**
 * Future value of a retirement account given:
 *   currentBalance  — starting balance
 *   monthlyContrib  — contribution added each month
 *   apyRate         — annual percentage yield (e.g. 7 for 7%)
 *   months          — number of months to project
 */
export function projectBalance(
  currentBalance: number,
  monthlyContrib: number,
  apyRate: number,
  months: number,
): number {
  if (months <= 0) return currentBalance;
  const r = apyRate / 100 / 12; // monthly rate
  if (r === 0) return currentBalance + monthlyContrib * months;
  const growth = Math.pow(1 + r, months);
  return currentBalance * growth + monthlyContrib * ((growth - 1) / r);
}

/**
 * Project milestones at 1, 5, 10, and 20 years.
 */
export function projectMilestones(
  currentBalance: number,
  monthlyContrib: number,
  apyRate: number,
): { year1: number; year5: number; year10: number; year20: number } {
  return {
    year1:  projectBalance(currentBalance, monthlyContrib, apyRate, 12),
    year5:  projectBalance(currentBalance, monthlyContrib, apyRate, 60),
    year10: projectBalance(currentBalance, monthlyContrib, apyRate, 120),
    year20: projectBalance(currentBalance, monthlyContrib, apyRate, 240),
  };
}

/**
 * Compound a principal over an elapsed number of days at a given APY.
 * Used by the auto-update hook to apply growth between paycheck cycles.
 */
export function compoundGrowth(
  principal: number,
  apyRate: number,
  days: number,
): number {
  if (days <= 0 || apyRate === 0) return principal;
  return principal * Math.pow(1 + apyRate / 100, days / 365);
}

/**
 * Compute the monthly contribution for a retirement account from paycheck deductions.
 * Accepts the raw paycheck_deductions JSONB array and the pay frequency.
 */
export function monthlyContribForAccount(
  deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[],
  accountId: string,
  paycheckGross: number,
  paychecksPerYear: number,
): number {
  let total = 0;
  for (const d of deductions) {
    if (d.accountId !== accountId) continue;
    const perCheck = d.mode === 'pct' ? paycheckGross * (d.value / 100) : d.value;
    total += perCheck * (paychecksPerYear / 12);
  }
  return total;
}
