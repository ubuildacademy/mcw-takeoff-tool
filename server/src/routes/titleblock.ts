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

      // Extract text from each region separately and use LLM to extract values
      const extractedSheets = await extractTitleblockWithLLM(
        pdfPath,
        pageNumbers,
        sheetNumberRegion,
        sheetNameRegion
      );

      console.log('[Titleblock] LLM extraction result:', {
        documentId,
        sheetsCount: extractedSheets.length,
        firstFewSheets: extractedSheets.slice(0, 3),
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

/**
 * Extract titleblock information using LLM for each region separately
 */
async function extractTitleblockWithLLM(
  pdfPath: string,
  pageNumbers: number[],
  sheetNumberRegion: NormalizedBox,
  sheetNameRegion: NormalizedBox
): Promise<Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>> {
  const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
  const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || '';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b';

  const results: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];

  // Process pages in batches
  const BATCH_SIZE = 5; // Smaller batches for LLM processing
  for (let i = 0; i < pageNumbers.length; i += BATCH_SIZE) {
    const batch = pageNumbers.slice(i, i + BATCH_SIZE);
    console.log(`[Titleblock LLM] Processing batch: pages ${batch.join(',')}`);

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

        batchTexts.push({
          pageNumber,
          sheetNumberText: sheetNumberText || '',
          sheetNameText: sheetNameText || '',
        });
      }

      // Send to LLM for extraction
      const batchResults = await extractWithLLM(batchTexts, OLLAMA_BASE_URL, OLLAMA_API_KEY, OLLAMA_MODEL);
      results.push(...batchResults);
    } catch (error) {
      console.error(`[Titleblock LLM] Error processing batch ${batch.join(',')}:`, error);
      // Add Unknown entries for failed batch
      for (const pageNumber of batch) {
        results.push({
          pageNumber,
          sheetNumber: 'Unknown',
          sheetName: 'Unknown',
        });
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
  // Build context for LLM
  let context = 'Extract sheet numbers and names from the following titleblock text regions.\n\n';
  context += 'For each page, I will provide two text regions:\n';
  context += '1. SHEET_NUMBER_REGION: Text extracted from the sheet number field\n';
  context += '2. SHEET_NAME_REGION: Text extracted from the sheet name field\n\n';
  context += 'Your task is to extract:\n';
  context += '- Sheet number: Look for alphanumeric codes like "A4.21", "A0.01", "S0.02", etc.\n';
  context += '- Sheet name: Look for drawing titles, names, or descriptions\n\n';
  context += 'Rules:\n';
  context += '- Fix minor OCR errors (O→0, I→1, l→1)\n';
  context += '- Use "Unknown" if you cannot find a value\n';
  context += '- Return EXACT text, do not reword or shorten\n\n';

  batchTexts.forEach(({ pageNumber, sheetNumberText, sheetNameText }) => {
    context += `--- PAGE ${pageNumber} ---\n`;
    context += `SHEET_NUMBER_REGION:\n${sheetNumberText || '(empty)'}\n\n`;
    context += `SHEET_NAME_REGION:\n${sheetNameText || '(empty)'}\n\n`;
  });

  const systemPrompt = `You are an expert at extracting construction document sheet information. 
Extract sheet numbers and names from the provided text regions. 
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

