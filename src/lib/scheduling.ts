// ─── Date-Aware Scheduling Engine ────────────────────────
// Generates upcoming events from recurring rules and accounts

export type ScheduledEvent = {
  date: string;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  source?: string;
  ruleId?: string;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Get next N Fridays (or any day) from a start date
export function getNextWeekdays(dayOfWeek: number, count: number, from: Date = new Date()): Date[] {
  const dates: Date[] = [];
  const d = new Date(from);
  // Move to next occurrence
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// Generate scheduled events for the next N months from recurring rules
export function generateScheduledEvents(
  rules: any[],
  accounts: any[],
  months: number = 36,
  from: Date = new Date()
): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  const endDate = new Date(from);
  endDate.setMonth(endDate.getMonth() + months);

  for (const rule of rules) {
    if (!rule.active) continue;

    const startDate = rule.start_date ? new Date(rule.start_date) : from;
    const ruleEnd = rule.end_date ? new Date(rule.end_date) : endDate;
    const effectiveEnd = ruleEnd < endDate ? ruleEnd : endDate;

    const accountName = rule.deposit_account
      ? accounts.find((a: any) => a.id === rule.deposit_account)?.name
      : rule.payment_source
        ? accounts.find((a: any) => a.id === rule.payment_source)?.name
        : undefined;

    if (rule.frequency === 'weekly') {
      const dayOfWeek = rule.due_day ?? 5;
      const dates = getNextWeekdays(dayOfWeek, months * 5, new Date(Math.max(from.getTime(), startDate.getTime())));
      for (const d of dates) {
        if (d > effectiveEnd) break;
        events.push({
          date: d.toISOString().split('T')[0],
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type,
          source: accountName,
          ruleId: rule.id,
        });
      }
    } else if (rule.frequency === 'monthly') {
      const d = new Date(Math.max(from.getTime(), startDate.getTime()));
      d.setDate(rule.due_day || 1);
      if (d < from) d.setMonth(d.getMonth() + 1);
      while (d <= effectiveEnd) {
        events.push({
          date: d.toISOString().split('T')[0],
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type,
          source: accountName,
          ruleId: rule.id,
        });
        d.setMonth(d.getMonth() + 1);
      }
    } else if (rule.frequency === 'yearly') {
      const d = new Date(Math.max(from.getTime(), startDate.getTime()));
      d.setMonth((rule.due_month ?? 1) - 1);
      d.setDate(rule.due_day || 1);
      if (d < from) d.setFullYear(d.getFullYear() + 1);
      while (d <= effectiveEnd) {
        events.push({
          date: d.toISOString().split('T')[0],
          name: rule.name,
          amount: Number(rule.amount),
          type: rule.rule_type,
          source: accountName,
          ruleId: rule.id,
        });
        d.setFullYear(d.getFullYear() + 1);
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// Get upcoming events within the next N days
export function getUpcomingEvents(events: ScheduledEvent[], days: number = 7): ScheduledEvent[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + days);
  const nowStr = now.toISOString().split('T')[0];
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return events.filter(e => e.date >= nowStr && e.date <= cutoffStr);
}

// Get next paycheck date
export function getNextPayday(paycheckDay: number = 5): Date {
  const d = new Date();
  while (d.getDay() !== paycheckDay) d.setDate(d.getDate() + 1);
  return d;
}

// Aggregate events by month for forecast
export function aggregateByMonth(events: ScheduledEvent[]): Record<string, { income: number; expenses: number }> {
  const months: Record<string, { income: number; expenses: number }> = {};
  for (const e of events) {
    const key = e.date.substring(0, 7); // YYYY-MM
    if (!months[key]) months[key] = { income: 0, expenses: 0 };
    if (e.type === 'income') months[key].income += e.amount;
    else months[key].expenses += e.amount;
  }
  return months;
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] || 'Fri';
}
