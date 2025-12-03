# Ozturkoktay Floor Plan Model Setup Guide

## Overview

This guide helps you set up and use the ozturkoktay floor plan segmentation model, which is specifically trained on floor plans.

**Repository:** https://github.com/ozturkoktay/floor-plan-room-segmentation

---

## Quick Start

### Step 1: Run Setup Script

```bash
cd server
python3 scripts/setup_ozturkoktay_model.py
```

This script will:
- Clone the ozturkoktay repository
- Check for pre-trained weights
- Set up the model directory structure
- Provide next steps

### Step 2: Get Model Weights

**Option A: Use Pre-trained Weights (if available)**
- The setup script will search for weights in the repository
- If found, copy to `server/models/ozturkoktay_model.pth`

**Option B: Train the Model**
- Follow training instructions in the repository
- Or use our training script (see below)

### Step 3: Configure

Update `CONFIG` in `server/src/services/boundaryDetectionService.ts`:

```python
CONFIG = {
    # ... other config ...
    'dl_model_path': '/path/to/server/models/ozturkoktay_model.pth',
    'dl_use_huggingface': False,
}
```

### Step 4: Test

Run CV takeoff on a floor plan PDF. The model will load automatically.

---

## Model Architecture

The ozturkoktay model uses:
- **Architecture:** U-Net
- **Encoder:** ResNet (typically ResNet34)
- **Classes:** 3 (background, walls, rooms)
- **Framework:** segmentation-models-pytorch

This is compatible with our system!

---

## Training the Model

### Using Their Repository

1. **Clone and Setup:**
   ```bash
   git clone https://github.com/ozturkoktay/floor-plan-room-segmentation.git
   cd floor-plan-room-segmentation
   pip install -r requirements.txt
   ```

2. **Prepare Dataset:**
   - Organize dataset as specified in their README
   - Format: images and corresponding masks
   - Classes: background, walls, rooms

3. **Train:**
   - Use their Jupyter notebook (`seg_sem.ipynb`)
   - Or adapt their training script
   - Save weights as `.pth` file

4. **Use in Our System:**
   - Copy weights to `server/models/ozturkoktay_model.pth`
   - Configure `dl_model_path` as above

### Using Our Training Script (Recommended)

We can create a training script that:
- Works directly with our system
- Uses common floor plan datasets
- Saves weights in the correct format
- Integrates with our pipeline

**To create this script, let me know and I'll build it!**

---

## Dataset Options

### MLSTRUCT-FP
- **Size:** 954+ floor plan images
- **Annotations:** Walls in JSON format
- **GitHub:** https://github.com/MLSTRUCT/MLSTRUCT-FP
- **Usage:** Convert to segmentation masks for training

### ResPlan
- **Size:** 17,000 residential floor plans
- **Annotations:** Comprehensive room/wall annotations
- **Paper:** https://arxiv.org/abs/2508.14006
- **Usage:** Large dataset, good for training

### CubiCasa5k
- **Size:** 5,000 floor plans
- **Annotations:** Room and wall segmentation masks
- **Usage:** Research use, may require permission

---

## Model Loading

The system automatically:
1. Checks for `dl_model_path` in CONFIG
2. Loads the model if path exists
3. Falls back to ImageNet pre-trained if not found

**Logs to check:**
```
Loading custom floor plan model from: /path/to/model.pth
Custom floor plan model loaded successfully
```

---

## Troubleshooting

### Model Not Found

**Error:** "Failed to load deep learning model"

**Solutions:**
1. Verify path is correct and absolute
2. Check file exists: `ls -lh server/models/ozturkoktay_model.pth`
3. Verify file is a valid PyTorch model

### Architecture Mismatch

**Error:** "size mismatch" or "unexpected key"

**Solutions:**
1. Model must be U-Net architecture
2. Encoder should be ResNet34 (or compatible)
3. Number of classes must be 3
4. Check model was saved correctly

### Training Issues

**Problem:** Can't train the model

**Solutions:**
1. Check dataset format matches repository requirements
2. Verify all dependencies installed
3. Check GPU availability (optional, CPU works)
4. Start with small dataset for testing

---

## Integration with Our System

The ozturkoktay model integrates seamlessly:

1. **Model Loading:** Automatic via `dl_model_path`
2. **Segmentation:** Returns wall/room masks
3. **Post-processing:** Our CV pipeline refines results
4. **Graph Building:** Uses our existing wall graph code
5. **Room Extraction:** Uses our room validation

**No changes needed to the rest of the pipeline!**

---

## Performance Expectations

With a properly trained ozturkoktay model:
- **Accuracy:** Much better than ImageNet pre-trained
- **Walls:** Should detect actual walls, not dimension strings
- **Rooms:** Should segment actual rooms, not white space
- **Speed:** Similar to current model (~2-5 seconds on CPU)

---

## Next Steps

1. **Run setup script:** `python3 scripts/setup_ozturkoktay_model.py`
2. **Check for weights:** Script will tell you if found
3. **Train if needed:** Follow repository instructions or ask for our training script
4. **Configure and test:** Set `dl_model_path` and test

---

## Resources

- **Repository:** https://github.com/ozturkoktay/floor-plan-room-segmentation
- **Setup Script:** `server/scripts/setup_ozturkoktay_model.py`
- **Model Info:** `server/models/ozturkoktay_model_info.txt` (created by setup script)
- **General Setup:** See `FLOOR_PLAN_MODEL_SETUP.md`

---

## Questions?

If you need help:
1. Check the ozturkoktay repository README
2. Review our setup script output
3. Check model info file for details
4. Ask for a custom training script if needed

