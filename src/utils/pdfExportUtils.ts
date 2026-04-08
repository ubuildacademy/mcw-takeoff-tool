import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { TakeoffMeasurement, Annotation, TakeoffCondition } from '../types';
import { formatFeetAndInches } from '../lib/utils';

// Configure PDF.js worker for viewport calculations
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Render sheets at a slightly higher resolution so zooming is less blurry,
// while preserving the physical PDF page size by downscaling the embedded image.
const EXPORT_RENDER_SCALE = 1.5;

interface PageMeasurements {
  pageNumber: number;
  sheetName: string;
  sheetId: string;
  measurements: TakeoffMeasurement[];
  annotations?: Annotation[];
  /** Per-page quantities (same as summary report for this sheet page). Shown as on-page legend. */
  pageLegendItems?: Array<{ condition: TakeoffCondition; total: number }>;
}

const HEX_COLOR_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

/** Parse `#RRGGBB` to 8-bit RGB channels. */
function parseHexRgb(
  hex: string,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  const m = HEX_COLOR_RE.exec(hex);
  if (!m) return fallback;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** Floating legend on a rendered sheet page (bottom-right), only for rows on this page. */
function drawPageLegendOverlay(
  page: PDFPage,
  items: Array<{ condition: TakeoffCondition; total: number }>,
  font: PDFFont,
  fontBold: PDFFont
): void {
  if (items.length === 0) return;

  const sorted = [...items].sort((a, b) => a.condition.name.localeCompare(b.condition.name));
  const { width: pageWidth } = page.getSize();

  const fontSize = 10.5;
  const titleSize = 12;
  const padding = 10;
  const lineHeight = 15;
  const swatch = 5.5;
  const gapAfterSwatch = 6;
  const edgeMargin = 10;
  const titleBodyGap = 7;

  const truncate = (s: string, maxLen: number) => (s.length > maxLen ? `${s.slice(0, maxLen - 3)}...` : s);

  const titleText = 'This page';
  const lines: string[] = sorted.map(({ condition, total }) => {
    const label = truncate(condition.name, 40);
    return `${label}: ${total.toFixed(2)} ${condition.unit}`;
  });

  let contentWidth = fontBold.widthOfTextAtSize(titleText, titleSize);
  for (const line of lines) {
    contentWidth = Math.max(contentWidth, font.widthOfTextAtSize(line, fontSize));
  }

  const boxWidth = Math.min(
    pageWidth - 2 * edgeMargin,
    contentWidth + padding * 2 + swatch + gapAfterSwatch
  );
  const boxHeight = padding + titleSize + titleBodyGap + lines.length * lineHeight + padding;

  const boxLeft = pageWidth - edgeMargin - boxWidth;
  const boxBottom = edgeMargin;

  page.drawRectangle({
    x: boxLeft,
    y: boxBottom,
    width: boxWidth,
    height: boxHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.78, 0.78, 0.78),
    borderWidth: 0.75,
    opacity: 0.96,
  });

  let textY = boxBottom + boxHeight - padding - titleSize;
  page.drawText(titleText, {
    x: boxLeft + padding,
    y: textY,
    size: titleSize,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  textY -= titleSize + titleBodyGap;

  sorted.forEach((item, i) => {
    const c = parseHexRgb(item.condition.color, { r: 0, g: 0, b: 255 });
    const line = lines[i];
    const swatchBottom = textY - fontSize * 0.35;
    page.drawRectangle({
      x: boxLeft + padding,
      y: swatchBottom,
      width: swatch,
      height: swatch,
      color: rgb(c.r / 255, c.g / 255, c.b / 255),
    });
    page.drawText(line, {
      x: boxLeft + padding + swatch + gapAfterSwatch,
      y: textY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    textY -= lineHeight;
  });
}

/**
 * Fetch PDF bytes from the server with authentication
 */
async function fetchPDFBytes(fileId: string): Promise<Uint8Array> {
  const { getApiBaseUrl } = await import('../lib/apiConfig');
  const { getAuthHeaders } = await import('../lib/apiAuth');
  const API_BASE_URL = getApiBaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
    headers,
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error('❌ Failed to fetch PDF:', { status: response.status, statusText: response.statusText, errorText, fileId });
    throw new Error(`Failed to fetch PDF: ${response.status} ${errorText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Transform normalized coordinates (0-1) to viewport coordinates based on rotation
 */
function transformCoordinates(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  rotation: number
): { x: number; y: number } {
  const normalizedX = point.x;
  const normalizedY = point.y;
  
  let canvasX: number, canvasY: number;
  
  if (rotation === 0) {
    canvasX = normalizedX * viewport.width;
    canvasY = normalizedY * viewport.height;
  } else if (rotation === 90) {
    canvasX = viewport.width * (1 - normalizedY);
    canvasY = viewport.height * normalizedX;
  } else if (rotation === 180) {
    canvasX = viewport.width * (1 - normalizedX);
    canvasY = viewport.height * (1 - normalizedY);
  } else if (rotation === 270) {
    canvasX = viewport.width * normalizedY;
    canvasY = viewport.height * (1 - normalizedX);
  } else {
    canvasX = normalizedX * viewport.width;
    canvasY = normalizedY * viewport.height;
  }
  
  return { x: canvasX, y: canvasY };
}

/**
 * Draw a measurement directly to canvas
 */
function drawMeasurementToCanvas(
  ctx: CanvasRenderingContext2D,
  measurement: TakeoffMeasurement,
  viewport: { width: number; height: number },
  rotation: number
): void {
  if (!measurement.pdfCoordinates || measurement.pdfCoordinates.length === 0) return;
  
  const transformedPoints = measurement.pdfCoordinates.map(p => 
    transformCoordinates(p, viewport, rotation)
  );
  
  const strokeColor = measurement.conditionColor || '#000000';
  const rgb = parseHexRgb(strokeColor, { r: 0, g: 0, b: 0 });
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.lineWidth = measurement.type === 'linear' && measurement.conditionLineThickness != null
    ? measurement.conditionLineThickness
    : 2;

  switch (measurement.type) {
    case 'linear':
      if (transformedPoints.length >= 2) {
        // Draw polyline
        ctx.beginPath();
        ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
        for (let i = 1; i < transformedPoints.length; i++) {
          ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
        }
        ctx.stroke();
        
        // Draw dots
        transformedPoints.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
          ctx.fill();
        });
        
        // Add text
        const startPoint = transformedPoints[0];
        const endPoint = transformedPoints[transformedPoints.length - 1];
        const midPoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
        
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        const linearValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf')
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        
        const displayValue = measurement.areaValue
          ? `${linearValue} LF / ${measurement.areaValue.toFixed(0)} SF`
          : linearValue;
        
        ctx.fillText(displayValue, midPoint.x, midPoint.y - 5);
      }
      break;
      
    case 'area':
    case 'volume':
      if (transformedPoints.length >= 3) {
        // Match viewer (pdfViewerRenderers): compound path + even-odd fill so cutouts are unfilled holes.
        const cutoutPaths: Array<Array<{ x: number; y: number }>> = [];
        if (measurement.cutouts && measurement.cutouts.length > 0) {
          for (const cutout of measurement.cutouts) {
            if (cutout.pdfCoordinates && cutout.pdfCoordinates.length >= 3) {
              cutoutPaths.push(
                cutout.pdfCoordinates.map((p) => transformCoordinates(p, viewport, rotation))
              );
            }
          }
        }
        const hasCutouts = cutoutPaths.length > 0;

        ctx.beginPath();
        ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
        for (let i = 1; i < transformedPoints.length; i++) {
          ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
        }
        ctx.closePath();
        for (const cutoutPts of cutoutPaths) {
          ctx.moveTo(cutoutPts[0].x, cutoutPts[0].y);
          for (let i = 1; i < cutoutPts.length; i++) {
            ctx.lineTo(cutoutPts[i].x, cutoutPts[i].y);
          }
          ctx.closePath();
        }

        ctx.globalAlpha = 0.25;
        ctx.fill(hasCutouts ? 'evenodd' : 'nonzero');
        ctx.globalAlpha = 1.0;

        ctx.stroke();

        transformedPoints.forEach((point) => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
          ctx.fill();
        });

        // Add text
        const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
        const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
        
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
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
        
        ctx.fillText(finalDisplayValue, centerX, centerY);
      }
      break;
      
    case 'count':
      if (transformedPoints.length >= 1) {
        const point = transformedPoints[0];
        
        // Draw circle with white border
        ctx.beginPath();
        ctx.arc(point.x, point.y, 8, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = 'rgb(255, 255, 255)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        ctx.lineWidth = 2;
        
        // Add count text
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const countValue = measurement.calculatedValue >= 1 
          ? Math.round(measurement.calculatedValue).toString()
          : '1';
        
        ctx.fillText(countValue, point.x, point.y);
      }
      break;
  }
}

/**
 * Draw an annotation directly to canvas
 */
function drawAnnotationToCanvas(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  viewport: { width: number; height: number },
  rotation: number
): void {
  if (!annotation.points || annotation.points.length === 0) return;
  
  const points = annotation.points.map(p => 
    transformCoordinates(p, viewport, rotation)
  );
  
  const strokeColor = annotation.color || '#ff0000';
  const rgb = parseHexRgb(strokeColor, { r: 255, g: 0, b: 0 });
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.8;
  
  if (annotation.type === 'text' && annotation.text) {
    const point = points[0];
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(annotation.text, point.x, point.y);
  } else if (annotation.type === 'arrow' && points.length === 2) {
    // Draw line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    
    // Draw arrowhead
    const angle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
    const arrowSize = 10;
    const arrowAngle = Math.PI / 6;
    
    const arrowPoint1 = {
      x: points[1].x - arrowSize * Math.cos(angle - arrowAngle),
      y: points[1].y - arrowSize * Math.sin(angle - arrowAngle)
    };
    const arrowPoint2 = {
      x: points[1].x - arrowSize * Math.cos(angle + arrowAngle),
      y: points[1].y - arrowSize * Math.sin(angle + arrowAngle)
    };
    
    ctx.beginPath();
    ctx.moveTo(points[1].x, points[1].y);
    ctx.lineTo(arrowPoint1.x, arrowPoint1.y);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(points[1].x, points[1].y);
    ctx.lineTo(arrowPoint2.x, arrowPoint2.y);
    ctx.stroke();
  } else if (annotation.type === 'rectangle' && points.length === 2) {
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const width = Math.abs(points[1].x - points[0].x);
    const height = Math.abs(points[1].y - points[0].y);
    
    ctx.strokeRect(x, y, width, height);
  } else if (annotation.type === 'circle' && points.length === 2) {
    const cx = (points[0].x + points[1].x) / 2;
    const cy = (points[0].y + points[1].y) / 2;
    const rx = Math.abs(points[1].x - points[0].x) / 2;
    const ry = Math.abs(points[1].y - points[0].y) / 2;
    
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (annotation.type === 'freehand' && points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }
  
  ctx.globalAlpha = 1.0;
}

/**
 * Render PDF page with markups to canvas and return as image
 */
async function renderPageWithMarkupsToCanvas(
  pdfBytes: Uint8Array,
  pageNumber: number,
  measurements: TakeoffMeasurement[],
  annotations: Annotation[],
  documentRotation: number,
  scale: number = 2.0
): Promise<{ imageData: Uint8Array; width: number; height: number }> {
  // Load PDF with pdf.js
  const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const pdfJsPage = await pdfJsDoc.getPage(pageNumber);
  
  // Get viewport with rotation applied at the desired scale (for rendering)
  // This is the SAME viewport we'll use for both PDF rendering and markup rendering
  const viewport = pdfJsPage.getViewport({ scale, rotation: documentRotation });
  
  // Create off-screen canvas at the viewport size
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Render PDF page to canvas using the viewport
  const renderContext = {
    canvasContext: ctx,
    viewport: viewport
  };
  
  await pdfJsPage.render(renderContext as unknown as Parameters<typeof pdfJsPage.render>[0]).promise;
  
  // Use the SAME viewport for coordinate transformation
  // The transformCoordinates function will convert normalized (0-1) coordinates
  // to pixel coordinates matching this viewport (with rotation already applied)
  // Draw measurements directly to canvas
  measurements.forEach(measurement => {
    drawMeasurementToCanvas(ctx, measurement, viewport, documentRotation);
  });
  
  // Draw annotations directly to canvas
  annotations.forEach(annotation => {
    drawAnnotationToCanvas(ctx, annotation, viewport, documentRotation);
  });
  
  // Convert canvas to PNG
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to convert canvas to blob'));
        return;
      }
      
      blob.arrayBuffer().then(buffer => {
        resolve({
          imageData: new Uint8Array(buffer),
          width: canvas.width,
          height: canvas.height
        });
      }).catch(reject);
    }, 'image/png');
  });
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
  documentRotations?: Map<string, number>,
  onProgress?: (progress: number) => void
): Promise<ExportResult> {
  try {
    // Create a new PDF document
    const outputPdf = await PDFDocument.create();
    const legendFont = await outputPdf.embedFont(StandardFonts.Helvetica);
    const legendFontBold = await outputPdf.embedFont(StandardFonts.HelveticaBold);

    // Group pages by sheet ID to fetch PDFs efficiently
    const pagesBySheet = new Map<string, PageMeasurements[]>();
    pagesWithMeasurements.forEach((pageMeasurement) => {
      const existing = pagesBySheet.get(pageMeasurement.sheetId) || [];
      existing.push(pageMeasurement);
      pagesBySheet.set(pageMeasurement.sheetId, existing);
    });

    // Grouping pages by sheet for export

    let processedPages = 0;
    const totalPages = pagesWithMeasurements.length;
    const skippedSheets: Array<{ sheetId: string; reason: string }> = [];

    // Process each sheet
    for (const [sheetId, pages] of pagesBySheet.entries()) {
      onProgress?.(10 + (processedPages / totalPages) * 70);

      // Processing sheet
      
      try {
        // Fetch the source PDF
        const pdfBytes = await fetchPDFBytes(sheetId);
        const _sourcePdf = await PDFDocument.load(pdfBytes);

        // Process each page
        for (const pageMeasurement of pages) {
          const _pageIndex = pageMeasurement.pageNumber - 1; // Convert to 0-based index

          // Get document rotation for this page (per-sheet rotation, then document-level fallback)
          const fullSheetId = `${sheetId}-${pageMeasurement.pageNumber}`;
          const documentRotation = documentRotations?.get(fullSheetId) ?? documentRotations?.get(sheetId) ?? 0;
          
          // Clone bytes for pdf.js rendering to avoid ArrayBuffer detachment issues
          // pdf.js transfers the ArrayBuffer to a worker, which detaches it
          // Creating a new Uint8Array creates a copy with a new underlying ArrayBuffer
          const pdfBytesForRender = new Uint8Array(pdfBytes);
          
          // Render page with markups at a higher scale for sharper zoom in the exported PDF.
          // We keep the PDF page's physical size the same by drawing the higher-res image downscaled.
          const { imageData, width, height } = await renderPageWithMarkupsToCanvas(
            pdfBytesForRender,
            pageMeasurement.pageNumber,
            pageMeasurement.measurements,
            pageMeasurement.annotations || [],
            documentRotation,
            EXPORT_RENDER_SCALE
          );
          
          // Embed the rendered image as a new page (downscaled to preserve page size).
          const pngImage = await outputPdf.embedPng(imageData);
          const pageWidth = width / EXPORT_RENDER_SCALE;
          const pageHeight = height / EXPORT_RENDER_SCALE;
          const addedPage = outputPdf.addPage([pageWidth, pageHeight]);
          
          // Draw the image to fill the page exactly (same aspect ratio, higher effective DPI).
          addedPage.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight,
          });

          const legendItems = pageMeasurement.pageLegendItems;
          if (legendItems && legendItems.length > 0) {
            drawPageLegendOverlay(addedPage, legendItems, legendFont, legendFontBold);
          }

          processedPages++;
          onProgress?.(10 + (processedPages / totalPages) * 70);
        }
      } catch (error: unknown) {
        console.error(`⚠️ Failed to process sheet ${sheetId}:`, error);
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('404') || msg.includes('File not found')) {
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

