import { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
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
  FileImage
} from 'lucide-react';
import { BackupService, ProjectBackup } from '../services/backupService';
import { useTakeoffStore } from '../store/useTakeoffStore';

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
  const [fileInfo, setFileInfo] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadInitialData } = useTakeoffStore();

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

    } catch (error: any) {
      setError(error.message || 'Failed to backup project');
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

    setFileInfo(validation.metadata);
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

    } catch (error: any) {
      setError(error.message || 'Failed to restore project');
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
      <DialogContent className="sm:max-w-md">
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
          <DialogDescription>
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
                  This will include all project data, conditions, measurements, and settings.
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
                    <span className="font-medium">{fileInfo.projectName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1">
                      <FolderOpen className="w-3 h-3" />
                      <span>{fileInfo.totalFiles} files</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Database className="w-3 h-3" />
                      <span>{fileInfo.totalConditions} conditions</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      <span>{fileInfo.totalMeasurements} measurements</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FileImage className="w-3 h-3" />
                      <span>{fileInfo.totalSheets} sheets</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    Created: {new Date(fileInfo.timestamp).toLocaleString()}
                  </div>
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
