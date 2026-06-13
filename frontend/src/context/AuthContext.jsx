import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isAuthEnabled, getAuthRedirectUrl } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(isAuthEnabled);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Pick up session from email confirm hash (#access_token=...) or PKCE code
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      cleanAuthHashFromUrl();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        cleanAuthHashFromUrl();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, displayName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
        emailRedirectTo: getAuthRedirectUrl(),
      },
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, isAuthEnabled }}>
      {children}
    </AuthContext.Provider>
  );
}

function cleanAuthHashFromUrl() {
  if (typeof window === 'undefined') return;
  const { hash, pathname, search } = window.location;
  if (hash.includes('access_token') || hash.includes('type=signup') || search.includes('code=')) {
    window.history.replaceState(null, '', pathname || '/');
  }
}

export function useAuth() {
  return useContext(AuthContext);
}
