import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Phone, CheckCircle, X, Loader2 } from 'lucide-react';

export function PhoneAuth() {
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'idle' | 'verify' | 'confirmed'>('idle');
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadPhone = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const p = user?.phone ?? null;
    setCurrentPhone(p);
    if (p) setStep('confirmed');
  }, []);

  useEffect(() => { loadPhone(); }, [loadPhone]);

  const handleSendOtp = async () => {
    const cleaned = phone.trim();
    if (!cleaned.startsWith('+')) {
      toast.error('Include country code (e.g. +15551234567)');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ phone: cleaned });
    if (error) {
      toast.error(error.message);
    } else {
      setStep('verify');
      toast.success('Verification code sent to your phone');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 4) {
      toast.error('Enter the verification code');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: phone.trim(),
      token: otp.trim(),
      type: 'phone_change',
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Phone number verified and linked');
      setCurrentPhone(phone.trim());
      setPhone('');
      setOtp('');
      setStep('confirmed');
    }
    setLoading(false);
  };

  const handleRemove = async () => {
    setRemoving(true);
    // Supabase: set phone to empty string removes it
    const { error } = await supabase.auth.updateUser({ phone: '' } as any);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Phone number removed');
      setCurrentPhone(null);
      setStep('idle');
      setPhone('');
    }
    setRemoving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Phone size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium">Phone Number</span>
      </div>

      {step === 'confirmed' && currentPhone ? (
        <div className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5" style={{ borderRadius: 'var(--radius)' }}>
          <div className="flex items-center gap-2">
            <CheckCircle size={12} className="text-primary" />
            <span className="text-xs">{currentPhone}</span>
          </div>
          <button
            onClick={() => { setStep('idle'); setCurrentPhone(null); }}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Change
          </button>
        </div>
      ) : step === 'verify' ? (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">Enter the code sent to <span className="text-foreground">{phone}</span></p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="Verification code"
              className="flex-1 bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              style={{ borderRadius: 'var(--radius)' }}
            />
            <button
              onClick={handleVerifyOtp}
              disabled={loading || otp.length < 4}
              className="px-3 py-2 text-xs font-medium bg-primary text-primary-foreground btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'Verify'}
            </button>
            <button
              onClick={() => { setStep('idle'); setOtp(''); }}
              className="px-2 py-2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>
          <button
            onClick={handleSendOtp}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Resend code
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Add your phone to enable SMS sign-in and SMS two-factor authentication.
          </p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+15551234567"
              className="flex-1 bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              style={{ borderRadius: 'var(--radius)' }}
            />
            <button
              onClick={handleSendOtp}
              disabled={loading || !phone.trim()}
              className="px-3 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'Send Code'}
            </button>
          </div>
          {currentPhone && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="text-[10px] text-destructive hover:opacity-80 underline"
            >
              {removing ? 'Removing…' : 'Remove phone number'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
