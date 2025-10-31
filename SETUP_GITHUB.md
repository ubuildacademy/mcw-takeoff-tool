# 🔧 Setting Up GitHub Remote for Vercel Auto-Deployment

## Current Status
- ✅ Git repository is initialized
- ✅ Vercel project is created
- ❌ No GitHub remote configured

## Option 1: Connect to Existing GitHub Repository

If you already have a GitHub repository created:

```bash
# Add the remote (replace with your actual GitHub repo URL)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Or if using SSH:
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git

# Verify it's added
git remote -v

# Push your code
git push -u origin main
```

## Option 2: Create New GitHub Repository First

1. **Go to GitHub**: https://github.com/new
2. **Create a new repository**:
   - Repository name: `mcw-takeoff-tool` (or your preferred name)
   - Make it **Public** or **Private** (Vercel supports both)
   - **Don't** initialize with README, .gitignore, or license (we already have files)
3. **After creating**, copy the repository URL
4. **Run these commands**:

```bash
# Add the remote (use the URL from GitHub)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Stage all changes
git add .

# Commit changes (if not already committed)
git commit -m "Fix TypeScript errors for production build"

# Push to GitHub
git push -u origin main
```

## Option 3: Use GitHub CLI (if installed)

```bash
# Create repo and push in one command
gh repo create mcw-takeoff-tool --public --source=. --remote=origin --push
```

## After Pushing to GitHub

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard
2. **Select your project**
3. **Go to Settings → Git**
4. **Click "Connect Git Repository"**
5. **Select GitHub** and authorize if needed
6. **Choose your repository** from the list
7. **Configure**:
   - Framework Preset: **Vite**
   - Root Directory: **./** (leave as is)
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
8. **Click Deploy**

Vercel will automatically deploy and set up auto-deployment for future pushes.

## Troubleshooting

### "Repository not found"
- Make sure the repository URL is correct
- Check that you have access to the repository
- Verify your GitHub credentials are set up

### "Permission denied"
- For HTTPS: You may need to use a Personal Access Token instead of password
- For SSH: Make sure your SSH key is added to GitHub
- See: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token

### "Branch main does not exist"
- Check your current branch: `git branch`
- If you're on a different branch, either:
  - Rename it: `git branch -M main`
  - Or push that branch: `git push -u origin YOUR_BRANCH_NAME`

## Quick Command Reference

```bash
# Check current branch
git branch

# Check remote status
git remote -v

# Add remote
git remote add origin YOUR_REPO_URL

# Update remote URL if wrong
git remote set-url origin YOUR_REPO_URL

# Push to GitHub
git push -u origin main

# Verify everything is set up
git status
```

