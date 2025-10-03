# OCR Accuracy Improvements for Sheet Numbers and Names

This document describes the enhanced OCR system implemented to improve accuracy for extracting sheet numbers and names from architectural drawings.

## Overview

The enhanced OCR system addresses common OCR issues in construction documents by implementing:

1. **Pattern Recognition** - Recognizes common sheet number formats
2. **Fuzzy Matching** - Matches sheet names against known construction terms
3. **Character Substitution** - Corrects common OCR character mistakes
4. **Training Data Collection** - Learns from user corrections over time
5. **Confidence Scoring** - Provides reliability metrics for extracted data

## Components

### 1. Enhanced OCR Service (`src/services/enhancedOcrService.ts`)

The core service that processes OCR results and applies corrections:

- **Sheet Number Patterns**: Recognizes formats like A1, A2-1, B1.1, AA1, etc.
- **Sheet Name Corrections**: Maps common variations to standard construction terms
- **Character Substitutions**: Fixes common OCR errors (O↔0, l↔1, etc.)
- **Confidence Enhancement**: Boosts confidence scores based on successful pattern matches

### 2. OCR Training Service (`src/services/ocrTrainingService.ts`)

Collects and learns from user corrections:

- **Training Data Storage**: Saves original OCR text, corrections, and user validation
- **Pattern Learning**: Builds patterns from repeated corrections
- **Suggestion Engine**: Provides corrections based on historical data
- **Statistics Tracking**: Monitors accuracy improvements over time

### 3. OCR Training Dialog (`src/components/OCRTrainingDialog.tsx`)

User interface for managing training data:

- **Statistics Dashboard**: Shows accuracy metrics and training progress
- **Validation Interface**: Allows users to confirm or correct OCR results
- **Data Export**: Export training data for analysis
- **Pattern Review**: Review and edit correction patterns

## Sheet Number Patterns

The system recognizes these common sheet number formats:

| Pattern | Example | Description |
|---------|---------|-------------|
| `A1, A2, B1` | A1, A2, B1 | Standard architectural numbering |
| `A1-1, A2-3` | A1-1, A2-3 | With revision numbers |
| `1, 2, 3` | 1, 2, 3 | Simple numeric |
| `A1.1, A2.3` | A1.1, A2.3 | Decimal subdivisions |
| `AA1, BB2` | AA1, BB2 | Double letter prefixes |

## Sheet Name Categories

The system recognizes these construction document categories:

### Floor Plans
- FLOOR PLAN, FOUNDATION PLAN, ROOF PLAN

### Elevations
- ELEVATION, NORTH ELEVATION, SOUTH ELEVATION, EAST ELEVATION, WEST ELEVATION

### Sections & Details
- SECTION, DETAIL

### Structural
- STRUCTURAL PLAN, FRAMING PLAN

### MEP (Mechanical, Electrical, Plumbing)
- ELECTRICAL PLAN, PLUMBING PLAN, HVAC PLAN, MECHANICAL

### Site & Landscape
- SITE PLAN, LANDSCAPE PLAN

### General
- TITLE SHEET, INDEX, LEGEND, NOTES

## Character Substitutions

Common OCR character corrections:

| OCR Error | Correct | Context |
|-----------|---------|---------|
| O | 0 | In numbers |
| 0 | O | In letters |
| l | 1 | Lowercase L to 1 |
| I | 1 | Uppercase I to 1 |
| S | 5 | S to 5 |
| B | 8 | B to 8 |
| G | 6 | G to 6 |
| T | 7 | T to 7 |
| Z | 2 | Z to 2 |
| g | 9 | g to 9 |

## Usage

### Basic Usage

The enhanced OCR service is automatically used when extracting titleblock information:

```typescript
import { enhancedOcrService } from '../services/enhancedOcrService';

// Process canvas with enhanced OCR
const result = await enhancedOcrService.processWithEnhancement(canvas, pageNumber);

console.log('Original:', result.originalText);
console.log('Corrected:', result.correctedText);
console.log('Confidence:', result.confidence);
console.log('Corrections:', result.corrections);
```

### Training Data Collection

Training data is automatically collected during titleblock extraction:

```typescript
import { ocrTrainingService } from '../services/ocrTrainingService';

// Save training data
await ocrTrainingService.saveTrainingData({
  projectId: 'project-id',
  documentId: 'document-id',
  pageNumber: 1,
  fieldType: 'sheet_number',
  originalText: 'Al',
  correctedText: 'A1',
  confidence: 75,
  corrections: [{
    type: 'sheet_number',
    original: 'Al',
    corrected: 'A1',
    reason: 'Applied character substitution: l → 1'
  }],
  userValidated: false
});
```

### Accessing Training Data

Use the OCR Training Dialog to:

1. View accuracy statistics
2. Validate or correct OCR results
3. Export training data
4. Review correction patterns

## Database Schema

The training data is stored in the `ocr_training_data` table:

```sql
CREATE TABLE ocr_training_data (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    document_id UUID REFERENCES takeoff_files(id),
    page_number INTEGER,
    field_type TEXT CHECK (field_type IN ('sheet_number', 'sheet_name')),
    original_text TEXT,
    corrected_text TEXT,
    confidence DECIMAL(5,2),
    corrections JSONB,
    user_validated BOOLEAN,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## Testing

Use the test utilities to verify OCR improvements:

```typescript
import { OCRTestUtils } from '../utils/ocrTestUtils';

// Run all tests
OCRTestUtils.runAllTests();

// Test specific functionality
OCRTestUtils.testSheetNumberCorrections();
OCRTestUtils.testSheetNameCorrections();
OCRTestUtils.demonstratePatternMatching();
```

## Performance Considerations

- **Memory Usage**: Training data is limited to 1000 recent entries per project
- **Processing Speed**: Pattern matching adds minimal overhead (~1-2ms per extraction)
- **Storage**: Training data is stored in database with automatic cleanup
- **Caching**: Patterns are cached in memory for fast access

## Future Improvements

1. **Machine Learning Integration**: Use collected training data to train custom models
2. **Document-Specific Patterns**: Learn patterns specific to different drawing types
3. **Multi-Language Support**: Extend to support non-English construction terms
4. **Advanced Image Processing**: Implement more sophisticated image preprocessing
5. **Real-Time Learning**: Update patterns immediately based on user feedback

## Troubleshooting

### Common Issues

1. **Low Confidence Scores**: Check if field regions are properly positioned
2. **Missing Corrections**: Verify that training data is being collected
3. **Pattern Not Recognized**: Add new patterns to the correction dictionaries

### Debug Mode

Enable debug logging to see detailed OCR processing:

```typescript
// In browser console
localStorage.setItem('ocr-debug', 'true');
```

This will show:
- Original OCR text
- Applied corrections
- Pattern matches
- Confidence calculations

## Contributing

To add new patterns or corrections:

1. **Sheet Numbers**: Add patterns to `sheetNumberPatterns` array
2. **Sheet Names**: Add corrections to `sheetNameCorrections` array
3. **Character Substitutions**: Add mappings to `characterSubstitutions` Map
4. **Test**: Use `OCRTestUtils` to verify new patterns work correctly

## Support

For issues or questions about the OCR improvements:

1. Check the browser console for debug information
2. Review the OCR Training Dialog statistics
3. Export training data for analysis
4. Test with the provided utility functions
