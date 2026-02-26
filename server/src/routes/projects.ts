import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import { storage, StoredProject } from '../storage';
import { supabase, TABLES } from '../supabase';
import { 
  requireAuth, 
  requireProjectAccess,
  validateUUIDParam,
  sanitizeBody,
  uploadRateLimit,
  sendReportRateLimit
} from '../middleware';
import { emailService } from '../services/emailService';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

// Multer for send-report: 15MB max (Excel/PDF reports)
const sendReportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Build query based on user role
    let query = supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .order('last_modified', { ascending: false });
    
    // If not admin, only show user's own projects
    if (!userIsAdmin) {
      query = query.eq('user_id', userId);
    }
    
    const { data: projects, error } = await query;
    
    if (error) {
      console.error('Error fetching projects:', error);
      return res.status(500).json({ error: 'Failed to fetch projects' });
    }
    
    // Batch query: Get all measurement counts in a single query instead of N queries
    const projectIds = (projects || []).map(p => p.id);
    
    let countsByProject: Record<string, number> = {};
    if (projectIds.length > 0) {
      const { data: measurements, error: countError } = await supabase
        .from(TABLES.TAKEOFF_MEASUREMENTS)
        .select('project_id')
        .in('project_id', projectIds);
      
      if (countError) {
        console.error('Error fetching measurement counts:', countError);
      } else {
        // Group and count by project_id
        countsByProject = (measurements || []).reduce((acc, m) => {
          acc[m.project_id] = (acc[m.project_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }
    }
    
    // Map projects with their counts (no additional queries needed)
    const projectsWithCounts = (projects || []).map(project => ({
      ...project,
      takeoffCount: countsByProject[project.id] || 0,
      totalValue: 0
    }));
    
    return res.json({ projects: projectsWithCounts });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Create a new project - requires authentication
router.post('/', requireAuth, sanitizeBody('name', 'client', 'location', 'description', 'contactPerson'), async (req, res) => {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const incoming = req.body as Partial<StoredProject>;
    
    // Get user ID from authenticated request
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
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
      lastModified: now,
      userId // Associate project with the authenticated user
    };
    const savedProject = await storage.saveProject(project);
    return res.status(201).json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error creating project:', error);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get a single project - requires auth and project access
router.get('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Get project with access control
    let query = supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', id);
    
    // Non-admins can only see their own projects
    if (!userIsAdmin) {
      query = query.eq('user_id', userId);
    }
    
    const { data: project, error } = await query.single();
    
    if (error || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    // Calculate takeoff count for this project
    try {
      const measurements = await storage.getTakeoffMeasurementsByProject(project.id);
      const takeoffCount = measurements.length;
      
      const projectWithCounts = {
        ...project,
        takeoffCount,
        totalValue: 0
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

// Update a project - requires auth and project access
router.put('/:id', requireAuth, validateUUIDParam('id'), sanitizeBody('name', 'client', 'location', 'description', 'contactPerson'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Verify access to project
    let query = supabase
      .from(TABLES.PROJECTS)
      .select('*')
      .eq('id', id);
    
    if (!userIsAdmin) {
      query = query.eq('user_id', userId);
    }
    
    const { data: existingProject, error } = await query.single();
    
    if (error || !existingProject) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    const updates = req.body as Partial<StoredProject>;
    // Don't allow changing user_id
    delete updates.userId;
    
    const updated: StoredProject = { ...existingProject, ...updates, lastModified: new Date().toISOString() };
    const savedProject = await storage.saveProject(updated);
    return res.json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error updating project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project - requires auth and project access
router.delete('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Verify access to project
    let query = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', id);
    
    if (!userIsAdmin) {
      query = query.eq('user_id', userId);
    }
    
    const { data: project, error } = await query.single();
    
    if (error || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    await storage.deleteProject(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Export project endpoint - requires auth and project access
router.get('/:id/export', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Verify access
    let accessQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id')
      .eq('id', id);
    
    if (!userIsAdmin) {
      accessQuery = accessQuery.eq('user_id', userId);
    }
    
    const { data: accessCheck, error: accessError } = await accessQuery.single();
    if (accessError || !accessCheck) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    console.log('🔄 Starting project export for:', id);
    
    // Get all project data with individual error handling
    let project, conditions, files, measurements, calibrations;
    
    try {
      project = await storage.getProject(id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
    } catch (error) {
      console.error('❌ Error fetching project:', error);
      return res.status(500).json({ error: 'Failed to fetch project data' });
    }

    try {
      conditions = await storage.getConditionsByProject(id);
    } catch (error) {
      console.error('❌ Error fetching conditions:', error);
      conditions = []; // Continue with empty conditions
    }

    try {
      files = await storage.getFilesByProject(id);
    } catch (error) {
      console.error('❌ Error fetching files:', error);
      files = []; // Continue with empty files
    }

    try {
      measurements = await storage.getTakeoffMeasurementsByProject(id);
    } catch (error) {
      console.error('❌ Error fetching measurements:', error);
      measurements = []; // Continue with empty measurements
    }

    try {
      calibrations = await storage.getCalibrationsByProject(id);
    } catch (error) {
      console.error('❌ Error fetching calibrations:', error);
      calibrations = []; // Continue with empty calibrations
    }

    console.log(`📦 Found ${files.length} files, ${conditions.length} conditions, ${measurements.length} measurements, ${calibrations.length} calibrations`);

    // Batch query: Get all sheets for all files in a single query instead of N queries
    const fileIds = files.map(f => f.id);
    let sheets: any[] = [];
    
    if (fileIds.length > 0) {
      try {
        const { data: allSheets, error: sheetsError } = await supabase
          .from(TABLES.SHEETS)
          .select('*')
          .in('document_id', fileIds)
          .order('page_number', { ascending: true });
        
        if (sheetsError) {
          console.warn('⚠️ Failed to get sheets:', sheetsError);
        } else {
          // Transform to camelCase format
          sheets = (allSheets || []).map(sheet => ({
            id: sheet.id,
            documentId: sheet.document_id,
            pageNumber: sheet.page_number,
            sheetNumber: sheet.sheet_number,
            sheetName: sheet.sheet_name,
            extractedText: sheet.extracted_text,
            hasTakeoffs: sheet.has_takeoffs,
            takeoffCount: sheet.takeoff_count,
            isVisible: sheet.is_visible,
            ocrProcessed: sheet.ocr_processed,
            titleblockConfig: sheet.titleblock_config,
            createdAt: sheet.created_at,
            updatedAt: sheet.updated_at
          }));
        }
      } catch (error) {
        console.error('❌ Error fetching sheets:', error);
        // Continue with empty sheets
      }
    }

    // Download and encode PDF files as base64
    console.log('📄 Downloading PDF files...');
    const filesWithData = await Promise.all(
      files.map(async (file) => {
        try {
          // Skip if no path
          if (!file.path) {
            console.warn(`⚠️ File ${file.id} has no storage path`);
            return {
              ...file,
              fileData: null,
              fileDataError: 'No storage path'
            };
          }

          // Download file from Supabase Storage
          const { data: fileData, error: downloadError } = await supabase.storage
            .from('project-files')
            .download(file.path);

          if (downloadError || !fileData) {
            console.warn(`⚠️ Failed to download file ${file.id} (${file.originalName}):`, downloadError?.message);
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
    const filesWithDataCount = filesWithData.filter((f) => f.fileData !== null).length;
    const backup = {
      version: '2.0', // Bump version to indicate new format with PDFs and calibrations
      timestamp: new Date().toISOString(),
      project,
      conditions,
      files: filesWithData,
      sheets,
      measurements,
      calibrations,
      metadata: {
        totalFiles: files.length,
        totalConditions: conditions.length,
        totalMeasurements: measurements.length,
        totalSheets: sheets.length,
        totalCalibrations: calibrations.length,
        filesWithData: filesWithDataCount,
        filesMissing: filesWithData.length - filesWithDataCount
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
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return res.status(500).json({ 
      error: 'Failed to export project', 
      details: errorMessage 
    });
  }
});

// Send quantity report via email - requires auth and project access
router.post(
  '/:id/send-report',
  requireAuth,
  validateUUIDParam('id'),
  requireProjectAccess,
  sendReportRateLimit,
  sendReportUpload.single('file'),
  async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const recipientsRaw = req.body.recipients;
      const format = req.body.format as string | undefined;
      const message = (req.body.message as string | undefined) || '';

      if (!recipientsRaw || !format) {
        return res.status(400).json({ error: 'recipients and format are required' });
      }

      let recipients: string[];
      try {
        recipients = typeof recipientsRaw === 'string' ? JSON.parse(recipientsRaw) : recipientsRaw;
      } catch {
        return res.status(400).json({ error: 'recipients must be a valid JSON array of email addresses' });
      }

      if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 10) {
        return res.status(400).json({ error: 'recipients must be an array of 1-10 email addresses' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = recipients.filter((e: string) => typeof e !== 'string' || !emailRegex.test(e.trim()));
      if (invalidEmails.length > 0) {
        return res.status(400).json({ error: 'Invalid email address(es): ' + invalidEmails.join(', ') });
      }
      const validRecipients = recipients.map((e: string) => e.trim().toLowerCase());

      if (format !== 'excel' && format !== 'pdf') {
        return res.status(400).json({ error: 'format must be "excel" or "pdf"' });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const userEmail = req.user?.email || 'Meridian Takeoff User';
      const subject = `Quantity Report: ${project.name} from Meridian Takeoff`;
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Quantity Report</title></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Meridian Takeoff - Quantity Report</h2>
            <p>A quantity report has been shared with you for project: <strong>${project.name}</strong>.</p>
            ${message ? `<p style="margin: 20px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
            <p style="color: #6b7280; font-size: 14px;">Generated by ${userEmail}</p>
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
          </div>
        </body>
        </html>
      `;
      const textContent = `A quantity report has been shared with you for project: ${project.name}. Generated by ${userEmail}`;

      const contentType = format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';

      const ok = await emailService.sendEmail({
        to: validRecipients,
        subject,
        text: textContent,
        html: htmlContent,
        attachments: [{ filename: file.originalname, content: file.buffer, contentType }],
      });

      if (!ok) {
        return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('Error sending report email:', error);
      return res.status(500).json({
        error: 'Failed to send report',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

// Import project endpoint - requires auth
router.post('/import', requireAuth, uploadRateLimit, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
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
    const { id: originalId, userId: originalUserId, ...projectData } = backup.project;
    const newProject = await storage.saveProject({
      ...projectData,
      id: uuidv4(),
      userId, // Associate with the authenticated user
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
    const sheetIdMapping: Record<string, string> = {}; // Map old sheet IDs to new sheet IDs
    if (backup.sheets && backup.sheets.length > 0) {
      console.log(`📑 Importing ${backup.sheets.length} sheets...`);
      const sheetsPromises = backup.sheets.map(async (sheet: any) => {
        const { id: originalSheetId, documentId, ...sheetData } = sheet;
        const newDocumentId = fileIdMapping[documentId] || documentId; // Use mapped ID if available
        const newSheetId = uuidv4();
        sheetIdMapping[originalSheetId] = newSheetId; // Map old to new
        
        return storage.saveSheet({
          ...sheetData,
          id: newSheetId,
          documentId: newDocumentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
      await Promise.all(sheetsPromises);
      console.log('✅ Sheets imported');
    }

    // Import calibrations (update sheet IDs to new ones)
    if (backup.calibrations && backup.calibrations.length > 0) {
      console.log(`📏 Importing ${backup.calibrations.length} calibrations...`);
      const calibrationsPromises = backup.calibrations.map(async (calibration: any) => {
        const { id: originalId, sheetId, ...calibrationData } = calibration;
        const newSheetId = sheetIdMapping[sheetId] || sheetId; // Use mapped sheet ID
        
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

    // Import measurements (update sheet IDs to new ones)
    if (backup.measurements && backup.measurements.length > 0) {
      console.log(`📊 Importing ${backup.measurements.length} measurements...`);
      const measurementsPromises = backup.measurements.map(async (measurement: any) => {
        const { id: originalId, sheetId, ...measurementData } = measurement;
        const newSheetId = sheetIdMapping[sheetId] || sheetId; // Use mapped sheet ID
        
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
