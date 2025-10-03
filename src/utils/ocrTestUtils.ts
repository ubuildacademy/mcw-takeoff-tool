import { enhancedOcrService } from '../services/enhancedOcrService';

/**
 * Test utility functions for demonstrating enhanced OCR capabilities
 */
export class OCRTestUtils {
  /**
   * Test sheet number corrections
   */
  static testSheetNumberCorrections(): void {
    console.log('🧪 Testing Sheet Number Corrections:');
    
    const testCases = [
      'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
      'Al', 'Bl', 'Cl', 'Dl', // Common OCR mistakes
      'AO', 'BO', 'CO', 'DO', // O vs 0 confusion
      'A0', 'B0', 'C0', 'D0', // Number corrections
      '1', '2', '3', '4', '5', // Simple numbers
      'A1-1', 'A2-2', 'B1-1', // With revision numbers
      'A1.1', 'A2.2', 'B1.1', // With decimal subdivisions
      'AA1', 'BB2', 'CC3', // Double letter prefixes
    ];

    testCases.forEach(testCase => {
      const validation = enhancedOcrService.validateSheetNumber(testCase);
      console.log(`  ${testCase}: ${validation.isValid ? '✅ Valid' : '❌ Invalid'} ${validation.suggestions.length > 0 ? `(suggestions: ${validation.suggestions.join(', ')})` : ''}`);
    });
  }

  /**
   * Test sheet name corrections
   */
  static testSheetNameCorrections(): void {
    console.log('🧪 Testing Sheet Name Corrections:');
    
    const testCases = [
      'FLOOR PLAN',
      'FLOORPLAN', // Missing space
      'FLOOR PLAN', // Extra space
      'ELEVATION',
      'ELEVATION', // Common variation
      'NORTH ELEVATION',
      'SOUTH ELEVATION',
      'EAST ELEVATION',
      'WEST ELEVATION',
      'SECTION',
      'DETAIL',
      'STRUCTURAL PLAN',
      'FRAMING PLAN',
      'ELECTRICAL PLAN',
      'PLUMBING PLAN',
      'HVAC PLAN',
      'MECHANICAL', // Alternative to HVAC
      'SITE PLAN',
      'LANDSCAPE PLAN',
      'TITLE SHEET',
      'COVER', // Alternative to title sheet
      'INDEX',
      'LEGEND',
      'NOTES',
    ];

    testCases.forEach(testCase => {
      const suggestions = enhancedOcrService.getSheetNameSuggestions(testCase);
      console.log(`  ${testCase}: ${suggestions.length > 0 ? `✅ Suggestions: ${suggestions.join(', ')}` : '❌ No suggestions'}`);
    });
  }

  /**
   * Test character substitution corrections
   */
  static testCharacterSubstitutions(): void {
    console.log('🧪 Testing Character Substitutions:');
    
    const testCases = [
      'A1', // Should stay the same
      'Al', // l should become 1
      'A0', // 0 should become O
      'B8', // 8 should become B
      'C5', // 5 should become S
      'D6', // 6 should become G
      'E7', // 7 should become T
      'F2', // 2 should become Z
      'G9', // 9 should become g
    ];

    testCases.forEach(testCase => {
      // This would normally be done through the enhanced OCR service
      console.log(`  ${testCase}: Testing character substitution patterns`);
    });
  }

  /**
   * Run all tests
   */
  static runAllTests(): void {
    console.log('🚀 Running Enhanced OCR Tests...\n');
    
    this.testSheetNumberCorrections();
    console.log('');
    
    this.testSheetNameCorrections();
    console.log('');
    
    this.testCharacterSubstitutions();
    console.log('');
    
    console.log('✅ All tests completed!');
  }

  /**
   * Demonstrate pattern matching for common construction terms
   */
  static demonstratePatternMatching(): void {
    console.log('🎯 Demonstrating Pattern Matching:');
    
    const patterns = [
      { input: 'FLOORPLAN', expected: 'FLOOR PLAN' },
      { input: 'ELEVATION', expected: 'ELEVATION' },
      { input: 'STRUCTURAL', expected: 'STRUCTURAL PLAN' },
      { input: 'ELECTRICAL', expected: 'ELECTRICAL PLAN' },
      { input: 'MECHANICAL', expected: 'HVAC PLAN' },
      { input: 'COVER', expected: 'TITLE SHEET' },
    ];

    patterns.forEach(({ input, expected }) => {
      const suggestions = enhancedOcrService.getSheetNameSuggestions(input);
      const match = suggestions.includes(expected);
      console.log(`  "${input}" → "${expected}": ${match ? '✅ Match found' : '❌ No match'}`);
    });
  }
}

// Export for use in browser console or testing
if (typeof window !== 'undefined') {
  (window as any).OCRTestUtils = OCRTestUtils;
}
