# Meridian Takeoff - User Guide

## Getting Started with Takeoffs

The takeoff functionality allows you to measure and calculate quantities from PDF drawings. Here's how to use it:

### 1. Select a Takeoff Condition

- Open the left sidebar to see available takeoff conditions
- Click on a condition to select it (it will show as "Active")
- The condition type determines how you'll measure:
  - **Linear**: Measure distances (walls, pipes, etc.)
  - **Area**: Measure surface areas (floors, walls, etc.)
  - **Volume**: Measure volumes (excavation, concrete, etc.)
  - **Count**: Count items (windows, doors, fixtures, etc.)

### 2. Drawing Takeoffs

#### Linear Measurements
- Click to place points along the line you want to measure
- Continue clicking to add more points to create line segments
- Double-click to end the current line segment and complete the measurement
- The total length of all segments is calculated and displayed
- Results show in the selected unit (e.g., feet, meters)

#### Area Measurements
- Click 3 or more points to define the area boundary
- Double-click the last point to complete the measurement
- The area is automatically calculated and displayed

#### Volume Measurements
- Click 3 or more points to define the base area
- Double-click the last point to complete
- Volume is calculated using the area × depth (depth = scale factor)

#### Count Measurements
- Click once to place a count marker
- Each click adds one to the count

### 3. Calibrating Scale

Before taking measurements, you should calibrate the drawing scale:

1. Click the "Calibrate" button in the top toolbar
2. Enter a known distance (e.g., 10 feet)
3. Select the unit (feet, meters, etc.)
4. Click two points on the PDF that represent that known distance
5. The scale is automatically calculated and applied

### 4. Navigation Controls

- **Zoom**: Use mouse wheel or +/- buttons
- **Pan**: Click and drag to move around
- **Rotate**: Use the rotate button to turn the PDF
- **Fit to Screen**: Automatically fit the PDF to the viewport

### 5. Keyboard Shortcuts

- **Escape**: Cancel current drawing
- **Enter**: Complete current drawing (for area/volume)
- **Shift**: Hold while drawing linear measurements for straight lines

### 6. Viewing Results

- Takeoff measurements appear on the PDF with the condition's color
- A summary panel shows all measurements for the current sheet
- The right sidebar displays project totals and summaries

### 7. Tips for Accurate Measurements

- Always calibrate the scale first
- Use zoom to get precise point placement
- For large areas, break them into smaller sections
- Use the grid or snap features if available
- Double-check measurements against known dimensions

### 8. Troubleshooting

**Measurements not appearing?**
- Check that a condition is selected (should show "Active")
- Ensure the PDF is properly loaded
- Verify the scale calibration

**Incorrect measurements?**
- Recalibrate the scale
- Check that the unit of measurement matches your needs
- Ensure you're clicking the correct points

**PDF not loading?**
- Check the file format (PDF only)
- Verify the file isn't corrupted
- Try refreshing the page

## Sample Takeoff Workflow

1. **Upload PDF**: Use the upload button to add your drawing
2. **Calibrate**: Set the scale using a known dimension
3. **Select Condition**: Choose what you're measuring (e.g., "Concrete Foundation")
4. **Draw Measurements**: Click points according to the condition type
5. **Review**: Check measurements appear correctly on the PDF
6. **Export**: Use the export button to save your takeoff data

## Units and Precision

- All measurements are stored in the condition's specified unit
- Values are displayed to 2 decimal places
- Waste factors are automatically applied to calculations
- Scale factors are maintained per sheet for accuracy

For technical support or feature requests, please contact the development team.
