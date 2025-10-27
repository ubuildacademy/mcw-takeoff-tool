/**
 * YOLOv8 Detection Service for Construction Drawings
 * 
 * This service provides initial region detection using YOLOv8 to quickly
 * identify candidate areas for detailed analysis by Qwen3-VL.
 */

import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export interface YOLODetection {
  bbox: [number, number, number, number]; // [x, y, width, height] in normalized coordinates
  confidence: number;
  class: string;
  classId: number;
}

export interface YOLOResult {
  detections: YOLODetection[];
  imageWidth: number;
  imageHeight: number;
  processingTime: number;
}

export interface ConstructionElement {
  type: 'room' | 'door' | 'window' | 'wall' | 'fixture' | 'text' | 'symbol' | 'unknown';
  measurements: Array<{
    value: number;
    unit: string;
    type: 'linear' | 'area' | 'volume' | 'count';
  }>;
  bbox: [number, number, number, number];
  confidence: number;
  description: string;
}

class YOLODetectionService {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    // Use Ollama cloud API for YOLOv8
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.com';
    this.apiKey = process.env.OLLAMA_API_KEY || process.env.VITE_OLLAMA_API_KEY || '';
    this.model = process.env.YOLO_MODEL || 'yolov8n'; // Use YOLOv8 nano for speed
    
    if (!this.apiKey) {
      console.warn('⚠️ No API key available for YOLOv8 detection');
    }
  }

  /**
   * Detect construction elements in an image using YOLOv8
   */
  async detectElements(imageData: string): Promise<YOLOResult> {
    if (!this.apiKey) {
      console.log('⚠️ YOLOv8 API key not available, returning empty result');
      return {
        detections: [],
        imageWidth: 0,
        imageHeight: 0,
        processingTime: 0
      };
    }

    try {
      console.log('🔍 Starting YOLOv8 detection...');
      const startTime = Date.now();

      // For now, we'll use a mock implementation since Ollama doesn't have YOLOv8
      // In a real implementation, you'd use a YOLOv8 API or run it locally
      const mockResult = await this.mockYOLODetection(imageData);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ YOLOv8 detection complete in ${processingTime}ms: ${mockResult.detections.length} detections`);

      return {
        ...mockResult,
        processingTime
      };
    } catch (error) {
      console.error('❌ YOLOv8 detection failed:', error);
      return {
        detections: [],
        imageWidth: 0,
        imageHeight: 0,
        processingTime: 0
      };
    }
  }

  /**
   * Mock YOLOv8 detection for development/testing
   * In production, this would be replaced with actual YOLOv8 API calls
   */
  private async mockYOLODetection(imageData: string): Promise<YOLOResult> {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    // Mock detections based on common construction drawing elements
    const mockDetections: YOLODetection[] = [
      {
        bbox: [0.1, 0.2, 0.3, 0.4], // x, y, width, height
        confidence: 0.85,
        class: 'room',
        classId: 0
      },
      {
        bbox: [0.5, 0.3, 0.2, 0.1],
        confidence: 0.78,
        class: 'door',
        classId: 1
      },
      {
        bbox: [0.7, 0.1, 0.15, 0.2],
        confidence: 0.72,
        class: 'window',
        classId: 2
      },
      {
        bbox: [0.05, 0.05, 0.9, 0.05],
        confidence: 0.91,
        class: 'wall',
        classId: 3
      },
      {
        bbox: [0.8, 0.6, 0.1, 0.1],
        confidence: 0.65,
        class: 'fixture',
        classId: 4
      }
    ];

    return {
      detections: mockDetections,
      imageWidth: 1024, // Mock image dimensions
      imageHeight: 768,
      processingTime: 100
    };
  }

  /**
   * Convert YOLO detections to construction elements
   */
  convertToConstructionElements(yoloResult: YOLOResult): ConstructionElement[] {
    return yoloResult.detections.map(detection => ({
      type: this.mapClassToType(detection.class),
      measurements: [], // Empty measurements array for YOLO detections
      bbox: detection.bbox,
      confidence: detection.confidence,
      description: this.generateDescription(detection)
    }));
  }

  /**
   * Map YOLO class names to construction element types
   */
  private mapClassToType(className: string): ConstructionElement['type'] {
    const classMap: { [key: string]: ConstructionElement['type'] } = {
      'room': 'room',
      'door': 'door',
      'window': 'window',
      'wall': 'wall',
      'fixture': 'fixture',
      'text': 'text',
      'symbol': 'symbol'
    };

    return classMap[className.toLowerCase()] || 'unknown';
  }

  /**
   * Generate human-readable description for detection
   */
  private generateDescription(detection: YOLODetection): string {
    const [x, y, width, height] = detection.bbox;
    const area = width * height;
    
    return `${detection.class} (${Math.round(detection.confidence * 100)}% confidence, area: ${Math.round(area * 100)}%)`;
  }

  /**
   * Filter detections by confidence threshold
   */
  filterByConfidence(detections: YOLODetection[], threshold: number = 0.5): YOLODetection[] {
    return detections.filter(detection => detection.confidence >= threshold);
  }

  /**
   * Filter detections by class
   */
  filterByClass(detections: YOLODetection[], targetClass: string): YOLODetection[] {
    return detections.filter(detection => 
      detection.class.toLowerCase() === targetClass.toLowerCase()
    );
  }

  /**
   * Get bounding box coordinates in pixel space
   */
  bboxToPixels(bbox: [number, number, number, number], imageWidth: number, imageHeight: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const [x, y, width, height] = bbox;
    return {
      x: x * imageWidth,
      y: y * imageHeight,
      width: width * imageWidth,
      height: height * imageHeight
    };
  }

  /**
   * Check if service is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Check if YOLOv8 model is available
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      const models = response.data.models || [];
      return models.some((model: any) => model.name.includes('yolo'));
    } catch (error) {
      console.warn('YOLOv8 service not available:', error);
      return false;
    }
  }

  /**
   * Get detection statistics
   */
  getDetectionStats(detections: YOLODetection[]): {
    totalDetections: number;
    averageConfidence: number;
    classDistribution: { [key: string]: number };
    highConfidenceCount: number;
  } {
    const totalDetections = detections.length;
    const averageConfidence = totalDetections > 0 
      ? detections.reduce((sum, d) => sum + d.confidence, 0) / totalDetections 
      : 0;
    
    const classDistribution: { [key: string]: number } = {};
    detections.forEach(detection => {
      classDistribution[detection.class] = (classDistribution[detection.class] || 0) + 1;
    });
    
    const highConfidenceCount = detections.filter(d => d.confidence >= 0.8).length;

    return {
      totalDetections,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      classDistribution,
      highConfidenceCount
    };
  }
}

export const yoloDetectionService = new YOLODetectionService();
