# Phase 4 Implementation & Deep Learning Requirements

## Phase 4: Iterative Refinement (Following Research Paper)

### Overview
According to the research paper, Phase 4 uses **room boundaries to iteratively refine walls**. This is a key technique that improves accuracy by:
1. Using detected rooms to identify missing walls (gap closing)
2. Removing spurious walls that don't support room boundaries
3. Refining wall positions based on room geometry
4. Iterating until convergence

### Implementation Plan

#### 4.1 Close Wall Gaps from Room Boundaries ✅ (Planned)

**Research Paper Approach:**
- For each room with low enclosure score (0.3-0.7), identify boundary gaps
- Search for nearby low-confidence wall segments that could close gaps
- Promote segment confidence if they align geometrically with room boundaries
- Re-render wall mask and re-validate rooms

**Our Implementation:**
```python
def refine_walls_with_room_feedback(wall_graph, rooms, wall_mask, wall_likelihood_mask, scale_factor, image_shape):
    """
    Iteratively refine walls using room boundary feedback
    
    Steps:
    1. Identify rooms with gaps (enclosure_score 0.3-0.7)
    2. Find boundary gaps in these rooms
    3. Search for nearby segments that could close gaps
    4. Promote segments if they align with room boundaries
    5. Remove spurious walls (not supporting any room)
    6. Re-validate rooms with refined walls
    7. Iterate until convergence or max iterations
    """
    max_iterations = 3
    convergence_threshold = 0.05  # Stop if enclosure improvement < 5%
    
    height, width = image_shape
    previous_avg_enclosure = 0.0
    
    for iteration in range(max_iterations):
        print(f"Phase 4 iteration {iteration + 1}/{max_iterations}", file=sys.stderr)
        
        # Step 1: Close gaps from room boundaries
        wall_graph, wall_mask = close_wall_gaps_from_rooms(
            rooms, wall_graph, wall_mask, wall_likelihood_mask, scale_factor, image_shape
        )
        
        # Step 2: Remove spurious walls
        wall_graph = remove_spurious_walls(wall_graph, rooms, image_shape)
        
        # Step 3: Re-render wall mask
        wall_mask = render_wall_mask(wall_graph, image_shape, scale_factor)
        
        # Step 4: Re-validate rooms with refined walls
        rooms = validate_rooms(rooms, wall_mask, wall_graph)
        
        # Step 5: Check convergence
        current_avg_enclosure = sum(r.get('enclosure_score', 0) for r in rooms) / len(rooms) if rooms else 0
        improvement = current_avg_enclosure - previous_avg_enclosure
        
        print(f"Iteration {iteration + 1}: avg_enclosure={current_avg_enclosure:.3f}, improvement={improvement:.3f}", file=sys.stderr)
        
        if improvement < convergence_threshold:
            print(f"Converged after {iteration + 1} iterations", file=sys.stderr)
            break
        
        previous_avg_enclosure = current_avg_enclosure
    
    return wall_graph, wall_mask, rooms
```

**Key Functions Needed:**
1. `close_wall_gaps_from_rooms()` - Find and close gaps
2. `find_boundary_gaps()` - Identify gaps in room boundaries
3. `find_gap_closing_segments()` - Find segments that could close gaps
4. `remove_spurious_walls()` - Remove walls not supporting rooms
5. `promote_segment_confidence()` - Increase confidence of gap-closing segments

#### 4.2 Remove Spurious Walls ✅ (Planned)

**Research Paper Approach:**
- Walls that don't support any room boundary are likely false positives
- Check each wall segment: is it near any room boundary?
- Remove isolated walls far from rooms with low confidence

**Our Implementation:**
```python
def remove_spurious_walls(wall_graph, rooms, image_shape):
    """
    Remove walls that don't support any room boundary
    
    Returns: Updated wall_graph with spurious walls removed
    """
    height, width = image_shape
    
    # Create room boundary mask
    room_boundary_mask = np.zeros((height, width), dtype=np.uint8)
    
    for room in rooms:
        polygon_px = [
            (int(p['x'] * width), int(p['y'] * height))
            for p in room['polygon']
        ]
        # Draw room boundary
        cv2.polylines(room_boundary_mask, [np.array(polygon_px, dtype=np.int32)], True, 255, 2)
    
    # Dilate to include nearby regions
    kernel = np.ones((15, 15), np.uint8)
    room_boundary_mask = cv2.dilate(room_boundary_mask, kernel, iterations=1)
    
    # Check each wall segment
    edges_to_remove = []
    
    for edge in wall_graph.edges(data=True):
        node1, node2, data = edge
        x1, y1 = node1
        x2, y2 = node2
        
        # Sample points along segment
        num_samples = max(5, int(data.get('length', 0) / 10))
        near_room_count = 0
        
        for i in range(num_samples):
            t = i / (num_samples - 1) if num_samples > 1 else 0
            x = int(x1 + t * (x2 - x1))
            y = int(y1 + t * (y2 - y1))
            
            if 0 <= x < width and 0 <= y < height:
                if room_boundary_mask[y, x] > 0:
                    near_room_count += 1
        
        # If segment is far from rooms and has low confidence, mark for removal
        near_room_ratio = near_room_count / num_samples if num_samples > 0 else 0
        confidence = data.get('confidence', 0.5)
        
        if near_room_ratio < 0.2 and confidence < 0.4:
            # Check if isolated (few connections)
            degree1 = wall_graph.degree(node1)
            degree2 = wall_graph.degree(node2)
            
            if degree1 <= 2 and degree2 <= 2:
                edges_to_remove.append((node1, node2))
    
    # Remove spurious walls
    for edge in edges_to_remove:
        wall_graph.remove_edge(*edge)
    
    print(f"Removed {len(edges_to_remove)} spurious wall segments", file=sys.stderr)
    return wall_graph
```

#### 4.3 Wall Position Refinement ✅ (Planned)

**Research Paper Approach:**
- Adjust wall positions to better align with room boundaries
- For each room boundary edge, find nearest wall segment
- If misaligned, adjust wall segment position

**Our Implementation:**
```python
def refine_wall_positions(wall_graph, rooms, image_shape):
    """
    Refine wall positions to better align with room boundaries
    
    Returns: Updated wall_graph with refined positions
    """
    height, width = image_shape
    position_adjustments = {}
    
    for room in rooms:
        polygon_px = [
            (int(p['x'] * width), int(p['y'] * height))
            for p in room['polygon']
        ]
        
        # For each room boundary edge, find nearest wall segment
        for i in range(len(polygon_px)):
            p1 = polygon_px[i]
            p2 = polygon_px[(i + 1) % len(polygon_px)]
            
            # Find nearest wall segment
            nearest_edge = find_nearest_wall_segment(p1, p2, wall_graph)
            
            if nearest_edge:
                # Calculate alignment and adjust if needed
                alignment = calculate_segment_alignment(p1, p2, nearest_edge)
                
                if alignment['distance'] > 5:  # More than 5 pixels misaligned
                    # Adjust wall segment position
                    adjust_wall_segment(nearest_edge, alignment, position_adjustments)
    
    # Apply adjustments
    apply_position_adjustments(wall_graph, position_adjustments)
    
    return wall_graph
```

---

## Deep Learning Requirements

### Overview
The research paper uses deep learning for:
1. **Initial Segmentation** - Deep segmentation networks to identify walls, rooms, symbols
2. **Room-Boundary Guided Attention** - Attention mechanisms guided by room boundaries
3. **Symbol Detection** - Faster R-CNN for detecting doors, windows, symbols

### What's Required

#### 1. **Deep Learning Framework** ✅ (Free/Open-Source)

**Options:**
- **PyTorch** (Recommended) - Free, open-source, widely used
- **TensorFlow** - Free, open-source, also popular
- **ONNX Runtime** - For running pre-trained models

**Installation:**
```bash
pip install torch torchvision
# or
pip install tensorflow
```

**Cost:** ✅ **FREE** (open-source)

#### 2. **Pre-trained Models** ✅ (Free Options Available)

**Option A: Use Pre-trained Models (Recommended)**
- **Segmentation Models:**
  - DeepLabV3 (pre-trained on COCO) - Free
  - U-Net (pre-trained on various datasets) - Free
  - FPN (Feature Pyramid Network) - Free
  
- **Detection Models:**
  - Faster R-CNN (pre-trained on COCO) - Free
  - YOLOv8 (pre-trained) - Free
  - DETR (Detection Transformer) - Free

**Option B: Fine-tune on Floor Plans**
- Requires labeled floor plan dataset
- Can use transfer learning from pre-trained models
- More accurate but requires training data

**Cost:** ✅ **FREE** (pre-trained models are free)

#### 3. **Model Architecture** (Following Research Paper)

**Segmentation Network:**
```python
# Simplified architecture based on paper
import torch
import torch.nn as nn
from torchvision import models

class FloorPlanSegmentation(nn.Module):
    """
    Deep segmentation network for floor plan recognition
    Based on paper's architecture
    """
    def __init__(self, num_classes=3):  # walls, rooms, background
        super().__init__()
        # Use pre-trained ResNet backbone
        backbone = models.resnet50(pretrained=True)
        # Add segmentation head
        self.backbone = nn.Sequential(*list(backbone.children())[:-2])
        self.segmentation_head = nn.Sequential(
            nn.Conv2d(2048, 512, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(512, num_classes, 1)
        )
    
    def forward(self, x):
        features = self.backbone(x)
        output = self.segmentation_head(features)
        return output
```

**Room-Boundary Guided Attention:**
```python
class RoomBoundaryAttention(nn.Module):
    """
    Attention mechanism guided by room boundaries
    """
    def __init__(self):
        super().__init__()
        # Attention layers that focus on room boundaries
        self.attention = nn.MultiheadAttention(embed_dim=256, num_heads=8)
    
    def forward(self, features, room_boundaries):
        # Use room boundaries to guide attention
        attended_features, _ = self.attention(features, room_boundaries, room_boundaries)
        return attended_features
```

#### 4. **Training Data** (If Fine-tuning)

**Requirements:**
- Labeled floor plan images (walls, rooms, symbols)
- Can use synthetic data generation
- Or manually label existing floor plans

**Options:**
1. **Use Pre-trained Models** - No training needed ✅
2. **Fine-tune on Small Dataset** - 50-100 labeled images
3. **Full Training** - 1000+ labeled images

**Cost:** ✅ **FREE** (if using pre-trained or generating synthetic data)

#### 5. **Inference Pipeline**

**Integration with Current System:**
```python
def detect_with_deep_learning(image_path, model):
    """
    Use deep learning for initial segmentation
    Then use traditional CV for refinement
    """
    # Load and preprocess image
    image = cv2.imread(image_path)
    image_tensor = preprocess_image_for_model(image)
    
    # Run segmentation
    with torch.no_grad():
        segmentation = model(image_tensor)
    
    # Convert to wall/room masks
    wall_mask = (segmentation[0, 1] > 0.5).cpu().numpy()  # Class 1 = walls
    room_mask = (segmentation[0, 2] > 0.5).cpu().numpy()   # Class 2 = rooms
    
    return wall_mask, room_mask

# Then use traditional CV for refinement
def hybrid_detection(image_path, scale_factor):
    # Step 1: Deep learning initial segmentation
    wall_mask_dl, room_mask_dl = detect_with_deep_learning(image_path, model)
    
    # Step 2: Traditional CV refinement
    wall_graph = build_wall_graph_from_mask(wall_mask_dl, ...)
    rooms = extract_rooms_from_mask(room_mask_dl, ...)
    
    # Step 3: Phase 4 iterative refinement
    wall_graph, wall_mask, rooms = refine_walls_with_room_feedback(...)
    
    return wall_graph, rooms
```

---

## Implementation Roadmap

### Phase 4 Implementation (Traditional CV)

**Priority: HIGH** (Improves accuracy significantly)

**Steps:**
1. ✅ Implement `close_wall_gaps_from_rooms()`
2. ✅ Implement `remove_spurious_walls()`
3. ✅ Implement `refine_wall_positions()`
4. ✅ Implement iterative refinement loop
5. ✅ Integrate into main detection pipeline
6. ✅ Test and tune parameters

**Estimated Time:** 2-3 days
**Dependencies:** None (uses existing Phase 1-3)

### Deep Learning Integration (Phase 7)

**Priority: MEDIUM** (Enhancement, not required)

**Steps:**
1. Install PyTorch/TensorFlow
2. Load pre-trained segmentation model
3. Create inference pipeline
4. Integrate with traditional CV (hybrid approach)
5. Test accuracy improvement
6. Optional: Fine-tune on floor plan dataset

**Estimated Time:** 1-2 weeks
**Dependencies:** 
- PyTorch/TensorFlow installation
- Pre-trained model download
- GPU (optional, CPU works but slower)

---

## Cost Analysis

### Phase 4 (Traditional CV)
- **Cost:** ✅ **FREE** (uses existing tools)
- **Time:** 2-3 days
- **Impact:** High (significant accuracy improvement)

### Deep Learning (Phase 7)
- **Framework:** ✅ **FREE** (PyTorch/TensorFlow open-source)
- **Pre-trained Models:** ✅ **FREE** (available on HuggingFace, PyTorch Hub)
- **Training Data:** ✅ **FREE** (can use pre-trained or generate synthetic)
- **GPU:** Optional (CPU works, GPU faster)
- **Time:** 1-2 weeks
- **Impact:** Medium (enhancement, not required)

**Total Cost:** ✅ **$0** (100% free/open-source)

---

## Recommendation

### Immediate Next Steps:

1. **Implement Phase 4 First** ✅
   - High impact, low cost
   - Follows research paper closely
   - Improves accuracy significantly
   - No new dependencies

2. **Then Consider Deep Learning** (Optional)
   - Can add later as enhancement
   - Use pre-trained models (no training needed)
   - Hybrid approach: DL for initial segmentation, CV for refinement

### Hybrid Approach (Best of Both):

1. **Deep Learning** → Initial segmentation (walls, rooms)
2. **Traditional CV** → Refinement (graph building, gap closing)
3. **Phase 4** → Iterative refinement with room feedback

This combines the strengths of both approaches!

