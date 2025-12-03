# CV Takeoff Refined Implementation Plan
## Focus: Wall and Room Detection with Graph-Based Architecture

---

## Open-Source Tools & Dependencies

### ✅ All Free/Open-Source - No Subscriptions Required

**Current Dependencies (Already Installed):**
- Python 3.7+ (free)
- OpenCV (cv2) - free, open-source
- NumPy - free, open-source
- PyTesseract - free, open-source OCR
- Pillow (PIL) - free, open-source image processing
- PyMuPDF - free, open-source PDF handling

**Additional Dependencies Needed:**
- NetworkX - free, open-source graph library (for wall graph structure)
  ```bash
  pip3 install networkx
  ```

**No Deep Learning Models Required** (Phase 7 is optional and can use free pre-trained models later)

---

## Phase 0: Inputs, Scale, and Configuration

### Inputs:
- **Floor plan page as image**: Rasterized from PDF at configurable DPI (300-400 DPI recommended)
- **User-calibrated scale factor**: From existing calibration system (e.g., "1/8" = 1'-0"" → scaleFactor)
- **OCR output for room labels**: Text + bounding boxes (already implemented via PyTesseract)

### Configuration Parameters:
```python
CONFIG = {
    # Wall detection
    'min_wall_length_ft': 1.0,  # Minimum wall length in real units
    'wall_thickness_pixels': 3,  # Rough wall thickness for rendering masks
    'wall_thickness_ft_range': (0.25, 2.0),  # Min/max wall thickness in feet (3" to 24")
    
    # Tolerances
    'endpoint_snap_distance_px': 3,  # Pixels for endpoint snapping
    'angular_tolerance_deg': 5.0,  # Degrees for "collinear" lines
    'parallel_angle_tolerance_deg': 10.0,  # Degrees for parallel wall pairing
    
    # Room detection
    'min_room_area_sf': 50.0,  # Minimum room area in square feet
    'max_room_area_sf': 2000.0,  # Maximum room area (filter out entire building)
    'corridor_aspect_ratio_threshold': 5.0,  # Aspect ratio to classify as corridor
    'corridor_perimeter_area_ratio_threshold': 0.3,  # Perimeter/area ratio for corridors
    
    # Preprocessing
    'image_max_dimension_px': 3000,  # Max dimension before downscaling
    'gaussian_blur_kernel': (5, 5),  # Denoising blur kernel
    'bilateral_filter_d': 9,  # Bilateral filter diameter (alternative to Gaussian)
    'bilateral_filter_sigma_color': 75,  # Bilateral filter color sigma
    'bilateral_filter_sigma_space': 75,  # Bilateral filter space sigma
    
    # Morphological operations
    'morph_horizontal_kernel_size': (15, 3),  # Horizontal wall emphasis
    'morph_vertical_kernel_size': (3, 15),  # Vertical wall emphasis
    'morph_closing_iterations': 2,  # Morphological closing iterations
    'morph_opening_iterations': 1,  # Morphological opening iterations
    
    # Graph building
    'node_snap_distance_px': 2,  # Distance to snap endpoints into single node
    'collinear_merge_distance_px': 5,  # Max distance to merge collinear segments
    
    # Confidence scoring weights
    'confidence_weights': {
        'length': 0.3,
        'mask_overlap': 0.3,
        'local_density': 0.2,
        'structural_alignment': 0.2
    },
    
    # Titleblock exclusion (normalized 0-1)
    'titleblock_exclude_top': 0.10,
    'titleblock_exclude_bottom': 0.90,
    'titleblock_exclude_left': 0.05,
    'titleblock_exclude_right': 0.85
}
```

### Preprocessing Pipeline:
```python
def preprocess_image(image_path, scale_factor):
    """
    Preprocess floor plan image for wall/room detection
    
    Steps:
    1. Load image and convert to grayscale
    2. Resize if needed (maintain aspect ratio, max dimension = 3000px)
    3. Denoise with bilateral filter (preserves edges better than Gaussian)
    4. Adaptive threshold to binary (foreground = dark lines/walls)
    5. Store pixel-to-unit mapping based on scale_factor
    
    Returns:
        - processed_image: Binary or grayscale image
        - scale_factor_adjusted: Adjusted scale factor if image was resized
        - pixel_to_unit: Conversion factor (pixels to feet)
    """
    img = cv2.imread(image_path)
    height, width = img.shape[:2]
    
    # Resize if needed
    max_dim = CONFIG['image_max_dimension_px']
    if width > max_dim or height > max_dim:
        scale_down = max_dim / max(width, height)
        new_width = int(width * scale_down)
        new_height = int(height * scale_down)
        img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        scale_factor = scale_factor / scale_down
    
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Denoise with bilateral filter (preserves edges)
    denoised = cv2.bilateralFilter(
        gray,
        CONFIG['bilateral_filter_d'],
        CONFIG['bilateral_filter_sigma_color'],
        CONFIG['bilateral_filter_sigma_space']
    )
    
    # Adaptive threshold to binary
    # Use adaptive thresholding to handle varying line weights
    binary = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 11, 2
    )
    
    pixel_to_unit = scale_factor  # pixels to feet
    
    return binary, scale_factor, pixel_to_unit
```

---

## Phase 1: Basic Wall Likelihood and Line Extraction

### Goal: Build a reliable set of candidate wall segments and a wall graph

### 1.1 Generate Wall-Likelihood Binary Mask

```python
def generate_wall_likelihood_mask(binary_image):
    """
    Create a wall-likelihood mask using morphological operations
    
    Steps:
    1. Apply morphological closing with oriented kernels (horizontal, vertical)
    2. Optionally apply opening to remove isolated dots
    3. Combine horizontal and vertical responses
    4. Optional: Add diagonal wall detection (45°, 135°)
    
    Returns:
        wall_likelihood_mask: Binary image where walls are likely present
    """
    # Horizontal wall emphasis
    kernel_h = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        CONFIG['morph_horizontal_kernel_size']
    )
    horizontal = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_h,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Vertical wall emphasis
    kernel_v = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        CONFIG['morph_vertical_kernel_size']
    )
    vertical = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_v,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Optional: Diagonal walls (45° and 135°)
    # Create rotated kernels for inclined walls
    kernel_d1 = np.zeros((11, 11), np.uint8)
    cv2.line(kernel_d1, (0, 11), (11, 0), 255, 2)  # 45° diagonal
    kernel_d2 = np.zeros((11, 11), np.uint8)
    cv2.line(kernel_d2, (0, 0), (11, 11), 255, 2)  # 135° diagonal
    
    diagonal_45 = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_d1,
        iterations=CONFIG['morph_closing_iterations']
    )
    diagonal_135 = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_d2,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Combine all orientations
    combined = cv2.bitwise_or(horizontal, vertical)
    combined = cv2.bitwise_or(combined, diagonal_45)
    combined = cv2.bitwise_or(combined, diagonal_135)
    
    # Optional: Opening to remove small artifacts
    kernel_small = np.ones((3, 3), np.uint8)
    cleaned = cv2.morphologyEx(
        combined, cv2.MORPH_OPEN, kernel_small,
        iterations=CONFIG['morph_opening_iterations']
    )
    
    return cleaned
```

### 1.2 Run Line Segment Detection

```python
def detect_line_segments(wall_likelihood_mask):
    """
    Detect line segments from wall-likelihood mask
    
    Uses LSD (Line Segment Detector) which handles arbitrary angles
    and is more accurate than Hough transform for architectural drawings
    
    Returns:
        segments: List of line segments with:
            - start: (x1, y1)
            - end: (x2, y2)
            - length: pixel length
            - angle: orientation in radians
    """
    # Use LSD for better accuracy (already in your codebase)
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines, widths, prec, nfa = lsd.detect(wall_likelihood_mask)
    
    if lines is None or len(lines) == 0:
        return []
    
    segments = []
    for line in lines:
        # Handle different line formats from LSD
        if line.shape == (1, 4):
            x1, y1, x2, y2 = line[0]
        elif line.shape == (4,):
            x1, y1, x2, y2 = line
        else:
            coords = line.flatten()[:4]
            x1, y1, x2, y2 = coords
        
        length = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        angle = np.arctan2(y2 - y1, x2 - x1)
        
        segments.append({
            'start': (int(x1), int(y1)),
            'end': (int(x2), int(y2)),
            'length': length,
            'angle': angle
        })
    
    return segments
```

### 1.3 Filter Obvious Non-Wall Lines

```python
def filter_non_wall_segments(segments, scale_factor, ocr_text, image_shape):
    """
    Filter out obvious non-wall segments:
    - Too short (< min_wall_length)
    - In titleblock region
    - Dimension strings (near edges, near text, very long horizontal/vertical)
    - Dashed lines (low edge continuity)
    
    Returns:
        candidate_walls: Filtered list of candidate wall segments
    """
    height, width = image_shape
    min_length_px = CONFIG['min_wall_length_ft'] / scale_factor
    
    # Create text mask from OCR
    text_mask = create_text_mask(ocr_text, width, height)
    
    # Titleblock exclusion zones
    exclude_top = int(height * CONFIG['titleblock_exclude_top'])
    exclude_bottom = int(height * CONFIG['titleblock_exclude_bottom'])
    exclude_left = int(width * CONFIG['titleblock_exclude_left'])
    exclude_right = int(width * CONFIG['titleblock_exclude_right'])
    
    candidate_walls = []
    
    for seg in segments:
        x1, y1 = seg['start']
        x2, y2 = seg['end']
        length = seg['length']
        
        # Filter 1: Minimum length
        if length < min_length_px:
            continue
        
        # Filter 2: Titleblock exclusion
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        if (center_y < exclude_top or center_y > exclude_bottom or
            center_x < exclude_left or center_x > exclude_right):
            continue
        
        # Filter 3: Dimension string detection
        if is_dimension_string(seg, text_mask, width, height):
            continue
        
        # Filter 4: Dashed line detection
        if is_dashed_line(seg, wall_likelihood_mask):
            continue
        
        candidate_walls.append(seg)
    
    return candidate_walls

def is_dimension_string(segment, text_mask, width, height):
    """
    Detect if segment is likely a dimension string
    
    Dimension strings are typically:
    - Short lines near text (extension lines)
    - Very long horizontal/vertical lines near edges
    - Lines with high text intersection ratio
    """
    x1, y1 = segment['start']
    x2, y2 = segment['end']
    length = segment['length']
    
    # Check if horizontal or vertical
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    is_horizontal = dy < dx * 0.1
    is_vertical = dx < dy * 0.1
    
    # Sample points along line
    num_samples = max(10, int(length / 5))
    text_intersections = 0
    
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        x = int(x1 + t * (x2 - x1))
        y = int(y1 + t * (y2 - y1))
        if 0 <= x < width and 0 <= y < height:
            if text_mask[y, x] > 0:
                text_intersections += 1
    
    text_ratio = text_intersections / num_samples
    
    # Check edge proximity
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    edge_distance = min(center_x, center_y, width - center_x, height - center_y)
    is_near_edge = edge_distance < min(width, height) * 0.15
    
    # Dimension string criteria
    is_short = length < (CONFIG['min_wall_length_ft'] / scale_factor) * 2
    is_very_long = length > min(width, height) * 0.25
    
    if (is_short and text_ratio > 0.15) or \
       (is_near_edge and (is_horizontal or is_vertical) and text_ratio > 0.1) or \
       (is_very_long and is_near_edge and (is_horizontal or is_vertical)) or \
       (text_ratio > 0.3):
        return True
    
    return False

def is_dashed_line(segment, wall_likelihood_mask):
    """
    Detect if segment is a dashed line (not a solid wall)
    
    Dashed lines have low edge continuity
    """
    x1, y1 = segment['start']
    x2, y2 = segment['end']
    length = segment['length']
    
    # Sample points along line
    num_samples = max(20, int(length / 3))
    edge_hits = 0
    consecutive_gaps = 0
    max_consecutive_gaps = 0
    
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        x = int(x1 + t * (x2 - x1))
        y = int(y1 + t * (y2 - y1))
        
        # Check 3x3 region around point
        y_min = max(0, y - 1)
        y_max = min(wall_likelihood_mask.shape[0], y + 2)
        x_min = max(0, x - 1)
        x_max = min(wall_likelihood_mask.shape[1], x + 2)
        
        if np.any(wall_likelihood_mask[y_min:y_max, x_min:x_max] > 0):
            edge_hits += 1
            consecutive_gaps = 0
        else:
            consecutive_gaps += 1
            max_consecutive_gaps = max(max_consecutive_gaps, consecutive_gaps)
    
    edge_continuity = edge_hits / num_samples if num_samples > 0 else 0
    
    # Dashed lines have low continuity or large gaps
    if edge_continuity < 0.60 or max_consecutive_gaps > num_samples * 0.3:
        return True
    
    return False
```

### 1.4 Build Wall Graph

```python
import networkx as nx

def build_wall_graph(segments, scale_factor):
    """
    Build a graph representation of wall segments
    
    Nodes: Segment endpoints (snapped if within tolerance)
    Edges: Wall segments between nodes
    
    Steps:
    1. Create nodes from all segment endpoints
    2. Snap nearby endpoints into single nodes
    3. Merge collinear segments
    4. Compute node degrees (junctions, corners)
    5. Calculate segment confidence scores
    
    Returns:
        wall_graph: NetworkX graph with:
            - Nodes: (x, y) coordinates
            - Edges: segments with metadata (length, angle, confidence)
    """
    G = nx.Graph()
    
    # Step 1: Add all segments as edges with temporary nodes
    segment_list = []
    for seg in segments:
        node1 = (seg['start'][0], seg['start'][1])
        node2 = (seg['end'][0], seg['end'][1])
        
        # Add nodes and edge
        G.add_node(node1)
        G.add_node(node2)
        G.add_edge(node1, node2, **seg)
        
        segment_list.append((node1, node2, seg))
    
    # Step 2: Snap nearby endpoints
    G = snap_endpoints(G, CONFIG['node_snap_distance_px'])
    
    # Step 3: Merge collinear segments
    G = merge_collinear_segments(G, CONFIG['angular_tolerance_deg'], CONFIG['collinear_merge_distance_px'])
    
    # Step 4: Compute node metadata
    for node in G.nodes():
        degree = G.degree(node)
        G.nodes[node]['degree'] = degree
        G.nodes[node]['is_junction'] = degree >= 3
        G.nodes[node]['is_corner'] = degree == 2
    
    # Step 5: Calculate confidence scores
    for edge in G.edges():
        seg_data = G.edges[edge]
        confidence = compute_segment_confidence(seg_data, wall_likelihood_mask, G)
        G.edges[edge]['confidence'] = confidence
    
    return G

def snap_endpoints(graph, snap_distance):
    """
    Snap endpoints that are within snap_distance pixels
    """
    nodes = list(graph.nodes())
    node_groups = []
    used = set()
    
    for i, node1 in enumerate(nodes):
        if node1 in used:
            continue
        
        group = [node1]
        used.add(node1)
        
        for j, node2 in enumerate(nodes[i+1:], i+1):
            if node2 in used:
                continue
            
            dist = np.sqrt((node1[0] - node2[0])**2 + (node1[1] - node2[1])**2)
            if dist <= snap_distance:
                group.append(node2)
                used.add(node2)
        
        node_groups.append(group)
    
    # Create new graph with snapped nodes
    G_new = nx.Graph()
    node_mapping = {}
    
    for group in node_groups:
        # Use centroid as new node position
        center_x = sum(n[0] for n in group) / len(group)
        center_y = sum(n[1] for n in group) / len(group)
        new_node = (int(center_x), int(center_y))
        
        for old_node in group:
            node_mapping[old_node] = new_node
    
    # Add edges with mapped nodes
    for edge in graph.edges(data=True):
        node1, node2, data = edge
        new_node1 = node_mapping.get(node1, node1)
        new_node2 = node_mapping.get(node2, node2)
        
        if new_node1 != new_node2:  # Don't add self-loops
            G_new.add_edge(new_node1, new_node2, **data)
    
    return G_new

def merge_collinear_segments(graph, angle_tolerance, distance_tolerance):
    """
    Merge segments that are nearly collinear and close together
    """
    # This is a simplified version - full implementation would check
    # if segments share an endpoint and are collinear
    # For now, we'll keep segments separate but mark them as collinear
    
    G_new = graph.copy()
    
    # Mark collinear edges
    edges = list(G_new.edges(data=True))
    for i, (n1, n2, d1) in enumerate(edges):
        for j, (n3, n4, d2) in enumerate(edges[i+1:], i+1):
            if are_collinear(d1, d2, angle_tolerance, distance_tolerance):
                # Mark as collinear (could merge, but keeping separate for now)
                G_new.edges[(n1, n2)]['collinear_with'] = (n3, n4)
    
    return G_new

def are_collinear(seg1, seg2, angle_tolerance, distance_tolerance):
    """
    Check if two segments are collinear
    """
    angle1 = seg1.get('angle', 0)
    angle2 = seg2.get('angle', 0)
    
    # Normalize angles to 0-π
    angle1 = angle1 % np.pi
    angle2 = angle2 % np.pi
    
    angle_diff = abs(angle1 - angle2)
    if angle_diff > np.pi / 2:
        angle_diff = np.pi - angle_diff
    
    angle_diff_deg = angle_diff * 180 / np.pi
    
    return angle_diff_deg < angle_tolerance

def compute_segment_confidence(segment_data, wall_likelihood_mask, graph):
    """
    Compute confidence score for a wall segment
    
    Factors:
    1. Length score (normalized by typical wall length)
    2. Mask overlap score (fraction of pixels in wall-likelihood mask)
    3. Local density score (parallel/perpendicular neighbors)
    4. Structural alignment score (alignment with graph structure)
    """
    length = segment_data.get('length', 0)
    angle = segment_data.get('angle', 0)
    
    # 1. Length score
    typical_wall_length = 10.0 / scale_factor  # 10 feet typical
    length_score = min(1.0, length / typical_wall_length)
    
    # 2. Mask overlap score (would need to sample along segment)
    # Simplified: assume high if segment was detected
    mask_overlap_score = 0.8  # Placeholder - would calculate from mask
    
    # 3. Local density score
    # Count parallel/perpendicular neighbors
    parallel_count = 0
    for edge in graph.edges(data=True):
        if edge[0:2] == (segment_data['start'], segment_data['end']):
            continue
        other_angle = edge[2].get('angle', 0)
        angle_diff = abs(angle - other_angle) % np.pi
        if angle_diff < np.pi / 6 or angle_diff > 5 * np.pi / 6:  # Parallel
            parallel_count += 1
        elif abs(angle_diff - np.pi / 2) < np.pi / 6:  # Perpendicular
            parallel_count += 0.5
    
    density_score = min(1.0, parallel_count / 5.0)
    
    # 4. Structural alignment (node degree, connectivity)
    structural_score = 1.0  # Placeholder
    
    # Combine scores
    weights = CONFIG['confidence_weights']
    confidence = (
        weights['length'] * length_score +
        weights['mask_overlap'] * mask_overlap_score +
        weights['local_density'] * density_score +
        weights['structural_alignment'] * structural_score
    )
    
    return min(1.0, max(0.0, confidence))
```

---

## Phase 2: Wall Mask Generation and Room Seeds

### 2.1 Render Wall Mask

```python
def render_wall_mask(wall_graph, image_shape, scale_factor):
    """
    Create a binary mask of walls from the wall graph
    
    Steps:
    1. Create blank binary mask
    2. Draw each wall segment with thickness approximating wall thickness
    3. Optionally vary thickness with confidence
    4. Dilate slightly to close tiny gaps
    
    Returns:
        wall_mask: Binary image (255 = wall, 0 = free space)
    """
    height, width = image_shape
    wall_mask = np.zeros((height, width), dtype=np.uint8)
    
    # Calculate wall thickness in pixels
    min_thickness_ft, max_thickness_ft = CONFIG['wall_thickness_ft_range']
    avg_thickness_ft = (min_thickness_ft + max_thickness_ft) / 2
    wall_thickness_px = int(avg_thickness_ft / scale_factor)
    wall_thickness_px = max(2, min(wall_thickness_px, 10))  # Clamp 2-10 pixels
    
    # Draw each edge in the graph
    for edge in wall_graph.edges(data=True):
        node1, node2, data = edge
        x1, y1 = node1
        x2, y2 = node2
        
        # Adjust thickness based on confidence
        confidence = data.get('confidence', 0.7)
        thickness = int(wall_thickness_px * (0.5 + 0.5 * confidence))
        
        cv2.line(wall_mask, (x1, y1), (x2, y2), 255, thickness)
    
    # Dilate slightly to close gaps
    kernel = np.ones((3, 3), np.uint8)
    wall_mask = cv2.dilate(wall_mask, kernel, iterations=1)
    
    return wall_mask
```

### 2.2 Generate Distance Transform

```python
def generate_distance_transform(wall_mask):
    """
    Compute distance transform on inverse of wall mask
    
    This gives, for each pixel, the distance to the nearest wall.
    Useful for placing room seeds in the center of open spaces.
    
    Returns:
        distance_transform: Distance map (higher values = farther from walls)
    """
    # Invert mask (walls = 0, free space = 255)
    free_space = 255 - wall_mask
    
    # Distance transform
    dist_transform = cv2.distanceTransform(free_space, cv2.DIST_L2, 5)
    
    return dist_transform
```

### 2.3 Prepare Room Label Seeds

```python
def prepare_room_seeds(ocr_text, wall_mask, distance_transform):
    """
    Prepare seed points for room detection from OCR room labels
    
    Steps:
    1. Extract room labels from OCR text
    2. For each label, determine seed point:
       - If bbox is in free space, use center
       - If bbox intersects walls, find max distance transform value in bbox
    3. Validate seed is in free space
    
    Returns:
        room_seeds: List of {
            'seed_id': int,
            'position': (x, y),
            'text_label': str,
            'bbox': (x, y, w, h),
            'confidence': float
        }
    """
    height, width = wall_mask.shape
    room_seeds = []
    
    # Filter OCR text for room labels
    room_labels = [text for text in ocr_text if text.get('type') == 'room_label']
    
    for i, label in enumerate(room_labels):
        bbox = label.get('bbox', {})
        label_text = label.get('text', '')
        
        # Convert normalized bbox to pixel coordinates
        x_norm = bbox.get('x', 0)
        y_norm = bbox.get('y', 0)
        w_norm = bbox.get('width', 0)
        h_norm = bbox.get('height', 0)
        
        x_px = int(x_norm * width)
        y_px = int(y_norm * height)
        w_px = int(w_norm * width)
        h_px = int(h_norm * height)
        
        # Check if bbox center is in free space
        center_x = x_px + w_px // 2
        center_y = y_px + h_px // 2
        
        if 0 <= center_x < width and 0 <= center_y < height:
            if wall_mask[center_y, center_x] == 0:  # Free space
                seed_x, seed_y = center_x, center_y
            else:
                # Find max distance transform value in bbox
                bbox_roi = distance_transform[
                    max(0, y_px):min(height, y_px + h_px),
                    max(0, x_px):min(width, x_px + w_px)
                ]
                
                if bbox_roi.size > 0:
                    max_val = np.max(bbox_roi)
                    max_pos = np.unravel_index(np.argmax(bbox_roi), bbox_roi.shape)
                    seed_x = x_px + max_pos[1]
                    seed_y = y_px + max_pos[0]
                else:
                    continue  # Skip invalid bbox
        else:
            continue  # Skip out-of-bounds
        
        # Validate seed is in free space
        if 0 <= seed_x < width and 0 <= seed_y < height:
            if wall_mask[seed_y, seed_x] == 0:
                room_seeds.append({
                    'seed_id': i,
                    'position': (seed_x, seed_y),
                    'text_label': label_text,
                    'bbox': (x_px, y_px, w_px, h_px),
                    'confidence': label.get('confidence', 0.7)
                })
    
    return room_seeds
```

---

## Phase 3: Room Extraction via Constrained Flood Fill

### 3.1 Constrained Flood Fill

```python
def extract_rooms_constrained_flood_fill(room_seeds, wall_mask, scale_factor):
    """
    Extract room polygons using constrained flood fill
    
    Steps:
    1. For each seed, run flood fill on free-space mask
    2. Stop at wall pixels (hard barrier)
    3. Optional: Stop at max radius (safety)
    4. Convert filled region to contour polygon
    5. Calculate area and perimeter
    
    Returns:
        rooms: List of {
            'room_id': int,
            'label_text': str,
            'polygon': [(x, y), ...],
            'area_sf': float,
            'perimeter_lf': float,
            'confidence': float
        }
    """
    height, width = wall_mask.shape
    free_space_mask = 255 - wall_mask  # Invert: free space = 255
    
    rooms = []
    min_area_px = CONFIG['min_room_area_sf'] / (scale_factor ** 2)
    max_area_px = CONFIG['max_room_area_sf'] / (scale_factor ** 2)
    
    for seed in room_seeds:
        seed_x, seed_y = seed['position']
        
        # Create mask for flood fill
        fill_mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
        
        # Flood fill parameters
        lo_diff = (20, 20, 20)
        up_diff = (20, 20, 20)
        flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY
        
        # Create image copy for flood fill
        img_copy = free_space_mask.copy().astype(np.uint8)
        
        try:
            # Perform flood fill
            _, img_copy, fill_mask, rect = cv2.floodFill(
                img_copy, fill_mask, (seed_x + 1, seed_y + 1), 255,
                loDiff=lo_diff, upDiff=up_diff, flags=flags
            )
            
            # Remove border padding
            fill_mask = fill_mask[1:-1, 1:-1]
            
            # Find contours in filled region
            contours, _ = cv2.findContours(fill_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                continue
            
            # Get largest contour
            largest_contour = max(contours, key=cv2.contourArea)
            area_px = cv2.contourArea(largest_contour)
            
            # Validate area
            if area_px < min_area_px or area_px > max_area_px:
                continue
            
            # Simplify contour
            epsilon = 0.02 * cv2.arcLength(largest_contour, True)
            approx = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            if len(approx) < 3:
                continue
            
            # Convert to normalized coordinates
            polygon = []
            for point in approx:
                x_norm = float(point[0][0]) / width
                y_norm = float(point[0][1]) / height
                polygon.append({'x': x_norm, 'y': y_norm})
            
            # Calculate area and perimeter
            area_sf = area_px * (scale_factor ** 2)
            perimeter_px = cv2.arcLength(largest_contour, True)
            perimeter_lf = perimeter_px * scale_factor
            
            rooms.append({
                'room_id': seed['seed_id'],
                'label_text': seed['text_label'],
                'polygon': polygon,
                'area_sf': round(area_sf, 2),
                'perimeter_lf': round(perimeter_lf, 2),
                'confidence': seed['confidence']
            })
            
        except Exception as e:
            print(f"Flood fill error for seed {seed['seed_id']}: {e}", file=sys.stderr)
            continue
    
    return rooms
```

### 3.2 Room Validation

```python
def validate_rooms(rooms, wall_mask, wall_graph):
    """
    Validate detected rooms
    
    Checks:
    1. Enclosure: Boundary mostly adjacent to walls
    2. Area and shape: Within reasonable limits
    3. Perimeter-to-area ratio: Filter corridors
    4. Label alignment: Room contains label bbox
    
    Returns:
        validated_rooms: List with validation flags
    """
    validated_rooms = []
    
    for room in rooms:
        polygon = room['polygon']
        area_sf = room['area_sf']
        perimeter_lf = room['perimeter_lf']
        
        # Convert polygon to pixel coordinates for validation
        height, width = wall_mask.shape
        polygon_px = [
            (int(p['x'] * width), int(p['y'] * height))
            for p in polygon
        ]
        
        # 1. Enclosure check
        enclosure_score = check_enclosure(polygon_px, wall_mask)
        
        # 2. Area and shape checks
        aspect_ratio = calculate_aspect_ratio(polygon_px)
        perimeter_area_ratio = perimeter_lf / area_sf if area_sf > 0 else 0
        
        # 3. Classify room type
        is_corridor = (
            aspect_ratio > CONFIG['corridor_aspect_ratio_threshold'] or
            perimeter_area_ratio > CONFIG['corridor_perimeter_area_ratio_threshold']
        )
        
        is_open_space = enclosure_score < 0.5  # Less than 50% enclosed
        
        # 4. Label alignment (would need original bbox)
        label_aligned = True  # Placeholder
        
        # Validation flags
        room['valid_enclosed_room'] = enclosure_score > 0.7 and not is_corridor
        room['valid_open_space_room'] = is_open_space and not is_corridor
        room['corridor_like_region'] = is_corridor
        room['invalid_region'] = not (room['valid_enclosed_room'] or room['valid_open_space_room'] or room['corridor_like_region'])
        room['enclosure_score'] = enclosure_score
        room['aspect_ratio'] = aspect_ratio
        
        validated_rooms.append(room)
    
    return validated_rooms

def check_enclosure(polygon_px, wall_mask):
    """
    Check that room boundary is mostly adjacent to walls
    
    Returns: Score 0-1 (1 = fully enclosed)
    """
    # Sample points along polygon boundary
    boundary_points = []
    for i in range(len(polygon_px)):
        p1 = polygon_px[i]
        p2 = polygon_px[(i + 1) % len(polygon_px)]
        
        # Sample points along edge
        num_samples = max(5, int(np.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2) / 5))
        for j in range(num_samples):
            t = j / num_samples
            x = int(p1[0] + t * (p2[0] - p1[0]))
            y = int(p1[1] + t * (p2[1] - p1[1]))
            boundary_points.append((x, y))
    
    # Check how many boundary points are near walls
    wall_adjacent_count = 0
    search_radius = 5
    
    height, width = wall_mask.shape
    for x, y in boundary_points:
        if 0 <= x < width and 0 <= y < height:
            y_min = max(0, y - search_radius)
            y_max = min(height, y + search_radius + 1)
            x_min = max(0, x - search_radius)
            x_max = min(width, x + search_radius + 1)
            
            if np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                wall_adjacent_count += 1
    
    enclosure_score = wall_adjacent_count / len(boundary_points) if boundary_points else 0
    return enclosure_score

def calculate_aspect_ratio(polygon_px):
    """
    Calculate aspect ratio of room polygon
    """
    if len(polygon_px) < 3:
        return 0
    
    # Get bounding box
    xs = [p[0] for p in polygon_px]
    ys = [p[1] for p in polygon_px]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    
    if min(w, h) == 0:
        return 0
    
    return max(w, h) / min(w, h)
```

### 3.3 Room Type Classification

```python
def classify_room_types(rooms, ocr_text):
    """
    Classify room types from labels and context
    
    Returns rooms with 'room_type' field added
    """
    room_type_keywords = {
        'living_room': ['living', 'lr', 'family', 'great room'],
        'bedroom': ['bedroom', 'br', 'master', 'guest'],
        'kitchen': ['kitchen', 'kt', 'cooking'],
        'bathroom': ['bath', 'ba', 'wc', 'toilet', 'lavatory'],
        'dining_room': ['dining', 'dr', 'eat'],
        'office': ['office', 'of', 'study', 'den'],
        'closet': ['closet', 'cl', 'storage'],
        'hallway': ['hall', 'hallway', 'corridor'],
        'balcony': ['balcony', 'deck', 'patio'],
        'garage': ['garage', 'gar'],
        'utility': ['utility', 'laundry', 'mechanical']
    }
    
    for room in rooms:
        label_lower = room['label_text'].lower()
        room_type = 'other'
        confidence = 0.5
        
        for type_name, keywords in room_type_keywords.items():
            for keyword in keywords:
                if keyword in label_lower:
                    room_type = type_name
                    confidence = 0.9
                    break
            if room_type != 'other':
                break
        
        # Special case: open kitchen
        if room_type == 'kitchen' and room.get('enclosure_score', 1.0) < 0.5:
            room_type = 'open_kitchen'
            confidence = 0.8
        
        room['room_type'] = room_type
        room['type_confidence'] = confidence
    
    return rooms
```

### 3.4 Adjacency and Topology

```python
def compute_room_adjacency(rooms, wall_graph):
    """
    Compute adjacency graph of rooms
    
    Two rooms are adjacent if:
    - Their polygons share a boundary segment
    - They are separated by a thin wall segment
    
    Returns rooms with 'adjacent_rooms' field added
    """
    for i, room1 in enumerate(rooms):
        adjacent = []
        
        for j, room2 in enumerate(rooms):
            if i == j:
                continue
            
            # Check if polygons are adjacent
            if are_rooms_adjacent(room1, room2, wall_graph):
                adjacent.append(j)
        
        room1['adjacent_rooms'] = adjacent
    
    return rooms

def are_rooms_adjacent(room1, room2, wall_graph):
    """
    Check if two rooms are adjacent
    
    Simplified: Check if polygons are close and separated by a wall
    """
    # Get polygon bounding boxes
    poly1 = room1['polygon']
    poly2 = room2['polygon']
    
    # Check if bounding boxes overlap or are close
    # (Full implementation would check actual polygon intersection)
    
    # For now, use simplified distance check
    center1_x = sum(p['x'] for p in poly1) / len(poly1)
    center1_y = sum(p['y'] for p in poly1) / len(poly1)
    center2_x = sum(p['x'] for p in poly2) / len(poly2)
    center2_y = sum(p['y'] for p in poly2) / len(poly2)
    
    distance = np.sqrt((center1_x - center2_x)**2 + (center1_y - center2_y)**2)
    
    # Rooms are adjacent if close (within 0.1 normalized units)
    return distance < 0.1
```

---

## Phase 4: Wall Refinement with Room Feedback

### 4.1 Close Gaps Using Rooms

```python
def close_wall_gaps_from_rooms(rooms, wall_graph, wall_mask, wall_likelihood_mask):
    """
    Use room polygons to identify and close gaps in walls
    
    Steps:
    1. For each "almost enclosed" room, find boundary gaps
    2. Search for nearby low-confidence segments that could close gaps
    3. Promote segments if they align geometrically
    4. Update wall graph and mask
    """
    height, width = wall_mask.shape
    
    for room in rooms:
        if room.get('enclosure_score', 1.0) < 0.7 and room.get('enclosure_score', 0) > 0.3:
            # Room is "almost enclosed" - look for gaps
            
            polygon_px = [
                (int(p['x'] * width), int(p['y'] * height))
                for p in room['polygon']
            ]
            
            # Find boundary arcs with gaps
            gaps = find_boundary_gaps(polygon_px, wall_mask)
            
            for gap in gaps:
                # Search for segments that could close this gap
                candidate_segments = find_gap_closing_segments(
                    gap, wall_graph, wall_likelihood_mask
                )
                
                for seg in candidate_segments:
                    # Promote segment confidence
                    if seg['confidence'] < 0.5:
                        seg['confidence'] = 0.7
                        # Update graph edge
                        # (Implementation would update graph edge confidence)
    
    # Re-render wall mask with updated segments
    wall_mask = render_wall_mask(wall_graph, (height, width), scale_factor)
    
    return wall_graph, wall_mask

def find_boundary_gaps(polygon_px, wall_mask):
    """
    Find gaps in room boundary where walls should be
    
    Returns list of gap segments
    """
    gaps = []
    search_radius = 10
    
    for i in range(len(polygon_px)):
        p1 = polygon_px[i]
        p2 = polygon_px[(i + 1) % len(polygon_px)]
        
        # Sample points along edge
        num_samples = max(10, int(np.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2) / 5))
        gap_points = []
        
        for j in range(num_samples):
            t = j / num_samples
            x = int(p1[0] + t * (p2[0] - p1[0]))
            y = int(p1[1] + t * (p2[1] - p1[1]))
            
            # Check if point is near a wall
            y_min = max(0, y - search_radius)
            y_max = min(wall_mask.shape[0], y + search_radius + 1)
            x_min = max(0, x - search_radius)
            x_max = min(wall_mask.shape[1], x + search_radius + 1)
            
            if not np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                gap_points.append((x, y))
        
        if len(gap_points) > num_samples * 0.3:  # More than 30% is gap
            gaps.append({
                'start': p1,
                'end': p2,
                'gap_points': gap_points
            })
    
    return gaps

def find_gap_closing_segments(gap, wall_graph, wall_likelihood_mask):
    """
    Find low-confidence segments that could close a gap
    
    Returns candidate segments
    """
    candidates = []
    
    # Search for segments near gap
    gap_center_x = (gap['start'][0] + gap['end'][0]) / 2
    gap_center_y = (gap['start'][1] + gap['end'][1]) / 2
    
    for edge in wall_graph.edges(data=True):
        node1, node2, data = edge
        x1, y1 = node1
        x2, y2 = node2
        
        # Check if segment is near gap
        seg_center_x = (x1 + x2) / 2
        seg_center_y = (y1 + y2) / 2
        
        distance = np.sqrt((gap_center_x - seg_center_x)**2 + (gap_center_y - seg_center_y)**2)
        
        if distance < 50 and data.get('confidence', 1.0) < 0.5:
            # Check if segment aligns with gap direction
            gap_angle = np.arctan2(gap['end'][1] - gap['start'][1], gap['end'][0] - gap['start'][0])
            seg_angle = data.get('angle', 0)
            
            angle_diff = abs(gap_angle - seg_angle) % np.pi
            if angle_diff < np.pi / 6 or angle_diff > 5 * np.pi / 6:  # Within 30°
                candidates.append({
                    'edge': (node1, node2),
                    'data': data,
                    'confidence': data.get('confidence', 0.3)
                })
    
    return candidates
```

### 4.2 Remove Spurious Walls

```python
def remove_spurious_walls(wall_graph, rooms):
    """
    Remove walls that don't support any room boundary
    
    Steps:
    1. For each wall segment, check if it's near any room boundary
    2. If isolated and far from rooms, mark as non-structural
    3. Remove from graph (or mark with low confidence)
    """
    # Create room mask
    room_mask = np.zeros((height, width), dtype=np.uint8)
    for room in rooms:
        polygon_px = [
            (int(p['x'] * width), int(p['y'] * height))
            for p in room['polygon']
        ]
        cv2.fillPoly(room_mask, [np.array(polygon_px, dtype=np.int32)], 255)
    
    # Dilate room mask to include nearby regions
    kernel = np.ones((20, 20), np.uint8)
    room_mask_dilated = cv2.dilate(room_mask, kernel, iterations=1)
    
    # Check each wall segment
    edges_to_remove = []
    
    for edge in wall_graph.edges(data=True):
        node1, node2, data = edge
        x1, y1 = node1
        x2, y2 = node2
        
        # Check if segment is near any room
        center_x = int((x1 + x2) / 2)
        center_y = int((y1 + y2) / 2)
        
        if 0 <= center_x < width and 0 <= center_y < height:
            if room_mask_dilated[center_y, center_x] == 0:
                # Segment is far from rooms
                # Check if it's isolated (few connections)
                degree1 = wall_graph.degree(node1)
                degree2 = wall_graph.degree(node2)
                
                if degree1 <= 2 and degree2 <= 2 and data.get('confidence', 1.0) < 0.4:
                    edges_to_remove.append((node1, node2))
    
    # Remove spurious walls
    for edge in edges_to_remove:
        wall_graph.remove_edge(*edge)
    
    return wall_graph
```

### 4.3 Wall Pairing and Thickness Estimation

```python
def estimate_wall_thickness(wall_graph, wall_likelihood_mask, scale_factor):
    """
    Estimate wall thickness by finding parallel edge pairs
    
    Steps:
    1. For each wall centerline, sample intensity on both sides
    2. Look for parallel edges at constant distance
    3. Estimate thickness from edge pair distance
    4. Create paired wall records
    
    Returns wall_graph with thickness estimates
    """
    min_thickness_ft, max_thickness_ft = CONFIG['wall_thickness_ft_range']
    min_thickness_px = min_thickness_ft / scale_factor
    max_thickness_px = max_thickness_ft / scale_factor
    
    # Group parallel segments
    parallel_groups = group_parallel_segments(wall_graph, CONFIG['parallel_angle_tolerance_deg'])
    
    for group in parallel_groups:
        if len(group) >= 2:
            # Find pairs with appropriate spacing
            pairs = find_wall_pairs(group, min_thickness_px, max_thickness_px)
            
            for pair in pairs:
                seg1, seg2 = pair
                thickness_px = calculate_pair_distance(seg1, seg2)
                thickness_ft = thickness_px * scale_factor
                
                # Update graph edges with thickness
                # (Implementation would update edge metadata)
    
    return wall_graph

def group_parallel_segments(wall_graph, angle_tolerance):
    """
    Group segments that are parallel
    """
    groups = []
    used_edges = set()
    
    for edge1 in wall_graph.edges(data=True):
        if edge1 in used_edges:
            continue
        
        group = [edge1]
        used_edges.add(edge1)
        angle1 = edge1[2].get('angle', 0)
        
        for edge2 in wall_graph.edges(data=True):
            if edge2 in used_edges:
                continue
            
            angle2 = edge2[2].get('angle', 0)
            angle_diff = abs(angle1 - angle2) % np.pi
            if angle_diff < np.radians(angle_tolerance) or angle_diff > np.pi - np.radians(angle_tolerance):
                group.append(edge2)
                used_edges.add(edge2)
        
        if len(group) > 1:
            groups.append(group)
    
    return groups

def find_wall_pairs(parallel_group, min_thickness_px, max_thickness_px):
    """
    Find pairs of parallel segments with appropriate spacing
    """
    pairs = []
    
    for i, seg1 in enumerate(parallel_group):
        for j, seg2 in enumerate(parallel_group[i+1:], i+1):
            distance = calculate_pair_distance(seg1, seg2)
            
            if min_thickness_px <= distance <= max_thickness_px:
                pairs.append((seg1, seg2))
    
    return pairs

def calculate_pair_distance(seg1, seg2):
    """
    Calculate perpendicular distance between two parallel segments
    """
    # Get points from segments
    node1_1, node1_2, _ = seg1
    node2_1, node2_2, _ = seg2
    
    x1, y1 = node1_1
    x2, y2 = node1_2
    x3, y3 = node2_1
    
    # Direction vector of first line
    dx = x2 - x1
    dy = y2 - y1
    dir_norm = np.sqrt(dx*dx + dy*dy)
    
    if dir_norm == 0:
        return float('inf')
    
    # Perpendicular distance from point on line2 to line1
    perp_dist = abs((y3 - y1) * dx - (x3 - x1) * dy) / dir_norm
    
    return perp_dist
```

---

## Phase 5: Corridor and Open Space Handling

### 5.1 Corridor Detection

```python
def detect_corridors(rooms):
    """
    Detect and classify corridors
    
    Corridors have:
    - High aspect ratio (> threshold)
    - High perimeter-to-area ratio (> threshold)
    
    Returns rooms with corridor classification
    """
    for room in rooms:
        aspect_ratio = room.get('aspect_ratio', 0)
        perimeter_lf = room.get('perimeter_lf', 0)
        area_sf = room.get('area_sf', 1)
        perimeter_area_ratio = perimeter_lf / area_sf if area_sf > 0 else 0
        
        is_corridor = (
            aspect_ratio > CONFIG['corridor_aspect_ratio_threshold'] or
            perimeter_area_ratio > CONFIG['corridor_perimeter_area_ratio_threshold']
        )
        
        if is_corridor:
            room['room_type'] = 'corridor'
            room['corridor_like_region'] = True
    
    return rooms
```

### 5.2 Open-Plan Zone Handling

```python
def handle_open_plan_zones(rooms, ocr_text):
    """
    Handle open-plan spaces where multiple labels fall in one region
    
    Steps:
    1. Detect large regions with multiple labels
    2. Partition using soft boundaries (partial walls, furniture)
    3. Create sub-polygons for each semantic zone
    
    Returns rooms with open-plan partitioning
    """
    # Group rooms by spatial proximity
    room_groups = []
    used = set()
    
    for i, room1 in enumerate(rooms):
        if i in used:
            continue
        
        group = [i]
        used.add(i)
        
        for j, room2 in enumerate(rooms[i+1:], i+1):
            if j in used:
                continue
            
            # Check if rooms overlap significantly
            if rooms_overlap(room1, room2, overlap_threshold=0.5):
                group.append(j)
                used.add(j)
        
        if len(group) > 1:
            room_groups.append(group)
    
    # For each group, try to partition
    for group_indices in room_groups:
        group_rooms = [rooms[i] for i in group_indices]
        
        # Check if it's an open-plan space
        if is_open_plan_space(group_rooms):
            # Partition using soft boundaries
            partitioned = partition_open_plan(group_rooms, wall_graph)
            
            # Update rooms with partitioned polygons
            for i, partitioned_room in enumerate(partitioned):
                rooms[group_indices[i]] = partitioned_room
    
    return rooms

def rooms_overlap(room1, room2, overlap_threshold=0.5):
    """
    Check if two rooms overlap significantly
    """
    # Simplified: Check bounding box overlap
    poly1 = room1['polygon']
    poly2 = room2['polygon']
    
    # Get bounding boxes
    x1_min = min(p['x'] for p in poly1)
    x1_max = max(p['x'] for p in poly1)
    y1_min = min(p['y'] for p in poly1)
    y1_max = max(p['y'] for p in poly1)
    
    x2_min = min(p['x'] for p in poly2)
    x2_max = max(p['x'] for p in poly2)
    y2_min = min(p['y'] for p in poly2)
    y2_max = max(p['y'] for p in poly2)
    
    # Calculate overlap
    overlap_x = max(0, min(x1_max, x2_max) - max(x1_min, x2_min))
    overlap_y = max(0, min(y1_max, y2_max) - max(y1_min, y2_min))
    overlap_area = overlap_x * overlap_y
    
    area1 = (x1_max - x1_min) * (y1_max - y1_min)
    area2 = (x2_max - x2_min) * (y2_max - y2_min)
    min_area = min(area1, area2)
    
    overlap_ratio = overlap_area / min_area if min_area > 0 else 0
    
    return overlap_ratio > overlap_threshold

def is_open_plan_space(rooms):
    """
    Check if group of rooms forms an open-plan space
    """
    if len(rooms) < 2:
        return False
    
    # Check if rooms have low enclosure scores
    avg_enclosure = sum(r.get('enclosure_score', 1.0) for r in rooms) / len(rooms)
    
    return avg_enclosure < 0.5

def partition_open_plan(rooms, wall_graph):
    """
    Partition open-plan space into semantic zones
    
    Simplified: Use label positions and partial walls
    """
    # For now, return rooms as-is
    # Full implementation would use Voronoi diagrams or other partitioning
    return rooms
```

---

## Phase 6: Integration with Condition Markups and Takeoff

### 6.1 Wall Conditions

```python
def create_wall_conditions(wall_graph, project_id, document_id, page_number, scale_factor):
    """
    Generate wall conditions from wall graph
    
    Returns:
        conditions: List of condition records
        measurements: List of measurement records
    """
    conditions = []
    measurements = []
    
    # Group walls by type (interior/exterior) or keep as single condition
    wall_condition = {
        'name': 'Walls',
        'type': 'linear',
        'unit': 'LF',
        'color': '#2196F3'
    }
    conditions.append(wall_condition)
    
    # Create measurements for each wall segment
    for edge in wall_graph.edges(data=True):
        node1, node2, data = edge
        x1, y1 = node1
        x2, y2 = node2
        
        # Convert to normalized coordinates
        # (Assuming image dimensions are known)
        length_lf = data.get('length', 0) * scale_factor
        
        measurement = {
            'condition_index': 0,
            'points': [
                {'x': x1_norm, 'y': y1_norm},
                {'x': x2_norm, 'y': y2_norm}
            ],
            'calculated_value': length_lf,
            'metadata': {
                'thickness': data.get('thickness', None),
                'confidence': data.get('confidence', 0.7)
            }
        }
        measurements.append(measurement)
    
    return conditions, measurements
```

### 6.2 Room Conditions

```python
def create_room_conditions(rooms, project_id, document_id, page_number):
    """
    Generate room conditions from detected rooms
    
    Returns:
        conditions: List of condition records (grouped by type)
        measurements: List of measurement records
    """
    conditions = []
    measurements = []
    
    # Group rooms by type
    rooms_by_type = {}
    for room in rooms:
        room_type = room.get('room_type', 'other')
        if room_type not in rooms_by_type:
            rooms_by_type[room_type] = []
        rooms_by_type[room_type].append(room)
    
    # Create condition for each room type
    condition_index = 0
    for room_type, type_rooms in rooms_by_type.items():
        condition = {
            'name': f'Rooms - {room_type.replace("_", " ").title()}',
            'type': 'area',
            'unit': 'SF',
            'color': get_room_type_color(room_type)
        }
        conditions.append(condition)
        
        # Create measurements for each room
        for room in type_rooms:
            measurement = {
                'condition_index': condition_index,
                'points': room['polygon'],
                'calculated_value': room['area_sf'],
                'metadata': {
                    'label': room.get('label_text', ''),
                    'perimeter': room.get('perimeter_lf', 0),
                    'room_type': room_type,
                    'confidence': room.get('confidence', 0.7)
                }
            }
            measurements.append(measurement)
        
        condition_index += 1
    
    return conditions, measurements

def get_room_type_color(room_type):
    """
    Get color for room type
    """
    colors = {
        'living_room': '#4CAF50',
        'bedroom': '#2196F3',
        'kitchen': '#FF9800',
        'bathroom': '#9C27B0',
        'dining_room': '#F44336',
        'office': '#00BCD4',
        'corridor': '#795548',
        'other': '#9E9E9E'
    }
    return colors.get(room_type, '#9E9E9E')
```

### 6.3 Data Export

```python
def export_takeoff_data(wall_graph, rooms):
    """
    Export structured data for downstream workflows
    
    Returns JSON structure
    """
    # Convert wall graph to serializable format
    walls_data = {
        'nodes': [
            {'id': i, 'x': node[0], 'y': node[1], 'degree': wall_graph.nodes[node].get('degree', 0)}
            for i, node in enumerate(wall_graph.nodes())
        ],
        'edges': [
            {
                'node_a': list(wall_graph.nodes()).index(edge[0]),
                'node_b': list(wall_graph.nodes()).index(edge[1]),
                'length': edge[2].get('length', 0),
                'angle': edge[2].get('angle', 0),
                'thickness': edge[2].get('thickness', None),
                'confidence': edge[2].get('confidence', 0.7)
            }
            for edge in wall_graph.edges(data=True)
        ]
    }
    
    rooms_data = [
        {
            'id': room.get('room_id', i),
            'label': room.get('label_text', ''),
            'type': room.get('room_type', 'other'),
            'polygon': room['polygon'],
            'area_sf': room['area_sf'],
            'perimeter_lf': room.get('perimeter_lf', 0),
            'adjacent_rooms': room.get('adjacent_rooms', []),
            'confidence': room.get('confidence', 0.7)
        }
        for i, room in enumerate(rooms)
    ]
    
    return {
        'walls': walls_data,
        'rooms': rooms_data,
        'metadata': {
            'scale_factor': scale_factor,
            'processing_timestamp': datetime.now().isoformat()
        }
    }
```

---

## Phase 7: Learning from User Feedback (Optional - Future Enhancement)

### 7.1 Capture Corrections

```python
def capture_user_corrections(original_detection, user_corrections):
    """
    Capture user corrections for future training
    
    Store:
        - Input image region
        - Original detection (walls/rooms)
        - User-corrected geometry
        - Metadata (confidence, room type, etc.)
    """
    correction_record = {
        'timestamp': datetime.now().isoformat(),
        'original': original_detection,
        'corrected': user_corrections,
        'image_region': None,  # Would store image patch
        'metadata': {
            'user_id': None,
            'project_id': None,
            'page_number': None
        }
    }
    
    # Store in database or file system for future training
    # (Implementation would save to training dataset)
    
    return correction_record
```

### 7.2 Lightweight Wall Classifier (Future)

```python
# Future implementation - would use a small CNN or patch classifier
# For now, this is a placeholder

def train_wall_classifier(training_data):
    """
    Train a lightweight wall classifier from user corrections
    
    Input: Image patches (e.g., 32x32 or 64x64)
    Output: Wall vs non-wall probability
    
    Would use:
    - TensorFlow Lite or PyTorch (free)
    - Pre-trained models (free, e.g., MobileNet)
    - Fine-tune on collected corrections
    """
    pass  # Placeholder for future implementation
```

---

## Implementation Checklist

### Phase 0: Configuration ✅
- [ ] Add NetworkX dependency to requirements.txt
- [ ] Create configuration constants
- [ ] Implement preprocessing pipeline
- [ ] Test with various DPI settings

### Phase 1: Wall Graph ✅
- [ ] Implement wall-likelihood mask generation
- [ ] Implement line segment detection (LSD)
- [ ] Implement non-wall filtering
- [ ] Implement wall graph building with NetworkX
- [ ] Implement confidence scoring
- [ ] Test on sample floor plans

### Phase 2: Wall Mask & Seeds ✅
- [ ] Implement wall mask rendering
- [ ] Implement distance transform
- [ ] Implement room seed preparation
- [ ] Test seed placement accuracy

### Phase 3: Room Extraction ✅
- [ ] Implement constrained flood fill
- [ ] Implement room validation
- [ ] Implement room type classification
- [ ] Implement adjacency computation
- [ ] Test on various room layouts

### Phase 4: Wall Refinement ✅
- [ ] Implement gap closing from rooms
- [ ] Implement spurious wall removal
- [ ] Implement wall pairing and thickness estimation
- [ ] Test refinement accuracy

### Phase 5: Corridor/Open Space ✅
- [ ] Implement corridor detection
- [ ] Implement open-plan zone handling
- [ ] Test on complex layouts

### Phase 6: Integration ✅
- [ ] Implement wall condition creation
- [ ] Implement room condition creation
- [ ] Implement data export
- [ ] Test end-to-end workflow

### Phase 7: Learning (Optional) ✅
- [ ] Design correction capture system
- [ ] Plan future ML integration
- [ ] (Defer actual training for now)

---

## Dependencies Summary

### Required (All Free):
```bash
pip3 install opencv-python numpy networkx pytesseract Pillow
```

### Already Installed:
- OpenCV ✅
- NumPy ✅
- PyTesseract ✅
- Pillow ✅

### To Add:
- NetworkX (for graph structure) - **FREE**

### No Subscriptions or Paid Services Required! 🎉

---

## Next Steps

1. **Start with Phase 0 & 1**: Get configuration and wall graph working
2. **Test incrementally**: Test each phase before moving to next
3. **Reference the paper**: Use paper's mathematical details for optimization
4. **Iterate**: Refine parameters based on real floor plan testing

This plan uses **100% open-source tools** and requires **no subscriptions or paid models**. All dependencies are free and can be installed via pip.

