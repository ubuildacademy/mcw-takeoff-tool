# Titleblock Extraction Pipeline - Debug Guide

## Current Pipeline Flow

### 1. **User Selection (Frontend)**
- User draws box around sheet number field → stored in `pendingTitleblockConfig.sheetNumberField`
- User draws box around sheet name field → stored in `pendingTitleblockConfig.sheetNameField`
- Both regions are normalized coordinates (0-1 scale)

### 2. **Backend Processing (`/api/titleblock/extract`)**
- **Combines both regions** into a single combined region (lines 61-77 in `titleblock.ts`)
- Downloads PDF from Supabase Storage
- Calls `titleblockExtractionService.extractSheets()` with:
  - PDF path
  - Page numbers (all pages)
  - **Combined region** (not separate regions!)

### 3. **Python Script (`titleblock_extraction.py`)**
- Receives `TITLEBLOCK_REGION` environment variable (the combined region)
- For each page:
  - **Text Extraction**: Uses PyMuPDF's native text extraction (for vector PDFs) or OCR (pytesseract for raster PDFs)
    - Extracts text from the combined region only
  - **Pattern Matching**: Uses regex patterns to find:
    - Sheet numbers: patterns like "sheet number: A4.21", or standalone "A4.21"
    - Sheet names: patterns like "drawing data: Floor Plan"
  - Returns `{pageNumber, sheetNumber, sheetName}`

### 4. **Backend Save (`titleblock.ts` lines 184-196)**
- For each extracted sheet:
  - Loads existing sheet from DB (if exists)
  - Updates sheet with:
    - `sheetNumber`: Only if not "Unknown" (keeps existing if "Unknown")
    - `sheetName`: Only if not "Unknown" (keeps existing if "Unknown")
  - Saves via `storage.saveSheet()`

### 5. **Frontend Reload (`loadProjectDocuments`)**
- Calls `sheetService.getSheet(sheetId)` for each page
- Maps `sheetNumber` and `sheetName` to page objects
- Displays in sidebar

## Potential Issues

1. **Combined Region Problem**: The backend combines both regions, but the Python script should extract from each region separately
2. **Pattern Matching Limitation**: Python uses regex patterns, not LLM - might miss variations
3. **"Unknown" Handling**: If extraction returns "Unknown", it keeps existing value (might be undefined)
4. **Data Not Persisting**: Check if `saveSheet` is actually saving to database
5. **Data Not Loading**: Check if `getSheet` is loading correctly

## Debug Steps

1. Check backend logs for Python script output
2. Check if `saveSheet` is being called and succeeding
3. Check if `getSheet` is returning the saved data
4. Verify the combined region is correct
5. Check if Python script is actually extracting text from the region
