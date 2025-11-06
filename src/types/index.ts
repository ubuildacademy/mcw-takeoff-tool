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
  profitMarginPercent?: number; // Global profit margin percentage (default 15%)
}

export interface TakeoffCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count' | 'visual-search';
  unit: string;
  wasteFactor: number;
  color: string;
  description: string;
  includePerimeter?: boolean; // For area and volume measurements, include perimeter calculation
  depth?: number; // For volume measurements, depth in feet
  materialCost?: number; // Material cost per unit
  equipmentCost?: number; // Fixed equipment cost for the condition
  laborCost?: number; // Labor cost per unit
  aiGenerated?: boolean; // NEW: Flag for AI-generated conditions
  // Visual search specific fields
  searchImage?: string; // Base64 encoded image or image URL
  searchImageId?: string; // Reference to uploaded image file
  searchThreshold?: number; // Confidence threshold for matches (0-1)
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
  description?: string; // Optional description for the measurement
  perimeterValue?: number; // Perimeter in linear feet for area measurements
  cutouts?: Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    pdfCoordinates: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  netCalculatedValue?: number; // calculatedValue - sum of all cutouts
}

export interface Sheet {
  id: string;
  name: string;
  pageNumber: number;
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
  pageNumber?: number | null; // null/undefined = document-level, number = page-specific
  scaleFactor: number;
  unit: string;
  calibratedAt: string;
  scaleText?: string; // Human-readable scale text (e.g., "1 inch = 10 feet")
  viewportWidth?: number | null; // PDF viewport width at scale=1 when calibration was performed
  viewportHeight?: number | null; // PDF viewport height at scale=1 when calibration was performed
  rotation?: number | null; // PDF page rotation (degrees: 0, 90, 180, 270) used during calibration
}

export interface Annotation {
  id: string;
  projectId: string;
  sheetId: string;
  pageNumber: number;
  type: 'text' | 'freehand' | 'arrow' | 'rectangle' | 'circle' | 'highlight';
  points: Array<{ x: number; y: number }>; // PDF coordinates (0-1 scale)
  color: string;
  text?: string; // For text annotations
  timestamp: string;
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
  originalName?: string; // Original filename
  filename?: string; // Stored filename
  size?: number; // File size in bytes
  uploadedAt?: string; // Upload timestamp
  sheets?: Sheet[]; // Associated sheets
  titleblockConfig?: {
    sheetNumberField: { x: number; y: number; width: number; height: number };
    sheetNameField: { x: number; y: number; width: number; height: number };
  };
}

export interface ConditionCostBreakdown {
  condition: TakeoffCondition;
  quantity: number;
  adjustedQuantity: number; // quantity with waste factor applied
  materialCost: number;
  equipmentCost: number;
  wasteCost: number; // additional cost due to waste factor
  subtotal: number;
  hasCosts: boolean;
}

export interface ProjectCostBreakdown {
  conditions: ConditionCostBreakdown[];
  summary: {
    totalMaterialCost: number;
    totalEquipmentCost: number;
    totalWasteCost: number;
    subtotal: number;
    profitMarginPercent: number;
    profitMarginAmount: number;
    totalCost: number;
    conditionsWithCosts: number;
    totalConditions: number;
  };
}

export interface AITakeoffScope {
  scope: string;
  projectId: string;
  documentIds: string[];
}

export interface AIIdentifiedPage {
  documentId: string;
  pageNumber: number;
  confidence: number;
  reason: string;
  selected: boolean;
  pageType?: 'floor-plan' | 'finish-schedule' | 'detail-drawing' | 'elevation' | 'other';
  indicators?: string[];
  relevanceScore?: number;
}

export interface AITakeoffResult {
  pageNumber: number;
  documentId: string;
  conditions: Array<{
    name: string;
    type: 'area' | 'volume' | 'linear' | 'count';
    unit: string;
    description: string;
    color: string;
  }>;
  measurements: Array<{
    conditionIndex: number;
    points: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  calibration?: {
    scaleFactor: number;
    unit: string;
    scaleText?: string; // Human-readable scale text
  };
}

export interface AITakeoffProgress {
  stage: 'identifying' | 'processing' | 'complete' | 'error';
  currentPage: number;
  totalPages: number;
  message: string;
  result?: AITakeoffResult;
  error?: string;
}

export interface VisualSearchMatch {
  id: string;
  pageNumber: number;
  documentId: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pdfCoordinates: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  description?: string;
}

export interface VisualSearchResult {
  conditionId: string;
  matches: VisualSearchMatch[];
  totalMatches: number;
  searchImageId: string;
  processingTime: number;
  threshold: number;
}
