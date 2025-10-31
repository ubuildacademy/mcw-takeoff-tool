# 🔒 Security Guide: Environment Variables

## Overview

This application has a **two-tier architecture**:
- **Frontend**: React app (runs in the browser / on Vercel)
- **Backend**: Express API server (separate service)

## Environment Variables by Location

### ✅ Frontend (Vercel) - SAFE TO EXPOSE PUBLICLY

These environment variables are **safe** because they're used by the client-side code and are public anyway:

```bash
VITE_SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Public anon key
VITE_API_BASE_URL=https://your-backend.railway.app  # Your backend URL
```

**Why these are safe:**
- The `anon` key is designed to be public (it's in your frontend code already)
- The `anon` key respects Row Level Security (RLS) policies in Supabase
- The API base URL is public information

### 🔐 Backend (Railway/Render/etc.) - NEVER EXPOSE

These environment variables should **ONLY** be set on your backend hosting platform:

```bash
SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # SECRET!
OLLAMA_API_KEY=your_ollama_key  # Optional
NODE_ENV=production
PORT=4000
```

**Why the service role key is dangerous:**
- It bypasses all Row Level Security (RLS) policies
- It has admin-level access to your Supabase project
- If exposed, attackers can read/write/delete any data in your database
- **NEVER** add this to Vercel environment variables if Vercel hosts your frontend

## Deployment Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │         │    Backend      │
│   (Vercel)      │ ──────► │  (Railway/etc.) │
│                 │         │                 │
│ Uses:           │         │ Uses:           │
│ • anon key      │         │ • service_role  │
│ • API URL       │         │ • API keys      │
└─────────────────┘         └─────────────────┘
         │                           │
         │                           │
         ▼                           ▼
┌─────────────────────────────────────────┐
│         Supabase Database               │
│  (RLS policies protect data)            │
└─────────────────────────────────────────┘
```

## Setup Instructions

### Local Development

**Frontend `.env` (optional, can be hardcoded):**
```bash
VITE_SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

**Backend `.env` (required):**
```bash
SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
PORT=4000
NODE_ENV=development
```

### Production Deployment

**1. Deploy Backend to Railway (or similar):**

1. Go to Railway/Render dashboard
2. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` ← **SECRET, only here!**
   - `NODE_ENV=production`
   - `PORT=4000`

**2. Deploy Frontend to Vercel:**

1. Go to Vercel dashboard
2. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` ← Safe to expose
   - `VITE_API_BASE_URL=https://your-backend.railway.app`

**3. Update Backend CORS:**

In `server/src/index.ts`, update CORS to allow your Vercel domain:
```typescript
origin: process.env.NODE_ENV === 'production' 
  ? ['https://your-vercel-app.vercel.app'] 
  : true
```

## Security Checklist

- [ ] Service role key is in `.gitignore`
- [ ] Service role key is NOT in frontend code
- [ ] Service role key is NOT in Vercel env vars (if frontend is on Vercel)
- [ ] Service role key IS in backend hosting platform env vars (Railway, etc.)
- [ ] Frontend uses `anon` key only
- [ ] Backend CORS is configured to allow only your frontend domain
- [ ] Row Level Security (RLS) is enabled in Supabase

## What If I Accidentally Expose the Service Role Key?

1. **Immediately rotate the key** in Supabase dashboard:
   - Settings → API → Service Role Key → Reset
2. **Update** all places where the key is stored (backend hosting)
3. **Review** your database logs for unauthorized access
4. **Check** RLS policies to ensure they're properly configured

## Key Differences

| Key Type | Location | Security | Purpose |
|----------|----------|----------|---------|
| **Anon Key** | Frontend (Vercel) | ✅ Safe to expose | User authentication, respects RLS |
| **Service Role Key** | Backend only | 🔐 NEVER expose | Admin operations, bypasses RLS |

Remember: The **service role key** is like a master key to your database. Keep it secret!

