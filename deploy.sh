#!/bin/bash

echo "🚀 Meridian Takeoff Deployment Script"
echo "======================================"

# Check if user is in the right directory
if [ ! -f "package.json" ] || [ ! -f "server/package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

echo "📋 Choose deployment option:"
echo "1) Deploy frontend to Vercel only (backend must be deployed separately)"
echo "2) Deploy both frontend and backend (requires Railway account)"
echo "3) Show deployment guide"
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo "🎯 Deploying frontend to Vercel..."
        
        # Check if Vercel CLI is installed
        if ! command -v vercel &> /dev/null; then
            echo "📦 Installing Vercel CLI..."
            npm install -g vercel
        fi
        
        # Login to Vercel if not already logged in
        echo "🔐 Logging into Vercel..."
        vercel login
        
        # Deploy to Vercel
        echo "🚀 Deploying to Vercel..."
        vercel --prod
        
        echo "✅ Frontend deployed to Vercel!"
        echo "📝 Don't forget to:"
        echo "   - Set environment variables in Vercel dashboard"
        echo "   - Deploy your backend to Railway or another service"
        echo "   - Update API endpoints to point to your backend"
        ;;
        
    2)
        echo "🎯 Deploying both frontend and backend..."
        
        # Deploy backend to Railway
        echo "📦 Deploying backend to Railway..."
        cd server
        
        if ! command -v railway &> /dev/null; then
            echo "📦 Installing Railway CLI..."
            npm install -g @railway/cli
        fi
        
        echo "🔐 Logging into Railway..."
        railway login
        
        echo "🚀 Deploying backend..."
        railway up
        
        echo "✅ Backend deployed to Railway!"
        echo "📝 Copy the Railway URL and update your frontend environment variables"
        
        # Go back to root and deploy frontend
        cd ..
        echo "🎯 Deploying frontend to Vercel..."
        
        if ! command -v vercel &> /dev/null; then
            echo "📦 Installing Vercel CLI..."
            npm install -g vercel
        fi
        
        echo "🔐 Logging into Vercel..."
        vercel login
        
        echo "🚀 Deploying to Vercel..."
        vercel --prod
        
        echo "✅ Both frontend and backend deployed!"
        ;;
        
    3)
        echo "📖 Opening deployment guide..."
        if command -v open &> /dev/null; then
            open DEPLOYMENT_GUIDE.md
        else
            echo "📖 Please read DEPLOYMENT_GUIDE.md for detailed instructions"
        fi
        ;;
        
    *)
        echo "❌ Invalid choice. Please run the script again and choose 1, 2, or 3."
        exit 1
        ;;
esac

echo ""
echo "🎉 Deployment process completed!"
echo "📝 Next steps:"
echo "   1. Set up environment variables in your deployment platform(s)"
echo "   2. Configure CORS settings for your backend"
echo "   3. Test your deployed application"
echo "   4. Update your domain settings if needed"
















