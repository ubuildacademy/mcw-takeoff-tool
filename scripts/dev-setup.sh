#!/bin/bash

# Development Environment Setup Script
# This script helps set up your local development environment

set -e

echo "🚀 Meridian Takeoff - Development Setup"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/${NC}"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✅ Node.js: $NODE_VERSION${NC}"

# Check Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}❌ Python is not installed. Please install Python 3.8+ from https://www.python.org/${NC}"
    exit 1
fi
PYTHON_CMD=$(command -v python3 || command -v python)
PYTHON_VERSION=$($PYTHON_CMD --version)
echo -e "${GREEN}✅ Python: $PYTHON_VERSION${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}⚠️  Git is not installed (optional but recommended)${NC}"
else
    echo -e "${GREEN}✅ Git: $(git --version)${NC}"
fi

echo ""
echo "📦 Installing dependencies..."

# Install frontend dependencies
echo "Installing frontend dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✅ Frontend dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Frontend dependencies already installed (skipping)${NC}"
fi

# Install backend dependencies
echo "Installing backend dependencies..."
cd server
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✅ Backend dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Backend dependencies already installed (skipping)${NC}"
fi

# Set up Python virtual environment
echo ""
echo "🐍 Setting up Python environment..."

if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    $PYTHON_CMD -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
else
    echo -e "${YELLOW}⚠️  Virtual environment already exists${NC}"
fi

# Activate virtual environment and install Python dependencies
echo "Installing Python dependencies..."
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    source venv/Scripts/activate
else
    # macOS/Linux
    source venv/bin/activate
fi

pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✅ Python dependencies installed${NC}"

cd ..

# Check for .env files
echo ""
echo "🔐 Checking environment variables..."

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  Frontend .env file not found${NC}"
    echo "Creating .env from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}⚠️  Please edit .env and add your Supabase credentials${NC}"
    else
        echo -e "${RED}❌ .env.example not found${NC}"
    fi
else
    echo -e "${GREEN}✅ Frontend .env file exists${NC}"
fi

if [ ! -f "server/.env" ]; then
    echo -e "${YELLOW}⚠️  Backend .env file not found${NC}"
    echo "Creating server/.env from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example server/.env
        echo -e "${YELLOW}⚠️  Please edit server/.env and add your Supabase credentials${NC}"
    else
        echo -e "${RED}❌ .env.example not found${NC}"
    fi
else
    echo -e "${GREEN}✅ Backend .env file exists${NC}"
fi

echo ""
echo "========================================"
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env and server/.env files with your Supabase credentials"
echo "2. Start the backend: cd server && npm run dev"
echo "3. Start the frontend: npm run dev"
echo "4. Open http://localhost:3001 in your browser"
echo ""
echo "For detailed instructions, see DEVELOPMENT_SETUP.md"
