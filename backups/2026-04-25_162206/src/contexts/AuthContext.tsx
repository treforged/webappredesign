import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { initRevenueCat, logOutRevenueCat } from '@/lib/purchases';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;    // 10 minutes
const IDLE_WARNING_MS =  8 * 60 * 1000;    // warn at 8 minutes
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;  // check every 30 seconds
const LAST_ACTIVITY_KEY = 'forged:last_activity';
const REVIEWER_EMAIL = 'reviewer@treforged.com';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  isDemo: boolean;
  setIsDemo: (v: boolean) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isDemo: false,
  setIsDemo: () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const initialized = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Use a ref for location to avoid stale closure issues in onAuthStateChange
  const locationRef = useRef(location.pathname);
  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setIsDemo(false);
  }, []);

  const resetReviewerAccount = useCallback(async (userId: string) => {
    await supabase
      .from('profiles')
      .update({ founder_note_seen: false, onboarding_completed: false } as any)
      .eq('user_id', userId);
    localStorage.removeItem(`forged:onboarding_done_${userId}`);
    localStorage.removeItem('forged:tour_done_new_user');
    localStorage.removeItem('forged:tour_done_premium');
    sessionStorage.removeItem('forged:founder_note_seen');
    sessionStorage.removeItem('forged:onboarding_wizard_dismissed');
  }, []);

  // ── Auth state listener ──────────────────────────────────────────────────
  useEffect(() => {
    // Handle email confirmation token in URL hash
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');
    if (type === 'signup' && accessToken) {
      toast.success('Email confirmed! Please sign in with your credentials.');
      window.history.replaceState({}, document.title, '/auth');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      initialized.current = true;

      if (event === 'SIGNED_IN') {
        setIsDemo(false);
        if (session?.user?.id) {
          initRevenueCat(session.user.id).catch(() => {/* native no-op on web */});
        }
        // Await reviewer reset before navigating so Dashboard's profile SELECT
        // always reads the updated founder_note_seen / onboarding_completed values.
        const reviewerResetPromise = session?.user?.email === REVIEWER_EMAIL && session?.user?.id
          ? resetReviewerAccount(session.user.id)
          : Promise.resolve();
        if (locationRef.current === '/auth') {
          reviewerResetPromise
            .then(() => supabase.auth.mfa.getAuthenticatorAssuranceLevel())
            .then(({ data: aal }) => {
              if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
                return; // MFA pending — Auth.tsx handles challenge
              }
              navigate('/dashboard');
            });
        }
      } else if (event === 'SIGNED_OUT') {
        logOutRevenueCat().catch(() => {/* native no-op on web */});
        navigate('/auth');
      } else if (event === 'TOKEN_REFRESHED') {
        // Session refreshed silently — no action needed
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialized.current) {
        setUser(session?.user ?? null);
        setLoading(false);
        initialized.current = true;
      }
    });

    const timeout = setTimeout(() => {
      if (!initialized.current) {
        setLoading(false);
        initialized.current = true;
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  // ── Cross-tab sign-out via BroadcastChannel ──────────────────────────────
  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('forged_auth');
    channel.onmessage = (e) => {
      if (e.data === 'SIGN_OUT') {
        // Another tab signed out — sign out this tab too
        supabase.auth.signOut();
      }
    };
    return () => channel.close();
  }, []);

  const broadcastSignOut = useCallback(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('forged_auth');
    channel.postMessage('SIGN_OUT');
    channel.close();
  }, []);

  const signOutWithBroadcast = useCallback(async () => {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    if (user?.email === REVIEWER_EMAIL && user?.id) {
      await resetReviewerAccount(user.id);
    }
    broadcastSignOut();
    await supabase.auth.signOut();
    setIsDemo(false);
  }, [broadcastSignOut, user, resetReviewerAccount]);

  // ── Idle session timeout ─────────────────────────────────────────────────
  // Last activity is stored in localStorage so it survives tab close/reopen.
  // On visibilitychange (user returns to the app) we check immediately — this
  // is how we enforce the timeout even when the app was backgrounded or closed.
  const warnedRef = useRef(false);

  const resetActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    warnedRef.current = false;
  }, []);

  const getIdleMs = useCallback(() => {
    const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
    return Date.now() - (stored ? parseInt(stored, 10) : Date.now());
  }, []);

  useEffect(() => {
    if (!user || isDemo) return;

    // Seed the key if not yet set so the timer starts from login
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    }

    const checkIdle = () => {
      const idleMs = getIdleMs();
      if (idleMs >= IDLE_TIMEOUT_MS) {
        toast.info('You were signed out due to 10 minutes of inactivity.');
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        signOutWithBroadcast();
      } else if (idleMs >= IDLE_WARNING_MS && !warnedRef.current) {
        warnedRef.current = true;
        toast.warning('Your session will expire in 2 minutes due to inactivity.');
      }
    };

    // Check immediately when the user returns to the tab / app
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkIdle();
    };

    const events = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'] as const;
    const opts: AddEventListenerOptions = { passive: true };
    events.forEach(e => window.addEventListener(e, resetActivity, opts));
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    const interval = setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      clearInterval(interval);
    };
  }, [user, isDemo, resetActivity, getIdleMs, signOutWithBroadcast]);

  return (
    <AuthContext.Provider value={{ user, loading, isDemo, setIsDemo, signOut: signOutWithBroadcast }}>
      {children}
    </AuthContext.Provider>
  );
}
