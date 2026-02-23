# Microsoft Graph Email Setup

Uses your Azure app (Mailer) – Client ID, Tenant ID, Client Secret. No SMTP needed.

Your values:
- **Client ID:** `afb3a069-d1c7-4995-b650-34ac3e686f1b`
- **Tenant ID:** `06362d35-b92c-47da-9f63-37df8b995e69`
- **Client Secret:** (from Certificates & secrets – keep it secure)
- **Sender mailbox:** The email address to send from (e.g. `mailer@yourdomain.com`)

---

## Step 1: Azure – Add Mail.Send permission

1. Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. Open your **Mailer** app
3. Click **API permissions** → **Add a permission**
4. Choose **Microsoft Graph** → **Application permissions**
5. Search for **Mail.Send**, check it, click **Add permissions**
6. Click **Grant admin consent for [your org]** (required – needs admin role)

---

## Step 2: Exchange – Only if you get access errors

Most orgs work after Step 1. Skip this unless you see "ApplicationAccessPolicy" or "access denied" when sending.

If needed, an Exchange admin runs PowerShell:

```powershell
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AppId afb3a069-d1c7-4995-b650-34ac3e686f1b -PolicyScopeGroupId mailer@yourdomain.com -AccessRight RestrictAccess
```

Replace `mailer@yourdomain.com` with your actual sender mailbox.

---

## Step 3: Deploy the Edge Function and set secrets

```bash
cd /path/to/Meridian\ Takeoff
supabase login
supabase link
```

Set secrets (use your real client secret and sender email):

```bash
supabase secrets set GRAPH_CLIENT_ID=afb3a069-d1c7-4995-b650-34ac3e686f1b
supabase secrets set GRAPH_TENANT_ID=06362d35-b92c-47da-9f63-37df8b995e69
supabase secrets set GRAPH_CLIENT_SECRET="your-client-secret"
supabase secrets set GRAPH_SENDER_EMAIL=mailer@yourdomain.com
```

Deploy:

```bash
supabase functions deploy send-email-graph
```

---

## Step 4: Configure the server

Add to `server/.env`:

```bash
USE_SUPABASE_EDGE_EMAIL=true
USE_GRAPH_EMAIL=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Restart the server.

---

## Step 5: Test

Create an invitation from the Admin Panel. The invite email should be sent via Microsoft Graph.

---

## Supabase Auth emails (sign-up, password reset)

Graph is only used for invitation emails. Supabase Auth still needs SMTP for sign-up confirmations and password resets. Configure that separately under **Authentication → SMTP** in the Supabase Dashboard.
