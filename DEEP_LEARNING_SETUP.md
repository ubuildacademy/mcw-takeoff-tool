# Deep Learning Setup Guide

## Overview

The CV Takeoff system now **requires** deep learning for wall and room detection. PyTorch and segmentation-models-pytorch are mandatory dependencies.

---

## Installation

### 1. Install Python Dependencies

```bash
cd server
pip install -r requirements.txt
```

This will install:
- `torch>=2.0.0` - PyTorch deep learning framework
- `torchvision>=0.15.0` - PyTorch vision models
- `segmentation-models-pytorch>=0.3.3` - Pre-trained segmentation models

### 2. Verify Installation

```bash
python3 -c "import torch; import segmentation_models_pytorch as smp; print('PyTorch:', torch.__version__); print('SMP:', smp.__version__)"
```

Expected output:
```
PyTorch: 2.x.x
SMP: 0.3.x
```

### 3. Test GPU Availability (Optional)

```bash
python3 -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('Device:', torch.device('cuda' if torch.cuda.is_available() else 'cpu'))"
```

**Note:** GPU is optional - CPU works fine but is slower.

---

## Models Used

### Current Model: U-Net with EfficientNet-B0 Encoder

**Model Details:**
- **Architecture:** U-Net (semantic segmentation)
- **Encoder:** EfficientNet-B0 (pre-trained on ImageNet)
- **Classes:** 3 classes (background, walls, rooms)
- **Activation:** Softmax (multi-class segmentation)
- **Input Size:** 512x512 pixels (configurable)

**Why This Model:**
- U-Net is excellent for architectural segmentation
- EfficientNet-B0 provides good speed/accuracy balance
- Pre-trained on ImageNet (general features)
- Works well for floor plan segmentation

### Model Loading

The model is automatically loaded on first use:
1. Downloads pre-trained weights from PyTorch Hub (if needed)
2. Loads EfficientNet-B0 encoder weights (ImageNet)
3. Initializes U-Net decoder
4. Moves to GPU if available, otherwise CPU

**First Load Time:** ~5-10 seconds (downloads weights)
**Subsequent Loads:** Instant (cached)

---

## Alternative Models

You can modify the model in `boundaryDetectionService.ts`:

### Option 1: Different Encoder

```python
# Current
ENCODER = 'efficientnet-b0'

# Alternatives:
ENCODER = 'resnet34'      # Faster, less accurate
ENCODER = 'resnet50'       # Balanced
ENCODER = 'efficientnet-b3'  # Slower, more accurate
ENCODER = 'efficientnet-b7'  # Slowest, most accurate
```

### Option 2: Different Architecture

```python
# U-Net (current)
self.model = smp.Unet(...)

# Alternatives:
self.model = smp.FPN(...)           # Feature Pyramid Network
self.model = smp.Linknet(...)       # LinkNet
self.model = smp.PSPNet(...)        # Pyramid Scene Parsing
self.model = smp.DeepLabV3Plus(...) # DeepLabV3+
```

### Option 3: Fine-tuned Models

For better accuracy, you can:
1. Fine-tune on floor plan dataset
2. Use floor-plan-specific models (if available)
3. Train custom model on labeled floor plans

---

## Configuration

### Model Input Size

In `CONFIG` dictionary:
```python
'dl_model_input_size': 512  # 512x512 pixels
```

**Options:**
- `256` - Fastest, less detail
- `512` - Balanced (recommended)
- `768` - Slower, more detail
- `1024` - Slowest, most detail

### Confidence Threshold

```python
'dl_confidence_threshold': 0.5  # 0-1, higher = more conservative
```

**Options:**
- `0.3` - More detections (may include false positives)
- `0.5` - Balanced (recommended)
- `0.7` - Fewer detections (more conservative)

---

## Deployment

### Railway Deployment

The `requirements.txt` is automatically installed by Railway's Python provider. No additional configuration needed.

**Build Time:** May take longer due to PyTorch installation (~5-10 minutes)

### Local Development

1. Install dependencies (see above)
2. Run server: `npm run dev`
3. Test CV takeoff on a floor plan PDF

---

## Troubleshooting

### Error: "PyTorch not installed"

**Solution:**
```bash
pip install torch torchvision segmentation-models-pytorch
```

### Error: "Model loading failed"

**Possible Causes:**
1. Network issue (can't download weights)
2. Insufficient memory
3. Corrupted cache

**Solution:**
```bash
# Clear PyTorch cache
rm -rf ~/.cache/torch
# Retry
```

### Error: "CUDA out of memory"

**Solution:**
- Reduce `dl_model_input_size` (e.g., 256 instead of 512)
- Use CPU instead of GPU
- Process smaller images

### Slow Performance

**Solutions:**
1. Use GPU if available
2. Reduce `dl_model_input_size`
3. Use faster encoder (e.g., `resnet34` instead of `efficientnet-b0`)

---

## Model Performance

### Speed (CPU, 512x512 input)
- **Inference:** ~2-5 seconds per image
- **Model Load:** ~5-10 seconds (first time only)

### Speed (GPU, 512x512 input)
- **Inference:** ~0.1-0.5 seconds per image
- **Model Load:** ~2-5 seconds (first time only)

### Memory Usage
- **Model Size:** ~50-100 MB
- **Inference Memory:** ~500 MB - 1 GB (CPU), ~1-2 GB (GPU)

---

## Next Steps

### For Better Accuracy:

1. **Fine-tune Model:**
   - Collect labeled floor plan dataset
   - Fine-tune U-Net on floor plans
   - Save fine-tuned weights
   - Load custom weights instead of ImageNet

2. **Use Floor-Plan-Specific Models:**
   - Search HuggingFace for floor plan models
   - Use models trained on architectural drawings

3. **Post-Processing:**
   - Current: CV refinement (Phase 4)
   - Future: Additional DL-based refinement

### For Production:

1. **Optimize Model:**
   - Quantize model (reduce size/speed)
   - Use TensorRT (NVIDIA GPU)
   - Use ONNX Runtime (cross-platform)

2. **Caching:**
   - Cache model in memory
   - Batch processing for multiple images

---

## Summary

✅ **Deep learning is now required** - no fallback to CV
✅ **U-Net with EfficientNet-B0** - good balance of speed/accuracy
✅ **Pre-trained on ImageNet** - works out of the box
✅ **Configurable** - can adjust input size, confidence, encoder
✅ **GPU optional** - works on CPU (slower)

**Installation:** `pip install -r requirements.txt`
**Verification:** Check PyTorch and SMP import successfully
**Deployment:** Automatic via Railway (requirements.txt)

