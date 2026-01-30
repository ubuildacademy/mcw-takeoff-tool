import { PDFDocument, rgb, degrees, StandardFonts, type PDFPage } from 'pdf-lib';
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
  
  const response = await fetch(url, {
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
 * Draw a measurement on a PDF page
 * Matches the visual styling from the PDF viewer exactly
 */
async function drawMeasurement(
  page: PDFPage,
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
      const linearValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf')
        ? formatFeetAndInches(measurement.calculatedValue)
        : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
      
      // Show both linear and area if areaValue is present
      const displayValue = measurement.areaValue
        ? `${linearValue} LF / ${measurement.areaValue.toFixed(0)} SF`
        : linearValue;

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
  page: PDFPage,
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
 * Render a measurement to SVG element
 */
function renderMeasurementToSVG(
  svg: SVGSVGElement,
  measurement: TakeoffMeasurement,
  viewport: { width: number; height: number },
  rotation: number
): void {
  if (!measurement.pdfCoordinates || measurement.pdfCoordinates.length === 0) return;
  
  const transformedPoints = measurement.pdfCoordinates.map(p => 
    transformCoordinates(p, viewport, rotation)
  );
  
  const strokeColor = measurement.conditionColor || '#000000';
  const strokeWidth = '2';
  
  switch (measurement.type) {
    case 'linear':
      if (transformedPoints.length >= 2) {
        // Draw polyline
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = transformedPoints.map(p => `${p.x},${p.y}`).join(' ');
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('fill', 'none');
        svg.appendChild(polyline);
        
        // Draw dots
        transformedPoints.forEach(point => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', point.x.toString());
          circle.setAttribute('cy', point.y.toString());
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', strokeColor);
          svg.appendChild(circle);
        });
        
        // Add text
        const startPoint = transformedPoints[0];
        const endPoint = transformedPoints[transformedPoints.length - 1];
        const midPoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midPoint.x.toString());
        text.setAttribute('y', (midPoint.y - 5).toString());
        text.setAttribute('fill', strokeColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('text-anchor', 'middle');
        
        const linearValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf')
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        
        const displayValue = measurement.areaValue
          ? `${linearValue} LF / ${measurement.areaValue.toFixed(0)} SF`
          : linearValue;
        text.textContent = displayValue;
        svg.appendChild(text);
      }
      break;
      
    case 'area':
    case 'volume':
      if (transformedPoints.length >= 3) {
        const pointString = transformedPoints.map(p => `${p.x},${p.y}`).join(' ');
        
        // Handle cutouts
        if (measurement.cutouts && measurement.cutouts.length > 0) {
          const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
          
          measurement.cutouts.forEach((cutout) => {
            if (cutout.pdfCoordinates && cutout.pdfCoordinates.length >= 3) {
              const cutoutPoints = cutout.pdfCoordinates.map(p => 
                transformCoordinates(p, viewport, rotation)
              );
              const cutoutPointString = cutoutPoints.map(p => `${p.x},${p.y}`).join(' ');
              pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
            }
          });
          
          compoundPath.setAttribute('d', pathData);
          compoundPath.setAttribute('fill-rule', 'evenodd');
          compoundPath.setAttribute('fill', strokeColor + '40');
          compoundPath.setAttribute('stroke', strokeColor);
          compoundPath.setAttribute('stroke-width', strokeWidth);
          svg.appendChild(compoundPath);
        } else {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute('points', pointString);
          polygon.setAttribute('fill', strokeColor + '40');
          polygon.setAttribute('stroke', strokeColor);
          polygon.setAttribute('stroke-width', strokeWidth);
          svg.appendChild(polygon);
        }
        
        // Draw dots
        transformedPoints.forEach(point => {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', point.x.toString());
          circle.setAttribute('cy', point.y.toString());
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', strokeColor);
          svg.appendChild(circle);
        });
        
        // Add text
        const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
        const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', centerX.toString());
        text.setAttribute('y', centerY.toString());
        text.setAttribute('fill', strokeColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        
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
        text.textContent = finalDisplayValue;
        svg.appendChild(text);
      }
      break;
      
    case 'count':
      if (transformedPoints.length >= 1) {
        const point = transformedPoints[0];
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', strokeColor);
        circle.setAttribute('stroke', '#ffffff');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        
        // Add count text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', point.x.toString());
        text.setAttribute('y', (point.y + 4).toString());
        text.setAttribute('fill', '#ffffff');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        
        const countValue = measurement.calculatedValue >= 1 
          ? Math.round(measurement.calculatedValue).toString()
          : '1';
        text.textContent = countValue;
        svg.appendChild(text);
      }
      break;
  }
}

/**
 * Render an annotation to SVG element
 */
function renderAnnotationToSVG(
  svg: SVGSVGElement,
  annotation: Annotation,
  viewport: { width: number; height: number },
  rotation: number
): void {
  if (!annotation.points || annotation.points.length === 0) return;
  
  const points = annotation.points.map(p => 
    transformCoordinates(p, viewport, rotation)
  );
  
  const strokeColor = annotation.color || '#ff0000';
  const strokeWidth = '3';
  
  if (annotation.type === 'text' && annotation.text) {
    const point = points[0];
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', point.x.toString());
    text.setAttribute('y', point.y.toString());
    text.setAttribute('fill', strokeColor);
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', 'bold');
    text.textContent = annotation.text;
    svg.appendChild(text);
  } else if (annotation.type === 'arrow' && points.length === 2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', points[0].x.toString());
    line.setAttribute('y1', points[0].y.toString());
    line.setAttribute('x2', points[1].x.toString());
    line.setAttribute('y2', points[1].y.toString());
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(line);
    
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
    
    const arrowLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    arrowLine1.setAttribute('x1', points[1].x.toString());
    arrowLine1.setAttribute('y1', points[1].y.toString());
    arrowLine1.setAttribute('x2', arrowPoint1.x.toString());
    arrowLine1.setAttribute('y2', arrowPoint1.y.toString());
    arrowLine1.setAttribute('stroke', strokeColor);
    arrowLine1.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(arrowLine1);
    
    const arrowLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    arrowLine2.setAttribute('x1', points[1].x.toString());
    arrowLine2.setAttribute('y1', points[1].y.toString());
    arrowLine2.setAttribute('x2', arrowPoint2.x.toString());
    arrowLine2.setAttribute('y2', arrowPoint2.y.toString());
    arrowLine2.setAttribute('stroke', strokeColor);
    arrowLine2.setAttribute('stroke-width', strokeWidth);
    svg.appendChild(arrowLine2);
  } else if (annotation.type === 'rectangle' && points.length === 2) {
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const width = Math.abs(points[1].x - points[0].x);
    const height = Math.abs(points[1].y - points[0].y);
    
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', y.toString());
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', height.toString());
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', strokeWidth);
    rect.setAttribute('fill', 'none');
    svg.appendChild(rect);
  } else if (annotation.type === 'circle' && points.length === 2) {
    const cx = (points[0].x + points[1].x) / 2;
    const cy = (points[0].y + points[1].y) / 2;
    const rx = Math.abs(points[1].x - points[0].x) / 2;
    const ry = Math.abs(points[1].y - points[0].y) / 2;
    
    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', cx.toString());
    ellipse.setAttribute('cy', cy.toString());
    ellipse.setAttribute('rx', rx.toString());
    ellipse.setAttribute('ry', ry.toString());
    ellipse.setAttribute('stroke', strokeColor);
    ellipse.setAttribute('stroke-width', strokeWidth);
    ellipse.setAttribute('fill', 'none');
    svg.appendChild(ellipse);
  } else if (annotation.type === 'freehand' && points.length >= 2) {
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const pointString = points.map(p => `${p.x},${p.y}`).join(' ');
    polyline.setAttribute('points', pointString);
    polyline.setAttribute('stroke', strokeColor);
    polyline.setAttribute('stroke-width', strokeWidth);
    polyline.setAttribute('fill', 'none');
    svg.appendChild(polyline);
  }
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
  
  // Parse hex color to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  };
  
  const rgb = hexToRgb(strokeColor);
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.lineWidth = 2;
  
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
        // Draw polygon with fill
        ctx.beginPath();
        ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
        for (let i = 1; i < transformedPoints.length; i++) {
          ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
        }
        ctx.closePath();
        
        // Fill with opacity
        ctx.globalAlpha = 0.25;
        ctx.fill();
        ctx.globalAlpha = 1.0;
        
        // Draw outline
        ctx.stroke();
        
        // Draw dots
        transformedPoints.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
          ctx.fill();
        });
        
        // Handle cutouts
        if (measurement.cutouts && measurement.cutouts.length > 0) {
          ctx.strokeStyle = 'rgb(255, 0, 0)';
          ctx.fillStyle = 'rgb(255, 0, 0)';
          measurement.cutouts.forEach((cutout) => {
            if (cutout.pdfCoordinates && cutout.pdfCoordinates.length >= 3) {
              const cutoutPoints = cutout.pdfCoordinates.map(p => 
                transformCoordinates(p, viewport, rotation)
              );
              ctx.beginPath();
              ctx.moveTo(cutoutPoints[0].x, cutoutPoints[0].y);
              for (let i = 1; i < cutoutPoints.length; i++) {
                ctx.lineTo(cutoutPoints[i].x, cutoutPoints[i].y);
              }
              ctx.closePath();
              ctx.stroke();
              
              cutoutPoints.forEach(point => {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
                ctx.fill();
              });
            }
          });
          // Reset color
          ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        }
        
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
  
  // Parse hex color to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 255, g: 0, b: 0 };
  };
  
  const rgb = hexToRgb(strokeColor);
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
        const sourcePdf = await PDFDocument.load(pdfBytes);

        // Process each page
        for (const pageMeasurement of pages) {
          const pageIndex = pageMeasurement.pageNumber - 1; // Convert to 0-based index

          // Get document rotation if available
          const documentRotation = documentRotations?.get(sheetId) || 0;
          
          // Clone bytes for pdf.js rendering to avoid ArrayBuffer detachment issues
          // pdf.js transfers the ArrayBuffer to a worker, which detaches it
          // Creating a new Uint8Array creates a copy with a new underlying ArrayBuffer
          const pdfBytesForRender = new Uint8Array(pdfBytes);
          
          // Render page with markups to canvas at scale 1.0
          // Use the canvas dimensions directly to ensure perfect aspect ratio match
          const { imageData, width, height } = await renderPageWithMarkupsToCanvas(
            pdfBytesForRender,
            pageMeasurement.pageNumber,
            pageMeasurement.measurements,
            pageMeasurement.annotations || [],
            documentRotation,
            1.0 // Use scale 1.0 to match PDF page dimensions
          );
          
          // Embed the rendered image as a new page
          // Use canvas dimensions directly to ensure aspect ratio matches exactly
          const pngImage = await outputPdf.embedPng(imageData);
          const addedPage = outputPdf.addPage([width, height]);
          
          // Draw the image to fill the page exactly (dimensions match canvas)
          addedPage.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
          });

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

