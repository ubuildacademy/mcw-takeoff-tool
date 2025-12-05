#!/usr/bin/env python3
"""
Training script for U-Net + ResNet-50 on CubiCasa5k dataset

This script trains a U-Net segmentation model with ResNet-50 encoder
on the CubiCasa5k high_quality_architectural dataset.

Usage:
    python train_cubicasa5k_resnet50.py

Requirements:
    - Prepared dataset in server/data/floor_plans/
    - PyTorch (with CUDA for GPU training, or MPS for Apple Silicon)
    - segmentation-models-pytorch, albumentations, opencv-python

Supports:
    - CUDA (NVIDIA GPUs) - fastest
    - MPS (Apple Silicon) - good performance on Mac
    - CPU - slower but works
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import segmentation_models_pytorch as smp
import albumentations as A
from albumentations.pytorch import ToTensorV2
from pathlib import Path
import cv2
import numpy as np
from tqdm import tqdm
import sys
import os

# ============================================================================
# Configuration
# ============================================================================

ENCODER = 'resnet50'          # ResNet-50 encoder (better than ResNet-34)
CLASSES = 3                   # background=0, walls=1, rooms=2
BATCH_SIZE = None             # Auto-adjusted based on device (8 for CUDA, 4 for MPS, 2 for CPU)
LEARNING_RATE = 0.0001        # Adam optimizer learning rate
EPOCHS = 50                   # Number of training epochs
INPUT_SIZE = 512              # Input image size (512x512 recommended)

# Model save path
SCRIPT_DIR = Path(__file__).parent
SERVER_DIR = SCRIPT_DIR.parent
MODEL_SAVE_PATH = SERVER_DIR / "models" / "floor_plan_cubicasa5k_resnet50.pth"

# ============================================================================
# Dataset Class
# ============================================================================

class FloorPlanDataset(Dataset):
    """Dataset for floor plan images and segmentation masks"""
    
    def __init__(self, images_dir, masks_dir, transform=None):
        self.images_dir = Path(images_dir)
        self.masks_dir = Path(masks_dir)
        self.transform = transform
        
        # Find all image files
        self.image_files = sorted(
            list(self.images_dir.glob("*.png")) + 
            list(self.images_dir.glob("*.jpg"))
        )
        
        if len(self.image_files) == 0:
            raise ValueError(f"No images found in {self.images_dir}")
    
    def __len__(self):
        return len(self.image_files)
    
    def __getitem__(self, idx):
        img_path = self.image_files[idx]
        mask_path = self.masks_dir / img_path.name
        
        # Load image
        image = cv2.imread(str(img_path))
        if image is None:
            raise ValueError(f"Could not load image: {img_path}")
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Load mask
        mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            raise ValueError(f"Could not load mask: {mask_path}")
        
        # Apply transforms
        if self.transform:
            augmented = self.transform(image=image, mask=mask)
            image = augmented['image']
            mask = augmented['mask']
        
        # Convert mask to class indices (0=background, 1=walls, 2=rooms)
        # Handle different mask formats:
        # - If mask uses 0, 128, 255: convert to 0, 1, 2
        # - If mask already uses 0, 1, 2: use as-is
        if isinstance(mask, np.ndarray):
            mask = torch.from_numpy(mask)
        
        if mask.max() > 2:
            # Convert 0-255 scale to 0-2 scale
            # 0 -> 0 (background)
            # 128 -> 1 (walls)
            # 255 -> 2 (rooms)
            mask = (mask / 128).long().clamp(0, 2)
        else:
            mask = mask.long()
        
        return image, mask

# ============================================================================
# Model Creation
# ============================================================================

def create_model():
    """Create U-Net model with ResNet-50 encoder"""
    print(f"\nCreating U-Net model with {ENCODER} encoder...")
    model = smp.Unet(
        encoder_name=ENCODER,
        encoder_weights='imagenet',  # Start with ImageNet pre-trained weights
        classes=CLASSES,
        activation='softmax',
    )
    
    # Count parameters
    num_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {num_params:,}")
    
    return model

# ============================================================================
# Device Detection
# ============================================================================

def get_device():
    """Detect and return best available device"""
    if torch.cuda.is_available():
        device = torch.device('cuda')
        print(f"✓ Using CUDA device: {torch.cuda.get_device_name(0)}")
        print(f"  CUDA version: {torch.version.cuda}")
        print(f"  GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        device = torch.device('mps')
        print("✓ Using Apple Metal Performance Shaders (MPS)")
    else:
        device = torch.device('cpu')
        print("⚠ Using CPU (slower - consider using GPU if available)")
    
    return device

# ============================================================================
# Training Function
# ============================================================================

def train():
    """Main training function"""
    print("=" * 70)
    print("Floor Plan Model Training - U-Net + ResNet-50 on CubiCasa5k")
    print("=" * 70)
    
    # Check device
    device = get_device()
    
    # Auto-adjust batch size and num_workers based on device
    if BATCH_SIZE is None:
        if device.type == 'cuda':
            batch_size = 8  # GTX 1080Ti can handle 8-16
        elif device.type == 'mps':
            batch_size = 4  # M1 Pro MPS works well with 4
        else:
            batch_size = 2  # CPU needs smaller batches
    else:
        batch_size = BATCH_SIZE
    
    # Adjust num_workers based on device
    if device.type == 'cuda':
        num_workers = 4  # CUDA can handle more workers
    elif device.type == 'mps':
        num_workers = 2  # MPS works better with fewer workers
    else:
        num_workers = 0  # CPU: no multiprocessing needed
    
    print(f"\nTraining configuration:")
    print(f"  Device: {device}")
    print(f"  Batch size: {batch_size}")
    print(f"  Data workers: {num_workers}")
    
    # Data transforms
    print("\nSetting up data transforms...")
    train_transform = A.Compose([
        A.Resize(INPUT_SIZE, INPUT_SIZE),
        A.HorizontalFlip(p=0.5),
        A.RandomBrightnessContrast(p=0.2),
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2(),
    ])
    
    val_transform = A.Compose([
        A.Resize(INPUT_SIZE, INPUT_SIZE),
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2(),
    ])
    
    # Setup dataset paths
    data_dir = SERVER_DIR / "data" / "floor_plans"
    
    train_images = data_dir / "train_images"
    train_masks = data_dir / "train_masks"
    val_images = data_dir / "val_images"
    val_masks = data_dir / "val_masks"
    
    # Check if dataset exists
    if not train_images.exists():
        print("\n❌ Dataset not found!")
        print(f"\nExpected dataset location: {data_dir}")
        print("\nRequired structure:")
        print("  data/floor_plans/")
        print("    ├── train_images/  # Floor plan images (PNG/JPG)")
        print("    ├── train_masks/   # Segmentation masks (same filenames)")
        print("    ├── val_images/    # Validation images")
        print("    └── val_masks/     # Validation masks")
        print("\nMask format:")
        print("  - Grayscale PNG")
        print("  - Values: 0=background, 128=walls, 255=rooms")
        print("  - OR: 0=background, 1=walls, 2=rooms")
        print("\n💡 Run prepare_cubicasa5k_dataset.py on Mac first to prepare the dataset.")
        return
    
    # Count images
    train_count = len(list(train_images.glob("*.png")) + list(train_images.glob("*.jpg")))
    val_count = len(list(val_images.glob("*.png")) + list(val_images.glob("*.jpg")))
    
    if train_count == 0:
        print(f"\n❌ No training images found in {train_images}")
        return
    
    if val_count == 0:
        print(f"\n⚠ No validation images found in {val_images}")
        print("  Training will continue but validation won't be performed.")
    
    print(f"\n✓ Found dataset at: {data_dir}")
    print(f"  Training images: {train_count}")
    print(f"  Validation images: {val_count}")
    
    # Create datasets
    try:
        print("\nLoading datasets...")
        train_dataset = FloorPlanDataset(train_images, train_masks, train_transform)
        val_dataset = FloorPlanDataset(val_images, val_masks, val_transform) if val_count > 0 else None
        print("✓ Datasets loaded successfully")
    except Exception as e:
        print(f"\n❌ Error loading datasets: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Create data loaders
    train_loader = DataLoader(
        train_dataset, 
        batch_size=batch_size, 
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True if device.type == 'cuda' else False
    )
    
    val_loader = DataLoader(
        val_dataset, 
        batch_size=batch_size,
        num_workers=num_workers,
        pin_memory=True if device.type == 'cuda' else False
    ) if val_dataset else None
    
    # Create model
    model = create_model().to(device)
    
    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # Training loop
    print(f"\n{'=' * 70}")
    print(f"Starting training for {EPOCHS} epochs...")
    print(f"  Batch size: {batch_size}")
    print(f"  Learning rate: {LEARNING_RATE}")
    print(f"  Input size: {INPUT_SIZE}x{INPUT_SIZE}")
    if device.type == 'mps':
        print(f"  Estimated time: ~2-4 hours (MPS acceleration)")
    elif device.type == 'cuda':
        print(f"  Estimated time: ~30-60 minutes (CUDA acceleration)")
    else:
        print(f"  Estimated time: ~4-8 hours (CPU only)")
    print(f"{'=' * 70}\n")
    
    best_loss = float('inf')
    best_epoch = 0
    
    for epoch in range(EPOCHS):
        # Training phase
        model.train()
        train_loss = 0.0
        train_batches = 0
        
        train_pbar = tqdm(train_loader, desc=f"Epoch {epoch+1}/{EPOCHS} [Train]")
        for images, masks in train_pbar:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, masks)
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item()
            train_batches += 1
            train_pbar.set_postfix({'loss': f'{loss.item():.4f}'})
        
        avg_train_loss = train_loss / train_batches
        
        # Validation phase
        if val_loader:
            model.eval()
            val_loss = 0.0
            val_batches = 0
            
            with torch.no_grad():
                val_pbar = tqdm(val_loader, desc=f"Epoch {epoch+1}/{EPOCHS} [Val]")
                for images, masks in val_pbar:
                    images = images.to(device, non_blocking=True)
                    masks = masks.to(device, non_blocking=True)
                    outputs = model(images)
                    loss = criterion(outputs, masks)
                    val_loss += loss.item()
                    val_batches += 1
                    val_pbar.set_postfix({'loss': f'{loss.item():.4f}'})
            
            avg_val_loss = val_loss / val_batches
        else:
            avg_val_loss = float('inf')
        
        # Print epoch results
        print(f"\nEpoch {epoch+1}/{EPOCHS}:")
        print(f"  Train Loss: {avg_train_loss:.4f}")
        if val_loader:
            print(f"  Val Loss:   {avg_val_loss:.4f}")
        
        # Save best model
        if avg_val_loss < best_loss:
            best_loss = avg_val_loss
            best_epoch = epoch + 1
            MODEL_SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), MODEL_SAVE_PATH)
            print(f"  ✓ Saved best model (epoch {best_epoch}) to {MODEL_SAVE_PATH}")
        print()
    
    # Training complete
    print("=" * 70)
    print("✓ Training complete!")
    print(f"  Best model saved at: {MODEL_SAVE_PATH}")
    print(f"  Best epoch: {best_epoch}")
    print(f"  Best validation loss: {best_loss:.4f}")
    print("=" * 70)
    
    # Automatically update CONFIG
    print("\nUpdating CONFIG to use trained model...")
    try:
        boundary_service = SERVER_DIR / "src" / "services" / "boundaryDetectionService.ts"
        if boundary_service.exists():
            import re
            with open(boundary_service, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Update dl_model_path
            abs_model_path = str(MODEL_SAVE_PATH.resolve())
            # Handle Windows paths (convert backslashes to forward slashes for consistency)
            abs_model_path = abs_model_path.replace('\\', '/')
            
            pattern = r"('dl_model_path':\s*)(None|'[^']*'|/.*?),"
            replacement = f"\\1'{abs_model_path}',"
            content = re.sub(pattern, replacement, content)
            
            # Set dl_use_huggingface to False
            pattern2 = r"('dl_use_huggingface':\s*)(False|True),"
            replacement2 = f"\\1False,"
            content = re.sub(pattern2, replacement2, content)
            
            with open(boundary_service, 'w', encoding='utf-8') as f:
                f.write(content)
            
            print(f"✓ CONFIG updated! Model will be used automatically on next CV takeoff.")
            print(f"  Model path: {abs_model_path}")
        else:
            print(f"⚠ Could not find boundaryDetectionService.ts to update CONFIG")
            print(f"  Manually set 'dl_model_path' to: {abs_model_path}")
    except Exception as e:
        print(f"⚠ Could not auto-update CONFIG: {e}")
        print(f"  Manually set 'dl_model_path' to: {MODEL_SAVE_PATH.resolve()}")
        import traceback
        traceback.print_exc()

# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    try:
        train()
    except KeyboardInterrupt:
        print("\n\n⚠ Training interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Training failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

