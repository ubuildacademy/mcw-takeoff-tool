#!/usr/bin/env python3
"""
Training script for floor plan segmentation model
Based on ozturkoktay approach, adapted for our system
"""

import torch
import segmentation_models_pytorch as smp
from pathlib import Path

# Model configuration
ENCODER = 'resnet34'
CLASSES = 3  # background, walls, rooms
MODEL_PATH = Path(__file__).parent / "floor_plan_model.pth"

def create_model():
    """Create U-Net model for floor plan segmentation"""
    model = smp.Unet(
        encoder_name=ENCODER,
        encoder_weights='imagenet',  # Start with ImageNet weights
        classes=CLASSES,
        activation='softmax',
    )
    return model

if __name__ == "__main__":
    print("Floor Plan Model Training Script")
    print("=" * 50)
    print("\nThis script is ready for training.")
    print("To train:")
    print("1. Prepare your dataset (images + masks)")
    print("2. Configure data paths")
    print("3. Run training loop")
    print("4. Save model to:", MODEL_PATH)
    print("\nModel architecture:")
    model = create_model()
    print(f"  Encoder: {ENCODER}")
    print(f"  Classes: {CLASSES}")
    print(f"  Parameters: {sum(p.numel() for p in model.parameters()):,}")
