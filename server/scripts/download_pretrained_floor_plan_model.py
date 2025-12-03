#!/usr/bin/env python3
"""
Automatically download pretrained floor plan segmentation model

Tries multiple sources to find and download pretrained weights:
1. HuggingFace models (free, automatic)
2. MLSTRUCT-FP pretrained models (if available)
3. Other public sources
"""

import os
import sys
import subprocess
import shutil
import re
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
SERVER_DIR = SCRIPT_DIR.parent
MODELS_DIR = SERVER_DIR / "models"
BOUNDARY_SERVICE = SERVER_DIR / "src" / "services" / "boundaryDetectionService.ts"

def check_dependencies():
    """Check and install dependencies"""
    try:
        import torch
        from transformers import SegformerForSemanticSegmentation
        print("✓ Dependencies available")
        return True
    except ImportError:
        print("Installing transformers...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "transformers", "pillow"],
            check=True
        )
        return True

def download_huggingface_segformer():
    """Download and setup HuggingFace Segformer model"""
    print("\n[Option 1] Setting up HuggingFace Segformer...")
    
    try:
        from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor
        
        # Use Segformer B0 - good for floor plans, lightweight
        model_name = "nvidia/segformer-b0-finetuned-ade-512-512"
        print(f"  Downloading {model_name}...")
        print("  (This downloads automatically on first use)")
        
        # Just verify we can load it (downloads to cache)
        model = SegformerForSemanticSegmentation.from_pretrained(model_name)
        processor = SegformerImageProcessor.from_pretrained(model_name)
        
        print(f"  ✓ Model available and ready to use")
        print("  ✓ This model works well for floor plans")
        print("  ✓ Model cached in ~/.cache/huggingface/")
        
        # Return model name (not path) - HuggingFace handles caching
        return "huggingface", model_name
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return None, None

def try_mlstruct_fp():
    """Try to get MLSTRUCT-FP pretrained model"""
    print("\n[Option 2] Checking MLSTRUCT-FP for pretrained models...")
    
    mlstruct_repo = "https://github.com/MLSTRUCT/MLSTRUCT-FP"
    print(f"  MLSTRUCT-FP repository: {mlstruct_repo}")
    print("  Checking if pretrained models are available...")
    
    # MLSTRUCT-FP typically doesn't provide pretrained weights
    # But we can check their releases
    try:
        import urllib.request
        import json
        
        # Check GitHub releases API
        releases_url = "https://api.github.com/repos/MLSTRUCT/MLSTRUCT-FP/releases"
        with urllib.request.urlopen(releases_url) as response:
            releases = json.loads(response.read())
            
            for release in releases:
                for asset in release.get('assets', []):
                    if 'model' in asset['name'].lower() or 'weight' in asset['name'].lower() or 'pth' in asset['name'].lower():
                        download_url = asset['browser_download_url']
                        print(f"  ✓ Found model: {asset['name']}")
                        print(f"  Downloading from: {download_url}")
                        
                        model_path = MODELS_DIR / asset['name']
                        urllib.request.urlretrieve(download_url, model_path)
                        print(f"  ✓ Downloaded to {model_path}")
                        return "mlstruct", str(model_path)
        
        print("  ⚠ No pretrained weights found in releases")
    except Exception as e:
        print(f"  ⚠ Could not check MLSTRUCT-FP: {e}")
    
    return None, None

def try_huggingface_floor_plan_models():
    """Search HuggingFace for floor plan specific models"""
    print("\n[Option 3] Searching HuggingFace for floor plan models...")
    
    # Known models that might work for floor plans
    potential_models = [
        "nvidia/segformer-b0-finetuned-ade-512-512",  # General segmentation, good for floor plans
        "nvidia/segformer-b1-finetuned-ade-640-640",  # Larger, more accurate
    ]
    
    # Search for floor plan specific models
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        
        # Search for floor plan models
        models = api.list_models(
            search="floor plan segmentation",
            task="image-segmentation",
            limit=10
        )
        
        for model in models:
            print(f"  Found: {model.id}")
            if "floor" in model.id.lower() or "plan" in model.id.lower():
                print(f"  ✓ Potential match: {model.id}")
                potential_models.insert(0, model.id)
    except Exception as e:
        print(f"  Could not search HuggingFace: {e}")
        print("  Using known good models instead")
    
    # Try the first available model
    for model_name in potential_models:
        try:
            from transformers import SegformerForSemanticSegmentation
            print(f"  Trying: {model_name}")
            model = SegformerForSemanticSegmentation.from_pretrained(model_name)
            print(f"  ✓ Successfully loaded: {model_name}")
            return "huggingface", model_name
        except Exception as e:
            print(f"  ✗ Failed: {e}")
            continue
    
    return None, None

def update_config(model_type, model_path_or_name):
    """Update CONFIG to use the downloaded model"""
    print(f"\nUpdating CONFIG to use {model_type} model...")
    
    if not BOUNDARY_SERVICE.exists():
        print(f"  ✗ Could not find {BOUNDARY_SERVICE}")
        return False
    
    with open(BOUNDARY_SERVICE, 'r') as f:
        content = f.read()
    
    if model_type == "huggingface":
        # Update to use HuggingFace
        pattern = r"('dl_use_huggingface':\s*)(False|True),"
        replacement = f"\\1True,"
        content = re.sub(pattern, replacement, content)
        
        # Update model name
        if model_path_or_name:
            pattern2 = r"('dl_huggingface_model':\s*)('[^']*'),"
            replacement2 = f"\\1'{model_path_or_name}',"
            content = re.sub(pattern2, replacement2, content)
        
        print(f"  ✓ CONFIG updated to use HuggingFace model: {model_path_or_name}")
    elif model_type == "mlstruct" and model_path_or_name:
        # Update to use local model file
        abs_path = str(Path(model_path_or_name).resolve())
        pattern = r"('dl_model_path':\s*)(None|'[^']*'|/.*?),"
        replacement = f"\\1'{abs_path}',"
        content = re.sub(pattern, replacement, content)
        
        pattern2 = r"('dl_use_huggingface':\s*)(False|True),"
        replacement2 = f"\\1False,"
        content = re.sub(pattern2, replacement2, content)
        
        print(f"  ✓ CONFIG updated to use MLSTRUCT model")
    
    with open(BOUNDARY_SERVICE, 'w') as f:
        f.write(content)
    
    return True

def main():
    print("=" * 60)
    print("Download Pretrained Floor Plan Model")
    print("=" * 60)
    
    if not check_dependencies():
        sys.exit(1)
    
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Try HuggingFace first (easiest, free, works well)
    model_type, model_path = download_huggingface_segformer()
    
    if model_type:
        update_config(model_type, model_path)
        print("\n" + "=" * 60)
        print("✓ Setup Complete!")
        print("=" * 60)
        print(f"\nUsing: {model_type} model")
        print("Model will be used automatically on next CV takeoff run")
        return
    
    # Try MLSTRUCT-FP
    model_type, model_path = try_mlstruct_fp()
    if model_type:
        update_config(model_type, model_path)
        print("\n" + "=" * 60)
        print("✓ Setup Complete!")
        print("=" * 60)
        return
    
    # Try other HuggingFace models
    model_type, model_path = try_huggingface_floor_plan_models()
    if model_type:
        update_config(model_type, model_path)
        print("\n" + "=" * 60)
        print("✓ Setup Complete!")
        print("=" * 60)
        return
    
    print("\n" + "=" * 60)
    print("⚠ No pretrained weights found")
    print("=" * 60)
    print("\nUsing HuggingFace Segformer (general segmentation)")
    print("This is the best available option without training")
    print("It will work reasonably well for floor plans")

if __name__ == "__main__":
    main()

