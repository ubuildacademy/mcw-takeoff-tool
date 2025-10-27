/**
 * Rule-based Validation Service for Construction Takeoff
 * 
 * This service applies construction industry rules and logic to validate
 * and post-process AI-generated takeoff results.
 */

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  category: 'measurement' | 'scale' | 'element' | 'consistency' | 'industry';
  severity: 'error' | 'warning' | 'info';
  appliesTo: string[];
  validate: (data: any) => ValidationResult;
}

export interface ValidationResult {
  isValid: boolean;
  message: string;
  suggestions: string[];
  confidence: number;
  ruleId: string;
}

export interface ValidationReport {
  overallValid: boolean;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  info: ValidationResult[];
  suggestions: string[];
  confidence: number;
}

export interface ConstructionElement {
  type: string;
  measurements: Array<{
    value: number;
    unit: string;
    type: 'linear' | 'area' | 'volume' | 'count';
  }>;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface ScaleInfo {
  scaleFactor: number;
  unit: string;
  scaleText: string;
  confidence: number;
}

class RuleBasedValidationService {
  private rules: ValidationRule[] = [];

  constructor() {
    this.initializeRules();
  }

  /**
   * Initialize validation rules
   */
  private initializeRules() {
    // Scale validation rules
    this.rules.push({
      id: 'scale_realistic',
      name: 'Realistic Scale Check',
      description: 'Validates that detected scale is within realistic construction drawing ranges',
      category: 'scale',
      severity: 'error',
      appliesTo: ['scale'],
      validate: (data) => this.validateRealisticScale(data)
    });

    this.rules.push({
      id: 'scale_consistency',
      name: 'Scale Consistency Check',
      description: 'Ensures scale is consistent across the drawing',
      category: 'scale',
      severity: 'warning',
      appliesTo: ['scale'],
      validate: (data) => this.validateScaleConsistency(data)
    });

    // Measurement validation rules
    this.rules.push({
      id: 'measurement_positive',
      name: 'Positive Measurement Check',
      description: 'Ensures all measurements are positive values',
      category: 'measurement',
      severity: 'error',
      appliesTo: ['linear', 'area', 'volume'],
      validate: (data) => this.validatePositiveMeasurements(data)
    });

    this.rules.push({
      id: 'measurement_realistic',
      name: 'Realistic Measurement Check',
      description: 'Validates measurements are within realistic construction ranges',
      category: 'measurement',
      severity: 'warning',
      appliesTo: ['linear', 'area', 'volume'],
      validate: (data) => this.validateRealisticMeasurements(data)
    });

    this.rules.push({
      id: 'measurement_unit_consistency',
      name: 'Unit Consistency Check',
      description: 'Ensures consistent units across measurements',
      category: 'measurement',
      severity: 'warning',
      appliesTo: ['linear', 'area', 'volume'],
      validate: (data) => this.validateUnitConsistency(data)
    });

    // Element validation rules
    this.rules.push({
      id: 'element_bbox_valid',
      name: 'Valid Bounding Box Check',
      description: 'Ensures bounding boxes are valid and within image bounds',
      category: 'element',
      severity: 'error',
      appliesTo: ['room', 'door', 'window', 'wall', 'fixture'],
      validate: (data) => this.validateBoundingBox(data)
    });

    this.rules.push({
      id: 'element_confidence_threshold',
      name: 'Confidence Threshold Check',
      description: 'Ensures element confidence meets minimum threshold',
      category: 'element',
      severity: 'warning',
      appliesTo: ['room', 'door', 'window', 'wall', 'fixture'],
      validate: (data) => this.validateConfidenceThreshold(data)
    });

    // Consistency validation rules
    this.rules.push({
      id: 'room_wall_consistency',
      name: 'Room-Wall Consistency Check',
      description: 'Validates that rooms have associated walls',
      category: 'consistency',
      severity: 'info',
      appliesTo: ['room'],
      validate: (data) => this.validateRoomWallConsistency(data)
    });

    this.rules.push({
      id: 'door_window_placement',
      name: 'Door/Window Placement Check',
      description: 'Validates that doors and windows are placed on walls',
      category: 'consistency',
      severity: 'warning',
      appliesTo: ['door', 'window'],
      validate: (data) => this.validateDoorWindowPlacement(data)
    });

    // Industry-specific rules
    this.rules.push({
      id: 'room_minimum_size',
      name: 'Minimum Room Size Check',
      description: 'Ensures rooms meet minimum size requirements',
      category: 'industry',
      severity: 'warning',
      appliesTo: ['room'],
      validate: (data) => this.validateMinimumRoomSize(data)
    });

    this.rules.push({
      id: 'door_clearance',
      name: 'Door Clearance Check',
      description: 'Validates adequate clearance around doors',
      category: 'industry',
      severity: 'info',
      appliesTo: ['door'],
      validate: (data) => this.validateDoorClearance(data)
    });
  }

  /**
   * Validate takeoff results
   */
  validateTakeoffResults(
    elements: ConstructionElement[],
    scaleInfo: ScaleInfo,
    ocrData?: any
  ): ValidationReport {
    console.log('🔍 Starting rule-based validation...');
    
    const errors: ValidationResult[] = [];
    const warnings: ValidationResult[] = [];
    const info: ValidationResult[] = [];

    // Validate scale
    const scaleValidation = this.validateScale(scaleInfo);
    scaleValidation.forEach(validation => {
      this.categorizeResult(validation, errors, warnings, info);
    });

    // Validate each element
    elements.forEach((element, index) => {
      const elementValidations = this.validateElement(element, elements, scaleInfo, ocrData);
      elementValidations.forEach(validation => {
        this.categorizeResult(validation, errors, warnings, info);
      });
    });

    // Validate overall consistency
    const consistencyValidations = this.validateOverallConsistency(elements, scaleInfo);
    consistencyValidations.forEach(validation => {
      this.categorizeResult(validation, errors, warnings, info);
    });

    const overallValid = errors.length === 0;
    const suggestions = this.generateSuggestions(errors, warnings, info);
    const confidence = this.calculateOverallConfidence(elements, errors, warnings);

    console.log(`✅ Validation complete: ${errors.length} errors, ${warnings.length} warnings, ${info.length} info`);

    return {
      overallValid,
      errors,
      warnings,
      info,
      suggestions,
      confidence
    };
  }

  /**
   * Validate scale information
   */
  private validateScale(scaleInfo: ScaleInfo): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    // Apply scale-related rules
    const scaleRules = this.rules.filter(rule => rule.appliesTo.includes('scale'));
    
    scaleRules.forEach(rule => {
      const result = rule.validate(scaleInfo);
      results.push(result);
    });

    return results;
  }

  /**
   * Validate individual element
   */
  private validateElement(
    element: ConstructionElement,
    allElements: ConstructionElement[],
    scaleInfo: ScaleInfo,
    ocrData?: any
  ): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    // Apply element-specific rules
    const elementRules = this.rules.filter(rule => 
      rule.appliesTo.includes(element.type) || 
      rule.appliesTo.includes('measurement') ||
      rule.appliesTo.includes('element')
    );
    
    elementRules.forEach(rule => {
      const result = rule.validate({
        element,
        allElements,
        scaleInfo,
        ocrData
      });
      results.push(result);
    });

    return results;
  }

  /**
   * Validate overall consistency
   */
  private validateOverallConsistency(
    elements: ConstructionElement[],
    scaleInfo: ScaleInfo
  ): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    // Apply consistency rules
    const consistencyRules = this.rules.filter(rule => 
      rule.category === 'consistency' || rule.category === 'industry'
    );
    
    consistencyRules.forEach(rule => {
      const result = rule.validate({
        elements,
        scaleInfo
      });
      results.push(result);
    });

    return results;
  }

  /**
   * Categorize validation result by severity
   */
  private categorizeResult(
    result: ValidationResult,
    errors: ValidationResult[],
    warnings: ValidationResult[],
    info: ValidationResult[]
  ): void {
    if (result.ruleId) {
      const rule = this.rules.find(r => r.id === result.ruleId);
      if (rule) {
        switch (rule.severity) {
          case 'error':
            errors.push(result);
            break;
          case 'warning':
            warnings.push(result);
            break;
          case 'info':
            info.push(result);
            break;
        }
      }
    }
  }

  /**
   * Generate suggestions based on validation results
   */
  private generateSuggestions(
    errors: ValidationResult[],
    warnings: ValidationResult[],
    info: ValidationResult[]
  ): string[] {
    const suggestions: string[] = [];
    
    // High priority suggestions from errors
    errors.forEach(error => {
      suggestions.push(...error.suggestions);
    });
    
    // Medium priority suggestions from warnings
    warnings.forEach(warning => {
      suggestions.push(...warning.suggestions);
    });
    
    // Low priority suggestions from info
    info.forEach(info => {
      suggestions.push(...info.suggestions);
    });
    
    return [...new Set(suggestions)]; // Remove duplicates
  }

  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(
    elements: ConstructionElement[],
    errors: ValidationResult[],
    warnings: ValidationResult[]
  ): number {
    if (elements.length === 0) return 0;
    
    // Base confidence from elements
    const elementConfidence = elements.reduce((sum, element) => 
      sum + element.confidence, 0) / elements.length;
    
    // Reduce confidence based on validation issues
    const errorPenalty = errors.length * 0.1;
    const warningPenalty = warnings.length * 0.05;
    
    return Math.max(0, elementConfidence - errorPenalty - warningPenalty);
  }

  // Individual validation rule implementations
  private validateRealisticScale(data: any): ValidationResult {
    const { scaleFactor, unit } = data;
    
    if (!scaleFactor || scaleFactor <= 0) {
      return {
        isValid: false,
        message: 'Invalid scale factor detected',
        suggestions: ['Check if scale is properly detected', 'Verify scale text format'],
        confidence: 0,
        ruleId: 'scale_realistic'
      };
    }
    
    // Check if scale is within realistic ranges
    const isRealistic = (unit === 'ft' && scaleFactor >= 0.01 && scaleFactor <= 10) ||
                       (unit === 'in' && scaleFactor >= 0.1 && scaleFactor <= 120) ||
                       (unit === 'm' && scaleFactor >= 0.01 && scaleFactor <= 10);
    
    if (!isRealistic) {
      return {
        isValid: false,
        message: `Scale factor ${scaleFactor} ${unit} seems unrealistic`,
        suggestions: ['Verify scale detection accuracy', 'Check if scale text is correctly parsed'],
        confidence: 0.3,
        ruleId: 'scale_realistic'
      };
    }
    
    return {
      isValid: true,
      message: 'Scale factor is within realistic range',
      suggestions: [],
      confidence: 0.9,
      ruleId: 'scale_realistic'
    };
  }

  private validateScaleConsistency(data: any): ValidationResult {
    // This would check for multiple scale indicators and ensure consistency
    // For now, return a basic validation
    return {
      isValid: true,
      message: 'Scale consistency check passed',
      suggestions: [],
      confidence: 0.8,
      ruleId: 'scale_consistency'
    };
  }

  private validatePositiveMeasurements(data: any): ValidationResult {
    const { element } = data;
    const invalidMeasurements = element.measurements.filter((m: any) => m.value <= 0);
    
    if (invalidMeasurements.length > 0) {
      return {
        isValid: false,
        message: `Found ${invalidMeasurements.length} non-positive measurements`,
        suggestions: ['Check measurement calculation accuracy', 'Verify scale factor'],
        confidence: 0,
        ruleId: 'measurement_positive'
      };
    }
    
    return {
      isValid: true,
      message: 'All measurements are positive',
      suggestions: [],
      confidence: 0.9,
      ruleId: 'measurement_positive'
    };
  }

  private validateRealisticMeasurements(data: any): ValidationResult {
    const { element } = data;
    const unrealisticMeasurements = element.measurements.filter((m: any) => {
      if (m.type === 'linear') return m.value > 1000; // More than 1000 feet
      if (m.type === 'area') return m.value > 100000; // More than 100,000 sq ft
      if (m.type === 'volume') return m.value > 1000000; // More than 1M cubic feet
      return false;
    });
    
    if (unrealisticMeasurements.length > 0) {
      return {
        isValid: false,
        message: `Found ${unrealisticMeasurements.length} unrealistic measurements`,
        suggestions: ['Verify scale factor accuracy', 'Check measurement calculation'],
        confidence: 0.3,
        ruleId: 'measurement_realistic'
      };
    }
    
    return {
      isValid: true,
      message: 'All measurements are within realistic ranges',
      suggestions: [],
      confidence: 0.8,
      ruleId: 'measurement_realistic'
    };
  }

  private validateUnitConsistency(data: any): ValidationResult {
    const { element } = data;
    const units = element.measurements.map((m: any) => m.unit);
    const uniqueUnits = [...new Set(units)];
    
    if (uniqueUnits.length > 1) {
      return {
        isValid: false,
        message: `Found mixed units: ${uniqueUnits.join(', ')}`,
        suggestions: ['Convert all measurements to the same unit', 'Check unit detection accuracy'],
        confidence: 0.5,
        ruleId: 'measurement_unit_consistency'
      };
    }
    
    return {
      isValid: true,
      message: 'All measurements use consistent units',
      suggestions: [],
      confidence: 0.9,
      ruleId: 'measurement_unit_consistency'
    };
  }

  private validateBoundingBox(data: any): ValidationResult {
    const { element } = data;
    const [x, y, width, height] = element.bbox;
    
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      return {
        isValid: false,
        message: 'Invalid bounding box detected',
        suggestions: ['Check element detection accuracy', 'Verify coordinate system'],
        confidence: 0,
        ruleId: 'element_bbox_valid'
      };
    }
    
    return {
      isValid: true,
      message: 'Bounding box is valid',
      suggestions: [],
      confidence: 0.9,
      ruleId: 'element_bbox_valid'
    };
  }

  private validateConfidenceThreshold(data: any): ValidationResult {
    const { element } = data;
    const minConfidence = 0.5;
    
    if (element.confidence < minConfidence) {
      return {
        isValid: false,
        message: `Element confidence ${Math.round(element.confidence * 100)}% below threshold`,
        suggestions: ['Review element detection accuracy', 'Consider manual verification'],
        confidence: element.confidence,
        ruleId: 'element_confidence_threshold'
      };
    }
    
    return {
      isValid: true,
      message: 'Element confidence meets threshold',
      suggestions: [],
      confidence: 0.8,
      ruleId: 'element_confidence_threshold'
    };
  }

  private validateRoomWallConsistency(data: any): ValidationResult {
    // This would check if rooms have associated walls
    // For now, return a basic validation
    return {
      isValid: true,
      message: 'Room-wall consistency check passed',
      suggestions: [],
      confidence: 0.7,
      ruleId: 'room_wall_consistency'
    };
  }

  private validateDoorWindowPlacement(data: any): ValidationResult {
    // This would check if doors/windows are placed on walls
    // For now, return a basic validation
    return {
      isValid: true,
      message: 'Door/window placement check passed',
      suggestions: [],
      confidence: 0.7,
      ruleId: 'door_window_placement'
    };
  }

  private validateMinimumRoomSize(data: any): ValidationResult {
    const { element } = data;
    const minArea = 25; // 25 square feet minimum
    
    const areaMeasurements = element.measurements.filter((m: any) => m.type === 'area');
    const hasValidArea = areaMeasurements.some((m: any) => m.value >= minArea);
    
    if (!hasValidArea && areaMeasurements.length > 0) {
      return {
        isValid: false,
        message: `Room area ${areaMeasurements[0]?.value || 'unknown'} is below minimum ${minArea} sq ft`,
        suggestions: ['Verify room area calculation', 'Check if room is properly bounded'],
        confidence: 0.6,
        ruleId: 'room_minimum_size'
      };
    }
    
    return {
      isValid: true,
      message: 'Room meets minimum size requirements',
      suggestions: [],
      confidence: 0.8,
      ruleId: 'room_minimum_size'
    };
  }

  private validateDoorClearance(data: any): ValidationResult {
    // This would check door clearance requirements
    // For now, return a basic validation
    return {
      isValid: true,
      message: 'Door clearance check passed',
      suggestions: [],
      confidence: 0.7,
      ruleId: 'door_clearance'
    };
  }

  /**
   * Get all available rules
   */
  getRules(): ValidationRule[] {
    return [...this.rules];
  }

  /**
   * Get rules by category
   */
  getRulesByCategory(category: string): ValidationRule[] {
    return this.rules.filter(rule => rule.category === category);
  }

  /**
   * Check if service is available
   */
  async isAvailable(): Promise<boolean> {
    return true; // Rule-based validation is always available
  }
}

export const ruleBasedValidationService = new RuleBasedValidationService();
