/**
 * Frontend Hybrid Detection Service
 * 
 * Provides client-side interface for the hybrid detection pipeline
 */

export interface HybridDetectionOptions {
  yoloConfidenceThreshold: number;
  qwenConfidenceThreshold: number;
  maxElementsToAnalyze: number;
  enableDetailedAnalysis: boolean;
}

export interface ConstructionElement {
  type: 'room' | 'door' | 'window' | 'wall' | 'fixture' | 'text' | 'symbol' | 'unknown';
  bbox: [number, number, number, number];
  confidence: number;
  description: string;
}

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

export interface ServiceStatus {
  yolo: boolean;
  qwen: boolean;
  hybrid: boolean;
}

class HybridDetectionService {
  private baseUrl: string;

  constructor() {
    // Use consistent API base URL logic across all services
    const RUNTIME_API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
    this.baseUrl = RUNTIME_API_BASE
      || (import.meta.env.PROD
        ? '/api' // Use relative URLs - Vercel rewrites will proxy to Railway backend
        : 'http://localhost:4000/api'); // Development: use local backend
  }

  /**
   * Perform hybrid detection on an image
   */
  async detectElements(
    imageData: string,
    scope: string,
    options: Partial<HybridDetectionOptions> = {}
  ): Promise<HybridDetectionResult> {
    try {
      console.log(`🔍 Starting hybrid detection for scope: ${scope}`);
      
      const response = await fetch(`${this.baseUrl}/api/hybrid-detection/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData,
          scope,
          options
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Hybrid detection failed');
      }

      console.log(`✅ Hybrid detection complete: ${data.result.elements.length} elements found`);
      console.log(`⏱️ Processing times: YOLOv8=${data.result.processingTime.yolo}ms, Qwen3-VL=${data.result.processingTime.qwen}ms, Total=${data.result.processingTime.total}ms`);
      
      return data.result;
    } catch (error) {
      console.error('❌ Hybrid detection error:', error);
      throw new Error(`Hybrid detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get service availability status
   */
  async getServiceStatus(): Promise<ServiceStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/hybrid-detection/status`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Status check failed');
      }

      return data.status;
    } catch (error) {
      console.error('❌ Status check error:', error);
      return {
        yolo: false,
        qwen: false,
        hybrid: false
      };
    }
  }

  /**
   * Perform YOLOv8 detection only (for testing)
   */
  async detectWithYOLOOnly(imageData: string): Promise<any> {
    try {
      console.log('🔍 Starting YOLOv8-only detection...');
      
      const response = await fetch(`${this.baseUrl}/api/hybrid-detection/yolo-only`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'YOLOv8 detection failed');
      }

      console.log(`✅ YOLOv8 detection complete: ${data.result.elements.length} elements found`);
      
      return data.result;
    } catch (error) {
      console.error('❌ YOLOv8 detection error:', error);
      throw new Error(`YOLOv8 detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get YOLOv8 service statistics
   */
  async getYOLOStats(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/hybrid-detection/yolo-stats`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'YOLOv8 stats check failed');
      }

      return data;
    } catch (error) {
      console.error('❌ YOLOv8 stats error:', error);
      return {
        available: false,
        service: 'YOLOv8 Detection Service'
      };
    }
  }

  /**
   * Check if hybrid detection is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const status = await this.getServiceStatus();
      return status.hybrid;
    } catch (error) {
      console.warn('Hybrid detection availability check failed:', error);
      return false;
    }
  }

  /**
   * Get default options for hybrid detection
   */
  getDefaultOptions(): HybridDetectionOptions {
    return {
      yoloConfidenceThreshold: 0.5,
      qwenConfidenceThreshold: 0.7,
      maxElementsToAnalyze: 20,
      enableDetailedAnalysis: true
    };
  }

  /**
   * Format processing time for display
   */
  formatProcessingTime(processingTime: { yolo: number; qwen: number; total: number }): string {
    return `YOLOv8: ${processingTime.yolo}ms, Qwen3-VL: ${processingTime.qwen}ms, Total: ${processingTime.total}ms`;
  }

  /**
   * Format statistics for display
   */
  formatStatistics(statistics: { totalElements: number; highConfidenceElements: number; averageConfidence: number }): string {
    return `${statistics.totalElements} elements (${statistics.highConfidenceElements} high confidence, avg: ${Math.round(statistics.averageConfidence * 100)}%)`;
  }

  /**
   * Format validation results for display
   */
  formatValidationResults(validation: { overallValid: boolean; errors: any[]; warnings: any[]; info: any[]; suggestions: string[]; confidence: number }): string {
    const { overallValid, errors, warnings, info, suggestions, confidence } = validation;
    
    if (overallValid) {
      return `✅ Valid (${Math.round(confidence * 100)}% confidence)`;
    }
    
    const issueCount = errors.length + warnings.length;
    return `⚠️ ${issueCount} issues (${errors.length} errors, ${warnings.length} warnings) - ${Math.round(confidence * 100)}% confidence`;
  }

  /**
   * Get validation summary
   */
  getValidationSummary(validation: { overallValid: boolean; errors: any[]; warnings: any[]; info: any[]; suggestions: string[]; confidence: number }): {
    status: 'valid' | 'warning' | 'error';
    message: string;
    count: number;
  } {
    const { overallValid, errors, warnings } = validation;
    
    if (overallValid) {
      return {
        status: 'valid',
        message: 'All validations passed',
        count: 0
      };
    }
    
    if (errors.length > 0) {
      return {
        status: 'error',
        message: `${errors.length} validation errors`,
        count: errors.length
      };
    }
    
    return {
      status: 'warning',
      message: `${warnings.length} validation warnings`,
      count: warnings.length
    };
  }
}

export const hybridDetectionService = new HybridDetectionService();
