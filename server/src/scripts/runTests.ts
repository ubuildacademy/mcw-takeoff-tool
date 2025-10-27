#!/usr/bin/env ts-node

/**
 * Comprehensive Test Runner
 * 
 * This script runs all tests for the enhanced AI takeoff system
 */

import { testingValidationService } from '../services/testingValidationService';
import { hybridDetectionService } from '../services/hybridDetectionService';
import { enhancedOcrService } from '../services/enhancedOcrService';
import { ruleBasedValidationService } from '../services/ruleBasedValidationService';
import { enhancedPlaywrightService } from '../services/enhancedPlaywrightService';

interface TestConfig {
  runUnitTests: boolean;
  runIntegrationTests: boolean;
  runPerformanceTests: boolean;
  runPlaywrightTests: boolean;
  generateReport: boolean;
  verbose: boolean;
}

class TestRunner {
  private config: TestConfig;

  constructor(config: TestConfig) {
    this.config = config;
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Comprehensive Test Suite');
    console.log('=====================================\n');

    const startTime = Date.now();

    try {
      // Check service availability
      await this.checkServiceAvailability();

      // Run unit tests
      if (this.config.runUnitTests) {
        await this.runUnitTests();
      }

      // Run integration tests
      if (this.config.runIntegrationTests) {
        await this.runIntegrationTests();
      }

      // Run performance tests
      if (this.config.runPerformanceTests) {
        await this.runPerformanceTests();
      }

      // Run Playwright tests
      if (this.config.runPlaywrightTests) {
        await this.runPlaywrightTests();
      }

      const totalTime = Date.now() - startTime;
      console.log(`\n🏁 All tests completed in ${totalTime}ms`);

    } catch (error) {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    }
  }

  /**
   * Check service availability
   */
  private async checkServiceAvailability(): Promise<void> {
    console.log('🔍 Checking service availability...\n');

    const services = [
      { name: 'Hybrid Detection', service: hybridDetectionService },
      { name: 'Enhanced OCR', service: enhancedOcrService },
      { name: 'Rule Validation', service: ruleBasedValidationService },
      { name: 'Enhanced Playwright', service: enhancedPlaywrightService },
      { name: 'Testing Service', service: testingValidationService }
    ];

    for (const { name, service } of services) {
      try {
        const isAvailable = await service.isAvailable();
        const status = isAvailable ? '✅ Available' : '❌ Unavailable';
        console.log(`${name}: ${status}`);
      } catch (error) {
        console.log(`${name}: ❌ Error - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('');
  }

  /**
   * Run unit tests
   */
  private async runUnitTests(): Promise<void> {
    console.log('🧪 Running Unit Tests');
    console.log('--------------------\n');

    // Create unit test suite
    const suite = testingValidationService.createTestSuite(
      'unit-tests',
      'Unit Tests',
      'Basic functionality tests for individual components'
    );

    // Add unit test cases
    const unitTestCases = [
      {
        id: 'ocr-text-parsing',
        name: 'OCR Text Parsing Test',
        description: 'Test parsing of OCR text into structured elements',
        category: 'unit' as const,
        priority: 'high' as const,
        input: {
          imageData: 'base64-test-image',
          scope: 'test',
          options: {}
        },
        expectedOutput: {
          minElements: 0,
          maxElements: 100,
          requiredElementTypes: [],
          minConfidence: 0.0,
          validationRules: []
        },
        timeout: 10000
      },
      {
        id: 'validation-rules',
        name: 'Validation Rules Test',
        description: 'Test individual validation rules',
        category: 'unit' as const,
        priority: 'high' as const,
        input: {
          imageData: 'base64-test-image',
          scope: 'test',
          options: {}
        },
        expectedOutput: {
          minElements: 0,
          maxElements: 100,
          requiredElementTypes: [],
          minConfidence: 0.0,
          validationRules: []
        },
        timeout: 10000
      }
    ];

    for (const testCase of unitTestCases) {
      testingValidationService.addTestCase('unit-tests', testCase);
    }

    // Execute unit tests
    const results = await testingValidationService.executeTestSuite('unit-tests');
    this.printTestResults(results);
  }

  /**
   * Run integration tests
   */
  private async runIntegrationTests(): Promise<void> {
    console.log('🔗 Running Integration Tests');
    console.log('----------------------------\n');

    // Create integration test suite
    const suite = testingValidationService.createTestSuite(
      'integration-tests',
      'Integration Tests',
      'End-to-end integration tests for the hybrid detection pipeline'
    );

    // Add integration test cases
    const integrationTestCases = testingValidationService.createDefaultTestCases();
    
    for (const testCase of integrationTestCases) {
      testingValidationService.addTestCase('integration-tests', testCase);
    }

    // Execute integration tests
    const results = await testingValidationService.executeTestSuite('integration-tests');
    this.printTestResults(results);
  }

  /**
   * Run performance tests
   */
  private async runPerformanceTests(): Promise<void> {
    console.log('⚡ Running Performance Tests');
    console.log('----------------------------\n');

    const metrics = await testingValidationService.runPerformanceTests();
    
    console.log('Performance Metrics:');
    console.log(`Hybrid Detection: ${metrics.hybridDetection.averageTime}ms avg (${Math.round(metrics.hybridDetection.successRate * 100)}% success)`);
    console.log(`OCR Analysis: ${metrics.ocrAnalysis.averageTime}ms avg (${Math.round(metrics.ocrAnalysis.successRate * 100)}% success)`);
    console.log(`Validation: ${metrics.validation.averageTime}ms avg (${Math.round(metrics.validation.successRate * 100)}% success)`);
    console.log(`Overall: ${metrics.overall.averageTime}ms avg (${Math.round(metrics.overall.successRate * 100)}% success)`);
    console.log('');
  }

  /**
   * Run Playwright tests
   */
  private async runPlaywrightTests(): Promise<void> {
    console.log('🎭 Running Playwright Tests');
    console.log('---------------------------\n');

    try {
      // Create Playwright session
      const sessionId = `test-session-${Date.now()}`;
      const session = await enhancedPlaywrightService.createSession(sessionId);
      
      console.log(`✅ Created Playwright session: ${sessionId}`);

      // Test basic Playwright functionality
      const testPlan = {
        steps: [
          {
            type: 'screenshot' as const,
            options: { fullPage: true }
          }
        ],
        validationRules: [],
        fallbackActions: [],
        expectedOutcome: 'Screenshot captured successfully'
      };

      const result = await enhancedPlaywrightService.executeTakeoffPlan(
        sessionId,
        testPlan,
        'base64-test-image',
        'test'
      );

      if (result.success) {
        console.log('✅ Playwright test passed');
      } else {
        console.log('❌ Playwright test failed:', result.error);
      }

      // Close session
      await enhancedPlaywrightService.closeSession(sessionId);
      console.log('✅ Playwright session closed');

    } catch (error) {
      console.error('❌ Playwright test failed:', error);
    }

    console.log('');
  }

  /**
   * Print test results
   */
  private printTestResults(results: any): void {
    const { summary, results: testResults } = results;
    
    console.log(`Results: ${summary.passed}/${summary.total} passed (${summary.averageScore}% avg score)`);
    
    if (this.config.verbose) {
      for (const result of testResults) {
        const status = result.passed ? '✅' : '❌';
        console.log(`  ${status} ${result.testCase.name} (${result.score}/100)`);
        
        if (result.errors.length > 0) {
          for (const error of result.errors) {
            console.log(`    Error: ${error}`);
          }
        }
      }
    }
    
    console.log('');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  const config: TestConfig = {
    runUnitTests: args.includes('--unit') || args.includes('--all'),
    runIntegrationTests: args.includes('--integration') || args.includes('--all'),
    runPerformanceTests: args.includes('--performance') || args.includes('--all'),
    runPlaywrightTests: args.includes('--playwright') || args.includes('--all'),
    generateReport: args.includes('--report'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  // If no specific tests specified, run all
  if (!args.includes('--unit') && !args.includes('--integration') && 
      !args.includes('--performance') && !args.includes('--playwright')) {
    config.runUnitTests = true;
    config.runIntegrationTests = true;
    config.runPerformanceTests = true;
    config.runPlaywrightTests = true;
  }

  const testRunner = new TestRunner(config);
  await testRunner.runAllTests();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { TestRunner };
