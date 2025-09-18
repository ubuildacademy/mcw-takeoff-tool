# Meridian Takeoff - Development Roadmap

## Current Status
**Last Updated**: January 2025  
**Version**: Development Build  
**Commit**: Latest - Dual canvas system fixes completed but introduced regressions
**Status**: 🔴 **CRITICAL REGRESSIONS** - PDF disappearing at zoom levels, measurements on wrong pages

## Critical Issues to Fix

### 1. Dual Canvas Implementation Issues 🔴 **PARTIALLY RESOLVED - REGRESSIONS OCCURRED**
**Problem**: Recent dual canvas system implementation had introduced new issues
**Impact**: PDF viewer functionality was compromised, with new regressions appearing
**Status**: 🔴 **PARTIALLY FIXED** - Core issues resolved but regressions introduced
**Issues Fixed**:
- ✅ Canvas synchronization during zoom/scale changes
- ✅ Coordinate system inconsistencies between PDF and annotation layers  
- ✅ Measurement loading timing issues
- ✅ Rendering race conditions between PDF and annotation canvases
- ✅ Canvas positioning and overlay alignment
- ✅ Memory leak prevention and cleanup
**New Regressions Introduced**:
- 🔴 **PDF disappearing at certain zoom levels** (60%, 70%, etc.) - floating-point precision issues
- 🔴 **Takeoffs appearing on all pages** - measurement filtering broken again
- 🔴 **Canvas dimension sync warnings** - annotation canvas out of sync
**Root Cause**: Floating-point precision in PDF.js viewport calculations causing canvas dimension mismatches

### 2. Current Regressions (Post-Dual Canvas Fixes) 🔴 **CRITICAL PRIORITY**
**Problem**: Fixing dual canvas issues introduced new regressions
**Impact**: Core functionality broken - PDF disappearing and measurements on wrong pages
**Status**: 🔴 **ACTIVE REGRESSIONS** - Need immediate attention
**Issues**:
- 🔴 **PDF Disappearing at Zoom Levels**: PDF becomes invisible at 60%, 70%, and other specific zoom levels
  - **Symptoms**: White canvas area, no PDF content visible
  - **Console**: "Annotation canvas dimensions out of sync, forcing update" warnings
  - **Root Cause**: Floating-point precision in PDF.js viewport calculations (e.g., 2116.7999999999997 vs 2117)
- 🔴 **Measurements Appearing on All Pages**: Takeoffs show on every page instead of just the page they were created on
  - **Symptoms**: 4 measurements visible on page 1, same measurements appear on other pages
  - **Console**: "RENDERING: 4 measurements" on all pages
  - **Root Cause**: Measurement filtering by page number not working correctly
**Immediate Action Required**:
- Fix floating-point precision in canvas dimension calculations
- Restore proper page-based measurement filtering
- Ensure canvas synchronization works at all zoom levels

### 3. Phantom Lines Issue 🔴 **HIGH PRIORITY**
**Problem**: When drawing measurements, phantom lines appear before clicking to start the measurement
**Impact**: Poor user experience, confusing visual feedback
**Root Cause**: Likely related to the PDF flickering fix implementation
**Status**: May be resolved by dual canvas system, needs testing
**Investigation Needed**:
- Test if dual canvas system resolves phantom lines
- Verify `renderCurrentMeasurement` function logic
- Check `isMeasuring` state management
- Test coordinate transformation accuracy

### 3. Takeoffs Not Displaying on Page Load 🔴 **HIGH PRIORITY**
**Problem**: Existing measurements don't appear immediately when loading a page
**Impact**: Users can't see their work until they create a new measurement
**Root Cause**: Timing issue between PDF loading and measurement rendering
**Status**: May be resolved by dual canvas system, needs testing
**Investigation Needed**:
- Test if dual canvas system resolves measurement loading
- Verify `renderAnnotations` function execution order
- Check measurement loading sequence in `PDFViewer.tsx`
- Test with different PDF sizes and loading speeds

### 4. PDF Not Clearing Takeoffs on Condition Deletion 🟡 **MEDIUM PRIORITY**
**Problem**: When deleting a condition, measurements remain visible on PDF until page refresh
**Impact**: Confusing state where deleted measurements still appear
**Root Cause**: Client-side state not properly syncing with server-side deletion
**Status**: Unchanged by dual canvas implementation
**Investigation Needed**:
- Verify `takeoffMeasurements` dependency in PDFViewer useEffect
- Check if `renderAnnotations` is being called after condition deletion
- Test the reactive update mechanism

## Dual Canvas System - Detailed Issues to Fix

### 5. Canvas Synchronization Issues 🔴 **HIGH PRIORITY**
**Problem**: PDF and annotation canvases may not stay perfectly synchronized
**Impact**: Measurements could appear misaligned or at wrong positions
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test canvas alignment during zoom operations
- [ ] Verify both canvases update dimensions together
- [ ] Test with different PDF sizes and aspect ratios
- [ ] Fix any misalignment issues found

### 6. Coordinate System Inconsistencies 🔴 **HIGH PRIORITY**
**Problem**: Coordinate calculations between PDF and annotation layers may be inconsistent
**Impact**: Measurements could appear in wrong positions
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test coordinate conversion accuracy
- [ ] Verify mouse click positioning
- [ ] Test measurement rendering accuracy
- [ ] Fix any coordinate mismatches found

### 7. Measurement Loading Timing Issues 🔴 **HIGH PRIORITY**
**Problem**: Annotations might render before PDF is fully loaded
**Impact**: Measurements could appear in wrong positions or not at all
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test measurement display on page load
- [ ] Verify timing between PDF rendering and annotation rendering
- [ ] Test with slow-loading PDFs
- [ ] Fix any timing issues found

### 8. Rendering Race Conditions 🟡 **MEDIUM PRIORITY**
**Problem**: Multiple useEffect hooks could cause rendering conflicts
**Impact**: Annotations might flicker or not render consistently
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test rendering consistency during rapid state changes
- [ ] Verify no flickering during zoom/pan operations
- [ ] Test with multiple rapid measurements
- [ ] Fix any race conditions found

### 9. Canvas Positioning Issues 🟡 **MEDIUM PRIORITY**
**Problem**: Canvas positioning might cause layout issues
**Impact**: Canvases might not align perfectly or overlap incorrectly
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test canvas alignment in different screen sizes
- [ ] Verify perfect overlay of annotation canvas on PDF canvas
- [ ] Test with different browser zoom levels
- [ ] Fix any positioning issues found

### 10. Memory Leak Prevention 🟡 **MEDIUM PRIORITY**
**Problem**: Canvas contexts and render tasks might not be properly cleaned up
**Impact**: Performance degradation over time
**Status**: Partially addressed, needs testing
**Tasks**:
- [ ] Test memory usage over extended sessions
- [ ] Verify proper cleanup of render tasks
- [ ] Test with multiple PDF loads
- [ ] Fix any memory leaks found

## Feature Improvements

### 11. Performance Optimization 🟡 **MEDIUM PRIORITY**
**Areas for Improvement**:
- Reduce excessive console logging in production
- Optimize dual canvas rendering performance
- Implement proper debouncing for mouse events
- Add loading states for better UX

### 12. Error Handling & User Feedback 🟡 **MEDIUM PRIORITY**
**Areas for Improvement**:
- Add proper error boundaries for canvas operations
- Implement user-friendly error messages
- Add loading indicators for async operations
- Improve validation feedback

### 13. Code Quality & Maintainability 🟢 **LOW PRIORITY**
**Areas for Improvement**:
- Refactor large components (PDFViewer.tsx is 1000+ lines)
- Add comprehensive TypeScript types
- Implement proper testing suite
- Add code documentation

## Technical Debt

### 7. Architecture Improvements 🟢 **LOW PRIORITY**
**Areas for Improvement**:
- Consider splitting PDFViewer into smaller components
- Implement proper state management patterns
- Add proper error logging and monitoring
- Consider implementing a proper canvas management system

### 8. Database & API Improvements 🟢 **LOW PRIORITY**
**Areas for Improvement**:
- Add proper database migrations
- Implement API versioning
- Add proper data validation
- Consider implementing caching strategies

## Development Notes

### Recent Fixes Applied
1. **Fixed ReferenceError in deleteCondition**: Changed `state.takeoffMeasurements` to `get().takeoffMeasurements`
2. **Added cascading delete**: Server-side deletion of measurements when condition is deleted
3. **Removed Clear All button**: Eliminated non-functional UI element
4. **Added reactive updates**: PDFViewer now responds to store changes
5. **Implemented dual canvas system**: Separated PDF rendering from annotation rendering
6. **Added canvas synchronization**: Both canvases update dimensions together
7. **Improved coordinate system**: Better coordinate conversion handling
8. **Added memory cleanup**: Proper cleanup of render tasks and canvas contexts

### Key Files Modified
- `src/components/PDFViewer.tsx` - Main rendering logic
- `src/store/useTakeoffStore.ts` - State management
- `server/src/storage.ts` - Database operations
- `src/components/TakeoffWorkspace.tsx` - UI cleanup

### Testing Recommendations
1. **Dual Canvas System Testing**:
   - Test canvas alignment during zoom operations
   - Test measurement positioning accuracy
   - Test measurement display on page load
   - Test with different PDF sizes and aspect ratios
   - Test rendering consistency during rapid state changes

2. **Existing Functionality Testing**:
   - Test condition deletion with multiple measurements
   - Test page navigation with existing measurements
   - Test measurement creation with different condition types
   - Test PDF loading with various file sizes
   - Test concurrent user operations

3. **Performance Testing**:
   - Test memory usage over extended sessions
   - Test with multiple PDF loads
   - Test rendering performance with many measurements
   - Test browser compatibility

## Next Steps

### Immediate (This Week)
1. **Test dual canvas implementation** - Verify basic functionality works
2. **Fix canvas synchronization issues** - Ensure both canvases stay aligned
3. **Fix coordinate system inconsistencies** - Verify measurement positioning accuracy
4. **Test measurement loading timing** - Ensure measurements appear immediately on page load

### Short Term (Next 2 Weeks)
1. **Fix rendering race conditions** - Eliminate flickering and inconsistent rendering
2. **Fix canvas positioning issues** - Ensure perfect overlay alignment
3. **Test memory leak prevention** - Verify proper cleanup
4. **Performance optimization** - Optimize dual canvas rendering

### Long Term (Next Month)
1. **Comprehensive testing** - Test all edge cases and scenarios
2. **Error handling improvements** - Add proper error boundaries
3. **Code refactoring** - Split large components and improve maintainability
4. **Documentation** - Add proper code documentation

## Development Environment

### Current Setup
- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: Supabase (PostgreSQL)
- **PDF Rendering**: PDF.js
- **Canvas**: HTML5 Canvas API
- **State Management**: Zustand

### Development Commands
```bash
# Frontend development
npm run dev -- --port 3001

# Backend development
cd server && npm run dev

# Database operations
# Supabase CLI commands for migrations
```

### Key Dependencies
- `pdfjs-dist` - PDF rendering
- `fabric` - Canvas manipulation (if needed)
- `zustand` - State management
- `@supabase/supabase-js` - Database client

---

**Note**: This roadmap should be updated as issues are resolved and new requirements emerge. Priority levels may change based on user feedback and business needs.
