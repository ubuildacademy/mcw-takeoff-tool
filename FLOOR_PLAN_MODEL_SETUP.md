# Floor Plan Model Setup Guide

## Overview

The system now supports three ways to use deep learning models for floor plan segmentation:

1. **Custom Pre-trained Floor Plan Model** (Best accuracy)
2. **HuggingFace Transformers Model** (Easy to use)
3. **Default ImageNet Pre-trained** (Fallback, less accurate)

---

## Option 1: Custom Pre-trained Floor Plan Model ⭐ RECOMMENDED

### Setup Steps

1. **Find or Train a Floor Plan Model:**
   - Check: https://github.com/ozturkoktay/floor-plan-room-segmentation
   - Or train your own using MLSTRUCT-FP or ResPlan dataset

2. **Download Model Weights:**
   - Save as `.pth` or `.pt` file
   - Place in `server/models/` directory (create if needed)

3. **Configure:**
   ```python
   # In CONFIG dictionary in boundaryDetectionService.ts
   'dl_model_path': '/path/to/floor_plan_model.pth',
   ```

4. **Model Format:**
   - Should be PyTorch state dict
   - Architecture: U-Net with ResNet34 encoder (or compatible)
   - Classes: ['background', 'walls', 'rooms']
   - Can be full checkpoint dict with 'state_dict' key, or just state dict

### Example Model Sources

- **ozturkoktay/floor-plan-room-segmentation:**
  ```bash
  git clone https://github.com/ozturkoktay/floor-plan-room-segmentation.git
  # Check for pre-trained weights in the repo
  # Or train using their code
  ```

- **Train Your Own:**
  ```python
  # Use segmentation-models-pytorch
  import segmentation_models_pytorch as smp
  
  model = smp.Unet(
      encoder_name='resnet34',
      encoder_weights='imagenet',
      classes=3,  # background, walls, rooms
      activation='softmax',
  )
  # Train on floor plan dataset
  # Save: torch.save(model.state_dict(), 'floor_plan_model.pth')
  ```

---

## Option 2: HuggingFace Transformers Model

### Setup Steps

1. **Configure:**
   ```python
   # In CONFIG dictionary
   'dl_use_huggingface': True,
   'dl_huggingface_model': 'nvidia/segformer-b0-finetuned-ade-512-512',
   ```

2. **Available Models:**
   - `nvidia/segformer-b0-finetuned-ade-512-512` (default)
   - `nvidia/segformer-b1-finetuned-ade-640-640` (larger, more accurate)
   - Search HuggingFace for "floor plan" or "segmentation" models

3. **Install Dependencies:**
   ```bash
   pip install transformers
   ```
   (Already in requirements.txt)

### How It Works

- Model downloads automatically on first use
- Cached in `~/.cache/huggingface/`
- Works out of the box, no training needed

---

## Option 3: Default ImageNet Pre-trained (Current)

### Current Behavior

- Uses U-Net with EfficientNet-B0 encoder
- Pre-trained on ImageNet (natural images)
- **Not ideal for floor plans** but works as fallback
- Automatically used if no custom model or HuggingFace model specified

---

## Configuration Examples

### Use Custom Floor Plan Model

```python
CONFIG = {
    # ... other config ...
    'dl_model_path': '/path/to/server/models/floor_plan_unet.pth',
    'dl_use_huggingface': False,
}
```

### Use HuggingFace Model

```python
CONFIG = {
    # ... other config ...
    'dl_model_path': None,
    'dl_use_huggingface': True,
    'dl_huggingface_model': 'nvidia/segformer-b0-finetuned-ade-512-512',
}
```

### Use Default (Current)

```python
CONFIG = {
    # ... other config ...
    'dl_model_path': None,
    'dl_use_huggingface': False,
}
```

---

## Finding Pre-trained Floor Plan Models

### 1. GitHub Repositories

- **ozturkoktay/floor-plan-room-segmentation**
  - Check releases or `weights/` directory
  - May need to train from their code

- **maikpaixao/deep-floorplan-recognition**
  - Check for pre-trained weights
  - May need to contact author

### 2. Research Papers

- Check paper repositories for model weights
- Look for "Supplementary Material" or "Code & Data" links

### 3. Train Your Own

**Dataset Options:**
- **MLSTRUCT-FP:** 954+ floor plans with wall annotations
- **ResPlan:** 17,000 residential floor plans
- **CubiCasa5k:** 5,000 floor plans (research use)

**Training Script:**
```python
# Example training setup
import segmentation_models_pytorch as smp
import torch

model = smp.Unet('resnet34', classes=3, activation='softmax')
# ... training loop ...
torch.save(model.state_dict(), 'floor_plan_model.pth')
```

---

## Testing Models

### Verify Model Loading

Check server logs for:
```
Loading custom floor plan model from: /path/to/model.pth
Custom floor plan model loaded successfully
```

### Compare Results

1. Test with default model (baseline)
2. Test with custom/HuggingFace model
3. Compare accuracy metrics

---

## Troubleshooting

### Model Not Loading

**Error:** "Failed to load deep learning model"

**Solutions:**
1. Check model path is correct
2. Verify model architecture matches (U-Net with ResNet34)
3. Check model file format (should be `.pth` or `.pt`)
4. Verify model has correct number of classes (3)

### Model Architecture Mismatch

**Error:** "size mismatch" or "unexpected key"

**Solutions:**
1. Model must be U-Net architecture
2. Encoder should be ResNet34 (or compatible)
3. Number of classes must be 3 (background, walls, rooms)
4. Check if model uses different key names (we handle 'state_dict' and 'model_state_dict')

### HuggingFace Model Issues

**Error:** "Model not found" or download fails

**Solutions:**
1. Check internet connection (downloads on first use)
2. Verify model name is correct
3. Try different HuggingFace model
4. Check HuggingFace Hub status

---

## Next Steps

1. **Immediate:** Test with HuggingFace Segformer (easiest)
2. **Short-term:** Find/download pre-trained floor plan model
3. **Long-term:** Train custom model on floor plan dataset

---

## Resources

- **ozturkoktay GitHub:** https://github.com/ozturkoktay/floor-plan-room-segmentation
- **HuggingFace Models:** https://huggingface.co/models?search=segmentation
- **MLSTRUCT-FP Dataset:** https://github.com/MLSTRUCT/MLSTRUCT-FP
- **ResPlan Dataset:** https://arxiv.org/abs/2508.14006
- **Research Paper:** See FLOOR_PLAN_MODEL_RESEARCH.md

