import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';

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

  useEffect(() => {
    // Check for email confirmation tokens in URL
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');

    if (type === 'signup' && accessToken) {
      // User just confirmed their email
      toast.success('Email confirmed! Please sign in with your credentials.');
      
      // Clean up the URL
      window.history.replaceState({}, document.title, '/auth');
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      initialized.current = true;

      // Handle different auth events
      if (event === 'SIGNED_IN') {
        if (location.pathname === '/auth') {
          // Check MFA requirement before navigating — if AAL2 is needed,
          // Auth.tsx handles the challenge screen; don't navigate yet
          supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data: aal }) => {
            if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
              // MFA pending — Auth.tsx will switch to 'mfa' mode, stay put
              return;
            }
            navigate('/dashboard');
          });
        }
      } else if (event === 'SIGNED_OUT') {
        navigate('/auth');
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
        console.warn('Auth initialization timed out');
        setLoading(false);
        initialized.current = true;
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, location.pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsDemo(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isDemo, setIsDemo, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
