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
  viewportWidth?: number; // Optional viewport width for normalized coordinate conversion
  viewportHeight?: number; // Optional viewport height for normalized coordinate conversion
}

export class MeasurementCalculator {
  /**
   * Calculate linear measurement from points
   */
  static calculateLinear(
    points: MeasurementPoint[],
    scaleInfo: ScaleInfo,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future viewport scaling
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
    
    // Calculate total distance (normalized coords) for legacy/confidence use
    let _totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      _totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    // Apply scale conversion
    // scaleInfo.scaleFactor is units per pixel, so we multiply by it to get units
    // Points are in normalized coordinates (0-1); convert each segment to pixels using width/height
    if (!scaleInfo.viewportWidth || !scaleInfo.viewportHeight) {
      errors.push('Viewport width and height are required for accurate measurement calculation');
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
    
    // Sum pixel distances per segment with proper aspect handling; warn only on genuinely tiny segments (e.g. duplicate points)
    const MIN_SEGMENT_PX = 2;
    let pixelDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const dxNorm = points[i].x - points[i - 1].x;
      const dyNorm = points[i].y - points[i - 1].y;
      const dxPx = dxNorm * scaleInfo.viewportWidth;
      const dyPx = dyNorm * scaleInfo.viewportHeight;
      const segmentPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
      pixelDistance += segmentPx;
      if (segmentPx > 0 && segmentPx < MIN_SEGMENT_PX) {
        warnings.push(`Very short segment detected (${segmentPx.toFixed(2)}px)`);
      }
    }
    const calculatedValue = pixelDistance * scaleInfo.scaleFactor;

    // Validation
    if (calculatedValue < 0.1) {
      warnings.push('Very small linear measurement detected');
    }
    if (calculatedValue > 10000) {
      warnings.push('Very large linear measurement detected - verify scale');
    }
    
    // Validate scale factor reasonableness
    if (scaleInfo.scaleFactor < 0.0001) {
      warnings.push('Scale factor is extremely small - verify calibration');
    }
    if (scaleInfo.scaleFactor > 1000) {
      warnings.push('Scale factor is very large - verify calibration');
    }
    
    // Check for reasonable measurement ranges
    if (calculatedValue > 0.1 && calculatedValue < 10000) {
      // If measurement is in reasonable range, check if scale factor makes sense
      const expectedScaleFactor = calculatedValue / pixelDistance;
      const scaleFactorRatio = Math.abs(expectedScaleFactor - scaleInfo.scaleFactor) / scaleInfo.scaleFactor;
      if (scaleFactorRatio > 0.1) {
        warnings.push('Scale factor may be inconsistent with measurement - verify calibration');
      }
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future viewport scaling
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
    
    // Validate viewport dimensions
    if (!scaleInfo.viewportWidth || !scaleInfo.viewportHeight) {
      errors.push('Viewport width and height are required for accurate area calculation');
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
    
    // Apply scale conversion
    // For area, convert normalized area to pixel area using width*height
    const pixelArea = absoluteArea * (scaleInfo.viewportWidth * scaleInfo.viewportHeight);
    const calculatedValue = pixelArea * (scaleInfo.scaleFactor * scaleInfo.scaleFactor);
    
    // Calculate perimeter
    let _perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      _perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    // Convert normalized perimeter to pixels using proper aspect handling
    let pixelPerimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dxPx = (points[j].x - points[i].x) * scaleInfo.viewportWidth;
      const dyPx = (points[j].y - points[i].y) * scaleInfo.viewportHeight;
      pixelPerimeter += Math.sqrt(dxPx * dxPx + dyPx * dyPx);
    }
    const perimeterValue = pixelPerimeter * scaleInfo.scaleFactor;
    
    // Validation
    if (calculatedValue < 1) {
      warnings.push('Very small area measurement detected');
    }
    if (calculatedValue > 100000) {
      warnings.push('Very large area measurement detected - verify scale');
    }
    
    // Validate scale factor reasonableness
    if (scaleInfo.scaleFactor < 0.0001) {
      warnings.push('Scale factor is extremely small - verify calibration');
    }
    if (scaleInfo.scaleFactor > 1000) {
      warnings.push('Scale factor is very large - verify calibration');
    }
    
    // Check for reasonable area ranges
    if (calculatedValue > 1 && calculatedValue < 100000) {
      // If area is in reasonable range, check if scale factor makes sense
      const expectedScaleFactor = Math.sqrt(calculatedValue / pixelArea);
      const scaleFactorRatio = Math.abs(expectedScaleFactor - scaleInfo.scaleFactor) / scaleInfo.scaleFactor;
      if (scaleFactorRatio > 0.1) {
        warnings.push('Scale factor may be inconsistent with area measurement - verify calibration');
      }
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
   * Check if polygon has self-intersections (excluding adjacent edges which only meet at a vertex).
   */
  private static hasSelfIntersection(points: MeasurementPoint[]): boolean {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        // Skip adjacent edges: edge i is (i, i+1), edge j is (j, j+1). They share a vertex when (i+1)%n === j or i === (j+1)%n.
        if ((i + 1) % n === j || i === (j + 1) % n) continue;
        if (this.linesIntersect(
          points[i], points[(i + 1) % n],
          points[j], points[(j + 1) % n]
        )) {
          return true;
        }
      }
    }
    return false;
  }
  
  /**
   * Check if two line segments intersect (strict interior crossing only).
   * Touching at a shared vertex (endpoint) does not count as self-intersection,
   * so simple rectangles and closed polygons do not false-positive.
   */
  private static linesIntersect(
    p1: MeasurementPoint, p2: MeasurementPoint,
    p3: MeasurementPoint, p4: MeasurementPoint
  ): boolean {
    const tol = 1e-10;
    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p4.x - p3.x;
    const dy2 = p4.y - p3.y;
    if (Math.abs(dx1) < tol && Math.abs(dy1) < tol) return false; // degenerate segment p1-p2
    if (Math.abs(dx2) < tol && Math.abs(dy2) < tol) return false; // degenerate segment p3-p4

    const denom = dy2 * dx1 - dx2 * dy1;
    if (Math.abs(denom) < 1e-10) return false; // Lines are parallel

    const ua = (dx2 * (p1.y - p3.y) - dy2 * (p1.x - p3.x)) / denom;
    const ub = (dx1 * (p1.y - p3.y) - dy1 * (p1.x - p3.x)) / denom;

    // Only count strict interior crossing; shared vertices (ua/ub 0 or 1) are not self-intersection
    return ua > tol && ua < 1 - tol && ub > tol && ub < 1 - tol;
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
    
    // Check scale factor reasonableness for pixels per unit
    if (scaleInfo.scaleFactor < 0.01) {
      warnings.push('Scale factor seems too small - verify calibration');
      confidence *= 0.5;
    }
    
    if (scaleInfo.scaleFactor > 1000) {
      warnings.push('Scale factor seems too large - verify calibration');
      confidence *= 0.5;
    }
    
    // For manual calibration, we trust the user's input
    // Only validate basic reasonableness
    if (scaleInfo.scaleText === 'calibrated') {
      confidence = Math.max(confidence, 0.9); // High confidence for manual calibration
    }
    
    return {
      isValid: confidence > 0.3,
      confidence,
      warnings
    };
  }
}
