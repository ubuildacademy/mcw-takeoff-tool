# Meridian Takeoff Development Roadmap

## Core Features Status

### ✅ Completed Core Features
- **Project Management**: Create, edit, delete, and organize construction projects
- **PDF Upload & Processing**: Upload and process construction drawings with OCR
- **Takeoff Tools**: Area, linear, volume, and count measurement tools
- **Condition Management**: Create and manage takeoff conditions with custom properties
- **Measurement System**: Precise takeoff measurements with cutout support
- **Scale Calibration**: Accurate scale calibration for real-world measurements
- **Professional Reporting**: Excel and PDF export with industry-standard formatting
- **Project Backup/Restore**: Complete project data backup and restore system
- **Grid/List Views**: Flexible project dashboard with view mode switching
- **Tooltip Positioning**: Blue on-screen tooltip positioned at bottom right with "ready" status
- **Pricing Component**: Pricing component integrated into reports
- **PDF Report Rendering**: PDF reports with graphic takeoff visualization (in progress)

### 🔄 Current Development Priorities

#### Critical Priority Issues
- [ ] **OCR Processing Fix**: OCR is not running properly - needs complete overhaul of OCR service integration
  - Current Issue: OCR requests are sent but processing doesn't complete successfully
  - Need to fix: Backend OCR service integration, job status tracking, and result handling
  - Impact: Users cannot extract text from PDF pages for search and analysis

- [ ] **Page Label Extraction**: Fix extraction of page labels from titleblocks - currently not working
  - Current Issue: "Extract Page Labels" feature shows "coming soon" alert
  - Need to fix: Implement actual page label extraction from configured titleblock areas
  - Impact: Users cannot automatically extract sheet numbers and names from drawings

- [ ] **Titleblock Configuration**: Fix the setup and configuration of where to look for titleblock information
  - Current Issue: Titleblock configuration dialog exists but doesn't properly save/apply settings
  - Need to fix: Save titleblock field coordinates, apply to OCR processing, and use for extraction
  - Impact: Users cannot define where sheet information is located on their drawings

- [ ] **OCR Service Integration**: Resolve API endpoint mismatches and service communication issues
  - Current Issue: Frontend OCR service calls don't match backend API expectations
  - Need to fix: Align API endpoints, parameter formats, and response handling
  - Impact: OCR functionality is completely broken

#### High Priority Issues
- [ ] **Page Rotation Fix**: Takeoffs don't stay exactly where drawn when rotating pages
- [ ] **PDF Flickering**: Fix flickering PDF when drawing conditions
- [ ] **Markup Visibility**: Markups not visible across all zoom levels initially
- [ ] **PDF Report Rendering**: Fix PDF report generation to properly display graphic takeoff visualizations

#### Medium Priority Enhancements
- [ ] **OCR Enhancement**: Improve OCR accuracy with better highlights and fast navigation tab
- [ ] **Sheet Metadata Management**: Improve sheet data storage and retrieval system

### 🔧 Technical Implementation Notes

#### OCR System Architecture Issues
The current OCR implementation has several critical problems:

1. **Backend OCR Service** (`/server/src/routes/ocr.ts`):
   - Uses Tesseract.js for OCR processing
   - Has job tracking system but frontend doesn't properly integrate with it
   - Document path resolution may be incorrect for uploaded files

2. **Frontend OCR Service** (`/src/services/ocrService.ts`):
   - API calls don't match backend expectations
   - Missing proper job status polling
   - No integration with sheet metadata system

3. **Titleblock Configuration** (`/src/components/TitleblockConfigDialog.tsx`):
   - Dialog exists but configuration isn't properly saved to database
   - No integration with OCR processing to use configured areas
   - Missing validation and error handling

4. **Sheet Metadata System** (`/server/src/routes/sheets.ts`):
   - Basic CRUD operations exist but OCR integration is incomplete
   - Missing proper storage of extracted text and metadata
   - No connection between OCR results and sheet data

#### Required Fixes
1. **Fix OCR API Integration**: Align frontend service calls with backend API
2. **Implement Job Status Tracking**: Add proper polling for OCR job completion
3. **Fix Titleblock Configuration**: Save and apply titleblock field coordinates
4. **Implement Page Label Extraction**: Use configured titleblock areas for text extraction
5. **Connect OCR Results to Sheet Data**: Store extracted text in sheet metadata

### 📋 Development Process

#### Bug Tracking
Issues are tracked in this document and addressed based on priority and user impact.

#### Feature Development
New features are developed following industry standards for construction takeoff software, focusing on:
- Professional accuracy and precision
- User-friendly interface design
- Efficient workflow optimization
- Reliable data management

#### Quality Assurance
All features undergo thorough testing before deployment to ensure:
- Measurement accuracy
- Data integrity
- User experience quality
- Performance optimization

---

*Last Updated: January 2025*
*Version: 1.1 - Updated with OCR and Page Label Extraction Issues*
