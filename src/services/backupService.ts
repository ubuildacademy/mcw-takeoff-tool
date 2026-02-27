import { Project, TakeoffCondition, ProjectFile, TakeoffMeasurement, Calibration } from '../types';
import { authHelpers } from '../lib/supabase';
import { getApiBaseUrl } from '../lib/apiConfig';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import { useDocumentViewStore } from '../store/slices/documentViewSlice';

async function getAuthHeaders(): Promise<HeadersInit> {
  const session = await authHelpers.getValidSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

export interface ProjectBackup {
  version: string;
  timestamp: string;
  project: Project;
  conditions: TakeoffCondition[];
  files: (ProjectFile & {
    fileData?: string | null; // Base64 encoded PDF data
    fileDataMimeType?: string;
    fileDataError?: string; // Error message if file couldn't be downloaded
  })[];
  sheets: unknown[]; // Sheet data from the API
  measurements: TakeoffMeasurement[];
  calibrations?: Calibration[]; // Scale calibrations
  metadata: {
    totalFiles: number;
    totalConditions: number;
    totalMeasurements: number;
    totalSheets: number;
    totalCalibrations?: number;
    filesWithData?: number; // Number of files with actual PDF data
    filesMissing?: number; // Number of files missing from backup
  };
}

export class BackupService {
  /**
   * Export a project to a backup file
   */
  static async exportProject(projectId: string): Promise<void> {
    try {
      console.log('🔄 BACKUP: Starting project export for:', projectId);

      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/export`, {
        headers: await getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const backup = await response.json();
      const fileIds = new Set((backup.files ?? []).map((f: { id?: string }) => f.id).filter(Boolean));
      const docRotations = useDocumentViewStore.getState().documentRotations;
      const documentRotations: Record<string, number> = {};
      for (const [docId, rot] of Object.entries(docRotations)) {
        if (fileIds.has(docId)) documentRotations[docId] = rot;
      }
      if (Object.keys(documentRotations).length > 0) backup.documentRotations = documentRotations;
      const annotations = useAnnotationStore.getState().annotations.filter((a) => a.projectId === projectId);
      if (annotations.length > 0) backup.annotations = annotations;

      // Convert to JSON and create download
      const jsonString = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${backup.project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.json`;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log('✅ BACKUP: Project exported successfully', {
        projectName: backup.project.name,
        metadata: backup.metadata
      });

    } catch (error) {
      console.error('❌ BACKUP: Failed to export project:', error);
      throw new Error('Failed to export project. Please try again.');
    }
  }

  /**
   * Import a project from a backup file.
   * Returns project and optionally annotations/documentRotations to apply to stores.
   */
  static async importProject(file: File): Promise<{
    project: Project;
    annotations?: Array<Record<string, unknown>>;
    documentRotations?: Record<string, number>;
  }> {
    try {
      console.log('🔄 BACKUP: Starting project import for file:', file.name);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${getApiBaseUrl()}/projects/import`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: formData
      });

      if (!response.ok) {
        let message = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData?.error) message = errorData.error;
        } catch {
          // Server may have returned non-JSON (e.g. HTML error page)
        }
        throw new Error(message);
      }

      const result = await response.json();
      console.log('✅ BACKUP: Project imported successfully');
      return {
        project: result.project,
        annotations: result.annotations,
        documentRotations: result.documentRotations,
      };

    } catch (error) {
      console.error('❌ BACKUP: Failed to import project:', error);
      throw new Error('Failed to import project. Please check the backup file format.');
    }
  }

  /**
   * Validate a backup file without importing
   */
  static async validateBackupFile(file: File): Promise<{ valid: boolean; metadata?: Record<string, unknown>; error?: string }> {
    try {
      const text = await file.text();
      const backup: ProjectBackup = JSON.parse(text);

      if (!backup.version || !backup.project || !backup.timestamp) {
        return { valid: false, error: 'Invalid backup file format' };
      }

      // Check backup version and provide helpful info
      const isV2 = backup.version === '2.0' || parseFloat(backup.version) >= 2.0;
      const filesWithData = backup.metadata?.filesWithData ?? 0;
      const hasCalibrations = backup.calibrations && backup.calibrations.length > 0;

      return { 
        valid: true, 
        metadata: {
          projectName: backup.project.name,
          timestamp: backup.timestamp,
          version: backup.version,
          isV2,
          hasPDFs: isV2 && filesWithData > 0,
          hasCalibrations,
          ...backup.metadata
        }
      };
    } catch {
      return { 
        valid: false, 
        error: 'Failed to parse backup file. Please ensure it is a valid JSON file.' 
      };
    }
  }
}
