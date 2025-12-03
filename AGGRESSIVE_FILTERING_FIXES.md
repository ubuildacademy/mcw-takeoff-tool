# Aggressive Filtering Fixes Applied

## Problem
Phase 4 didn't improve results - still getting messy and inaccurate CV takeoff with many false positives.

## Root Cause Analysis
The issue is likely in **Phase 1** - too many false positive walls are being detected initially, and Phase 4 can't fix fundamentally wrong detections. The filtering wasn't aggressive enough.

## Fixes Applied

### 1. Stricter Wall Detection Parameters
- **min_wall_length_ft**: Increased from 1.0 to 2.0 feet
- **min_wall_confidence**: Added threshold of 0.5 (filter out low-confidence walls)
- **Length filtering**: Now requires 1.5x minimum length in filter function
- **Edge margin check**: Filter out segments too close to image edges (likely dimension lines)

### 2. Stricter Room Detection Parameters
- **min_room_area_sf**: Increased from 50.0 to 75.0 square feet
- **max_room_area_sf**: Reduced from 1000.0 to 800.0 square feet
- **min_room_confidence**: Added threshold of 0.6 (filter out low-confidence rooms)

### 3. Improved Confidence Scoring
- **Better length scoring**: Penalizes short segments more aggressively
- **Actual mask overlap**: Calculates real overlap with wall-likelihood mask (not placeholder)
- **Connection-based scoring**: Rewards walls with parallel/perpendicular connections
- **Structural alignment**: Prefers horizontal/vertical walls over diagonal
- **Short segment penalty**: Halves confidence for segments < 1.5x minimum length

### 4. Confidence-Based Filtering in Output
- **Walls**: Only include walls with confidence >= 0.5
- **Rooms**: Only include rooms with confidence >= 0.6
- **Length check**: Double-check wall length in real units before output

### 5. Enhanced Filtering in Phase 1.3
- **1.5x minimum length**: Require segments to be 1.5x minimum length
- **Edge margin filtering**: Filter segments within 2% of image edges (likely dimension lines)
- **Short edge segments**: Extra filtering for very short segments near edges

## Expected Impact

### Before:
- Too many false positive walls (dimension strings, random lines)
- Too many false positive rooms (entire floor plans, small artifacts)
- Low-confidence detections included

### After:
- Fewer but more accurate walls (only high-confidence, longer segments)
- Fewer but more accurate rooms (only high-confidence, reasonable size)
- Better filtering of dimension strings and edge artifacts

## Testing Recommendations

1. **Check logs** for:
   - "Filtered to X candidate wall segments" (should be lower)
   - "Phase 1 complete: X walls detected" (should be lower, more accurate)
   - Confidence scores in output

2. **Verify**:
   - Are dimension strings still being detected as walls?
   - Are entire floor plans still being detected as rooms?
   - Are there fewer false positives overall?

3. **If still too many false positives**:
   - Increase `min_wall_confidence` to 0.6 or 0.7
   - Increase `min_room_confidence` to 0.7
   - Increase `min_wall_length_ft` to 3.0
   - Increase `min_room_area_sf` to 100.0

4. **If too few detections**:
   - Decrease `min_wall_confidence` to 0.4
   - Decrease `min_room_confidence` to 0.5
   - Decrease `min_wall_length_ft` to 1.5

## Next Steps

1. Test with these new parameters
2. Review logs to see filtering effectiveness
3. Adjust thresholds based on results
4. Consider Phase 5 (deep learning) if traditional CV still insufficient

