/**
 * Test script to verify CV detection is working
 * Run with: node scripts/test-cv-detection.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing CV Detection Setup...\n');

try {
  // 1. Check Python
  console.log('1. Checking Python 3...');
  const pythonVersion = execSync('python3 --version', { encoding: 'utf-8', timeout: 5000 }).trim();
  console.log(`   ✅ ${pythonVersion}\n`);

  // 2. Check OpenCV
  console.log('2. Checking OpenCV...');
  const opencvVersion = execSync('python3 -c "import cv2; print(cv2.__version__)"', { encoding: 'utf-8', timeout: 5000 }).trim();
  console.log(`   ✅ OpenCV ${opencvVersion}\n`);

  // 3. Check NumPy
  console.log('3. Checking NumPy...');
  const numpyVersion = execSync('python3 -c "import numpy; print(numpy.__version__)"', { encoding: 'utf-8', timeout: 5000 }).trim();
  console.log(`   ✅ NumPy ${numpyVersion}\n`);

  // 4. Test basic OpenCV operations
  console.log('4. Testing OpenCV operations...');
  execSync(`python3 -c "
import cv2
import numpy as np

# Create test image
img = np.zeros((100, 100, 3), dtype=np.uint8)
img.fill(255)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
blurred = cv2.GaussianBlur(gray, (5, 5), 0)
edges = cv2.Canny(blurred, 50, 150)
contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
print('   ✅ Edge detection working')
print('   ✅ Contour detection working')
"`, { encoding: 'utf-8', timeout: 10000 });
  console.log('   ✅ All OpenCV operations working\n');

  // 5. Test script directory
  console.log('5. Checking script directory...');
  const scriptsDir = path.join(__dirname, '../src/scripts');
  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
    console.log('   ✅ Created scripts directory\n');
  } else {
    console.log('   ✅ Scripts directory exists\n');
  }

  // 6. Test temp directory
  console.log('6. Checking temp directory...');
  const tempDir = path.join(__dirname, '../temp/cv-detection');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('   ✅ Created temp directory\n');
  } else {
    console.log('   ✅ Temp directory exists\n');
  }

  console.log('🎉 All tests passed! CV detection is ready to use.\n');
  console.log('Next steps:');
  console.log('  1. Start your server: npm run dev');
  console.log('  2. Open the app and navigate to a page');
  console.log('  3. Click "CV Takeoff" button');
  console.log('  4. Select items to detect and start detection\n');

} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error('\nPlease ensure:');
  console.error('  - Python 3 is installed: python3 --version');
  console.error('  - OpenCV is installed: pip3 install opencv-python');
  console.error('  - NumPy is installed: pip3 install numpy');
  process.exit(1);
}

