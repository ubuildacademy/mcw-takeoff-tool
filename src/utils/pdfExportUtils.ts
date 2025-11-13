import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { TakeoffMeasurement, Annotation } from '../types';
import { formatFeetAndInches } from '../lib/utils';

// Configure PDF.js worker for viewport calculations
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PageMeasurements {
  pageNumber: number;
  sheetName: string;
  sheetId: string;
  measurements: TakeoffMeasurement[];
  annotations?: Annotation[];
}

/**
 * Fetch PDF bytes from the server with authentication
 */
async function fetchPDFBytes(fileId: string): Promise<Uint8Array> {
  // Use the correct API base URL instead of hardcoded localhost
  const { getApiBaseUrl } = await import('../lib/apiConfig');
  const API_BASE_URL = getApiBaseUrl();
  
  console.log('📥 Fetching PDF bytes for fileId:', fileId);
  
  // Get authentication token from Supabase session
  const { supabase } = await import('../lib/supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const authToken = session?.access_token;
  
  // Build headers with authentication
  const headers: HeadersInit = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  } else {
    console.warn('⚠️ No auth token available for PDF fetch');
  }
  
  const url = `${API_BASE_URL}/files/${fileId}`;
  console.log('🌐 Fetching PDF from:', url);
  
  const response = await fetch(url, {
    headers,
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error('❌ Failed to fetch PDF:', { status: response.status, statusText: response.statusText, errorText, fileId });
    throw new Error(`Failed to fetch PDF: ${response.status} ${errorText}`);
  }
  
  console.log('✅ PDF fetched successfully for fileId:', fileId);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Draw a measurement on a PDF page
 * Matches the visual styling from the PDF viewer exactly
 */
async function drawMeasurement(
  page: any,
  measurement: TakeoffMeasurement,
  pageHeight: number,
  viewportWidth: number,
  viewportHeight: number
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

  // Get page dimensions from pdf-lib
  const { width: pageWidth } = page.getSize();

  // Convert PDF coordinates (0-1 normalized scale) to actual page coordinates
  // Coordinates are stored normalized based on viewport at rotation 0, scale 1
  // pdf-lib uses bottom-left origin, so we need to flip Y
  // Use viewport dimensions to match the coordinate system used when storing measurements
  const toPageCoords = (point: { x: number; y: number }) => ({
    x: point.x * viewportWidth,
    // Y flip: pdf-lib Y=0 is bottom, normalized Y=0 is top (from viewport)
    y: pageHeight - (point.y * viewportHeight),
  });

  const points = measurement.pdfCoordinates.map(toPageCoords);

  // Embed fonts for text labels
  const helveticaFont = await page.doc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await page.doc.embedFont(StandardFonts.HelveticaBold);

  if (measurement.type === 'linear') {
    // Draw line segments - match viewer: stroke width 2, opacity 1.0
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];

      page.drawLine({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        thickness: 2,
        color: colorRgb,
        opacity: 1.0, // Match viewer (no opacity specified = 1.0)
      });
    }

    // Draw dots at each point
    points.forEach((point) => {
      page.drawCircle({
        x: point.x,
        y: point.y,
        size: 4,
        color: colorRgb,
        opacity: 1.0,
      });
    });

    // Add measurement text label at midpoint
    if (points.length >= 2) {
      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      const midPoint = {
        x: (startPoint.x + endPoint.x) / 2,
        y: (startPoint.y + endPoint.y) / 2,
      };

      // Format value - match viewer formatting
      const displayValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf')
        ? formatFeetAndInches(measurement.calculatedValue)
        : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;

      // Calculate text width to center it (pdf-lib doesn't support text-anchor)
      const fontSize = 12;
      const textWidth = helveticaFont.widthOfTextAtSize(displayValue, fontSize);
      
      // Draw text label - font size 12, Arial equivalent (Helvetica), centered
      // Position slightly above the line (5 points up in viewer)
      page.drawText(displayValue, {
        x: midPoint.x - textWidth / 2, // Center the text
        y: midPoint.y - 5,
        size: fontSize,
        font: helveticaFont,
        color: colorRgb,
      });
    }
  } else if (measurement.type === 'area' || measurement.type === 'volume') {
    if (points.length >= 3) {
      // Draw outline - stroke width 2, opacity 1.0
      for (let i = 0; i < points.length; i++) {
        const start = points[i];
        const end = points[(i + 1) % points.length];

        page.drawLine({
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          thickness: 2,
          color: colorRgb,
          opacity: 1.0,
        });
      }

      // Draw fill - opacity 0.25 (matches viewer's 40 hex = 0.25 decimal)
      // Use pdf-lib's polygon fill capability
      const minX = Math.min(...points.map(p => p.x));
      const maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxY = Math.max(...points.map(p => p.y));

      // For now, use rectangle approximation (pdf-lib doesn't have direct polygon fill)
      // But we'll draw it with proper opacity
      page.drawRectangle({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        color: colorRgb,
        opacity: 0.25, // 40 in hex = 0.25 in decimal
      });

      // Draw dots at vertices
      points.forEach((point) => {
        page.drawCircle({
          x: point.x,
          y: point.y,
          size: 4,
          color: colorRgb,
          opacity: 1.0,
        });
      });

      // Add measurement text label at center
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

      // Format value - match viewer formatting
      const displayValue = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null
        ? measurement.netCalculatedValue
        : measurement.calculatedValue;
      
      let finalDisplayValue: string;
      if (measurement.type === 'area') {
        const areaValue = `${displayValue.toFixed(0)} SF`;
        finalDisplayValue = measurement.perimeterValue
          ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
          : areaValue;
      } else {
        const volumeValue = `${displayValue.toFixed(0)} CY`;
        finalDisplayValue = measurement.perimeterValue
          ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
          : volumeValue;
      }

      // Calculate text width to center it (pdf-lib doesn't support text-anchor)
      const fontSize = 12;
      const textWidth = helveticaBoldFont.widthOfTextAtSize(finalDisplayValue, fontSize);
      
      // Draw text label - font size 12, bold, Arial equivalent, centered
      page.drawText(finalDisplayValue, {
        x: centerX - textWidth / 2, // Center the text horizontally
        y: centerY - fontSize / 3, // Center vertically (adjust for baseline)
        size: fontSize,
        font: helveticaBoldFont,
        color: colorRgb,
      });
    }
  } else if (measurement.type === 'count') {
    // Draw circle for count measurement - match viewer: radius 8, fill color, white stroke
    const point = points[0];
    const circleRadius = 8;
    
    // Draw circle with fill and white border - pdf-lib supports both
    page.drawCircle({
      x: point.x,
      y: point.y,
      size: circleRadius,
      color: colorRgb,
      borderColor: rgb(1, 1, 1), // White stroke
      borderWidth: 2,
      opacity: 1.0,
    });

    // Add count text label - show calculated value (usually 1, but could be more)
    const countValue = measurement.calculatedValue >= 1 
      ? Math.round(measurement.calculatedValue).toString()
      : '1';
    
    // Calculate text width to center it
    const fontSize = 14;
    const textWidth = helveticaBoldFont.widthOfTextAtSize(countValue, fontSize);
    
    // Draw text label - font size 14, bold, white, centered
    page.drawText(countValue, {
      x: point.x - textWidth / 2, // Center horizontally
      y: point.y + 4, // Slightly above center
      size: fontSize,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1), // White text
    });
  }

  // Draw cutouts if they exist - match viewer styling
  if (measurement.cutouts && measurement.cutouts.length > 0) {
    const cutoutColor = rgb(1, 0, 0); // Red for cutouts
    
    measurement.cutouts.forEach((cutout) => {
      const cutoutPoints = cutout.pdfCoordinates.map(toPageCoords);
      
      if (cutoutPoints.length >= 3) {
        // Draw cutout outline with red lines - stroke width 2
        for (let i = 0; i < cutoutPoints.length; i++) {
          const start = cutoutPoints[i];
          const end = cutoutPoints[(i + 1) % cutoutPoints.length];

          page.drawLine({
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            thickness: 2,
            color: cutoutColor,
            opacity: 1.0,
          });
        }

        // Draw vertices
        cutoutPoints.forEach((point) => {
          page.drawCircle({
            x: point.x,
            y: point.y,
            size: 3,
            color: cutoutColor,
            opacity: 1.0,
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
  pageHeight: number,
  viewportWidth: number,
  viewportHeight: number
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

  // Get page dimensions from pdf-lib
  const { width: pageWidth } = page.getSize();

  // Convert PDF coordinates (0-1 normalized scale) to actual page coordinates
  // Coordinates are stored normalized based on viewport at rotation 0, scale 1
  // pdf-lib uses bottom-left origin, so we need to flip Y
  // Use viewport dimensions to match the coordinate system used when storing annotations
  const toPageCoords = (point: { x: number; y: number }) => ({
    x: point.x * viewportWidth,
    // Y flip: pdf-lib Y=0 is bottom, normalized Y=0 is top (from viewport)
    y: pageHeight - (point.y * viewportHeight),
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
export interface ExportResult {
  pdfBytes: Uint8Array;
  skippedSheets: Array<{ sheetId: string; reason: string }>;
}

export async function exportPagesWithMeasurementsToPDF(
  pagesWithMeasurements: PageMeasurements[],
  projectName: string,
  onProgress?: (progress: number) => void
): Promise<ExportResult> {
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

    console.log('📊 PDF Export - Pages grouped by sheet:', {
      totalSheets: pagesBySheet.size,
      sheetIds: Array.from(pagesBySheet.keys()),
      totalPages: pagesWithMeasurements.length
    });

    let processedPages = 0;
    const totalPages = pagesWithMeasurements.length;
    const skippedSheets: Array<{ sheetId: string; reason: string }> = [];

    // Process each sheet
    for (const [sheetId, pages] of pagesBySheet.entries()) {
      onProgress?.(10 + (processedPages / totalPages) * 70);

      console.log('📄 Processing sheet:', { sheetId, pageCount: pages.length, pages: pages.map(p => p.pageNumber) });
      
      try {
        // Fetch the source PDF
        const pdfBytes = await fetchPDFBytes(sheetId);
        const sourcePdf = await PDFDocument.load(pdfBytes);

        // Load PDF with pdf.js to get accurate viewport dimensions (matches viewer)
        const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

        // Process each page
        for (const pageMeasurement of pages) {
          const pageIndex = pageMeasurement.pageNumber - 1; // Convert to 0-based index

          // Get viewport dimensions for this specific page (matches viewer coordinate system)
          const pdfJsPage = await pdfJsDoc.getPage(pageMeasurement.pageNumber);
          // Get viewport at rotation 0, scale 1 (matches how coordinates are stored)
          const baseViewport = pdfJsPage.getViewport({ scale: 1, rotation: 0 });
          const viewportWidth = baseViewport.width;
          const viewportHeight = baseViewport.height;

          // Copy the page from source PDF
          const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageIndex]);
          const addedPage = outputPdf.addPage(copiedPage);

          // Get page dimensions from pdf-lib (should match viewport at rotation 0)
          const { width: pageWidth, height: pageHeight } = addedPage.getSize();

          // Draw measurements on the page
          for (const measurement of pageMeasurement.measurements) {
            await drawMeasurement(addedPage, measurement, pageHeight, viewportWidth, viewportHeight);
          }

          // Draw annotations on the page
          if (pageMeasurement.annotations && pageMeasurement.annotations.length > 0) {
            for (const annotation of pageMeasurement.annotations) {
              await drawAnnotation(addedPage, annotation, pageHeight, viewportWidth, viewportHeight);
            }
          }

          processedPages++;
          onProgress?.(10 + (processedPages / totalPages) * 70);
        }
      } catch (error: any) {
        // If file not found, log and skip this sheet but continue with others
        console.error(`⚠️ Failed to process sheet ${sheetId}:`, error);
        if (error.message?.includes('404') || error.message?.includes('File not found')) {
          const reason = 'File not found - may have been deleted';
          console.warn(`⏭️ Skipping sheet ${sheetId} - ${reason}`);
          skippedSheets.push({ sheetId, reason });
          // Still increment processed pages to maintain progress
          processedPages += pages.length;
          continue;
        }
        // Re-throw other errors
        throw error;
      }
    }

    // Generate PDF bytes
    onProgress?.(85);
    const pdfBytes = await outputPdf.save();
    onProgress?.(95);

    return { pdfBytes, skippedSheets };
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

