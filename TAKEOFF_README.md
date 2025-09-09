# Takeoff Functionality Documentation

## Overview

The Meridian Takeoff application now includes comprehensive takeoff functionality that allows users to draw and measure conditions directly on PDF drawings. Takeoffs are "glued" to the PDF coordinates and persist across sessions.

## Key Features

### 1. **PDF-Relative Positioning**
- Takeoffs are stored with PDF-relative coordinates (0-1 scale)
- Measurements stay in place when zooming, panning, or rotating the PDF
- Coordinates are preserved when switching between pages

### 2. **Sheet-Specific Tracking**
- Each takeoff is associated with a specific sheet/PDF file
- Sheet-specific summaries show totals for each drawing
- Global project summaries aggregate all sheets

### 3. **Persistent Storage**
- All takeoffs are automatically saved to the browser's local storage
- Data persists between browser sessions
- Takeoffs are restored when reopening projects

### 4. **Multiple Measurement Types**
- **Linear**: Measure distances between two points
- **Area**: Measure polygonal areas (3+ points)
- **Volume**: Measure volumetric quantities (3+ points, assumes depth)
- **Count**: Place markers for counting items

## How to Use

### 1. **Select a Condition**
1. Open the left sidebar (Takeoff Conditions)
2. Click on a condition to activate it
3. The condition will be highlighted in the top navigation bar
4. The PDF viewer will automatically enter drawing mode

### 2. **Drawing Takeoffs**

#### Linear Measurements
- Click to place points along the line you want to measure
- Continue clicking to add more points to create line segments
- Double-click to end the current line segment and complete the measurement
- The total length of all segments is calculated and displayed

#### Area Measurements
- Click multiple points to define the area boundary
- Double-click or press Enter to complete the measurement
- The area is filled with a semi-transparent color and shows the calculated value

#### Volume Measurements
- Click multiple points to define the base area
- Double-click or press Enter to complete the measurement
- Volume is calculated as area × depth (assumes depth = 1 unit)

#### Count Markers
- Click once to place a count marker
- The marker automatically completes and shows "1"

### 3. **Navigation and Viewing**
- **Zoom**: Use Ctrl/Cmd + scroll wheel or zoom buttons
- **Pan**: Click and drag on empty areas
- **Rotate**: Use the rotate button to rotate the PDF
- **Page Navigation**: Use Previous/Next buttons to switch pages

### 4. **Managing Takeoffs**
- **View Summary**: Right sidebar shows sheet-specific takeoff summary
- **Project Summary**: Bottom of right sidebar shows global project totals
- **Delete**: Currently, takeoffs persist - deletion functionality can be added

## Technical Implementation

### Store Structure
```typescript
interface TakeoffMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: Date;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>; // 0-1 scale
  conditionColor: string;
  conditionName: string;
}
```

### Key Components
- **TakeoffCanvas**: Main PDF viewer with takeoff drawing capabilities
- **TakeoffSidebar**: Condition selection and management
- **ProjectSummary**: Global project totals and summaries
- **useTakeoffStore**: Zustand store for state management

### Coordinate System
- **Screen Coordinates**: Pixels relative to the canvas viewport
- **PDF Coordinates**: Points relative to the PDF content
- **PDF-Relative Coordinates**: Normalized coordinates (0-1) for persistence

## Best Practices

### 1. **Condition Setup**
- Use descriptive names for conditions
- Choose appropriate colors for visual distinction
- Set correct units (ft, SF, CY, EA, etc.)

### 2. **Drawing Accuracy**
- Zoom in for precise point placement
- Use consistent measurement techniques
- Double-check calculations for complex shapes

### 3. **Organization**
- Group related conditions by trade or system
- Use consistent naming conventions
- Review takeoffs regularly for accuracy

## Future Enhancements

### Planned Features
- **Takeoff Editing**: Modify existing measurements
- **Takeoff Deletion**: Remove incorrect measurements
- **Advanced Calculations**: Custom formulas and waste factors
- **Export Functionality**: Generate reports and summaries
- **Collaboration**: Multi-user takeoff sessions

### Technical Improvements
- **Performance**: Optimize rendering for large PDFs
- **Accuracy**: Implement calibration for real-world measurements
- **Validation**: Check for overlapping or conflicting measurements
- **Backup**: Cloud storage and synchronization

## Troubleshooting

### Common Issues
1. **Takeoffs Not Appearing**: Check if the correct condition is selected
2. **Coordinates Off**: Ensure the PDF is properly loaded and calibrated
3. **Performance Issues**: Try reducing zoom level or closing other tabs
4. **Data Loss**: Check browser storage settings and available space

### Support
- Check browser console for error messages
- Verify PDF file integrity
- Ensure all required dependencies are loaded
- Contact development team for technical issues

## Conclusion

The takeoff functionality provides a robust foundation for digital quantity surveying. The PDF-relative positioning ensures measurements remain accurate across different viewing modes, while the persistent storage maintains data integrity between sessions. The system is designed to be intuitive for users familiar with traditional takeoff methods while leveraging modern web technologies for enhanced functionality.
