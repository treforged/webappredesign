export function formatCurrency(amount: number, showCents = true, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(amount);
}

export function calculateMonthlyPayment(principal: number, apr: number, termMonths: number): number {
  if (apr === 0) return principal / termMonths;
  const r = apr / 100 / 12;
  return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

export function calculatePayoffMonths(balance: number, apr: number, monthlyPayment: number): number {
  if (monthlyPayment <= 0) return Infinity;
  if (apr === 0) return Math.ceil(balance / monthlyPayment);
  const r = apr / 100 / 12;
  const interest = balance * r;
  if (monthlyPayment <= interest) return Infinity;
  return Math.ceil(-Math.log(1 - (balance * r) / monthlyPayment) / Math.log(1 + r));
}

export function calculateTotalInterest(balance: number, apr: number, monthlyPayment: number): number {
  if (apr === 0) return 0;
  const months = calculatePayoffMonths(balance, apr, monthlyPayment);
  if (months === Infinity) return Infinity;
  return monthlyPayment * months - balance;
}

export function getMonthName(monthIndex: number): string {
  return new Date(2024, monthIndex).toLocaleString('en', { month: 'short' });
}
