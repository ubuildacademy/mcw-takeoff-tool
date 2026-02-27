import { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Progress } from './ui/progress';
import { 
  Download, 
  Upload, 
  FileText, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  Database,
  FolderOpen,
  Ruler,
  FileImage,
  Share2
} from 'lucide-react';
import { BackupService } from '../services/backupService';
import { ShareProjectModal } from './ShareProjectModal';
import { useProjectStore } from '../store/slices/projectSlice';

interface BackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'backup' | 'restore';
  projectId?: string;
  projectName?: string;
}

export function BackupDialog({ 
  open, 
  onOpenChange, 
  mode, 
  projectId, 
  projectName 
}: BackupDialogProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  interface BackupFileMetadata {
    projectName?: string;
    totalFiles?: number;
    totalConditions?: number;
    totalMeasurements?: number;
    totalSheets?: number;
    totalCalibrations?: number;
    filesWithData?: number;
    filesMissing?: number;
    hasPDFs?: boolean;
    hasCalibrations?: boolean;
    version?: string;
    timestamp?: string;
  }
  const [fileInfo, setFileInfo] = useState<BackupFileMetadata | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadInitialData = useProjectStore((s) => s.loadInitialData);

  const handleBackup = async () => {
    if (!projectId) return;

    setLoading(true);
    setProgress(0);
    setError(null);
    setSuccess(false);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      await BackupService.exportProject(projectId);
      
      clearInterval(progressInterval);
      setProgress(100);
      setSuccess(true);
      
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        setProgress(0);
      }, 2000);

    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to backup project');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileInfo(null);

    // Validate file
    const validation = await BackupService.validateBackupFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid backup file');
      return;
    }

    setFileInfo((validation.metadata ?? null) as BackupFileMetadata | null);
  };

  const handleRestore = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    setProgress(0);
    setError(null);
    setSuccess(false);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      await BackupService.importProject(file);
      
      clearInterval(progressInterval);
      setProgress(100);
      setSuccess(true);
      
      // Reload the project list
      await loadInitialData();
      
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        setProgress(0);
        setFileInfo(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }, 2000);

    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Failed to restore project');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onOpenChange(false);
      setError(null);
      setSuccess(false);
      setProgress(0);
      setFileInfo(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby="backup-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'backup' ? (
              <>
                <Download className="w-5 h-5" />
                Backup Project
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Restore Project
              </>
            )}
          </DialogTitle>
          <DialogDescription id="backup-dialog-description">
            {mode === 'backup' 
              ? `Create a backup file for "${projectName}" including all data and measurements.`
              : 'Select a backup file to restore a project with all its data.'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === 'backup' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                <Database className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-blue-800">
                  This will include all project data, PDFs, conditions, measurements, scale calibrations, and settings.
                </span>
              </div>

              {loading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Creating backup...</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="w-full" />
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-800">
                    Backup created successfully! Download should start automatically.
                  </span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-800">{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose} disabled={loading}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowShareModal(true)}
                  disabled={loading}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share via Email
                </Button>
                <Button onClick={handleBackup} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating Backup...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Create Backup
                    </>
                  )}
                </Button>
              </div>
              {projectId && projectName && (
                <ShareProjectModal
                  projectId={projectId}
                  projectName={projectName}
                  isOpen={showShareModal}
                  onClose={() => setShowShareModal(false)}
                />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Backup File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="w-full p-2 border rounded-md"
                  disabled={loading}
                />
              </div>

              {fileInfo && (
                <div className="p-3 bg-gray-50 rounded-lg space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-600" />
                    <span className="font-medium">{fileInfo.projectName ?? 'Unknown'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1">
                      <FolderOpen className="w-3 h-3" />
                      <span>{fileInfo.totalFiles ?? 0} files</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      <span>{fileInfo.totalConditions} conditions</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      <span>{fileInfo.totalMeasurements ?? 0} measurements</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileImage className="w-3 h-3" />
                      <span>{fileInfo.totalSheets ?? 0} sheets</span>
                    </div>
                    {fileInfo.totalCalibrations !== undefined && (
                      <div className="flex items-center gap-1">
                        <Ruler className="w-3 h-3" />
                        <span>{fileInfo.totalCalibrations ?? 0} calibrations</span>
                      </div>
                    )}
                  </div>
                  {fileInfo.hasPDFs !== undefined && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded text-xs">
                      <CheckCircle className="w-3 h-3 text-blue-600" />
                      <span className="text-blue-800">
                        {(fileInfo.filesWithData ?? 0)} PDF file(s) included in backup
                        {(fileInfo.filesMissing ?? 0) > 0 && ` (${fileInfo.filesMissing} missing)`}
                      </span>
                    </div>
                  )}
                  {fileInfo.hasCalibrations && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 rounded text-xs">
                      <CheckCircle className="w-3 h-3 text-green-600" />
                      <span className="text-green-800">
                        Scale calibrations included
                      </span>
                    </div>
                  )}
                  {fileInfo.version && (
                    <div className="text-xs text-gray-500">
                      Version: {fileInfo.version} • Created: {fileInfo.timestamp ? new Date(fileInfo.timestamp).toLocaleString() : '—'}
                    </div>
                  )}
                  {!fileInfo.version && (
                    <div className="text-xs text-gray-500">
                      Created: {fileInfo.timestamp ? new Date(fileInfo.timestamp).toLocaleString() : '—'}
                    </div>
                  )}
                </div>
              )}

              {loading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Restoring project...</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="w-full" />
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-800">
                    Project restored successfully!
                  </span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-red-800">{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose} disabled={loading}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleRestore} 
                  disabled={loading || !fileInfo}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Restore Project
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


