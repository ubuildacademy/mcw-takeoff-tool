#!/usr/bin/env python3
"""
Setup script for ozturkoktay floor plan segmentation model

This script:
1. Clones the ozturkoktay repository
2. Checks for pre-trained weights
3. If not found, provides instructions for training
4. Sets up the model for use with our system
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

REPO_URL = "https://github.com/ozturkoktay/floor-plan-room-segmentation.git"
REPO_DIR = Path(__file__).parent.parent / "external" / "floor-plan-room-segmentation"
MODELS_DIR = Path(__file__).parent.parent / "models"

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import torch
        import segmentation_models_pytorch as smp
        print("✓ PyTorch and segmentation-models-pytorch are installed")
        return True
    except ImportError as e:
        print(f"✗ Missing dependency: {e}")
        print("Please install: pip install torch torchvision segmentation-models-pytorch")
        return False

def clone_repository():
    """Clone the ozturkoktay repository"""
    if REPO_DIR.exists():
        print(f"Repository already exists at {REPO_DIR}")
        return True
    
    print(f"Cloning repository to {REPO_DIR}...")
    try:
        subprocess.run(
            ["git", "clone", REPO_URL, str(REPO_DIR)],
            check=True,
            capture_output=True
        )
        print("✓ Repository cloned successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to clone repository: {e}")
        print(f"Error: {e.stderr.decode() if e.stderr else 'Unknown error'}")
        return False
    except FileNotFoundError:
        print("✗ Git is not installed. Please install git first.")
        return False

def find_model_weights():
    """Search for pre-trained model weights in the repository"""
    print("\nSearching for pre-trained model weights...")
    
    # Common locations for model weights
    search_paths = [
        REPO_DIR / "weights",
        REPO_DIR / "models",
        REPO_DIR / "checkpoints",
        REPO_DIR / "saved_models",
        REPO_DIR,
    ]
    
    # Common weight file patterns
    patterns = ["*.pth", "*.pt", "*.ckpt", "*model*.pth", "*weights*.pth"]
    
    found_weights = []
    for search_path in search_paths:
        if not search_path.exists():
            continue
        
        for pattern in patterns:
            for weight_file in search_path.rglob(pattern):
                # Skip very small files (likely not model weights)
                if weight_file.stat().st_size > 1_000_000:  # > 1MB
                    found_weights.append(weight_file)
                    print(f"  Found: {weight_file}")
    
    return found_weights

def check_repository_structure():
    """Check the repository structure and provide info"""
    print("\nChecking repository structure...")
    
    readme = REPO_DIR / "README.md"
    if readme.exists():
        print(f"✓ README found: {readme}")
        with open(readme, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            if "weight" in content.lower() or "pretrained" in content.lower():
                print("  README mentions weights/pretrained models")
    
    # Check for training scripts
    training_files = list(REPO_DIR.rglob("*.ipynb")) + list(REPO_DIR.rglob("train*.py"))
    if training_files:
        print(f"✓ Found {len(training_files)} training script(s)")
        for f in training_files[:3]:  # Show first 3
            print(f"  - {f.relative_to(REPO_DIR)}")
    
    # Check for dataset info
    dataset_files = list(REPO_DIR.rglob("*dataset*")) + list(REPO_DIR.rglob("*data*"))
    if dataset_files:
        print(f"✓ Found {len(dataset_files)} dataset-related file(s)")

def setup_model_directory():
    """Create models directory if it doesn't exist"""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✓ Models directory ready: {MODELS_DIR}")

def create_model_info():
    """Create info file about the model"""
    info_file = MODELS_DIR / "ozturkoktay_model_info.txt"
    with open(info_file, 'w') as f:
        f.write("Ozturkoktay Floor Plan Segmentation Model\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Repository: {REPO_URL}\n")
        f.write(f"Repository Location: {REPO_DIR}\n\n")
        f.write("Model Architecture:\n")
        f.write("- U-Net with ResNet encoder\n")
        f.write("- Classes: background, walls, rooms\n")
        f.write("- Uses segmentation-models-pytorch\n\n")
        f.write("To use this model:\n")
        f.write("1. Train the model using the repository's training script\n")
        f.write("2. Save the trained weights as a .pth file\n")
        f.write("3. Set 'dl_model_path' in CONFIG to point to the weights file\n")
        f.write("4. The model will automatically load on next CV takeoff run\n")
    
    print(f"✓ Model info file created: {info_file}")

def main():
    print("=" * 60)
    print("Ozturkoktay Floor Plan Model Setup")
    print("=" * 60)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Setup directories
    setup_model_directory()
    
    # Clone repository
    if not clone_repository():
        print("\n⚠ Could not clone repository. You can manually clone it:")
        print(f"  git clone {REPO_URL} {REPO_DIR}")
        sys.exit(1)
    
    # Check repository structure
    check_repository_structure()
    
    # Search for weights
    weights = find_model_weights()
    
    if weights:
        print(f"\n✓ Found {len(weights)} potential model weight file(s)")
        print("\nTo use one of these weights:")
        print("1. Copy the weight file to the models directory:")
        print(f"   cp {weights[0]} {MODELS_DIR}/ozturkoktay_model.pth")
        print("2. Update CONFIG in boundaryDetectionService.ts:")
        print(f"   'dl_model_path': '{MODELS_DIR}/ozturkoktay_model.pth',")
    else:
        print("\n⚠ No pre-trained weights found in repository")
        print("\nYou have two options:")
        print("\nOption 1: Train the model yourself")
        print("  1. Follow the training instructions in the repository")
        print("  2. Use a floor plan dataset (e.g., MLSTRUCT-FP, ResPlan)")
        print("  3. Train using their Jupyter notebook or training script")
        print("  4. Save weights and configure as above")
        print("\nOption 2: Use our training script (coming soon)")
        print("  We can create a training script based on their approach")
        print("  that works with our system")
    
    # Create info file
    create_model_info()
    
    print("\n" + "=" * 60)
    print("Setup complete!")
    print("=" * 60)
    print(f"\nRepository location: {REPO_DIR}")
    print(f"Models directory: {MODELS_DIR}")
    print("\nNext steps:")
    print("1. Check the repository for training instructions")
    print("2. Train or obtain model weights")
    print("3. Configure dl_model_path in boundaryDetectionService.ts")
    print("4. Test with a floor plan PDF")

if __name__ == "__main__":
    main()

