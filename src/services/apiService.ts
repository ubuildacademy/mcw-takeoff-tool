import axios from 'axios';
import { supabase, authHelpers } from '../lib/supabase';
import { getApiBaseUrl } from '../lib/apiConfig';
import type { Project, TakeoffCondition, TakeoffMeasurement } from '../types';

const API_BASE_URL = getApiBaseUrl();

// --- API request/response types (support both camelCase and snake_case from server) ---

/** Raw file from API (snake_case or camelCase) */
interface ApiFileRow {
  id?: string;
  project_id?: string;
  projectId?: string;
  original_name?: string;
  originalName?: string;
  uploaded_at?: string;
  uploadedAt?: string;
  [key: string]: unknown;
}

/** Raw condition from API */
interface ApiConditionRow {
  project_id?: string;
  projectId?: string;
  waste_factor?: number;
  wasteFactor?: number;
  labor_cost?: number;
  laborCost?: number;
  material_cost?: number;
  materialCost?: number;
  equipment_cost?: number;
  equipmentCost?: number;
  include_perimeter?: boolean;
  includePerimeter?: boolean;
  search_image?: string;
  searchImage?: string;
  search_image_id?: string;
  searchImageId?: string;
  search_threshold?: number;
  searchThreshold?: number;
  ai_generated?: boolean;
  aiGenerated?: boolean;
  created_at?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/** Raw measurement from API */
interface ApiMeasurementRow {
  id?: string;
  project_id?: string;
  projectId?: string;
  sheet_id?: string;
  sheetId?: string;
  condition_id?: string;
  conditionId?: string;
  type?: string;
  points?: Array<{ x: number; y: number }>;
  calculated_value?: number;
  calculatedValue?: number;
  pdf_page?: number;
  pdfPage?: number;
  pdf_coordinates?: Array<{ x: number; y: number }>;
  pdfCoordinates?: Array<{ x: number; y: number }>;
  condition_color?: string;
  conditionColor?: string;
  condition_name?: string;
  conditionName?: string;
  perimeter_value?: number;
  perimeterValue?: number;
  area_value?: number;
  areaValue?: number;
  net_calculated_value?: number;
  netCalculatedValue?: number;
  timestamp?: string;
  unit?: string;
  cutouts?: Array<{ id: string; points: Array<{ x: number; y: number }>; pdfCoordinates?: Array<{ x: number; y: number }>; calculatedValue?: number }>;
  stack_order?: number | null;
  stackOrder?: number | null;
  [key: string]: unknown;
}

function normalizeMeasurementPdfPage(raw: ApiMeasurementRow): number {
  const v = Number(raw.pdf_page ?? raw.pdfPage);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

function stackOrderFromApiRow(raw: ApiMeasurementRow): number {
  const n = Number(raw.stack_order ?? raw.stackOrder ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

// Note: In production, we prefer VITE_API_BASE_URL to be set directly in Vercel
// If not set, it falls back to '/api' which relies on vercel.json rewrites
// For best results, set VITE_API_BASE_URL=https://your-railway-url.up.railway.app/api in Vercel

/** Axios client with auth interceptors; use for all authenticated API calls. */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000, // 10 minutes for large file uploads
  headers: {
    'Content-Type': 'application/json',
  },
});

function makeRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// Attach a correlation id so server logs/errors can be traced end-to-end.
apiClient.interceptors.request.use((config) => {
  if (!config.headers) {
    // Axios types allow multiple header shapes; keep this assignment explicit.
    config.headers = {} as any;
  }
  const headers = config.headers as any;
  const existing =
    headers['X-Request-Id'] ??
    headers['x-request-id'];
  if (!existing) {
    headers['X-Request-Id'] = makeRequestId();
  }
  return config;
});

// Attach session token to all API requests; refresh if missing or expired so 401s are avoided.
// If no session yet (e.g. Supabase still restoring from storage), wait briefly and retry once.
apiClient.interceptors.request.use(
  async (config) => {
    try {
      let session = await authHelpers.getValidSession();
      if (!session?.access_token) {
        await new Promise((r) => setTimeout(r, 150));
        session = await authHelpers.getValidSession();
      }
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
      if (config.data instanceof FormData) {
        delete config.headers['Content-Type'];
      }
    } catch (err) {
      console.error('[api] Error getting session for API request:', err);
      try {
        const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET';
        const url = typeof config.url === 'string' ? config.url : '';
        if (url) console.error('[api] Request context:', method, url);
      } catch {
        /* ignore */
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Surface request ids from server responses in dev for faster debugging.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      const requestIdFromHeader = error?.response?.headers?.['x-request-id'];
      const requestIdFromBody = error?.response?.data?.error?.requestId;
      const requestId = requestIdFromBody || requestIdFromHeader;
      if (requestId) {
        console.warn('[api] request failed', {
          url: error?.config?.url,
          method: error?.config?.method,
          status: error?.response?.status,
          requestId,
        });
      }
    }
    return Promise.reject(error);
  }
);

// On 401: retry once after refreshing session; then handle other errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !originalRequest._authRetried) {
      originalRequest._authRetried = true;
      try {
        const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && session?.access_token) {
          originalRequest.headers.Authorization = `Bearer ${session.access_token}`;
          return apiClient.request(originalRequest);
        }
      } catch {
        // Refresh failed; fall through to reject with original 401
      }
    }

    // Treat 404 on individual sheet URLs as expected (new documents)
    if (error.response?.status === 404 &&
        originalRequest?.url?.includes('/sheets/') &&
        !originalRequest?.url?.includes('/sheets/project/')) {
      return Promise.reject({
        ...error,
        isExpected404: true,
        message: 'Sheet not found (expected for new documents)'
      });
    }

    // Treat 404 on settings as expected (setting not yet saved to database)
    const isSettings404 =
      error.response?.status === 404 &&
      typeof originalRequest?.url === 'string' &&
      /\/settings\/[^/]+$/.test(originalRequest.url);
    if (isSettings404) {
      return Promise.reject({
        ...error,
        isExpected404: true,
        message: 'Setting not found (expected for unsaved settings)'
      });
    }

    // Skip logging 401/403 to reduce console noise when settings require admin auth
    const status = error.response?.status;
    if (import.meta.env.DEV && status !== 401 && status !== 403) {
      console.warn('API Error:', error.message);
    }

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
      timeout: 600000, // 10 minutes for large file uploads
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / (progressEvent.total || 1)
        );
        if (import.meta.env.DEV) console.log(`Upload progress: ${percentCompleted}%`);
      },
    });

    // OCR is started on the server when the file is saved (see server routes/files upload).
    // Avoid duplicating jobs here.

    return response.data;
  },

  async getPDF(fileId: string) {
    const response = await apiClient.get(`/files/${fileId}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  async getProjectFiles(projectId: string) {
    // Fetching project files
    const response = await apiClient.get(`/files/project/${projectId}`);
    
    // Transform field names from snake_case to camelCase
    const transformedFiles = response.data.files?.map((file: ApiFileRow) => ({
      ...file,
      projectId: file.project_id || file.projectId,
      originalName: file.original_name || file.originalName,
      uploadedAt: file.uploaded_at || file.uploadedAt
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
  async createProject(projectData: Partial<Project> & Pick<Project, 'name' | 'client' | 'location' | 'status'>) {
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

  async updateProject(id: string, updates: Partial<Project>) {
    const response = await apiClient.put(`/projects/${id}`, updates);
    return response.data;
  },

  async deleteProject(id: string) {
    const response = await apiClient.delete(`/projects/${id}`);
    return response.data;
  },

  async shareProject(
    projectId: string,
    params: {
      recipients: string[];
      message?: string;
      annotations?: unknown[];
      documentRotations?: Record<string, number>;
      documentRotationsBySheet?: Record<string, number>;
      hyperlinks?: unknown[];
    }
  ) {
    const response = await apiClient.post(`/projects/${projectId}/share-project`, params);
    return response.data;
  },

  async importSharedProject(token: string) {
    const response = await apiClient.post(`/shared-import/${token}`);
    return response.data;
  },

  async sendReport(
    projectId: string,
    params:
      | { file: Blob; filename: string; recipients: string[]; format: 'excel' | 'pdf'; message?: string; deliveryMethod?: 'attachment' | 'link' }
      | { files: Array<{ file: Blob; filename: string }>; recipients: string[]; format: 'both'; message?: string; deliveryMethod?: 'attachment' | 'link' }
  ) {
    const formData = new FormData();
    if ('files' in params) {
      formData.append('file', params.files[0].file, params.files[0].filename);
      formData.append('file2', params.files[1].file, params.files[1].filename);
    } else {
      formData.append('file', params.file, params.filename);
    }
    formData.append('recipients', JSON.stringify(params.recipients));
    formData.append('format', params.format);
    if (params.message) formData.append('message', params.message);
    if (params.deliveryMethod === 'link') formData.append('deliveryMethod', 'link');
    const response = await apiClient.post(`/projects/${projectId}/send-report`, formData, {
      timeout: 90000,
    });
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
      if (import.meta.env.DEV) console.log('✅ API_GET_PROJECT_CONDITIONS: API call successful:', response.data);
      
      // Backend now returns camelCase fields, so just return as-is
      // Transform field names from snake_case to camelCase (backward compatibility)
      const transformedConditions = response.data.conditions?.map((condition: ApiConditionRow) => ({
        ...condition,
        // Map snake_case fields if they exist (for backward compatibility)
        projectId: condition.project_id || condition.projectId,
        wasteFactor: condition.waste_factor || condition.wasteFactor,
        laborCost: condition.labor_cost || condition.laborCost,
        materialCost: condition.material_cost || condition.materialCost,
        equipmentCost: condition.equipment_cost || condition.equipmentCost,
        includePerimeter: condition.include_perimeter !== undefined ? condition.include_perimeter : condition.includePerimeter,
        depth: condition.depth,
        searchImage: condition.search_image || condition.searchImage,
        searchImageId: condition.search_image_id || condition.searchImageId,
        searchThreshold: condition.search_threshold || condition.searchThreshold,
        aiGenerated: condition.ai_generated !== undefined ? condition.ai_generated : condition.aiGenerated,
        createdAt: condition.created_at || condition.createdAt
      })) || [];
      
      return { conditions: transformedConditions };
    } catch (error) {
      if (import.meta.env.DEV) console.error('❌ API_GET_PROJECT_CONDITIONS: API call failed:', error);
      throw error;
    }
  },

  async getCondition(id: string) {
    const response = await apiClient.get(`/conditions/${id}`);
    return response.data;
  },

  async createCondition(conditionData: Omit<TakeoffCondition, 'id'> | Partial<TakeoffCondition>) {
    if (import.meta.env.DEV) console.log('🌐 API_CREATE_CONDITION: Making API call with data:', conditionData);
    try {
      const response = await apiClient.post('/conditions', conditionData);
      if (import.meta.env.DEV) console.log('✅ API_CREATE_CONDITION: API call successful:', response.data);
      return response.data;
    } catch (error) {
      if (import.meta.env.DEV) console.error('❌ API_CREATE_CONDITION: API call failed:', error);
      throw error;
    }
  },

  async updateCondition(id: string, updates: Partial<TakeoffCondition>) {
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
  async login(email: string, password: string) {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
  },

  async register(userData: { email: string; password?: string; [key: string]: unknown }) {
    const response = await apiClient.post('/auth/register', userData);
    return response.data;
  },

  async getCurrentUser() {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  /** Validate an invitation token. Returns { email, role } if valid. No auth required. */
  async validateInvite(token: string): Promise<{ email: string; role: string } | null> {
    try {
      const base = getApiBaseUrl();
      const url = base.startsWith('http') ? `${base}/auth/validate-invite/${token}` : `${window.location.origin}${base}/auth/validate-invite/${token}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.email && data?.role ? { email: data.email, role: data.role } : null;
    } catch {
      return null;
    }
  },

  /** Accept invitation after signup. Requires authenticated session. */
  async acceptInvitation(token: string, userData: { full_name?: string; company?: string }): Promise<void> {
    const res = await apiClient.post('/auth/accept-invitation', {
      token,
      full_name: userData.full_name,
      company: userData.company,
    });
    if (!res.data?.success) {
      throw new Error('Failed to complete invitation');
    }
  },

  /** Complete signup for users who created an account via shared project link. Always assigns role: user. */
  async completeSharedSignup(userData: { full_name?: string; company?: string }): Promise<void> {
    const res = await apiClient.post('/auth/complete-shared-signup', {
      full_name: userData.full_name,
      company: userData.company,
    });
    if (!res.data?.success) {
      throw new Error('Failed to complete account setup');
    }
  },
};

// Calibration service
export const calibrationService = {
  async getCalibration(projectId: string, sheetId: string, pageNumber?: number) {
    const params = pageNumber !== undefined ? `?pageNumber=${pageNumber}` : '';
    const response = await apiClient.get(`/calibrations/project/${projectId}/sheet/${sheetId}${params}`);
    return response.data.calibration;
  },

  async getCalibrationsByProject(projectId: string) {
    const response = await apiClient.get(`/calibrations/project/${projectId}`);
    return response.data.calibrations || [];
  },

  async saveCalibration(
    projectId: string, 
    sheetId: string, 
    scaleFactor: number, 
    unit: string,
    scope?: 'page' | 'document',
    pageNumber?: number | null,
    viewportWidth?: number | null,
    viewportHeight?: number | null,
    rotation?: number | null
  ) {
    const response = await apiClient.post('/calibrations', {
      projectId,
      sheetId,
      scaleFactor,
      unit,
      scope: scope || 'page',
      pageNumber,
      viewportWidth,
      viewportHeight,
      rotation
    });
    return response.data.calibration;
  }
};

// User management service (for admin functions)
export const userService = {
  async createInvitation(email: string, role: 'admin' | 'user') {
    const response = await apiClient.post('/users/invitations', { email, role });
    return response.data;
  },

  async getInvitations() {
    const response = await apiClient.get('/users/invitations');
    return response.data;
  },

  async deleteInvitation(invitationId: string) {
    const response = await apiClient.delete(`/users/invitations/${invitationId}`);
    return response.data;
  },

  async updateUserRole(userId: string, role: 'admin' | 'user') {
    const response = await apiClient.patch(`/users/${userId}/role`, { role });
    return response.data;
  },

  async deleteUser(userId: string) {
    const response = await apiClient.delete(`/users/${userId}`);
    return response.data;
  },

  /** Delete the current user's own account (self-service). Deletes all user projects, then the account. */
  async deleteOwnAccount() {
    const response = await apiClient.delete('/users/me');
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

  /** Sidebar: one POST for many sheet ids instead of N GETs when opening a project. */
  async batchSheetMetadata(projectId: string, sheetIds: string[]) {
    const response = await apiClient.post(`/sheets/batch-metadata`, { projectId, sheetIds });
    return response.data as {
      sheetsById?: Record<
        string,
        {
          id?: string;
          sheetName?: string;
          sheetNumber?: string;
          hasTakeoffs?: boolean;
          takeoffCount?: number;
          isVisible?: boolean;
        }
      >;
    };
  },

  async updateSheet(sheetId: string, updates: Record<string, unknown>) {
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
    
    if (import.meta.env.DEV) {
      console.log('📥 API_GET_PROJECT_TAKEOFF_MEASUREMENTS: Raw response:', response.data);
    }
    
    // Backend now returns camelCase fields, but support both formats for backward compatibility
    const transformedMeasurements = (response.data.measurements || []).map((measurement: ApiMeasurementRow): TakeoffMeasurement => {
      const transformed = {
        id: measurement.id ?? '',
        projectId: measurement.project_id ?? measurement.projectId ?? '',
        sheetId: measurement.sheet_id ?? measurement.sheetId ?? '',
        conditionId: measurement.condition_id ?? measurement.conditionId ?? '',
        type: (measurement.type as TakeoffMeasurement['type']) ?? 'linear',
        points: measurement.points ?? [],
        calculatedValue: measurement.calculated_value !== undefined && measurement.calculated_value !== null
          ? measurement.calculated_value
          : (measurement.calculatedValue ?? 0),
        unit: measurement.unit ?? '',
        timestamp: measurement.timestamp ?? new Date().toISOString(),
        pdfPage: normalizeMeasurementPdfPage(measurement),
        pdfCoordinates: measurement.pdf_coordinates ?? measurement.pdfCoordinates ?? [],
        conditionColor: measurement.condition_color ?? measurement.conditionColor ?? '#000000',
        conditionName: measurement.condition_name ?? measurement.conditionName ?? 'Unknown',
        ...(measurement.perimeter_value !== undefined || measurement.perimeterValue !== undefined) && {
          perimeterValue: measurement.perimeter_value ?? measurement.perimeterValue
        },
        ...(measurement.area_value !== undefined || measurement.areaValue !== undefined) && {
          areaValue: measurement.area_value ?? measurement.areaValue
        },
        ...(measurement.cutouts && { cutouts: measurement.cutouts }),
        ...(measurement.net_calculated_value !== undefined || measurement.netCalculatedValue !== undefined) && {
          netCalculatedValue: measurement.net_calculated_value ?? measurement.netCalculatedValue
        },
        stackOrder: stackOrderFromApiRow(measurement)
      } as TakeoffMeasurement;
      if (import.meta.env.DEV && !transformed.conditionId) {
        console.warn('⚠️ Measurement missing conditionId:', transformed);
      }
      return transformed;
    });
    if (import.meta.env.DEV) {
      console.log('📤 API_GET_PROJECT_TAKEOFF_MEASUREMENTS: Transformed measurements:', transformedMeasurements);
    }
    
    return { measurements: transformedMeasurements };
  },

  async getSheetTakeoffMeasurements(sheetId: string) {
    const response = await apiClient.get(`/takeoff-measurements/sheet/${sheetId}`);
    return response.data;
  },

  async getPageTakeoffMeasurements(sheetId: string, pageNumber: number) {
    const response = await apiClient.get(`/takeoff-measurements/sheet/${sheetId}/page/${pageNumber}`);
    
    // Backend now returns camelCase fields, but support both formats for backward compatibility
    const transformedMeasurements = (response.data.measurements || []).map((measurement: ApiMeasurementRow): TakeoffMeasurement => {
      const transformed = {
        id: measurement.id ?? '',
        projectId: measurement.project_id ?? measurement.projectId ?? '',
        sheetId: measurement.sheet_id ?? measurement.sheetId ?? '',
        conditionId: measurement.condition_id ?? measurement.conditionId ?? '',
        type: (measurement.type as TakeoffMeasurement['type']) ?? 'linear',
        points: measurement.points ?? [],
        calculatedValue: measurement.calculated_value ?? measurement.calculatedValue ?? 0,
        unit: measurement.unit ?? '',
        timestamp: measurement.timestamp ?? new Date().toISOString(),
        pdfPage: normalizeMeasurementPdfPage(measurement),
        pdfCoordinates: measurement.pdf_coordinates ?? measurement.pdfCoordinates ?? [],
        conditionColor: measurement.condition_color ?? measurement.conditionColor ?? '#000000',
        conditionName: measurement.condition_name ?? measurement.conditionName ?? 'Unknown',
        ...(measurement.perimeter_value !== undefined || measurement.perimeterValue !== undefined) && {
          perimeterValue: measurement.perimeter_value ?? measurement.perimeterValue
        },
        ...(measurement.area_value !== undefined || measurement.areaValue !== undefined) && {
          areaValue: measurement.area_value ?? measurement.areaValue
        },
        ...(measurement.cutouts && { cutouts: measurement.cutouts }),
        ...(measurement.net_calculated_value !== undefined || measurement.netCalculatedValue !== undefined) && {
          netCalculatedValue: measurement.net_calculated_value ?? measurement.netCalculatedValue
        },
        stackOrder: stackOrderFromApiRow(measurement)
      } as TakeoffMeasurement;
      if (import.meta.env.DEV && !transformed.conditionId) {
        console.warn('⚠️ Measurement missing conditionId:', transformed);
      }
      return transformed;
    });
    
    return { measurements: transformedMeasurements };
  },

  async createTakeoffMeasurement(
    measurementData: Omit<TakeoffMeasurement, 'id'> | Partial<TakeoffMeasurement>,
    options?: { signal?: AbortSignal }
  ) {
    if (import.meta.env.DEV) console.log('🌐 API_CREATE_TAKEOFF_MEASUREMENT: Making API call with data:', measurementData);
    try {
      const response = await apiClient.post('/takeoff-measurements', measurementData, {
        signal: options?.signal,
      });
      if (import.meta.env.DEV) console.log('✅ API_CREATE_TAKEOFF_MEASUREMENT: API call successful:', response.data);
      return response.data;
    } catch (error) {
      if (import.meta.env.DEV) console.error('❌ API_CREATE_TAKEOFF_MEASUREMENT: API call failed:', error);
      throw error;
    }
  },

  async updateTakeoffMeasurement(id: string, updates: Partial<TakeoffMeasurement>) {
    const response = await apiClient.put(`/takeoff-measurements/${id}`, updates);
    return response.data;
  },

  /** Single request to persist many stackOrder values (layer / z-order). */
  async batchUpdateTakeoffMeasurementStackOrder(updates: { id: string; stackOrder: number }[]) {
    const response = await apiClient.post('/takeoff-measurements/batch/stack-order', { updates });
    return response.data;
  },

  async deleteTakeoffMeasurement(id: string) {
    const response = await apiClient.delete(`/takeoff-measurements/${id}`);
    return response.data;
  },
};

// Settings service
export const settingsService = {
  async getSettings() {
    const response = await apiClient.get('/settings');
    return response.data;
  },

  async getSetting(key: string) {
    const response = await apiClient.get(`/settings/${key}`);
    return response.data;
  },

  async updateSetting(key: string, value: unknown) {
    const response = await apiClient.put(`/settings/${key}`, { value });
    return response.data;
  },

  async updateSettings(settings: Record<string, unknown>) {
    const response = await apiClient.put('/settings', { settings });
    return response.data;
  }
};

// OCR API (server-side REST endpoints)
export const ocrApiService = {
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
    const params = new URLSearchParams({
      query,
      projectId,
    });
    const response = await apiClient.get(`/ocr/search/${documentId}?${params.toString()}`);
    return response.data;
  },

  /** Which file IDs in this project have at least one OCR row (source of truth vs N× /results calls). */
  async getProjectDocumentIdsWithOcr(projectId: string): Promise<{ documentIds: string[] }> {
    const params = new URLSearchParams({ projectId });
    const response = await apiClient.get(`/ocr/documents-with-ocr?${params.toString()}`);
    return response.data;
  },

  async getDocumentResults(documentId: string, projectId: string) {
    const params = new URLSearchParams({ projectId });
    const response = await apiClient.get(`/ocr/results/${documentId}?${params.toString()}`);
    return response.data;
  },

  async getDocumentWordBoxes(documentId: string, projectId: string, pageNumber: number, query?: string) {
    const params = new URLSearchParams({
      projectId,
      pageNumber: String(pageNumber),
    });
    if (query && query.trim().length > 0) {
      params.set('query', query.trim());
    }
    const response = await apiClient.get(`/ocr/word-boxes/${documentId}?${params.toString()}`);
    return response.data as {
      documentId: string;
      projectId: string;
      pageNumber: number;
      query: string;
      boxes: Array<{
        index: number;
        text: string;
        confidence: number;
        bbox: { x: number; y: number; width: number; height: number };
        source: 'pdfjs' | 'tesseract';
        ocrRotationDeg?: number;
      }>;
      total: number;
    };
  },

  async submitClientResults(documentId: string, projectId: string, results: unknown[], jobId?: string) {
    const response = await apiClient.post(`/ocr/client-results/${documentId}`, {
      projectId,
      results,
      jobId
    });
    return response.data;
  },
};

// Titleblock Extraction Service (async job: POST returns jobId, then poll until done)
export const titleblockService = {
  async extractTitleblock(
    projectId: string,
    documentIds: string[],
    titleblockConfig: {
      sheetNumberField: { x: number; y: number; width: number; height: number };
      sheetNameField: { x: number; y: number; width: number; height: number };
      templatePageNumber?: number;
    },
    signal?: AbortSignal,
    onJobProgress?: (p: {
      progress: number;
      processedPages?: number;
      totalPages?: number;
    }) => void
  ): Promise<{ success: boolean; results?: unknown[]; error?: string }> {
    const enqueue = await apiClient.post(
      '/titleblock/extract',
      { projectId, documentIds, titleblockConfig },
      { signal }
    );
    const { jobId } = enqueue.data as { jobId?: string };
    if (!jobId) {
      throw new Error('Server did not return a job id for titleblock extraction');
    }

    const pollMs = 1500;
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const { data } = await apiClient.get<{
        status: string;
        progress?: number;
        processedPages?: number;
        totalPages?: number;
        result: { success: boolean; results?: unknown[] } | null;
        error: string | null;
      }>(`/titleblock/extract/job/${jobId}`, { signal });

      onJobProgress?.({
        progress: typeof data.progress === 'number' ? data.progress : 0,
        processedPages: data.processedPages,
        totalPages: data.totalPages,
      });

      if (data.status === 'completed' && data.result) {
        return data.result as { success: boolean; results?: unknown[] };
      }
      if (data.status === 'failed') {
        throw new Error(data.error || 'Titleblock extraction failed');
      }

      await new Promise((r) => setTimeout(r, pollMs));
    }
  },
};

// Health check
export const healthService = {
  async checkHealth() {
    const response = await apiClient.get('/health');
    return response.data;
  },
};
