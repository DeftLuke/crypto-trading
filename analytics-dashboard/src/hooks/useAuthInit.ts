"use client";

import { useEffect } from "react";
import { createClient, roleFromEmail } from "@/lib/supabase";
import { useAuthStore } from "@/store/authStore";

export function useAuthInit() {
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setUser({
        id: "dev",
        email: "demo@deft-luke.online",
        role: "trader",
        displayName: "Demo Trader",
      });
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || "",
          role: roleFromEmail(session.user.email || ""),
          displayName: session.user.user_metadata?.display_name,
        });
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || "",
          role: roleFromEmail(session.user.email || ""),
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [setUser, setLoading]);
}
