import { Link } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export default function PremiumCancel() {
  return (
    <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-6 mt-12">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
        <XCircle className="text-destructive" size={32} />
      </div>
      <h1 className="font-display font-bold text-xl tracking-tight">Checkout Cancelled</h1>
      <p className="text-sm text-muted-foreground">No charges were made. You can upgrade anytime.</p>
      <div className="flex justify-center gap-3">
        <Link to="/dashboard" className="bg-secondary text-foreground px-4 py-2 text-xs font-semibold btn-press border border-border" style={{ borderRadius: 'var(--radius)' }}>
          Back to Dashboard
        </Link>
        <Link to="/premium" className="bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press" style={{ borderRadius: 'var(--radius)' }}>
          Try Again
        </Link>
      </div>
    </div>
  );
}
