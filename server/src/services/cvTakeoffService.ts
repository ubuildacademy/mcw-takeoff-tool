/**
 * CV Takeoff Service
 * 
 * Orchestrates computer vision-based takeoff detection:
 * 1. Converts PDF pages to images
 * 2. Detects boundaries (rooms, walls, doors, windows)
 * 3. Creates conditions and measurements in database
 */

import { boundaryDetectionService, RoomBoundary, WallSegment, DoorWindow } from './boundaryDetectionService';
import { pythonPdfConverter } from './pythonPdfConverter';
import { storage } from '../storage';
import { supabase } from '../supabase';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs-extra';

export interface CVTakeoffOptions {
  detectRooms?: boolean;
  detectWalls?: boolean;
  detectDoors?: boolean;
  detectWindows?: boolean;
  minRoomArea?: number;
  minWallLength?: number;
  roomConditionName?: string;
  wallConditionName?: string;
  doorConditionName?: string;
  windowConditionName?: string;
}

export interface CVTakeoffResult {
  success: boolean;
  conditionsCreated: number;
  measurementsCreated: number;
  roomsDetected: number;
  wallsDetected: number;
  doorsDetected: number;
  windowsDetected: number;
  errors: string[];
  processingTime: number;
}

export interface PageDetectionResult {
  pageNumber: number;
  rooms: RoomBoundary[];
  walls: WallSegment[];
  doors: DoorWindow[];
  windows: DoorWindow[];
  conditionsCreated: number;
  measurementsCreated: number;
}

class CVTakeoffService {
  /**
   * Transform normalized coordinates from image space to PDF viewport space
   * 
   * @param imageCoords Normalized coordinates (0-1) relative to image dimensions
   * @param imageWidth Image width in pixels (scaled)
   * @param imageHeight Image height in pixels (scaled)
   * @param pdfWidth Base PDF page width in points (at scale 1.0)
   * @param pdfHeight Base PDF page height in points (at scale 1.0)
   * @returns Normalized coordinates (0-1) relative to PDF viewport
   */
  private transformImageCoordsToPdfCoords(
    imageCoords: { x: number; y: number },
    imageWidth: number,
    imageHeight: number,
    pdfWidth: number,
    pdfHeight: number
  ): { x: number; y: number } {
    // Image coordinates are normalized (0-1) relative to image dimensions
    // PDF coordinates should be normalized (0-1) relative to PDF viewport dimensions
    
    // If image and PDF have same aspect ratio, coordinates map 1:1
    // Otherwise, we need to account for aspect ratio differences
    const imageAspect = imageWidth / imageHeight;
    const pdfAspect = pdfWidth / pdfHeight;
    
    // For now, assume 1:1 mapping since PyMuPDF should preserve aspect ratio
    // The image is just scaled, so normalized coordinates should match
    // However, we validate this assumption with logging
    if (Math.abs(imageAspect - pdfAspect) > 0.01) {
      console.warn(`⚠️ Aspect ratio mismatch: image ${imageAspect.toFixed(3)} vs PDF ${pdfAspect.toFixed(3)}`);
    }
    
    // Direct 1:1 mapping (normalized coordinates are scale-independent)
    return {
      x: imageCoords.x,
      y: imageCoords.y
    };
  }

  /**
   * Adjust scale factor to account for image rendering scale
   * 
   * @param scaleFactor Original scale factor (pixels to feet at PDF viewport scale)
   * @param imageScale Image rendering scale (e.g., 2.0 for 2x)
   * @returns Adjusted scale factor for image pixel measurements
   */
  private adjustScaleFactorForImage(scaleFactor: number, imageScale: number): number {
    // The scaleFactor is calibrated for PDF viewport coordinates
    // But the image is rendered at imageScale (e.g., 2x)
    // So 1 pixel in the image = (1/imageScale) pixels in PDF viewport
    // Therefore, scaleFactor needs to be divided by imageScale
    return scaleFactor / imageScale;
  }

  /**
   * Process a single page for CV takeoff
   */
  async processPage(
    documentId: string,
    pageNumber: number,
    projectId: string,
    scaleFactor: number,
    options: CVTakeoffOptions = {}
  ): Promise<PageDetectionResult> {
    let pdfPath: string | null = null;
    
    try {
      console.log(`🔍 Processing page ${pageNumber} for CV takeoff`);

      // Validate scale factor
      if (!scaleFactor || scaleFactor <= 0) {
        console.warn(`⚠️ Invalid scale factor: ${scaleFactor}, using default 0.0833 (1 inch = 1 foot)`);
        scaleFactor = 0.0833;
      }

      // Get PDF file path (downloads from Supabase Storage to temp file)
      pdfPath = await this.getPDFFilePath(documentId, projectId);
      if (!pdfPath) {
        throw new Error(`PDF file not found for document ${documentId}`);
      }

      // Validate PDF file exists and has content
      if (!await fs.pathExists(pdfPath)) {
        throw new Error(`PDF file does not exist at path: ${pdfPath}`);
      }
      
      const pdfStats = await fs.stat(pdfPath);
      if (pdfStats.size === 0) {
        throw new Error(`PDF file is empty (0 bytes) at path: ${pdfPath}`);
      }
      
      console.log(`📄 PDF file validated: ${pdfPath} (${pdfStats.size} bytes)`);

      // Convert PDF page to image using Python/PyMuPDF with metadata
      console.log(`🖼️ Converting page ${pageNumber} to image...`);
      // Reduced scale to 1.5 to prevent memory issues on Railway free tier
      // Scale 2.0 creates 6048x4320px images which can use 200-400MB+ memory
      // Scale 1.5 creates ~4500x3200px images, using ~150-250MB memory (more manageable)
      const IMAGE_SCALE = 1.5; // Reduced from 2.0 to prevent SIGTERM (memory limit) on Railway
      let conversionMetadata: { buffer: Buffer; pdfWidth: number; pdfHeight: number; imageWidth: number; imageHeight: number; imageScale: number } | null = null;
      
      try {
        conversionMetadata = await pythonPdfConverter.convertPageToBufferWithMetadata(pdfPath, pageNumber, {
          format: 'png',
          scale: IMAGE_SCALE, // Reduced scale to prevent memory issues
          quality: 85 // Slightly reduced quality to save memory
        });
      } catch (conversionError) {
        // Provide detailed error information
        const pdfExists = await fs.pathExists(pdfPath);
        const pdfSize = pdfExists ? (await fs.stat(pdfPath)).size : 0;
        const errorMessage = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        console.error(`❌ PDF conversion error:`, conversionError);
        throw new Error(
          `Failed to convert page ${pageNumber} to image. ` +
          `PDF path: ${pdfPath}, PDF exists: ${pdfExists}, PDF size: ${pdfSize} bytes. ` +
          `Error: ${errorMessage}. ` +
          `This usually means PyMuPDF failed to convert the PDF page. ` +
          `Please check server logs for Python/PyMuPDF availability.`
        );
      }

      if (!conversionMetadata || !conversionMetadata.buffer || conversionMetadata.buffer.length === 0) {
        // Provide more detailed error information
        const pdfExists = await fs.pathExists(pdfPath);
        const pdfSize = pdfExists ? (await fs.stat(pdfPath)).size : 0;
        throw new Error(
          `Failed to convert page ${pageNumber} to image - empty buffer returned. ` +
          `PDF path: ${pdfPath}, PDF exists: ${pdfExists}, PDF size: ${pdfSize} bytes. ` +
          `PyMuPDF returned null/empty buffer. ` +
          `Please check server logs for Python/PyMuPDF errors.`
        );
      }
      
      const { buffer: imageBuffer, pdfWidth, pdfHeight, imageWidth, imageHeight, imageScale } = conversionMetadata;
      
      console.log(`✅ Image conversion successful: ${imageBuffer.length} bytes`);
      console.log(`📐 Dimensions: Image ${imageWidth}x${imageHeight}px (scale ${imageScale}), PDF base ${pdfWidth}x${pdfHeight}pt`);
      
      // Adjust scale factor for image rendering scale
      // The scaleFactor is calibrated for PDF viewport, but detection uses scaled image
      const adjustedScaleFactor = this.adjustScaleFactorForImage(scaleFactor, imageScale);
      console.log(`📏 Scale factors: Original ${scaleFactor.toFixed(6)} ft/pixel (PDF), Adjusted ${adjustedScaleFactor.toFixed(6)} ft/pixel (image)`);

      // Convert to base64
      const imageData = imageBuffer.toString('base64');

      // Detect boundaries using CV with adjusted scale factor
      const detectionResult = await boundaryDetectionService.detectBoundaries(
        imageData,
        adjustedScaleFactor, // Use adjusted scale factor for image pixel measurements
        {
          minRoomArea: options.minRoomArea || 50,
          minWallLength: options.minWallLength || 2
        }
      );

      console.log(`✅ Detection complete: ${detectionResult.rooms.length} rooms, ${detectionResult.walls.length} walls, ${detectionResult.doors.length} doors, ${detectionResult.windows.length} windows`);
      console.log(`✅ OCR found ${detectionResult.ocrText.length} text elements`);

      // Match OCR room labels with detected room contours
      // OCR is now done in Python with precise coordinates
      const roomLabels = detectionResult.ocrText
        .filter(text => text.type === 'room_label')
        .map(text => ({
          name: text.text,
          bbox: text.bbox,
          confidence: text.confidence
        }));

      if (roomLabels.length > 0 && detectionResult.rooms.length > 0) {
        console.log(`🔗 Matching ${roomLabels.length} room labels with ${detectionResult.rooms.length} detected rooms...`);
        const matchedRooms = this.matchRoomLabelsToContours(
          detectionResult.rooms,
          roomLabels,
          detectionResult.imageWidth,
          detectionResult.imageHeight
        );
        detectionResult.rooms = matchedRooms;
        console.log(`✅ Matched ${matchedRooms.filter(r => r.roomLabel).length} rooms with labels`);
      }

      // Create conditions and measurements
      let conditionsCreated = 0;
      let measurementsCreated = 0;

      // Process rooms
      if (options.detectRooms === true && detectionResult.rooms.length > 0) {
        const { conditions, measurements } = await this.createRoomMeasurements(
          detectionResult.rooms,
          projectId,
          documentId,
          pageNumber,
          options.roomConditionName || 'Rooms',
          imageWidth,
          imageHeight,
          pdfWidth,
          pdfHeight
        );
        conditionsCreated += conditions;
        measurementsCreated += measurements;
      }

      // Process walls
      if (options.detectWalls === true && detectionResult.walls.length > 0) {
        const { conditions, measurements } = await this.createWallMeasurements(
          detectionResult.walls,
          projectId,
          documentId,
          pageNumber,
          options.wallConditionName || 'Walls',
          imageWidth,
          imageHeight,
          pdfWidth,
          pdfHeight
        );
        conditionsCreated += conditions;
        measurementsCreated += measurements;
      }

      // Process doors
      if (options.detectDoors === true && detectionResult.doors.length > 0) {
        const { conditions, measurements } = await this.createDoorWindowMeasurements(
          detectionResult.doors,
          projectId,
          documentId,
          pageNumber,
          options.doorConditionName || 'Doors',
          'door',
          imageWidth,
          imageHeight,
          pdfWidth,
          pdfHeight
        );
        conditionsCreated += conditions;
        measurementsCreated += measurements;
      }

      // Process windows
      if (options.detectWindows === true && detectionResult.windows.length > 0) {
        const { conditions, measurements } = await this.createDoorWindowMeasurements(
          detectionResult.windows,
          projectId,
          documentId,
          pageNumber,
          options.windowConditionName || 'Windows',
          'window',
          imageWidth,
          imageHeight,
          pdfWidth,
          pdfHeight
        );
        conditionsCreated += conditions;
        measurementsCreated += measurements;
      }

      return {
        pageNumber,
        rooms: detectionResult.rooms,
        walls: detectionResult.walls,
        doors: detectionResult.doors,
        windows: detectionResult.windows,
        conditionsCreated,
        measurementsCreated
      };

    } catch (error) {
      // Ensure error is properly formatted before throwing
      let errorMessage: string;
      let errorStack: string | undefined;
      
      if (error instanceof Error) {
        errorMessage = error.message || String(error) || 'Unknown error occurred during CV takeoff processing';
        errorStack = error.stack;
        // If the message is "[object Object]", try to extract more details
        if (errorMessage === '[object Object]' || errorMessage.includes('[object Object]')) {
          try {
            const errorObj = error as any;
            errorMessage = errorObj.message || errorObj.error || JSON.stringify(errorObj, Object.getOwnPropertyNames(errorObj)) || 'Unknown error';
          } catch {
            errorMessage = 'Unknown error occurred during CV takeoff processing';
          }
        }
        console.error(`❌ Error processing page ${pageNumber}:`, errorMessage);
        if (errorStack) {
          console.error(`❌ Error stack:`, errorStack);
        }
        // Create a new error with the properly formatted message
        const formattedError = new Error(errorMessage);
        formattedError.stack = errorStack;
        throw formattedError;
      } else if (error && typeof error === 'object') {
        // Try to extract meaningful error information from object
        try {
          const errorObj = error as any;
          errorMessage = errorObj.message || errorObj.error || errorObj.toString() || JSON.stringify(errorObj);
          errorStack = errorObj.stack;
        } catch {
          errorMessage = 'Unknown error occurred during CV takeoff processing';
        }
        console.error(`❌ Error processing page ${pageNumber}:`, errorMessage);
        const formattedError = new Error(errorMessage);
        if (errorStack) {
          formattedError.stack = errorStack;
        }
        throw formattedError;
      } else {
        errorMessage = String(error) || 'Unknown error occurred during CV takeoff processing';
        console.error(`❌ Error processing page ${pageNumber}:`, errorMessage);
        throw new Error(errorMessage);
      }
    } finally {
      // Always clean up the temporary PDF file
      if (pdfPath) {
        try {
          if (await fs.pathExists(pdfPath)) {
            await fs.remove(pdfPath);
            console.log(`🧹 Cleaned up temp PDF file: ${pdfPath}`);
          }
        } catch (cleanupError) {
          console.error(`⚠️ Error cleaning up temp PDF file: ${pdfPath}`, cleanupError);
        }
      }
    }
  }

  /**
   * Process multiple pages
   */
  async processPages(
    documentId: string,
    pageNumbers: number[],
    projectId: string,
    scaleFactor: number,
    options: CVTakeoffOptions = {}
  ): Promise<CVTakeoffResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let conditionsCreated = 0;
    let measurementsCreated = 0;
    let roomsDetected = 0;
    let wallsDetected = 0;
    let doorsDetected = 0;
    let windowsDetected = 0;

    for (const pageNumber of pageNumbers) {
      try {
        const result = await this.processPage(documentId, pageNumber, projectId, scaleFactor, options);
        conditionsCreated += result.conditionsCreated;
        measurementsCreated += result.measurementsCreated;
        roomsDetected += result.rooms.length;
        wallsDetected += result.walls.length;
        doorsDetected += result.doors.length;
        windowsDetected += result.windows.length;
      } catch (error) {
        const errorMsg = `Page ${pageNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
      }
    }

    const processingTime = Date.now() - startTime;

    return {
      success: errors.length === 0,
      conditionsCreated,
      measurementsCreated,
      roomsDetected,
      wallsDetected,
      doorsDetected,
      windowsDetected,
      errors,
      processingTime
    };
  }

  /**
   * Create room measurements from detected boundaries
   */
  private async createRoomMeasurements(
    rooms: RoomBoundary[],
    projectId: string,
    documentId: string,
    pageNumber: number,
    conditionName: string,
    imageWidth: number,
    imageHeight: number,
    pdfWidth: number,
    pdfHeight: number
  ): Promise<{ conditions: number; measurements: number }> {
    // Group rooms by label if available, or use default condition name
    const roomsByLabel = new Map<string, RoomBoundary[]>();
    
    for (const room of rooms) {
      const label = room.roomLabel || conditionName;
      if (!roomsByLabel.has(label)) {
        roomsByLabel.set(label, []);
      }
      roomsByLabel.get(label)!.push(room);
    }

    let totalConditionsCreated = 0;
    let totalMeasurementsCreated = 0;

    // Create a condition for each unique room label (or use default)
    for (const [label, labeledRooms] of roomsByLabel) {
      // Use room label as condition name if available, otherwise use default
      const conditionNameToUse = label !== conditionName ? `${conditionName} - ${label}` : conditionName;
      
      // Check if condition already exists
      let condition = await this.findOrCreateCondition(
        projectId,
        conditionNameToUse,
        'area',
        'SF',
        '#4CAF50' // Green for rooms
      );

      // Create measurements for each room in this group
      for (const room of labeledRooms) {
        // Transform normalized coordinates from image space to PDF viewport space
        const pdfCoordinates = room.points.map(point => 
          this.transformImageCoordsToPdfCoords(
            point,
            imageWidth,
            imageHeight,
            pdfWidth,
            pdfHeight
          )
        );

        // Log coordinate transformation for debugging
        if (labeledRooms.indexOf(room) === 0) {
          console.log(`🔍 Room coordinate transformation example:`);
          console.log(`   Image coords (first point): x=${room.points[0].x.toFixed(4)}, y=${room.points[0].y.toFixed(4)}`);
          console.log(`   PDF coords (first point): x=${pdfCoordinates[0].x.toFixed(4)}, y=${pdfCoordinates[0].y.toFixed(4)}`);
        }

        // Create measurement with room label if available
        const measurement = {
          id: uuidv4(),
          projectId,
          sheetId: documentId,
          conditionId: condition.id,
          type: 'area' as const,
          points: pdfCoordinates,
          calculatedValue: room.area,
          unit: 'SF',
          timestamp: Date.now().toString(),
          pdfPage: pageNumber,
          pdfCoordinates,
          conditionColor: condition.color,
          conditionName: condition.name,
          perimeterValue: room.perimeter
        };

        await storage.saveTakeoffMeasurement(measurement);
      }

      totalConditionsCreated += condition.wasCreated ? 1 : 0;
      totalMeasurementsCreated += labeledRooms.length;
    }

    return {
      conditions: totalConditionsCreated,
      measurements: totalMeasurementsCreated
    };
  }

  /**
   * Create wall measurements from detected segments
   */
  private async createWallMeasurements(
    walls: WallSegment[],
    projectId: string,
    documentId: string,
    pageNumber: number,
    conditionName: string,
    imageWidth: number,
    imageHeight: number,
    pdfWidth: number,
    pdfHeight: number
  ): Promise<{ conditions: number; measurements: number }> {
    // Check if condition already exists
    let condition = await this.findOrCreateCondition(
      projectId,
      conditionName,
      'linear',
      'LF',
      '#2196F3' // Blue for walls
    );

    // Batch create measurements for better performance
    const measurements = walls.map((wall, index) => {
      // Transform normalized coordinates from image space to PDF viewport space
      const startPdf = this.transformImageCoordsToPdfCoords(
        wall.start,
        imageWidth,
        imageHeight,
        pdfWidth,
        pdfHeight
      );
      const endPdf = this.transformImageCoordsToPdfCoords(
        wall.end,
        imageWidth,
        imageHeight,
        pdfWidth,
        pdfHeight
      );
      
      const pdfCoordinates = [startPdf, endPdf];

      // Log coordinate transformation for debugging (first wall only)
      if (index === 0) {
        console.log(`🔍 Wall coordinate transformation example:`);
        console.log(`   Image coords: start=(${wall.start.x.toFixed(4)}, ${wall.start.y.toFixed(4)}), end=(${wall.end.x.toFixed(4)}, ${wall.end.y.toFixed(4)})`);
        console.log(`   PDF coords: start=(${startPdf.x.toFixed(4)}, ${startPdf.y.toFixed(4)}), end=(${endPdf.x.toFixed(4)}, ${endPdf.y.toFixed(4)})`);
      }

      return {
        id: uuidv4(),
        projectId,
        sheetId: documentId,
        conditionId: condition.id,
        type: 'linear' as const,
        points: pdfCoordinates,
        calculatedValue: wall.length,
        unit: 'LF',
        timestamp: Date.now().toString(),
        pdfPage: pageNumber,
        pdfCoordinates,
        conditionColor: condition.color,
        conditionName: condition.name
      };
    });

    // Use batch save for better performance and to avoid database timeouts
    await storage.saveTakeoffMeasurementsBatch(measurements);

    return {
      conditions: condition.wasCreated ? 1 : 0,
      measurements: walls.length
    };
  }

  /**
   * Create door/window measurements (count type)
   */
  private async createDoorWindowMeasurements(
    items: DoorWindow[],
    projectId: string,
    documentId: string,
    pageNumber: number,
    conditionName: string,
    type: 'door' | 'window',
    imageWidth: number,
    imageHeight: number,
    pdfWidth: number,
    pdfHeight: number
  ): Promise<{ conditions: number; measurements: number }> {
    // Check if condition already exists
    let condition = await this.findOrCreateCondition(
      projectId,
      conditionName,
      'count',
      'EA',
      type === 'door' ? '#FF9800' : '#9C27B0' // Orange for doors, Purple for windows
    );

    // Create count measurements
    // For count type, we can either:
    // 1. Create one measurement with count value
    // 2. Create individual measurements for each item
    
    // Option 2: Individual measurements (more detailed)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Use bbox center as measurement point (normalized coordinates from image)
      const centerImage = {
        x: item.bbox.x + item.bbox.width / 2,
        y: item.bbox.y + item.bbox.height / 2
      };
      
      // Transform to PDF coordinates
      const centerPdf = this.transformImageCoordsToPdfCoords(
        centerImage,
        imageWidth,
        imageHeight,
        pdfWidth,
        pdfHeight
      );

      // Log coordinate transformation for debugging (first item only)
      if (i === 0) {
        console.log(`🔍 ${type} coordinate transformation example:`);
        console.log(`   Image coords (center): x=${centerImage.x.toFixed(4)}, y=${centerImage.y.toFixed(4)}`);
        console.log(`   PDF coords (center): x=${centerPdf.x.toFixed(4)}, y=${centerPdf.y.toFixed(4)}`);
      }

      const measurement = {
        id: uuidv4(),
        projectId,
        sheetId: documentId,
        conditionId: condition.id,
        type: 'count' as const,
        points: [centerPdf],
        calculatedValue: 1, // Each item counts as 1
        unit: 'EA',
        timestamp: Date.now().toString(),
        pdfPage: pageNumber,
        pdfCoordinates: [centerPdf],
        conditionColor: condition.color,
        conditionName: condition.name
      };

      await storage.saveTakeoffMeasurement(measurement);
    }

    return {
      conditions: condition.wasCreated ? 1 : 0,
      measurements: items.length
    };
  }

  /**
   * Match OCR-detected room labels with CV-detected room contours
   * Room labels are typically placed outside the room, pointing inward
   */
  private matchRoomLabelsToContours(
    rooms: RoomBoundary[],
    roomLabels: Array<{ name: string; bbox: { x: number; y: number; width: number; height: number }; confidence: number }>,
    imageWidth: number,
    imageHeight: number
  ): RoomBoundary[] {
    if (roomLabels.length === 0) {
      return rooms;
    }

    // Convert normalized coordinates to pixel coordinates for matching
    const labelCenters = roomLabels.map(label => ({
      name: label.name,
      x: (label.bbox.x + label.bbox.width / 2) * imageWidth,
      y: (label.bbox.y + label.bbox.height / 2) * imageHeight,
      confidence: label.confidence
    }));

    // For each room contour, find the nearest label
    const matchedRooms = rooms.map(room => {
      // Calculate room center (centroid of points)
      const roomPoints = room.points.map(p => ({
        x: p.x * imageWidth,
        y: p.y * imageHeight
      }));

      // Calculate centroid
      const centroidX = roomPoints.reduce((sum, p) => sum + p.x, 0) / roomPoints.length;
      const centroidY = roomPoints.reduce((sum, p) => sum + p.y, 0) / roomPoints.length;

      // Find nearest label (within reasonable distance)
      let nearestLabel: { name: string; distance: number; confidence: number } | null = null;
      const MAX_DISTANCE = Math.min(imageWidth, imageHeight) * 0.15; // 15% of image dimension

      for (const label of labelCenters) {
        const distance = Math.sqrt(
          Math.pow(centroidX - label.x, 2) + Math.pow(centroidY - label.y, 2)
        );

        if (distance < MAX_DISTANCE) {
          if (!nearestLabel || distance < nearestLabel.distance) {
            nearestLabel = {
              name: label.name,
              distance,
              confidence: label.confidence
            };
          }
        }
      }

      // Also check if label is near any point on the room boundary
      // (labels are often placed just outside the room)
      if (!nearestLabel) {
        for (const label of labelCenters) {
          for (const point of roomPoints) {
            const distance = Math.sqrt(
              Math.pow(point.x - label.x, 2) + Math.pow(point.y - label.y, 2)
            );

            if (distance < MAX_DISTANCE) {
              if (!nearestLabel || distance < nearestLabel.distance) {
                nearestLabel = {
                  name: label.name,
                  distance,
                  confidence: label.confidence
                };
              }
            }
          }
        }
      }

      // If we found a matching label, add it to the room
      if (nearestLabel) {
        return {
          ...room,
          roomLabel: nearestLabel.name,
          confidence: Math.min(0.95, room.confidence + 0.1) // Boost confidence for labeled rooms
        };
      }

      return room;
    });

    return matchedRooms;
  }

  /**
   * Find existing condition or create new one
   * Returns the condition info and whether it was newly created
   */
  private async findOrCreateCondition(
    projectId: string,
    name: string,
    type: 'area' | 'linear' | 'count',
    unit: string,
    color: string
  ): Promise<{ id: string; name: string; color: string; wasCreated: boolean }> {
    // Check if condition exists
    const conditions = await storage.getConditionsByProject(projectId);
    const existing = conditions.find(c => c.name === name && c.type === type);

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        color: existing.color,
        wasCreated: false
      };
    }

    // Create new condition
    // Note: aiGenerated is not included as the column may not exist in all database schemas
    // The storage service will handle this conditionally
    const condition = {
      id: uuidv4(),
      projectId,
      name,
      type,
      unit,
      wasteFactor: 0,
      color,
      description: `CV-detected ${type} condition`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await storage.saveCondition(condition);

    return {
      id: condition.id,
      name: condition.name,
      color: condition.color,
      wasCreated: true
    };
  }

  /**
   * Get PDF file path for a document
   */
  private async getPDFFilePath(documentId: string, projectId: string): Promise<string | null> {
    try {
      const files = await storage.getFilesByProject(projectId);
      const file = files.find(f => f.id === documentId);

      if (!file || file.mimetype !== 'application/pdf') {
        return null;
      }

      // Download PDF from Supabase Storage
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(file.path);

      if (error || !data) {
        console.error(`Error downloading PDF:`, error);
        return null;
      }

      // Save to temporary file
      // Use /tmp on Railway/production, or local temp directory in development
      const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
      let baseTempDir: string;
      
      if (isProduction) {
        baseTempDir = '/tmp/pdf-processing';
      } else {
        // In dev, check if cwd is server/ or repo root
        const cwd = process.cwd();
        if (cwd.endsWith('server') || cwd.endsWith('server/')) {
          baseTempDir = path.join(cwd, 'temp', 'pdf-processing');
        } else {
          baseTempDir = path.join(cwd, 'server', 'temp', 'pdf-processing');
        }
      }
      
      await fs.ensureDir(baseTempDir);
      const tempPath = path.join(baseTempDir, `${documentId}.pdf`);
      
      console.log(`📥 Downloading PDF to: ${tempPath}`);
      console.log(`📥 PDF file exists in storage: ${file ? 'yes' : 'no'}`);
      console.log(`📥 Storage path: ${file?.path}`);

      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

      return tempPath;
    } catch (error) {
      console.error(`Error getting PDF file path:`, error);
      return null;
    }
  }

  /**
   * Check if CV takeoff service is available
   */
  async isAvailable(): Promise<boolean> {
    return await boundaryDetectionService.isAvailable();
  }

  /**
   * Get detailed status information
   */
  async getStatusDetails(): Promise<{
    pythonAvailable: boolean;
    opencvAvailable: boolean;
    pythonVersion?: string;
    opencvVersion?: string;
    error?: string;
  }> {
    return await boundaryDetectionService.getStatusDetails();
  }
}

export const cvTakeoffService = new CVTakeoffService();

