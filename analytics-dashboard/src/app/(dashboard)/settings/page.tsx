"use client";

import { useTheme } from "next-themes";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const signOut = async () => {
    const supabase = createClient();
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Theme, account, and API configuration" />

      <Card>
        <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          {(["light", "dark", "system"] as const).map((t) => (
            <Button key={t} variant={theme === t ? "default" : "secondary"} size="sm" onClick={() => setTheme(t)}>
              {t}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Email: {user?.email}</p>
          <p>Role: {user?.role}</p>
          <Button variant="secondary" size="sm" onClick={signOut}>Sign out</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>API Endpoints</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs text-zinc-500 font-mono">
          <p>Research: {process.env.NEXT_PUBLIC_RESEARCH_API_URL || "/api/research"}</p>
          <p>Trading: {process.env.NEXT_PUBLIC_TRADING_API_URL || "/api/trading"}</p>
          <p>WebSocket: {process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/ws"}</p>
        </CardContent>
      </Card>
    </div>
  );
}
