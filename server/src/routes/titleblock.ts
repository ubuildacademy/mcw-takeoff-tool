import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { supabase, TABLES } from '../supabase';
import { storage, StoredSheet } from '../storage';
import { titleblockExtractionService } from '../services/titleblockExtractionService';
import pdfParse from 'pdf-parse';

const router = express.Router();

interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TitleblockConfig {
  sheetNumberField: NormalizedBox;
  sheetNameField: NormalizedBox;
}

/**
 * POST /api/titleblock/extract
 *
 * Body: {
 *   projectId: string;
 *   documentIds: string[];
 *   titleblockConfig: {
 *     sheetNumberField: { x, y, width, height };
 *     sheetNameField: { x, y, width, height };
 *   }
 * }
 *
 * For each document:
 * - Downloads the PDF from Supabase Storage to a temp path
 * - Runs Python-based titleblock extraction constrained to the provided region
 * - Saves sheetNumber and sheetName for each page via storage.saveSheet
 * - Persists titleblockConfig on each sheet for future use
 */
router.post('/extract', async (req, res) => {
  try {
    const { projectId, documentIds, titleblockConfig } = req.body as {
      projectId?: string;
      documentIds?: string[];
      titleblockConfig?: TitleblockConfig;
    };

    if (!projectId || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'projectId and documentIds[] are required' });
    }

    if (
      !titleblockConfig ||
      !titleblockConfig.sheetNumberField ||
      !titleblockConfig.sheetNameField
    ) {
      return res.status(400).json({ error: 'titleblockConfig with sheetNumberField and sheetNameField is required' });
    }

    // Compute a single combined region that covers both fields.
    const boxes: NormalizedBox[] = [
      titleblockConfig.sheetNumberField,
      titleblockConfig.sheetNameField,
    ];

    const minX = Math.max(0, Math.min(...boxes.map(b => b.x)));
    const minY = Math.max(0, Math.min(...boxes.map(b => b.y)));
    const maxX = Math.min(1, Math.max(...boxes.map(b => b.x + b.width)));
    const maxY = Math.min(1, Math.max(...boxes.map(b => b.y + b.height)));

    const combinedRegion: NormalizedBox = {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };

    const results: Array<{
      documentId: string;
      totalPages: number;
      sheets: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>;
    }> = [];

    for (const documentId of documentIds) {
      // Look up document record to get storage path
      const { data: documentData, error: documentError } = await supabase
        .from(TABLES.FILES)
        .select('filename, path')
        .eq('id', documentId)
        .eq('project_id', projectId)
        .single();

      if (documentError || !documentData) {
        console.error('Titleblock extraction: document not found', { documentId, projectId, error: documentError });
        continue;
      }

      const storagePath = documentData.path;

      // Download PDF from Supabase Storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('project-files')
        .download(storagePath);

      if (downloadError || !fileData) {
        console.error('Titleblock extraction: failed to download PDF from storage', {
          documentId,
          storagePath,
          error: downloadError,
        });
        continue;
      }

      // Save to temporary file
      const tempDir = path.join(process.cwd(), 'server', 'temp', 'titleblock-pdf');
      await fs.ensureDir(tempDir);
      const pdfPath = path.join(tempDir, `${documentId}.pdf`);

      const arrayBuffer = await fileData.arrayBuffer();
      await fs.writeFile(pdfPath, Buffer.from(arrayBuffer));

      // Determine total pages using pdf-parse
      const dataBuffer = await fs.readFile(pdfPath);
      const pdfData = await pdfParse(dataBuffer);
      const totalPages = pdfData.numpages || 0;

      if (!totalPages || totalPages < 1) {
        console.warn('Titleblock extraction: PDF has no pages', { documentId, pdfPath });
        continue;
      }

      const pageNumbers = Array.from({ length: totalPages }, (_, idx) => idx + 1);

      // Run Python-based extraction constrained to the combined region
      console.log('[Titleblock] Starting extraction for document:', {
        documentId,
        totalPages,
        combinedRegion,
        sheetNumberField: titleblockConfig.sheetNumberField,
        sheetNameField: titleblockConfig.sheetNameField,
      });
      
      const extractionResult = await titleblockExtractionService.extractSheets(
        pdfPath,
        pageNumbers,
        10,
        combinedRegion
      );

      console.log('[Titleblock] Extraction result:', {
        documentId,
        success: extractionResult.success,
        sheetsCount: extractionResult.sheets.length,
        error: extractionResult.error,
        firstFewSheets: extractionResult.sheets.slice(0, 3),
      });

      if (!extractionResult.success || !extractionResult.sheets.length) {
        console.warn('Titleblock extraction: no sheets extracted', {
          documentId,
          pdfPath,
          error: extractionResult.error,
        });
        continue;
      }

      // Persist sheet info and titleblockConfig to DB
      const savedSheets: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];

      for (const sheet of extractionResult.sheets) {
        const sheetId = `${documentId}-${sheet.pageNumber}`;

        let existingSheet: StoredSheet | null = null;
        try {
          existingSheet = await storage.getSheet(sheetId);
        } catch (e) {
          console.warn('Titleblock extraction: error loading sheet, creating new', {
            sheetId,
            error: e,
          });
        }

        const baseSheet: StoredSheet = existingSheet || {
          id: sheetId,
          documentId,
          pageNumber: sheet.pageNumber,
          sheetNumber: undefined,
          sheetName: undefined,
          extractedText: undefined,
          hasTakeoffs: false,
          takeoffCount: 0,
          isVisible: true,
          ocrProcessed: false,
          titleblockConfig: undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const updatedSheet: StoredSheet = {
          ...baseSheet,
          sheetNumber: sheet.sheetNumber && sheet.sheetNumber !== 'Unknown'
            ? sheet.sheetNumber
            : baseSheet.sheetNumber,
          sheetName: sheet.sheetName && sheet.sheetName !== 'Unknown'
            ? sheet.sheetName
            : baseSheet.sheetName,
          titleblockConfig: titleblockConfig,
          updatedAt: new Date().toISOString(),
        };

        console.log('[Titleblock] Saving sheet:', {
          sheetId,
          pageNumber: sheet.pageNumber,
          extracted: { sheetNumber: sheet.sheetNumber, sheetName: sheet.sheetName },
          before: { sheetNumber: baseSheet.sheetNumber, sheetName: baseSheet.sheetName },
          after: { sheetNumber: updatedSheet.sheetNumber, sheetName: updatedSheet.sheetName },
        });

        const saved = await storage.saveSheet(updatedSheet);
        
        console.log('[Titleblock] Sheet saved:', {
          sheetId: saved.id,
          sheetNumber: saved.sheetNumber,
          sheetName: saved.sheetName,
        });
        
        savedSheets.push({
          pageNumber: saved.pageNumber,
          sheetNumber: saved.sheetNumber || 'Unknown',
          sheetName: saved.sheetName || 'Unknown',
        });
      }

      results.push({
        documentId,
        totalPages,
        sheets: savedSheets,
      });
    }

    return res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Error in titleblock extraction:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

