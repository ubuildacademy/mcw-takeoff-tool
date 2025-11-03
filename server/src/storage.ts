import { supabase, TABLES } from './supabase';

export interface StoredProject {
  id: string;
  name: string;
  client?: string;
  location?: string;
  status?: 'active' | 'completed' | 'on-hold';
  description?: string;
  projectType?: string;
  startDate?: string;
  estimatedValue?: number;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  profitMarginPercent?: number;
  lastModified?: string;
  createdAt?: string;
}

export interface StoredFileMeta {
  id: string;
  projectId: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: string;
}

export interface StoredSheet {
  id: string;
  documentId: string;
  pageNumber: number;
  sheetNumber?: string;
  sheetName?: string;
  extractedText?: string;
  hasTakeoffs: boolean;
  takeoffCount: number;
  isVisible: boolean;
  ocrProcessed: boolean;
  titleblockConfig?: {
    sheetNumberField: { x: number; y: number; width: number; height: number };
    sheetNameField: { x: number; y: number; width: number; height: number };
  };
  createdAt: string;
  updatedAt: string;
}

export interface StoredCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count' | 'visual-search';
  unit: string;
  wasteFactor: number;
  color: string;
  description?: string;
  laborCost?: number;
  materialCost?: number;
  equipmentCost?: number;
  includePerimeter?: boolean;
  depth?: number;
  // Visual search specific fields
  searchImage?: string;
  searchImageId?: string;
  searchThreshold?: number;
  createdAt: string;
}

export interface StoredTakeoffMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: string;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
  perimeterValue?: number;
  cutouts?: Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    pdfCoordinates: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  netCalculatedValue?: number;
}

class SupabaseStorage {
  // Projects
  async getProjects(): Promise<StoredProject[]> {
    const { data, error } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching projects:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      client: item.client,
      location: item.location,
      status: item.status,
      description: item.description,
      projectType: item.project_type,
      startDate: item.start_date,
      contactPerson: item.contact_person,
      contactEmail: item.contact_email,
      contactPhone: item.contact_phone,
      profitMarginPercent: item.profit_margin_percent,
      createdAt: item.created_at,
      lastModified: item.last_modified
    }));
  }

  async getProject(id: string): Promise<StoredProject | null> {
    const { data, error } = await supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Project not found
      }
      console.error('Error fetching project:', error);
      throw new Error('Failed to fetch project');
    }

    // Map snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      client: data.client,
      location: data.location,
      status: data.status,
      description: data.description,
      projectType: data.project_type,
      startDate: data.start_date,
      contactPerson: data.contact_person,
      contactEmail: data.contact_email,
      contactPhone: data.contact_phone,
      createdAt: data.created_at,
      lastModified: data.last_modified
    };
  }

  async saveProject(project: StoredProject): Promise<StoredProject> {
    // Map camelCase to snake_case for database
    const dbProject = {
      id: project.id,
      name: project.name,
      client: project.client,
      location: project.location,
      status: project.status,
      description: project.description,
      project_type: project.projectType,
      start_date: project.startDate,
      contact_person: project.contactPerson,
      contact_email: project.contactEmail,
      contact_phone: project.contactPhone,
      profit_margin_percent: project.profitMarginPercent,
      created_at: project.createdAt,
      last_modified: project.lastModified
    };
    
    const { data, error } = await supabase
      .from(TABLES.PROJECTS)
      .upsert(dbProject)
      .select()
      .single();
    
    if (error) {
      console.error('Error saving project:', error);
      throw error;
    }
    
    // Map snake_case back to camelCase
    return {
      id: data.id,
      name: data.name,
      client: data.client,
      location: data.location,
      status: data.status,
      description: data.description,
      projectType: data.project_type,
      startDate: data.start_date,
      contactPerson: data.contact_person,
      contactEmail: data.contact_email,
      contactPhone: data.contact_phone,
      profitMarginPercent: data.profit_margin_percent,
      createdAt: data.created_at,
      lastModified: data.last_modified
    };
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLES.PROJECTS)
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting project:', error);
      throw error;
    }
  }

  // Files
  async getFiles(): Promise<StoredFileMeta[]> {
    const { data, error } = await supabase
      .from(TABLES.FILES)
      .select('*')
      .order('uploaded_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching files:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      originalName: item.original_name,
      filename: item.filename,
      path: item.path,
      size: item.size,
      mimetype: item.mimetype,
      uploadedAt: item.uploaded_at
    }));
  }

  async getFilesByProject(projectId: string): Promise<StoredFileMeta[]> {
    const { data, error } = await supabase
      .from(TABLES.FILES)
      .select('*')
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching files by project:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      originalName: item.original_name,
      filename: item.filename,
      path: item.path,
      size: item.size,
      mimetype: item.mimetype,
      uploadedAt: item.uploaded_at
    }));
  }

  async saveFile(file: StoredFileMeta): Promise<StoredFileMeta> {
    // Map camelCase to snake_case for database
    const dbFile = {
      id: file.id,
      project_id: file.projectId,
      original_name: file.originalName,
      filename: file.filename,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploaded_at: file.uploadedAt
    };
    
    const { data, error } = await supabase
      .from(TABLES.FILES)
      .upsert(dbFile)
      .select()
      .single();
    
    if (error) {
      console.error('Error saving file:', error);
      throw error;
    }
    
    // Map snake_case back to camelCase
    return {
      id: data.id,
      projectId: data.project_id,
      originalName: data.original_name,
      filename: data.filename,
      path: data.path,
      size: data.size,
      mimetype: data.mimetype,
      uploadedAt: data.uploaded_at
    };
  }

  async deleteFile(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLES.FILES)
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  // Conditions
  async getConditions(): Promise<StoredCondition[]> {
    const { data, error } = await supabase
      .from(TABLES.CONDITIONS)
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching conditions:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      name: item.name,
      type: item.type,
      unit: item.unit,
      wasteFactor: item.waste_factor,
      color: item.color,
      description: item.description,
      laborCost: item.labor_cost,
      materialCost: item.material_cost,
      equipmentCost: item.equipment_cost,
      includePerimeter: item.include_perimeter,
      depth: item.depth,
      searchImage: item.search_image,
      searchImageId: item.search_image_id,
      searchThreshold: item.search_threshold,
      createdAt: item.created_at,
      ...(item.ai_generated !== undefined && { aiGenerated: item.ai_generated })
    }));
  }

  async getConditionsByProject(projectId: string): Promise<StoredCondition[]> {
    const { data, error } = await supabase
      .from(TABLES.CONDITIONS)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching conditions by project:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      name: item.name,
      type: item.type,
      unit: item.unit,
      wasteFactor: item.waste_factor,
      color: item.color,
      description: item.description,
      laborCost: item.labor_cost,
      materialCost: item.material_cost,
      equipmentCost: item.equipment_cost,
      includePerimeter: item.include_perimeter,
      depth: item.depth,
      searchImage: item.search_image,
      searchImageId: item.search_image_id,
      searchThreshold: item.search_threshold,
      createdAt: item.created_at,
      ...(item.ai_generated !== undefined && { aiGenerated: item.ai_generated })
    }));
  }

  async saveCondition(condition: StoredCondition): Promise<StoredCondition> {
    // Map camelCase to snake_case for database
    const dbCondition: any = {
      id: condition.id,
      project_id: condition.projectId,
      name: condition.name,
      type: condition.type,
      unit: condition.unit,
      waste_factor: condition.wasteFactor,
      color: condition.color,
      description: condition.description,
      labor_cost: condition.laborCost,
      material_cost: condition.materialCost,
      equipment_cost: condition.equipmentCost,
      include_perimeter: condition.includePerimeter,
      depth: condition.depth,
      search_image: condition.searchImage,
      search_image_id: condition.searchImageId,
      search_threshold: condition.searchThreshold,
      created_at: condition.createdAt
    };
    
    // Only include ai_generated if it exists (column might not exist in all database schemas)
    if ((condition as any).aiGenerated !== undefined) {
      dbCondition.ai_generated = (condition as any).aiGenerated;
    }
    
    const { data, error } = await supabase
      .from(TABLES.CONDITIONS)
      .upsert(dbCondition)
      .select()
      .single();
    
    if (error) {
      console.error('Error saving condition:', error);
      throw error;
    }
    
    // Map snake_case back to camelCase
    return {
      id: data.id,
      projectId: data.project_id,
      name: data.name,
      type: data.type,
      unit: data.unit,
      wasteFactor: data.waste_factor,
      color: data.color,
      description: data.description,
      laborCost: data.labor_cost,
      materialCost: data.material_cost,
      equipmentCost: data.equipment_cost,
      includePerimeter: data.include_perimeter,
      depth: data.depth,
      searchImage: data.search_image,
      searchImageId: data.search_image_id,
      searchThreshold: data.search_threshold,
      createdAt: data.created_at,
      ...(data.ai_generated !== undefined && { aiGenerated: data.ai_generated })
    };
  }

  async deleteCondition(id: string): Promise<void> {
    console.log(`🔄 DELETE_CONDITION: Starting deletion of condition ${id}`);
    
    // First, check how many measurements exist for this condition
    const { data: existingMeasurements, error: countError } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('id, condition_id')
      .eq('condition_id', id);
    
    if (countError) {
      console.error('Error counting condition measurements:', countError);
    } else {
      console.log(`📊 DELETE_CONDITION: Found ${existingMeasurements?.length || 0} measurements for condition ${id}`);
    }
    
    // First, delete all measurements associated with this condition
    const { error: measurementsError } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .delete()
      .eq('condition_id', id);
    
    if (measurementsError) {
      console.error('Error deleting condition measurements:', measurementsError);
      throw measurementsError;
    }
    
    console.log(`✅ DELETE_CONDITION: Deleted measurements for condition ${id}`);
    
    // Then delete the condition itself
    const { error } = await supabase
      .from(TABLES.CONDITIONS)
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting condition:', error);
      throw error;
    }
    
    console.log(`✅ DELETE_CONDITION: Deleted condition ${id} and all associated measurements`);
  }

  // Takeoff Measurements
  async getTakeoffMeasurements(): Promise<StoredTakeoffMeasurement[]> {
    const { data, error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching takeoff measurements:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      sheetId: item.sheet_id,
      conditionId: item.condition_id,
      type: item.type,
      points: item.points,
      calculatedValue: item.calculated_value,
      unit: item.unit,
      timestamp: item.timestamp,
      pdfPage: item.pdf_page,
      pdfCoordinates: item.pdf_coordinates,
      conditionColor: item.condition_color,
      conditionName: item.condition_name,
      perimeterValue: item.perimeter_value,
      cutouts: item.cutouts,
      netCalculatedValue: item.net_calculated_value
    }));
  }

  async getTakeoffMeasurementsByProject(projectId: string): Promise<StoredTakeoffMeasurement[]> {
    const { data, error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching takeoff measurements by project:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      sheetId: item.sheet_id,
      conditionId: item.condition_id,
      type: item.type,
      points: item.points,
      calculatedValue: item.calculated_value,
      unit: item.unit,
      timestamp: item.timestamp,
      pdfPage: item.pdf_page,
      pdfCoordinates: item.pdf_coordinates,
      conditionColor: item.condition_color,
      conditionName: item.condition_name,
      perimeterValue: item.perimeter_value,
      cutouts: item.cutouts,
      netCalculatedValue: item.net_calculated_value
    }));
  }

  async getTakeoffMeasurementsBySheet(sheetId: string): Promise<StoredTakeoffMeasurement[]> {
    const { data, error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('*')
      .eq('sheet_id', sheetId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching takeoff measurements by sheet:', error);
      return [];
    }
    
    // Map snake_case to camelCase
    return (data || []).map((item: any) => ({
      id: item.id,
      projectId: item.project_id,
      sheetId: item.sheet_id,
      conditionId: item.condition_id,
      type: item.type,
      points: item.points,
      calculatedValue: item.calculated_value,
      unit: item.unit,
      timestamp: item.timestamp,
      pdfPage: item.pdf_page,
      pdfCoordinates: item.pdf_coordinates,
      conditionColor: item.condition_color,
      conditionName: item.condition_name,
      perimeterValue: item.perimeter_value,
      cutouts: item.cutouts,
      netCalculatedValue: item.net_calculated_value
    }));
  }

  async saveTakeoffMeasurement(measurement: StoredTakeoffMeasurement): Promise<StoredTakeoffMeasurement> {
    // Map camelCase to snake_case for database
    const dbMeasurement = {
      id: measurement.id,
      project_id: measurement.projectId,
      sheet_id: measurement.sheetId,
      condition_id: measurement.conditionId,
      type: measurement.type,
      points: measurement.points,
      calculated_value: measurement.calculatedValue,
      unit: measurement.unit,
      timestamp: measurement.timestamp,
      pdf_page: measurement.pdfPage,
      pdf_coordinates: measurement.pdfCoordinates,
      condition_color: measurement.conditionColor,
      condition_name: measurement.conditionName,
      perimeter_value: measurement.perimeterValue,
      cutouts: measurement.cutouts,
      net_calculated_value: measurement.netCalculatedValue
    };
    
    
    const { data, error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .upsert(dbMeasurement)
      .select()
      .single();
    
    if (error) {
      console.error('❌ ERROR: Failed to save takeoff measurement:', error);
      console.error('❌ ERROR: Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      console.error('❌ ERROR: Full error object:', JSON.stringify(error, null, 2));
      throw new Error(`Database error: ${error.message} (${error.code})`);
    }
    
    // Map snake_case back to camelCase
    return {
      id: data.id,
      projectId: data.project_id,
      sheetId: data.sheet_id,
      conditionId: data.condition_id,
      type: data.type,
      points: data.points,
      calculatedValue: data.calculated_value,
      unit: data.unit,
      timestamp: data.timestamp,
      pdfPage: data.pdf_page,
      pdfCoordinates: data.pdf_coordinates,
      conditionColor: data.condition_color,
      conditionName: data.condition_name,
      perimeterValue: data.perimeter_value,
      cutouts: data.cutouts,
      netCalculatedValue: data.net_calculated_value
    };
  }

  async deleteTakeoffMeasurement(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting takeoff measurement:', error);
      throw error;
    }
  }

  // Sheets
  async getSheets(): Promise<StoredSheet[]> {
    const { data, error } = await supabase
      .from(TABLES.SHEETS)
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error getting sheets:', error);
      throw error;
    }
    
    return data.map((item: any) => ({
      id: item.id,
      documentId: item.document_id,
      pageNumber: item.page_number,
      sheetNumber: item.sheet_number,
      sheetName: item.sheet_name,
      extractedText: item.extracted_text,
      hasTakeoffs: item.has_takeoffs,
      takeoffCount: item.takeoff_count,
      isVisible: item.is_visible,
      ocrProcessed: item.ocr_processed,
      titleblockConfig: item.titleblock_config,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));
  }

  async getSheetsByDocument(documentId: string): Promise<StoredSheet[]> {
    const { data, error } = await supabase
      .from(TABLES.SHEETS)
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });

    if (error) {
      console.error('Error fetching sheets by document:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      documentId: item.document_id,
      pageNumber: item.page_number,
      sheetNumber: item.sheet_number,
      sheetName: item.sheet_name,
      extractedText: item.extracted_text,
      hasTakeoffs: item.has_takeoffs,
      takeoffCount: item.takeoff_count,
      isVisible: item.is_visible,
      ocrProcessed: item.ocr_processed,
      titleblockConfig: item.titleblock_config,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));
  }

  async getSheet(id: string): Promise<StoredSheet | null> {
    try {
      const { data, error } = await supabase
        .from(TABLES.SHEETS)
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        if (error.code === 'PGRST205') {
          // Table doesn't exist yet - return null
          console.log('Sheets table does not exist yet, returning null');
          return null;
        }
        console.error('Error getting sheet:', error);
        throw error;
      }
      
      return {
        id: data.id,
        documentId: data.document_id,
        pageNumber: data.page_number,
        sheetNumber: data.sheet_number,
        sheetName: data.sheet_name,
        extractedText: data.extracted_text,
        hasTakeoffs: data.has_takeoffs,
        takeoffCount: data.takeoff_count,
        isVisible: data.is_visible,
        ocrProcessed: data.ocr_processed,
        titleblockConfig: data.titleblock_config,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };
    } catch (error: any) {
      if (error.code === 'PGRST205') {
        // Table doesn't exist yet - return null
        console.log('Sheets table does not exist yet, returning null');
        return null;
      }
      throw error;
    }
  }

  async saveSheet(sheet: StoredSheet): Promise<StoredSheet> {
    try {
      // Map camelCase to snake_case for database
      const dbSheet = {
        id: sheet.id,
        document_id: sheet.documentId,
        page_number: sheet.pageNumber,
        sheet_number: sheet.sheetNumber,
        sheet_name: sheet.sheetName,
        extracted_text: sheet.extractedText,
        has_takeoffs: sheet.hasTakeoffs,
        takeoff_count: sheet.takeoffCount,
        is_visible: sheet.isVisible,
        ocr_processed: sheet.ocrProcessed,
        titleblock_config: sheet.titleblockConfig,
        created_at: sheet.createdAt,
        updated_at: sheet.updatedAt
      };
      
      const { data, error } = await supabase
        .from(TABLES.SHEETS)
        .upsert(dbSheet)
        .select()
        .single();
      
      if (error) {
        if (error.code === 'PGRST205') {
          // Table doesn't exist yet - return the sheet as-is (no persistence)
          console.log('Sheets table does not exist yet, returning sheet without persistence');
          return sheet;
        }
        console.error('Error saving sheet:', error);
        throw error;
      }
      
      // Map snake_case back to camelCase
      return {
        id: data.id,
        documentId: data.document_id,
        pageNumber: data.page_number,
        sheetNumber: data.sheet_number,
        sheetName: data.sheet_name,
        extractedText: data.extracted_text,
        hasTakeoffs: data.has_takeoffs,
        takeoffCount: data.takeoff_count,
        isVisible: data.is_visible,
        ocrProcessed: data.ocr_processed,
        titleblockConfig: data.titleblock_config,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };
    } catch (error: any) {
      if (error.code === 'PGRST205') {
        // Table doesn't exist yet - return the sheet as-is (no persistence)
        console.log('Sheets table does not exist yet, returning sheet without persistence');
        return sheet;
      }
      throw error;
    }
  }

  async deleteSheet(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLES.SHEETS)
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting sheet:', error);
      throw error;
    }
  }

  // Seed initial data if empty
  async seedInitialData(): Promise<void> {
    // Don't seed placeholder conditions - let users create their own
    console.log('✅ No placeholder conditions seeded');
  }
}

export const storage = new SupabaseStorage();

// Seed initial data
storage.seedInitialData();
