import express from 'express';
import axios from 'axios';
import { supabase } from '../supabase';
import * as path from 'path';
import * as fs from 'fs-extra';

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
// Excludes revisions block to avoid confusion
function filterTextForTitleblock(text: string): string {
  const lines = text.split('\n');
  const contextWindow = 15; // Keep 15 lines before and after title block keywords
  const keepLines = new Set<number>();
  
  // First pass: identify lines with title block keywords (excluding revisions)
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    const lowerLine = trimmedLine.toLowerCase();
    
    // Skip revisions block lines - they're not sheet identification
    if (/^revisions?$/i.test(trimmedLine) || 
        /revision\s*date/i.test(lowerLine) ||
        /revision\s*issuance/i.test(lowerLine) ||
        /^rev\s*\d+/i.test(lowerLine)) {
      return; // Don't keep revisions block lines
    }
    
    if (isTitleblockKeyword(trimmedLine)) {
      // Keep this line and context around it
      const start = Math.max(0, index - contextWindow);
      const end = Math.min(lines.length - 1, index + contextWindow);
      for (let i = start; i <= end; i++) {
        // Don't add revisions block lines even in context
        const contextLine = lines[i]?.trim().toLowerCase() || '';
        if (!/^revisions?$/.test(contextLine) && 
            !/revision\s*date/i.test(contextLine) &&
            !/revision\s*issuance/i.test(contextLine)) {
          keepLines.add(i);
        }
      }
    }
    
    // Also keep lines that look like sheet numbers
    if (/^[A-Z]\d+\.\d+$/.test(trimmedLine)) {
      keepLines.add(index);
      // Keep context around sheet numbers too
      const start = Math.max(0, index - 5);
      const end = Math.min(lines.length - 1, index + 5);
      for (let i = start; i <= end; i++) {
        // Don't add revisions block lines even in context
        const contextLine = lines[i]?.trim().toLowerCase() || '';
        if (!/^revisions?$/.test(contextLine) && 
            !/revision\s*date/i.test(contextLine) &&
            !/revision\s*issuance/i.test(contextLine)) {
          keepLines.add(i);
        }
      }
    }
  });
  
  // Second pass: filter lines, keeping those in our set and filtering out detail callouts
  const filteredLines = lines.filter((line, index) => {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) return false;
    
    // Skip revisions block lines
    const lowerLine = trimmedLine.toLowerCase();
    if (/^revisions?$/i.test(trimmedLine) || 
        /revision\s*date/i.test(lowerLine) ||
        /revision\s*issuance/i.test(lowerLine) ||
        /^rev\s*\d+/i.test(lowerLine)) {
      return false;
    }
    
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
// REFINED: Only use keywords that are directly related to sheet identification
// Removed: 'project number', 'drawn by', 'proj. manager', 'drawing scale', 'drawing date', 'phase', 'seal'
// These were causing confusion - they're metadata, not sheet identification fields
function isTitleblockKeyword(line: string): boolean {
  const titleblockKeywords = [
    'sheet number', 'drawing data', 'drawing title', 'sheet name', 'sheet title',
    'drawing name', 'dwg no', 'drawing number'
    // NOTE: "revisions" is NOT included - it's part of a revisions block, not sheet identification
    // NOTE: Removed metadata fields like 'project number', 'drawing scale', etc. - they're not used for extraction
  ];
  
  const lowerLine = line.toLowerCase();
  return titleblockKeywords.some(keyword => lowerLine.includes(keyword));
}

// Cache for custom patterns (refresh every 5 minutes)
let customPatternsCache: {
  sheetNumber: Array<{ pattern: RegExp; priority: number; label: string }>;
  sheetName: Array<{ pattern: RegExp; priority: number; label: string }>;
  lastUpdated: number;
} | null = null;

const PATTERNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load custom patterns from database (with caching)
 */
async function loadCustomPatterns(): Promise<{
  sheetNumber: Array<{ pattern: RegExp; priority: number; label: string }>;
  sheetName: Array<{ pattern: RegExp; priority: number; label: string }>;
}> {
  // Check cache
  if (customPatternsCache && Date.now() - customPatternsCache.lastUpdated < PATTERNS_CACHE_TTL) {
    return {
      sheetNumber: customPatternsCache.sheetNumber,
      sheetName: customPatternsCache.sheetName
    };
  }
  
  try {
    const { supabase } = await import('../supabase');
    const { data, error } = await supabase
      .from('sheet_label_patterns')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    
    if (error) {
      // Handle case where table doesn't exist yet (first deployment)
      if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
        console.log('[Pattern Loading] Table sheet_label_patterns does not exist yet, using defaults only');
      } else {
        console.warn('Failed to load custom patterns, using defaults:', error);
      }
      return { sheetNumber: [], sheetName: [] };
    }
    
    const sheetNumber: Array<{ pattern: RegExp; priority: number; label: string }> = [];
    const sheetName: Array<{ pattern: RegExp; priority: number; label: string }> = [];
    
    (data || []).forEach((p: any) => {
      try {
        const pattern = new RegExp(p.pattern_regex, 'i');
        const item = { pattern, priority: p.priority || 0, label: p.pattern_label };
        
        if (p.pattern_type === 'sheet_number') {
          sheetNumber.push(item);
        } else if (p.pattern_type === 'sheet_name') {
          sheetName.push(item);
        }
      } catch (e) {
        console.warn(`Invalid regex pattern for ${p.pattern_label}:`, p.pattern_regex);
      }
    });
    
    console.log(`[Pattern Loading] Loaded ${sheetNumber.length} sheet number patterns, ${sheetName.length} sheet name patterns from database`);
    
    // Update cache
    customPatternsCache = {
      sheetNumber,
      sheetName,
      lastUpdated: Date.now()
    };
    
    return { sheetNumber, sheetName };
  } catch (error) {
    console.warn('Error loading custom patterns, using defaults:', error);
    return { sheetNumber: [], sheetName: [] };
  }
}

/**
 * Extract sheet number and name from OCR text using pattern matching
 * Now supports both default patterns and custom patterns from database
 */
async function extractSheetInfoFromOCRText(ocrText: string, pageNumber: number): Promise<{ pageNumber: number; sheetNumber: string; sheetName: string }> {
  let sheetNumber = "Unknown";
  let sheetName = "Unknown";
  
  // Handle empty or filtered text (filterTextForTitleblock might return empty if no keywords found)
  if (!ocrText || ocrText.trim().length === 0) {
    if (pageNumber === 1) {
      console.log(`[Page ${pageNumber}] No OCR text or filtered text is empty - skipping extraction`);
    }
    return { pageNumber, sheetNumber, sheetName };
  }
  
  // Load custom patterns from database
  const customPatterns = await loadCustomPatterns();
  
  // Default sheet number patterns (used as fallback if no custom patterns)
  const defaultSheetNumberPatterns = [
    { pattern: /sheet\s*number\s*:?\s*([A-Z0-9.]+)/i, priority: 100, label: 'sheet number' },
    { pattern: /sheet\s*#\s*:?\s*([A-Z0-9.]+)/i, priority: 95, label: 'sheet #' },
    { pattern: /dwg\s*no\s*:?\s*([A-Z0-9.]+)/i, priority: 90, label: 'dwg no' },
    { pattern: /drawing\s*number\s*:?\s*([A-Z0-9.]+)/i, priority: 85, label: 'drawing number' },
    { pattern: /sheet\s*:?\s*([A-Z0-9.]+)/i, priority: 80, label: 'sheet' },
  ];
  
  // Default sheet name patterns (used as fallback if no custom patterns)
  // Simplified: capture until newline or end, but we'll validate the result
  const defaultSheetNamePatterns = [
    { pattern: /drawing\s*data\s*:?\s*(.+?)(?:\n|$)/i, priority: 100, label: 'drawing data' },
    { pattern: /drawing\s*title\s*:?\s*(.+?)(?:\n|$)/i, priority: 90, label: 'drawing title' },
    { pattern: /drawing\s*name\s*:?\s*(.+?)(?:\n|$)/i, priority: 85, label: 'drawing name' },
    { pattern: /sheet\s*title\s*:?\s*(.+?)(?:\n|$)/i, priority: 80, label: 'sheet title' },
    { pattern: /sheet\s*name\s*:?\s*(.+?)(?:\n|$)/i, priority: 75, label: 'sheet name' },
  ];
  
  // Combine custom and default patterns, prioritizing custom (custom patterns come first, then defaults)
  // Always include defaults as fallback, but custom patterns will be tried first due to higher priority
  const sheetNumberPatterns = [
    ...customPatterns.sheetNumber,
    ...defaultSheetNumberPatterns
  ].sort((a, b) => b.priority - a.priority);
  
  const sheetNamePatterns = [
    ...customPatterns.sheetName,
    ...defaultSheetNamePatterns
  ].sort((a, b) => b.priority - a.priority);
  
  // Debug: Log pattern counts (only for first page to avoid spam)
  if (pageNumber === 1) {
    console.log(`[Extraction] Using ${customPatterns.sheetNumber.length} custom + ${defaultSheetNumberPatterns.length} default sheet number patterns (${sheetNumberPatterns.length} total)`);
    console.log(`[Extraction] Using ${customPatterns.sheetName.length} custom + ${defaultSheetNamePatterns.length} default sheet name patterns (${sheetNamePatterns.length} total)`);
  }
  
  // Helper function to extract multi-line sheet name after various label types
  // Now uses custom patterns from database
  // Note: Function is async for consistency but doesn't actually need to be
  const extractMultiLineSheetNameWithCustomPatterns = (
    text: string, 
    patterns: Array<{ pattern: RegExp; priority: number; label: string }>
  ): string | null => {
    const lines = text.split('\n');
    let foundSheetNameLabel = false;
    const nameParts: string[] = [];
    let labelPattern: RegExp | null = null;
    
    // Extract label detection patterns from the full patterns
    const labelPatterns = patterns.map(p => {
      // Extract the label part before the capture group
      const regexStr = p.pattern.source;
      // Remove the capture group and look for label part
      const labelMatch = regexStr.match(/^(.+?)(?:\(.+?\)|$)/);
      if (labelMatch) {
        try {
          return new RegExp(labelMatch[1].replace(/\\s\*:?\s\*/, '\\s*:?'), 'i');
        } catch {
          return null;
        }
      }
      return null;
    }).filter((p): p is RegExp => p !== null);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lowerLine = line.toLowerCase();
      
      // Check if this line contains a sheet name label (if we haven't found one yet)
      if (!foundSheetNameLabel) {
        for (const pattern of labelPatterns) {
          if (pattern.test(lowerLine)) {
            foundSheetNameLabel = true;
            labelPattern = pattern;
            // Extract text after the label
            const match = line.match(new RegExp(pattern.source.replace('\\s*:?', '\\s*:?\\s*(.+)'), 'i'));
            if (match && match[1]) {
              const afterLabel = match[1].trim();
              if (afterLabel && afterLabel.length > 0) {
                nameParts.push(afterLabel);
              }
            }
            break;
          }
        }
        // Continue to next line to capture text in the box below
        if (foundSheetNameLabel) continue;
      }
      
      // If we found a sheet name label, collect subsequent lines until we hit another label
      if (foundSheetNameLabel) {
        // Check if this line matches any of our label patterns (but not the one we're using)
        let isAnotherLabel = false;
        for (const p of labelPatterns) {
          if (p !== labelPattern && p.test(lowerLine)) {
            isAnotherLabel = true;
            break;
          }
        }
        
        // Stop if we hit another titleblock label
        if (isAnotherLabel || /sheet\s*number|dwg\s*no|drawing\s*number/i.test(lowerLine)) {
          break;
        }
        
        // Stop if we hit revisions block (common in titleblocks)
        if (/revisions?|revision\s*date|revision\s*issuance|rev\s*date/i.test(lowerLine)) {
          break;
        }
        
        // Stop if we hit empty line and already have content
        if (line.length === 0 && nameParts.length > 0) {
          break;
        }
        
        // Collect non-empty lines that are part of the sheet name
        if (line.length > 0) {
          // Skip if it looks like a label (contains colon and is short)
          if (!/^[^:]{0,30}:\s*$/.test(line)) {
            // Skip if it looks like revision information
            if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) && // dates
                !/^rev\s*\d+/i.test(lowerLine) && // revision numbers
                !/^issuance/i.test(lowerLine)) {
              // Skip if this line is clearly part of the revisions / project info block
              // We don't want lines like "revisions :project info" to poison the full name
              if ((lowerLine.includes('revisions') && lowerLine.includes('project info')) ||
                  /^revisions?$/i.test(line) ||
                  /^project\s*info$/i.test(lowerLine)) {
                continue;
              }
              nameParts.push(line);
            }
          }
        }
      }
    }
    
    if (nameParts.length > 0) {
      const fullName = nameParts.join(' ').trim();
      // Clean up: remove extra whitespace, trailing punctuation
      const cleaned = fullName.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
      if (cleaned.length > 2) {
        return cleaned;
      }
    }
    
    return null;
  };
  
  // Invalid patterns that should be rejected
  const invalidSheetNamePatterns = [
    /^revisions\s*:?\s*project\s*info/i, // Match "revisions :project info" (with optional trailing chars)
    /^project\s*info/i, // Match "project info" at start
    /^revisions?$/i,
    /revision\s*date/i,
    /revision\s*issuance/i,
    /rev\s*\d+/i, // Revision numbers like "Rev 1", "Rev 2"
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // Dates (common in revisions blocks)
    /^DRAW1NG$/i,
    /^DRAWING$/i, // Too generic
    /^drawing$/i,
  ];
  
  // Invalid sheet number patterns
  const invalidSheetNumberPatterns = [
    /^DRAW1NG$/i,
    /^DRAWING$/i,
    /^[A-Z]{5,}$/i, // All caps words longer than 4 chars are likely not sheet numbers
  ];
  
  // Helper function to validate sheet name
  const isValidSheetName = (name: string): boolean => {
    if (!name || name.length < 3) return false;
    const lowerName = name.toLowerCase().trim();
    
    // Reject if it matches invalid patterns
    for (const pattern of invalidSheetNamePatterns) {
      if (pattern.test(name.trim())) {
        return false;
      }
    }
    
    // Reject if it's just "revisions" or "project info" or similar
    if (lowerName === 'revisions' || lowerName === 'revision' || 
        lowerName === 'project info' || lowerName === 'drawing') {
      return false;
    }
    
    // Reject if it contains "revisions :project info" pattern
    if (lowerName.includes('revisions') && lowerName.includes('project info')) {
      return false;
    }
    
    // Reject if it looks like revision information (dates, revision numbers)
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(name.trim()) || // Starts with date
        /rev\s*\d+/i.test(lowerName) || // Contains revision number
        /revision\s*date/i.test(lowerName) || // Contains "revision date"
        /revision\s*issuance/i.test(lowerName)) { // Contains "revision issuance"
      return false;
    }
    
    return true;
  };
  
  // Helper function to validate sheet number
  const isValidSheetNumber = (num: string): boolean => {
    if (!num || num.length < 2) return false;
    // Reject if it matches invalid patterns
    for (const pattern of invalidSheetNumberPatterns) {
      if (pattern.test(num.trim())) {
        return false;
      }
    }
    // Sheet numbers should be alphanumeric with dots, not all letters
    // Reject if it's all letters and longer than 4 chars (like "DRAW1NG")
    if (/^[A-Z]{5,}$/i.test(num) && !num.includes('.')) {
      return false;
    }
    return true;
  };

  /**
   * Fallback heuristic: infer a sheet name from lines near the detected sheet number.
   * This is layout-agnostic but uses line ordering as a proxy for layout.
   */
  const inferSheetNameFromContext = (text: string, sheetNumber: string): string | null => {
    if (!text || !sheetNumber || sheetNumber === 'Unknown') return null;

    const lines = text.split('\n');
    if (lines.length === 0) return null;

    const lowerSheet = sheetNumber.toLowerCase();
    let sheetLineIndex = -1;

    // Find the first line that contains the sheet number (e.g., "sheet number: A4.21" or just "A4.21")
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      if (lowerLine.includes(lowerSheet)) {
        sheetLineIndex = i;
        break;
      }
    }

    if (sheetLineIndex === -1) {
      return null;
    }

    const isLineLikelyTitle = (rawLine: string): boolean => {
      const line = rawLine.trim();
      if (!line) return false;

      // Reasonable length for a title
      if (line.length < 4 || line.length > 80) return false;

      const lower = line.toLowerCase();

      // Filter out obvious metadata / non-title content
      const invalidKeywords = [
        'revisions', 'revision', 'project info', 'project information',
        'scale', 'sheet number', 'drawing number', 'dwg no',
        'architect', 'engineer', 'client', 'owner',
        'copyright', 'seal', 'issued for', 'issue date'
      ];
      if (invalidKeywords.some(keyword => lower.includes(keyword))) {
        return false;
      }

      // Skip dates and revision codes
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) return false;
      if (/^rev\s*\d+/i.test(line)) return false;

      // Skip pure labels like "TITLE:" or "SHEET NAME:"
      if (/^[^:]{0,40}:\s*$/.test(line)) return false;

      // Skip lines that look like numeric/detail callouts
      if (/^\d+\s+/.test(line)) return false;

      // Require at least one letter (avoid pure numbers/symbols)
      if (!/[A-Za-z]/.test(line)) return false;

      return true;
    };

    // Prefer titles immediately ABOVE the sheet number (common in many titleblocks),
    // then look just BELOW as a secondary option.
    const candidateIndices: number[] = [];

    // Look above within a small window
    for (let offset = 1; offset <= 8; offset++) {
      const idx = sheetLineIndex - offset;
      if (idx < 0) break;
      candidateIndices.push(idx);
    }

    // Then look below within a smaller window
    for (let offset = 1; offset <= 6; offset++) {
      const idx = sheetLineIndex + offset;
      if (idx >= lines.length) break;
      candidateIndices.push(idx);
    }

    for (const idx of candidateIndices) {
      const candidateLine = lines[idx]?.trim();
      if (!candidateLine) continue;
      if (!isLineLikelyTitle(candidateLine)) continue;

      // Clean up whitespace and trailing punctuation
      const cleaned = candidateLine.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
      if (cleaned.length >= 3) {
        return cleaned;
      }
    }

    return null;
  };
  
  // Search for sheet number
  for (const { pattern } of sheetNumberPatterns) {
    const match = ocrText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().toUpperCase();
      // Fix common OCR errors
      const fixed = candidate.replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1');
      if (isValidSheetNumber(fixed)) {
        sheetNumber = fixed;
        break;
      }
    }
  }
  
  // If no label found, look for standalone sheet number patterns
  if (sheetNumber === "Unknown") {
    // Pattern: Letter(s) + digits + dot + digits (e.g., A4.21, S0.02)
    const standalonePattern = /\b([A-Z][0-9]+\.[0-9]+)\b/i;
    const match = ocrText.match(standalonePattern);
    if (match && match[1]) {
      const candidate = match[1].trim().toUpperCase();
      const fixed = candidate.replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1');
      if (isValidSheetNumber(fixed)) {
        sheetNumber = fixed;
      }
    } else {
      // Pattern: Letter + digits (e.g., A4, F2) - but require at least 2 chars
      const shortPattern = /\b([A-Z][0-9]+)\b/i;
      const shortMatch = ocrText.match(shortPattern);
      if (shortMatch && shortMatch[1] && shortMatch[1].length >= 2 && shortMatch[1].length <= 5) {
        const candidate = shortMatch[1].trim().toUpperCase();
        const fixed = candidate.replace(/O/g, '0').replace(/l/g, '1').replace(/I/g, '1');
        if (isValidSheetNumber(fixed)) {
          sheetNumber = fixed;
        }
      }
    }
  }
  
  // Search for sheet name - try multi-line extraction first (for labels with box below)
  // Update extractMultiLineSheetName to use custom patterns
  const multiLineName = extractMultiLineSheetNameWithCustomPatterns(ocrText, sheetNamePatterns);
  if (multiLineName && isValidSheetName(multiLineName)) {
    sheetName = multiLineName;
  } else {
    // Fall back to single-line patterns
    for (const { pattern, label } of sheetNamePatterns) {
      const match = ocrText.match(pattern);
      if (match && match[1]) {
        let nameText = match[1].trim();
        // Clean up: remove extra whitespace, trailing punctuation
        nameText = nameText.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
        
        // Additional validation: reject if it contains "revisions" or "project info" even after cleanup
        if (nameText.toLowerCase().includes('revisions') || nameText.toLowerCase().includes('project info')) {
          if (pageNumber <= 3) {
            console.log(`[Page ${pageNumber}] Pattern "${label}" matched but contains invalid keywords: "${nameText}"`);
          }
          continue; // Try next pattern
        }
        
        if (isValidSheetName(nameText)) {
          sheetName = nameText;
          if (pageNumber <= 3) {
            console.log(`[Page ${pageNumber}] Found sheet name using pattern "${label}": "${nameText}"`);
          }
          break;
        }
      }
    }
    
    // Debug: If no sheet name found, log why (only for first few pages)
    if (pageNumber <= 3 && sheetName === 'Unknown') {
      console.log(`[Page ${pageNumber}] No sheet name found. Checking patterns...`);
      // Check if any patterns would match
      let foundAnyMatch = false;
      for (const { pattern, label } of sheetNamePatterns) {
        const testMatch = ocrText.match(pattern);
        if (testMatch) {
          foundAnyMatch = true;
          const testName = testMatch[1]?.trim() || '';
          // Check if it's the revisions issue
          if (testName.toLowerCase().includes('revisions') || testName.toLowerCase().includes('project info')) {
            console.log(`[Page ${pageNumber}] Pattern "${label}" matched but contains invalid keywords: "${testName}"`);
          } else {
            console.log(`[Page ${pageNumber}] Pattern "${label}" matched but result was invalid: "${testName}"`);
          }
        }
      }
      if (!foundAnyMatch) {
        console.log(`[Page ${pageNumber}] No sheet name patterns matched. Filtered text sample: ${ocrText.substring(0, 500)}`);
      }
    }
  }

  // Fallback: If we have a sheet number but still no sheet name, try to infer it from nearby lines.
  if (sheetName === 'Unknown' && sheetNumber !== 'Unknown') {
    const inferredName = inferSheetNameFromContext(ocrText, sheetNumber);
    if (inferredName && isValidSheetName(inferredName)) {
      sheetName = inferredName;
      if (pageNumber <= 3) {
        console.log(`[Page ${pageNumber}] Inferred sheet name from context near "${sheetNumber}": "${inferredName}"`);
      }
    } else if (pageNumber <= 3) {
      console.log(`[Page ${pageNumber}] Could not infer sheet name from context near "${sheetNumber}"`);
    }
  }
  
  return { pageNumber, sheetNumber, sheetName };
}

// Analyze document sheets using AI (restored from d5cdad4 with optimizations)
router.post('/analyze-sheets', async (req, res) => {
  try {
    const { documentId, projectId, customPrompt } = req.body;
    
    // DEVELOPMENT FLAG: Set to true to use Python extraction instead of AI
    // TODO: Remove this flag after testing or make it configurable
    const USE_PYTHON_EXTRACTION = process.env.USE_PYTHON_TITLEBLOCK_EXTRACTION === 'true';
    
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

    console.log('Sheet analysis request:', { documentId, projectId, usePython: USE_PYTHON_EXTRACTION });

    if (!documentId || !projectId) {
      res.write(`data: ${JSON.stringify({ error: 'Missing required fields: documentId and projectId' })}\n\n`);
      res.end();
      return;
    }

    // Python extraction path - NOW USES OCR TEXT DIRECTLY (much faster and more reliable!)
    if (USE_PYTHON_EXTRACTION) {
      try {
        sendProgress(5, 'Loading OCR data...');
        
        // Get OCR data directly from database (already extracted!)
        const { simpleOcrService } = await import('../services/simpleOcrService');
        const ocrData = await simpleOcrService.getDocumentOCRResults(projectId, documentId);
        
        if (!ocrData || ocrData.length === 0) {
          res.write(`data: ${JSON.stringify({ error: 'No OCR data found. Please run OCR first.' })}\n\n`);
          res.end();
          return;
        }
        
        const totalPages = ocrData.length;
        sendProgress(10, `Extracting from ${totalPages} pages of OCR text...`);
        
        // Extract titleblock info directly from OCR text using pattern matching
        const allSheets: any[] = [];
        
        for (let i = 0; i < ocrData.length; i++) {
          const page = ocrData[i];
          const pageNumber = page.pageNumber;
          const fullOcrText = page.text || '';
          
          // Filter OCR text to focus on titleblock region (right side, excludes revisions, etc.)
          // This mimics what the Python script does - isolates titleblock content
          const ocrText = filterTextForTitleblock(fullOcrText);
          
          // Debug: Log filtered text for first few pages to see what we're working with
          if (pageNumber <= 3) {
            console.log(`[Page ${pageNumber}] Filtered text length: ${ocrText.length} (original: ${fullOcrText.length})`);
            if (ocrText.length < 100 && ocrText.length > 0) {
              console.log(`[Page ${pageNumber}] Filtered text preview: ${ocrText.substring(0, 200)}`);
            } else if (ocrText.length === 0) {
              console.warn(`[Page ${pageNumber}] Filtered text is EMPTY - no titleblock keywords found! Original text preview: ${fullOcrText.substring(0, 300)}`);
            }
          }
          
          // Update progress
          const progress = 10 + Math.round((i / totalPages) * 80);
          if (i % 10 === 0 || i === ocrData.length - 1) {
            sendProgress(progress, `Processing page ${i + 1}/${totalPages}...`);
          }
          
          // Extract sheet info from filtered OCR text (now async to load custom patterns)
          const sheetInfo = await extractSheetInfoFromOCRText(ocrText, pageNumber);
          
          // Log extraction results for debugging (first few pages and pages with data)
          if (pageNumber <= 3 || (sheetInfo.sheetNumber !== 'Unknown' || sheetInfo.sheetName !== 'Unknown')) {
            console.log(`[Page ${pageNumber}] Extracted: sheetNumber="${sheetInfo.sheetNumber}", sheetName="${sheetInfo.sheetName}"`);
          }
          
          // Log if we're getting invalid results
          if (sheetInfo.sheetName && (sheetInfo.sheetName.includes('revisions') || sheetInfo.sheetName.includes('project info'))) {
            console.warn(`[Page ${pageNumber}] Invalid sheet name detected: "${sheetInfo.sheetName}" - should be rejected`);
            sheetInfo.sheetName = "Unknown";
          }
          if (sheetInfo.sheetNumber && (sheetInfo.sheetNumber === 'DRAW1NG' || sheetInfo.sheetNumber === 'DRAWING')) {
            console.warn(`[Page ${pageNumber}] Invalid sheet number detected: "${sheetInfo.sheetNumber}" - should be rejected`);
            sheetInfo.sheetNumber = "Unknown";
          }
          
          allSheets.push(sheetInfo);
        }
        
        // Sort by page number
        allSheets.sort((a, b) => a.pageNumber - b.pageNumber);
        
        // Log extraction results with more detail
        const extractedCount = allSheets.filter(s => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length;
        const withSheetNumber = allSheets.filter(s => s.sheetNumber !== 'Unknown').length;
        const withSheetName = allSheets.filter(s => s.sheetName !== 'Unknown').length;
        console.log(`[OCR Text Extraction] Complete: ${allSheets.length} total sheets, ${extractedCount} with extracted data (${withSheetNumber} with sheetNumber, ${withSheetName} with sheetName)`);
        
        // Log sample of extracted data for debugging
        const samples = allSheets.filter(s => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').slice(0, 5);
        if (samples.length > 0) {
          console.log(`[OCR Text Extraction] Sample results:`, samples.map(s => ({
            page: s.pageNumber,
            number: s.sheetNumber,
            name: s.sheetName?.substring(0, 50)
          })));
        }
        
        sendProgress(95, 'Finalizing results...');
        
        // Send final result (same format as AI)
        res.write(`data: ${JSON.stringify({
          success: true,
          sheets: allSheets,
          totalPages: totalPages,
          analyzedSheets: allSheets.length,
          progress: 100,
          message: 'Complete!'
        })}\n\n`);
        
        res.end();
        return;
        
      } catch (error) {
        console.error('Error in OCR text extraction:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.write(`data: ${JSON.stringify({ error: `Extraction failed: ${errorMessage}` })}\n\n`);
        res.end();
        return;
      }
    }

    // Original AI extraction path (kept intact)
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
    
      // Build context for this batch - make page numbers explicit and clear
      let batchContext = `Analyze this batch of construction document pages and identify sheet information from title blocks.\n\n`;
      batchContext += `IMPORTANT: This batch contains pages ${batchStart + 1}-${batchEnd} of ${totalPages} total pages in the document.\n`;
      batchContext += `You must return pageNumber values that match the actual page numbers shown below (${batchStart + 1}, ${batchStart + 2}, etc.), NOT relative positions in the batch.\n\n`;
      
      pagesToAnalyze.forEach((page: any) => {
        if (page && page.text && page.text.trim().length > 0) {
          // Filter out detail callouts and section labels to focus on titleblock info
          const filteredText = filterTextForTitleblock(page.text);
          
          // Limit to reasonable size to avoid token limits (increased for longer sheet names)
          const limitedText = filteredText.substring(0, 6000);
          // Make it very clear this is the absolute page number
          batchContext += `--- PAGE ${page.pageNumber} (absolute page number in document) ---\n${limitedText}\n\n`;
        }
      });
      
      console.log(`Batch context length: ${batchContext.length} characters`);

      // Use custom prompt from admin panel if provided, otherwise use default
      const systemPrompt = customPrompt || `You are an expert construction document analyst. Extract sheet information from title blocks located on the RIGHT BORDER of each page.

TITLE BLOCK LOCATION:
- Title blocks are ALWAYS on the far right border of construction documents (industry standard)
- Look for text containing sheet identification labels and "sheet number:" labels
- The text may be rotated or in different orientations, but always on the right side

YOUR TASK:
Extract EXACT text from title block fields. Your job is to clean up minor OCR errors (like O→0, I→1) but DO NOT change the actual names or numbers.

For each page, find:
1. Sheet number: Look for "sheet number:" followed by alphanumeric code (e.g., A4.21, A0.01, S0.02)
2. Sheet name: Look for ANY of these labels (different projects use different labels):
   - "drawing data:" (common in some formats)
   - "drawing title:" (very common)
   - "drawing name:" (common)
   - "sheet title:" (common)
   - "sheet name:" (common)
   The sheet name is typically in a BOX BELOW the label
   - The sheet name may be on the SAME line as the label OR on the LINE(S) BELOW it
   - Capture ALL text in the box below the label until you hit another label or empty line
   - Sheet names can span multiple lines (e.g., "Enlarged Floor Plan - Ground Floor - East Side")

CRITICAL RULES:
- Use EXACT text from title block - only fix obvious OCR errors (O→0, I→1, l→1, etc.)
- DO NOT reword, shorten, or change sheet names
- DO NOT reorder sheet numbers based on patterns
- Capture COMPLETE sheet names including all words after the label and in the box below it
- If the label appears on one line and the sheet name is on the next line(s), capture ALL of it
- IGNORE detail callouts (lines starting with numbers like "01 Detail" or "25 Section")
- STOP collecting sheet name text when you encounter:
  - Another titleblock label (sheet number, drawing title, etc.)
  - Revisions block information (revision dates, revision numbers, issuance dates)
  - Empty lines (if you already have content)

CRITICAL - DO NOT EXTRACT (REVISIONS BLOCK):
- "revisions" or "revision" - this is part of a revisions block, NOT a sheet name
- "revisions :project info" or "project info" - these are metadata, NOT sheet names
- Revision dates (e.g., "01/15/2024", "12/31/23")
- Revision numbers (e.g., "Rev 1", "Rev 2", "Revision 1")
- Issuance information
- "DRAW1NG" or "DRAWING" - these are NOT sheet numbers
- Generic labels like "title:", "revisions:", "project:" without actual sheet information
- Only extract actual sheet names that describe the drawing (e.g., "Floor Plan", "Elevations", "Details")

EXAMPLES:
- "drawing data: Enlarged Floor Plan - Ground Floor - East Side" → sheetName: "Enlarged Floor Plan - Ground Floor - East Side"
- "drawing title: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level" → sheetName: "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
- "sheet name: Cover Sheet" → sheetName: "Cover Sheet"
- "sheet number: A4.21" → sheetNumber: "A4.21"
- If OCR shows "A4.2l" (lowercase L), correct to "A4.21" (number one)
- If you see "revisions :project info" → DO NOT use this as sheetName, use "Unknown" instead
- If you see "revisions" or "revision date" → DO NOT use this as sheetName, use "Unknown" instead
- If you see "DRAW1NG" → DO NOT use this as sheetNumber, use "Unknown" instead

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

        // Validate each sheet object and ensure page numbers match the batch
        const expectedPageNumbers = new Set(pagesToAnalyze.map((p: any) => p.pageNumber));
        
        // Helper function to validate and clean AI results
        const validateAndCleanSheet = (sheet: any): any | null => {
          if (!sheet || 
              typeof sheet.pageNumber !== 'number' || 
              typeof sheet.sheetNumber !== 'string' || 
              typeof sheet.sheetName !== 'string') {
            return null;
          }
          
          // Validate page number matches batch
          if (!expectedPageNumbers.has(sheet.pageNumber)) {
            console.warn(`[Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}] AI returned invalid pageNumber ${sheet.pageNumber} for batch containing pages: ${Array.from(expectedPageNumbers).join(', ')}`);
            return null;
          }
          
          // Validate and clean sheet name
          let sheetName = sheet.sheetName.trim();
          const lowerName = sheetName.toLowerCase();
          
          // Reject invalid patterns (revisions block, etc.)
          if (lowerName.includes('revisions') && lowerName.includes('project info')) {
            console.warn(`[Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}] Page ${sheet.pageNumber}: Rejecting invalid sheet name: "${sheetName}"`);
            sheetName = "Unknown";
          } else if (lowerName === 'revisions' || lowerName === 'revision' || 
                     lowerName === 'project info' || lowerName === 'drawing') {
            console.warn(`[Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}] Page ${sheet.pageNumber}: Rejecting generic sheet name: "${sheetName}"`);
            sheetName = "Unknown";
          } else if (/revision\s*date/i.test(lowerName) ||
                     /revision\s*issuance/i.test(lowerName) ||
                     /^rev\s*\d+/i.test(lowerName) ||
                     /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(sheetName.trim())) {
            // Reject revision dates, revision numbers, issuance info
            console.warn(`[Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}] Page ${sheet.pageNumber}: Rejecting revisions block content: "${sheetName}"`);
            sheetName = "Unknown";
          }
          
          // Validate and clean sheet number
          let sheetNumber = sheet.sheetNumber.trim().toUpperCase();
          
          // Reject invalid patterns
          if (sheetNumber === 'DRAW1NG' || sheetNumber === 'DRAWING' || 
              (sheetNumber.length > 4 && /^[A-Z]+$/.test(sheetNumber) && !sheetNumber.includes('.'))) {
            console.warn(`[Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}] Page ${sheet.pageNumber}: Rejecting invalid sheet number: "${sheetNumber}"`);
            sheetNumber = "Unknown";
          }
          
          return {
            pageNumber: sheet.pageNumber,
            sheetNumber: sheetNumber,
            sheetName: sheetName
          };
        };
        
        batchSheets = batchSheets
          .map(validateAndCleanSheet)
          .filter((sheet): sheet is any => sheet !== null);

        console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} parsed sheets:`, batchSheets.length, 'sheets found (expected pages:', Array.from(expectedPageNumbers).join(', '), ')');
        
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

    // CRITICAL: Sort sheets by pageNumber to ensure correct order and prevent lag accumulation
    allSheets.sort((a, b) => a.pageNumber - b.pageNumber);
    
    console.log(`Sorted sheets by page number. Page range: ${allSheets[0]?.pageNumber || 'N/A'} - ${allSheets[allSheets.length - 1]?.pageNumber || 'N/A'}`);

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
