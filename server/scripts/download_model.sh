#!/bin/bash
# Download model file if it doesn't exist
# This script runs during Railway deployment

MODEL_PATH="server/models/floor_plan_cubicasa5k_resnet50.pth"
MODEL_DIR=$(dirname "$MODEL_PATH")

# Create models directory if it doesn't exist
mkdir -p "$MODEL_DIR"

# Check if model already exists
if [ -f "$MODEL_PATH" ]; then
    echo "✓ Model file already exists: $MODEL_PATH"
    exit 0
fi

# Try to download from environment variable URL (if set)
if [ -n "$MODEL_DOWNLOAD_URL" ]; then
    echo "Downloading model from: $MODEL_DOWNLOAD_URL"
    curl -L -o "$MODEL_PATH" "$MODEL_DOWNLOAD_URL"
    if [ $? -eq 0 ]; then
        echo "✓ Model downloaded successfully"
        exit 0
    else
        echo "⚠ Failed to download model from URL"
    fi
fi

# If download fails or URL not set, model will be missing
# The system will fall back to ImageNet pre-trained model
echo "⚠ Model file not found. System will use ImageNet pre-trained model as fallback."
exit 0

