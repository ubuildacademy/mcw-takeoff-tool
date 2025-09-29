import { useEffect, useState } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';
import { SheetSidebar } from './SheetSidebar';
import { SearchTab } from './SearchTab';
import { TitleblockConfigDialog } from './TitleblockConfigDialog';
import { OCRProcessingDialog } from './OCRProcessingDialog';

import { useTakeoffStore } from '../store/useTakeoffStore';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument } from '../types';
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { 
  ArrowLeft, 
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Upload,
  FileText,
  Search
} from "lucide-react";
import { fileService, sheetService } from '../services/apiService';

// All interfaces now imported from shared types

export function TakeoffWorkspace() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  
  console.log('🏗️ TAKEOFF_WORKSPACE: Component initialized', { 
    jobId, 
    hasJobId: !!jobId,
    currentUrl: window.location.href,
    pathname: window.location.pathname
  });
  
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  
  // Dialog states
  const [showTitleblockConfig, setShowTitleblockConfig] = useState(false);
  const [titleblockConfigDocumentId, setTitleblockConfigDocumentId] = useState<string | null>(null);
  
  // Cut-out states
  const [cutoutMode, setCutoutMode] = useState(false);
  const [cutoutTargetConditionId, setCutoutTargetConditionId] = useState<string | null>(null);
  
  // Store integration
  const { 
    setCurrentProject, 
    setSelectedCondition, 
    getSelectedCondition,
    getCurrentProject,
    getProjectTakeoffSummary,
    loadProjectConditions,
    loadProjectTakeoffMeasurements,
    setCalibration,
    getCalibration
  } = useTakeoffStore();
  
  const selectedCondition = getSelectedCondition();

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'documents' | 'search'>('documents');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [ocrSearchResults, setOcrSearchResults] = useState<any[]>([]);
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentPdfFile, setCurrentPdfFile] = useState<ProjectFile | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [exportStatus, setExportStatus] = useState<{type: 'excel' | 'pdf' | null, progress: number}>({type: null, progress: 0});
  
  // PDF viewer controls state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  
  // Store scale per document to preserve zoom when switching between files
  const [documentScales, setDocumentScales] = useState<Record<string, number>>({});
  
  // Current calibration state for the active document/page
  const getCurrentCalibration = () => {
    if (!currentPdfFile || !jobId) {
      return null;
    }
    const calibration = getCalibration(jobId, currentPdfFile.id);
    return calibration;
  };
  
  const currentCalibration = getCurrentCalibration();
  const isPageCalibrated = !!currentCalibration;
  const scaleFactor = currentCalibration?.scaleFactor || 1;
  const unit = currentCalibration?.unit || 'ft';

  useEffect(() => {
    async function loadFiles() {
      console.log('🔄 FILE_LOAD_EFFECT: Starting file loading effect', { jobId, hasJobId: !!jobId });
      if (!jobId) {
        console.log('❌ FILE_LOAD_EFFECT: No jobId provided');
        return;
      }
      try {
        console.log('📁 FILE_LOAD_EFFECT: Loading files for project:', jobId);
        const res = await fileService.getProjectFiles(jobId);
        const files = res.files || [];
        console.log('📁 FILE_LOAD_EFFECT: Files response:', res);
        console.log('📁 FILE_LOAD_EFFECT: Files array:', files);
        setProjectFiles(files);
        
        // Set the first PDF file as current if no current file is set
        if (files.length > 0 && !currentPdfFile) {
          const firstPdfFile = files.find((file: any) => file.mimetype === 'application/pdf');
          if (firstPdfFile) {
            console.log('✅ Setting current PDF file:', firstPdfFile);
            setCurrentPdfFile(firstPdfFile);
          } else {
            console.log('❌ No PDF files found in project');
            console.log('Available files:', files.map((f: any) => ({ id: f.id, name: f.originalName, mimetype: f.mimetype })));
          }
        } else {
          console.log('📁 File loading status:', { 
            filesCount: files.length, 
            hasCurrentPdfFile: !!currentPdfFile,
            currentPdfFileId: currentPdfFile?.id 
          });
        }
        
        console.log('Project files loaded:', files);
        console.log('Current PDF file:', currentPdfFile);
      } catch (e: any) {
        console.error('❌ FILE_LOAD_EFFECT: Error loading project files:', e);
        console.error('❌ FILE_LOAD_EFFECT: Error details:', { 
          message: e?.message, 
          stack: e?.stack,
          jobId 
        });
      }
    }
    loadFiles();
  }, [jobId]); // Removed currentPdfFile from dependencies to prevent infinite loop

  // Set current project in store and load its data
  useEffect(() => {
    if (jobId) {
      setCurrentProject(jobId);
      // Load measurements for this project (conditions will be loaded by TakeoffSidebar)
      loadProjectTakeoffMeasurements(jobId);
    }
  }, [jobId]); // Remove function dependencies to prevent infinite loops

  const handleConditionSelect = (condition: TakeoffCondition | null) => {
    if (condition === null) {
      console.log('Condition deselected in workspace');
      setSelectedCondition(null);
      // Also clear in the store
      useTakeoffStore.getState().setSelectedCondition(null);
    } else {
      console.log('Condition selected in workspace:', condition);
      setSelectedCondition(condition.id);
      // Also set in the store
      useTakeoffStore.getState().setSelectedCondition(condition.id);
    }
  };

  const handleToolSelect = (tool: string) => {
    console.log('Tool selected:', tool);
  };

  const rotatePage = (direction: 'clockwise' | 'counterclockwise') => {
    const rotationStep = direction === 'clockwise' ? 90 : -90;
    const newRotation = (rotation + rotationStep) % 360;
    setRotation(newRotation);
  };

  const handleSheetSelect = (sheet: Sheet) => {
    console.log('Sheet selected:', sheet);
    setSelectedSheet(sheet);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === sheet.id);
    if (selectedFile) {
      console.log('Setting current PDF file to:', selectedFile);
      setCurrentPdfFile(selectedFile);
      
      // Restore scale for this document if it exists
      const savedScale = documentScales[selectedFile.id];
      if (savedScale) {
        console.log('Restoring scale for document:', savedScale);
        setScale(savedScale);
      } else {
        console.log('No saved scale for document, using default');
        setScale(1);
      }
      
      // Calibration state is now managed per document/page, no need to reset
    } else {
      console.error('Could not find PDF file for sheet:', sheet);
    }
  };

  // Enhanced page selection handler
  const handlePageSelect = (documentId: string, pageNumber: number) => {
    console.log('Page selected:', { documentId, pageNumber });
    setSelectedDocumentId(documentId);
    setSelectedPageNumber(pageNumber);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === documentId);
    if (selectedFile) {
      console.log('Setting current PDF file to:', selectedFile);
      setCurrentPdfFile(selectedFile);
      setCurrentPage(pageNumber);
      
      // Restore scale for this document if it exists
      const savedScale = documentScales[selectedFile.id];
      if (savedScale) {
        console.log('Restoring scale for document:', savedScale);
        setScale(savedScale);
      } else {
        console.log('No saved scale for document, using default');
        setScale(1);
      }
      
      // Calibration state is now managed per document/page, no need to reset
    } else {
      console.error('Could not find PDF file for document:', documentId);
    }
  };

  // Titleblock configuration handler
  const handleTitleblockConfig = (documentId: string) => {
    setTitleblockConfigDocumentId(documentId);
    setShowTitleblockConfig(true);
  };

  // OCR processing handler (now handled automatically in background)
  const handleOCRRequest = (documentId: string, pageNumbers: number[]) => {
    console.log('OCR processing is now handled automatically in the background');
    // OCR processing is now automatic during upload
  };

  const handleSearchInDocument = (query: string) => {
    const mockResults = [
      `Found "${query}" in note at coordinates (150, 200)`,
      `Found "${query}" in dimension at coordinates (300, 350)`,
      `Found "${query}" in title block at coordinates (600, 50)`
    ];
    setSearchResults(mockResults);
  };

  const handleOcrSearchResults = (results: any[], query: string) => {
    console.log('📊 Received OCR search results:', results);
    setOcrSearchResults(results);
    setCurrentSearchQuery(query);
  };

  const handleDocumentsUpdate = (updatedDocuments: PDFDocument[]) => {
    setDocuments(updatedDocuments);
  };

  const handleExportStatusUpdate = (type: 'excel' | 'pdf' | null, progress: number) => {
    setExportStatus({type, progress});
  };

  const handleCutoutMode = (conditionId: string | null) => {
    console.log('Cut-out mode changed:', conditionId);
    setCutoutMode(!!conditionId);
    setCutoutTargetConditionId(conditionId);
  };

  // PDF viewer control handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Calibration state is now managed per page, no need to reset
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    // Store scale for current document
    if (currentPdfFile) {
      setDocumentScales(prev => ({
        ...prev,
        [currentPdfFile.id]: newScale
      }));
    }
  };

  const handleCalibrateScale = () => {
    // Trigger the PDF viewer's calibration dialog
    console.log('Calibrate scale requested');
    
    // If already calibrated, clear the current calibration first
    if (isPageCalibrated && currentPdfFile && jobId) {
      setCalibration(jobId, currentPdfFile.id, 1, 'ft');
    }
    
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerCalibration) {
      (window as any).triggerCalibration();
    }
  };


  const handleResetView = () => {
    // Trigger the PDF viewer's fit to window function
    console.log('Reset view requested - fitting PDF to window');
    
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerFitToWindow) {
      (window as any).triggerFitToWindow();
    } else {
      // Fallback to setting scale to 1 if fit to window is not available
      handleScaleChange(1);
    }
  };

  const handlePDFLoaded = (totalPages: number) => {
    setTotalPages(totalPages);
    setCurrentPage(1);
  };

  const handleCalibrationComplete = (isCalibrated: boolean, scaleFactor: number, unit: string) => {
    console.log('Calibration completed:', { isCalibrated, scaleFactor, unit });
    
    if (currentPdfFile && jobId) {
      setCalibration(jobId, currentPdfFile.id, scaleFactor, unit);
    }
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('=== FRONTEND FILE UPLOAD ===');
    console.log('File selected:', file);
    console.log('File name:', file?.name);
    console.log('File type:', file?.type);
    console.log('File size:', file?.size);
    console.log('Job ID:', jobId);
    
    if (!file || !jobId) {
      console.log('ERROR: Missing file or jobId');
      return;
    }
    
    try {
      console.log('Starting upload...');
      setUploading(true);
      
      const uploadRes = await fileService.uploadPDF(file, jobId);
      console.log('Upload response:', uploadRes);
      
      // Refresh project files
      console.log('Refreshing project files...');
      const filesRes = await fileService.getProjectFiles(jobId);
      console.log('Files response:', filesRes);
      
      const files = filesRes.files || [];
      setProjectFiles(files);
      
      // Set the newly uploaded file as current
      if (uploadRes.file) {
        console.log('Setting current PDF file:', uploadRes.file);
        setCurrentPdfFile(uploadRes.file);
      }
      
      console.log('Upload completed successfully');
      
    } catch (error: any) {
      console.error('Upload failed:', error);
      console.error('Error details:', error.response?.data);
      console.error('Error status:', error.response?.status);
    } finally {
      setUploading(false);
    }
  };

  const handleBackToProjects = () => {
    navigate('/');
  };


  const storeCurrentProject = getCurrentProject();
  const currentProject = storeCurrentProject || {
    name: 'Tru Hilton', // Use actual project name instead of generic format
    client: 'ABC', // Use actual client name
    lastSaved: new Date().toLocaleString()
  };

  return (
    <div className="app-shell h-screen flex flex-col bg-background">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        {/* Left side - Navigation and Project Info */}
        <div className="flex items-center gap-6">
          <Button variant="ghost" onClick={handleBackToProjects} className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Button>
          
          <Separator orientation="vertical" className="h-8" />
          
        </div>

        {/* Center - PDF Controls */}
        {currentPdfFile && (
          <div className="flex items-center gap-4">
            {/* Navigation Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="px-3 py-1 bg-gray-100 rounded text-sm">
                {currentPage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Scale Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleScaleChange(Math.max(0.5, scale - 0.1))}
              >
                -
              </Button>
              <span className="px-3 py-1 bg-gray-100 rounded text-sm min-w-[60px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleScaleChange(Math.min(5, scale + 0.1))}
              >
                +
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetView}
              >
                Reset View
              </Button>
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Rotation Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => rotatePage('counterclockwise')}
                title="Rotate counterclockwise"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rotatePage('clockwise')}
                title="Rotate clockwise"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </Button>
            </div>

            <Separator orientation="vertical" className="h-8" />

            {/* Calibration Controls */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={isPageCalibrated ? "default" : "secondary"}
                onClick={handleCalibrateScale}
                className={isPageCalibrated ? "bg-green-600 hover:bg-green-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
              >
                {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
              </Button>
              {isPageCalibrated && (
                <span className="text-xs text-gray-600">
                  1px = {(scaleFactor * 0.0833).toFixed(4)} {unit}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Right side - Actions */}
        <div className="flex items-center gap-4">
          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <label htmlFor="pdf-upload" className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading…' : 'Upload PDF'}
                </span>
              </Button>
            </label>
            
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handlePdfUpload}
              className="hidden"
              id="pdf-upload"
            />
            
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>All changes saved</span>
            </div>
            
          </div>
        </div>
      </div>

      {/* Main Content Area - Fixed height container */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar Toggle */}
        <div className="flex">
          {leftSidebarOpen && (
                        <TakeoffSidebar
              projectId={jobId!}
              onConditionSelect={handleConditionSelect}
              onToolSelect={handleToolSelect}
              documents={documents}
              onPageSelect={handlePageSelect}
              onExportStatusUpdate={handleExportStatusUpdate}
              onCutoutMode={handleCutoutMode}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-8 rounded-none border-r"
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
          >
            {leftSidebarOpen ? 
              <PanelLeftClose className="w-4 h-4" /> : 
              <PanelLeftOpen className="w-4 h-4" />
            }
          </Button>
        </div>

        {/* PDF Viewer - Fixed height container */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {currentPdfFile ? (
            <PDFViewer 
              file={currentPdfFile}
              onCalibrationRequest={() => {
                console.log('Calibration requested');
              }}
              className="h-full"
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              scale={scale}
              onScaleChange={handleScaleChange}
              rotation={rotation}
              onCalibrateScale={handleCalibrateScale}
              isPageCalibrated={isPageCalibrated}
              scaleFactor={scaleFactor}
              unit={unit}
              onPDFLoaded={handlePDFLoaded}
              onCalibrationComplete={handleCalibrationComplete}
              searchResults={ocrSearchResults}
              currentSearchQuery={currentSearchQuery}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              onCutoutModeChange={handleCutoutMode}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 bg-gray-100">
              <div className="text-gray-500">No PDF file selected</div>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="border-t bg-muted/30 p-3">
              <h3 className="font-medium mb-2">Search Results ({searchResults.length})</h3>
              <div className="space-y-1">
                {searchResults.map((result, index) => (
                  <div key={index} className="text-sm p-2 bg-background rounded border cursor-pointer hover:bg-accent">
                    {result}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar Toggle */}
        <div className="flex">
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-8 rounded-none border-l"
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
          >
            {rightSidebarOpen ? 
              <PanelRightClose className="w-4 h-4" /> : 
              <PanelRightOpen className="w-4 h-4" />
            }
          </Button>
          {rightSidebarOpen && (
            <div className="w-96 bg-white border-l flex flex-col h-full">
              {/* Right Sidebar Tabs */}
              <div className="flex border-b">
                <button
                  className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    rightSidebarTab === 'documents'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setRightSidebarTab('documents')}
                >
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4" />
                    Documents
                  </div>
                </button>
                <button
                  className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    rightSidebarTab === 'search'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setRightSidebarTab('search')}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Search className="w-4 h-4" />
                    Search
                  </div>
                </button>
              </div>

              {/* Tab Content */}
              {rightSidebarTab === 'documents' && (
                <SheetSidebar 
                  projectId={jobId!}
                  onPageSelect={handlePageSelect}
                  selectedDocumentId={selectedDocumentId || undefined}
                  selectedPageNumber={selectedPageNumber || undefined}
                  onOCRRequest={handleOCRRequest}
                  onTitleblockConfig={handleTitleblockConfig}
                  onOcrSearchResults={handleOcrSearchResults}
                  onDocumentsUpdate={handleDocumentsUpdate}
                />
              )}
              
              {rightSidebarTab === 'search' && (
                <SearchTab
                  projectId={jobId!}
                  documents={documents}
                  onPageSelect={handlePageSelect}
                  onOcrSearchResults={handleOcrSearchResults}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-sm">
        <div className="flex items-center gap-4">
          {selectedSheet && (
            <>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>{selectedSheet.name}</span>
                <Badge variant="outline" className="text-xs">
                  Page {selectedSheet.pageNumber}
                </Badge>
              </div>
              <Separator orientation="vertical" className="h-4" />
            </>
          )}
          <span>Project: {currentProject.name}</span>
        </div>
        
        {/* Center - Minimal Status */}
        <div className="flex-1 flex justify-center">
          {selectedCondition ? (
            <div className="text-center text-sm text-gray-600">
              {selectedCondition.name} - {selectedCondition.type} takeoff
            </div>
          ) : (
            <div className="text-center text-sm text-gray-600">
              Select a condition to start drawing
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {exportStatus.type ? (
            <div className="flex items-center gap-3 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-blue-700">
                  Exporting {exportStatus.type.toUpperCase()} report...
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${exportStatus.progress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-blue-600 font-medium">
                    {exportStatus.progress}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <span className="text-sm text-gray-600">{uploading ? 'Uploading…' : 'Ready'}</span>
          )}
        </div>
      </div>

      {/* Export Progress Overlay */}
      {exportStatus.type && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full"></div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Exporting {exportStatus.type.toUpperCase()} Report
                </h3>
                <p className="text-sm text-gray-600">
                  Please wait while we process your data...
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Progress</span>
                <span>{exportStatus.progress}%</span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${exportStatus.progress}%` }}
                ></div>
              </div>
            </div>
            
            {exportStatus.type === 'pdf' && exportStatus.progress > 20 && (
              <div className="mt-4 text-xs text-gray-500">
                <p>📄 Capturing PDF pages with measurements...</p>
                <p>This may take a moment for large projects.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Titleblock Configuration Dialog */}
      <TitleblockConfigDialog
        isOpen={showTitleblockConfig}
        onClose={() => {
          setShowTitleblockConfig(false);
          setTitleblockConfigDocumentId(null);
        }}
        onSave={async (config) => {
          try {
            console.log('Saving titleblock configuration:', config);
            const result = await sheetService.configureTitleblock(titleblockConfigDocumentId!, config);
            console.log('Titleblock configuration saved:', result);
          } catch (error) {
            console.error('Failed to save titleblock configuration:', error);
          }
        }}
        documentId={titleblockConfigDocumentId || ''}
        pageNumber={1}
      />

    </div>
  );
}
