# Supabase Auth — Redirect URLs

After email verification, Supabase must redirect to **your dashboard**, not localhost.

## 1. Supabase Dashboard (required — one time)

Open: [Supabase → Authentication → URL Configuration](https://supabase.com/dashboard/project/krvwzjgajlxttktajswp/auth/url-configuration)

| Setting | Value |
|---------|--------|
| **Site URL** | `https://trade.deftluke.online` |
| **Redirect URLs** | Add these (one per line): |

```
https://trade.deftluke.online
https://trade.deftluke.online/
http://localhost:5173
http://localhost:5173/
```

Remove `http://localhost:3000` if it is set as Site URL.

Click **Save**.

## 2. App config (already in code)

Signup sends users back to:

```
https://trade.deftluke.online
```

Set in `frontend/.env`:

```
VITE_APP_URL=https://trade.deftluke.online
```

## 3. If you already verified on localhost

Your account **is created**. Either:

- Go to **https://trade.deftluke.online** and **Sign in** with your email/password, or
- Replace `localhost:3000` with `trade.deftluke.online` in the browser URL (keep the `#access_token=...` part) — session will load once.

## 4. Run migration

Run `supabase/migrations/004_user_auth.sql` in SQL Editor if not done yet.
