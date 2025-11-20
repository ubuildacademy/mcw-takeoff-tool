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
import { enhancedOcrService } from './enhancedOcrService';
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

      // Convert PDF page to image using Python/PyMuPDF
      console.log(`🖼️ Converting page ${pageNumber} to image...`);
      let imageBuffer: Buffer | null;
      try {
        imageBuffer = await pythonPdfConverter.convertPageToBuffer(pdfPath, pageNumber, {
          format: 'png',
          scale: 2.0, // Higher resolution for better detection
          quality: 90
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

      if (!imageBuffer || imageBuffer.length === 0) {
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
      
      console.log(`✅ Image conversion successful: ${imageBuffer.length} bytes`);

      // Convert to base64
      const imageData = imageBuffer.toString('base64');

      // Step 1: Run OCR to get room labels and text context
      console.log(`📝 Running OCR analysis for room labels...`);
      let ocrResult = null;
      let roomLabels: Array<{ name: string; bbox: { x: number; y: number; width: number; height: number }; confidence: number }> = [];
      
      try {
        ocrResult = await enhancedOcrService.analyzeImage(imageData);
        roomLabels = ocrResult.roomNames.map(room => ({
          name: room.name,
          bbox: room.bbox,
          confidence: room.confidence
        }));
        console.log(`✅ OCR found ${roomLabels.length} room labels: ${roomLabels.map(r => r.name).join(', ')}`);
      } catch (ocrError) {
        console.warn(`⚠️ OCR analysis failed, continuing without room labels:`, ocrError instanceof Error ? ocrError.message : 'Unknown error');
        // Continue without OCR - CV detection will still work
      }

      // Step 2: Detect boundaries using CV
      const detectionResult = await boundaryDetectionService.detectBoundaries(
        imageData,
        scaleFactor,
        {
          minRoomArea: options.minRoomArea || 50,
          minWallLength: options.minWallLength || 2
        }
      );

      console.log(`✅ Detection complete: ${detectionResult.rooms.length} rooms, ${detectionResult.walls.length} walls, ${detectionResult.doors.length} doors, ${detectionResult.windows.length} windows`);

      // Step 3: Match OCR room labels with detected room contours
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
          options.roomConditionName || 'Rooms'
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
          options.wallConditionName || 'Walls'
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
          'door'
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
          'window'
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
    conditionName: string
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
        // Convert normalized points to PDF coordinates
        const pdfCoordinates = room.points;

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
    conditionName: string
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
    const measurements = walls.map(wall => {
      // Create linear measurement with start and end points
      const pdfCoordinates = [wall.start, wall.end];

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
    type: 'door' | 'window'
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
    for (const item of items) {
      // Use bbox center as measurement point
      const centerX = item.bbox.x + item.bbox.width / 2;
      const centerY = item.bbox.y + item.bbox.height / 2;

      const measurement = {
        id: uuidv4(),
        projectId,
        sheetId: documentId,
        conditionId: condition.id,
        type: 'count' as const,
        points: [{ x: centerX, y: centerY }],
        calculatedValue: 1, // Each item counts as 1
        unit: 'EA',
        timestamp: Date.now().toString(),
        pdfPage: pageNumber,
        pdfCoordinates: [{ x: centerX, y: centerY }],
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

