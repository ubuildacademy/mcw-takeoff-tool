// Simple localStorage-based measurement storage
// This replaces the complex Zustand store system

export interface StoredMeasurement {
  id: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  conditionId: string;
  conditionName: string;
  color: string;
  timestamp: number;
  // PDF-specific properties
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>; // PDF-relative coordinates (0-1 scale)
  perimeterValue?: number;
}

export interface StoredScale {
  id: string;
  projectId: string;
  sheetId: string;
  scaleFactor: number;
  unit: string;
  calibratedAt: number;
}

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  lastModified: number;
}

// Storage key generators
const getProjectKey = (projectId: string) => `project_${projectId}`;
const getScaleKey = (projectId: string) => `scales_${projectId}`;
const getMeasurementKey = (projectId: string, fileId: string, pageNumber: number) => 
  `takeoffs_${projectId}_${fileId}_${pageNumber}`;
const getConditionKey = (projectId: string) => `conditions_${projectId}`;

// Project management
export const saveProject = (project: StoredProject): void => {
  const key = getProjectKey(project.id);
  localStorage.setItem(key, JSON.stringify(project));
};

export const loadProject = (projectId: string): StoredProject | null => {
  const key = getProjectKey(projectId);
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : null;
};

export const getAllProjects = (): StoredProject[] => {
  const projects: StoredProject[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('project_')) {
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          projects.push(JSON.parse(saved));
        } catch (e) {
          console.error('Error parsing project:', e);
        }
      }
    }
  }
  return projects.sort((a, b) => b.lastModified - a.lastModified);
};

// Scale management
export const saveScales = (projectId: string, scales: StoredScale[]): void => {
  const key = getScaleKey(projectId);
  localStorage.setItem(key, JSON.stringify(scales));
};

export const loadScales = (projectId: string): StoredScale[] => {
  const key = getScaleKey(projectId);
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : [];
};

// Measurement management
export const saveMeasurements = (
  projectId: string, 
  fileId: string, 
  pageNumber: number, 
  measurements: StoredMeasurement[]
): void => {
  const key = getMeasurementKey(projectId, fileId, pageNumber);
  localStorage.setItem(key, JSON.stringify(measurements));
};

export const loadMeasurements = (
  projectId: string, 
  fileId: string, 
  pageNumber: number
): StoredMeasurement[] => {
  const key = getMeasurementKey(projectId, fileId, pageNumber);
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : [];
};

export const getAllProjectMeasurements = (projectId: string): StoredMeasurement[] => {
  const measurements: StoredMeasurement[] = [];
  const prefix = `takeoffs_${projectId}_`;
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          const pageMeasurements = JSON.parse(saved);
          measurements.push(...pageMeasurements);
        } catch (e) {
          console.error('Error parsing measurements:', e);
        }
      }
    }
  }
  return measurements;
};

// Condition management
export const saveConditions = (projectId: string, conditions: any[]): void => {
  const key = getConditionKey(projectId);
  localStorage.setItem(key, JSON.stringify(conditions));
};

export const loadConditions = (projectId: string): any[] => {
  const key = getConditionKey(projectId);
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : [];
};

// Export/Import functionality
export const exportProject = (projectId: string): string => {
  const project = loadProject(projectId);
  const scales = loadScales(projectId);
  const conditions = loadConditions(projectId);
  const measurements = getAllProjectMeasurements(projectId);
  
  const exportData = {
    project,
    scales,
    conditions,
    measurements,
    exportedAt: Date.now(),
    version: '1.0'
  };
  
  return JSON.stringify(exportData, null, 2);
};

export const importProject = (jsonData: string): boolean => {
  try {
    const data = JSON.parse(jsonData);
    
    if (!data.project || !data.project.id) {
      throw new Error('Invalid project data');
    }
    
    // Save project
    saveProject(data.project);
    
    // Save scales
    if (data.scales) {
      saveScales(data.project.id, data.scales);
    }
    
    // Save conditions
    if (data.conditions) {
      saveConditions(data.project.id, data.conditions);
    }
    
    // Save measurements (group by file and page)
    if (data.measurements) {
      const measurementsByPage: { [key: string]: StoredMeasurement[] } = {};
      
      data.measurements.forEach((measurement: StoredMeasurement) => {
        const pageKey = `${measurement.pdfPage}`;
        if (!measurementsByPage[pageKey]) {
          measurementsByPage[pageKey] = [];
        }
        measurementsByPage[pageKey].push(measurement);
      });
      
      // Save each page's measurements
      Object.entries(measurementsByPage).forEach(([pageKey, pageMeasurements]) => {
        // We need to extract fileId from the measurements - this is a limitation
        // For now, we'll use a default fileId
        const fileId = 'imported';
        const pageNumber = parseInt(pageKey);
        saveMeasurements(data.project.id, fileId, pageNumber, pageMeasurements);
      });
    }
    
    return true;
  } catch (e) {
    console.error('Error importing project:', e);
    return false;
  }
};

// Utility functions
export const clearProject = (projectId: string): void => {
  // Remove project
  localStorage.removeItem(getProjectKey(projectId));
  
  // Remove scales
  localStorage.removeItem(getScaleKey(projectId));
  
  // Remove conditions
  localStorage.removeItem(getConditionKey(projectId));
  
  // Remove all measurements for this project
  const prefix = `takeoffs_${projectId}_`;
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
};

export const getStorageSize = (): { used: number; total: number } => {
  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        used += key.length + value.length;
      }
    }
  }
  
  // Estimate total available (most browsers give ~5-10MB)
  const total = 5 * 1024 * 1024; // 5MB estimate
  
  return { used, total };
};
