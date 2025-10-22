# 🚀 Meridian Takeoff Deployment Guide

## Overview
This app has both a frontend (React/Vite) and backend (Express/Node.js) that need to be deployed separately.

## Option 1: Vercel + Railway (Recommended)

### Step 1: Deploy Backend to Railway

1. **Create Railway Account**: Go to [railway.app](https://railway.app) and sign up
2. **Connect GitHub**: Link your GitHub repository
3. **Create New Project**: 
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your Meridian Takeoff repository
   - Select the `server` folder as the root directory

4. **Set Environment Variables in Railway**:
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   OLLAMA_BASE_URL=https://ollama.com
   OLLAMA_API_KEY=your_ollama_api_key
   NODE_ENV=production
   ```

5. **Deploy**: Railway will automatically deploy your backend
6. **Get Backend URL**: Copy the Railway deployment URL (e.g., `https://your-app.railway.app`)

### Step 2: Deploy Frontend to Vercel

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy from Project Root**:
   ```bash
   vercel
   ```

4. **Set Environment Variables in Vercel**:
   - Go to your Vercel dashboard
   - Select your project
   - Go to Settings → Environment Variables
   - Add:
     ```
     VITE_SUPABASE_URL=your_supabase_url
     VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
     VITE_OLLAMA_API_KEY=your_ollama_api_key
     VITE_API_BASE_URL=https://your-app.railway.app
     ```

5. **Update API Configuration**:
   - Update `src/services/apiService.ts` to use your Railway backend URL
   - Or use the `vercel.json` configuration to proxy API calls

### Step 3: Configure API Proxy

Update your `vite.config.ts` for production:

```typescript
export default defineConfig({
  // ... existing config
  server: {
    port: 3001,
    strictPort: true,
    open: true,
    proxy: {
      '/api': {
        target: process.env.NODE_ENV === 'production' 
          ? 'https://your-app.railway.app' 
          : 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
```

## Option 2: Vercel with API Routes (Limited)

⚠️ **Note**: This option has limitations for your use case because:
- Vercel has a 10-second timeout for API routes
- AI processing can take longer than 10 seconds
- File uploads and PDF processing may hit size limits

If you still want to try this approach:

1. **Move API routes to Vercel**:
   - Create `api/` folder in your project root
   - Move Express routes to Vercel API format
   - Update imports and dependencies

2. **Deploy to Vercel**:
   ```bash
   vercel
   ```

## Environment Variables Setup

### Frontend (Vercel)
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OLLAMA_API_KEY=your_ollama_api_key
VITE_API_BASE_URL=https://your-backend-url.railway.app
```

### Backend (Railway)
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=your_ollama_api_key
NODE_ENV=production
```

## Important Notes

1. **AI Model**: The local AI model won't work in production. You'll need to:
   - Use a cloud-based vision model (like OpenAI GPT-4V)
   - Or deploy the AI model to a cloud GPU service
   - Or use the Ollama cloud API

2. **File Storage**: Make sure your Supabase storage is properly configured for production

3. **CORS**: Update CORS settings in your backend to allow your Vercel domain

4. **Domain**: Your Vercel app will be available at `mcwtakeoff-67py4h8qh-acejeff37s-projects.vercel.app`

## Quick Start Commands

```bash
# Deploy backend to Railway
cd server
railway login
railway init
railway up

# Deploy frontend to Vercel
cd ..
vercel login
vercel
```

## Troubleshooting

- **CORS Issues**: Update backend CORS to include your Vercel domain
- **API Timeouts**: Consider using background jobs for long-running tasks
- **File Upload Issues**: Check Supabase storage configuration
- **Environment Variables**: Make sure all required variables are set in both platforms

