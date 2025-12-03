# Floor Plan Segmentation Model Research

## Summary

After researching architecturally-trained models for floor plan segmentation, here are the best options:

---

## Top Recommendations

### 1. **ozturkoktay/floor-plan-room-segmentation** ⭐ BEST OPTION
- **GitHub:** https://github.com/ozturkoktay/floor-plan-room-segmentation
- **Architecture:** U-Net with ResNet encoder
- **Classes:** Rooms, walls, doors, windows
- **Pros:**
  - Specifically trained on floor plans
  - Uses U-Net (compatible with our current setup)
  - Has training code and dataset
  - Well-documented
- **Cons:**
  - May need to train from scratch or find pre-trained weights
  - Requires dataset preparation

### 2. **FPNet (Deep Attention Network)**
- **Architecture:** Dual decoder (rooms + icons)
- **Output:** 
  - Room segmentation map (background, walls, room types)
  - Icon segmentation map (doors, windows)
- **Pros:**
  - Comprehensive segmentation
  - Handles both rooms and architectural symbols
- **Cons:**
  - May not have readily available pre-trained weights
  - More complex architecture

### 3. **Segformer B0 Finetuned for Floorplan**
- **Source:** model.aibase.com
- **Architecture:** Segformer (Transformer-based)
- **Pros:**
  - Lightweight (B0 variant)
  - Specifically fine-tuned for floor plans
  - Modern transformer architecture
- **Cons:**
  - May require API access or specific platform
  - Less control over model

### 4. **MuraNet (Multi-task Floor Plan Recognition)**
- **Architecture:** Attention-based multi-task model
- **Tasks:** Segmentation + Detection
- **Pros:**
  - Handles multiple tasks simultaneously
  - Good for complex floor plans
- **Cons:**
  - More complex to integrate
  - May require more resources

---

## Recommended Approach

### Option A: Use ozturkoktay/floor-plan-room-segmentation (Recommended)

**Why:**
- Most compatible with our current U-Net setup
- Specifically designed for floor plans
- Has training code available
- Can adapt to our needs

**Implementation Steps:**
1. Clone the repository
2. Check for pre-trained weights
3. If available, load and use
4. If not, we can:
   - Use their training code to train on floor plan dataset
   - Or adapt their architecture to our segmentation-models-pytorch setup

**Integration:**
- Replace our current U-Net model with their trained model
- Keep our existing pipeline (graph building, validation, etc.)
- Use their segmentation output as input to our CV refinement

### Option B: Fine-tune Existing Model on Floor Plan Dataset

**Why:**
- We already have segmentation-models-pytorch set up
- Can fine-tune U-Net on floor plan dataset
- More control over training

**Implementation Steps:**
1. Find floor plan dataset (e.g., MLSTRUCT-FP, ResPlan)
2. Prepare dataset with room/wall annotations
3. Fine-tune our U-Net model
4. Save weights and use in production

**Datasets Available:**
- **MLSTRUCT-FP:** 954+ floor plan images with wall annotations
- **ResPlan:** 17,000 residential floor plans with annotations
- **CubiCasa5k:** 5,000 floor plans with room/wall annotations

### Option C: Use HuggingFace Transformers (Segformer)

**Why:**
- Easy to use with HuggingFace
- Pre-trained models available
- Can fine-tune if needed

**Implementation:**
- Use `transformers` library
- Load Segformer model
- Fine-tune on floor plan dataset if needed

---

## Decision Matrix

| Model | Ease of Use | Accuracy | Availability | Compatibility |
|-------|-------------|----------|--------------|---------------|
| ozturkoktay | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| FPNet | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Segformer | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Fine-tune | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## Recommended Next Steps

1. **Try ozturkoktay model first:**
   - Check GitHub for pre-trained weights
   - If available, integrate directly
   - If not, consider training or fine-tuning

2. **If that doesn't work, fine-tune our current model:**
   - Use MLSTRUCT-FP or ResPlan dataset
   - Fine-tune U-Net with segmentation-models-pytorch
   - This gives us full control

3. **Alternative: Use HuggingFace Segformer:**
   - Easy integration
   - Can fine-tune on floor plans
   - Modern architecture

---

## Implementation Priority

**Phase 1:** Check ozturkoktay repository for pre-trained weights
**Phase 2:** If not available, fine-tune our U-Net on floor plan dataset
**Phase 3:** Integrate and test with real floor plans

---

## Resources

- **ozturkoktay GitHub:** https://github.com/ozturkoktay/floor-plan-room-segmentation
- **MLSTRUCT-FP Dataset:** https://github.com/MLSTRUCT/MLSTRUCT-FP
- **ResPlan Dataset:** https://arxiv.org/abs/2508.14006
- **CubiCasa5k:** Available for research use
- **HuggingFace Models:** https://huggingface.co/models?search=floor+plan

