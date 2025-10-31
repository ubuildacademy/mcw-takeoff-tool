# 🔧 Vercel Auto-Deployment Troubleshooting Guide

## Common Issues & Solutions

### Issue: Auto-Deployment Not Triggering on Git Push

If pushing commits to GitHub doesn't trigger Vercel deployments, follow these steps:

## ✅ Step 1: Verify GitHub Integration

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard
2. **Check Integrations**:
   - Click on your profile → **Settings** → **Integrations**
   - Look for **GitHub** in the list
   - If missing or not connected:
     - Click **Add New Integration**
     - Select **GitHub**
     - Authorize Vercel to access your repositories
     - Grant access to the specific repository or all repositories

## ✅ Step 2: Verify Project Linking

1. **Go to Your Project** in Vercel Dashboard
2. **Click Settings** → **Git**
3. **Verify**:
   - Repository is correctly linked (should show your GitHub repo)
   - Production branch is set correctly (usually `main` or `master`)
   - Auto-deployment is enabled

4. **If project is NOT linked**:
   - Click **Connect Git Repository**
   - Select your GitHub repository
   - Choose the branch (usually `main` or `master`)
   - Configure build settings:
     - Framework Preset: **Vite**
     - Root Directory: **./** (project root)
     - Build Command: `npm run build`
     - Output Directory: `dist`
     - Install Command: `npm install`

## ✅ Step 3: Check Branch Settings

1. In Vercel Dashboard → Your Project → **Settings** → **Git**
2. Verify:
   - **Production Branch**: Should match your main branch (`main` or `master`)
   - **Branches**: Auto-deploy should be enabled for your branch
   - **Ignored Build Step**: Should be empty (unless you have specific needs)

## ✅ Step 4: Verify Webhook Setup

1. **Check GitHub Webhooks**:
   - Go to your GitHub repository
   - Click **Settings** → **Webhooks**
   - Look for a webhook with URL containing `vercel.com`
   - Verify it's active and not disabled

2. **If webhook is missing or broken**:
   - In Vercel Dashboard → Project → Settings → Git
   - Click **Disconnect** and then **Connect Git Repository** again
   - This will recreate the webhook

## ✅ Step 5: Check Build Configuration

1. **Verify `vercel.json`** is in project root
2. **Verify `package.json`** has a build script:
   ```json
   {
     "scripts": {
       "build": "tsc && vite build"
     }
   }
   ```

3. **Verify build command** in Vercel Dashboard:
   - Settings → General → Build & Development Settings
   - Build Command should be: `npm run build`
   - Output Directory should be: `dist`

## ✅ Step 6: Manual Deployment Test

Try deploying manually to verify everything works:

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (this will also test the connection)
vercel --prod
```

If manual deployment works but auto-deployment doesn't, the issue is with GitHub integration.

## ✅ Step 7: Reconnect Repository

Sometimes reconnecting fixes the issue:

1. **In Vercel Dashboard**:
   - Go to your project
   - Settings → Git → **Disconnect**
   - Then **Connect Git Repository** again
   - Select the same repository and branch

## ✅ Step 8: Check Repository Permissions

1. **Verify Repository Access**:
   - GitHub → Repository → Settings → Integrations → Applications
   - Find Vercel in authorized integrations
   - Verify it has proper permissions

2. **If using Organization**:
   - Make sure Vercel integration is installed for the organization
   - Go to GitHub Organization → Settings → Third-party access
   - Verify Vercel is authorized

## ✅ Step 9: Verify Push to Correct Branch

Make sure you're pushing to the branch that's configured in Vercel:

```bash
# Check current branch
git branch

# Check which branch Vercel is watching
# (check in Vercel Dashboard → Settings → Git)

# Push to the correct branch
git push origin main  # or master, depending on your setup
```

## ✅ Step 10: Check Deployment Logs

1. **In Vercel Dashboard**:
   - Go to **Deployments** tab
   - Check if there are any failed deployments or errors
   - Look for webhook errors or build errors

## 🔄 Quick Fix: Complete Re-setup

If nothing above works, try a complete re-setup:

1. **Disconnect from Git in Vercel**:
   - Project → Settings → Git → Disconnect

2. **Remove the project** (optional, or create new project):
   - Settings → Delete Project (or just disconnect Git)

3. **Create new project**:
   - Click **Add New Project**
   - Import your GitHub repository
   - Configure:
     - Framework: **Vite**
     - Root Directory: **./**
     - Build Command: `npm run build`
     - Output Directory: `dist`
   - Add environment variables
   - Deploy

## 🐛 Common Error Messages

### "No deployments found"
- **Solution**: Check that you're pushing to the correct branch
- Verify GitHub integration is connected

### "Webhook not receiving events"
- **Solution**: Reconnect the repository in Vercel
- Check GitHub webhook settings

### "Build failed"
- **Solution**: Check build logs in Vercel
- Verify all environment variables are set
- Ensure build command works locally: `npm run build`

## 📝 Verification Checklist

Before concluding the issue is fixed, verify:

- [ ] GitHub integration is installed and authorized
- [ ] Repository is connected in Vercel project settings
- [ ] Production branch is correctly set
- [ ] Auto-deployment is enabled for your branch
- [ ] Build command and output directory are correct
- [ ] All environment variables are set in Vercel
- [ ] Webhook exists in GitHub repository settings
- [ ] You're pushing to the correct branch
- [ ] Build works locally (`npm run build`)

## 🆘 Still Not Working?

If none of the above works:

1. **Contact Vercel Support**:
   - Vercel Dashboard → Help → Contact Support
   - Include:
     - Project name
     - Repository URL
     - Screenshots of Git settings
     - Any error messages

2. **Check Vercel Status**:
   - https://www.vercel-status.com/
   - Verify there are no service issues

3. **Try Alternative**:
   - Use manual deployment via CLI as temporary solution
   - Set up GitHub Actions to trigger Vercel deployments

## 📚 Additional Resources

- [Vercel Git Integration Docs](https://vercel.com/docs/concepts/git)
- [Vercel Troubleshooting Guide](https://vercel.com/docs/guides/troubleshooting)
- [Vite on Vercel](https://vercel.com/docs/frameworks/vite)

