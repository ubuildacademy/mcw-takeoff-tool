# Local Development Setup Guide

This guide will help you set up a local development environment for Meridian Takeoff, allowing you to develop and test changes without waiting for deployments.

## Prerequisites

Before starting, ensure you have:

1. **Node.js 18+** installed
   - Check: `node --version`
   - Install: https://nodejs.org/

2. **Python 3.8+** installed
   - Check: `python3 --version` or `python --version`
   - Install: https://www.python.org/downloads/

3. **Git** installed
   - Check: `git --version`

4. **Supabase Account** (you already have this)
   - Your Supabase project URL and keys

## Step 1: Clone and Navigate to Project

```bash
# If you haven't already cloned
cd "/Users/jeff/Library/Mobile Documents/com~apple~CloudDocs/Code/Meridian Takeoff 1.23.26"
```

## Step 2: Set Up Environment Variables

### Frontend Environment Variables

Create a `.env` file in the root directory:

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` and add your Supabase credentials:

```env
# Supabase Configuration (use your actual values)
VITE_SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
VITE_SUPABASE_ANON_KEY=your_actual_anon_key_here

# API Configuration (for local development)
VITE_API_BASE_URL=http://localhost:4000/api
```

**Note:** Get your Supabase keys from your Supabase project dashboard → Settings → API

### Backend Environment Variables

Create a `.env` file in the `server` directory:

```bash
cd server
cp ../.env.example .env
```

Edit `server/.env` and add:

```env
# Supabase Configuration
SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Server Configuration
PORT=4000
NODE_ENV=development
```

**Important:** 
- Use your actual Supabase keys from the dashboard
- The `SUPABASE_SERVICE_ROLE_KEY` is found in Supabase Dashboard → Settings → API → `service_role` key (keep this secret!)

## Step 3: Install Frontend Dependencies

```bash
# From the root directory
npm install
```

This installs all React, Vite, and frontend dependencies.

## Step 4: Install Backend Dependencies

```bash
# Navigate to server directory
cd server
npm install
```

This installs Express.js, TypeScript, and all Node.js backend dependencies.

## Step 5: Set Up Python Environment

The backend uses Python scripts for PDF processing, visual search, and OCR. You need to install Python dependencies.

### Option A: Using Python Virtual Environment (Recommended)

```bash
# Still in the server directory
python3 -m venv venv

# Activate the virtual environment
# On macOS/Linux:
source venv/bin/activate

# On Windows:
# venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
```

### Option B: Using System Python (if you prefer)

```bash
# Install directly to system Python (not recommended, but simpler)
pip3 install -r requirements.txt
```

**Note:** If you encounter issues installing OpenCV or PyTorch, you may need:
- On macOS: `brew install opencv` or use conda
- On Linux: `sudo apt-get install python3-opencv` (or equivalent)
- Consider using conda/miniconda for easier dependency management

## Step 6: Verify Python Scripts Are Accessible

The backend needs to execute Python scripts. Verify they're executable:

```bash
# Check if scripts exist
ls -la server/src/scripts/

# Make sure they're executable (if needed)
chmod +x server/src/scripts/*.py
```

## Step 7: Start the Development Servers

You'll need **two terminal windows** running simultaneously:

### Terminal 1: Backend Server

```bash
cd server
npm run dev
```

You should see:
```
Server running on port 4000
Connected to Supabase
```

### Terminal 2: Frontend Server

```bash
# From the root directory (not server/)
npm run dev
```

You should see:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:3001/
➜  Network: use --host to expose
```

## Step 8: Access Your Local Application

1. Open your browser
2. Navigate to: `http://localhost:3001`
3. The app should load and connect to your Supabase database

## Step 9: Verify Everything Works

1. **Frontend loads**: You should see the Meridian Takeoff interface
2. **Backend connection**: Try logging in or creating a project
3. **API calls**: Check browser DevTools → Network tab to see API calls going to `localhost:4000`
4. **Backend logs**: Check Terminal 1 for API request logs

## Troubleshooting

### Port Already in Use

If port 3001 or 4000 is already in use:

**Frontend (port 3001):**
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or use the fixed script
npm run dev:fixed
```

**Backend (port 4000):**
```bash
# Kill process on port 4000
lsof -ti:4000 | xargs kill -9
```

### Python Scripts Not Found

If you get errors about Python scripts:

1. Check Python is in PATH: `which python3`
2. Verify virtual environment is activated: `which python` should show `venv/bin/python`
3. Check scripts exist: `ls server/src/scripts/`
4. Verify Python dependencies: `pip list | grep opencv`

### Supabase Connection Issues

1. Verify your `.env` files have correct Supabase URL and keys
2. Check Supabase dashboard to ensure project is active
3. Verify keys are correct (no extra spaces, correct format)

### CORS Errors

The backend should handle CORS automatically in development. If you see CORS errors:
1. Make sure backend is running on port 4000
2. Check `vite.config.ts` has the proxy configured correctly
3. Verify frontend is using `http://localhost:4000/api` in development

### Module Not Found Errors

If you see "Cannot find module" errors:

**Frontend:**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Backend:**
```bash
cd server
rm -rf node_modules package-lock.json
npm install
```

## Daily Development Workflow

### Starting Development

1. Open Terminal 1:
   ```bash
   cd server
   source venv/bin/activate  # If using venv
   npm run dev
   ```

2. Open Terminal 2:
   ```bash
   npm run dev
   ```

3. Open browser to `http://localhost:3001`

### Making Changes

- **Frontend changes**: Save file → Browser auto-refreshes
- **Backend changes**: Save file → Server auto-restarts (nodemon)
- **Python script changes**: Restart backend server

### Stopping Development

- Press `Ctrl+C` in both terminals
- Deactivate Python venv: `deactivate` (if using venv)

## Deploying Changes to Production

When you're ready to deploy:

```bash
# 1. Test everything locally first
# 2. Commit your changes
git add .
git commit -m "Your commit message"

# 3. Push to GitHub
git push

# 4. Vercel and Railway will auto-deploy
#    (check their dashboards for deployment status)
```

## Tips

1. **Keep both terminals visible**: Use a terminal split or tabs
2. **Watch the logs**: Backend logs show API requests and errors
3. **Use browser DevTools**: Check Console and Network tabs
4. **Hot reload**: Frontend changes appear instantly, backend restarts automatically
5. **Database**: You're using production Supabase, so be careful with test data

## Next Steps

- Consider creating a separate Supabase project for development
- Set up VS Code debugger for better debugging
- Configure ESLint/Prettier for consistent code formatting

## Need Help?

- Check backend logs in Terminal 1
- Check browser console for frontend errors
- Verify environment variables are set correctly
- Ensure all dependencies are installed
