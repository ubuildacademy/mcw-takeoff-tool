import express from 'express';
import axios from 'axios';
import { supabase } from '../supabase';

const router = express.Router();

// Environment variables
// Note: VITE_ prefixed vars are for frontend only - backend should use OLLAMA_API_KEY directly
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Get available models
router.get('/models', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching models:', error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        res.status(error.response.status).json({ error: `Ollama API error: ${error.response.data}` });
      } else {
        res.status(500).json({ error: `Network error: ${error.message}` });
      }
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { model, messages, stream, options } = req.body;

    if (!OLLAMA_API_KEY) {
      return res.status(400).json({ error: 'Ollama API key not configured' });
    }

    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing required fields: model and messages' });
    }

    if (stream) {
      // Handle streaming response
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        const response = await axios.post(
          `${OLLAMA_BASE_URL}/api/chat`,
          {
            model,
            messages,
            stream: true,
            options: options || {}
          },
          {
            headers: {
              'Authorization': `Bearer ${OLLAMA_API_KEY}`,
              'Content-Type': 'application/json'
            },
            responseType: 'stream',
            timeout: 120000 // 2 minutes for streaming
          }
        );

        response.data.on('data', (chunk: Buffer) => {
          res.write(chunk);
        });

        response.data.on('end', () => {
          res.end();
        });

        response.data.on('error', (error: Error) => {
          console.error('Streaming error:', error);
          res.end();
        });

      } catch (streamError) {
        console.error('Streaming request error:', streamError);
        res.end();
      }
    } else {
      // Handle non-streaming response
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model,
          messages,
          stream: false,
          options: options || {}
        },
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute for non-streaming
        }
      );

      res.json(response.data);
    }
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    if (axios.isAxiosError(error)) {
      if (error.response) {
        res.status(error.response.status).json({ error: `Ollama API error: ${error.response.data}` });
      } else {
        res.status(500).json({ error: `Network error: ${error.message}` });
      }
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Helper function to filter OCR text for titleblock information
// Less aggressive filtering - keeps context around title block keywords
function filterTextForTitleblock(text: string): string {
  const lines = text.split('\n');
  const contextWindow = 15; // Keep 15 lines before and after title block keywords
  const keepLines = new Set<number>();
  
  // First pass: identify lines with title block keywords
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (isTitleblockKeyword(trimmedLine)) {
      // Keep this line and context around it
      const start = Math.max(0, index - contextWindow);
      const end = Math.min(lines.length - 1, index + contextWindow);
      for (let i = start; i <= end; i++) {
        keepLines.add(i);
      }
    }
    
    // Also keep lines that look like sheet numbers
    if (/^[A-Z]\d+\.\d+$/.test(trimmedLine)) {
      keepLines.add(index);
      // Keep context around sheet numbers too
      const start = Math.max(0, index - 5);
      const end = Math.min(lines.length - 1, index + 5);
      for (let i = start; i <= end; i++) {
        keepLines.add(i);
      }
    }
  });
  
  // Second pass: filter lines, keeping those in our set and filtering out detail callouts
  const filteredLines = lines.filter((line, index) => {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) return false;
    
    // Keep lines in our context window
    if (keepLines.has(index)) {
      // But still filter out detail callouts even in context window
      if (isDetailCallout(trimmedLine)) {
        return false;
      }
      return true;
    }
    
    return false;
  });
  
  return filteredLines.join('\n');
}

// Check if a line is a detail callout that should be filtered out
function isDetailCallout(line: string): boolean {
  const lowerLine = line.toLowerCase();
  
  // Skip lines that start with numbers followed by descriptions (detail callouts)
  if (/^\d+\s+.*\s+(detail|section|enlarged|typical|connection detail|section detail)/i.test(line)) {
    return true;
  }
  
  // Skip other common detail callout patterns
  const detailPatterns = [
    /^\d+\s+.*\s+detail/i,
    /^\d+\s+.*\s+section/i,
    /^\d+\s+.*\s+enlarged/i,
    /^\d+\s+.*\s+typical/i,
    /^\d+\s+.*\s+connection/i,
    /^\d+\s+.*\s+plan/i,
    /^\d+\s+.*\s+elevation/i
  ];
  
  for (const pattern of detailPatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }
  
  // Skip lines that are just numbers or very short technical labels
  if (/^\d+$/.test(line) || (line.length < 8 && /^[A-Z0-9\-\s]+$/i.test(line))) {
    return true;
  }
  
  return false;
}

// Check if a line contains titleblock keywords (should be kept)
function isTitleblockKeyword(line: string): boolean {
  const titleblockKeywords = [
    'sheet number', 'drawing data', 'drawing title', 'sheet name',
    'project number', 'drawn by', 'proj. manager', 'drawing scale',
    'drawing date', 'phase', 'revisions', 'seal', 'title block'
  ];
  
  const lowerLine = line.toLowerCase();
  return titleblockKeywords.some(keyword => lowerLine.includes(keyword));
}

// Analyze document sheets using AI (restored from d5cdad4 with optimizations)
router.post('/analyze-sheets', async (req, res) => {
  try {
    const { documentId, projectId, customPrompt } = req.body;
    
    // Set up Server-Sent Events for progress updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Helper function to send progress updates
    const sendProgress = (progress: number, message: string) => {
      res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
    };

    console.log('Sheet analysis request:', { documentId, projectId });

    if (!documentId || !projectId) {
      res.write(`data: ${JSON.stringify({ error: 'Missing required fields: documentId and projectId' })}\n\n`);
      res.end();
      return;
    }

    if (!OLLAMA_API_KEY) {
      res.write(`data: ${JSON.stringify({ error: 'Ollama API key not configured' })}\n\n`);
      res.end();
      return;
    }

    sendProgress(5, 'Loading document OCR data...');

    // Get OCR data for the document using the simple OCR service
    const { simpleOcrService } = await import('../services/simpleOcrService');
    const ocrData = await simpleOcrService.getDocumentOCRResults(projectId, documentId);

    console.log('OCR data query result:', {
      hasData: !!ocrData,
      dataLength: ocrData?.length,
      firstItem: ocrData?.[0]
    });

    if (!ocrData || ocrData.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'No OCR data found for this document. Please run OCR first.' })}\n\n`);
      res.end();
      return;
    }

    sendProgress(10, `Found ${ocrData.length} pages to analyze...`);

    // Process all pages in batches to avoid token limits
    const BATCH_SIZE = 5; // Reduced batch size for better context preservation
    const totalPages = ocrData.length;
    console.log(`Processing ${totalPages} pages in batches of ${BATCH_SIZE}`);
    
    let allSheets = [];
    
    // Process pages in batches
    const totalBatches = Math.ceil(totalPages / BATCH_SIZE);
    for (let batchStart = 0; batchStart < totalPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalPages);
      const pagesToAnalyze = ocrData.slice(batchStart, batchEnd);
      const currentBatch = Math.floor(batchStart / BATCH_SIZE) + 1;
      
      console.log(`Processing batch ${currentBatch}/${totalBatches}: pages ${batchStart + 1}-${batchEnd}`);
      
      // Send progress update for this batch
      const batchProgress = 15 + (currentBatch / totalBatches) * 70; // 15-85% for batch processing
      sendProgress(Math.round(batchProgress), `Processing batch ${currentBatch}/${totalBatches} (pages ${batchStart + 1}-${batchEnd})...`);
    
      // Build context for this batch
      let batchContext = `Analyze this batch of construction document pages and identify sheet information from title blocks.\n\n`;
      batchContext += `Batch: pages ${batchStart + 1}-${batchEnd} of ${totalPages}\n\n`;
      
      pagesToAnalyze.forEach((page: any) => {
        if (page && page.text && page.text.trim().length > 0) {
          // Filter out detail callouts and section labels to focus on titleblock info
          const filteredText = filterTextForTitleblock(page.text);
          
          // Limit to reasonable size to avoid token limits (increased for longer sheet names)
          const limitedText = filteredText.substring(0, 6000);
          batchContext += `Page ${page.pageNumber}:\n${limitedText}\n\n`;
        }
      });
      
      console.log(`Batch context length: ${batchContext.length} characters`);

      // Use custom prompt from admin panel if provided, otherwise use default
      const systemPrompt = customPrompt || `You are an expert construction document analyst. Extract sheet information from title blocks located on the RIGHT BORDER of each page.

TITLE BLOCK LOCATION:
- Title blocks are ALWAYS on the far right border of construction documents (industry standard)
- Look for text containing "drawing data:" and "sheet number:" labels
- The text may be rotated or in different orientations, but always on the right side

YOUR TASK:
Extract EXACT text from title block fields. Your job is to clean up minor OCR errors (like O→0, I→1) but DO NOT change the actual names or numbers.

For each page, find:
1. Sheet number: Look for "sheet number:" followed by alphanumeric code (e.g., A4.21, A0.01, S0.02)
2. Sheet name: Look for "drawing data:" followed by the COMPLETE title (can be 7-8+ words long)

CRITICAL RULES:
- Use EXACT text from title block - only fix obvious OCR errors (O→0, I→1, l→1, etc.)
- DO NOT reword, shorten, or change sheet names
- DO NOT reorder sheet numbers based on patterns
- Capture COMPLETE sheet names including all words after "drawing data:"
- IGNORE detail callouts (lines starting with numbers like "01 Detail" or "25 Section")

EXAMPLES:
- "drawing data: Enlarged Floor Plan - Ground Floor - East Side" → sheetName: "Enlarged Floor Plan - Ground Floor - East Side"
- "drawing data: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level" → sheetName: "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
- "sheet number: A4.21" → sheetNumber: "A4.21"
- If OCR shows "A4.2l" (lowercase L), correct to "A4.21" (number one)

OUTPUT FORMAT (JSON array):
[ { "pageNumber": 1, "sheetNumber": "A0.01", "sheetName": "Cover Sheet" }, { "pageNumber": 2, "sheetNumber": "A4.21", "sheetName": "Enlarged Floor Plan - Ground Floor - East Side" } ]

If you cannot find a sheet number or name, use "Unknown". Extract exactly what you see, only fixing minor OCR character errors.`;

      // Create AI prompt for sheet analysis
      const messages = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: batchContext
        }
      ];
      
      console.log('Sending batch to AI:', {
        batchNumber: Math.floor(batchStart / BATCH_SIZE) + 1,
        contextLength: batchContext.length,
        firstPageText: batchContext.substring(0, 500) + '...',
        messagesLength: messages.length,
        userMessageLength: messages[1].content.length
      });

      // Call Ollama API for this batch - try multiple models for reliability
      const models = [
        process.env.OLLAMA_MODEL || 'gpt-oss:120b',
        'gpt-oss:20b',
        'gpt-oss:7b',
        'llama3.1:8b'
      ];
      
      let response;
      let lastError;
      
      for (const model of models) {
        try {
          console.log(`Trying sheet analysis with model: ${model}`);
          response = await axios.post(
            `${OLLAMA_BASE_URL}/api/chat`,
            {
              model,
              messages,
              stream: false,
              options: {
                temperature: 0.3, // Lower temperature for more consistent results
                top_p: 0.9
              }
            },
            {
              headers: {
                'Authorization': `Bearer ${OLLAMA_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 60000 // 1 minute timeout per batch
            }
          );
          console.log(`✅ Successfully got response from model: ${model}`);
          break; // Success, exit the loop
        } catch (error) {
          console.error(`❌ Model ${model} failed:`, error instanceof Error ? error.message : 'Unknown error');
          lastError = error;
          continue; // Try next model
        }
      }
      
      if (!response) {
        console.error(`❌ All models failed for batch ${Math.floor(batchStart / BATCH_SIZE) + 1}. Last error: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
        console.log(`Skipping batch ${Math.floor(batchStart / BATCH_SIZE) + 1} due to API failure, continuing with next batch...`);
        continue; // Skip this batch and continue with next one
      }

      const aiResponse = response.data.message?.content || '';
      console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} AI response:`, aiResponse.substring(0, 500) + '...');

      try {
        // Parse the AI response as JSON
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error('No JSON array found in response');
        }

        let batchSheets = JSON.parse(jsonMatch[0]);

        // Validate the response format
        if (!Array.isArray(batchSheets)) {
          throw new Error('Response is not an array');
        }

        // Validate each sheet object
        batchSheets = batchSheets.filter(sheet => 
          sheet && 
          typeof sheet.pageNumber === 'number' && 
          typeof sheet.sheetNumber === 'string' && 
          typeof sheet.sheetName === 'string'
        );

        console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} parsed sheets:`, batchSheets.length, 'sheets found');
        
        // Add to all sheets
        allSheets = allSheets.concat(batchSheets);

      } catch (parseError) {
        console.error(`Error parsing AI response for batch ${Math.floor(batchStart / BATCH_SIZE) + 1}:`, parseError);
        console.error('Raw AI response:', aiResponse);
        
        // Continue with next batch instead of failing completely
        console.log(`Skipping batch ${Math.floor(batchStart / BATCH_SIZE) + 1} due to parse error`);
      }
      
      // Add a small delay between batches to avoid overwhelming the API
      if (batchStart + BATCH_SIZE < totalPages) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Shorter delay for faster processing
      }
    }

    console.log(`Total sheets processed: ${allSheets.length} out of ${totalPages} pages`);

    sendProgress(90, 'Finalizing results...');
    
    // Send final result
    res.write(`data: ${JSON.stringify({
      success: true,
      sheets: allSheets,
      totalPages: ocrData.length,
      analyzedSheets: allSheets.length,
      progress: 100,
      message: 'Complete!'
    })}\n\n`);
    
    res.end();

  } catch (error) {
    console.error('Error in sheet analysis:', error);
    
    let errorMessage = 'Unknown error';
    if (axios.isAxiosError(error)) {
      if (error.response) {
        errorMessage = `AI service error: ${error.response.data}`;
      } else {
        errorMessage = `Network error: ${error.message}`;
      }
    } else {
      errorMessage = `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
    
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  }
});

export default router;
