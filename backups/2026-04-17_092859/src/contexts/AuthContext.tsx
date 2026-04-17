import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;    // 30 minutes
const IDLE_WARNING_MS = 25 * 60 * 1000;    // warn at 25 minutes
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;  // check every minute

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
        if (locationRef.current === '/auth') {
          supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: aal }) => {
            if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
              return; // MFA pending — Auth.tsx handles challenge
            }
            navigate('/dashboard');
          });
        }
      } else if (event === 'SIGNED_OUT') {
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
    broadcastSignOut();
    await supabase.auth.signOut();
    setIsDemo(false);
  }, [broadcastSignOut]);

  // ── Idle session timeout ─────────────────────────────────────────────────
  const lastActivityRef = useRef(Date.now());
  const warnedRef = useRef(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    warnedRef.current = false;
  }, []);

  useEffect(() => {
    if (!user || isDemo) return;

    const events = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'] as const;
    const opts: AddEventListenerOptions = { passive: true };
    events.forEach(e => window.addEventListener(e, resetActivity, opts));

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_TIMEOUT_MS) {
        toast.info('You were signed out due to 30 minutes of inactivity.');
        signOutWithBroadcast();
      } else if (idleMs >= IDLE_WARNING_MS && !warnedRef.current) {
        warnedRef.current = true;
        toast.warning('Your session will expire in 5 minutes due to inactivity. Move your mouse or press a key to stay signed in.');
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      clearInterval(interval);
    };
  }, [user, isDemo, resetActivity, signOutWithBroadcast]);

  return (
    <AuthContext.Provider value={{ user, loading, isDemo, setIsDemo, signOut: signOutWithBroadcast }}>
      {children}
    </AuthContext.Provider>
  );
}
