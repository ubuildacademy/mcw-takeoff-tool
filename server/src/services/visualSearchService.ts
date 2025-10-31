/**
 * Visual Search Service for Symbol Detection and Matching
 * 
 * This service uses YOLO to detect and match symbols in construction drawings
 * based on user-selected reference symbols.
 */

import { yoloDetectionService, YOLODetection } from './yoloDetectionService';
import { pdfToImage } from '../utils/pdfToImage';
import { storage } from '../storage';
// Define types locally since types file doesn't exist
export interface VisualSearchMatch {
  id: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pageNumber: number;
  documentId?: string;
  pdfCoordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  description?: string;
}

export interface VisualSearchResult {
  matches: VisualSearchMatch[];
  totalMatches: number;
  searchTime: number;
  conditionId?: string;
  searchImageId?: string;
  processingTime?: number;
  threshold?: number;
}

export interface SymbolTemplate {
  id: string;
  imageData: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  features?: number[]; // Feature vector for matching
  description?: string;
}

export interface VisualSearchOptions {
  confidenceThreshold: number;
  maxMatches: number;
  searchRadius: number; // How far to search around the template
  scaleTolerance: number; // How much scale variation to allow
}

class VisualSearchService {
  private defaultOptions: VisualSearchOptions = {
    confidenceThreshold: 0.7,
    maxMatches: 100,
    searchRadius: 0.1, // 10% of image size
    scaleTolerance: 0.2 // 20% scale variation
  };

  /**
   * Extract a symbol template from a selection box on a PDF page
   */
  async extractSymbolTemplate(
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number }
  ): Promise<SymbolTemplate> {
    try {
      console.log('🔍 Extracting symbol template from selection box...');
      
      // Convert PDF page to image
      const result = await pdfToImage.convertPageToImage(pdfFileId, { pageNumber });
      if (!result.success || !result.images.length) {
        throw new Error('Failed to convert PDF page to image');
      }
      const imageData = result.images[0];
      
      // Extract the selected region
      const template = await this.cropImageRegion(imageData, selectionBox);
      
      // Generate a unique ID for this template
      const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        id: templateId,
        imageData: template,
        boundingBox: selectionBox,
        description: `Symbol template extracted from page ${pageNumber}`
      };
    } catch (error) {
      console.error('❌ Failed to extract symbol template:', error);
      throw new Error('Failed to extract symbol template');
    }
  }

  /**
   * Search for symbols matching the template across all pages of a PDF
   */
  async searchForSymbols(
    conditionId: string,
    pdfFileId: string,
    template: SymbolTemplate,
    options: Partial<VisualSearchOptions> = {}
  ): Promise<VisualSearchResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();

    try {
      console.log(`🔍 Searching for symbols matching template ${template.id}...`);
      
      // Get the PDF file info
      const files = await storage.getFiles();
      const pdfFile = files.find(f => f.id === pdfFileId);
      if (!pdfFile) {
        throw new Error('PDF file not found');
      }

      // For now, we'll search on the current page only
      // In a full implementation, we'd search across all pages
      const pageNumber = 1; // This should be passed as a parameter
      
      // Convert PDF page to image
      const result = await pdfToImage.convertPageToImage(pdfFileId, { pageNumber });
      if (!result.success || !result.images.length) {
        throw new Error('Failed to convert PDF page to image');
      }
      const imageData = result.images[0];
      
      // Use YOLO to detect objects in the image
      const yoloResult = await yoloDetectionService.detectElements(imageData);
      
      // Filter detections based on the template
      const matches = await this.matchDetectionsToTemplate(
        yoloResult.detections,
        template,
        opts
      );

      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Visual search complete: ${matches.length} matches found in ${processingTime}ms`);

      return {
        conditionId,
        matches,
        totalMatches: matches.length,
        searchTime: processingTime,
        searchImageId: template.id,
        processingTime,
        threshold: opts.confidenceThreshold
      };
    } catch (error) {
      console.error('❌ Visual search failed:', error);
      throw new Error('Visual search failed');
    }
  }

  /**
   * Match YOLO detections to the symbol template
   */
  private async matchDetectionsToTemplate(
    detections: YOLODetection[],
    template: SymbolTemplate,
    options: VisualSearchOptions
  ): Promise<VisualSearchMatch[]> {
    const matches: VisualSearchMatch[] = [];
    
    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      
      // Calculate similarity score (simplified for now)
      const similarity = this.calculateSimilarity(detection, template, options);
      
      if (similarity >= options.confidenceThreshold) {
        const match: VisualSearchMatch = {
          id: `match_${Date.now()}_${i}`,
          pageNumber: 1, // This should be the actual page number
          documentId: '', // This should be the actual document ID
          confidence: similarity,
          boundingBox: {
            x: detection.bbox[0],
            y: detection.bbox[1],
            width: detection.bbox[2],
            height: detection.bbox[3]
          },
          pdfCoordinates: {
            x: detection.bbox[0],
            y: detection.bbox[1],
            width: detection.bbox[2],
            height: detection.bbox[3]
          },
          description: `Match for ${template.description || 'symbol'}`
        };
        
        matches.push(match);
      }
    }
    
    // Sort by confidence and limit results
    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, options.maxMatches);
  }

  /**
   * Calculate similarity between a detection and template
   * This is a simplified implementation - in production, you'd use more sophisticated matching
   */
  private calculateSimilarity(
    detection: YOLODetection,
    template: SymbolTemplate,
    options: VisualSearchOptions
  ): number {
    // For now, we'll use a simple size and position-based similarity
    // In production, you'd use feature matching, template matching, or ML-based similarity
    
    const detectionArea = detection.bbox[2] * detection.bbox[3];
    const templateArea = template.boundingBox.width * template.boundingBox.height;
    
    // Size similarity (how close the areas are)
    const sizeRatio = Math.min(detectionArea, templateArea) / Math.max(detectionArea, templateArea);
    
    // Class confidence from YOLO
    const classConfidence = detection.confidence;
    
    // Combine size similarity and class confidence
    const similarity = (sizeRatio * 0.6) + (classConfidence * 0.4);
    
    return Math.min(similarity, 1.0);
  }

  /**
   * Crop an image region based on selection box
   */
  private async cropImageRegion(
    imageData: string,
    selectionBox: { x: number; y: number; width: number; height: number }
  ): Promise<string> {
    // This is a simplified implementation
    // In production, you'd use a proper image processing library like sharp or canvas
    
    // For now, we'll return the original image data
    // The actual implementation would crop the specified region
    return imageData;
  }

  /**
   * Create count measurements from visual search matches
   * Each match becomes a count measurement with a dot at the center of the bounding box
   */
  async createCountMeasurements(
    conditionId: string,
    matches: VisualSearchMatch[],
    projectId: string,
    sheetId: string
  ): Promise<void> {
    try {
      console.log(`📊 Creating ${matches.length} count measurements...`);
      
      for (const match of matches) {
        // Calculate the center point of the bounding box for the dot
        const centerX = match.boundingBox.x + (match.boundingBox.width / 2);
        const centerY = match.boundingBox.y + (match.boundingBox.height / 2);
        
        const measurement = {
          id: `measurement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          projectId,
          sheetId,
          conditionId,
          type: 'count' as const,
          points: [{ x: centerX, y: centerY }], // Single point for count measurement (dot)
          calculatedValue: 1, // Each match counts as 1
          unit: 'EA',
          timestamp: new Date().toISOString(),
          pdfPage: match.pageNumber,
          pdfCoordinates: [
            { 
              x: match.pdfCoordinates.x + (match.pdfCoordinates.width / 2), 
              y: match.pdfCoordinates.y + (match.pdfCoordinates.height / 2) 
            }
          ],
          conditionColor: '#3B82F6', // Blue color for visual search matches
          conditionName: 'Visual Search Match'
        };
        
        await storage.saveTakeoffMeasurement(measurement);
      }
      
      console.log(`✅ Created ${matches.length} count measurements`);
    } catch (error) {
      console.error('❌ Failed to create count measurements:', error);
      throw new Error('Failed to create count measurements');
    }
  }
}

export const visualSearchService = new VisualSearchService();
