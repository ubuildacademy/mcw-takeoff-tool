import axios from 'axios';
import { supabase } from '../lib/supabase';

const API_BASE_URL = process.env.NODE_ENV === 'production'
  ? 'https://mcw-takeoff-tool-backend.vercel.app/api' // We'll deploy backend separately
  : 'http://localhost:4000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // Reduced timeout for better UX
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include authentication token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.error('Error getting session for API request:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle errors gracefully
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Suppress 404 errors for individual sheet requests since they're expected for new documents
    if (error.response?.status === 404 && 
        error.config?.url?.includes('/sheets/') && 
        !error.config?.url?.includes('/sheets/project/')) {
      // Don't log these as they're normal when individual sheets don't exist yet
      // Return a structured error that can be handled gracefully
      return Promise.reject({
        ...error,
        isExpected404: true,
        message: 'Sheet not found (expected for new documents)'
      });
    }
    
    // Log other errors
    console.warn('API Error:', error.message);
    
    // Return a mock response structure for failed requests
    if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') {
      return Promise.reject({
        ...error,
        isOffline: true,
        message: 'Backend server is not available. Running in offline mode.'
      });
    }
    return Promise.reject(error);
  }
);

// File upload service
export const fileService = {
  async uploadPDF(file: File, projectId: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', projectId);

    const response = await apiClient.post('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / (progressEvent.total || 1)
        );
        console.log(`Upload progress: ${percentCompleted}%`);
      },
    });

    // Automatically start OCR processing after successful upload
    if (response.data.success && response.data.file) {
      const { ocrService } = await import('./ocrService');
      
      // Start OCR processing in background (don't await)
      ocrService.processDocument(response.data.file.id, projectId)
        .then(() => {
          console.log(`✅ OCR processing completed for ${response.data.file.originalName}`);
        })
        .catch((error) => {
          console.error(`❌ OCR processing failed for ${response.data.file.originalName}:`, error);
          // Don't throw the error, just log it since OCR is optional
        });
    }

    return response.data;
  },

  async getPDF(fileId: string) {
    const response = await apiClient.get(`/files/${fileId}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  async getProjectFiles(projectId: string) {
    console.log('🔍 fileService.getProjectFiles: projectId =', projectId);
    const response = await apiClient.get(`/files/project/${projectId}`);
    
    // Transform field names from snake_case to camelCase
    const transformedFiles = response.data.files?.map((file: any) => ({
      ...file,
      projectId: file.project_id,
      originalName: file.original_name,
      uploadedAt: file.uploaded_at
    })) || [];
    
    return { files: transformedFiles };
  },

  async deletePDF(fileId: string) {
    const response = await apiClient.delete(`/files/${fileId}`);
    return response.data;
  },
};

// Project service
export const projectService = {
  async createProject(projectData: any) {
    const response = await apiClient.post('/projects', projectData);
    return response.data;
  },

  async getProjects() {
    const response = await apiClient.get('/projects');
    return response.data;
  },

  async getProject(id: string) {
    const response = await apiClient.get(`/projects/${id}`);
    return response.data;
  },

  async getProjectFull(id: string) {
    const response = await apiClient.get(`/projects/${id}/full`);
    return response.data;
  },

  async updateProject(id: string, updates: any) {
    const response = await apiClient.put(`/projects/${id}`, updates);
    return response.data;
  },

  async deleteProject(id: string) {
    const response = await apiClient.delete(`/projects/${id}`);
    return response.data;
  },
};

// Conditions service
export const conditionService = {
  async getConditions() {
    const response = await apiClient.get('/conditions');
    return response.data;
  },

  async getProjectConditions(projectId: string) {
    console.log('🌐 API_GET_PROJECT_CONDITIONS: Making API call for project:', projectId);
    try {
      const response = await apiClient.get(`/conditions/project/${projectId}`);
      console.log('✅ API_GET_PROJECT_CONDITIONS: API call successful:', response.data);
      
      // Transform field names from snake_case to camelCase
      const transformedConditions = response.data.conditions?.map((condition: any) => ({
        ...condition,
        projectId: condition.project_id,
        wasteFactor: condition.waste_factor,
        laborCost: condition.labor_cost,
        materialCost: condition.material_cost,
        equipmentCost: condition.equipment_cost,
        includePerimeter: condition.include_perimeter,
        createdAt: condition.created_at
      })) || [];
      
      return { conditions: transformedConditions };
    } catch (error) {
      console.error('❌ API_GET_PROJECT_CONDITIONS: API call failed:', error);
      throw error;
    }
  },

  async getCondition(id: string) {
    const response = await apiClient.get(`/conditions/${id}`);
    return response.data;
  },

  async createCondition(conditionData: any) {
    console.log('🌐 API_CREATE_CONDITION: Making API call with data:', conditionData);
    try {
      const response = await apiClient.post('/conditions', conditionData);
      console.log('✅ API_CREATE_CONDITION: API call successful:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ API_CREATE_CONDITION: API call failed:', error);
      throw error;
    }
  },

  async updateCondition(id: string, updates: any) {
    const response = await apiClient.put(`/conditions/${id}`, updates);
    return response.data;
  },

  async deleteCondition(id: string) {
    const response = await apiClient.delete(`/conditions/${id}`);
    return response.data;
  },

  async duplicateCondition(id: string) {
    const response = await apiClient.post(`/conditions/${id}/duplicate`);
    return response.data;
  },
};

// Auth service
export const authService = {
  async login(username: string, password: string) {
    const response = await apiClient.post('/auth/login', { username, password });
    return response.data;
  },

  async register(userData: any) {
    const response = await apiClient.post('/auth/register', userData);
    return response.data;
  },

  async getCurrentUser() {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },
};

// Sheets service
export const sheetService = {
  async getProjectSheets(projectId: string) {
    const response = await apiClient.get(`/sheets/project/${projectId}`);
    return response.data;
  },

  async getSheet(sheetId: string) {
    const response = await apiClient.get(`/sheets/${sheetId}`);
    return response.data;
  },

  async updateSheet(sheetId: string, updates: any) {
    const response = await apiClient.put(`/sheets/${sheetId}`, updates);
    return response.data;
  },

  async processOCR(sheetId: string, pageNumbers: number[]) {
    const response = await apiClient.post(`/sheets/${sheetId}/ocr`, { pageNumbers });
    return response.data;
  },


};

// Takeoff Measurements service
export const takeoffMeasurementService = {
  async getTakeoffMeasurements() {
    const response = await apiClient.get('/takeoff-measurements');
    return response.data;
  },

  async getProjectTakeoffMeasurements(projectId: string) {
    const response = await apiClient.get(`/takeoff-measurements/project/${projectId}`);
    
    // Transform field names from snake_case to camelCase
    const transformedMeasurements = response.data.measurements?.map((measurement: any) => ({
      ...measurement,
      projectId: measurement.project_id,
      sheetId: measurement.sheet_id,
      conditionId: measurement.condition_id,
      calculatedValue: measurement.calculated_value,
      pdfPage: measurement.pdf_page,
      pdfCoordinates: measurement.pdf_coordinates,
      conditionColor: measurement.condition_color,
      conditionName: measurement.condition_name,
      perimeterValue: measurement.perimeter_value,
      netCalculatedValue: measurement.net_calculated_value,
      createdAt: measurement.created_at
    })) || [];
    
    return { measurements: transformedMeasurements };
  },

  async getSheetTakeoffMeasurements(sheetId: string) {
    const response = await apiClient.get(`/takeoff-measurements/sheet/${sheetId}`);
    return response.data;
  },

  async createTakeoffMeasurement(measurementData: any) {
    console.log('🌐 API_CREATE_TAKEOFF_MEASUREMENT: Making API call with data:', measurementData);
    try {
      const response = await apiClient.post('/takeoff-measurements', measurementData);
      console.log('✅ API_CREATE_TAKEOFF_MEASUREMENT: API call successful:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ API_CREATE_TAKEOFF_MEASUREMENT: API call failed:', error);
      throw error;
    }
  },

  async updateTakeoffMeasurement(id: string, updates: any) {
    const response = await apiClient.put(`/takeoff-measurements/${id}`, updates);
    return response.data;
  },

  async deleteTakeoffMeasurement(id: string) {
    const response = await apiClient.delete(`/takeoff-measurements/${id}`);
    return response.data;
  },
};

// OCR service
export const ocrService = {
  async processDocument(documentId: string, projectId: string) {
    // Use the correct OCR endpoint that matches the backend
    const response = await apiClient.post(`/ocr/process-document/${documentId}`, {
      projectId
    });
    return response.data;
  },

  async getJobStatus(jobId: string) {
    const response = await apiClient.get(`/ocr/status/${jobId}`);
    return response.data;
  },

  async searchDocument(documentId: string, query: string, projectId: string) {
    const response = await apiClient.get(`/ocr/search/${documentId}?query=${encodeURIComponent(query)}&projectId=${projectId}`);
    return response.data;
  },

  async getDocumentResults(documentId: string, projectId: string) {
    const response = await apiClient.get(`/ocr/results/${documentId}?projectId=${projectId}`);
    return response.data;
  },
};

// AI Analysis service
export const aiAnalysisService = {

  // Analyze sheets using text-based AI (fallback method)
  async analyzeSheetsWithText(documentId: string, projectId: string, customPrompt?: string) {
    const response = await fetch(`${API_BASE_URL}/ollama/analyze-sheets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documentId,
        projectId,
        customPrompt
      })
    });

    if (!response.ok) {
      throw new Error(`Text analysis failed: ${response.statusText}`);
    }

    return response;
  },

  // Analyze sheets using text-based AI
  async analyzeSheets(documentId: string, projectId: string, customPrompt?: string) {
    return await this.analyzeSheetsWithText(documentId, projectId, customPrompt);
  },

  // Unified document analysis - combines simple OCR + AI sheet labeling
  async analyzeDocumentComplete(documentId: string, projectId: string) {
    // Step 1: Run OCR processing first
    const ocrResponse = await fetch(`${API_BASE_URL}/ocr/process-document/${documentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId
      })
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR processing failed: ${ocrResponse.statusText}`);
    }

    const ocrResult = await ocrResponse.json();
    const jobId = ocrResult.jobId;

    // Step 2: Wait for OCR to complete
    let ocrCompleted = false;
    while (!ocrCompleted) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const statusResponse = await fetch(`${API_BASE_URL}/ocr/status/${jobId}`);
      const status = await statusResponse.json();
      
      if (status.status === 'completed') {
        ocrCompleted = true;
      } else if (status.status === 'failed') {
        throw new Error(`OCR processing failed: ${status.error}`);
      }
    }

    // Step 3: Run AI sheet analysis with custom prompt from admin panel
    const customPrompt = localStorage.getItem('ai-page-labeling-prompt');
    const response = await fetch(`${API_BASE_URL}/ollama/analyze-sheets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documentId,
        projectId,
        customPrompt
      })
    });

    if (!response.ok) {
      throw new Error(`AI sheet analysis failed: ${response.statusText}`);
    }

    return response;
  },
};

// Health check
export const healthService = {
  async checkHealth() {
    const response = await apiClient.get('/health');
    return response.data;
  },
};
