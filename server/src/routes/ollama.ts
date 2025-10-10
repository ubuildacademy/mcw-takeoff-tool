import express from 'express';
import axios from 'axios';
import { supabase } from '../supabase';

const router = express.Router();

// Ollama Cloud API configuration
const OLLAMA_BASE_URL = 'https://ollama.com';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;

// Get available models
router.get('/models', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching Ollama models:', error);
    res.status(500).json({ 
      error: 'Failed to fetch models',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check if Ollama is available
router.get('/health', async (req, res) => {
  try {
    if (!OLLAMA_API_KEY) {
      return res.json({ 
        available: false, 
        error: 'Ollama API key not configured'
      });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: {
        'Authorization': `Bearer ${OLLAMA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    res.json({ 
      available: true, 
      models: response.data.models?.length || 0 
    });
  } catch (error) {
    console.error('Ollama health check failed:', error);
    res.json({ 
      available: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { model, messages, stream = false, options = {} } = req.body;

    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Missing required fields: model and messages' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const requestData = {
      model,
      messages,
      stream,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        ...options
      }
    };

    if (stream) {
      // Handle streaming response
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream',
          timeout: 300000 // 5 minutes timeout for long responses
        }
      );

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            res.write(line + '\n');
          }
        }
      });

      response.data.on('end', () => {
        res.end();
      });

      response.data.on('error', (error: Error) => {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Streaming error occurred' });
      });

    } else {
      // Handle non-streaming response
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        requestData,
        {
          headers: {
            'Authorization': `Bearer ${OLLAMA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 300000 // 5 minutes timeout
        }
      );

      res.json(response.data);
    }

  } catch (error) {
    console.error('Error in Ollama chat:', error);
    
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        res.status(503).json({ 
          error: 'Ollama service unavailable',
          details: 'Make sure Ollama is running on localhost:11434'
        });
      } else if (error.response) {
        res.status(error.response.status).json({
          error: 'Ollama API error',
          details: error.response.data
        });
      } else {
        res.status(500).json({
          error: 'Network error',
          details: error.message
        });
      }
    } else {
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Generate embeddings
router.post('/embeddings', async (req, res) => {
  try {
    const { model, prompt } = req.body;

    if (!model || !prompt) {
      return res.status(400).json({ 
        error: 'Missing required fields: model and prompt' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/embeddings`,
      { model, prompt },
      {
        headers: {
          'Authorization': `Bearer ${OLLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 1 minute timeout
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error generating embeddings:', error);
    res.status(500).json({ 
      error: 'Failed to generate embeddings',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Pull a model
router.post('/pull', async (req, res) => {
  try {
    const { name, stream = false } = req.body;

    if (!name) {
      return res.status(400).json({ 
        error: 'Missing required field: name' 
      });
    }

    if (!OLLAMA_API_KEY) {
      return res.status(500).json({ 
        error: 'Ollama API key not configured',
        details: 'Set OLLAMA_API_KEY environment variable'
      });
    }

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      { name, stream },
      {
        headers: {
          'Authorization': `Bearer ${OLLAMA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 1800000 // 30 minutes timeout for model downloads
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error pulling model:', error);
    res.status(500).json({ 
      error: 'Failed to pull model',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Filter OCR text to focus on titleblock information and remove detail callouts
function filterTextForTitleblock(text: string): string {
  if (!text || text.trim().length === 0) return text;
  
  // Split text into lines for processing
  const lines = text.split('\n');
  const filteredLines: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) continue;
    
    // Skip detail callouts and section labels
    if (isDetailCallout(trimmedLine)) {
      console.log(`Filtering out detail callout: "${trimmedLine}"`);
      continue;
    }
    
    // Keep titleblock-related content
    filteredLines.push(line);
  }
  
  return filteredLines.join('\n');
}

// Check if a line is a detail callout that should be filtered out
function isDetailCallout(line: string): boolean {
  const lowerLine = line.toLowerCase();
  
  // Skip lines that start with numbers followed by descriptions (detail callouts)
  // This is the most reliable pattern for detail callouts
  if (/^\d+\s+.*\s+(detail|section|enlarged|typical|connection detail|section detail)/i.test(line)) {
    return true;
  }
  
  // Skip lines that are clearly detail callouts (more specific patterns)
  const detailPatterns = [
    /^\d+\s+.*\s+connection detail/i,
    /^\d+\s+.*\s+section detail/i,
    /^\d+\s+.*\s+enlarged.*detail/i,
    /^\d+\s+.*\s+typical.*detail/i
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

// Analyze document sheets using AI
router.post('/analyze-sheets', async (req, res) => {
  try {
    const { documentId, projectId } = req.body;
    
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

    // Get OCR data for the document using the same service as chat functionality
    const { simpleOcrService } = await import('../services/simpleOcrService');
    const ocrData = await simpleOcrService.getDocumentOCRResults(projectId, documentId);

    console.log('OCR data query result:', {
      hasData: !!ocrData,
      dataLength: ocrData?.length,
      firstItem: ocrData?.[0]
    });

    if (!ocrData || ocrData.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'No OCR data found for this document' })}\n\n`);
      res.end();
      return;
    }

    sendProgress(10, `Found ${ocrData.length} pages to analyze...`);

    // Build context from OCR data - analyze multiple pages to find title block patterns
    let context = `Analyze this construction document set and identify sheet numbers and names from title blocks.\n\n`;
    context += `Document ID: ${documentId}\n`;
    context += `Total Pages: ${ocrData.length}\n\n`;

    // Process all pages in batches to avoid token limits
    const BATCH_SIZE = 10; // Process 10 pages at a time for better AI focus
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
          
          // Limit to reasonable size to avoid token limits - increased to capture more titleblock info
          const limitedText = filteredText.substring(0, 4000);
          batchContext += `Page ${page.pageNumber}:\n${limitedText}\n\n`;
          
          // Debug: log what we're sending to AI
          console.log(`Page ${page.pageNumber} filtered OCR text:`, limitedText.substring(0, 200) + '...');
        }
      });
      
      console.log(`Batch context length: ${batchContext.length} characters`);

      // Get custom prompt from request or use default
      const customPrompt = req.body.customPrompt;
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
- "drawing title:" followed by the COMPLETE sheet title (if "drawing data:" is not present)
- "sheet name:" followed by the sheet name

IMPORTANT: 
- Do NOT reorder sheet numbers based on numerical patterns (A3.02 can come before A3.01)
- Capture the COMPLETE drawing title from the "drawing data:" field, including all descriptive text
- Use the page order exactly as provided in the input

Common sheet number patterns:
- A0.01, A0.02, A1.01, A1.02, A9.02 (Architectural)
- S0.01, S0.02 (Structural) 
- M0.01, M0.02 (Mechanical)
- E0.01, E0.02 (Electrical)
- P0.01, P0.02 (Plumbing)

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

Return your analysis as a JSON array with this exact format for the pages in this batch:
[
  {
    "pageNumber": 1,
    "sheetNumber": "A0.01",
    "sheetName": "Cover Sheet"
  },
  {
    "pageNumber": 2,
    "sheetNumber": "A9.02", 
    "sheetName": "Enlarged Patio Trellis"
  },
  {
    "pageNumber": 13,
    "sheetNumber": "A3.02",
    "sheetName": "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
  },
  {
    "pageNumber": 14,
    "sheetNumber": "A3.01",
    "sheetName": "Overall Reflected Ceiling Plans - First & Second Level"
  }
]

If you cannot determine a sheet number or name for a page, use "Unknown" as the value. Be as accurate as possible based ONLY on the title block information.`;

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
          timeout: 120000 // 2 minutes timeout
        }
      );

      const aiResponse = response.data;
      let batchSheets = [];

      try {
        // Try to parse the AI response as JSON
        const responseText = aiResponse.message?.content || '';
        console.log(`AI Response for batch ${Math.floor(batchStart / BATCH_SIZE) + 1}:`, responseText);
        
        // Extract JSON from the response (in case there's extra text)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          batchSheets = JSON.parse(jsonMatch[0]);
        } else {
          // Try to parse the entire response as JSON
          batchSheets = JSON.parse(responseText);
        }

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
        await new Promise(resolve => setTimeout(resolve, 1000));
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
