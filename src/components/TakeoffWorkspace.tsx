import { useEffect, useState } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import CleanPDFViewer from './CleanPDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';
import { EnhancedSheetSidebar } from './EnhancedSheetSidebar';
import { TitleblockConfigDialog } from './TitleblockConfigDialog';
import { OCRProcessingDialog } from './OCRProcessingDialog';

import { useTakeoffStore } from '../store/useTakeoffStore';
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { 
  ArrowLeft, 
  Save, 
  Download, 
  Settings, 
  FileText, 
  Calculator,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Upload
} from "lucide-react";
import { fileService, sheetService } from '../services/apiService';

interface TakeoffCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  unit: string;
  wasteFactor: number;
  color: string;
  description: string;
  laborCost?: number;
  materialCost?: number;
  tools?: string[];
}

interface Sheet {
  id: string;
  name: string;
  pageNumber: number;
  thumbnail?: string;
  isVisible: boolean;
  hasTakeoffs: boolean;
  takeoffCount: number;
}

interface Project {
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
}

interface ProjectFile {
  id: string;
  projectId: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: string;
}

export function TakeoffWorkspace() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  
  // Dialog states
  const [showTitleblockConfig, setShowTitleblockConfig] = useState(false);
  const [titleblockConfigDocumentId, setTitleblockConfigDocumentId] = useState<string | null>(null);
  
  // Store integration
  const { 
    setCurrentProject, 
    setSelectedCondition, 
    getSelectedCondition,
    getCurrentProject,
    getProjectTakeoffSummary,
    loadProjectConditions
  } = useTakeoffStore();
  
  const selectedCondition = getSelectedCondition();

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [ocrSearchResults, setOcrSearchResults] = useState<any[]>([]);
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentPdfFile, setCurrentPdfFile] = useState<ProjectFile | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  
  // PDF viewer controls state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  
  // Calibration state management - store per document/page combination
  const [calibrationState, setCalibrationState] = useState<{
    [key: string]: {
      isCalibrated: boolean;
      scaleFactor: number;
      unit: string;
    }
  }>({});
  
  // Current calibration state for the active document/page
  const getCurrentCalibrationKey = () => {
    if (!currentPdfFile) return null;
    return `${currentPdfFile.id}-${currentPage}`;
  };
  
  const currentCalibrationKey = getCurrentCalibrationKey();
  const currentCalibration = currentCalibrationKey ? calibrationState[currentCalibrationKey] : null;
  
  const isPageCalibrated = currentCalibration?.isCalibrated || false;
  const scaleFactor = currentCalibration?.scaleFactor || 1;
  const unit = currentCalibration?.unit || 'ft';

  useEffect(() => {
    async function loadFiles() {
      if (!jobId) return;
      try {
        console.log('Loading files for project:', jobId);
        const res = await fileService.getProjectFiles(jobId);
        const files = res.files || [];
        console.log('Files response:', res);
        console.log('Files array:', files);
        setProjectFiles(files);
        
        // Set the first PDF file as current if no current file is set
        if (files.length > 0 && !currentPdfFile) {
          const firstPdfFile = files.find((file: any) => file.mimetype === 'application/pdf');
          if (firstPdfFile) {
            console.log('Setting current PDF file:', firstPdfFile);
            setCurrentPdfFile(firstPdfFile);
          } else {
            console.log('No PDF files found in project');
          }
        }
        
        console.log('Project files loaded:', files);
        console.log('Current PDF file:', currentPdfFile);
      } catch (e) {
        console.error('Error loading project files:', e);
      }
    }
    loadFiles();
  }, [jobId]); // Removed currentPdfFile from dependencies to prevent infinite loop

  // Set current project in store and load its conditions
  useEffect(() => {
    if (jobId) {
      setCurrentProject(jobId);
      // Load conditions for this project
      loadProjectConditions(jobId);
    }
  }, [jobId, setCurrentProject, loadProjectConditions]);

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

  const handleSheetSelect = (sheet: Sheet) => {
    console.log('Sheet selected:', sheet);
    setSelectedSheet(sheet);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === sheet.id);
    if (selectedFile) {
      console.log('Setting current PDF file to:', selectedFile);
      setCurrentPdfFile(selectedFile);
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

  // PDF viewer control handlers
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Calibration state is now managed per page, no need to reset
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
  };

  const handleCalibrateScale = () => {
    // Trigger the PDF viewer's calibration dialog
    console.log('Calibrate scale requested');
    
    // If already calibrated, clear the current calibration first
    if (isPageCalibrated && currentCalibrationKey) {
      setCalibrationState(prev => ({
        ...prev,
        [currentCalibrationKey]: {
          isCalibrated: false,
          scaleFactor: 1,
          unit: 'ft'
        }
      }));
    }
    
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerCalibration) {
      (window as any).triggerCalibration();
    }
  };

  const handleClearAll = () => {
    // Trigger the PDF viewer's clear all function
    console.log('Clear all requested');
    
    // Clear calibration state for current page
    if (currentCalibrationKey) {
      setCalibrationState(prev => ({
        ...prev,
        [currentCalibrationKey]: {
          isCalibrated: false,
          scaleFactor: 1,
          unit: 'ft'
        }
      }));
    }
    
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerClearAll) {
      (window as any).triggerClearAll();
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
    
    if (currentCalibrationKey) {
      setCalibrationState(prev => ({
        ...prev,
        [currentCalibrationKey]: {
          isCalibrated,
          scaleFactor,
          unit
        }
      }));
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
          
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{currentProject.name}</h1>
              <p className="text-sm text-gray-600">{currentProject.client}</p>
            </div>
            

          </div>
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
              <Button
                size="sm"
                variant="destructive"
                onClick={handleClearAll}
              >
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* Right side - File Info and Actions */}
        <div className="flex items-center gap-4">
          {/* File Status */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <FileText className="w-4 h-4" />
            <span>Files: {projectFiles.length}</span>
            <span>•</span>
            <span>Last saved: {'lastSaved' in currentProject ? currentProject.lastSaved : 'Unknown'}</span>
          </div>
          
          <Separator orientation="vertical" className="h-8" />
          
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
            
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
            
            <Button 
              size="sm" 
              className="flex items-center gap-2"
              onClick={() => {
                // Save current project data
                if (jobId) {
                  const project = getCurrentProject();
                  if (project) {
                    // Update last saved timestamp
                    const updatedProject = {
                      ...project,
                      lastModified: new Date()
                    };
                    // The store automatically persists data, so we just need to update the project
                    console.log('Saving project:', updatedProject);
                    // You could add API call here if needed
                    alert('Project saved successfully!');
                  }
                }
              }}
            >
              <Save className="w-4 h-4" />
              Save
            </Button>
            
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
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
            <CleanPDFViewer 
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
              onCalibrateScale={handleCalibrateScale}
              onClearAll={handleClearAll}
              isPageCalibrated={isPageCalibrated}
              scaleFactor={scaleFactor}
              unit={unit}
              onPDFLoaded={handlePDFLoaded}
              onCalibrationComplete={handleCalibrationComplete}
              searchResults={ocrSearchResults}
              currentSearchQuery={currentSearchQuery}
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
              <EnhancedSheetSidebar 
                projectId={jobId!}
                onPageSelect={handlePageSelect}
                selectedDocumentId={selectedDocumentId}
                selectedPageNumber={selectedPageNumber}
                onOCRRequest={handleOCRRequest}
                onTitleblockConfig={handleTitleblockConfig}
                onOcrSearchResults={handleOcrSearchResults}
              />
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
          <span className="text-sm text-gray-600">{uploading ? 'Uploading…' : 'Ready'}</span>
        </div>
      </div>

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
