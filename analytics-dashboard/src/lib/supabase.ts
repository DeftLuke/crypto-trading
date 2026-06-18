import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export function roleFromEmail(email: string): import("@/types").UserRole {
  if (email.includes("admin")) return "admin";
  if (email.includes("research")) return "researcher";
  if (email.includes("trader") || email.includes("demo")) return "trader";
  return "viewer";
}
