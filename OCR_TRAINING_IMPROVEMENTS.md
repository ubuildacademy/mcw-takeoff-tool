# OCR Training Improvements

## Overview
This document describes the improvements made to the OCR training system to address zoom functionality issues and add support for tracking sheets without titleblocks.

## Changes Made

### 1. Fixed Zoom Functionality in PDF Viewer

**Problem**: Users couldn't zoom in when viewing PDF pages in the OCR training dialog to confirm correct spelling and edit OCR processed text.

**Solution**: 
- Improved zoom controls to use Ctrl/Cmd + scroll wheel for zooming
- Regular scroll wheel now pans the image
- Added visual zoom level indicator showing current zoom percentage
- Improved transform handling for better zoom performance
- Extended zoom range from 20% to 500%

**Files Modified**:
- `src/components/OCRTrainingDialog.tsx`

**Key Changes**:
- Fixed transform order (translate then scale)
- Added Ctrl/Cmd key detection for zoom vs pan
- Added real-time zoom level display
- Improved event handling and preventDefault calls

### 2. Added Titleblock Support

**Problem**: The OCR engine didn't know which sheets have titleblocks, which could cause confusion when trying to identify page numbers or sheet names on sheets without titleblocks.

**Solution**: Added a `has_titleblock` field to track whether each sheet has a titleblock, helping the OCR engine understand the context.

**Files Modified**:
- `src/services/ocrTrainingService.ts`
- `src/components/OCRTrainingDialog.tsx`
- `setup-ocr-training-table.md`
- `add-titleblock-field-migration.sql` (new file)

**Key Changes**:

#### Database Schema Updates:
- Added `has_titleblock BOOLEAN DEFAULT true` column to `ocr_training_data` table
- Added index for better query performance
- Added proper documentation comments

#### Service Layer Updates:
- Updated `OCRTrainingData` interface to include `hasTitleblock` field
- Modified `saveTrainingData()` to handle the new field
- Updated `loadTrainingData()` to map the database field
- Enhanced `validateCorrection()` to accept and store titleblock information

#### UI Updates:
- Added checkbox in edit mode to specify if sheet has titleblock
- Added visual indicator (green/red dot) showing titleblock status
- Updated all edit handlers to manage titleblock state
- Improved layout to accommodate new field

### 3. Migration Support

**New Files**:
- `add-titleblock-field-migration.sql` - Migration script for existing databases
- `OCR_TRAINING_IMPROVEMENTS.md` - This documentation

**Migration Instructions**:
1. Run the migration script in your Supabase SQL Editor
2. The script safely adds the new column with default values
3. Existing data will default to `has_titleblock = true` for backward compatibility

## Usage Instructions

### Zoom Controls in PDF Viewer:
- **Zoom In/Out**: Hold Ctrl (Windows) or Cmd (Mac) and scroll mouse wheel
- **Pan**: Use regular mouse wheel scrolling
- **Drag to Pan**: Click and drag the image
- **Zoom Range**: 20% to 500%
- **Current Zoom**: Displayed in real-time below the image

### Titleblock Tracking:
- When editing OCR training data, you can now specify whether the sheet has a titleblock
- Check the "Sheet has titleblock" checkbox when editing entries
- Visual indicators show titleblock status:
  - Green dot: Sheet has titleblock
  - Red dot: Sheet has no titleblock
- This information helps the OCR engine understand context and improve accuracy

## Benefits

1. **Better User Experience**: Users can now properly zoom and pan PDF pages to verify OCR accuracy
2. **Improved OCR Training**: The system can now distinguish between sheets with and without titleblocks
3. **Enhanced Accuracy**: OCR engine can use titleblock context to improve text recognition
4. **Backward Compatibility**: All existing data remains functional with sensible defaults

## Technical Notes

- The `has_titleblock` field defaults to `true` for backward compatibility
- All existing OCR training data will continue to work without modification
- The zoom functionality uses CSS transforms for smooth performance
- Event handling prevents conflicts between zoom and pan operations
