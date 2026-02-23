# Backend Server Setup

## Environment Variables

Create a `.env` file in the `server` directory with the following variables:

```bash
SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Redis Configuration (Required for CV Takeoff background processing)
REDIS_URL=redis://localhost:6379
# On Railway, add a Redis service and use the REDIS_URL from the service variables
# Or use Redis Cloud: REDISCLOUD_URL=redis://...

# Ollama API Configuration (Optional - for AI features)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=your_ollama_api_key_here

# Email Configuration (choose ONE approach)

# Option A: Supabase Edge Function (recommended - keeps SMTP secrets in Supabase)
USE_SUPABASE_EDGE_EMAIL=true
# SMTP_* secrets are set via: supabase secrets set SMTP_HOST=... etc.
# See docs/EMAIL_SETUP.md for full setup

# Option B: Direct SMTP (server sends via nodemailer)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=mailer@yourdomain.com
SMTP_PASSWORD=your-mailbox-password
SMTP_FROM=noreply@meridiantakeoff.com
```

### Email Configuration

See **docs/EMAIL_SETUP.md** for full setup (Supabase Auth SMTP, Edge Function, Microsoft 365).

**Option A – Supabase Edge Function (recommended):**
- Deploy `supabase functions deploy send-email-smtp`
- Set SMTP secrets in Supabase, then set `USE_SUPABASE_EDGE_EMAIL=true` in server `.env`

**Option B – Direct SMTP:**
- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in server `.env`

**Microsoft 365:** Use `smtp.office365.com`, port `587`, with a mailbox that has SMTP AUTH enabled

**Ollama API Configuration (Optional):**
- `OLLAMA_BASE_URL`: Ollama API base URL (defaults to `https://ollama.com`)
- `OLLAMA_API_KEY`: Your Ollama API key for AI features (chat, analysis, etc.)
  - Required for: AI Takeoff, Chat features, Sheet analysis
  - Get your API key from: https://ollama.com/account/api-keys

**Other Optional:**
- `SMTP_FROM`: The "from" email address (defaults to `SMTP_USER`)
- `FRONTEND_URL`: Base URL for invitation links (defaults to `http://localhost:3000`)

### Getting Your Supabase Service Role Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to Settings → API
4. Copy the `service_role` key (not the `anon` key)

⚠️ **CRITICAL SECURITY**: The service role key should NEVER be:
- Committed to git (it's in `.gitignore`)
- Exposed to the frontend/client
- Added to Vercel environment variables (if Vercel hosts your frontend)
- Made public in any way

The service role key should ONLY exist:
- In your local `.env` file (for development)
- In your backend hosting platform's environment variables (Railway, Render, AWS, etc. for production)

The frontend should ONLY use the Supabase `anon` key, which is safe for public exposure.

## Installation

```bash
npm install
```

## Running the Server

### Development Mode
```bash
npm run dev
```

The server will start on `http://localhost:4000`

### Production Mode
```bash
npm run build
npm start
```

## API Endpoints

The server exposes the following API routes:

- `/api/health` - Health check endpoint
- `/api/projects` - Project management
- `/api/files` - File upload and management
- `/api/conditions` - Takeoff conditions
- `/api/sheets` - Document sheets
- `/api/takeoff-measurements` - Takeoff measurements
- `/api/ocr` - OCR processing
- `/api/ollama` - AI analysis
- `/api/users` - User management

## Troubleshooting

### Server Won't Start

1. **Missing Environment Variables**: Ensure `.env` file exists with all required variables
2. **Port Already in Use**: Change the `PORT` in `.env` or stop the process using port 4000
3. **Dependencies Not Installed**: Run `npm install` in the server directory

### CORS Errors

The server is configured to allow requests from:
- `http://localhost:3000` (development)
- `http://localhost:3001` (development - Vite default)

In production, update the CORS configuration in `src/index.ts` to include your frontend domain.

