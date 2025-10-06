# Meridian Takeoff - Complete User Guide

## Getting Started with Takeoffs

The takeoff functionality allows you to measure and calculate quantities directly from PDF drawings. Your measurements are automatically saved and will stay in place when you zoom, pan, or rotate the PDF.

## Key Features

- **Persistent Measurements**: Takeoffs stay exactly where you place them, even when switching between pages or sessions
- **Multiple Measurement Types**: Measure distances, areas, volumes, and count items
- **Automatic Calculations**: Get instant results with proper units and totals
- **Sheet-Specific Tracking**: Each drawing has its own measurements and summaries
- **Project Totals**: See combined results across all your drawings

## How to Use Takeoffs

### 1. Select a Takeoff Condition

1. Open the left sidebar to see available takeoff conditions
2. Click on a condition to select it (it will show as "Active" in the top bar)
3. The condition type determines how you'll measure:
   - **Linear**: Measure distances (walls, pipes, etc.)
   - **Area**: Measure surface areas (floors, walls, etc.)
   - **Volume**: Measure volumes (excavation, concrete, etc.)
   - **Count**: Count items (windows, doors, fixtures, etc.)

### 2. Drawing Measurements

#### Linear Measurements
- Click to place points along the line you want to measure
- Continue clicking to add more points and create line segments
- Double-click to end the current line segment and complete the measurement
- The total length of all segments is calculated and displayed
- Results show in the selected unit (e.g., feet, meters)

#### Area Measurements
- Click 3 or more points to define the area boundary
- Double-click the last point to complete the measurement
- The area is automatically calculated and displayed with a semi-transparent fill
- Perfect for measuring floors, walls, or any surface area

#### Volume Measurements
- Click 3 or more points to define the base area
- Double-click the last point to complete
- Volume is calculated using the area × depth (depth = scale factor)
- Ideal for excavation, concrete, or any volumetric calculations

#### Count Measurements
- Click once to place a count marker
- Each click adds one to the count
- Great for counting windows, doors, fixtures, or any items

### 3. Calibrating Scale

Before taking measurements, you should calibrate the drawing scale:

1. Click the "Calibrate" button in the top toolbar
2. Enter a known distance (e.g., 10 feet)
3. Select the unit (feet, meters, etc.)
4. Click two points on the PDF that represent that known distance
5. The scale is automatically calculated and applied to all measurements

### 4. Navigation Controls

- **Zoom**: Use mouse wheel or +/- buttons
- **Pan**: Click and drag to move around the drawing
- **Rotate**: Use the rotate button to turn the PDF for better viewing
- **Fit to Screen**: Automatically fit the PDF to the viewport
- **Page Navigation**: Use Previous/Next buttons to switch between pages

### 5. Keyboard Shortcuts

- **Escape**: Cancel current drawing
- **Enter**: Complete current drawing (for area/volume)
- **Shift**: Hold while drawing linear measurements for straight lines

### 6. Viewing Results

- Takeoff measurements appear on the PDF with the condition's color
- A summary panel shows all measurements for the current sheet
- The right sidebar displays project totals and summaries
- Each measurement shows its calculated value and unit

## Sample Takeoff Workflow

1. **Upload PDF**: Use the upload button to add your drawing
2. **Calibrate**: Set the scale using a known dimension on the drawing
3. **Select Condition**: Choose what you're measuring (e.g., "Concrete Foundation")
4. **Draw Measurements**: Click points according to the condition type
5. **Review**: Check measurements appear correctly on the PDF
6. **Switch Sheets**: Move to other pages and repeat the process
7. **Check Totals**: Review the project summary for overall quantities

## Tips for Accurate Measurements

- **Always calibrate first**: Use a known dimension to set the scale
- **Zoom in for precision**: Get close to place points accurately
- **Break large areas into sections**: For complex shapes, measure in smaller parts
- **Double-check your work**: Verify measurements against known dimensions
- **Use consistent techniques**: Follow the same approach for similar measurements

## Managing Your Takeoffs

### Viewing Summaries
- **Sheet Summary**: Right sidebar shows totals for the current drawing
- **Project Summary**: Bottom of right sidebar shows combined totals from all sheets
- **Condition Breakdown**: See measurements grouped by condition type

### Organization Tips
- Use descriptive names for your conditions
- Choose different colors for easy visual distinction
- Group related conditions by trade or system
- Review takeoffs regularly for accuracy

## Troubleshooting

### Measurements not appearing?
- Check that a condition is selected (should show "Active")
- Ensure the PDF is properly loaded
- Verify the scale calibration is complete

### Incorrect measurements?
- Recalibrate the scale using a different known dimension
- Check that the unit of measurement matches your needs
- Ensure you're clicking the correct points
- Try zooming in for more precise point placement

### PDF not loading?
- Check the file format (PDF only)
- Verify the file isn't corrupted
- Try refreshing the page
- Ensure you have a stable internet connection

### Performance issues?
- Try reducing the zoom level
- Close other browser tabs to free up memory
- Check if your PDF file is very large

## Units and Precision

- All measurements are stored in the condition's specified unit
- Values are displayed to 2 decimal places for accuracy
- Scale factors are maintained per sheet for consistency
- Your measurements persist between browser sessions

## Best Practices

### Setting Up Conditions
- Use clear, descriptive names (e.g., "Concrete Foundation" vs "Concrete")
- Choose contrasting colors for easy visual distinction
- Set appropriate units (ft, SF, CY, EA, etc.)
- Group related conditions together

### Drawing Accuracy
- Always start with scale calibration
- Use zoom to get precise point placement
- Be consistent with your measurement techniques
- Double-check complex calculations

### Project Organization
- Use consistent naming conventions across conditions
- Review takeoffs regularly for accuracy
- Keep related measurements on the same sheets when possible
- Document any special considerations or notes

---

## Technical Notes (For Reference)

### How Measurements Are Stored
- Takeoffs are saved with PDF-relative coordinates (0-1 scale)
- This ensures measurements stay in place when viewing the PDF
- Data is automatically saved to your browser's local storage
- Measurements persist between sessions and page changes

### Coordinate System
- **Screen Coordinates**: Where you click on your screen
- **PDF Coordinates**: Converted to the PDF's coordinate system
- **PDF-Relative Coordinates**: Normalized coordinates (0-1) for storage

### Data Structure
Each measurement includes:
- Unique identifier
- Project and sheet information
- Condition details (type, color, unit)
- Point coordinates
- Calculated value
- Timestamp

### Browser Requirements
- Modern web browser with JavaScript enabled
- Local storage enabled for data persistence
- PDF.js support for PDF rendering

For technical support or feature requests, please contact the development team.