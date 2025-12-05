#!/usr/bin/env python3
"""
Automated dataset preparation for CubiCasa5k

Converts SVG annotations to segmentation masks and organizes dataset
for training U-Net + ResNet-50 model.

Usage:
    python prepare_cubicasa5k_dataset.py

This script:
1. Reads train.txt, val.txt, test.txt split files
2. For each sample, loads F1_scaled.png and model.svg
3. Parses SVG to extract rooms (Space elements) and walls (Wall elements)
4. Creates segmentation masks (0=background, 1=walls, 2=rooms)
5. Organizes into train_images/, train_masks/, val_images/, val_masks/
6. Processes in batches to manage memory (16GB RAM)
"""

import xml.etree.ElementTree as ET
from pathlib import Path
import cv2
import numpy as np
from tqdm import tqdm
import sys
import re
from typing import List, Tuple, Optional
import shutil

# ============================================================================
# Configuration
# ============================================================================

# Paths
SCRIPT_DIR = Path(__file__).parent
SERVER_DIR = SCRIPT_DIR.parent
REPO_ROOT = SERVER_DIR.parent

# CubiCasa5k dataset location
CUBICASA_ROOT = REPO_ROOT / "Cubicasa5k" / "cubicasa5k"
CUBICASA_DATA = CUBICASA_ROOT / "high_quality_architectural"

# Output dataset location
OUTPUT_DIR = SERVER_DIR / "data" / "floor_plans"
TRAIN_IMAGES = OUTPUT_DIR / "train_images"
TRAIN_MASKS = OUTPUT_DIR / "train_masks"
VAL_IMAGES = OUTPUT_DIR / "val_images"
VAL_MASKS = OUTPUT_DIR / "val_masks"
TEST_IMAGES = OUTPUT_DIR / "test_images"
TEST_MASKS = OUTPUT_DIR / "test_masks"

# Split files
TRAIN_SPLIT = CUBICASA_ROOT / "train.txt"
VAL_SPLIT = CUBICASA_ROOT / "val.txt"
TEST_SPLIT = CUBICASA_ROOT / "test.txt"

# Processing settings
BATCH_SIZE = 50  # Process in batches to manage memory
RESUME = True    # Skip already processed files

# ============================================================================
# SVG Parsing Functions
# ============================================================================

def parse_polygon_points(points_str: str) -> List[Tuple[float, float]]:
    """Parse SVG polygon points string into list of (x, y) tuples"""
    if not points_str:
        return []
    
    # Split by comma or space, handle both formats
    coords = re.split(r'[,\s]+', points_str.strip())
    coords = [c for c in coords if c]  # Remove empty strings
    
    points = []
    for i in range(0, len(coords) - 1, 2):
        try:
            x = float(coords[i])
            y = float(coords[i + 1])
            points.append((x, y))
        except (ValueError, IndexError):
            continue
    
    return points

def apply_transform(points: List[Tuple[float, float]], transform_str: Optional[str]) -> List[Tuple[float, float]]:
    """Apply SVG transform matrix to points"""
    if not transform_str or transform_str == "none":
        return points
    
    # Parse matrix transform: matrix(a,b,c,d,e,f)
    # [a c e]   [x]   [ax + cy + e]
    # [b d f] * [y] = [bx + dy + f]
    # [0 0 1]   [1]   [1          ]
    match = re.search(r'matrix\(([^)]+)\)', transform_str)
    if match:
        values = [float(v.strip()) for v in match.group(1).split(',')]
        if len(values) == 6:
            a, b, c, d, e, f = values
            transformed = []
            for x, y in points:
                new_x = a * x + c * y + e
                new_y = b * x + d * y + f
                transformed.append((new_x, new_y))
            return transformed
    
    return points

def parse_svg_to_mask(svg_path: Path, image_shape: Tuple[int, int]) -> np.ndarray:
    """
    Parse SVG file and create segmentation mask
    
    Returns:
        numpy array with shape (height, width), dtype uint8
        Values: 0=background, 1=walls, 2=rooms
    """
    height, width = image_shape
    mask = np.zeros((height, width), dtype=np.uint8)
    
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception as e:
        print(f"  ⚠ Error parsing SVG {svg_path}: {e}")
        return mask
    
    # Handle SVG namespaces
    # SVG files typically use: xmlns="http://www.w3.org/2000/svg"
    namespaces = {'svg': 'http://www.w3.org/2000/svg'}
    
    # Try to detect namespace from root
    if root.tag.startswith('{'):
        # Extract namespace from tag like {http://www.w3.org/2000/svg}svg
        namespace = root.tag[1:].split('}')[0]
        namespaces['svg'] = namespace
        ns_prefix = '{' + namespace + '}'
    else:
        ns_prefix = ''
    
    # Get SVG viewBox to determine coordinate system
    viewbox = root.get('viewBox', '')
    svg_width = float(root.get('width', width))
    svg_height = float(root.get('height', height))
    
    # Initialize viewBox offsets
    vb_x, vb_y = 0.0, 0.0
    
    if viewbox:
        # Parse viewBox: "x y width height"
        vb_parts = viewbox.split()
        if len(vb_parts) == 4:
            vb_x, vb_y, vb_w, vb_h = map(float, vb_parts)
            scale_x = width / vb_w
            scale_y = height / vb_h
        else:
            scale_x = width / svg_width
            scale_y = height / svg_height
    else:
        scale_x = width / svg_width
        scale_y = height / svg_height
    
    def scale_point(x: float, y: float) -> Tuple[int, int]:
        """Convert SVG coordinates to image pixel coordinates"""
        if viewbox:
            px = int((x - vb_x) * scale_x)
            py = int((y - vb_y) * scale_y)
        else:
            px = int(x * scale_x)
            py = int(y * scale_y)
        return (px, py)
    
    # Process all elements recursively
    def process_element(elem, parent_transform=None, parent_classes=None):
        """Recursively process SVG elements to extract rooms and walls"""
        if parent_classes is None:
            parent_classes = []
        
        # Get transform
        transform = elem.get('transform', None)
        if transform:
            current_transform = transform
        else:
            current_transform = parent_transform
        
        # Get class attribute
        class_attr = elem.get('class', '')
        current_classes = parent_classes + [class_attr] if class_attr else parent_classes
        
        # Check if this is a Space (room) element
        is_space = 'Space' in class_attr and 'Wall' not in class_attr
        
        # Check if this is a Wall element (handle namespace in tag)
        elem_tag_clean = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        is_wall = (elem_tag_clean == 'g' and ('Wall' in class_attr or elem.get('id') == 'Wall'))
        
        # Check parent hierarchy for Space class
        has_space_parent = any('Space' in c and 'Wall' not in c for c in current_classes)
        
        # Process polygons directly in this element (not recursively)
        # Handle namespace: polygon might be {namespace}polygon
        polygon_tag = 'polygon' if not ns_prefix else ns_prefix + 'polygon'
        for polygon in elem.findall(polygon_tag):
            points_str = polygon.get('points', '')
            if not points_str:
                continue
            
            points = parse_polygon_points(points_str)
            if len(points) < 3:  # Need at least 3 points for a polygon
                continue
            
            # Apply transform if present
            if current_transform:
                points = apply_transform(points, current_transform)
            
            # Convert to image coordinates
            img_points = np.array([scale_point(x, y) for x, y in points], dtype=np.int32)
            
            # Determine class based on element and parent hierarchy
            if is_wall:
                class_value = 1  # Walls
            elif is_space or has_space_parent:
                class_value = 2  # Rooms
            else:
                continue  # Skip if not a room or wall
            
            # Draw filled polygon on mask
            cv2.fillPoly(mask, [img_points], class_value)
        
        # Recursively process child elements (handle namespace)
        for child in elem:
            # Only process g elements and their children (skip text, etc.)
            child_tag_clean = child.tag.split('}')[-1] if '}' in child.tag else child.tag
            if child_tag_clean in ['g', 'polygon', 'path', 'rect']:
                process_element(child, current_transform, current_classes)
    
    # Start processing from root
    try:
        process_element(root)
    except Exception as e:
        print(f"  ⚠ Error processing SVG elements: {e}")
    
    return mask

# ============================================================================
# Dataset Preparation Functions
# ============================================================================

def load_split_file(split_path: Path) -> List[str]:
    """Load sample paths from split file"""
    if not split_path.exists():
        print(f"⚠ Split file not found: {split_path}")
        return []
    
    samples = []
    with open(split_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                # Remove leading slash if present
                if line.startswith('/'):
                    line = line[1:]
                samples.append(line)
    
    return samples

def process_sample(sample_path: str, output_images_dir: Path, output_masks_dir: Path) -> bool:
    """
    Process a single sample: copy image and create mask from SVG
    
    Returns:
        True if successful, False otherwise
    """
    # Strip leading slash and remove 'high_quality_architectural/' prefix if present
    # since CUBICASA_DATA already points to that directory
    clean_path = sample_path.strip('/')
    if clean_path.startswith('high_quality_architectural/'):
        clean_path = clean_path[len('high_quality_architectural/'):]
    
    # Construct full paths
    sample_dir = CUBICASA_DATA / clean_path
    image_path = sample_dir / "F1_scaled.png"
    svg_path = sample_dir / "model.svg"
    
    # Check if files exist
    if not image_path.exists():
        # Try F1_original.png as fallback
        image_path = sample_dir / "F1_original.png"
        if not image_path.exists():
            return False
    
    if not svg_path.exists():
        return False
    
    # Generate output filename from sample path
    # e.g., "high_quality_architectural/6044/" -> "6044.png"
    # After cleaning, clean_path is like "6044" or "6044/"
    sample_id = clean_path.rstrip('/').split('/')[-1]
    if not sample_id:  # Fallback if still empty
        sample_id = str(sample_dir.name)
    output_image_name = f"{sample_id}.png"
    output_mask_name = f"{sample_id}.png"
    
    output_image_path = output_images_dir / output_image_name
    output_mask_path = output_masks_dir / output_mask_name
    
    # Skip if already processed (resume mode)
    if RESUME and output_image_path.exists() and output_mask_path.exists():
        return True
    
    try:
        # Load image to get dimensions
        image = cv2.imread(str(image_path))
        if image is None:
            return False
        
        height, width = image.shape[:2]
        
        # Create mask from SVG
        mask = parse_svg_to_mask(svg_path, (height, width))
        
        # Save image
        output_images_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, output_image_path)
        
        # Save mask
        output_masks_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_mask_path), mask)
        
        return True
    
    except Exception as e:
        print(f"  ⚠ Error processing {sample_path}: {e}")
        return False

def prepare_dataset():
    """Main function to prepare the dataset"""
    print("=" * 70)
    print("CubiCasa5k Dataset Preparation")
    print("=" * 70)
    
    # Check if CubiCasa5k dataset exists
    if not CUBICASA_DATA.exists():
        print(f"\n❌ CubiCasa5k dataset not found at: {CUBICASA_DATA}")
        print("\nExpected location:")
        print("  Cubicasa5k/cubicasa5k/high_quality_architectural/")
        return False
    
    print(f"\n✓ Found CubiCasa5k dataset at: {CUBICASA_DATA}")
    
    # Load split files
    print("\nLoading split files...")
    train_samples = load_split_file(TRAIN_SPLIT)
    val_samples = load_split_file(VAL_SPLIT)
    test_samples = load_split_file(TEST_SPLIT)
    
    print(f"  Train samples: {len(train_samples)}")
    print(f"  Val samples: {len(val_samples)}")
    print(f"  Test samples: {len(test_samples)}")
    
    if len(train_samples) == 0:
        print("\n❌ No training samples found!")
        return False
    
    # Create output directories
    print(f"\nOutput directory: {OUTPUT_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Process each split
    splits = [
        ("train", train_samples, TRAIN_IMAGES, TRAIN_MASKS),
        ("val", val_samples, VAL_IMAGES, VAL_MASKS),
        ("test", test_samples, TEST_IMAGES, TEST_MASKS),
    ]
    
    total_processed = 0
    total_failed = 0
    
    for split_name, samples, images_dir, masks_dir in splits:
        if len(samples) == 0:
            print(f"\n⚠ Skipping {split_name} split (no samples)")
            continue
        
        print(f"\n{'=' * 70}")
        print(f"Processing {split_name} split ({len(samples)} samples)...")
        print(f"{'=' * 70}")
        
        # Process in batches
        successful = 0
        failed = 0
        
        for i in tqdm(range(0, len(samples), BATCH_SIZE), desc=f"{split_name.capitalize()}"):
            batch = samples[i:i + BATCH_SIZE]
            
            for sample_path in batch:
                if process_sample(sample_path, images_dir, masks_dir):
                    successful += 1
                else:
                    failed += 1
        
        print(f"\n✓ {split_name.capitalize()} complete:")
        print(f"  Successful: {successful}")
        print(f"  Failed: {failed}")
        
        total_processed += successful
        total_failed += failed
    
    # Summary
    print(f"\n{'=' * 70}")
    print("Dataset Preparation Complete!")
    print(f"{'=' * 70}")
    print(f"\nTotal processed: {total_processed}")
    print(f"Total failed: {total_failed}")
    print(f"\nOutput location: {OUTPUT_DIR}")
    print("\nDataset structure:")
    print(f"  {TRAIN_IMAGES.relative_to(SERVER_DIR)}/")
    print(f"  {TRAIN_MASKS.relative_to(SERVER_DIR)}/")
    print(f"  {VAL_IMAGES.relative_to(SERVER_DIR)}/")
    print(f"  {VAL_MASKS.relative_to(SERVER_DIR)}/")
    
    if total_processed > 0:
        print(f"\n✓ Dataset ready for training!")
        print(f"  Run: python server/scripts/train_cubicasa5k_resnet50.py")
        return True
    else:
        print(f"\n❌ No samples were processed successfully!")
        return False

# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    try:
        success = prepare_dataset()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠ Dataset preparation interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Dataset preparation failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

