import { Project, TakeoffCondition, ProjectFile, TakeoffMeasurement } from '../types';

export interface ProjectBackup {
  version: string;
  timestamp: string;
  project: Project;
  conditions: TakeoffCondition[];
  files: ProjectFile[];
  sheets: any[]; // Sheet data from the API
  measurements: TakeoffMeasurement[];
  metadata: {
    totalFiles: number;
    totalConditions: number;
    totalMeasurements: number;
    totalSheets: number;
  };
}

export class BackupService {
  /**
   * Export a project to a backup file
   */
  static async exportProject(projectId: string): Promise<void> {
    try {
      console.log('🔄 BACKUP: Starting project export for:', projectId);
      
      // Use consistent API base URL logic
      const { getApiBaseUrl } = await import('../lib/apiConfig');
      const API_BASE_URL = getApiBaseUrl();
      
      // Use the backend's export endpoint
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/export`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const backup = await response.json();
      
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
   * Import a project from a backup file
   */
  static async importProject(file: File): Promise<Project> {
    try {
      console.log('🔄 BACKUP: Starting project import for file:', file.name);
      
      // Use consistent API base URL logic
      const { getApiBaseUrl } = await import('../lib/apiConfig');
      const API_BASE_URL = getApiBaseUrl();
      
      // Use the backend's import endpoint
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/projects/import`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ BACKUP: Project imported successfully');
      return result.project;

    } catch (error) {
      console.error('❌ BACKUP: Failed to import project:', error);
      throw new Error('Failed to import project. Please check the backup file format.');
    }
  }

  /**
   * Validate a backup file without importing
   */
  static async validateBackupFile(file: File): Promise<{ valid: boolean; metadata?: any; error?: string }> {
    try {
      const text = await file.text();
      const backup: ProjectBackup = JSON.parse(text);

      if (!backup.version || !backup.project || !backup.timestamp) {
        return { valid: false, error: 'Invalid backup file format' };
      }

      return { 
        valid: true, 
        metadata: {
          projectName: backup.project.name,
          timestamp: backup.timestamp,
          ...backup.metadata
        }
      };
    } catch (error) {
      return { 
        valid: false, 
        error: 'Failed to parse backup file. Please ensure it is a valid JSON file.' 
      };
    }
  }
}
