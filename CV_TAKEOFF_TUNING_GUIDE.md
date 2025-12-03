# CV Takeoff Tuning Guide

## Current Issues & Fixes Applied

### Problem: "Crazy random stuff" - Too many false positives

**Root Causes:**
1. Old geometry-based detection was running alongside Phase 2-3, creating duplicates
2. Parameters were too loose (max_room_area_sf: 2000)
3. Validation wasn't strict enough
4. No filtering of oversized rooms

**Fixes Applied:**
1. ✅ Disabled geometry-based detection when Phase 2-3 finds rooms
2. ✅ Reduced max_room_area_sf from 2000 to 1000 SF
3. ✅ Increased enclosure score threshold from 0.7 to 0.75
4. ✅ Added size filtering in final output
5. ✅ Only include validated rooms in results

---

## Configuration Parameters (CONFIG)

All parameters are in `boundaryDetectionService.ts` in the `CONFIG` dictionary:

### Room Detection Parameters

```python
'min_room_area_sf': 50.0,      # Minimum room area (square feet)
'max_room_area_sf': 1000.0,    # Maximum room area (reduced from 2000)
'corridor_aspect_ratio_threshold': 5.0,
'corridor_perimeter_area_ratio_threshold': 0.3,
```

**Tuning Tips:**
- **Too many small false positives?** Increase `min_room_area_sf` (try 75-100)
- **Detecting entire floor plans?** Decrease `max_room_area_sf` (try 500-800)
- **Missing small rooms?** Decrease `min_room_area_sf` (try 25-40)

### Wall Detection Parameters

```python
'min_wall_length_ft': 1.0,     # Minimum wall length (feet)
'wall_thickness_pixels': 3,     # Wall thickness for rendering
'endpoint_snap_distance_px': 3,
'angular_tolerance_deg': 5.0,
```

**Tuning Tips:**
- **Too many short segments?** Increase `min_wall_length_ft` (try 2.0-3.0)
- **Walls not connecting?** Increase `endpoint_snap_distance_px` (try 5-8)
- **Missing angled walls?** Increase `angular_tolerance_deg` (try 10-15)

### Validation Parameters

```python
# In validate_rooms function:
enclosure_score > 0.75  # Required for valid_enclosed_room (was 0.7)
```

**Tuning Tips:**
- **Too many false positives?** Increase threshold to 0.8-0.85
- **Missing valid rooms?** Decrease threshold to 0.65-0.7

### Preprocessing Parameters

```python
'image_max_dimension_px': 3000,
'bilateral_filter_d': 9,
'bilateral_filter_sigma_color': 75,
'bilateral_filter_sigma_space': 75,
```

**Tuning Tips:**
- **Processing too slow?** Reduce `image_max_dimension_px` to 2000
- **Missing thin walls?** Increase morphological kernel sizes
- **Too much noise?** Increase bilateral filter sigma values

---

## How to Tune for Your Drawings

### Step 1: Check the Logs

When you run detection, check the server logs for:
```
Phase 1 complete: X walls detected
Phase 2 complete: Y room seeds prepared
Phase 3.1 complete: Z rooms extracted
Phase 3.2 complete: W rooms validated
Final detection: V rooms after filtering
```

**What to look for:**
- If `W rooms validated` is much less than `Z rooms extracted`, validation is too strict
- If `V rooms after filtering` is much less than `W rooms validated`, size filtering is removing valid rooms

### Step 2: Adjust Parameters Based on Results

**If you see too many false positives:**
1. Increase `min_room_area_sf` (e.g., 75-100)
2. Decrease `max_room_area_sf` (e.g., 500-800)
3. Increase enclosure score threshold (e.g., 0.8)
4. Check if geometry-based detection is running (should be disabled if Phase 2-3 finds rooms)

**If you're missing valid rooms:**
1. Decrease `min_room_area_sf` (e.g., 25-40)
2. Increase `max_room_area_sf` (e.g., 1200-1500)
3. Decrease enclosure score threshold (e.g., 0.65-0.7)
4. Check OCR - are room labels being detected?

**If walls are fragmented:**
1. Increase `endpoint_snap_distance_px` (e.g., 5-8)
2. Increase `collinear_merge_distance_px` (e.g., 8-10)
3. Check morphological operations - may need larger kernels

**If walls are missing:**
1. Decrease `min_wall_length_ft` (e.g., 0.5-0.75)
2. Check wall-likelihood mask - may need more iterations
3. Check if dimension strings are being filtered too aggressively

### Step 3: Test Incrementally

1. Start with one parameter change
2. Test on a known-good drawing
3. Compare results before/after
4. Adjust incrementally (don't change multiple parameters at once)

---

## Common Issues & Solutions

### Issue: Detecting entire floor plan as one room

**Solution:**
- Decrease `max_room_area_sf` to 500-800
- Check if room seeds are being placed correctly
- Verify OCR is detecting room labels (not just dimensions)

### Issue: Too many small false positive rooms

**Solution:**
- Increase `min_room_area_sf` to 75-100
- Increase enclosure score threshold to 0.8
- Check if dimension text is being excluded properly

### Issue: Missing valid rooms

**Solution:**
- Check OCR logs - are room labels being detected?
- Decrease `min_room_area_sf` to 25-40
- Decrease enclosure score threshold to 0.65-0.7
- Check if room seeds are being placed correctly

### Issue: Walls not connecting

**Solution:**
- Increase `endpoint_snap_distance_px` to 5-8
- Increase `collinear_merge_distance_px` to 8-10
- Check wall graph building - may need more tolerance

### Issue: Dimension strings detected as walls

**Solution:**
- Check `filter_non_wall_segments` function
- Increase dimension text exclusion zone
- Verify OCR is correctly identifying dimension text

---

## Debugging Tips

1. **Check Phase Outputs:**
   - Phase 1: Wall detection count
   - Phase 2: Room seed count
   - Phase 3.1: Extracted rooms count
   - Phase 3.2: Validated rooms count

2. **Check OCR Results:**
   - Are room labels being detected?
   - Are dimension strings being excluded?
   - Is text type classification working?

3. **Check Validation Scores:**
   - Enclosure scores (should be > 0.75 for valid rooms)
   - Aspect ratios (should be < 5.0 for non-corridors)
   - Area checks (should be between min and max)

4. **Check Wall Graph:**
   - Number of nodes and edges
   - Confidence scores
   - Graph connectivity

---

## Next Steps

After tuning, consider:
1. **Phase 4:** Wall refinement with room feedback
2. **Phase 5:** Enhanced corridor/open space handling
3. **Parameter Presets:** Save different parameter sets for different drawing types

---

## Quick Reference

**Current Settings (After Fixes):**
- Min room area: 50 SF
- Max room area: 1000 SF
- Enclosure threshold: 0.75
- Min wall length: 1.0 LF
- Geometry-based detection: Disabled when Phase 2-3 finds rooms

**Recommended Starting Points:**
- **Small drawings:** min_room_area_sf: 25, max_room_area_sf: 500
- **Large drawings:** min_room_area_sf: 100, max_room_area_sf: 1500
- **Complex drawings:** Increase all tolerances by 20-30%

