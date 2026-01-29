import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
import { requireAuth, hasProjectAccess, isAdmin, validateUUIDParam } from '../middleware';

const router = express.Router();

// Interface for sheet metadata
interface SheetMetadata {
  id: string;
  documentId: string;
  pageNumber: number;
  sheetNumber?: string;
  sheetName?: string;
  extractedText?: string;
  hasTakeoffs: boolean;
  takeoffCount: number;
  isVisible: boolean;
  ocrProcessed: boolean;
  titleblockConfig?: {
    sheetNumberField: { x: number; y: number; width: number; height: number };
    sheetNameField: { x: number; y: number; width: number; height: number };
  };
  createdAt: string;
  updatedAt: string;
}

// Interface for document metadata
interface DocumentMetadata {
  id: string;
  projectId: string;
  name: string;
  totalPages: number;
  titleblockConfig?: {
    sheetNumberField: { x: number; y: number; width: number; height: number };
    sheetNameField: { x: number; y: number; width: number; height: number };
  };
  createdAt: string;
  updatedAt: string;
}

// Get all sheets for a project
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

// Get specific sheet metadata
router.get('/:sheetId', requireAuth, async (req, res) => {
  try {
    const { sheetId } = req.params;
    
    // Load sheet from database
    const sheet = await storage.getSheet(sheetId);
    
    if (!sheet) {
      // Return a default sheet structure for new sheets
      const parts = sheetId.split('-');
      const pageNumber = parseInt(parts[parts.length - 1]) || 1;
      const documentId = parts.slice(0, -1).join('-');
      
      const defaultSheet = {
        id: sheetId,
        documentId: documentId,
        pageNumber: pageNumber,
        hasTakeoffs: false,
        takeoffCount: 0,
        isVisible: true,
        ocrProcessed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
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
    const updates = req.body;
    
    console.log(`Updating sheet ${sheetId}:`, updates);
    
    // Get existing sheet or create new one
    let existingSheet = await storage.getSheet(sheetId);
    
    if (!existingSheet) {
      // Create new sheet if it doesn't exist
      // Extract documentId and pageNumber from sheetId (format: documentId-pageNumber)
      const parts = sheetId.split('-');
      const pageNumber = parseInt(parts[parts.length - 1]) || 1;
      const documentId = parts.slice(0, -1).join('-');
      
      existingSheet = {
        id: sheetId,
        documentId: updates.documentId || documentId,
        pageNumber: updates.pageNumber || pageNumber,
        hasTakeoffs: false,
        takeoffCount: 0,
        isVisible: true,
        ocrProcessed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    
    // Update the sheet with new data
    const updatedSheet = {
      ...existingSheet,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    // Save to database
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
    
    console.log(`Processing OCR for sheet ${sheetId}, pages:`, pageNumbers);
    
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
