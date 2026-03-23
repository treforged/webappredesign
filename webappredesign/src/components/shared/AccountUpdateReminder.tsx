import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Shows a prominent reminder at the start of each month (1st-7th) 
 * to update account balances for accurate budgeting.
 */
export default function AccountUpdateReminder() {
  const [dismissed, setDismissed] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const dismissedKey = localStorage.getItem('account-update-reminder-dismissed');

    // Show if: (1) it's 1st-7th of month AND (2) not dismissed this month yet
    if (dayOfMonth >= 1 && dayOfMonth <= 7 && dismissedKey !== monthKey) {
      setShouldShow(true);
    }
  }, []);

  const handleDismiss = () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    localStorage.setItem('account-update-reminder-dismissed', monthKey);
    setDismissed(true);
  };

  if (!shouldShow || dismissed) return null;

  return (
    <div 
      className="mb-4 p-4 border-2 border-amber-500/50 bg-amber-500/10 flex items-start gap-3"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm mb-1">Update Your Account Balances</h3>
        <p className="text-xs text-muted-foreground">
          It's the start of a new month! For the most accurate budget projections and debt payoff calculations, 
          please update your account balances in <strong>Accounts</strong> to reflect any recent transactions. 
          This ensures expenses that have already been paid aren't counted twice.
        </p>
      </div>
      <button 
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
