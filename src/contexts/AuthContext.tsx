import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      initialized.current = true;
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
  }, []);

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
