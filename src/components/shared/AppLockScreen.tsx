import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, KeyRound, Delete } from 'lucide-react';
import { useAppLock } from '@/hooks/useAppLock';
import { toast } from 'sonner';

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function AppLockScreen() {
  const { isLocked, lockType, unlockWithPin, unlockWithBiometric, unlockWithPasskey } = useAppLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showPinFallback, setShowPinFallback] = useState(false);
  const activeType = showPinFallback ? 'pin' : lockType;

  const tryBioOrPasskey = useCallback(async () => {
    if (lockType === 'biometric') {
      const ok = await unlockWithBiometric();
      if (!ok) toast.error('Biometric authentication failed');
    } else if (lockType === 'passkey') {
      const ok = await unlockWithPasskey();
      if (!ok) toast.error('Passkey authentication failed');
    }
  }, [lockType, unlockWithBiometric, unlockWithPasskey]);

  // Auto-trigger biometric/passkey on mount
  useEffect(() => {
    if (!isLocked) return;
    if ((lockType === 'biometric' || lockType === 'passkey') && !showPinFallback) {
      const t = setTimeout(() => tryBioOrPasskey(), 300);
      return () => clearTimeout(t);
    }
  }, [isLocked, lockType, showPinFallback, tryBioOrPasskey]);

  const handleDigit = useCallback(async (d: string) => {
    if (d === '⌫') {
      setPin(p => p.slice(0, -1));
      setError(false);
      return;
    }
    if (d === '') return;

    const next = pin + d;
    setPin(next);

    if (next.length >= 4) {
      setChecking(true);
      const ok = await unlockWithPin(next);
      setChecking(false);
      if (!ok) {
        setError(true);
        setTimeout(() => { setPin(''); setError(false); }, 600);
      }
    }
  }, [pin, unlockWithPin]);

  // Keyboard support
  useEffect(() => {
    if (!isLocked || activeType !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) handleDigit(e.key);
      if (e.key === 'Backspace') handleDigit('⌫');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLocked, activeType, handleDigit]);

  if (!isLocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center gap-8 px-8">
      {/* Logo / branding */}
      <div className="text-center space-y-1">
        <p className="font-display font-bold text-xl tracking-tight">Forged</p>
        <p className="text-xs text-muted-foreground">Verify it's you to continue</p>
      </div>

      {activeType === 'pin' ? (
        <>
          {/* PIN dots */}
          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${
                  i < pin.length
                    ? error ? 'bg-destructive border-destructive' : 'bg-primary border-primary'
                    : 'border-muted-foreground/40'
                }`}
              />
            ))}
          </div>

          {/* Numpad */}
          <div className={`grid grid-cols-3 gap-3 w-64 transition-transform duration-150 ${error ? 'animate-[shake_0.3s_ease]' : ''}`}>
            {DIGITS.map((d, i) => (
              <button
                key={i}
                disabled={checking || d === ''}
                onClick={() => handleDigit(d)}
                className={`h-16 flex items-center justify-center text-xl font-medium transition-colors btn-press disabled:opacity-30 ${
                  d === '' ? 'invisible' :
                  d === '⌫' ? 'text-muted-foreground hover:text-foreground' :
                  'bg-secondary border border-border hover:border-primary/40 hover:text-primary'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                {d === '⌫' ? <Delete size={18} /> : d}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Biometric / Passkey prompt */
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={tryBioOrPasskey}
            className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center hover:bg-primary/20 transition-colors btn-press"
          >
            {lockType === 'passkey'
              ? <KeyRound size={32} className="text-primary" />
              : <Fingerprint size={32} className="text-primary" />}
          </button>
          <p className="text-xs text-muted-foreground">
            {lockType === 'passkey' ? 'Tap to use your passkey' : 'Tap to use Face ID / Touch ID'}
          </p>
        </div>
      )}

      {/* Fallback to PIN if not using PIN */}
      {lockType !== 'pin' && !showPinFallback && (
        <button
          onClick={() => setShowPinFallback(true)}
          className="text-[10px] text-muted-foreground underline"
        >
          Use PIN instead
        </button>
      )}
    </div>
  );
}
