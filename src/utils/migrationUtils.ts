/**
 * Migration utilities for converting from Fabric.js to PDF.js coordinate system
 */

export interface FabricMeasurement {
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
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
}

export interface PDFMeasurement {
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
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
}

/**
 * Convert Fabric.js measurements to PDF.js coordinate system
 * This is a placeholder - in practice, you'd need to handle the coordinate conversion
 * based on your specific Fabric.js implementation
 */
export function migrateFabricMeasurements(fabricMeasurements: FabricMeasurement[]): PDFMeasurement[] {
  return fabricMeasurements.map(measurement => ({
    ...measurement,
    // The points should already be in PDF coordinates if they were stored correctly
    // This migration is mainly for data structure consistency
    points: measurement.pdfCoordinates || measurement.points,
    pdfCoordinates: measurement.pdfCoordinates || measurement.points
  }));
}

/**
 * Check if measurements need migration
 */
export function needsMigration(measurements: any[]): boolean {
  // Check if measurements have the old Fabric.js structure
  return measurements.some(measurement => 
    measurement.fabricObjectId || 
    measurement.fabricCanvasId ||
    !measurement.pdfCoordinates
  );
}

/**
 * Migrate all measurements in localStorage
 */
export function migrateLocalStorageMeasurements(): void {
  try {
    const keys = Object.keys(localStorage);
    const measurementKeys = keys.filter(key => key.startsWith('takeoff_'));
    
    let migratedCount = 0;
    
    measurementKeys.forEach(key => {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        
        if (data.measurements && Array.isArray(data.measurements)) {
          if (needsMigration(data.measurements)) {
            console.log(`Migrating measurements for key: ${key}`);
            data.measurements = migrateFabricMeasurements(data.measurements);
            localStorage.setItem(key, JSON.stringify(data));
            migratedCount++;
          }
        }
      } catch (error) {
        console.warn(`Failed to migrate measurements for key ${key}:`, error);
      }
    });
    
    if (migratedCount > 0) {
      console.log(`Successfully migrated ${migratedCount} measurement sets`);
    } else {
      console.log('No measurements needed migration');
    }
  } catch (error) {
    console.error('Failed to migrate measurements:', error);
  }
}

/**
 * Clear old Fabric.js data
 */
export function cleanupFabricData(): void {
  try {
    const keys = Object.keys(localStorage);
    const fabricKeys = keys.filter(key => 
      key.includes('fabric') || 
      key.includes('canvas') ||
      key.includes('fabricCanvas')
    );
    
    fabricKeys.forEach(key => {
      localStorage.removeItem(key);
      console.log(`Removed old Fabric.js data: ${key}`);
    });
    
    console.log(`Cleaned up ${fabricKeys.length} Fabric.js data entries`);
  } catch (error) {
    console.error('Failed to cleanup Fabric.js data:', error);
  }
}
