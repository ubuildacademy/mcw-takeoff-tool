/**
 * Enhanced Measurement Calculation Utilities
 * 
 * This module provides robust measurement calculations for construction takeoffs
 * with improved accuracy, validation, and error handling.
 */

export interface MeasurementPoint {
  x: number;
  y: number;
}

export interface MeasurementResult {
  calculatedValue: number;
  unit: string;
  perimeterValue?: number;
  confidence: number;
  validation: {
    isValid: boolean;
    warnings: string[];
    errors: string[];
  };
}

export interface ScaleInfo {
  scaleFactor: number;
  unit: string;
  scaleText: string;
  confidence: number;
}

export class MeasurementCalculator {
  /**
   * Calculate linear measurement from points
   */
  static calculateLinear(
    points: MeasurementPoint[],
    scaleInfo: ScaleInfo,
    viewportScale: number = 1.0
  ): MeasurementResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    if (points.length < 2) {
      errors.push('Linear measurement requires at least 2 points');
      return {
        calculatedValue: 0,
        unit: 'LF',
        confidence: 0,
        validation: {
          isValid: false,
          warnings,
          errors
        }
      };
    }
    
    // Calculate total distance
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const segmentDistance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += segmentDistance;
      
      // Validate segment length
      if (segmentDistance < 1) {
        warnings.push(`Very short segment detected (${segmentDistance.toFixed(2)}px)`);
      }
    }
    
    // Apply scale conversion
    const adjustedScaleFactor = scaleInfo.scaleFactor * viewportScale;
    const calculatedValue = totalDistance / adjustedScaleFactor;
    
    // Validation
    if (calculatedValue < 0.1) {
      warnings.push('Very small linear measurement detected');
    }
    if (calculatedValue > 10000) {
      warnings.push('Very large linear measurement detected - verify scale');
    }
    
    return {
      calculatedValue: Math.round(calculatedValue * 100) / 100, // Round to 2 decimal places
      unit: 'LF',
      confidence: this.calculateConfidence(points, scaleInfo),
      validation: {
        isValid: errors.length === 0,
        warnings,
        errors
      }
    };
  }
  
  /**
   * Calculate area measurement from points
   */
  static calculateArea(
    points: MeasurementPoint[],
    scaleInfo: ScaleInfo,
    viewportScale: number = 1.0
  ): MeasurementResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    if (points.length < 3) {
      errors.push('Area measurement requires at least 3 points');
      return {
        calculatedValue: 0,
        unit: 'SF',
        confidence: 0,
        validation: {
          isValid: false,
          warnings,
          errors
        }
      };
    }
    
    // Calculate area using shoelace formula
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    
    const absoluteArea = Math.abs(area) / 2;
    
    // Apply scale conversion
    const adjustedScaleFactor = scaleInfo.scaleFactor * viewportScale;
    const calculatedValue = absoluteArea / (adjustedScaleFactor * adjustedScaleFactor);
    
    // Calculate perimeter
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    const perimeterValue = perimeter / adjustedScaleFactor;
    
    // Validation
    if (calculatedValue < 1) {
      warnings.push('Very small area measurement detected');
    }
    if (calculatedValue > 100000) {
      warnings.push('Very large area measurement detected - verify scale');
    }
    
    // Check for self-intersecting polygon
    if (this.hasSelfIntersection(points)) {
      warnings.push('Polygon may have self-intersections');
    }
    
    return {
      calculatedValue: Math.round(calculatedValue * 100) / 100,
      unit: 'SF',
      perimeterValue: Math.round(perimeterValue * 100) / 100,
      confidence: this.calculateConfidence(points, scaleInfo),
      validation: {
        isValid: errors.length === 0,
        warnings,
        errors
      }
    };
  }
  
  /**
   * Calculate volume measurement from points and depth
   */
  static calculateVolume(
    points: MeasurementPoint[],
    scaleInfo: ScaleInfo,
    depth: number,
    viewportScale: number = 1.0
  ): MeasurementResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    
    if (points.length < 3) {
      errors.push('Volume measurement requires at least 3 points');
      return {
        calculatedValue: 0,
        unit: 'CF',
        confidence: 0,
        validation: {
          isValid: false,
          warnings,
          errors
        }
      };
    }
    
    if (depth <= 0) {
      errors.push('Volume measurement requires positive depth');
      return {
        calculatedValue: 0,
        unit: 'CF',
        confidence: 0,
        validation: {
          isValid: false,
          warnings,
          errors
        }
      };
    }
    
    // Calculate base area
    const areaResult = this.calculateArea(points, scaleInfo, viewportScale);
    if (!areaResult.validation.isValid) {
      return {
        calculatedValue: 0,
        unit: 'CF',
        confidence: 0,
        validation: {
          isValid: false,
          warnings: [...warnings, ...areaResult.validation.warnings],
          errors: [...errors, ...areaResult.validation.errors]
        }
      };
    }
    
    const calculatedValue = areaResult.calculatedValue * depth;
    
    // Validation
    if (calculatedValue < 1) {
      warnings.push('Very small volume measurement detected');
    }
    if (calculatedValue > 1000000) {
      warnings.push('Very large volume measurement detected - verify scale and depth');
    }
    
    return {
      calculatedValue: Math.round(calculatedValue * 100) / 100,
      unit: 'CF',
      perimeterValue: areaResult.perimeterValue,
      confidence: Math.min(areaResult.confidence, 0.9), // Slightly lower confidence due to depth estimation
      validation: {
        isValid: errors.length === 0,
        warnings: [...warnings, ...areaResult.validation.warnings],
        errors
      }
    };
  }
  
  /**
   * Calculate count measurement (always 1)
   */
  static calculateCount(): MeasurementResult {
    return {
      calculatedValue: 1,
      unit: 'EA',
      confidence: 1.0,
      validation: {
        isValid: true,
        warnings: [],
        errors: []
      }
    };
  }
  
  /**
   * Calculate confidence score based on measurement quality
   */
  private static calculateConfidence(
    points: MeasurementPoint[],
    scaleInfo: ScaleInfo
  ): number {
    let confidence = 1.0;
    
    // Reduce confidence for very few points
    if (points.length < 3) {
      confidence *= 0.8;
    }
    
    // Reduce confidence for low scale confidence
    confidence *= scaleInfo.confidence;
    
    // Reduce confidence for very small measurements
    const totalDistance = this.calculateTotalDistance(points);
    if (totalDistance < 10) {
      confidence *= 0.7;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }
  
  /**
   * Calculate total distance of all segments
   */
  private static calculateTotalDistance(points: MeasurementPoint[]): number {
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    return totalDistance;
  }
  
  /**
   * Check if polygon has self-intersections
   */
  private static hasSelfIntersection(points: MeasurementPoint[]): boolean {
    // Simple check for obvious self-intersections
    // This is a basic implementation - could be enhanced with more sophisticated algorithms
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 2; j < points.length; j++) {
        if (this.linesIntersect(
          points[i], points[(i + 1) % points.length],
          points[j], points[(j + 1) % points.length]
        )) {
          return true;
        }
      }
    }
    return false;
  }
  
  /**
   * Check if two line segments intersect
   */
  private static linesIntersect(
    p1: MeasurementPoint, p2: MeasurementPoint,
    p3: MeasurementPoint, p4: MeasurementPoint
  ): boolean {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(denom) < 1e-10) return false; // Lines are parallel
    
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }
  
  /**
   * Validate scale information
   */
  static validateScale(scaleInfo: ScaleInfo): {
    isValid: boolean;
    confidence: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let confidence = scaleInfo.confidence;
    
    // Check scale factor reasonableness
    if (scaleInfo.scaleFactor < 0.001) {
      warnings.push('Scale factor seems too small - verify scale detection');
      confidence *= 0.5;
    }
    
    if (scaleInfo.scaleFactor > 1) {
      warnings.push('Scale factor seems too large - verify scale detection');
      confidence *= 0.5;
    }
    
    // Check for common scale ratios
    const commonScales = [
      { ratio: 1/96, text: '1/8" = 1\'-0"', confidence: 1.0 },
      { ratio: 1/48, text: '1/4" = 1\'-0"', confidence: 1.0 },
      { ratio: 1/24, text: '1/2" = 1\'-0"', confidence: 1.0 },
      { ratio: 1/12, text: '1" = 1\'-0"', confidence: 1.0 }
    ];
    
    let bestMatch = null;
    for (const scale of commonScales) {
      if (Math.abs(scaleInfo.scaleFactor - scale.ratio) < 0.001) {
        bestMatch = scale;
        break;
      }
    }
    
    if (bestMatch) {
      confidence = Math.max(confidence, bestMatch.confidence);
    } else {
      warnings.push('Scale factor does not match common architectural scales');
      confidence *= 0.8;
    }
    
    return {
      isValid: confidence > 0.3,
      confidence,
      warnings
    };
  }
}
