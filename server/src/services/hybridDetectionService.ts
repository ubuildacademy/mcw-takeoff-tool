/**
 * Hybrid Detection Service
 * 
 * This service combines YOLOv8 (fast region detection) with Qwen3-VL (detailed analysis)
 * to provide more accurate and efficient construction takeoff analysis.
 */

import { yoloDetectionService, YOLODetection, ConstructionElement } from './yoloDetectionService';
import { qwenVisionService } from './qwenVisionService';
import { enhancedOcrService } from './enhancedOcrService';
import { ruleBasedValidationService } from './ruleBasedValidationService';

export interface HybridDetectionResult {
  elements: ConstructionElement[];
  measurements: Array<{
    elementIndex: number;
    points: Array<{ x: number; y: number }>;
    calculatedValue: number;
    confidence: number;
  }>;
  scaleInfo: {
    scaleFactor: number;
    unit: string;
    scaleText: string;
    confidence: number;
  };
  ocrData: {
    textElements: any[];
    scaleInfo: any;
    dimensions: any[];
    roomNames: string[];
    symbols: string[];
    context: string;
  };
  validation: {
    overallValid: boolean;
    errors: any[];
    warnings: any[];
    info: any[];
    suggestions: string[];
    confidence: number;
  };
  processingTime: {
    yolo: number;
    qwen: number;
    ocr: number;
    validation: number;
    total: number;
  };
  statistics: {
    totalElements: number;
    highConfidenceElements: number;
    averageConfidence: number;
  };
}

export interface HybridDetectionOptions {
  yoloConfidenceThreshold: number;
  qwenConfidenceThreshold: number;
  maxElementsToAnalyze: number;
  enableDetailedAnalysis: boolean;
}

class HybridDetectionService {
  private defaultOptions: HybridDetectionOptions = {
    yoloConfidenceThreshold: 0.5,
    qwenConfidenceThreshold: 0.7,
    maxElementsToAnalyze: 20,
    enableDetailedAnalysis: true
  };

  /**
   * Perform hybrid detection on a construction drawing
   */
  async detectElements(
    imageData: string,
    scope: string,
    options: Partial<HybridDetectionOptions> = {}
  ): Promise<HybridDetectionResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();

    console.log('🔍 Starting hybrid detection pipeline...');
    console.log(`📋 Scope: ${scope}`);
    console.log(`⚙️ Options:`, opts);

    try {
      // Step 1: YOLOv8 - Fast region detection
      console.log('🚀 Step 1: YOLOv8 region detection...');
      const yoloStartTime = Date.now();
      const yoloResult = await yoloDetectionService.detectElements(imageData);
      const yoloTime = Date.now() - yoloStartTime;

      console.log(`✅ YOLOv8 complete: ${yoloResult.detections.length} regions found in ${yoloTime}ms`);

      // Step 2: OCR Analysis - Extract text and context information
      console.log('📝 Step 2: OCR analysis...');
      const ocrStartTime = Date.now();
      const ocrResult = await enhancedOcrService.analyzeImage(imageData);
      const ocrTime = Date.now() - ocrStartTime;
      const ocrData = enhancedOcrService.getAIDecisionData(ocrResult);

      console.log(`✅ OCR complete: ${ocrResult.textElements.length} text elements found in ${ocrTime}ms`);

      // Step 3: Filter and prioritize detections
      const filteredDetections = this.filterAndPrioritizeDetections(
        yoloResult.detections,
        scope,
        opts
      );

      console.log(`🎯 Filtered to ${filteredDetections.length} relevant regions`);

      // Step 4: Qwen3-VL - Detailed analysis of selected regions with OCR context
      let qwenTime = 0;
      let detailedElements: ConstructionElement[] = [];
      let measurements: any[] = [];
      let scaleInfo = ocrData.scaleInfo || {
        scaleFactor: 0.0833,
        unit: 'ft',
        scaleText: 'estimated',
        confidence: 0.5
      };

      if (opts.enableDetailedAnalysis && filteredDetections.length > 0) {
        console.log('🤖 Step 3: Qwen3-VL detailed analysis with OCR context...');
        const qwenStartTime = Date.now();
        
        const analysisResult = await this.analyzeRegionsWithQwen(
          imageData,
          filteredDetections,
          scope,
          opts,
          ocrData
        );
        
        qwenTime = Date.now() - qwenStartTime;
        detailedElements = analysisResult.elements;
        measurements = analysisResult.measurements;
        scaleInfo = analysisResult.scaleInfo || scaleInfo;

        console.log(`✅ Qwen3-VL complete: ${detailedElements.length} elements analyzed in ${qwenTime}ms`);
      } else {
        // Fallback to YOLO-only results
        detailedElements = yoloDetectionService.convertToConstructionElements(yoloResult);
        console.log('⚠️ Using YOLO-only results (Qwen3-VL disabled or no regions)');
      }

      // Step 5: Combine and validate results
      const finalElements = this.combineAndValidateResults(
        detailedElements,
        filteredDetections,
        scope
      );

      // Step 6: Rule-based validation
      console.log('🔍 Step 4: Rule-based validation...');
      const validationStartTime = Date.now();
      const validationResult = await ruleBasedValidationService.validateTakeoffResults(
        finalElements,
        scaleInfo,
        ocrData
      );
      const validationTime = Date.now() - validationStartTime;

      console.log(`✅ Validation complete: ${validationResult.errors.length} errors, ${validationResult.warnings.length} warnings in ${validationTime}ms`);

      const totalTime = Date.now() - startTime;
      const statistics = this.calculateStatistics(finalElements);

      console.log(`🎉 Hybrid detection complete in ${totalTime}ms`);
      console.log(`📊 Statistics:`, statistics);

      return {
        elements: finalElements,
        measurements,
        scaleInfo,
        ocrData,
        validation: {
          overallValid: validationResult.overallValid,
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          info: validationResult.info,
          suggestions: validationResult.suggestions,
          confidence: validationResult.confidence
        },
        processingTime: {
          yolo: yoloTime,
          qwen: qwenTime,
          ocr: ocrTime,
          validation: validationTime,
          total: totalTime
        },
        statistics
      };

    } catch (error) {
      console.error('❌ Hybrid detection failed:', error);
      throw new Error(`Hybrid detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Filter and prioritize YOLO detections based on scope
   */
  private filterAndPrioritizeDetections(
    detections: YOLODetection[],
    scope: string,
    options: HybridDetectionOptions
  ): YOLODetection[] {
    // Filter by confidence
    let filtered = yoloDetectionService.filterByConfidence(detections, options.yoloConfidenceThreshold);

    // Filter by scope relevance
    const scopeLower = scope.toLowerCase();
    const relevantClasses = this.getRelevantClasses(scopeLower);
    
    if (relevantClasses.length > 0) {
      filtered = filtered.filter(detection => 
        relevantClasses.some(cls => detection.class.toLowerCase().includes(cls))
      );
    }

    // Sort by confidence (highest first)
    filtered.sort((a, b) => b.confidence - a.confidence);

    // Limit to max elements
    return filtered.slice(0, options.maxElementsToAnalyze);
  }

  /**
   * Get relevant class names based on scope
   */
  private getRelevantClasses(scope: string): string[] {
    const scopeToClasses: { [key: string]: string[] } = {
      'door': ['door', 'opening'],
      'window': ['window', 'opening'],
      'floor': ['room', 'area'],
      'wall': ['wall', 'boundary'],
      'fixture': ['fixture', 'equipment'],
      'electrical': ['fixture', 'outlet', 'switch'],
      'plumbing': ['fixture', 'pipe'],
      'hvac': ['fixture', 'duct']
    };

    for (const [keyword, classes] of Object.entries(scopeToClasses)) {
      if (scope.includes(keyword)) {
        return classes;
      }
    }

    // Default: return all classes if no specific match
    return ['room', 'door', 'window', 'wall', 'fixture', 'text', 'symbol'];
  }

  /**
   * Analyze selected regions with Qwen3-VL
   */
  private async analyzeRegionsWithQwen(
    imageData: string,
    detections: YOLODetection[],
    scope: string,
    options: HybridDetectionOptions,
    ocrData?: any
  ): Promise<{
    elements: ConstructionElement[];
    measurements: any[];
    scaleInfo: any;
  }> {
    try {
      // For now, we'll use the existing Qwen3-VL service
      // In a full implementation, we'd crop regions and analyze them individually
      const qwenResult = await qwenVisionService.analyzePageForTakeoff(
        imageData,
        scope,
        1, // page number
        'floor-plan', // page type
        ocrData // Pass OCR context to Qwen3-VL
      );

      // Convert Qwen3-VL results to our format
      const elements: ConstructionElement[] = qwenResult.conditions.map((condition, index) => ({
        type: this.mapConditionToElementType(condition.name),
        measurements: [], // Empty measurements array for Qwen3-VL results
        bbox: this.estimateBboxFromMeasurements(qwenResult.measurements, index),
        confidence: 0.8, // Default confidence for Qwen3-VL results
        description: condition.description
      }));

      return {
        elements,
        measurements: qwenResult.measurements,
        scaleInfo: qwenResult.calibration
      };

    } catch (error) {
      console.error('❌ Qwen3-VL analysis failed:', error);
      // Return empty results on failure
      return {
        elements: [],
        measurements: [],
        scaleInfo: {
          scaleFactor: 0.0833,
          unit: 'ft',
          scaleText: 'estimated',
          confidence: 0.5
        }
      };
    }
  }

  /**
   * Map condition name to element type
   */
  private mapConditionToElementType(conditionName: string): ConstructionElement['type'] {
    const nameLower = conditionName.toLowerCase();
    
    if (nameLower.includes('door')) return 'door';
    if (nameLower.includes('window')) return 'window';
    if (nameLower.includes('room') || nameLower.includes('area')) return 'room';
    if (nameLower.includes('wall')) return 'wall';
    if (nameLower.includes('fixture') || nameLower.includes('outlet')) return 'fixture';
    
    return 'unknown';
  }

  /**
   * Estimate bounding box from measurements
   */
  private estimateBboxFromMeasurements(measurements: any[], conditionIndex: number): [number, number, number, number] {
    const conditionMeasurements = measurements.filter(m => m.conditionIndex === conditionIndex);
    
    if (conditionMeasurements.length === 0) {
      return [0, 0, 0.1, 0.1]; // Default small box
    }

    // Calculate bounding box from measurement points
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    
    conditionMeasurements.forEach(measurement => {
      measurement.points.forEach((point: { x: number; y: number }) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      });
    });

    return [minX, minY, maxX - minX, maxY - minY];
  }

  /**
   * Combine and validate results from both detection methods
   */
  private combineAndValidateResults(
    qwenElements: ConstructionElement[],
    yoloDetections: YOLODetection[],
    scope: string
  ): ConstructionElement[] {
    // For now, prioritize Qwen3-VL results as they're more detailed
    // In a full implementation, we'd merge and deduplicate results
    const combined = [...qwenElements];

    // Add high-confidence YOLO detections that weren't covered by Qwen3-VL
    const yoloElements = yoloDetectionService.convertToConstructionElements({
      detections: yoloDetections,
      imageWidth: 1024,
      imageHeight: 768,
      processingTime: 0
    });

    // Simple deduplication based on bounding box overlap
    yoloElements.forEach(yoloElement => {
      const hasOverlap = combined.some(qwenElement => 
        this.calculateOverlap(yoloElement.bbox, qwenElement.bbox) > 0.3
      );
      
      if (!hasOverlap && yoloElement.confidence > 0.8) {
        combined.push(yoloElement);
      }
    });

    return combined;
  }

  /**
   * Calculate overlap between two bounding boxes
   */
  private calculateOverlap(bbox1: [number, number, number, number], bbox2: [number, number, number, number]): number {
    const [x1, y1, w1, h1] = bbox1;
    const [x2, y2, w2, h2] = bbox2;

    const xOverlap = Math.max(0, Math.min(x1 + w1, x2 + w2) - Math.max(x1, x2));
    const yOverlap = Math.max(0, Math.min(y1 + h1, y2 + h2) - Math.max(y1, y2));
    const overlapArea = xOverlap * yOverlap;

    const area1 = w1 * h1;
    const area2 = w2 * h2;
    const unionArea = area1 + area2 - overlapArea;

    return unionArea > 0 ? overlapArea / unionArea : 0;
  }

  /**
   * Calculate detection statistics
   */
  private calculateStatistics(elements: ConstructionElement[]): {
    totalElements: number;
    highConfidenceElements: number;
    averageConfidence: number;
  } {
    const totalElements = elements.length;
    const highConfidenceElements = elements.filter(e => e.confidence >= 0.8).length;
    const averageConfidence = totalElements > 0 
      ? elements.reduce((sum, e) => sum + e.confidence, 0) / totalElements 
      : 0;

    return {
      totalElements,
      highConfidenceElements,
      averageConfidence: Math.round(averageConfidence * 100) / 100
    };
  }

  /**
   * Check if hybrid detection is available
   */
  async isAvailable(): Promise<boolean> {
    const yoloAvailable = await yoloDetectionService.isAvailable();
    const qwenAvailable = await qwenVisionService.isAvailable();
    
    console.log(`🔍 Service availability: YOLOv8=${yoloAvailable}, Qwen3-VL=${qwenAvailable}`);
    
    // Hybrid detection works if at least one service is available
    return yoloAvailable || qwenAvailable;
  }

  /**
   * Get service status
   */
  async getServiceStatus(): Promise<{
    yolo: boolean;
    qwen: boolean;
    hybrid: boolean;
  }> {
    const yolo = await yoloDetectionService.isAvailable();
    const qwen = await qwenVisionService.isAvailable();
    
    return {
      yolo,
      qwen,
      hybrid: yolo || qwen
    };
  }
}

export const hybridDetectionService = new HybridDetectionService();
