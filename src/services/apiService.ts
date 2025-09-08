import axios from 'axios';

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

// Add response interceptor to handle errors gracefully
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
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

    return response.data;
  },

  async getPDF(fileId: string) {
    const response = await apiClient.get(`/files/${fileId}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  async getProjectFiles(projectId: string) {
    const response = await apiClient.get(`/files/project/${projectId}`);
    return response.data;
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
    const response = await apiClient.get(`/conditions/project/${projectId}`);
    return response.data;
  },

  async getCondition(id: string) {
    const response = await apiClient.get(`/conditions/${id}`);
    return response.data;
  },

  async createCondition(conditionData: any) {
    const response = await apiClient.post('/conditions', conditionData);
    return response.data;
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

// Health check
export const healthService = {
  async checkHealth() {
    const response = await apiClient.get('/health');
    return response.data;
  },
};
