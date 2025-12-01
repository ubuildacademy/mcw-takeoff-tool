import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { 
  X, 
  Scan, 
  CheckCircle, 
  Loader2,
  AlertCircle,
  Home,
  Square,
  DoorOpen,
  SquareStack
} from 'lucide-react';
import { cvTakeoffService } from '../services/cvTakeoffService';
import { useTakeoffStore } from '../store/useTakeoffStore';

interface CVTakeoffAgentProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  documentId: string | null;
  pageNumber: number | null;
}

type Stage = 'selection' | 'processing' | 'complete';

export function CVTakeoffAgent({ 
  isOpen, 
  onClose, 
  projectId,
  documentId,
  pageNumber
}: CVTakeoffAgentProps) {
  const [currentStage, setCurrentStage] = useState<Stage>('selection');
  const [serviceAvailable, setServiceAvailable] = useState<boolean>(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [statusDetails, setStatusDetails] = useState<any>(null);
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Results
  const [results, setResults] = useState<{
    conditionsCreated: number;
    measurementsCreated: number;
    roomsDetected: number;
    wallsDetected: number;
    doorsDetected: number;
    windowsDetected: number;
    errors: string[];
    errorDetails?: any;
  } | null>(null);

  // Detection options - what to detect
  const [detectionOptions, setDetectionOptions] = useState({
    detectRooms: false,
    detectWalls: false,
    detectDoors: false,
    detectWindows: false
  });

  // Store integration
  const { getCalibration, loadProjectConditions, loadProjectTakeoffMeasurements } = useTakeoffStore();

  // Check service availability on mount
  useEffect(() => {
    if (isOpen) {
      checkServiceStatus();
    }
  }, [isOpen]);

  // Reset when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentStage('selection');
      setDetectionOptions({
        detectRooms: false,
        detectWalls: false,
        detectDoors: false,
        detectWindows: false
      });
      setResults(null);
    }
  }, [isOpen]);

  const checkServiceStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const status = await cvTakeoffService.checkStatus();
      setServiceAvailable(status.available);
      setStatusDetails(status.details || status.diagnostics);
      console.log('CV Takeoff Status:', {
        available: status.available,
        details: status.details,
        diagnostics: status.diagnostics
      });
    } catch (error) {
      console.error('Error checking service status:', error);
      setServiceAvailable(false);
      setStatusDetails({ error: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleStartProcessing = async () => {
    // Validate that at least one option is selected
    if (!Object.values(detectionOptions).some(v => v)) {
      alert('Please select at least one item to detect.');
      return;
    }

    // Validate document and page
    if (!documentId || !pageNumber) {
      alert('Please navigate to a page first.');
      return;
    }

    setCurrentStage('processing');
    setIsProcessing(true);

    try {
      // Get scale factor from calibration
      let scaleFactor = 0.0833; // Default: 1 inch = 1 foot (1/12)
      
      // Try page-specific calibration first
      const pageCalibration = getCalibration(projectId, documentId, pageNumber);
      if (pageCalibration) {
        scaleFactor = pageCalibration.scaleFactor;
      } else {
        // Try document-level calibration
        const docCalibration = getCalibration(projectId, documentId);
        if (docCalibration) {
          scaleFactor = docCalibration.scaleFactor;
        }
      }

      console.log(`Using scale factor: ${scaleFactor} (1 pixel = ${scaleFactor} feet)`);

      // Process the current page (async with progress updates)
      const result = await cvTakeoffService.processPage(
        documentId,
        pageNumber,
        projectId,
        scaleFactor,
        {
          detectRooms: detectionOptions.detectRooms,
          detectWalls: detectionOptions.detectWalls,
          detectDoors: detectionOptions.detectDoors,
          detectWindows: detectionOptions.detectWindows,
          minRoomArea: 50,
          minWallLength: 2
        },
        (progress, status) => {
          // Update progress in UI
          console.log(`Processing progress: ${progress}% (${status})`);
          // You could update a progress bar here if needed
        }
      );

      setResults({
        conditionsCreated: result.conditionsCreated,
        measurementsCreated: result.measurementsCreated,
        roomsDetected: result.rooms.length,
        wallsDetected: result.walls.length,
        doorsDetected: result.doors.length,
        windowsDetected: result.windows.length,
        errors: []
      });

      // Refresh conditions and measurements in store
      await loadProjectConditions(projectId);
      await loadProjectTakeoffMeasurements(projectId);

      setCurrentStage('complete');
    } catch (error) {
      console.error('Error processing page:', error);
      
      // Extract error message properly
      let errorMessage = 'Unknown error';
      let errorDetails: any = null;
      
      if (error instanceof Error) {
        errorMessage = error.message || String(error);
        // If message is "[object Object]", try to extract more details
        if (errorMessage === '[object Object]' || errorMessage.includes('[object Object]')) {
          try {
            const errorObj = error as any;
            errorMessage = errorObj.message || errorObj.error || JSON.stringify(errorObj) || 'Unknown error';
          } catch {
            errorMessage = 'Failed to process page - unknown error';
          }
        }
        
        // Try to extract error details from the message
        try {
          const detailsMatch = errorMessage.match(/Details: ({.*})/s);
          if (detailsMatch) {
            errorDetails = JSON.parse(detailsMatch[1]);
          } else {
            // Also check if error object has details property
            const errorObj = error as any;
            if (errorObj.details) {
              errorDetails = errorObj.details;
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      } else if (error && typeof error === 'object') {
        try {
          const errorObj = error as any;
          errorMessage = errorObj.message || errorObj.error || JSON.stringify(errorObj) || 'Unknown error';
          errorDetails = errorObj.details || null;
        } catch {
          errorMessage = 'Failed to process page - unknown error';
        }
      } else {
        errorMessage = String(error);
      }
      
      setResults({
        conditionsCreated: 0,
        measurementsCreated: 0,
        roomsDetected: 0,
        wallsDetected: 0,
        doorsDetected: 0,
        windowsDetected: 0,
        errors: [errorMessage],
        errorDetails
      });
      setCurrentStage('complete');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setCurrentStage('selection');
    setResults(null);
    onClose();
  };

  if (!isOpen) return null;

  // Check if we have a valid page
  const hasValidPage = documentId && pageNumber;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Scan className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold">CV Takeoff Detection</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Service Status */}
          {isCheckingStatus ? (
            <div className="mb-4 p-3 bg-gray-50 rounded-md flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Checking service availability...</span>
            </div>
          ) : serviceAvailable ? (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-800">CV detection service is available</span>
              </div>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <span className="text-sm text-yellow-800 font-medium block mb-1">
                    Warning: Could not verify Python/OpenCV availability.
                  </span>
                  {statusDetails && (
                    <details className="mt-2">
                      <summary className="text-xs text-yellow-700 cursor-pointer hover:text-yellow-900">
                        Show diagnostic details
                      </summary>
                      <pre className="mt-2 text-xs bg-yellow-100 p-2 rounded overflow-auto max-h-48 text-yellow-900">
                        {JSON.stringify(statusDetails, null, 2)}
                      </pre>
                    </details>
                  )}
                  <span className="text-xs text-yellow-700 block mt-1">
                    You can still try to use CV detection - it will show detailed errors if dependencies are missing.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Page Info */}
          {hasValidPage ? (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>Current Page:</strong> Page {pageNumber}
              </p>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                Please navigate to a page first before running CV detection.
              </p>
            </div>
          )}

          {/* Selection Stage */}
          {currentStage === 'selection' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium mb-2">Select Items to Detect</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Choose which architectural elements to detect on this page. 
                  All detected items of the same type will be grouped into a single condition.
                </p>
              </div>

              {/* Detection Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={detectionOptions.detectRooms}
                    onChange={(e) => setDetectionOptions({ ...detectionOptions, detectRooms: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <Home className="w-5 h-5 text-green-600" />
                  <div className="flex-1">
                    <div className="font-medium">Detect Rooms</div>
                    <div className="text-xs text-gray-500">Area measurements (SF)</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={detectionOptions.detectWalls}
                    onChange={(e) => setDetectionOptions({ ...detectionOptions, detectWalls: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <Square className="w-5 h-5 text-blue-600" />
                  <div className="flex-1">
                    <div className="font-medium">Detect Walls</div>
                    <div className="text-xs text-gray-500">Linear measurements (LF)</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={detectionOptions.detectDoors}
                    onChange={(e) => setDetectionOptions({ ...detectionOptions, detectDoors: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <DoorOpen className="w-5 h-5 text-orange-600" />
                  <div className="flex-1">
                    <div className="font-medium">Detect Doors</div>
                    <div className="text-xs text-gray-500">Count measurements (EA)</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={detectionOptions.detectWindows}
                    onChange={(e) => setDetectionOptions({ ...detectionOptions, detectWindows: e.target.checked })}
                    className="w-5 h-5"
                  />
                  <SquareStack className="w-5 h-5 text-purple-600" />
                  <div className="flex-1">
                    <div className="font-medium">Detect Windows</div>
                    <div className="text-xs text-gray-500">Count measurements (EA)</div>
                  </div>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleStartProcessing}
                  disabled={!hasValidPage || !Object.values(detectionOptions).some(v => v)}
                >
                  <Scan className="w-4 h-4 mr-2" />
                  Start Detection
                </Button>
              </div>
            </div>
          )}

          {/* Processing Stage */}
          {currentStage === 'processing' && (
            <div className="space-y-4 text-center">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto" />
              <h3 className="text-lg font-medium">Processing Page</h3>
              <p className="text-gray-600 text-sm">
                Detecting boundaries and creating measurements...
              </p>
            </div>
          )}

          {/* Complete Stage */}
          {currentStage === 'complete' && results && (
            <div className="space-y-4">
              <div className="text-center">
                {results.errors.length === 0 ? (
                  <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-2" />
                ) : (
                  <AlertCircle className="w-12 h-12 text-yellow-600 mx-auto mb-2" />
                )}
                <h3 className="text-lg font-medium">
                  {results.errors.length === 0 ? 'Detection Complete!' : 'Detection Complete with Errors'}
                </h3>
              </div>

              {/* Results Summary */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Conditions Created</span>
                  <span className="font-semibold">{results.conditionsCreated}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Measurements Created</span>
                  <span className="font-semibold">{results.measurementsCreated}</span>
                </div>
                {(results.roomsDetected > 0 || results.wallsDetected > 0 || results.doorsDetected > 0 || results.windowsDetected > 0) && (
                  <div className="pt-2 border-t space-y-1">
                    {results.roomsDetected > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Rooms detected</span>
                        <span>{results.roomsDetected}</span>
                      </div>
                    )}
                    {results.wallsDetected > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Walls detected</span>
                        <span>{results.wallsDetected}</span>
                      </div>
                    )}
                    {results.doorsDetected > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Doors detected</span>
                        <span>{results.doorsDetected}</span>
                      </div>
                    )}
                    {results.windowsDetected > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Windows detected</span>
                        <span>{results.windowsDetected}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Errors */}
              {results.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <h5 className="font-medium text-red-800 mb-2 text-sm">Errors</h5>
                  <ul className="list-disc list-inside text-xs text-red-700 mb-2">
                    {results.errors.map((error, index) => (
                      <li key={index} className="mb-1">{error}</li>
                    ))}
                  </ul>
                  {results.errorDetails && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-700 cursor-pointer hover:text-red-900 font-medium">
                        Show detailed diagnostic information
                      </summary>
                      <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-auto max-h-64 text-red-900">
                        {JSON.stringify(results.errorDetails, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
