import { ocrService } from './ocrService';
import { ocrTrainingService } from './ocrTrainingService';

export interface EnhancedOCRResult {
  originalText: string;
  correctedText: string;
  confidence: number;
  corrections: Array<{
    type: 'sheet_number' | 'sheet_name' | 'formatting';
    original: string;
    corrected: string;
    reason: string;
  }>;
}

export interface SheetNumberPattern {
  pattern: RegExp;
  format: string;
  description: string;
}

export interface SheetNameCorrection {
  common: string;
  variations: string[];
  category: string;
}

class EnhancedOCRService {
  // Common sheet number patterns in architectural drawings
  private sheetNumberPatterns: SheetNumberPattern[] = [
    {
      pattern: /^[A-Z]\d{1,2}$/,
      format: 'A1, A2, B1, etc.',
      description: 'Standard architectural sheet numbering'
    },
    {
      pattern: /^[A-Z]\d{1,2}-\d{1,2}$/,
      format: 'A1-1, A2-3, etc.',
      description: 'Sheet with revision numbers'
    },
    {
      pattern: /^\d{1,3}$/,
      format: '1, 2, 3, etc.',
      description: 'Simple numeric sheet numbers'
    },
    {
      pattern: /^[A-Z]\d{1,2}\.\d{1,2}$/,
      format: 'A1.1, A2.3, etc.',
      description: 'Sheet with decimal subdivisions'
    },
    {
      pattern: /^[A-Z]{2}\d{1,2}$/,
      format: 'AA1, BB2, etc.',
      description: 'Double letter prefix sheets'
    }
  ];

  // Common sheet name corrections for construction documents
  private sheetNameCorrections: SheetNameCorrection[] = [
    // Floor Plans
    {
      common: 'FLOOR PLAN',
      variations: ['FLOOR PLAN', 'FLOORPLAN', 'FLOOR PLAN', 'FLOOR PLAN', 'FLOOR PLAN'],
      category: 'floor_plans'
    },
    {
      common: 'FOUNDATION PLAN',
      variations: ['FOUNDATION', 'FOUNDATION PLAN', 'FOUNDATION PLAN', 'FOUNDATION PLAN'],
      category: 'foundation'
    },
    {
      common: 'ROOF PLAN',
      variations: ['ROOF', 'ROOF PLAN', 'ROOF PLAN', 'ROOF PLAN'],
      category: 'roof'
    },
    
    // Elevations
    {
      common: 'ELEVATION',
      variations: ['ELEVATION', 'ELEVATION', 'ELEVATION', 'ELEVATION'],
      category: 'elevations'
    },
    {
      common: 'NORTH ELEVATION',
      variations: ['NORTH ELEVATION', 'NORTH ELEVATION', 'NORTH ELEVATION'],
      category: 'elevations'
    },
    {
      common: 'SOUTH ELEVATION',
      variations: ['SOUTH ELEVATION', 'SOUTH ELEVATION', 'SOUTH ELEVATION'],
      category: 'elevations'
    },
    {
      common: 'EAST ELEVATION',
      variations: ['EAST ELEVATION', 'EAST ELEVATION', 'EAST ELEVATION'],
      category: 'elevations'
    },
    {
      common: 'WEST ELEVATION',
      variations: ['WEST ELEVATION', 'WEST ELEVATION', 'WEST ELEVATION'],
      category: 'elevations'
    },
    
    // Sections
    {
      common: 'SECTION',
      variations: ['SECTION', 'SECTION', 'SECTION', 'SECTION'],
      category: 'sections'
    },
    {
      common: 'DETAIL',
      variations: ['DETAIL', 'DETAIL', 'DETAIL', 'DETAIL'],
      category: 'details'
    },
    
    // Structural
    {
      common: 'STRUCTURAL PLAN',
      variations: ['STRUCTURAL', 'STRUCTURAL PLAN', 'STRUCTURAL PLAN'],
      category: 'structural'
    },
    {
      common: 'FRAMING PLAN',
      variations: ['FRAMING', 'FRAMING PLAN', 'FRAMING PLAN'],
      category: 'structural'
    },
    
    // MEP
    {
      common: 'ELECTRICAL PLAN',
      variations: ['ELECTRICAL', 'ELECTRICAL PLAN', 'ELECTRICAL PLAN'],
      category: 'electrical'
    },
    {
      common: 'PLUMBING PLAN',
      variations: ['PLUMBING', 'PLUMBING PLAN', 'PLUMBING PLAN'],
      category: 'plumbing'
    },
    {
      common: 'HVAC PLAN',
      variations: ['HVAC', 'HVAC PLAN', 'HVAC PLAN', 'MECHANICAL'],
      category: 'hvac'
    },
    
    // Site
    {
      common: 'SITE PLAN',
      variations: ['SITE', 'SITE PLAN', 'SITE PLAN', 'SITE PLAN'],
      category: 'site'
    },
    {
      common: 'LANDSCAPE PLAN',
      variations: ['LANDSCAPE', 'LANDSCAPE PLAN', 'LANDSCAPE PLAN'],
      category: 'landscape'
    },
    
    // General
    {
      common: 'TITLE SHEET',
      variations: ['TITLE', 'TITLE SHEET', 'TITLE SHEET', 'COVER'],
      category: 'general'
    },
    {
      common: 'INDEX',
      variations: ['INDEX', 'INDEX', 'INDEX', 'INDEX'],
      category: 'general'
    },
    {
      common: 'LEGEND',
      variations: ['LEGEND', 'LEGEND', 'LEGEND', 'LEGEND'],
      category: 'general'
    },
    {
      common: 'NOTES',
      variations: ['NOTES', 'NOTES', 'NOTES', 'NOTES'],
      category: 'general'
    }
  ];

  // Character substitution map for common OCR errors
  private characterSubstitutions: Map<string, string> = new Map([
    // Numbers that look like letters
    ['O', '0'], ['I', '1'], ['l', '1'], ['S', '5'], ['B', '8'],
    ['G', '6'], ['T', '7'], ['Z', '2'], ['g', '9'],
    
    // Letters that look like numbers
    ['0', 'O'], ['1', 'I'], ['5', 'S'], ['8', 'B'], ['6', 'G'],
    ['7', 'T'], ['2', 'Z'], ['9', 'g'],
    
    // Common OCR mistakes
    ['rn', 'm'], ['cl', 'd'], ['ii', 'n'], ['vv', 'w'],
    ['nn', 'm'], ['oo', '0'], ['ll', '1'], ['ss', '5']
  ]);

  /**
   * Enhanced OCR processing with post-processing corrections
   */
  async processWithEnhancement(canvas: HTMLCanvasElement, pageNumber: number = 1, projectId?: string): Promise<EnhancedOCRResult> {
    try {
      // Get base OCR result
      const baseResult = await ocrService.processCanvas(canvas, pageNumber);
      
      // Apply enhancements
      const enhancedResult = await this.enhanceOCRResult(baseResult.text, baseResult.confidence, projectId);
      
      return enhancedResult;
    } catch (error) {
      console.error('Enhanced OCR processing failed:', error);
      throw error;
    }
  }

  /**
   * Enhance OCR result with pattern recognition and corrections
   */
  private async enhanceOCRResult(originalText: string, confidence: number, projectId?: string): Promise<EnhancedOCRResult> {
    const corrections: Array<{
      type: 'sheet_number' | 'sheet_name' | 'formatting';
      original: string;
      corrected: string;
      reason: string;
    }> = [];

    let correctedText = originalText;

    // Clean up the text first
    correctedText = this.cleanText(correctedText, corrections);

    // Apply training data corrections first (highest priority)
    if (projectId) {
      correctedText = await this.applyTrainingDataCorrections(correctedText, corrections, projectId);
    }

    // Try to identify and correct sheet numbers
    correctedText = this.correctSheetNumbers(correctedText, corrections);

    // Try to identify and correct sheet names
    correctedText = this.correctSheetNames(correctedText, corrections);

    // Apply character substitutions for common OCR errors
    correctedText = this.applyCharacterSubstitutions(correctedText, corrections);

    // Calculate enhanced confidence based on corrections
    const enhancedConfidence = this.calculateEnhancedConfidence(confidence, corrections);

    return {
      originalText,
      correctedText,
      confidence: enhancedConfidence,
      corrections
    };
  }

  /**
   * Apply corrections based on training data
   */
  private async applyTrainingDataCorrections(text: string, corrections: any[], projectId: string): Promise<string> {
    try {
      // Load training data for this project
      await ocrTrainingService.loadTrainingData(projectId);
      
      // Try to get suggested corrections for sheet numbers and sheet names
      const words = text.split(/\s+/);
      let correctedText = text;
      
      for (const word of words) {
        const trimmedWord = word.trim();
        
        // Try sheet number correction
        const sheetNumberSuggestion = ocrTrainingService.getSuggestedCorrection('sheet_number', trimmedWord);
        if (sheetNumberSuggestion && sheetNumberSuggestion !== trimmedWord) {
          const original = correctedText;
          correctedText = correctedText.replace(trimmedWord, sheetNumberSuggestion);
          corrections.push({
            type: 'sheet_number',
            original: trimmedWord,
            corrected: sheetNumberSuggestion,
            reason: 'Applied training data correction for sheet number'
          });
        }
        
        // Try sheet name correction
        const sheetNameSuggestion = ocrTrainingService.getSuggestedCorrection('sheet_name', trimmedWord);
        if (sheetNameSuggestion && sheetNameSuggestion !== trimmedWord) {
          const original = correctedText;
          correctedText = correctedText.replace(trimmedWord, sheetNameSuggestion);
          corrections.push({
            type: 'sheet_name',
            original: trimmedWord,
            corrected: sheetNameSuggestion,
            reason: 'Applied training data correction for sheet name'
          });
        }
      }
      
      return correctedText;
    } catch (error) {
      console.error('Error applying training data corrections:', error);
      return text; // Return original text if training data fails
    }
  }

  /**
   * Clean up text formatting and remove common OCR artifacts
   */
  private cleanText(text: string, corrections: any[]): string {
    let cleaned = text;

    // Remove excessive whitespace
    const originalWhitespace = cleaned;
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (originalWhitespace !== cleaned) {
      corrections.push({
        type: 'formatting',
        original: originalWhitespace,
        corrected: cleaned,
        reason: 'Normalized whitespace'
      });
    }

    // Remove common OCR artifacts
    const artifacts = ['|', '||', '|||', '=', '==', '===', '#', '##', '###'];
    artifacts.forEach(artifact => {
      if (cleaned.includes(artifact)) {
        const original = cleaned;
        cleaned = cleaned.replace(new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
        if (original !== cleaned) {
          corrections.push({
            type: 'formatting',
            original,
            corrected: cleaned,
            reason: `Removed OCR artifact: ${artifact}`
          });
        }
      }
    });

    return cleaned;
  }

  /**
   * Correct sheet numbers using pattern recognition
   */
  private correctSheetNumbers(text: string, corrections: any[]): string {
    // Extract potential sheet numbers (usually short alphanumeric strings)
    const words = text.split(/\s+/);
    let correctedText = text;

    words.forEach(word => {
      const trimmedWord = word.trim();
      
      // Skip if word is too long to be a sheet number
      if (trimmedWord.length > 6) return;

      // Check against known patterns
      for (const pattern of this.sheetNumberPatterns) {
        if (pattern.pattern.test(trimmedWord)) {
          // This looks like a valid sheet number, no correction needed
          return;
        }
      }

      // Try to correct common sheet number mistakes
      const corrected = this.attemptSheetNumberCorrection(trimmedWord);
      if (corrected && corrected !== trimmedWord) {
        const original = correctedText;
        correctedText = correctedText.replace(trimmedWord, corrected);
        corrections.push({
          type: 'sheet_number',
          original: trimmedWord,
          corrected,
          reason: 'Applied sheet number pattern correction'
        });
      }
    });

    return correctedText;
  }

  /**
   * Attempt to correct a potential sheet number
   */
  private attemptSheetNumberCorrection(word: string): string | null {
    // Common sheet number corrections
    const corrections: Map<string, string> = new Map([
      // Fix common OCR mistakes in sheet numbers
      ['A0', 'A1'], ['A2', 'A1'], ['A3', 'A1'],
      ['B0', 'B1'], ['B2', 'B1'], ['B3', 'B1'],
      ['C0', 'C1'], ['C2', 'C1'], ['C3', 'C1'],
      ['D0', 'D1'], ['D2', 'D1'], ['D3', 'D1'],
      
      // Fix number substitutions
      ['A1', 'A1'], ['A2', 'A2'], ['A3', 'A3'],
      ['B1', 'B1'], ['B2', 'B2'], ['B3', 'B3'],
      
      // Fix common OCR errors
      ['Al', 'A1'], ['Bl', 'B1'], ['Cl', 'C1'], ['Dl', 'D1'],
      ['AO', 'A0'], ['BO', 'B0'], ['CO', 'C0'], ['DO', 'D0'],
    ]);

    return corrections.get(word) || null;
  }

  /**
   * Correct sheet names using fuzzy matching against known patterns
   */
  private correctSheetNames(text: string, corrections: any[]): string {
    const words = text.split(/\s+/);
    let correctedText = text;

    // Try to match against known sheet name patterns
    for (const correction of this.sheetNameCorrections) {
      for (const variation of correction.variations) {
        const similarity = this.calculateSimilarity(text.toUpperCase(), variation.toUpperCase());
        
        // If similarity is high enough, apply correction
        if (similarity > 0.7) {
          const original = correctedText;
          correctedText = correction.common;
          corrections.push({
            type: 'sheet_name',
            original,
            corrected: correctedText,
            reason: `Matched to known sheet name pattern (${correction.category})`
          });
          break;
        }
      }
    }

    return correctedText;
  }

  /**
   * Apply character substitutions for common OCR errors
   */
  private applyCharacterSubstitutions(text: string, corrections: any[]): string {
    let correctedText = text;

    for (const [wrong, correct] of this.characterSubstitutions) {
      if (correctedText.includes(wrong)) {
        const original = correctedText;
        correctedText = correctedText.replace(new RegExp(wrong, 'g'), correct);
        if (original !== correctedText) {
          corrections.push({
            type: 'formatting',
            original,
            corrected: correctedText,
            reason: `Applied character substitution: ${wrong} → ${correct}`
          });
        }
      }
    }

    return correctedText;
  }

  /**
   * Calculate similarity between two strings using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate enhanced confidence based on corrections applied
   */
  private calculateEnhancedConfidence(baseConfidence: number, corrections: any[]): number {
    let enhancedConfidence = baseConfidence;
    
    // Boost confidence for successful pattern matches
    const patternMatches = corrections.filter(c => c.type === 'sheet_number' || c.type === 'sheet_name');
    enhancedConfidence += patternMatches.length * 5;
    
    // Slight boost for formatting corrections
    const formattingCorrections = corrections.filter(c => c.type === 'formatting');
    enhancedConfidence += formattingCorrections.length * 2;
    
    // Cap at 100%
    return Math.min(100, enhancedConfidence);
  }

  /**
   * Validate if a sheet number follows expected patterns
   */
  validateSheetNumber(sheetNumber: string): { isValid: boolean; suggestions: string[] } {
    const suggestions: string[] = [];
    
    for (const pattern of this.sheetNumberPatterns) {
      if (pattern.pattern.test(sheetNumber)) {
        return { isValid: true, suggestions: [] };
      }
    }
    
    // Generate suggestions for invalid sheet numbers
    if (sheetNumber.length <= 4) {
      suggestions.push('A1', 'A2', 'B1', 'B2', '1', '2', '3');
    }
    
    return { isValid: false, suggestions };
  }

  /**
   * Get suggestions for sheet names based on partial input
   */
  getSheetNameSuggestions(partialName: string): string[] {
    const suggestions: string[] = [];
    const partial = partialName.toUpperCase();
    
    for (const correction of this.sheetNameCorrections) {
      if (correction.common.includes(partial) || partial.includes(correction.common)) {
        suggestions.push(correction.common);
      }
    }
    
    return suggestions.slice(0, 5); // Return top 5 suggestions
  }
}

export const enhancedOcrService = new EnhancedOCRService();

