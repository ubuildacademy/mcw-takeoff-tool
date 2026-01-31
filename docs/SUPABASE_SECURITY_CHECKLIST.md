# Supabase Security Checklist

Use this after running the SQL migration for function search_path and RLS. These items are **Dashboard-only** (no code changes).

**Note:** Items 1 and 2 (leaked password protection, MFA) depend on your Auth/email setup. If you haven’t set up SMTP or the email system yet, skip them until email is configured—then enable these in the Dashboard.

---

## 1. Leaked password protection (Auth)

**Why:** Blocks users from setting passwords that are known to be compromised (e.g. from breaches).

**Steps:**

1. In [Supabase Dashboard](https://supabase.com/dashboard), open your project (**MCW Takeoff**).
2. Go to **Authentication** → **Providers** → **Email** (or **Auth** → **Providers**).
3. Find **“Leaked password protection”** (or “Check for compromised passwords”).
4. **Enable** it and save.

---

## 2. MFA options (Auth)

**Why:** Multi-factor authentication reduces account takeover risk and is expected for professional apps.

**Steps:**

1. In the same project, go to **Authentication** → **Providers** (or **Auth** → **MFA**).
2. Enable at least one MFA method, e.g. **TOTP** (authenticator app).
3. Optionally enforce MFA for certain roles or environments.
4. In your app, you can add an “Account” or “Security” section where users can enroll in MFA (Supabase Auth UI or your own flow).

---

## 3. After running the SQL migration

1. Open **SQL Editor** in the Supabase Dashboard.
2. Paste and run the contents of **`server/migrations/supabase_security_advisor_fixes.sql`**.
3. If the second function name fails (e.g. no function matches `update_ocr_training_data%`), run:
   ```sql
   SELECT routine_name FROM information_schema.routines
   WHERE routine_schema = 'public' AND routine_name LIKE '%ocr_training%';
   ```
   Then add a single `ALTER FUNCTION public.<exact_name>(...) SET search_path = public;` for that function and run it.
4. In **Security Advisor**, click **Refresh** (or **Rerun linter**) and confirm the warnings are resolved.

---

## Summary

| Item | Where | Action |
|------|--------|--------|
| Function search_path | SQL migration | Run `supabase_security_advisor_fixes.sql` in SQL Editor |
| RLS on `ocr_training_data` | SQL migration | Same migration (drops permissive policies, adds authenticated-only) |
| Leaked password protection | Dashboard → Auth → Email | Enable |
| MFA options | Dashboard → Auth → Providers / MFA | Enable at least one method (e.g. TOTP) |
