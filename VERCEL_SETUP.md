# Vercel Deployment Setup Guide

## Current Issue: 404 Errors on API Calls

You're seeing 404 errors because the backend API URL is not configured. You have two options:

## Option 1: Deploy Backend Separately (Recommended)

This is the recommended approach because:
- ✅ No API timeout limitations (Vercel has 10-second limits)
- ✅ Better for long-running AI/OCR operations
- ✅ More flexible backend hosting

### Steps:

1. **Deploy Backend to Railway or Render:**
   ```bash
   cd server
   # Follow Railway/Render deployment instructions
   ```

2. **Get your backend URL** (e.g., `https://your-backend.railway.app`)

3. **Set Environment Variable in Vercel:**
   - Go to your Vercel project dashboard
   - Settings → Environment Variables
   - Add:
     ```
     VITE_API_BASE_URL=https://your-backend.railway.app/api
     ```
   - Make sure to select "Production", "Preview", and "Development" environments
   - Click "Save"

4. **Redeploy** your Vercel frontend (or it will auto-redeploy)

## Option 2: Use Vercel Rewrites (Proxy - Limited)

⚠️ **Warning**: Vercel has 10-second timeout limits and may not be suitable for long AI/OCR operations.

### Steps:

1. **Deploy Backend to Railway/Render** (you still need a backend)

2. **Update `vercel.json`** with your backend URL:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "https://your-backend.railway.app/api/$1"
       }
     ]
   }
   ```

3. **Update Frontend Code:**
   - Remove `VITE_API_BASE_URL` requirement
   - Use relative URLs: `/api/...` instead of full URLs

4. **Redeploy**

## Quick Fix for Current Deployment

**Right now, you need to:**

1. Deploy your backend to Railway (or similar):
   - Go to [railway.app](https://railway.app)
   - Create a new project
   - Connect your GitHub repo
   - Set root directory to `server`
   - Add environment variables:
     ```
     SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
     NODE_ENV=production
     PORT=4000
     ```

2. Get your Railway backend URL (e.g., `https://mcw-takeoff-backend.railway.app`)

3. In Vercel, add environment variable:
   ```
   VITE_API_BASE_URL=https://mcw-takeoff-backend.railway.app/api
   ```

4. Redeploy Vercel frontend

## Environment Variables Checklist

### Vercel (Frontend) - Required:
- ✅ `VITE_SUPABASE_URL` = `https://mxjyytwfhmoonkduvybr.supabase.co`
- ✅ `VITE_SUPABASE_ANON_KEY` = (your anon key)
- ✅ `VITE_API_BASE_URL` = `https://your-backend.railway.app/api` ← **You need this!**

### Railway/Render (Backend) - Required:
- ✅ `SUPABASE_URL` = `https://mxjyytwfhmoonkduvybr.supabase.co`
- ✅ `SUPABASE_SERVICE_ROLE_KEY` = (your service role key) ← **Secret!**
- ✅ `NODE_ENV` = `production`
- ✅ `PORT` = `4000`

## Troubleshooting

**Still getting 404?**
- Check that `VITE_API_BASE_URL` is set in Vercel
- Check that the backend URL is correct (ends with `/api`)
- Redeploy after adding environment variables
- Check browser console for the exact error

**CORS errors?**
- Make sure backend CORS allows your Vercel domain
- Check `server/src/index.ts` CORS configuration

