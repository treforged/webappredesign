import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

export default function PremiumSuccess() {
  return (
    <div className="p-4 lg:p-6 max-w-md mx-auto text-center space-y-6 mt-12">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
        <CheckCircle className="text-primary" size={32} />
      </div>
      <h1 className="font-display font-bold text-xl tracking-tight">Welcome to Premium!</h1>
      <p className="text-sm text-muted-foreground">Your subscription is now active. All premium features are unlocked.</p>
      <Link to="/dashboard" className="inline-block bg-primary text-primary-foreground px-6 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors" style={{ borderRadius: 'var(--radius)' }}>
        Go to Dashboard
      </Link>
    </div>
  );
}
