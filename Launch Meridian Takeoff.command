#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the project directory
cd "$SCRIPT_DIR"

echo "🚀 Launching Meridian Takeoff..."
echo "📁 Project directory: $SCRIPT_DIR"

# Kill any existing process on port 3001 (user preference)
echo "🔄 Checking for existing processes on port 3001..."
if lsof -ti:3001 > /dev/null 2>&1; then
    echo "⚠️  Found existing process on port 3001, killing it..."
    lsof -ti:3001 | xargs kill -9
    sleep 2
fi

# Function to start backend server
start_backend() {
    echo "🔧 Starting backend server..."
    cd server
    npm run dev &
    BACKEND_PID=$!
    cd ..
}

# Function to start frontend server
start_frontend() {
    echo "🎨 Starting frontend server..."
    npm run dev -- --port 3001 &
    FRONTEND_PID=$!
}

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
    fi
    # Kill any remaining processes on port 3001
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers for cleanup
trap cleanup SIGINT SIGTERM

# Start both servers
start_backend
sleep 3  # Give backend time to start
start_frontend

echo ""
echo "✅ Meridian Takeoff is starting up!"
echo "🌐 Frontend will be available at: http://localhost:3001"
echo "🔧 Backend server is running in the background"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for user to stop the servers
wait

