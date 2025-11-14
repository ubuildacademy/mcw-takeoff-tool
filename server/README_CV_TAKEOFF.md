# CV Takeoff Feature - Setup Instructions

## Overview

The CV Takeoff feature uses computer vision to automatically detect architectural elements (rooms, walls, doors, windows) by analyzing their boundaries in construction drawings.

## Requirements

### Python 3
- Python 3.7 or higher must be installed on the server
- Verify installation: `python3 --version`

### OpenCV (cv2)
- OpenCV Python library must be installed
- Install with: `pip3 install opencv-python`
- Verify installation: `python3 -c "import cv2; print(cv2.__version__)"`

### NumPy
- NumPy is required by OpenCV
- Usually installed automatically with OpenCV
- Install with: `pip3 install numpy`

## Installation

### Railway Deployment (Automatic)

If you're deploying to Railway, Python and OpenCV will be automatically installed during the build process. Railway's NIXPACKS builder will detect the `requirements.txt` file in the `server` directory and install the Python dependencies automatically.

**No additional configuration needed** - just deploy and Railway will handle Python/OpenCV installation.

### Local Development Setup

**Quick Setup:**
```bash
# Install Python dependencies (if not already installed)
pip3 install opencv-python numpy

# Verify installation
npm run test-cv
# OR
node scripts/test-cv-detection.js
```

**Manual Installation** (if needed):
1. **Install Python 3** (if not already installed):
   ```bash
   # macOS (using Homebrew)
   brew install python3
   
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install python3 python3-pip
   
   # Windows
   # Download from https://www.python.org/downloads/
   ```

2. **Install OpenCV and NumPy**:
   ```bash
   pip3 install opencv-python numpy
   ```

3. **Verify Installation**:
   ```bash
   npm run test-cv
   ```

## How It Works

1. **PDF to Image Conversion**: PDF pages are converted to high-resolution PNG images
2. **Boundary Detection**: Python script uses OpenCV to:
   - Detect edges using Canny edge detection
   - Find contours (closed polygons) for rooms
   - Detect lines for walls using Hough Line Transform
   - Identify rectangular openings for doors/windows
3. **Measurement Creation**: Detected boundaries are converted to measurements and stored in the database
4. **Display**: Measurements automatically appear in the PDF viewer

## API Endpoints

- `GET /api/cv-takeoff/status` - Check if CV service is available
- `POST /api/cv-takeoff/process-page` - Process a single page
- `POST /api/cv-takeoff/process-pages` - Process multiple pages

## Troubleshooting

### Service Not Available
- Check Python 3 installation: `python3 --version`
- Check OpenCV installation: `python3 -c "import cv2"`
- Ensure Python is in PATH
- Check server logs for detailed error messages

### Detection Issues
- Ensure pages are calibrated (scale factor is set)
- Check that images are high enough resolution
- Verify PDF pages contain clear architectural drawings
- Adjust detection options (min room area, min wall length)

### Performance
- Processing time depends on image size and complexity
- Typical processing: 2-5 seconds per page
- Large images may take longer

## Notes

- The Python script is automatically created on first use
- Script location: `server/src/scripts/cv_boundary_detection.py`
- Temporary images are stored in: `server/temp/cv-detection/`
- Script uses OpenCV's built-in algorithms (no external ML models required)

