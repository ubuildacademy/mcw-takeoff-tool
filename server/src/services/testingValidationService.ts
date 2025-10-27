/**
 * Testing and Validation Service
 * 
 * This service provides comprehensive testing and validation capabilities
 * for the enhanced AI takeoff system.
 */

import { hybridDetectionService } from './hybridDetectionService';
import { enhancedOcrService } from './enhancedOcrService';
import { ruleBasedValidationService } from './ruleBasedValidationService';
import { enhancedPlaywrightService } from './enhancedPlaywrightService';

export interface TestCase {
  id: string;
  name: string;
  description: string;
  category: 'unit' | 'integration' | 'e2e' | 'performance' | 'validation';
  priority: 'low' | 'medium' | 'high' | 'critical';
  input: {
    imageData: string;
    scope: string;
    options?: any;
  };
  expectedOutput: {
    minElements: number;
    maxElements: number;
    requiredElementTypes: string[];
    minConfidence: number;
    validationRules: string[];
  };
  timeout: number;
}

export interface TestResult {
  testCase: TestCase;
  passed: boolean;
  executionTime: number;
  actualOutput: any;
  errors: string[];
  warnings: string[];
  score: number; // 0-100
  timestamp: number;
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  testCases: TestCase[];
  executionTime: number;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    averageScore: number;
  };
}

export interface PerformanceMetrics {
  hybridDetection: {
    averageTime: number;
    minTime: number;
    maxTime: number;
    successRate: number;
  };
  ocrAnalysis: {
    averageTime: number;
    minTime: number;
    maxTime: number;
    successRate: number;
  };
  validation: {
    averageTime: number;
    minTime: number;
    maxTime: number;
    successRate: number;
  };
  overall: {
    averageTime: number;
    minTime: number;
    maxTime: number;
    successRate: number;
  };
}

class TestingValidationService {
  private testSuites: Map<string, TestSuite> = new Map();
  private performanceMetrics: PerformanceMetrics | null = null;

  /**
   * Create a test suite
   */
  createTestSuite(id: string, name: string, description: string): TestSuite {
    const testSuite: TestSuite = {
      id,
      name,
      description,
      testCases: [],
      executionTime: 0,
      results: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        averageScore: 0
      }
    };

    this.testSuites.set(id, testSuite);
    console.log(`📋 Created test suite: ${name}`);
    
    return testSuite;
  }

  /**
   * Add a test case to a test suite
   */
  addTestCase(suiteId: string, testCase: TestCase): void {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite ${suiteId} not found`);
    }

    suite.testCases.push(testCase);
    console.log(`➕ Added test case: ${testCase.name} to suite: ${suite.name}`);
  }

  /**
   * Execute a test suite
   */
  async executeTestSuite(suiteId: string): Promise<TestSuite> {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite ${suiteId} not found`);
    }

    console.log(`🚀 Executing test suite: ${suite.name}`);
    console.log(`📊 Test cases: ${suite.testCases.length}`);

    const startTime = Date.now();
    const results: TestResult[] = [];

    for (const testCase of suite.testCases) {
      console.log(`🧪 Running test case: ${testCase.name}`);
      
      try {
        const result = await this.executeTestCase(testCase);
        results.push(result);
        
        if (result.passed) {
          console.log(`✅ Test passed: ${testCase.name} (Score: ${result.score}/100)`);
        } else {
          console.log(`❌ Test failed: ${testCase.name} (Score: ${result.score}/100)`);
        }
      } catch (error) {
        console.error(`💥 Test error: ${testCase.name}`, error);
        
        const errorResult: TestResult = {
          testCase,
          passed: false,
          executionTime: 0,
          actualOutput: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          warnings: [],
          score: 0,
          timestamp: Date.now()
        };
        
        results.push(errorResult);
      }
    }

    const executionTime = Date.now() - startTime;
    suite.executionTime = executionTime;
    suite.results = results;
    suite.summary = this.calculateSuiteSummary(results);

    console.log(`🏁 Test suite completed: ${suite.name}`);
    console.log(`📊 Results: ${suite.summary.passed}/${suite.summary.total} passed (${Math.round(suite.summary.averageScore)}% avg score)`);

    return suite;
  }

  /**
   * Execute a single test case
   */
  private async executeTestCase(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Execute hybrid detection
      const hybridResult = await hybridDetectionService.detectElements(
        testCase.input.imageData,
        testCase.input.scope,
        testCase.input.options
      );

      // Execute OCR analysis
      const ocrResult = await enhancedOcrService.analyzeImage(testCase.input.imageData);

      // Execute validation
      const validationResult = await ruleBasedValidationService.validateTakeoffResults(
        hybridResult.elements,
        hybridResult.scaleInfo,
        hybridResult.ocrData
      );

      // Validate results against expected output
      const validationErrors = this.validateTestOutput(hybridResult, testCase.expectedOutput);
      errors.push(...validationErrors);

      // Calculate score
      const score = this.calculateTestScore(hybridResult, testCase.expectedOutput, errors);

      const executionTime = Date.now() - startTime;

      return {
        testCase,
        passed: errors.length === 0 && score >= 70,
        executionTime,
        actualOutput: {
          hybridResult,
          ocrResult,
          validationResult
        },
        errors,
        warnings,
        score,
        timestamp: Date.now()
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      errors.push(error instanceof Error ? error.message : 'Unknown error');

      return {
        testCase,
        passed: false,
        executionTime,
        actualOutput: null,
        errors,
        warnings,
        score: 0,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Validate test output against expected results
   */
  private validateTestOutput(actualOutput: any, expectedOutput: any): string[] {
    const errors: string[] = [];

    // Check element count
    const elementCount = actualOutput.elements?.length || 0;
    if (elementCount < expectedOutput.minElements) {
      errors.push(`Too few elements: expected at least ${expectedOutput.minElements}, got ${elementCount}`);
    }
    if (elementCount > expectedOutput.maxElements) {
      errors.push(`Too many elements: expected at most ${expectedOutput.maxElements}, got ${elementCount}`);
    }

    // Check element types
    const actualTypes = actualOutput.elements?.map((e: any) => e.type) || [];
    for (const requiredType of expectedOutput.requiredElementTypes) {
      if (!actualTypes.includes(requiredType)) {
        errors.push(`Missing required element type: ${requiredType}`);
      }
    }

    // Check confidence
    const avgConfidence = actualOutput.statistics?.averageConfidence || 0;
    if (avgConfidence < expectedOutput.minConfidence) {
      errors.push(`Confidence too low: expected at least ${expectedOutput.minConfidence}, got ${avgConfidence}`);
    }

    // Check validation rules
    const validationErrors = actualOutput.validation?.errors || [];
    for (const rule of expectedOutput.validationRules) {
      const hasRuleError = validationErrors.some((error: any) => error.ruleId === rule);
      if (hasRuleError) {
        errors.push(`Validation rule failed: ${rule}`);
      }
    }

    return errors;
  }

  /**
   * Calculate test score (0-100)
   */
  private calculateTestScore(actualOutput: any, expectedOutput: any, errors: string[]): number {
    let score = 100;

    // Deduct points for errors
    score -= errors.length * 10;

    // Deduct points for missing elements
    const elementCount = actualOutput.elements?.length || 0;
    const expectedCount = (expectedOutput.minElements + expectedOutput.maxElements) / 2;
    const elementScore = Math.max(0, 100 - Math.abs(elementCount - expectedCount) * 5);
    score = Math.min(score, elementScore);

    // Deduct points for low confidence
    const avgConfidence = actualOutput.statistics?.averageConfidence || 0;
    const confidenceScore = Math.max(0, avgConfidence * 100);
    score = Math.min(score, confidenceScore);

    // Deduct points for validation errors
    const validationErrors = actualOutput.validation?.errors || [];
    score -= validationErrors.length * 15;

    return Math.max(0, Math.round(score));
  }

  /**
   * Calculate test suite summary
   */
  private calculateSuiteSummary(results: TestResult[]): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    averageScore: number;
  } {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const skipped = 0; // No skipped tests in current implementation
    const averageScore = results.length > 0 
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length 
      : 0;

    return {
      total,
      passed,
      failed,
      skipped,
      averageScore: Math.round(averageScore)
    };
  }

  /**
   * Create default test cases
   */
  createDefaultTestCases(): TestCase[] {
    return [
      {
        id: 'door-detection',
        name: 'Door Detection Test',
        description: 'Test detection of doors in architectural drawings',
        category: 'integration',
        priority: 'high',
        input: {
          imageData: 'base64-encoded-test-image',
          scope: 'door',
          options: { yoloConfidenceThreshold: 0.5, qwenConfidenceThreshold: 0.7 }
        },
        expectedOutput: {
          minElements: 1,
          maxElements: 10,
          requiredElementTypes: ['door'],
          minConfidence: 0.7,
          validationRules: ['element_confidence_threshold', 'measurement_positive']
        },
        timeout: 30000
      },
      {
        id: 'window-detection',
        name: 'Window Detection Test',
        description: 'Test detection of windows in architectural drawings',
        category: 'integration',
        priority: 'high',
        input: {
          imageData: 'base64-encoded-test-image',
          scope: 'window',
          options: { yoloConfidenceThreshold: 0.5, qwenConfidenceThreshold: 0.7 }
        },
        expectedOutput: {
          minElements: 1,
          maxElements: 15,
          requiredElementTypes: ['window'],
          minConfidence: 0.7,
          validationRules: ['element_confidence_threshold', 'measurement_positive']
        },
        timeout: 30000
      },
      {
        id: 'room-area-calculation',
        name: 'Room Area Calculation Test',
        description: 'Test calculation of room areas',
        category: 'integration',
        priority: 'high',
        input: {
          imageData: 'base64-encoded-test-image',
          scope: 'room',
          options: { yoloConfidenceThreshold: 0.5, qwenConfidenceThreshold: 0.7 }
        },
        expectedOutput: {
          minElements: 1,
          maxElements: 20,
          requiredElementTypes: ['room'],
          minConfidence: 0.6,
          validationRules: ['measurement_positive', 'measurement_realistic', 'room_minimum_size']
        },
        timeout: 30000
      },
      {
        id: 'scale-detection',
        name: 'Scale Detection Test',
        description: 'Test detection and validation of drawing scale',
        category: 'validation',
        priority: 'critical',
        input: {
          imageData: 'base64-encoded-test-image',
          scope: 'floor',
          options: { yoloConfidenceThreshold: 0.5, qwenConfidenceThreshold: 0.7 }
        },
        expectedOutput: {
          minElements: 1,
          maxElements: 50,
          requiredElementTypes: ['room', 'wall'],
          minConfidence: 0.5,
          validationRules: ['scale_realistic', 'scale_consistency']
        },
        timeout: 30000
      },
      {
        id: 'performance-test',
        name: 'Performance Test',
        description: 'Test system performance under load',
        category: 'performance',
        priority: 'medium',
        input: {
          imageData: 'base64-encoded-test-image',
          scope: 'floor',
          options: { yoloConfidenceThreshold: 0.5, qwenConfidenceThreshold: 0.7 }
        },
        expectedOutput: {
          minElements: 1,
          maxElements: 100,
          requiredElementTypes: ['room', 'wall', 'door', 'window'],
          minConfidence: 0.5,
          validationRules: []
        },
        timeout: 60000
      }
    ];
  }

  /**
   * Run performance tests
   */
  async runPerformanceTests(): Promise<PerformanceMetrics> {
    console.log('🚀 Running performance tests...');
    
    const testCases = this.createDefaultTestCases();
    const results: any[] = [];
    
    for (const testCase of testCases) {
      try {
        const startTime = Date.now();
        await hybridDetectionService.detectElements(
          testCase.input.imageData,
          testCase.input.scope,
          testCase.input.options
        );
        const executionTime = Date.now() - startTime;
        
        results.push({
          testCase: testCase.id,
          executionTime,
          success: true
        });
      } catch (error) {
        results.push({
          testCase: testCase.id,
          executionTime: 0,
          success: false
        });
      }
    }

    // Calculate performance metrics
    const successfulResults = results.filter(r => r.success);
    const executionTimes = successfulResults.map(r => r.executionTime);
    
    this.performanceMetrics = {
      hybridDetection: {
        averageTime: executionTimes.length > 0 ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length : 0,
        minTime: executionTimes.length > 0 ? Math.min(...executionTimes) : 0,
        maxTime: executionTimes.length > 0 ? Math.max(...executionTimes) : 0,
        successRate: successfulResults.length / results.length
      },
      ocrAnalysis: {
        averageTime: 0, // Would be calculated from OCR results
        minTime: 0,
        maxTime: 0,
        successRate: 0
      },
      validation: {
        averageTime: 0, // Would be calculated from validation results
        minTime: 0,
        maxTime: 0,
        successRate: 0
      },
      overall: {
        averageTime: executionTimes.length > 0 ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length : 0,
        minTime: executionTimes.length > 0 ? Math.min(...executionTimes) : 0,
        maxTime: executionTimes.length > 0 ? Math.max(...executionTimes) : 0,
        successRate: successfulResults.length / results.length
      }
    };

    console.log('✅ Performance tests completed');
    return this.performanceMetrics;
  }

  /**
   * Get test suite by ID
   */
  getTestSuite(suiteId: string): TestSuite | null {
    return this.testSuites.get(suiteId) || null;
  }

  /**
   * List all test suites
   */
  listTestSuites(): TestSuite[] {
    return Array.from(this.testSuites.values());
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics | null {
    return this.performanceMetrics;
  }

  /**
   * Generate test report
   */
  generateTestReport(suiteId: string): string {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      return `Test suite ${suiteId} not found`;
    }

    const { summary, results } = suite;
    
    let report = `# Test Report: ${suite.name}\n\n`;
    report += `**Description:** ${suite.description}\n\n`;
    report += `**Execution Time:** ${suite.executionTime}ms\n\n`;
    report += `## Summary\n\n`;
    report += `- **Total Tests:** ${summary.total}\n`;
    report += `- **Passed:** ${summary.passed}\n`;
    report += `- **Failed:** ${summary.failed}\n`;
    report += `- **Skipped:** ${summary.skipped}\n`;
    report += `- **Average Score:** ${summary.averageScore}%\n\n`;
    
    report += `## Test Results\n\n`;
    
    for (const result of results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      report += `### ${result.testCase.name} ${status}\n\n`;
      report += `- **Score:** ${result.score}/100\n`;
      report += `- **Execution Time:** ${result.executionTime}ms\n`;
      
      if (result.errors.length > 0) {
        report += `- **Errors:**\n`;
        for (const error of result.errors) {
          report += `  - ${error}\n`;
        }
      }
      
      if (result.warnings.length > 0) {
        report += `- **Warnings:**\n`;
        for (const warning of result.warnings) {
          report += `  - ${warning}\n`;
        }
      }
      
      report += `\n`;
    }
    
    return report;
  }

  /**
   * Check if service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const hybridAvailable = await hybridDetectionService.isAvailable();
      const ocrAvailable = await enhancedOcrService.isAvailable();
      const validationAvailable = await ruleBasedValidationService.isAvailable();
      const playwrightAvailable = await enhancedPlaywrightService.isAvailable();
      
      return hybridAvailable && ocrAvailable && validationAvailable && playwrightAvailable;
    } catch (error) {
      console.warn('Testing service availability check failed:', error);
      return false;
    }
  }
}

export const testingValidationService = new TestingValidationService();
