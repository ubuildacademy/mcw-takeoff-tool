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
function filterTextForTitleblock(text: string): string {
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) return false;
    
    // Keep lines that contain titleblock keywords
    if (isTitleblockKeyword(trimmedLine)) {
      return true;
    }
    
    // Skip detail callouts
    if (isDetailCallout(trimmedLine)) {
      return false;
    }
    
    // Keep lines that look like sheet numbers (A0.01, A1.02, etc.)
    if (/^[A-Z]\d+\.\d+$/.test(trimmedLine)) {
      return true;
    }
    
    // Keep lines that look like drawing titles (longer descriptive text)
    if (trimmedLine.length > 10 && !isDetailCallout(trimmedLine)) {
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
    const BATCH_SIZE = 8; // Optimized batch size for faster processing
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
          
          // Limit to reasonable size to avoid token limits
          const limitedText = filteredText.substring(0, 3000);
          batchContext += `Page ${page.pageNumber}:\n${limitedText}\n\n`;
        }
      });
      
      console.log(`Batch context length: ${batchContext.length} characters`);

      // Use custom prompt from admin panel if provided, otherwise use default
      const systemPrompt = customPrompt || `You are an expert construction document analyst. Your task is to analyze construction drawings and identify sheet information from title blocks.

CRITICAL INSTRUCTIONS:
- Focus EXCLUSIVELY on title block information
- IGNORE detail callouts that start with numbers (like "01 Patio Trellis - Enlarged Floor Plan" or "25 Sun Shade - Connection Detail")
- IGNORE drawing annotations and labels that are clearly detail references
- ONLY look for the main sheet title and sheet number from the title block
- IMPORTANT: Use the EXACT page order as provided - do not reorder sheet numbers based on numerical patterns
- IMPORTANT: Do NOT ignore legitimate sheet titles that contain words like "details", "sections", "typical", etc.

For each page, identify ONLY:
1. Sheet number (e.g., A0.01, A0.02, A1.01, A9.02, etc.) - use the EXACT sheet number found in the title block
2. Sheet name/description - capture the COMPLETE title from the drawing data field

Look specifically for text near these title block labels:
- "sheet number:" followed by the sheet number (use exactly as found)
- "drawing data:" followed by the COMPLETE sheet title (capture the full title, not just the first part)
- "drawing title:" followed by the COMPLETE sheet title
- "sheet name:" followed by the sheet name

IMPORTANT: 
- Do NOT reorder sheet numbers based on numerical patterns (A3.02 can come before A3.01 if it appears that way in the document set)
- Capture the COMPLETE drawing title from the "drawing data:" field, including all descriptive text
- Use the page order exactly as provided in the input

Common sheet number patterns:
- A0.01, A0.02, A1.01, A1.02, A9.02 (Architectural)
- S0.01, S0.02 (Structural) 
- M0.01, M0.02 (Mechanical)
- E0.01, E0.02 (Electrical)
- P0.01, P0.02 (Plumbing)
- Sheet numbers may be in formats not listed here; usually in easily identified patterns. 

Common sheet names:
- "Cover Sheet", "Title Sheet", "Index"
- "Ground Floor Plan", "First Floor Plan", "Second Floor Plan"
- "Roof Plan", "Elevations", "Exterior Elevations"
- "Enlarged Patio Trellis", "Details", "Schedules"
- "Specifications", "Wall Types", "Finishes"

IMPORTANT: 
- Do NOT use detail callout titles like "01 Patio Trellis - Enlarged Floor Plan" as the sheet name
- DO use legitimate sheet titles like "Typical Wall Details", "Section Details", "Enlarged Plans", etc.
- Look for the main sheet title in the title block, such as "Enlarged Patio Trellis" or "Typical Details"

EXAMPLE: If you see "drawing data: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level", 
use the COMPLETE title "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level", not just "Overall Reflected Ceiling Plans".

Return your analysis as a JSON array with this exact format for the pages in this batch: [ { "pageNumber": 1, "sheetNumber": "A0.01", "sheetName": "Cover Sheet" }, { "pageNumber": 2, "sheetNumber": "A9.02", "sheetName": "Enlarged Patio Trellis" }, { "pageNumber": 13, "sheetNumber": "A3.02", "sheetName": "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level" }, { "pageNumber": 14, "sheetNumber": "A3.01", "sheetName": "Overall Reflected Ceiling Plans - First & Second Level" } ] If you cannot determine a sheet number or name for a page, use "Unknown" as the value. Be as accurate as possible based ONLY on the title block information.`;

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

      // Call Ollama API for this batch
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model: 'gpt-oss:120b',
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
