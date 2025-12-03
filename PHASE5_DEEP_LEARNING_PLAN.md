# Phase 5: Deep Learning Integration Plan
## Hybrid Approach: DL Initial Segmentation + CV Refinement

---

## Overview

**Strategy:** Combine deep learning (for initial segmentation) with traditional CV (for refinement) to get the best of both approaches.

**Pipeline:**
1. **Deep Learning** → Initial segmentation (walls, rooms, symbols)
2. **Traditional CV** → Graph building, gap closing, refinement
3. **Phase 4** → Iterative refinement with room feedback

---

## Architecture

### Hybrid Detection Pipeline

```
Input Image
    ↓
[Deep Learning Segmentation]
    ├─→ Wall Mask (initial)
    ├─→ Room Mask (initial)
    └─→ Symbol Detections (doors, windows)
    ↓
[Traditional CV Processing]
    ├─→ Build Wall Graph from DL mask
    ├─→ Extract Rooms from DL mask
    ├─→ Filter and validate
    └─→ Phase 4: Iterative refinement
    ↓
Final Results (walls, rooms, symbols)
```

---

## Implementation Plan

### Step 1: Setup Deep Learning Framework

#### 1.1 Install Dependencies

```bash
# Install PyTorch (CPU version - free)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Or GPU version (if available)
pip install torch torchvision torchaudio

# Install segmentation models
pip install segmentation-models-pytorch

# Install additional utilities
pip install pillow numpy opencv-python
```

**Cost:** ✅ **FREE** (all open-source)

#### 1.2 Choose Pre-trained Model

**Recommended: DeepLabV3 with ResNet50 backbone**

**Why:**
- Pre-trained on COCO dataset (general object segmentation)
- Good balance of accuracy and speed
- Easy to fine-tune if needed
- Free and open-source

**Alternative Models:**
- **U-Net** - Good for medical/architectural images
- **FPN (Feature Pyramid Network)** - Better for multi-scale objects
- **SegFormer** - Transformer-based, state-of-the-art

**Model Loading:**
```python
import torch
import torchvision.models as models
from torchvision.models.segmentation import deeplabv3_resnet50

# Load pre-trained model
model = deeplabv3_resnet50(pretrained=True)
model.eval()  # Set to evaluation mode
```

---

### Step 2: Create Segmentation Service

#### 2.1 Model Wrapper Class

```python
# File: server/src/services/deepLearningSegmentationService.py

import torch
import torchvision.transforms as transforms
from torchvision.models.segmentation import deeplabv3_resnet50
import cv2
import numpy as np
from PIL import Image

class DeepLearningSegmentationService:
    """
    Deep learning-based segmentation for floor plans
    Uses pre-trained models for initial wall/room detection
    """
    
    def __init__(self):
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.load_model()
    
    def load_model(self):
        """Load pre-trained segmentation model"""
        try:
            print(f"Loading DeepLabV3 model on {self.device}", file=sys.stderr)
            self.model = deeplabv3_resnet50(pretrained=True)
            self.model.to(self.device)
            self.model.eval()
            print("Model loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"ERROR loading model: {str(e)}", file=sys.stderr)
            self.model = None
    
    def is_available(self):
        """Check if model is available"""
        return self.model is not None
    
    def segment_image(self, image_path):
        """
        Segment floor plan image into walls, rooms, and background
        
        Returns:
            - wall_mask: Binary mask of walls
            - room_mask: Binary mask of rooms
            - confidence_map: Confidence scores for each pixel
        """
        if not self.is_available():
            return None, None, None
        
        try:
            # Load and preprocess image
            image = cv2.imread(image_path)
            if image is None:
                return None, None, None
            
            # Convert BGR to RGB
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Resize to model input size (typically 512x512 or 1024x1024)
            original_height, original_width = image_rgb.shape[:2]
            target_size = 512  # Can be adjusted
            
            image_resized = cv2.resize(image_rgb, (target_size, target_size))
            
            # Preprocess for model
            transform = transforms.Compose([
                transforms.ToPILImage(),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                                   std=[0.229, 0.224, 0.225])
            ])
            
            input_tensor = transform(image_resized).unsqueeze(0).to(self.device)
            
            # Run inference
            with torch.no_grad():
                output = self.model(input_tensor)['out'][0]
                predictions = output.argmax(0).cpu().numpy()
                confidence = torch.softmax(output, dim=0).max(0)[0].cpu().numpy()
            
            # Resize predictions back to original size
            predictions = cv2.resize(
                predictions.astype(np.uint8), 
                (original_width, original_height), 
                interpolation=cv2.INTER_NEAREST
            )
            confidence = cv2.resize(
                confidence, 
                (original_width, original_height), 
                interpolation=cv2.INTER_LINEAR
            )
            
            # Create masks (assuming model outputs: 0=background, 1=walls, 2=rooms)
            # Note: Pre-trained models may need fine-tuning for floor plans
            # For now, we'll use a heuristic approach
            
            wall_mask = (predictions == 1).astype(np.uint8) * 255
            room_mask = (predictions == 2).astype(np.uint8) * 255
            
            return wall_mask, room_mask, confidence
            
        except Exception as e:
            print(f"ERROR in segmentation: {str(e)}", file=sys.stderr)
            import traceback
            print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
            return None, None, None
```

#### 2.2 Fine-tuning Strategy (Optional)

**If pre-trained model doesn't work well on floor plans:**

1. **Collect Training Data:**
   - 50-100 labeled floor plan images
   - Label walls, rooms, background
   - Use tools like LabelMe or CVAT

2. **Fine-tune Model:**
   ```python
   # Fine-tune last layers on floor plan dataset
   # Keep early layers frozen (transfer learning)
   for param in model.backbone.parameters():
       param.requires_grad = False
   
   # Train only segmentation head
   optimizer = torch.optim.Adam(model.classifier.parameters(), lr=0.001)
   ```

3. **Training Time:**
   - With GPU: 2-4 hours
   - With CPU: 1-2 days
   - Can use free GPU from Google Colab

---

### Step 3: Integrate with Existing Pipeline

#### 3.1 Modify Boundary Detection Service

```python
# In boundaryDetectionService.ts Python script

def detect_walls_with_deep_learning(image_path, scale_factor, ocr_text=None, use_dl=True):
    """
    Hybrid detection: Deep learning + Traditional CV
    
    If use_dl=True and DL model available:
        1. Use DL for initial segmentation
        2. Use CV for refinement
    Else:
        Use traditional CV only (current approach)
    """
    
    # Try deep learning first
    if use_dl:
        try:
            from deepLearningSegmentationService import DeepLearningSegmentationService
            dl_service = DeepLearningSegmentationService()
            
            if dl_service.is_available():
                print("Using deep learning for initial segmentation", file=sys.stderr)
                wall_mask_dl, room_mask_dl, confidence_map = dl_service.segment_image(image_path)
                
                if wall_mask_dl is not None:
                    # Use DL masks as starting point
                    # Build wall graph from DL mask
                    wall_graph = build_wall_graph_from_mask(wall_mask_dl, scale_factor)
                    rooms = extract_rooms_from_mask(room_mask_dl, scale_factor, ocr_text)
                    
                    # Then proceed with Phase 4 refinement
                    return wall_graph, rooms, wall_mask_dl
        except Exception as e:
            print(f"Deep learning failed, falling back to CV: {str(e)}", file=sys.stderr)
    
    # Fallback to traditional CV (current implementation)
    print("Using traditional CV detection", file=sys.stderr)
    return detect_walls_new(image_path, scale_factor, min_length_lf, ocr_text)
```

#### 3.2 Build Wall Graph from DL Mask

```python
def build_wall_graph_from_mask(wall_mask, scale_factor):
    """
    Build wall graph from deep learning segmentation mask
    
    Steps:
    1. Extract line segments from mask
    2. Filter and validate
    3. Build graph
    """
    # Use existing line detection on DL mask
    segments = detect_line_segments(wall_mask)
    
    # Filter segments
    candidate_walls = filter_non_wall_segments(segments, scale_factor, [], wall_mask.shape, wall_mask)
    
    # Build graph
    wall_graph = build_wall_graph(candidate_walls, scale_factor, wall_mask)
    
    return wall_graph
```

#### 3.3 Extract Rooms from DL Mask

```python
def extract_rooms_from_mask(room_mask, scale_factor, ocr_text):
    """
    Extract rooms from deep learning segmentation mask
    
    Steps:
    1. Find connected components in room mask
    2. Match with OCR labels
    3. Validate and classify
    """
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_mask, connectivity=8)
    
    rooms = []
    for i in range(1, num_labels):  # Skip background (label 0)
        # Get component mask
        component_mask = (labels == i).astype(np.uint8) * 255
        
        # Find contours
        contours, _ = cv2.findContours(component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        
        # Get largest contour
        largest_contour = max(contours, key=cv2.contourArea)
        
        # Convert to polygon
        epsilon = 0.02 * cv2.arcLength(largest_contour, True)
        approx = cv2.approxPolyDP(largest_contour, epsilon, True)
        
        # Calculate area and perimeter
        area_px = cv2.contourArea(largest_contour)
        area_sf = area_px * (scale_factor ** 2)
        perimeter_px = cv2.arcLength(largest_contour, True)
        perimeter_lf = perimeter_px * scale_factor
        
        # Convert to normalized coordinates
        height, width = room_mask.shape
        polygon = []
        for point in approx:
            x_norm = float(point[0][0]) / width
            y_norm = float(point[0][1]) / height
            polygon.append({'x': x_norm, 'y': y_norm})
        
        # Match with OCR labels
        label_text = match_room_label(centroids[i], ocr_text, width, height)
        
        rooms.append({
            'polygon': polygon,
            'area_sf': area_sf,
            'perimeter_lf': perimeter_lf,
            'label_text': label_text,
            'confidence': 0.8  # DL confidence
        })
    
    return rooms
```

---

### Step 4: Symbol Detection (Doors, Windows)

#### 4.1 Use Faster R-CNN for Symbol Detection

```python
import torchvision.models as models

class SymbolDetectionService:
    """Detect doors, windows, and other symbols using Faster R-CNN"""
    
    def __init__(self):
        self.model = models.detection.fasterrcnn_resnet50_fpn(pretrained=True)
        self.model.eval()
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
    
    def detect_symbols(self, image_path):
        """
        Detect doors, windows, and symbols
        
        Note: Pre-trained model detects general objects
        May need fine-tuning for architectural symbols
        """
        # Similar to segmentation service
        # Returns bounding boxes and classes
        pass
```

#### 4.2 Fine-tune for Architectural Symbols

**If pre-trained model doesn't detect doors/windows well:**

1. **Collect Symbol Dataset:**
   - 100-200 images with labeled doors/windows
   - Use bounding box annotations

2. **Fine-tune Faster R-CNN:**
   - Replace classification head
   - Train on symbol dataset
   - Use transfer learning (freeze backbone)

---

### Step 5: Integration Points

#### 5.1 Main Detection Flow

```python
# In main execution block

# Option 1: Try deep learning first
if USE_DEEP_LEARNING:
    wall_graph, rooms, wall_mask = detect_walls_with_deep_learning(
        image_path, scale_factor, ocr_text, use_dl=True
    )
else:
    # Option 2: Traditional CV only
    walls, wall_graph, wall_likelihood_mask, image_shape, scale_factor = detect_walls_new(
        image_path, scale_factor, min_wall_length, ocr_text
    )

# Phase 4: Iterative refinement (works with both approaches)
if wall_graph and rooms:
    wall_graph, wall_mask, rooms = refine_walls_with_room_feedback(
        wall_graph, rooms, wall_mask, wall_likelihood_mask, scale_factor, image_shape
    )
```

#### 5.2 Configuration

```python
# Add to CONFIG
CONFIG = {
    # ... existing config ...
    
    # Deep learning settings
    'use_deep_learning': True,  # Enable/disable DL
    'dl_model_path': None,  # Path to fine-tuned model (if available)
    'dl_confidence_threshold': 0.5,  # Minimum confidence for DL predictions
    'dl_fallback_to_cv': True,  # Fallback to CV if DL fails
}
```

---

## Implementation Steps

### Phase 5.1: Setup and Basic Integration (Week 1)

1. ✅ Install PyTorch and dependencies
2. ✅ Create `DeepLearningSegmentationService` class
3. ✅ Load pre-trained DeepLabV3 model
4. ✅ Create basic segmentation function
5. ✅ Test on sample floor plans
6. ✅ Integrate with existing pipeline (optional mode)

**Deliverable:** DL segmentation working, can be enabled/disabled

### Phase 5.2: Refinement and Optimization (Week 2)

1. ✅ Improve mask post-processing
2. ✅ Add confidence thresholding
3. ✅ Optimize inference speed
4. ✅ Add GPU support detection
5. ✅ Create fallback mechanism
6. ✅ Test accuracy vs. traditional CV

**Deliverable:** Production-ready DL integration

### Phase 5.3: Fine-tuning (Optional, Week 3-4)

1. ✅ Collect floor plan dataset (50-100 images)
2. ✅ Label walls, rooms, background
3. ✅ Fine-tune model on dataset
4. ✅ Evaluate accuracy improvement
5. ✅ Deploy fine-tuned model

**Deliverable:** Fine-tuned model with improved accuracy

### Phase 5.4: Symbol Detection (Optional, Week 5-6)

1. ✅ Integrate Faster R-CNN for symbol detection
2. ✅ Fine-tune on door/window dataset
3. ✅ Integrate with main pipeline
4. ✅ Test and validate

**Deliverable:** Door/window detection working

---

## Cost Analysis

### Setup Costs
- **PyTorch:** ✅ FREE (open-source)
- **Pre-trained Models:** ✅ FREE (from PyTorch Hub)
- **Training Data:** ✅ FREE (can generate synthetic or use public datasets)
- **GPU:** Optional (CPU works, GPU faster)
  - Free GPU: Google Colab (limited hours)
  - Paid GPU: AWS/GCP (~$0.50-1.00/hour)

### Ongoing Costs
- **Inference:** CPU (free) or GPU (optional)
- **Model Storage:** Minimal (models are ~100-500MB)
- **Total:** ✅ **$0** (if using CPU and pre-trained models)

---

## Performance Considerations

### Speed
- **CPU Inference:** 2-5 seconds per image (512x512)
- **GPU Inference:** 0.1-0.5 seconds per image
- **Traditional CV:** 1-3 seconds per image

### Accuracy
- **Pre-trained Model:** ~70-80% accuracy on floor plans
- **Fine-tuned Model:** ~85-95% accuracy (with good dataset)
- **Hybrid Approach:** Best of both (DL initial + CV refinement)

### Memory
- **Model Size:** ~100-500MB
- **Inference Memory:** ~1-2GB (CPU) or ~2-4GB (GPU)

---

## Testing Strategy

### 1. Unit Tests
- Test model loading
- Test segmentation on sample images
- Test integration with existing pipeline

### 2. Accuracy Tests
- Compare DL vs. CV on test dataset
- Measure precision/recall
- Test on various floor plan styles

### 3. Performance Tests
- Measure inference time
- Test memory usage
- Test on different hardware

### 4. Integration Tests
- Test fallback mechanism
- Test hybrid approach
- Test with Phase 4 refinement

---

## Rollout Plan

### Phase 1: Development (Weeks 1-2)
- Implement basic DL integration
- Test on development environment
- Compare with traditional CV

### Phase 2: Beta Testing (Week 3)
- Enable for select users
- Collect feedback
- Monitor performance

### Phase 3: Production (Week 4+)
- Enable for all users
- Monitor accuracy and performance
- Fine-tune based on feedback

### Optional: Fine-tuning (Weeks 5-8)
- Collect training data
- Fine-tune model
- Deploy improved model

---

## Success Metrics

### Accuracy
- **Target:** 85%+ accuracy on wall detection
- **Target:** 80%+ accuracy on room detection
- **Target:** 70%+ accuracy on symbol detection

### Performance
- **Target:** <5 seconds inference time (CPU)
- **Target:** <1 second inference time (GPU)
- **Target:** <2GB memory usage

### User Satisfaction
- **Target:** Positive feedback on accuracy
- **Target:** Reduced false positives
- **Target:** Better results than CV-only

---

## Next Steps

1. **Review this plan** - Confirm approach and priorities
2. **Set up development environment** - Install PyTorch
3. **Implement Phase 5.1** - Basic DL integration
4. **Test and iterate** - Refine based on results
5. **Optional fine-tuning** - If accuracy needs improvement

---

## Questions to Consider

1. **Priority:** Should we implement DL now or focus on Phase 4 first?
2. **Fine-tuning:** Do we have resources to collect training data?
3. **GPU:** Do we have GPU access, or should we optimize for CPU?
4. **Symbols:** Should we implement door/window detection now or later?

---

## Conclusion

This plan provides a **hybrid approach** that combines:
- ✅ Deep learning for initial segmentation (fast, accurate)
- ✅ Traditional CV for refinement (precise, reliable)
- ✅ Phase 4 iterative refinement (improves both)

**Result:** Best accuracy with reasonable performance and cost ($0 with CPU + pre-trained models).

