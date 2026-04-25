import { useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import ModalShell from '@/components/shared/ModalShell';

interface Props {
  onDismiss: () => void;
}

export default function FounderNoteModal({ onDismiss }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dismissing, setDismissing] = useState(false);

  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    if (user) {
      await supabase
        .from('profiles')
        .update({ founder_note_seen: true } as any)
        .eq('user_id', user.id);
      // Invalidate cached profile so future Dashboard mounts read the updated value.
      qc.invalidateQueries({ queryKey: ['profile'] });
    }
    onDismiss();
  };

  return (
    <ModalShell onDismiss={handleDismiss}>
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-6 pb-0">
        <div className="space-y-0.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">A note from the founder</p>
          <h2 className="font-display font-bold text-xl text-gold">FORGED</h2>
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -mt-1 -mr-1"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3 text-sm text-foreground leading-relaxed">
        <p>Hey — I'm Tre.</p>
        <p>
          I built Forged because I got tired of paying $15/month for apps that showed me ads,
          sold my data, and still couldn't explain why I felt broke despite making decent money.
        </p>
        <p>
          Forged is different. No ads. No data selling. No dark patterns. Just a real tool
          built to help you see exactly where your money goes and what to do about it.
        </p>
        <p>
          This is version 1. It's not perfect yet — but it's real, it's honest, and it's yours.
        </p>
        <p>
          If you ever want to share feedback, hit me at{' '}
          <a href="mailto:contact@treforged.com" className="text-primary underline underline-offset-2">
            contact@treforged.com
          </a>.
        </p>
        <p>Now let's build something solid.</p>
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-4 border-t border-border/40 space-y-3">
        <p className="text-xs text-muted-foreground">— Tre, founder of TRE Forged LLC</p>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="w-full py-2.5 bg-primary text-primary-foreground text-xs font-semibold btn-press disabled:opacity-60"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Let's go
        </button>
      </div>
    </ModalShell>
  );
}
