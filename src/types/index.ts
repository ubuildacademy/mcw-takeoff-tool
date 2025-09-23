// Shared type definitions for the Meridian Takeoff application

export interface Project {
  id: string;
  name: string;
  client: string;
  location: string;
  status: string;
  description?: string;
  projectType?: string;
  startDate?: string;
  estimatedValue?: number;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  createdAt: string;
  lastModified: string;
  takeoffCount?: number;
  totalValue?: number;
}

export interface TakeoffCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  unit: string;
  wasteFactor: number;
  color: string;
  description: string;
  includePerimeter?: boolean; // For area measurements, include perimeter calculation
  depth?: number; // For volume measurements, depth in feet
  laborCost?: number; // Labor cost per hour
  materialCost?: number; // Material cost per unit
}

export interface TakeoffMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: string;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>; // 0-1 scale
  conditionColor: string;
  conditionName: string;
  perimeterValue?: number; // Perimeter in linear feet for area measurements
}

export interface Sheet {
  id: string;
  name: string;
  pageNumber: number;
  thumbnail?: string;
  isVisible: boolean;
  hasTakeoffs: boolean;
  takeoffCount: number;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: string;
}

export interface Calibration {
  projectId: string;
  sheetId: string;
  scaleFactor: number;
  unit: string;
  calibratedAt: string;
}

export interface SearchResult {
  documentId: string;
  pageNumber: number;
  matches: Array<{
    text: string;
    context: string;
    confidence: number;
  }>;
}

export interface OCRResult {
  pageNumber: number;
  success: boolean;
  extractedText?: string;
  error?: string;
  processingTime?: number;
}

export interface TitleblockField {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface TitleblockConfig {
  sheetNumberField: TitleblockField;
  sheetNameField: TitleblockField;
}

export interface PDFPage {
  pageNumber: number;
  thumbnail?: string;
  extractedText?: string;
  sheetNumber?: string;
  sheetName?: string;
  hasTakeoffs: boolean;
  takeoffCount: number;
  isVisible: boolean;
  ocrProcessed: boolean;
}

export interface PDFDocument {
  id: string;
  name: string;
  totalPages: number;
  pages: PDFPage[];
  isExpanded: boolean;
  ocrEnabled: boolean;
  titleblockConfig?: {
    sheetNumberField: { x: number; y: number; width: number; height: number };
    sheetNameField: { x: number; y: number; width: number; height: number };
  };
}
