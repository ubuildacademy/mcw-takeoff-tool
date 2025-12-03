# Training Floor Plan Segmentation Model - Complete Guide

## Overview

This guide explains how to train a floor plan segmentation model using your current setup. The model will learn to identify walls and rooms in architectural floor plans.

---

## Prerequisites

✅ **Already Installed:**
- PyTorch
- segmentation-models-pytorch
- albumentations
- OpenCV

✅ **Already Configured:**
- Training script: `server/models/train_floor_plan_model_complete.py`
- Model architecture: U-Net with ResNet34 encoder
- Classes: background, walls, rooms

---

## Step 1: Get a Floor Plan Dataset

### Option A: Use Public Datasets

**1. CubiCasa5k (Recommended)**
- **Size:** 5,000 floor plans
- **Format:** Images + segmentation masks
- **Access:** Research use (may require request)
- **Website:** Check CubiCasa dataset papers/repositories

**2. MLSTRUCT-FP**
- **Size:** 954+ floor plans
- **Format:** Images + JSON annotations (walls)
- **GitHub:** https://github.com/MLSTRUCT/MLSTRUCT-FP
- **Note:** May need to convert JSON to masks

**3. ResPlan**
- **Size:** 17,000 residential floor plans
- **Format:** Comprehensive annotations
- **Paper:** https://arxiv.org/abs/2508.14006

### Option B: Create Your Own Dataset

**What You Need:**
- Floor plan images (PNG/JPG)
- Segmentation masks (PNG) where:
  - **Black (0)** = Background
  - **Gray (128)** = Walls
  - **White (255)** = Rooms

**How to Create Masks:**
1. Use image editing software (Photoshop, GIMP)
2. Or use annotation tools (LabelMe, CVAT)
3. Or use our CV takeoff results as starting point

---

## Step 2: Organize Your Dataset

Create this directory structure:

```
server/data/floor_plans/
├── train_images/      # Training floor plan images
│   ├── plan_001.png
│   ├── plan_002.png
│   └── ...
├── train_masks/       # Training masks (same names as images)
│   ├── plan_001.png   # Mask for plan_001.png
│   ├── plan_002.png
│   └── ...
├── val_images/        # Validation images (10-20% of dataset)
│   ├── plan_101.png
│   └── ...
└── val_masks/         # Validation masks
    ├── plan_101.png
    └── ...
```

### Mask Format Requirements

**Mask Image Format:**
- **Grayscale PNG** (single channel)
- **Pixel Values:**
  - `0` = Background
  - `128` = Walls
  - `255` = Rooms
- **OR:**
  - `0` = Background
  - `1` = Walls
  - `2` = Rooms

**Important:** Masks must have the same filename as their corresponding images!

### Example Dataset Size

- **Minimum:** 50-100 images (for quick testing)
- **Recommended:** 500+ images (for good accuracy)
- **Ideal:** 1000+ images (for production quality)

---

## Step 3: Prepare Dataset (If Needed)

### Convert MLSTRUCT-FP JSON to Masks

If using MLSTRUCT-FP, you'll need to convert JSON wall annotations to masks:

```python
# Example conversion script (create if needed)
import json
import cv2
import numpy as np
from pathlib import Path

def json_to_mask(json_path, image_shape):
    """Convert MLSTRUCT-FP JSON to segmentation mask"""
    with open(json_path) as f:
        data = json.load(f)
    
    mask = np.zeros(image_shape, dtype=np.uint8)
    
    # Draw walls (class 1)
    for wall in data.get('walls', []):
        # Draw wall lines
        # ... implementation ...
        pass
    
    # Rooms are everything else (class 2)
    # You may need room annotations or infer from walls
    
    return mask
```

### Convert Your Own Floor Plans

If you have floor plans but no masks:

1. **Use Current CV System:**
   - Run CV takeoff on your floor plans
   - Export detected walls/rooms
   - Convert to mask format

2. **Manual Annotation:**
   - Use LabelMe: https://github.com/wkentaro/labelme
   - Or CVAT: https://cvat.org/
   - Export as segmentation masks

---

## Step 4: Run Training

### Quick Start

```bash
cd server
python3 models/train_floor_plan_model_complete.py
```

### What Happens During Training

1. **Data Loading:**
   - Loads images and masks from `data/floor_plans/`
   - Applies data augmentation (flips, brightness, etc.)
   - Resizes to 512x512

2. **Model Training:**
   - Starts with ImageNet pre-trained ResNet34 encoder
   - Trains for 50 epochs (configurable)
   - Uses CrossEntropyLoss
   - Adam optimizer with learning rate 0.0001

3. **Validation:**
   - Evaluates on validation set each epoch
   - Saves best model based on validation loss

4. **Model Saving:**
   - Saves to: `server/models/floor_plan_model_trained.pth`
   - **Automatically updates CONFIG when done!**

### Training Output

You'll see:
```
Floor Plan Model Training
==================================================
✓ Found dataset at: .../data/floor_plans
  Training images: 400
  Validation images: 100

Epoch 1/50: Train Loss: 0.8234, Val Loss: 0.7891
  ✓ Saved best model to .../floor_plan_model_trained.pth
Epoch 2/50: Train Loss: 0.7123, Val Loss: 0.6543
  ✓ Saved best model to .../floor_plan_model_trained.pth
...
```

### Training Time

- **CPU:** ~2-5 hours for 50 epochs (500 images)
- **GPU:** ~30-60 minutes for 50 epochs (500 images)
- **Small dataset (50 images):** ~30 minutes on CPU

---

## Step 5: Automatic Configuration

After training completes:

1. **Model Saved:**
   - `server/models/floor_plan_model_trained.pth`

2. **CONFIG Updated Automatically:**
   - `dl_model_path` set to trained model
   - `dl_use_huggingface` set to `False`
   - System ready to use!

3. **Test:**
   - Run CV takeoff on a floor plan
   - Should see much better accuracy!

---

## Step 6: Fine-Tuning (Optional)

### Fine-Tune HuggingFace Model Instead

If you want to fine-tune the HuggingFace Segformer:

1. **Keep HuggingFace enabled:**
   ```python
   'dl_use_huggingface': True,
   ```

2. **Create fine-tuning script:**
   - Load Segformer model
   - Train on your floor plan dataset
   - Save fine-tuned weights

3. **Or use transfer learning:**
   - Start with Segformer
   - Fine-tune last few layers on floor plans
   - Better than training from scratch

---

## Training Configuration

### Adjust Training Parameters

Edit `train_floor_plan_model_complete.py`:

```python
# Configuration
ENCODER = 'resnet34'        # Try: 'resnet50', 'efficientnet-b0'
CLASSES = 3                 # background, walls, rooms
BATCH_SIZE = 4             # Increase if you have GPU memory
LEARNING_RATE = 0.0001     # Lower = slower, more stable
EPOCHS = 50                # More epochs = better (but slower)
```

### Data Augmentation

Already configured:
- Horizontal flips
- Random brightness/contrast
- Normalization (ImageNet stats)

You can add more in the training script:
- Rotations
- Scaling
- Color jitter
- etc.

---

## Monitoring Training

### Check Training Progress

The script prints:
- Training loss per epoch
- Validation loss per epoch
- Best model saves

### Visualize Results (Optional)

Add visualization code to see:
- Input images
- Ground truth masks
- Predicted masks
- Compare before/after

---

## Troubleshooting

### "Dataset not found"

**Problem:** Training script can't find dataset

**Solution:**
1. Check directory structure matches exactly
2. Verify paths in script:
   ```python
   train_images = "data/floor_plans/train_images"
   ```
3. Use absolute paths if needed

### "Out of memory"

**Problem:** GPU/CPU runs out of memory

**Solutions:**
1. Reduce `BATCH_SIZE` (try 2 or 1)
2. Reduce image size (change 512 to 256)
3. Use CPU (slower but more memory)

### "Poor accuracy"

**Problem:** Model doesn't learn well

**Solutions:**
1. **More data:** Get more training images
2. **Better masks:** Ensure masks are accurate
3. **More epochs:** Train longer (100+ epochs)
4. **Different encoder:** Try ResNet50 or EfficientNet
5. **Learning rate:** Try 0.0005 or 0.00005

### "Mask format error"

**Problem:** Masks don't match expected format

**Solution:**
- Masks must be grayscale
- Values: 0 (background), 128 (walls), 255 (rooms)
- OR: 0, 1, 2 (script handles both)

---

## Quick Training Workflow

### Minimal Setup (Testing)

1. **Get 10-20 floor plan images**
2. **Create masks manually** (or use current CV results)
3. **Organize in `data/floor_plans/`**
4. **Run training:**
   ```bash
   python3 models/train_floor_plan_model_complete.py
   ```
5. **Test on new floor plan**

### Production Setup

1. **Get 500+ floor plan images**
2. **Create accurate masks** (use annotation tools)
3. **Split: 80% train, 20% validation**
4. **Train for 100+ epochs**
5. **Evaluate on test set**
6. **Deploy trained model**

---

## Integration with Current System

### How It Works

1. **Training:** Creates `floor_plan_model_trained.pth`
2. **Auto-Config:** Updates `dl_model_path` in CONFIG automatically
3. **Loading:** System loads trained model automatically
4. **Inference:** Uses trained model for segmentation
5. **Refinement:** CV pipeline refines DL results

### No Code Changes Needed!

The training script automatically:
- Saves model in correct format
- Updates CONFIG
- System picks it up on next run

---

## Example: Training on Your Own Floor Plans

### Step-by-Step

1. **Collect Floor Plans:**
   ```bash
   # Put your floor plan PDFs/images in a folder
   mkdir -p server/data/floor_plans/raw
   # Copy your floor plan images here
   ```

2. **Create Masks:**
   - Option A: Use current CV system to generate initial masks
   - Option B: Manually annotate in LabelMe
   - Option C: Use your existing takeoff results

3. **Organize:**
   ```bash
   server/data/floor_plans/
   ├── train_images/  # 80% of your images
   ├── train_masks/   # Corresponding masks
   ├── val_images/    # 20% of your images
   └── val_masks/     # Corresponding masks
   ```

4. **Train:**
   ```bash
   cd server
   python3 models/train_floor_plan_model_complete.py
   ```

5. **Wait:** Training takes 30 minutes to several hours

6. **Done!** Model is automatically configured

---

## Next Steps After Training

1. **Test:** Run CV takeoff on new floor plans
2. **Evaluate:** Check accuracy vs. before
3. **Iterate:** If not good enough:
   - Add more training data
   - Train longer
   - Try different architecture
4. **Deploy:** Push to production

---

## Summary

**To Train:**
1. Get dataset (images + masks)
2. Organize in `server/data/floor_plans/`
3. Run: `python3 models/train_floor_plan_model_complete.py`
4. Wait for training to complete
5. Model automatically configured!

**That's it!** The system handles everything else automatically.
