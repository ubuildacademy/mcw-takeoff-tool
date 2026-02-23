# Email Setup Guide: SMTP, Invitations & Auth

This guide covers setting up email for Meridian Takeoff:

1. **Supabase Auth SMTP** – Sign-up confirmations, password reset, magic links
2. **Supabase Edge Function** – Invitation emails and transactional emails
3. **Microsoft 365 / Azure** – Using your Azure app registration (Mailer)

---

## Part 1: Supabase Auth SMTP (Sign-up & Password Reset)

Supabase uses these emails for:

- Email confirmation on sign-up
- Password reset links
- Magic link sign-in
- Invitation emails sent from the Auth UI

### Configure in Supabase Dashboard

1. Go to your Supabase project: **Authentication → Providers → Email**
2. Under **SMTP Settings**, enable custom SMTP
3. Or go to **Project Settings → Auth → SMTP**

### Microsoft 365 / Azure SMTP Settings

From your Azure app ("Mailer") and SMTP capability:

| Setting | Value |
|--------|-------|
| **Host** | `smtp.office365.com` |
| **Port** | `587` |
| **User** | Your mailbox email (e.g. `mailer@yourdomain.com`) |
| **Password** | Your mailbox password or app-specific password |

**Important:** The Azure app credentials (Application ID, Tenant ID, Client Secret from "Certificates & secrets") are for **OAuth2 / Microsoft Graph API**. They are *not* the SMTP username/password. For standard SMTP, you need a **mailbox** (e.g. `mailer@yourdomain.com`) with SMTP AUTH enabled. Typical options:

- **A) Classic SMTP AUTH:** Use a shared mailbox or service account with SMTP AUTH enabled in Exchange (if your tenant still supports it).
- **B) Modern auth:** If your tenant uses OAuth2-only, you’ll need to use the Send Email Auth Hook or a relay that supports OAuth2 (see Part 4).

### Alternative: Built-in Supabase Email (dev only)

Supabase’s default SMTP has strict limits and only works for project team emails. For real users, configure custom SMTP or the Send Email Auth Hook.

---

## Part 2: Supabase Edge Function (Invitations & Reports)

The `send-email-smtp` Edge Function sends invitation emails and can be used later for reports.

### Deploy the Edge Function

1. Install Supabase CLI: `npm install -g supabase`
2. Log in: `supabase login`
3. Link the project (if not done): `supabase link`
4. Set SMTP secrets:

```bash
supabase secrets set SMTP_HOST=smtp.office365.com
supabase secrets set SMTP_PORT=587
supabase secrets set SMTP_USER=mailer@yourdomain.com
supabase secrets set SMTP_PASSWORD="your-mailbox-password-or-app-password"
supabase secrets set SMTP_FROM=mailer@yourdomain.com
```

5. Deploy:

```bash
supabase functions deploy send-email-smtp
```

### Server Environment (Use Edge Function)

Add to `server/.env`:

```bash
# Use Edge Function for email (keeps SMTP secrets in Supabase)
USE_SUPABASE_EDGE_EMAIL=true

# Already required for API
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

If `USE_SUPABASE_EDGE_EMAIL` is not set, the server falls back to direct SMTP and needs `SMTP_*` variables (see Part 3).

---

## Part 3: Direct SMTP (Server-Only)

If you prefer the Node server to send email directly instead of the Edge Function:

Add to `server/.env`:

```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=mailer@yourdomain.com
SMTP_PASSWORD=your-mailbox-password
SMTP_FROM=Meridian Takeoff <mailer@yourdomain.com>
```

Do **not** set `USE_SUPABASE_EDGE_EMAIL=true` in this case.

---

## Part 4: Microsoft 365 with Azure App (Mailer)

Your app registration has:

- **Application (client) ID:** `afb3a069-d1c7-4995-b650-34ac3e686f1b`
- **Directory (tenant) ID:** `06362d35-b92c-47da-9f63-37df8b995e69`
- **Client secret:** (the long string from the first image – keep it secure)

These are for OAuth2. To use them:

### Option A: Microsoft Graph API

Use the Graph API `/users/{id}/sendMail` instead of SMTP. You’d need to:

1. Grant `Mail.Send` (application permission) and admin consent
2. Add an Exchange application access policy for the mailbox
3. Update the Edge Function or server to call Graph instead of SMTP

### Option B: SMTP AUTH with a mailbox

Use a mailbox that still has SMTP AUTH enabled:

1. Ensure SMTP AUTH is enabled for that mailbox
2. Use its email and password as SMTP_USER and SMTP_PASSWORD

Microsoft is deprecating basic auth for SMTP; OAuth2 is the long-term approach.

---

## Quick Checklist

- [ ] Configure Supabase Auth SMTP in the dashboard (for sign-up/reset)
- [ ] Deploy `send-email-smtp` and set secrets
- [ ] Set `USE_SUPABASE_EDGE_EMAIL=true` in `server/.env`
- [ ] Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set
- [ ] (Future) Add report email templates and send via `emailService.sendEmail()`

---

## Testing

1. **Invitation:** Create an invitation from the Admin Panel and confirm the invite email is received.
2. **Auth:** Sign up a new user and test confirmation and reset flows from Supabase Auth.
