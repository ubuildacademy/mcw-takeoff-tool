# Railway Backend Troubleshooting

## Issue: Getting 404 Errors from Backend

If you're seeing 404 errors when the frontend tries to call the backend API, check the following:

## Step 1: Verify Railway Configuration

### Check Root Directory
1. Go to Railway project dashboard
2. Click on your service
3. Go to **Settings** → **Source**
4. **Root Directory** should be set to: `server`
5. If not, click "Change" and set it to `server`

### Check Build & Start Commands
1. Go to **Settings** → **Deploy**
2. Make sure:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - OR just let Railway auto-detect (it should work)

## Step 2: Check Railway Logs

1. Go to Railway dashboard
2. Click on your service
3. Click on **Deployments** tab
4. Click on the latest deployment
5. Check **Logs** tab

Look for:
- ✅ `🚀 Takeoff API server running on port 4000` = Good!
- ❌ `Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required` = Missing env var
- ❌ `Cannot find module` = Dependencies issue
- ❌ `Port already in use` = Port conflict

## Step 3: Verify Environment Variables in Railway

1. Go to **Variables** tab
2. Make sure you have:
   ```
   SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   NODE_ENV=production
   PORT=4000
   ```

## Step 4: Test Backend Directly

Once Railway is running, test the health endpoint:

```bash
curl https://your-railway-url.up.railway.app/api/health
```

Should return:
```json
{"status":"ok","timestamp":"2024-01-01T12:00:00.000Z"}
```

If you get 404, the backend isn't running properly.

## Step 5: Common Issues

### Issue: "SUPABASE_SERVICE_ROLE_KEY environment variable is required"
**Fix:** Add the service role key to Railway environment variables

### Issue: "Cannot find module 'express'"
**Fix:** 
1. Check that `package.json` is in the `server` directory
2. Railway should run `npm install` automatically
3. Check logs to see if install failed

### Issue: "Port already in use"
**Fix:**
1. Railway assigns the port automatically via `PORT` environment variable
2. Make sure your code uses `process.env.PORT || 4000`
3. It should - check `server/src/index.ts` line 26

### Issue: Routes not working (404)
**Fix:**
1. Make sure the backend is actually starting (check logs)
2. Test `/api/health` first
3. If health works but other routes don't, check route definitions

## Step 6: Railway-Specific Configuration

### If Railway Auto-Detection Fails

Create a `railway.json` in the `server` directory:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Alternative: Use Procfile

Create `server/Procfile`:
```
web: npm start
```

## Step 7: Verify Vercel Environment Variable

In Vercel, make sure:
```
VITE_API_BASE_URL=https://your-railway-url.up.railway.app/api
```

Replace `your-railway-url` with your actual Railway URL (not the `.internal` one!)

## Quick Debug Checklist

- [ ] Railway root directory is `server`
- [ ] Environment variables are set in Railway
- [ ] Backend logs show "🚀 Takeoff API server running"
- [ ] `/api/health` endpoint works when tested directly
- [ ] Railway public URL is set correctly in Vercel's `VITE_API_BASE_URL`
- [ ] Vercel has been redeployed after setting `VITE_API_BASE_URL`

## Still Having Issues?

1. Share your Railway logs
2. Share the exact error from browser console
3. Test the backend URL directly: `curl https://your-backend-url/api/health`

