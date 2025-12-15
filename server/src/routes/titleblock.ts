import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
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

    // Keep both regions separate for individual extraction
    const sheetNumberRegion = titleblockConfig.sheetNumberField;
    const sheetNameRegion = titleblockConfig.sheetNameField;

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

      console.log('[Titleblock] Starting LLM-based extraction for document:', {
        documentId,
        totalPages,
        sheetNumberRegion,
        sheetNameRegion,
      });
      
      // Validate regions
      if (!sheetNumberRegion || !sheetNameRegion) {
        console.error('[Titleblock] Missing regions:', { sheetNumberRegion, sheetNameRegion });
        throw new Error('Missing required titleblock regions');
      }
      
      if (sheetNumberRegion.width <= 0 || sheetNumberRegion.height <= 0 || 
          sheetNameRegion.width <= 0 || sheetNameRegion.height <= 0) {
        console.error('[Titleblock] Invalid region dimensions:', {
          sheetNumberRegion,
          sheetNameRegion,
        });
        throw new Error('Invalid region dimensions - regions must have width and height > 0');
      }

      // Extract text from each region separately and use LLM to extract values
      // Pass a progress callback to update status during extraction
      let extractedSheets: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];
      
      try {
        console.log('[Titleblock] About to call extractTitleblockWithLLM with:', {
          pdfPath,
          pageCount: pageNumbers.length,
          sheetNumberRegion,
          sheetNameRegion,
        });
        
        extractedSheets = await extractTitleblockWithLLM(
          pdfPath,
          pageNumbers,
          sheetNumberRegion,
          sheetNameRegion,
          (currentBatch: number, totalBatches: number, processedPages: number) => {
            // Calculate progress: 10% for setup, 80% for extraction, 10% for saving
            const extractionProgress = 10 + Math.round((processedPages / totalPages) * 80);
            console.log(`[Titleblock] Progress update: batch ${currentBatch}/${totalBatches}, pages ${processedPages}/${totalPages}, progress ${extractionProgress}%`);
          }
        );
        
        console.log('[Titleblock] extractTitleblockWithLLM completed, got results:', {
          documentId,
          sheetsCount: extractedSheets.length,
          firstFewSheets: extractedSheets.slice(0, 3),
          extractedCount: extractedSheets.filter(s => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length,
        });
      } catch (extractionError) {
        console.error('[Titleblock] ERROR in extractTitleblockWithLLM:', {
          error: extractionError,
          message: extractionError instanceof Error ? extractionError.message : String(extractionError),
          stack: extractionError instanceof Error ? extractionError.stack : undefined,
          documentId,
          pdfPath,
        });
        // Create Unknown entries for all pages as fallback
        extractedSheets = pageNumbers.map(pageNum => ({
          pageNumber: pageNum,
          sheetNumber: 'Unknown',
          sheetName: 'Unknown',
        }));
      }

      console.log('[Titleblock] LLM extraction result:', {
        documentId,
        sheetsCount: extractedSheets.length,
        firstFewSheets: extractedSheets.slice(0, 3),
        extractedCount: extractedSheets.filter(s => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length,
      });

      if (!extractedSheets.length) {
        console.warn('Titleblock extraction: no sheets extracted', {
          documentId,
          pdfPath,
        });
        continue;
      }

      // Persist sheet info and titleblockConfig to DB
      const savedSheets: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];

      for (const sheet of extractedSheets) {
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

        // Always update with extracted values, even if "Unknown" (to clear bad data)
        // But prefer non-Unknown values if available
        const updatedSheet: StoredSheet = {
          ...baseSheet,
          sheetNumber: sheet.sheetNumber && sheet.sheetNumber !== 'Unknown'
            ? sheet.sheetNumber
            : (baseSheet.sheetNumber && baseSheet.sheetNumber !== 'DRAW1NG' && baseSheet.sheetNumber !== 'revisions :project info')
              ? baseSheet.sheetNumber  // Keep existing if it's not a known bad value
              : sheet.sheetNumber || undefined,  // Use extracted value (even if Unknown) to clear bad data
          sheetName: sheet.sheetName && sheet.sheetName !== 'Unknown'
            ? sheet.sheetName
            : (baseSheet.sheetName && baseSheet.sheetName !== 'DRAW1NG' && baseSheet.sheetName !== 'revisions :project info')
              ? baseSheet.sheetName  // Keep existing if it's not a known bad value
              : sheet.sheetName || undefined,  // Use extracted value (even if Unknown) to clear bad data
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

/**
 * Extract titleblock information using LLM for each region separately
 */
async function extractTitleblockWithLLM(
  pdfPath: string,
  pageNumbers: number[],
  sheetNumberRegion: NormalizedBox,
  sheetNameRegion: NormalizedBox,
  onProgress?: (currentBatch: number, totalBatches: number, processedPages: number) => void
): Promise<Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>> {
  const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
  const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || '';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b';

  const results: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];

  // Process pages in batches
  const BATCH_SIZE = 5; // Smaller batches for LLM processing
  const totalBatches = Math.ceil(pageNumbers.length / BATCH_SIZE);
  
  for (let i = 0; i < pageNumbers.length; i += BATCH_SIZE) {
    const batch = pageNumbers.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[Titleblock LLM] Processing batch ${currentBatch}/${totalBatches}: pages ${batch.join(',')}`);

    try {
      // Extract text from each region for all pages in batch
      const batchTexts: Array<{
        pageNumber: number;
        sheetNumberText: string;
        sheetNameText: string;
      }> = [];

      for (const pageNumber of batch) {
        // Extract text from sheet number region
        const sheetNumberText = await titleblockExtractionService.extractTextFromRegion(
          pdfPath,
          pageNumber,
          sheetNumberRegion
        );

        // Extract text from sheet name region
        const sheetNameText = await titleblockExtractionService.extractTextFromRegion(
          pdfPath,
          pageNumber,
          sheetNameRegion
        );

        console.log(`[Titleblock LLM] Page ${pageNumber} extracted text:`, {
          sheetNumberText: sheetNumberText?.substring(0, 100) || '(empty)',
          sheetNameText: sheetNameText?.substring(0, 100) || '(empty)',
          sheetNumberLength: sheetNumberText?.length || 0,
          sheetNameLength: sheetNameText?.length || 0,
        });

        batchTexts.push({
          pageNumber,
          sheetNumberText: sheetNumberText || '',
          sheetNameText: sheetNameText || '',
        });
      }

      // Send to LLM for extraction
      console.log(`[Titleblock LLM] Sending batch ${currentBatch} to LLM with ${batchTexts.length} pages`);
      const batchResults = await extractWithLLM(batchTexts, OLLAMA_BASE_URL, OLLAMA_API_KEY, OLLAMA_MODEL);
      console.log(`[Titleblock LLM] Batch ${currentBatch} results:`, batchResults.map(r => ({
        page: r.pageNumber,
        sheetNumber: r.sheetNumber,
        sheetName: r.sheetName,
      })));
      results.push(...batchResults);
      
      // Update progress
      if (onProgress) {
        onProgress(currentBatch, totalBatches, results.length);
      }
    } catch (error) {
      console.error(`[Titleblock LLM] Error processing batch ${currentBatch} (pages ${batch.join(',')}):`, error);
      // Add Unknown entries for failed batch
      for (const pageNumber of batch) {
        results.push({
          pageNumber,
          sheetNumber: 'Unknown',
          sheetName: 'Unknown',
        });
      }
      
      // Update progress even on error
      if (onProgress) {
        onProgress(currentBatch, totalBatches, results.length);
      }
    }
  }

  return results;
}

/**
 * Use LLM to extract sheet numbers and names from extracted text
 */
async function extractWithLLM(
  batchTexts: Array<{ pageNumber: number; sheetNumberText: string; sheetNameText: string }>,
  ollamaBaseUrl: string,
  ollamaApiKey: string,
  model: string
): Promise<Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>> {
  // Load custom prompts from settings
  let sheetNumberPrompt: string | null = null;
  let sheetNamePrompt: string | null = null;
  
  try {
    const { supabase, TABLES } = await import('../supabase');
    const { data: settings } = await supabase
      .from(TABLES.APP_SETTINGS)
      .select('key, value')
      .in('key', ['titleblock-sheet-number-prompt', 'titleblock-sheet-name-prompt']);
    
    if (settings) {
      const numberSetting = settings.find(s => s.key === 'titleblock-sheet-number-prompt');
      const nameSetting = settings.find(s => s.key === 'titleblock-sheet-name-prompt');
      sheetNumberPrompt = numberSetting?.value || null;
      sheetNamePrompt = nameSetting?.value || null;
    }
  } catch (error) {
    console.warn('[Titleblock LLM] Failed to load custom prompts, using defaults:', error);
  }

  // Use default prompts if custom ones aren't available
  const defaultSheetNumberPrompt = `You are an expert at extracting sheet numbers from construction document titleblocks.

Your task is to extract the sheet number from the provided text region. The text was extracted from a specific region of the titleblock that should contain the sheet number.

INSTRUCTIONS:
- Look for alphanumeric codes like "A4.21", "A0.01", "S0.02", "M1.15", etc.
- Common patterns: Letter(s) followed by numbers, often with dots (e.g., A4.21, S0.02)
- May appear with labels like "sheet number:", "sheet #:", "dwg no:", or standalone
- Fix minor OCR errors (O→0, I→1, l→1, etc.)
- Return ONLY the sheet number, nothing else
- If you cannot find a sheet number, return "Unknown"

Examples:
- "sheet number: A4.21" → "A4.21"
- "A4.2l" (OCR error) → "A4.21"
- "Sheet # S0.02" → "S0.02"
- "DWG NO: M1.15" → "M1.15"
- Empty or unclear text → "Unknown"`;

  const defaultSheetNamePrompt = `You are an expert at extracting sheet names/titles from construction document titleblocks.

Your task is to extract the sheet name from the provided text region. The text was extracted from a specific region of the titleblock that should contain the sheet name/title.

INSTRUCTIONS:
- Look for drawing titles, names, or descriptions
- May appear with labels like "drawing data:", "drawing title:", "sheet title:", "sheet name:", or standalone
- Capture the COMPLETE title, including all descriptive text
- Sheet names can span multiple lines - capture everything until you hit another label or empty line
- Fix minor OCR errors (O→0, I→1, l→1, etc.)
- Return ONLY the sheet name, nothing else
- Do NOT include the label itself (e.g., don't include "drawing data:" in the result)
- If you cannot find a sheet name, return "Unknown"

Examples:
- "drawing data: Enlarged Floor Plan - Ground Floor - East Side" → "Enlarged Floor Plan - Ground Floor - East Side"
- "drawing title: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level" → "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
- "sheet name: Cover Sheet" → "Cover Sheet"
- "Floor Plan\nGround Level" (multi-line) → "Floor Plan Ground Level"
- Empty or unclear text → "Unknown"`;

  const finalSheetNumberPrompt = sheetNumberPrompt || defaultSheetNumberPrompt;
  const finalSheetNamePrompt = sheetNamePrompt || defaultSheetNamePrompt;

  // Build context for LLM
  let context = 'Extract sheet numbers and names from the following titleblock text regions.\n\n';
  context += 'For each page, I will provide two text regions:\n';
  context += '1. SHEET_NUMBER_REGION: Text extracted from the sheet number field\n';
  context += '2. SHEET_NAME_REGION: Text extracted from the sheet name field\n\n';
  context += `SHEET NUMBER EXTRACTION INSTRUCTIONS:\n${finalSheetNumberPrompt}\n\n`;
  context += `SHEET NAME EXTRACTION INSTRUCTIONS:\n${finalSheetNamePrompt}\n\n`;

  batchTexts.forEach(({ pageNumber, sheetNumberText, sheetNameText }) => {
    context += `--- PAGE ${pageNumber} ---\n`;
    context += `SHEET_NUMBER_REGION:\n${sheetNumberText || '(empty)'}\n\n`;
    context += `SHEET_NAME_REGION:\n${sheetNameText || '(empty)'}\n\n`;
  });
  
  // Log sample of what we're sending to LLM
  if (batchTexts.length > 0) {
    const sample = batchTexts[0];
    console.log(`[Titleblock LLM] Sample input for page ${sample.pageNumber}:`, {
      sheetNumberTextLength: sample.sheetNumberText.length,
      sheetNameTextLength: sample.sheetNameText.length,
      sheetNumberPreview: sample.sheetNumberText.substring(0, 200),
      sheetNamePreview: sample.sheetNameText.substring(0, 200),
    });
  }

  const systemPrompt = `You are an expert at extracting construction document sheet information. 
Extract sheet numbers and names from the provided text regions using the instructions provided.
Return a JSON array with format: [{"pageNumber": 1, "sheetNumber": "A4.21", "sheetName": "Floor Plan"}, ...]
Use "Unknown" if a value cannot be determined.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context },
  ];

  const models = [model, 'gpt-oss:20b', 'gpt-oss:7b', 'llama3.1:8b'];
  let response;
  let lastError;

  for (const tryModel of models) {
    try {
      console.log(`[Titleblock LLM] Trying model: ${tryModel}`);
      response = await axios.post(
        `${ollamaBaseUrl}/api/chat`,
        {
          model: tryModel,
          messages,
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
          },
        },
        {
          headers: {
            ...(ollamaApiKey ? { Authorization: `Bearer ${ollamaApiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      console.log(`[Titleblock LLM] Success with model: ${tryModel}`);
      break;
    } catch (error) {
      console.error(`[Titleblock LLM] Model ${tryModel} failed:`, error instanceof Error ? error.message : 'Unknown error');
      lastError = error;
      continue;
    }
  }

  if (!response) {
    console.error('[Titleblock LLM] All models failed');
    // Return Unknown for all pages
    return batchTexts.map(({ pageNumber }) => ({
      pageNumber,
      sheetNumber: 'Unknown',
      sheetName: 'Unknown',
    }));
  }

  const aiResponse = response.data.message?.content || '';
  console.log(`[Titleblock LLM] AI response preview:`, aiResponse.substring(0, 500));
  console.log(`[Titleblock LLM] Full AI response length:`, aiResponse.length);
  
  // Log the input context for debugging
  console.log(`[Titleblock LLM] Input context preview:`, context.substring(0, 500));

  try {
    // Parse JSON from response
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }

    // Validate and map results
    const results: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];
    const expectedPages = new Set(batchTexts.map((b) => b.pageNumber));

    for (const item of parsed) {
      if (
        typeof item.pageNumber === 'number' &&
        typeof item.sheetNumber === 'string' &&
        typeof item.sheetName === 'string' &&
        expectedPages.has(item.pageNumber)
      ) {
        results.push({
          pageNumber: item.pageNumber,
          sheetNumber: item.sheetNumber.trim() || 'Unknown',
          sheetName: item.sheetName.trim() || 'Unknown',
        });
      }
    }

    // Ensure all pages are represented
    for (const { pageNumber } of batchTexts) {
      if (!results.find((r) => r.pageNumber === pageNumber)) {
        results.push({
          pageNumber,
          sheetNumber: 'Unknown',
          sheetName: 'Unknown',
        });
      }
    }

    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  } catch (error) {
    console.error('[Titleblock LLM] Failed to parse LLM response:', error);
    // Return Unknown for all pages
    return batchTexts.map(({ pageNumber }) => ({
      pageNumber,
      sheetNumber: 'Unknown',
      sheetName: 'Unknown',
    }));
  }
}

export default router;

