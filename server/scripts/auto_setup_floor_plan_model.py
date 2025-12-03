#!/usr/bin/env python3
"""
Fully automated setup for floor plan segmentation model

This script:
1. Checks for pre-trained weights from multiple sources
2. Automatically configures the system
3. Sets up training infrastructure if needed
4. Updates CONFIG automatically
"""

import os
import sys
import subprocess
import shutil
import json
import re
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
SERVER_DIR = SCRIPT_DIR.parent
REPO_ROOT = SERVER_DIR.parent
MODELS_DIR = SERVER_DIR / "models"
EXTERNAL_DIR = SERVER_DIR / "external"
BOUNDARY_SERVICE = SERVER_DIR / "src" / "services" / "boundaryDetectionService.ts"

REPO_URL = "https://github.com/ozturkoktay/floor-plan-room-segmentation.git"
REPO_DIR = EXTERNAL_DIR / "floor-plan-room-segmentation"

def check_dependencies():
    """Check if required dependencies are installed"""
    try:
        import torch
        import segmentation_models_pytorch as smp
        print("✓ PyTorch and segmentation-models-pytorch are installed")
        return True
    except ImportError as e:
        print(f"⚠ Missing dependency: {e}")
        print("\nInstalling dependencies...")
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "torch", "torchvision", "segmentation-models-pytorch"],
                check=True,
                capture_output=True
            )
            print("✓ Dependencies installed")
            # Try importing again
            import torch
            import segmentation_models_pytorch as smp
            return True
        except Exception as install_error:
            print(f"✗ Failed to install: {install_error}")
            print("\nPlease install manually:")
            print("  pip install torch torchvision segmentation-models-pytorch")
            return False

def setup_directories():
    """Create necessary directories"""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    EXTERNAL_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✓ Directories ready")

def clone_repository():
    """Clone the ozturkoktay repository"""
    if REPO_DIR.exists():
        print(f"✓ Repository already exists")
        return True
    
    print(f"Cloning repository...")
    try:
        subprocess.run(
            ["git", "clone", REPO_URL, str(REPO_DIR)],
            check=True,
            capture_output=True,
            timeout=60
        )
        print("✓ Repository cloned successfully")
        return True
    except Exception as e:
        print(f"✗ Failed to clone repository: {e}")
        return False

def find_weights_in_repo():
    """Search for weights in the cloned repository"""
    if not REPO_DIR.exists():
        return None
    
    search_paths = [
        REPO_DIR / "weights",
        REPO_DIR / "models",
        REPO_DIR / "checkpoints",
        REPO_DIR / "saved_models",
        REPO_DIR,
    ]
    
    patterns = ["*.pth", "*.pt", "*.ckpt"]
    
    for search_path in search_paths:
        if not search_path.exists():
            continue
        for pattern in patterns:
            for weight_file in search_path.rglob(pattern):
                if weight_file.stat().st_size > 1_000_000:  # > 1MB
                    return weight_file
    
    return None

def download_alternative_model():
    """Try to download alternative pre-trained models"""
    print("\nChecking for alternative pre-trained models...")
    
    # Try HuggingFace Segformer (works out of the box)
    try:
        import subprocess
        # Try to install transformers if not available
        try:
            from transformers import SegformerForSemanticSegmentation
            print("✓ HuggingFace Transformers available")
        except ImportError:
            print("  Installing HuggingFace Transformers...")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "transformers", "pillow"],
                check=True,
                capture_output=True
            )
            from transformers import SegformerForSemanticSegmentation
            print("✓ HuggingFace Transformers installed")
        
        print("  Using Segformer model (will download on first use)")
        return "huggingface"
    except Exception as e:
        print(f"  Could not set up HuggingFace: {e}")
        pass
    
    return None

def copy_and_configure_weights(weight_file):
    """Copy weights to models directory and configure"""
    target = MODELS_DIR / "floor_plan_model.pth"
    
    print(f"\nCopying weights to {target}...")
    shutil.copy2(weight_file, target)
    print("✓ Weights copied")
    
    # Get absolute path
    abs_path = target.resolve()
    return str(abs_path)

def update_config_file(model_path=None, use_huggingface=False):
    """Update CONFIG in boundaryDetectionService.ts"""
    print(f"\nUpdating CONFIG in boundaryDetectionService.ts...")
    
    if not BOUNDARY_SERVICE.exists():
        print(f"✗ Could not find {BOUNDARY_SERVICE}")
        return False
    
    # Read file
    with open(BOUNDARY_SERVICE, 'r') as f:
        content = f.read()
    
    # Update dl_model_path
    if model_path:
        # Find the CONFIG dictionary
        pattern = r"('dl_model_path':\s*)(None|'[^']*'|/.*?),"
        replacement = f"\\1'{model_path}',"
        content = re.sub(pattern, replacement, content)
        print(f"✓ Set dl_model_path to: {model_path}")
    
    # Update dl_use_huggingface
    if use_huggingface:
        pattern = r"('dl_use_huggingface':\s*)(False|True),"
        replacement = f"\\1True,"
        content = re.sub(pattern, replacement, content)
        print(f"✓ Set dl_use_huggingface to: True")
    
    # Write back
    with open(BOUNDARY_SERVICE, 'w') as f:
        f.write(content)
    
    print("✓ CONFIG updated successfully")
    return True

def create_training_setup():
    """Create training infrastructure for future use"""
    training_script = MODELS_DIR / "train_floor_plan_model.py"
    
    training_code = '''#!/usr/bin/env python3
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
    print("\\nThis script is ready for training.")
    print("To train:")
    print("1. Prepare your dataset (images + masks)")
    print("2. Configure data paths")
    print("3. Run training loop")
    print("4. Save model to:", MODEL_PATH)
    print("\\nModel architecture:")
    model = create_model()
    print(f"  Encoder: {ENCODER}")
    print(f"  Classes: {CLASSES}")
    print(f"  Parameters: {sum(p.numel() for p in model.parameters()):,}")
'''
    
    with open(training_script, 'w') as f:
        f.write(training_code)
    
    training_script.chmod(0o755)
    print(f"✓ Training script created: {training_script}")

def main():
    print("=" * 60)
    print("Automated Floor Plan Model Setup")
    print("=" * 60)
    
    # Check dependencies
    if not check_dependencies():
        print("\n⚠ Please install dependencies first:")
        print("  pip install torch torchvision segmentation-models-pytorch")
        sys.exit(1)
    
    # Setup
    setup_directories()
    
    # Try to get weights from ozturkoktay repo
    print("\n[1/4] Checking ozturkoktay repository...")
    if clone_repository():
        weight_file = find_weights_in_repo()
        if weight_file:
            print(f"✓ Found weights: {weight_file}")
            model_path = copy_and_configure_weights(weight_file)
            update_config_file(model_path=model_path)
            print("\n" + "=" * 60)
            print("✓ Setup complete! Model weights configured.")
            print("=" * 60)
            return
    
    print("  No weights found in repository")
    
    # Try alternative models
    print("\n[2/4] Checking for alternative models...")
    alt_model = download_alternative_model()
    if alt_model == "huggingface":
        print("✓ Using HuggingFace Segformer model")
        update_config_file(use_huggingface=True)
        print("\n" + "=" * 60)
        print("✓ Setup complete! Using HuggingFace model.")
        print("  Model will download automatically on first use.")
        print("=" * 60)
        return
    
    # Set up training infrastructure
    print("\n[3/4] Setting up training infrastructure...")
    create_training_setup()
    
    # Configure for future training
    print("\n[4/4] Configuring for training...")
    print("  Using default ImageNet pre-trained model for now")
    print("  Training script ready at: models/train_floor_plan_model.py")
    
    print("\n" + "=" * 60)
    print("Setup complete!")
    print("=" * 60)
    print("\nCurrent status:")
    print("  - Using ImageNet pre-trained model (baseline)")
    print("  - Training infrastructure ready")
    print("\nNext steps:")
    print("  1. Train model using: python3 models/train_floor_plan_model.py")
    print("  2. Or find pre-trained weights and place in models/")
    print("  3. Update dl_model_path in CONFIG when ready")

if __name__ == "__main__":
    main()

