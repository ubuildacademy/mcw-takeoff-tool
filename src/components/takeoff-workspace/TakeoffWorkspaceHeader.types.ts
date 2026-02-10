/**
 * Types for TakeoffWorkspace subcomponents.
 */

import type { ProjectFile, Sheet, TakeoffCondition, PDFDocument, SearchResult } from '../../types';

export interface TitleblockExtractionStatus {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  currentDocument?: string;
  processedPages?: number;
  totalPages?: number;
  progress?: number;
  error?: string;
}

export interface LabelingJobStatus {
  status: string;
  currentDocument?: string;
  processedPages?: number;
  totalPages?: number;
  progress: number;
}

export interface OcrJobEntry {
  documentId: string;
  documentName: string;
  progress: number;
  status: string;
  processedPages?: number;
  totalPages?: number;
}

export type AnnotationTool = 'text' | 'arrow' | 'rectangle' | 'circle' | null;

export interface TakeoffWorkspaceHeaderProps {
  onBackToProjects: () => void;
  currentPage: number;
  totalPages: number;
  currentPdfFile: ProjectFile | null;
  onPageChange: (page: number) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onResetView: () => void;
  onRotatePage: (direction: 'clockwise' | 'counterclockwise') => void;
  isPageCalibrated: boolean;
  onCalibrateScale: () => void;
  annotationTool: AnnotationTool;
  annotationColor: string;
  onAnnotationToolChange: (tool: AnnotationTool) => void;
  onAnnotationColorChange: (color: string) => void;
  onClearAnnotations: () => void;
  isOrthoSnapping: boolean;
  isMeasuring: boolean;
  isCalibrating: boolean;
  measurementType: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export interface TakeoffWorkspaceStatusBarProps {
  selectedSheet: Sheet | null;
  currentProject: { name: string; client?: string; lastSaved?: string };
  selectedCondition: TakeoffCondition | null;
  exportStatus: { type: 'excel' | 'pdf' | null; progress: number };
  titleblockExtractionStatus: TitleblockExtractionStatus | null;
  labelingJob: LabelingJobStatus | null;
  ocrJobs: Map<string, OcrJobEntry>;
  uploading: boolean;
  isMeasuring: boolean;
  isCalibrating: boolean;
  measurementType: string;
}

export type RightSidebarTab = 'documents' | 'search' | 'ai-chat';

export interface TakeoffWorkspaceRightSidebarProps {
  rightSidebarOpen: boolean;
  onRightSidebarOpenChange: (open: boolean) => void;
  rightSidebarTab: RightSidebarTab;
  onRightSidebarTabChange: (tab: RightSidebarTab) => void;
  projectId: string;
  documents: PDFDocument[];
  documentsLoading: boolean;
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId: string | undefined;
  selectedPageNumber: number | undefined;
  onOCRRequest: (documentId: string, pageNumbers?: number[]) => void;
  onOcrSearchResults: (results: SearchResult[], query: string) => void;
  onDocumentsUpdate: (documents: PDFDocument[]) => void;
  onReloadDocuments: () => void;
  onPdfUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
  onLabelingJobUpdate: (job: LabelingJobStatus | null) => void;
  onExtractTitleblockForDocument: (documentId: string) => void;
  onBulkExtractTitleblock: () => void;
}
