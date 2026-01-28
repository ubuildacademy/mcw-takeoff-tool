#!/bin/bash

# Start Development Servers Script
# This script starts both backend and frontend servers for local development

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Meridian Takeoff Development Environment${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "server" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if Python venv exists
if [ ! -d "server/venv" ]; then
    echo -e "${YELLOW}⚠️  Python virtual environment not found. Creating it...${NC}"
    cd server
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip -q
    pip install -r requirements.txt -q
    cd ..
    echo -e "${GREEN}✅ Python environment created${NC}"
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Stopping servers...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit
}

trap cleanup SIGINT SIGTERM

# Start backend server
echo -e "${BLUE}📦 Starting backend server (port 4000)...${NC}"
cd server
source venv/bin/activate
npm run dev > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 2

# Start frontend server
echo -e "${BLUE}🌐 Starting frontend server (port 3001)...${NC}"
npm run dev > frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}✅ Development servers started!${NC}"
echo ""
echo "📋 Server Information:"
echo "   Backend:  http://localhost:4000"
echo "   Frontend: http://localhost:3001"
echo ""
echo "📝 Logs:"
echo "   Backend:  tail -f backend.log"
echo "   Frontend: tail -f frontend.log"
echo ""
echo -e "${YELLOW}💡 Press Ctrl+C to stop both servers${NC}"
echo ""

# Wait for both processes
wait
