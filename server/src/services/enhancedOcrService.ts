/**
 * Enhanced OCR Service for Construction Drawings
 * 
 * This service provides structured OCR data specifically designed to inform
 * AI decision making in construction takeoff analysis.
 */

import { simpleOcrService } from './simpleOcrService';

export interface OCRTextElement {
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  type: 'dimension' | 'label' | 'room_name' | 'scale' | 'note' | 'symbol' | 'other';
  context?: string;
}

export interface OCRScaleInfo {
  scaleText: string;
  scaleValue: number;
  unit: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OCRDimension {
  value: number;
  unit: string;
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  context?: string;
}

export interface OCRRoomInfo {
  name: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  area?: number;
  dimensions?: string[];
}

export interface EnhancedOCRResult {
  textElements: OCRTextElement[];
  scaleInfo: OCRScaleInfo | null;
  dimensions: OCRDimension[];
  roomNames: OCRRoomInfo[];
  symbols: OCRTextElement[];
  notes: OCRTextElement[];
  processingTime: number;
  confidence: number;
}

class EnhancedOCRService {
  private scalePatterns = [
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*ft/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*feet/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*foot/i,
    /scale\s*:?\s*(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*ft/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*in/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*inch/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*mm/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*m/i,
    /(\d+)\s*["']?\s*=\s*(\d+)\s*["']?\s*meter/i
  ];

  private dimensionPatterns = [
    /(\d+(?:\.\d+)?)\s*["']?\s*ft/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*feet/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*foot/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*in/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*inch/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*mm/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*m/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*meter/i,
    /(\d+(?:\.\d+)?)\s*["']?\s*cm/i
  ];

  private roomNamePatterns = [
    /(?:room|rm|space|area)\s*:?\s*([a-zA-Z0-9\s\-_]+)/i,
    /([a-zA-Z0-9\s\-_]+)\s*room/i,
    /([a-zA-Z0-9\s\-_]+)\s*space/i,
    /([a-zA-Z0-9\s\-_]+)\s*area/i
  ];

  private symbolPatterns = [
    /[▲▼◄►●○■□◆◇]/,
    /[A-Z]\d+/,
    /\d+[A-Z]/,
    /[A-Z]{2,}/,
    /\d+[A-Z]\d+/
  ];

  /**
   * Perform enhanced OCR analysis on an image
   */
  async analyzeImage(imageData: string): Promise<EnhancedOCRResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔍 Starting enhanced OCR analysis...');
      
      // Get basic OCR results
      const basicOcrResult = await simpleOcrService.analyzeImage(imageData);
      
      if (!basicOcrResult.success || !basicOcrResult.text) {
        console.log('⚠️ Basic OCR failed, returning empty result');
        return this.createEmptyResult();
      }

      // Parse and categorize text elements
      const textElements = this.parseTextElements(basicOcrResult.text, basicOcrResult.words || []);
      
      // Extract specific information
      const scaleInfo = this.extractScaleInfo(textElements);
      const dimensions = this.extractDimensions(textElements);
      const roomNames = this.extractRoomNames(textElements);
      const symbols = this.extractSymbols(textElements);
      const notes = this.extractNotes(textElements);

      const processingTime = Date.now() - startTime;
      const confidence = this.calculateOverallConfidence(textElements);

      console.log(`✅ Enhanced OCR complete in ${processingTime}ms: ${textElements.length} elements, confidence: ${Math.round(confidence * 100)}%`);

      return {
        textElements,
        scaleInfo,
        dimensions,
        roomNames,
        symbols,
        notes,
        processingTime,
        confidence
      };

    } catch (error) {
      console.error('❌ Enhanced OCR analysis failed:', error);
      return this.createEmptyResult();
    }
  }

  /**
   * Parse OCR text into structured elements
   */
  private parseTextElements(ocrText: string, words: any[]): OCRTextElement[] {
    const elements: OCRTextElement[] = [];
    const lines = ocrText.split('\n');

    lines.forEach((line, lineIndex) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      // Find corresponding word data for this line
      const lineWords = words.filter(word => 
        word.text && trimmedLine.includes(word.text.trim())
      );

      // Calculate bounding box for the line
      const bbox = this.calculateLineBbox(lineWords);

      // Determine element type
      const type = this.classifyTextElement(trimmedLine);

      // Calculate confidence
      const confidence = lineWords.length > 0 
        ? lineWords.reduce((sum, word) => sum + (word.confidence || 0.5), 0) / lineWords.length
        : 0.5;

      elements.push({
        text: trimmedLine,
        confidence,
        bbox,
        type,
        context: this.extractContext(trimmedLine)
      });
    });

    return elements;
  }

  /**
   * Calculate bounding box for a line of text
   */
  private calculateLineBbox(words: any[]): { x: number; y: number; width: number; height: number } {
    if (words.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const x = Math.min(...words.map(w => w.bbox?.x || 0));
    const y = Math.min(...words.map(w => w.bbox?.y || 0));
    const maxX = Math.max(...words.map(w => (w.bbox?.x || 0) + (w.bbox?.width || 0)));
    const maxY = Math.max(...words.map(w => (w.bbox?.y || 0) + (w.bbox?.height || 0)));

    return {
      x,
      y,
      width: maxX - x,
      height: maxY - y
    };
  }

  /**
   * Classify text element type
   */
  private classifyTextElement(text: string): OCRTextElement['type'] {
    const lowerText = text.toLowerCase();

    // Check for scale information
    if (this.scalePatterns.some(pattern => pattern.test(text))) {
      return 'scale';
    }

    // Check for dimensions
    if (this.dimensionPatterns.some(pattern => pattern.test(text))) {
      return 'dimension';
    }

    // Check for room names
    if (this.roomNamePatterns.some(pattern => pattern.test(text))) {
      return 'room_name';
    }

    // Check for symbols
    if (this.symbolPatterns.some(pattern => pattern.test(text))) {
      return 'symbol';
    }

    // Check for notes (longer text, often in parentheses)
    if (text.length > 20 || (text.startsWith('(') && text.endsWith(')'))) {
      return 'note';
    }

    // Default to label
    return 'label';
  }

  /**
   * Extract context information from text
   */
  private extractContext(text: string): string | undefined {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('scale')) return 'scale_indicator';
    if (lowerText.includes('room') || lowerText.includes('space')) return 'room_indicator';
    if (lowerText.includes('dimension') || lowerText.includes('size')) return 'dimension_indicator';
    if (lowerText.includes('note') || lowerText.includes('see')) return 'note_indicator';
    
    return undefined;
  }

  /**
   * Extract scale information
   */
  private extractScaleInfo(elements: OCRTextElement[]): OCRScaleInfo | null {
    const scaleElements = elements.filter(e => e.type === 'scale');
    
    if (scaleElements.length === 0) return null;

    // Find the most confident scale element
    const bestScale = scaleElements.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    // Parse scale value
    for (const pattern of this.scalePatterns) {
      const match = bestScale.text.match(pattern);
      if (match) {
        const drawingUnits = parseFloat(match[1]);
        const realUnits = parseFloat(match[2]);
        const unit = bestScale.text.toLowerCase().includes('in') ? 'in' : 'ft';
        
        return {
          scaleText: bestScale.text,
          scaleValue: realUnits / drawingUnits,
          unit,
          confidence: bestScale.confidence,
          bbox: bestScale.bbox
        };
      }
    }

    return null;
  }

  /**
   * Extract dimension information
   */
  private extractDimensions(elements: OCRTextElement[]): OCRDimension[] {
    const dimensionElements = elements.filter(e => e.type === 'dimension');
    
    return dimensionElements.map(element => {
      // Parse dimension value
      for (const pattern of this.dimensionPatterns) {
        const match = element.text.match(pattern);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = this.extractUnit(element.text);
          
          return {
            value,
            unit,
            text: element.text,
            confidence: element.confidence,
            bbox: element.bbox,
            context: element.context
          };
        }
      }

      // Fallback
      return {
        value: 0,
        unit: 'ft',
        text: element.text,
        confidence: element.confidence,
        bbox: element.bbox,
        context: element.context
      };
    });
  }

  /**
   * Extract room names
   */
  private extractRoomNames(elements: OCRTextElement[]): OCRRoomInfo[] {
    const roomElements = elements.filter(e => e.type === 'room_name');
    
    return roomElements.map(element => {
      // Extract room name from text
      for (const pattern of this.roomNamePatterns) {
        const match = element.text.match(pattern);
        if (match) {
          return {
            name: match[1].trim(),
            confidence: element.confidence,
            bbox: element.bbox
          };
        }
      }

      // Fallback - use entire text
      return {
        name: element.text,
        confidence: element.confidence,
        bbox: element.bbox
      };
    });
  }

  /**
   * Extract symbols
   */
  private extractSymbols(elements: OCRTextElement[]): OCRTextElement[] {
    return elements.filter(e => e.type === 'symbol');
  }

  /**
   * Extract notes
   */
  private extractNotes(elements: OCRTextElement[]): OCRTextElement[] {
    return elements.filter(e => e.type === 'note');
  }

  /**
   * Extract unit from text
   */
  private extractUnit(text: string): string {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('ft') || lowerText.includes('feet') || lowerText.includes('foot')) return 'ft';
    if (lowerText.includes('in') || lowerText.includes('inch')) return 'in';
    if (lowerText.includes('mm')) return 'mm';
    if (lowerText.includes('cm')) return 'cm';
    if (lowerText.includes('m') || lowerText.includes('meter')) return 'm';
    
    return 'ft'; // Default
  }

  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(elements: OCRTextElement[]): number {
    if (elements.length === 0) return 0;
    
    const totalConfidence = elements.reduce((sum, element) => sum + element.confidence, 0);
    return totalConfidence / elements.length;
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): EnhancedOCRResult {
    return {
      textElements: [],
      scaleInfo: null,
      dimensions: [],
      roomNames: [],
      symbols: [],
      notes: [],
      processingTime: 0,
      confidence: 0
    };
  }

  /**
   * Get OCR data for AI decision making
   */
  getAIDecisionData(ocrResult: EnhancedOCRResult): {
    textElements: any[];
    scaleInfo: any;
    dimensions: any[];
    roomNames: string[];
    symbols: string[];
    context: string;
  } {
    return {
      textElements: ocrResult.textElements,
      scaleInfo: ocrResult.scaleInfo ? {
        scaleFactor: ocrResult.scaleInfo.scaleValue,
        unit: ocrResult.scaleInfo.unit,
        scaleText: ocrResult.scaleInfo.scaleText,
        confidence: ocrResult.scaleInfo.confidence
      } : null,
      dimensions: ocrResult.dimensions.map(d => ({
        value: d.value,
        unit: d.unit,
        text: d.text,
        confidence: d.confidence
      })),
      roomNames: ocrResult.roomNames.map(r => r.name),
      symbols: ocrResult.symbols.map(s => s.text),
      context: this.buildContextString(ocrResult)
    };
  }

  /**
   * Build context string for AI
   */
  private buildContextString(ocrResult: EnhancedOCRResult): string {
    const parts: string[] = [];
    
    if (ocrResult.scaleInfo) {
      parts.push(`Scale: ${ocrResult.scaleInfo.scaleText}`);
    }
    
    if (ocrResult.roomNames.length > 0) {
      parts.push(`Rooms: ${ocrResult.roomNames.map(r => r.name).join(', ')}`);
    }
    
    if (ocrResult.dimensions.length > 0) {
      parts.push(`Dimensions: ${ocrResult.dimensions.map(d => d.text).join(', ')}`);
    }
    
    if (ocrResult.symbols.length > 0) {
      parts.push(`Symbols: ${ocrResult.symbols.map(s => s.text).join(', ')}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Check if service is available
   */
  async isAvailable(): Promise<boolean> {
    return await simpleOcrService.isAvailable();
  }
}

export const enhancedOcrService = new EnhancedOCRService();
