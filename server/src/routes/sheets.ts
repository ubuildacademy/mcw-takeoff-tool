import express from 'express';
import { storage } from '../storage';
import { requireAuth, hasProjectAccess, isAdmin, validateUUIDParam, isValidUUID } from '../middleware';
import {
  assertSheetAccess,
  documentIdFromSheetKey,
  pageNumberFromSheetKey,
} from '../lib/sheetAccess';

const router = express.Router();
router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify user has access to this project
    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    // Get all files for the project
    const files = await storage.getFilesByProject(projectId);
    const pdfFiles = files.filter((f: any) => f.mimetype === 'application/pdf');
    
    // For now, return basic sheet information
    // In a real implementation, you'd load this from a database
    const sheets = pdfFiles.map(file => ({
      id: file.id,
      name: file.originalName.replace('.pdf', ''),
      totalPages: 1, // This would be determined by loading the PDF
      pages: [{
        pageNumber: 1,
        hasTakeoffs: false,
        takeoffCount: 0,
        isVisible: true,
        ocrProcessed: false
      }]
    }));
    
    res.json({ sheets });
  } catch (error) {
    console.error('Error getting project sheets:', error);
    res.status(500).json({ error: 'Failed to get project sheets' });
  }
});

const MAX_BATCH_SHEET_IDS = 2500;

/**
 * Bulk-load persisted sheet metadata for sidebar (single round trip vs N GET /sheets/:id).
 */
router.post('/batch-metadata', requireAuth, async (req, res) => {
  try {
    const { projectId, sheetIds } = (req.body ?? {}) as {
      projectId?: string;
      sheetIds?: unknown;
    };

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId is required' });
    }
    if (!isValidUUID(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    if (!Array.isArray(sheetIds)) {
      return res.status(400).json({ error: 'sheetIds must be an array' });
    }

    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const files = await storage.getFilesByProject(projectId);
    const allowedPdfDocIds = new Set(
      files
        .filter((f) => {
          const mt = typeof f.mimetype === 'string' ? f.mimetype.toLowerCase() : '';
          if (mt === 'application/pdf' || mt.includes('pdf')) return true;
          return (f.originalName ?? '').toLowerCase().endsWith('.pdf');
        })
        .map((f) => f.id)
    );

    const rawIds = [...new Set(sheetIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const sanitized: string[] = [];
    const seenInBatch = new Set<string>();
    for (const sid of rawIds) {
      if (sanitized.length >= MAX_BATCH_SHEET_IDS) break;
      if (seenInBatch.has(sid)) continue;
      const docId = documentIdFromSheetKey(sid);
      if (!allowedPdfDocIds.has(docId)) continue;
      sanitized.push(sid);
      seenInBatch.add(sid);
    }

    const rows = await storage.getSheetsByIds(sanitized);
    const sheetsById: Record<string, (typeof rows)[number]> = {};
    for (const sheet of rows) {
      sheetsById[sheet.id] = sheet;
    }

    return res.json({ sheetsById });
  } catch (error) {
    console.error('Error batch-fetching sheet metadata:', error);
    return res.status(500).json({ error: 'Failed to fetch sheet metadata' });
  }
});

// Get specific sheet metadata
router.get('/:sheetId', requireAuth, async (req, res) => {
  try {
    const { sheetId } = req.params;
    const access = await assertSheetAccess(req.user!.id, sheetId);
    if (!access.ok) {
      return res.status(404).json({ error: 'Sheet not found or access denied' });
    }

    const { sheet } = access;

    if (!sheet) {
      const documentId = access.documentId;
      const pageNumber = pageNumberFromSheetKey(sheetId);

      const defaultSheet = {
        id: sheetId,
        documentId,
        pageNumber,
        hasTakeoffs: false,
        takeoffCount: 0,
        isVisible: true,
        ocrProcessed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return res.json({ sheet: defaultSheet });
    }

    res.json({ sheet });
  } catch (error) {
    console.error('Error getting sheet metadata:', error);
    res.status(500).json({ error: 'Failed to get sheet metadata' });
  }
});

// Update sheet metadata
router.put('/:sheetId', requireAuth, async (req, res) => {
  try {
    const { sheetId } = req.params;
    const updates = req.body as Record<string, unknown>;

    if (process.env.NODE_ENV === 'development') {
      console.log(`Updating sheet ${sheetId}:`, updates);
    }

    const access = await assertSheetAccess(req.user!.id, sheetId);
    if (!access.ok) {
      return res.status(404).json({ error: 'Sheet not found or access denied' });
    }

    let existingSheet = access.sheet;

    if (!existingSheet) {
      existingSheet = {
        id: sheetId,
        documentId: access.documentId,
        pageNumber: pageNumberFromSheetKey(sheetId),
        hasTakeoffs: false,
        takeoffCount: 0,
        isVisible: true,
        ocrProcessed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Strip identity fields from client payload (prevents hopping to another document/project)
    const { id: _i, documentId: _d, pageNumber: _p, ...safeUpdates } = updates;

    const updatedSheet = {
      ...existingSheet,
      ...safeUpdates,
      id: sheetId,
      documentId: existingSheet.documentId,
      pageNumber: existingSheet.pageNumber,
      updatedAt: new Date().toISOString(),
    };

    const savedSheet = await storage.saveSheet(updatedSheet);

    res.json({ sheet: savedSheet });
  } catch (error) {
    console.error('Error updating sheet metadata:', error);
    res.status(500).json({ error: 'Failed to update sheet metadata' });
  }
});

// Process OCR for a sheet
router.post('/:sheetId/ocr', requireAuth, async (req, res) => {
  try {
    const { sheetId } = req.params;
    const { pageNumbers } = req.body;

    const access = await assertSheetAccess(req.user!.id, sheetId);
    if (!access.ok) {
      return res.status(404).json({ error: 'Sheet not found or access denied' });
    }

    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
      return res.status(400).json({ error: 'pageNumbers must be a non-empty array' });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`Processing OCR for sheet ${sheetId}, pages:`, pageNumbers);
    }

    // Simulate OCR processing
    const results = pageNumbers.map((pageNumber: number) => ({
      pageNumber,
      success: Math.random() > 0.1, // 90% success rate
      extractedText: `Page ${pageNumber} content extracted via OCR...`,
      processingTime: Math.random() * 3 + 1
    }));
    
    // In a real implementation, you'd:
    // 1. Load the PDF file
    // 2. Extract text from specified pages using OCR
    // 3. Save the extracted text to the database
    // 4. Update sheet metadata
    
    res.json({ 
      success: true, 
      results,
      message: 'OCR processing completed'
    });
  } catch (error) {
    console.error('Error processing OCR:', error);
    res.status(500).json({ error: 'Failed to process OCR' });
  }
});



export { router as sheetRoutes };
