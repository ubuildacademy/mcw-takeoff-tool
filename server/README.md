# Backend Server Setup

## Environment Variables

Create a `.env` file in the `server` directory with the following variables:

```bash
SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Email Configuration (Required for user invitations)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@meridiantakeoff.com
```

### Email Configuration

To enable email invitations, configure SMTP settings:

**For Gmail:**
1. Enable 2-factor authentication on your Google account
2. Generate an App Password: https://myaccount.google.com/apppasswords
3. Use the App Password as `SMTP_PASSWORD`
4. Use `smtp.gmail.com` as `SMTP_HOST` and `587` as `SMTP_PORT`

**For Other Email Providers:**
- **Outlook/Hotmail**: `smtp-mail.outlook.com`, port `587`
- **SendGrid**: Use SendGrid SMTP settings
- **AWS SES**: Use AWS SES SMTP credentials
- **Custom SMTP**: Configure with your provider's SMTP settings

**Optional:**
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

