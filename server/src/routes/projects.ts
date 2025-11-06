import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import { storage, StoredProject } from '../storage';
import { supabase, TABLES } from '../supabase';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

const router = express.Router();

// Helper function to get authenticated user from request
async function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  console.log('🔐 Auth header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No valid Bearer token');
    return null;
  }
  
  const token = authHeader.substring(7);
  console.log('🎫 Token length:', token.length);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error) {
    console.log('❌ Token verification error:', error.message);
    return null;
  }
  
  if (!user) {
    console.log('❌ No user from token');
    return null;
  }
  
  console.log('✅ User authenticated:', user.id, user.email);
  return user;
}

// Helper function to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  console.log('🔍 Checking admin status for user:', userId);
  
  const { data, error } = await supabase
    .from('user_metadata')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.log('❌ Error checking admin status:', error.message);
    return false;
  }
  
  if (!data) {
    console.log('❌ No user metadata found');
    return false;
  }
  
  const isAdminUser = data.role === 'admin';
  console.log('🔑 User role:', data.role, 'Is admin:', isAdminUser);
  return isAdminUser;
}

router.get('/', async (req, res) => {
  try {
    console.log('🔍 GET /projects - Headers:', req.headers.authorization ? 'Auth header present' : 'No auth header');
    
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    console.log('👤 Authenticated user:', user ? `${user.id} (${user.email})` : 'None');
    
    if (!user) {
      console.log('❌ No authenticated user, returning 401');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    console.log('🔑 User is admin:', userIsAdmin);
    
    // Build query based on user role
    let query = supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .order('last_modified', { ascending: false });
    
    // If not admin, only show user's own projects
    if (!userIsAdmin) {
      query = query.eq('user_id', user.id);
      console.log('🔒 Filtering projects for user:', user.id);
    } else {
      console.log('👑 Admin user - showing all projects');
    }
    
    const { data: projects, error } = await query;
    console.log('📋 Query result:', { projectsCount: projects?.length || 0, error: error?.message });
    
    if (error) {
      console.error('Error fetching projects:', error);
      return res.status(500).json({ error: 'Failed to fetch projects' });
    }
    
    // Calculate takeoff counts for each project
    const projectsWithCounts = await Promise.all(
      (projects || []).map(async (project) => {
        try {
          const { data: measurements } = await supabase
            .from(TABLES.TAKEOFF_MEASUREMENTS)
            .select('id')
            .eq('project_id', project.id);
          
          const takeoffCount = measurements?.length || 0;
          
          return {
            ...project,
            takeoffCount,
            totalValue: 0 // Set to 0 since we don't have pricing information
          };
        } catch (error) {
          console.error(`Error calculating takeoff count for project ${project.id}:`, error);
          return {
            ...project,
            takeoffCount: 0,
            totalValue: 0
          };
        }
      })
    );
    
    return res.json({ projects: projectsWithCounts });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/', async (req, res) => {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const incoming = req.body as Partial<StoredProject>;
    const project: StoredProject = {
      id,
      name: incoming.name || 'Untitled',
      client: incoming.client,
      location: incoming.location,
      status: (incoming.status as any) || 'active',
      description: incoming.description,
      projectType: incoming.projectType,
      startDate: incoming.startDate,
      estimatedValue: incoming.estimatedValue,
      contactPerson: incoming.contactPerson,
      contactEmail: incoming.contactEmail,
      contactPhone: incoming.contactPhone,
      createdAt: now,
      lastModified: now
    };
    const savedProject = await storage.saveProject(project);
    return res.status(201).json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error creating project:', error);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const projects = await storage.getProjects();
    const project = projects.find(p => p.id === id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Calculate takeoff count for this project
    try {
      const measurements = await storage.getTakeoffMeasurementsByProject(project.id);
      const takeoffCount = measurements.length;
      
      // Note: We don't calculate totalValue here since calculatedValue represents
      // measurement quantities (SF, LF, etc.) not monetary values
      // Total value would need to be calculated using condition pricing if available
      
      const projectWithCounts = {
        ...project,
        takeoffCount,
        totalValue: 0 // Set to 0 since we don't have pricing information
      };
      
      return res.json({ project: projectWithCounts });
    } catch (error) {
      console.error(`Error calculating takeoff count for project ${project.id}:`, error);
      const projectWithCounts = {
        ...project,
        takeoffCount: 0,
        totalValue: 0
      };
      return res.json({ project: projectWithCounts });
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.get('/:id/conditions', (req, res) => {
  const { id } = req.params;
  
  // This endpoint is deprecated - use /api/conditions/project/:projectId instead
  // Keeping for backward compatibility but returning empty array
  return res.json({ conditions: [] });
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const projects = await storage.getProjects();
    const existingProject = projects.find(p => p.id === id);
    if (!existingProject) return res.status(404).json({ error: 'Not found' });
    
    const updates = req.body as Partial<StoredProject>;
    const updated: StoredProject = { ...existingProject, ...updates, lastModified: new Date().toISOString() };
    const savedProject = await storage.saveProject(updated);
    return res.json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error updating project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteProject(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Export project endpoint
router.get('/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔄 Starting project export for:', id);
    
    // Get all project data
    const [project, conditions, files, measurements, calibrations] = await Promise.all([
      storage.getProject(id),
      storage.getConditionsByProject(id),
      storage.getFilesByProject(id),
      storage.getTakeoffMeasurementsByProject(id),
      storage.getCalibrationsByProject(id)
    ]);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log(`📦 Found ${files.length} files, ${conditions.length} conditions, ${measurements.length} measurements, ${calibrations.length} calibrations`);

    // Get sheets data for each file
    const sheetsPromises = files.map(async (file) => {
      try {
        const sheets = await storage.getSheetsByDocument(file.id);
        return sheets;
      } catch (error) {
        console.warn('Failed to get sheets for file:', file.id, error);
        return [];
      }
    });

    const sheetsArrays = await Promise.all(sheetsPromises);
    const sheets = sheetsArrays.flat();

    // Download and encode PDF files as base64
    console.log('📄 Downloading PDF files...');
    const filesWithData = await Promise.all(
      files.map(async (file) => {
        try {
          // Download file from Supabase Storage
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('project-files')
            .download(file.path);

          if (downloadError || !fileData) {
            console.warn(`⚠️ Failed to download file ${file.id} (${file.originalName}):`, downloadError);
            return {
              ...file,
              fileData: null, // Mark as missing
              fileDataError: downloadError?.message || 'File not found in storage'
            };
          }

          // Convert to base64
          const arrayBuffer = await fileData.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Data = buffer.toString('base64');

          console.log(`✅ Downloaded and encoded file ${file.id} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

          return {
            ...file,
            fileData: base64Data,
            fileDataMimeType: file.mimetype
          };
        } catch (error) {
          console.error(`❌ Error processing file ${file.id}:`, error);
          return {
            ...file,
            fileData: null,
            fileDataError: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    // Create backup object with all data
    const backup = {
      version: '2.0', // Bump version to indicate new format with PDFs and calibrations
      timestamp: new Date().toISOString(),
      project,
      conditions,
      files: filesWithData, // Now includes base64 encoded PDF data
      sheets,
      measurements,
      calibrations, // Include scale calibrations
      metadata: {
        totalFiles: files.length,
        totalConditions: conditions.length,
        totalMeasurements: measurements.length,
        totalSheets: sheets.length,
        totalCalibrations: calibrations.length,
        filesWithData: filesWithData.filter(f => f.fileData !== null).length,
        filesMissing: filesWithData.filter(f => f.fileData === null).length
      }
    };

    // Set headers for file download
    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    console.log('✅ Project export completed successfully');
    return res.json(backup);
  } catch (error) {
    console.error('❌ Error exporting project:', error);
    return res.status(500).json({ error: 'Failed to export project' });
  }
});

// Import project endpoint
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('🔄 Starting project import...');

    // Parse the backup file
    const text = req.file.buffer.toString('utf-8');
    const backup = JSON.parse(text);

    // Validate backup format
    if (!backup.version || !backup.project || !backup.timestamp) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    console.log(`📦 Importing backup version ${backup.version} from ${backup.timestamp}`);

    // Create the project (without the original ID to avoid conflicts)
    const { id: originalId, ...projectData } = backup.project;
    const newProject = await storage.saveProject({
      ...projectData,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    });

    const newProjectId = newProject.id;
    console.log(`✅ Created project: ${newProjectId}`);

    // Import conditions
    if (backup.conditions && backup.conditions.length > 0) {
      console.log(`📋 Importing ${backup.conditions.length} conditions...`);
      const conditionsPromises = backup.conditions.map(async (condition: any) => {
        const { id: originalId, ...conditionData } = condition;
        return storage.saveCondition({
          ...conditionData,
          id: uuidv4(),
          projectId: newProjectId
        });
      });
      await Promise.all(conditionsPromises);
      console.log('✅ Conditions imported');
    }

    // Import files with PDF data
    const fileIdMapping: Record<string, string> = {}; // Map old file IDs to new file IDs
    if (backup.files && backup.files.length > 0) {
      console.log(`📄 Importing ${backup.files.length} files...`);
      
      for (const file of backup.files) {
        const { id: originalFileId, fileData, fileDataMimeType, fileDataError, ...fileMeta } = file;
        const newFileId = uuidv4();
        fileIdMapping[originalFileId] = newFileId;

        // If file has base64 data, restore it to Supabase Storage
        if (fileData && typeof fileData === 'string') {
          try {
            // Decode base64 to buffer
            const fileBuffer = Buffer.from(fileData, 'base64');
            
            // Generate new storage path
            const fileExtension = fileMeta.filename ? path.extname(fileMeta.filename) : '.pdf';
            const storagePath = `${newProjectId}/${newFileId}${fileExtension}`;

            console.log(`📤 Uploading file ${fileMeta.originalName} to storage (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from('project-files')
              .upload(storagePath, fileBuffer, {
                contentType: fileDataMimeType || fileMeta.mimetype || 'application/pdf',
                upsert: false
              });

            if (uploadError) {
              console.error(`❌ Failed to upload file ${fileMeta.originalName}:`, uploadError);
              // Continue with file metadata even if upload fails
            } else {
              console.log(`✅ File uploaded: ${fileMeta.originalName}`);
            }

            // Save file metadata with new ID and path
            await storage.saveFile({
              id: newFileId,
              projectId: newProjectId,
              originalName: fileMeta.originalName,
              filename: fileMeta.filename || fileMeta.originalName,
              path: storagePath,
              size: fileBuffer.length,
              mimetype: fileDataMimeType || fileMeta.mimetype || 'application/pdf',
              uploadedAt: new Date().toISOString()
            });
          } catch (error) {
            console.error(`❌ Error restoring file ${fileMeta.originalName}:`, error);
            // Still save file metadata even if PDF restore fails
            await storage.saveFile({
              id: newFileId,
              projectId: newProjectId,
              originalName: fileMeta.originalName,
              filename: fileMeta.filename || fileMeta.originalName,
              path: '', // Empty path indicates file not restored
              size: fileMeta.size || 0,
              mimetype: fileMeta.mimetype || 'application/pdf',
              uploadedAt: new Date().toISOString()
            });
          }
        } else {
          // File data not available in backup
          console.warn(`⚠️ File ${fileMeta.originalName} has no data in backup${fileDataError ? `: ${fileDataError}` : ''}`);
          // Still save file metadata
          await storage.saveFile({
            id: newFileId,
            projectId: newProjectId,
            originalName: fileMeta.originalName,
            filename: fileMeta.filename || fileMeta.originalName,
            path: '', // Empty path indicates file not restored
            size: fileMeta.size || 0,
            mimetype: fileMeta.mimetype || 'application/pdf',
            uploadedAt: new Date().toISOString()
          });
        }
      }
      console.log('✅ Files imported');
    }

    // Import sheets (update file IDs to new ones)
    if (backup.sheets && backup.sheets.length > 0) {
      console.log(`📑 Importing ${backup.sheets.length} sheets...`);
      const sheetsPromises = backup.sheets.map(async (sheet: any) => {
        const { id: originalId, documentId, ...sheetData } = sheet;
        const newDocumentId = fileIdMapping[documentId] || documentId; // Use mapped ID if available
        
        return storage.saveSheet({
          ...sheetData,
          id: uuidv4(),
          documentId: newDocumentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
      await Promise.all(sheetsPromises);
      console.log('✅ Sheets imported');
    }

    // Import calibrations (update file/sheet IDs to new ones)
    if (backup.calibrations && backup.calibrations.length > 0) {
      console.log(`📏 Importing ${backup.calibrations.length} calibrations...`);
      const calibrationsPromises = backup.calibrations.map(async (calibration: any) => {
        const { id: originalId, sheetId, ...calibrationData } = calibration;
        const newSheetId = fileIdMapping[sheetId] || sheetId; // Use mapped ID if available
        
        return storage.saveCalibration({
          ...calibrationData,
          id: uuidv4(),
          projectId: newProjectId,
          sheetId: newSheetId
        });
      });
      await Promise.all(calibrationsPromises);
      console.log('✅ Calibrations imported');
    }

    // Import measurements (update file/sheet IDs to new ones)
    if (backup.measurements && backup.measurements.length > 0) {
      console.log(`📊 Importing ${backup.measurements.length} measurements...`);
      const measurementsPromises = backup.measurements.map(async (measurement: any) => {
        const { id: originalId, sheetId, ...measurementData } = measurement;
        const newSheetId = fileIdMapping[sheetId] || sheetId; // Use mapped ID if available
        
        return storage.saveTakeoffMeasurement({
          ...measurementData,
          id: uuidv4(),
          projectId: newProjectId,
          sheetId: newSheetId
        });
      });
      await Promise.all(measurementsPromises);
      console.log('✅ Measurements imported');
    }

    const filesRestored = backup.files?.filter((f: any) => f.fileData).length || 0;
    const filesMissing = backup.files?.filter((f: any) => !f.fileData).length || 0;

    console.log('✅ Project import completed successfully');

    return res.json({ 
      success: true, 
      project: newProject,
      message: filesMissing > 0 
        ? `Project restored successfully. ${filesRestored} PDF file(s) restored, ${filesMissing} file(s) were missing from backup.`
        : `Project restored successfully. All ${filesRestored} PDF file(s) restored.`
    });
  } catch (error) {
    console.error('❌ Error importing project:', error);
    return res.status(500).json({ error: 'Failed to import project' });
  }
});

export { router as projectRoutes };
