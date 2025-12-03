#!/usr/bin/env python3
"""
Complete training script for floor plan segmentation
Trains U-Net on floor plan dataset
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

# Configuration
ENCODER = 'resnet34'
CLASSES = 3  # background, walls, rooms
BATCH_SIZE = 4
LEARNING_RATE = 0.0001
EPOCHS = 50
MODEL_SAVE_PATH = Path(__file__).parent / "floor_plan_model_trained.pth"

class FloorPlanDataset(Dataset):
    def __init__(self, images_dir, masks_dir, transform=None):
        self.images_dir = Path(images_dir)
        self.masks_dir = Path(masks_dir)
        self.transform = transform
        
        self.image_files = sorted(list(self.images_dir.glob("*.png")) + 
                                  list(self.images_dir.glob("*.jpg")))
    
    def __len__(self):
        return len(self.image_files)
    
    def __getitem__(self, idx):
        img_path = self.image_files[idx]
        mask_path = self.masks_dir / img_path.name
        
        image = cv2.imread(str(img_path))
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        
        if self.transform:
            augmented = self.transform(image=image, mask=mask)
            image = augmented['image']
            mask = augmented['mask']
        
        # Convert mask to class indices (0=background, 1=walls, 2=rooms)
        # Handle different mask formats:
        # - If mask uses 0, 128, 255: convert to 0, 1, 2
        # - If mask already uses 0, 1, 2: use as-is
        if mask.max() > 2:
            # Convert 0-255 scale to 0-2 scale
            mask = (mask / 128).long().clamp(0, 2)
        else:
            mask = mask.long()
        
        return image, mask

def create_model():
    """Create U-Net model"""
    model = smp.Unet(
        encoder_name=ENCODER,
        encoder_weights='imagenet',
        classes=CLASSES,
        activation='softmax',
    )
    return model

def train():
    """Train the model"""
    print("Floor Plan Model Training")
    print("=" * 50)
    
    # Data transforms
    train_transform = A.Compose([
        A.Resize(512, 512),
        A.HorizontalFlip(p=0.5),
        A.RandomBrightnessContrast(p=0.2),
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2(),
    ])
    
    val_transform = A.Compose([
        A.Resize(512, 512),
        A.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ToTensorV2(),
    ])
    
    # Setup datasets - use absolute paths from server directory
    script_dir = Path(__file__).parent
    server_dir = script_dir.parent
    data_dir = server_dir / "data" / "floor_plans"
    
    train_images = data_dir / "train_images"
    train_masks = data_dir / "train_masks"
    val_images = data_dir / "val_images"
    val_masks = data_dir / "val_masks"
    
    if not train_images.exists():
        print("\n❌ Dataset not found!")
        print(f"\nPlease organize your dataset in: {data_dir}")
        print("\nRequired structure:")
        print("  data/floor_plans/")
        print("    ├── train_images/  # Your floor plan images (PNG/JPG)")
        print("    ├── train_masks/   # Segmentation masks (same filenames)")
        print("    ├── val_images/    # Validation images (10-20% of total)")
        print("    └── val_masks/     # Validation masks")
        print("\nMask format:")
        print("  - Grayscale PNG")
        print("  - Values: 0=background, 128=walls, 255=rooms")
        print("  - OR: 0=background, 1=walls, 2=rooms")
        print("\nExample:")
        print("  train_images/plan_001.png  →  train_masks/plan_001.png")
        print("  train_images/plan_002.png  →  train_masks/plan_002.png")
        return
    
    print(f"\n✓ Found dataset at: {data_dir}")
    print(f"  Training images: {len(list(train_images.glob('*.png')) + list(train_images.glob('*.jpg')))}")
    print(f"  Validation images: {len(list(val_images.glob('*.png')) + list(val_images.glob('*.jpg')))}")
    
    train_dataset = FloorPlanDataset(train_images, train_masks, train_transform)
    val_dataset = FloorPlanDataset(val_images, val_masks, val_transform)
    
    train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE)
    
    # Model
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = create_model().to(device)
    
    # Loss and optimizer
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # Training loop
    best_loss = float('inf')
    for epoch in range(EPOCHS):
        model.train()
        train_loss = 0
        
        for images, masks in tqdm(train_loader, desc=f"Epoch {epoch+1}/{EPOCHS}"):
            images = images.to(device)
            masks = masks.to(device)
            
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, masks)
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item()
        
        # Validation
        model.eval()
        val_loss = 0
        with torch.no_grad():
            for images, masks in val_loader:
                images = images.to(device)
                masks = masks.to(device)
                outputs = model(images)
                loss = criterion(outputs, masks)
                val_loss += loss.item()
        
        avg_train_loss = train_loss / len(train_loader)
        avg_val_loss = val_loss / len(val_loader)
        
        print(f"Epoch {epoch+1}: Train Loss: {avg_train_loss:.4f}, Val Loss: {avg_val_loss:.4f}")
        
        if avg_val_loss < best_loss:
            best_loss = avg_val_loss
            torch.save(model.state_dict(), MODEL_SAVE_PATH)
            print(f"  ✓ Saved best model to {MODEL_SAVE_PATH}")
    
    print(f"\n✓ Training complete! Model saved to {MODEL_SAVE_PATH}")
    
    # Automatically update CONFIG
    print("\nUpdating CONFIG to use trained model...")
    try:
        boundary_service = server_dir / "src" / "services" / "boundaryDetectionService.ts"
        if boundary_service.exists():
            import re
            with open(boundary_service, 'r') as f:
                content = f.read()
            
            # Update dl_model_path
            abs_model_path = str(MODEL_SAVE_PATH.resolve())
            pattern = r"('dl_model_path':\s*)(None|'[^']*'|/.*?),"
            replacement = f"\\1'{abs_model_path}',"
            content = re.sub(pattern, replacement, content)
            
            # Set dl_use_huggingface to False
            pattern2 = r"('dl_use_huggingface':\s*)(False|True),"
            replacement2 = f"\\1False,"
            content = re.sub(pattern2, replacement2, content)
            
            with open(boundary_service, 'w') as f:
                f.write(content)
            
            print(f"✓ CONFIG updated! Model will be used automatically on next CV takeoff.")
        else:
            print(f"⚠ Could not find boundaryDetectionService.ts to update CONFIG")
            print(f"  Manually set 'dl_model_path' to: {abs_model_path}")
    except Exception as e:
        print(f"⚠ Could not auto-update CONFIG: {e}")
        print(f"  Manually set 'dl_model_path' to: {MODEL_SAVE_PATH.resolve()}")

if __name__ == "__main__":
    train()
