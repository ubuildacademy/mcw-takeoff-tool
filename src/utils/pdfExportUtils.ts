import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import type { TakeoffMeasurement, Annotation } from '../types';

interface PageMeasurements {
  pageNumber: number;
  sheetName: string;
  sheetId: string;
  measurements: TakeoffMeasurement[];
  annotations?: Annotation[];
}

/**
 * Fetch PDF bytes from the server
 */
async function fetchPDFBytes(fileId: string): Promise<Uint8Array> {
  // Use the correct API base URL instead of hardcoded localhost
  const { getApiBaseUrl } = await import('../lib/apiConfig');
  const API_BASE_URL = getApiBaseUrl();
  
  const response = await fetch(`${API_BASE_URL}/files/${fileId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Draw a measurement on a PDF page
 */
function drawMeasurement(
  page: any,
  measurement: TakeoffMeasurement,
  pageHeight: number
) {
  // Convert RGB hex color to pdf-lib rgb values
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        }
      : { r: 0, g: 0, b: 1 }; // default blue
  };

  const color = hexToRgb(measurement.conditionColor);
  const colorRgb = rgb(color.r, color.g, color.b);

  // Get page dimensions
  const { width } = page.getSize();

  // Convert PDF coordinates (0-1 scale) to actual page coordinates
  const toPageCoords = (point: { x: number; y: number }) => ({
    x: point.x * width,
    // PDF coordinates are bottom-up, so we need to flip Y
    y: pageHeight - point.y * pageHeight,
  });

  const points = measurement.pdfCoordinates.map(toPageCoords);

  if (measurement.type === 'linear' || measurement.type === 'count') {
    // Draw line segments
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      page.drawLine({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        thickness: 2,
        color: colorRgb,
        opacity: 0.8,
      });
    }

    // Draw dots at each point
    points.forEach((point) => {
      page.drawCircle({
        x: point.x,
        y: point.y,
        size: 4,
        color: colorRgb,
        opacity: 0.9,
      });
    });
  } else if (measurement.type === 'area' || measurement.type === 'volume') {
    // Draw polygon outline (since pdf-lib doesn't support filled polygons directly)
    if (points.length >= 3) {
      // Draw outline as connected lines
      for (let i = 0; i < points.length; i++) {
        const start = points[i];
        const end = points[(i + 1) % points.length];

        page.drawLine({
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          thickness: 2,
          color: colorRgb,
          opacity: 0.8,
        });
      }

      // Draw semi-transparent fill using many small rectangles (approximation)
      // Calculate bounding box
      const minX = Math.min(...points.map(p => p.x));
      const maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxY = Math.max(...points.map(p => p.y));

      // Draw a semi-transparent rectangle as background
      page.drawRectangle({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        color: colorRgb,
        opacity: 0.2,
      });

      // Draw dots at vertices
      points.forEach((point) => {
        page.drawCircle({
          x: point.x,
          y: point.y,
          size: 4,
          color: colorRgb,
          opacity: 0.9,
        });
      });
    }
  }

  // Draw cutouts if they exist
  if (measurement.cutouts && measurement.cutouts.length > 0) {
    const cutoutColor = rgb(1, 0, 0); // Red for cutouts
    
    measurement.cutouts.forEach((cutout) => {
      const cutoutPoints = cutout.pdfCoordinates.map(toPageCoords);
      
      if (cutoutPoints.length >= 3) {
        // Draw cutout outline with red lines
        for (let i = 0; i < cutoutPoints.length; i++) {
          const start = cutoutPoints[i];
          const end = cutoutPoints[(i + 1) % cutoutPoints.length];

          page.drawLine({
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            thickness: 2,
            color: cutoutColor,
            opacity: 0.7,
          });
        }

        // Draw vertices
        cutoutPoints.forEach((point) => {
          page.drawCircle({
            x: point.x,
            y: point.y,
            size: 3,
            color: cutoutColor,
            opacity: 0.8,
          });
        });
      }
    });
  }
}

/**
 * Draw an annotation on a PDF page
 */
async function drawAnnotation(
  page: any,
  annotation: Annotation,
  pageHeight: number
) {
  // Convert RGB hex color to pdf-lib rgb values
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        }
      : { r: 1, g: 0, b: 0 }; // default red
  };

  const color = hexToRgb(annotation.color);
  const colorRgb = rgb(color.r, color.g, color.b);

  // Get page dimensions
  const { width } = page.getSize();

  // Convert PDF coordinates (0-1 scale) to actual page coordinates
  const toPageCoords = (point: { x: number; y: number }) => ({
    x: point.x * width,
    // PDF coordinates are bottom-up, so we need to flip Y
    y: pageHeight - point.y * pageHeight,
  });

  const points = annotation.points.map(toPageCoords);

  if (annotation.type === 'text' && annotation.text) {
    // Draw text annotation
    const helveticaFont = await page.doc.embedFont(StandardFonts.Helvetica);
    const point = points[0];
    page.drawText(annotation.text, {
      x: point.x,
      y: point.y,
      size: 14,
      font: helveticaFont,
      color: colorRgb,
    });
  } else if (annotation.type === 'freehand') {
    // Draw freehand lines
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      page.drawLine({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        thickness: 3,
        color: colorRgb,
        opacity: 0.8,
      });
    }
  } else if (annotation.type === 'arrow' && points.length === 2) {
    // Draw arrow line
    const start = points[0];
    const end = points[1];
    page.drawLine({
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      thickness: 3,
      color: colorRgb,
      opacity: 0.8,
    });
    // Draw arrowhead
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowSize = 10;
    const arrowAngle = Math.PI / 6; // 30 degrees
    
    const arrowPoint1 = {
      x: end.x - arrowSize * Math.cos(angle - arrowAngle),
      y: end.y - arrowSize * Math.sin(angle - arrowAngle),
    };
    const arrowPoint2 = {
      x: end.x - arrowSize * Math.cos(angle + arrowAngle),
      y: end.y - arrowSize * Math.sin(angle + arrowAngle),
    };
    
    page.drawLine({
      start: { x: end.x, y: end.y },
      end: { x: arrowPoint1.x, y: arrowPoint1.y },
      thickness: 3,
      color: colorRgb,
      opacity: 0.8,
    });
    page.drawLine({
      start: { x: end.x, y: end.y },
      end: { x: arrowPoint2.x, y: arrowPoint2.y },
      thickness: 3,
      color: colorRgb,
      opacity: 0.8,
    });
  } else if (annotation.type === 'rectangle' && points.length === 2) {
    // Draw rectangle
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const widthRect = Math.abs(points[1].x - points[0].x);
    const heightRect = Math.abs(points[1].y - points[0].y);
    
    page.drawRectangle({
      x: x,
      y: y,
      width: widthRect,
      height: heightRect,
      borderColor: colorRgb,
      borderWidth: 3,
      opacity: 0.8,
    });
  } else if (annotation.type === 'circle' && points.length === 2) {
    // Draw ellipse
    const cx = (points[0].x + points[1].x) / 2;
    const cy = (points[0].y + points[1].y) / 2;
    const rx = Math.abs(points[1].x - points[0].x) / 2;
    const ry = Math.abs(points[1].y - points[0].y) / 2;
    
    page.drawEllipse({
      x: cx,
      y: cy,
      xScale: rx,
      yScale: ry,
      borderColor: colorRgb,
      borderWidth: 3,
      opacity: 0.8,
    });
  }
}

/**
 * Export pages with measurements to PDF
 */
export async function exportPagesWithMeasurementsToPDF(
  pagesWithMeasurements: PageMeasurements[],
  projectName: string,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  try {
    // Create a new PDF document
    const outputPdf = await PDFDocument.create();

    // Group pages by sheet ID to fetch PDFs efficiently
    const pagesBySheet = new Map<string, PageMeasurements[]>();
    pagesWithMeasurements.forEach((pageMeasurement) => {
      const existing = pagesBySheet.get(pageMeasurement.sheetId) || [];
      existing.push(pageMeasurement);
      pagesBySheet.set(pageMeasurement.sheetId, existing);
    });

    let processedPages = 0;
    const totalPages = pagesWithMeasurements.length;

    // Process each sheet
    for (const [sheetId, pages] of pagesBySheet.entries()) {
      onProgress?.(10 + (processedPages / totalPages) * 70);

      // Fetch the source PDF
      const pdfBytes = await fetchPDFBytes(sheetId);
      const sourcePdf = await PDFDocument.load(pdfBytes);

      // Process each page
      for (const pageMeasurement of pages) {
        const pageIndex = pageMeasurement.pageNumber - 1; // Convert to 0-based index

        // Copy the page from source PDF
        const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex]);
        const addedPage = outputPdf.addPage(copiedPage);

        // Get page dimensions
        const { height } = addedPage.getSize();

        // Draw measurements on the page
        pageMeasurement.measurements.forEach((measurement) => {
          drawMeasurement(addedPage, measurement, height);
        });

        // Draw annotations on the page
        if (pageMeasurement.annotations && pageMeasurement.annotations.length > 0) {
          for (const annotation of pageMeasurement.annotations) {
            await drawAnnotation(addedPage, annotation, height);
          }
        }

        processedPages++;
        onProgress?.(10 + (processedPages / totalPages) * 70);
      }
    }

    // Generate PDF bytes
    onProgress?.(85);
    const pdfBytes = await outputPdf.save();
    onProgress?.(95);

    return pdfBytes;
  } catch (error) {
    console.error('Error exporting PDF with measurements:', error);
    throw error;
  }
}

/**
 * Download PDF bytes as a file
 */
export function downloadPDF(pdfBytes: Uint8Array, filename: string): void {
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

