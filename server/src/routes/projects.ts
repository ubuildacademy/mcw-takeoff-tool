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
  sendReportRateLimit,
  shareProjectRateLimit
} from '../middleware';
import { emailService } from '../services/emailService';
import { REPORT_DELIVERY, PROJECT_SHARE } from '../config/reportDelivery';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

// Multer for send-report: 30MB max per file (link delivery may receive large reports)
const sendReportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});


const sendReportFields = sendReportUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'file2', maxCount: 1 },
]);

const router = express.Router();

/** Build full project backup (reused by export and share-project). */
async function buildProjectBackup(
  id: string,
  userId: string | undefined,
  userIsAdmin: boolean
): Promise<Record<string, unknown>> {
  let accessQuery = supabase.from(TABLES.PROJECTS).select('id').eq('id', id);
  if (!userIsAdmin) {
    accessQuery = accessQuery.eq('user_id', userId!);
  }
  const { data: accessCheck, error: accessError } = await accessQuery.single();
  if (accessError || !accessCheck) {
    const err = new Error('Project not found or access denied') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const project = await storage.getProject(id);
  if (!project) {
    const err = new Error('Project not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const conditions = await storage.getConditionsByProject(id).catch(() => []);
  const files = await storage.getFilesByProject(id).catch(() => []);
  const measurements = await storage.getTakeoffMeasurementsByProject(id).catch(() => []);
  const calibrations = await storage.getCalibrationsByProject(id).catch(() => []);

  const fileIds = files.map((f) => f.id);
  let sheets: unknown[] = [];
  if (fileIds.length > 0) {
    const { data: allSheets } = await supabase
      .from(TABLES.SHEETS)
      .select('*')
      .in('document_id', fileIds)
      .order('page_number', { ascending: true });
    sheets = (allSheets || []).map((s) => ({
      id: (s as Record<string, unknown>).id,
      documentId: (s as Record<string, unknown>).document_id,
      pageNumber: (s as Record<string, unknown>).page_number,
      sheetNumber: (s as Record<string, unknown>).sheet_number,
      sheetName: (s as Record<string, unknown>).sheet_name,
      extractedText: (s as Record<string, unknown>).extracted_text,
      hasTakeoffs: (s as Record<string, unknown>).has_takeoffs,
      takeoffCount: (s as Record<string, unknown>).takeoff_count,
      isVisible: (s as Record<string, unknown>).is_visible,
      ocrProcessed: (s as Record<string, unknown>).ocr_processed,
      titleblockConfig: (s as Record<string, unknown>).titleblock_config,
      createdAt: (s as Record<string, unknown>).created_at,
      updatedAt: (s as Record<string, unknown>).updated_at,
    }));
  }

  const filesWithData = await Promise.all(
    files.map(async (file) => {
      if (!file.path) {
        return { ...file, fileData: null, fileDataError: 'No storage path' };
      }
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('project-files')
        .download(file.path);
      if (downloadError || !fileData) {
        return { ...file, fileData: null, fileDataError: downloadError?.message || 'File not found' };
      }
      const buffer = Buffer.from(await fileData.arrayBuffer());
      return {
        ...file,
        fileData: buffer.toString('base64'),
        fileDataMimeType: file.mimetype,
      };
    })
  );

  const filesWithDataCount = filesWithData.filter((f) => (f as Record<string, unknown>).fileData !== null).length;
  return {
    version: '2.0',
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
      filesMissing: filesWithData.length - filesWithDataCount,
    },
  };
}

/** Import backup into a new project for the given user. Used by POST /import and shared-import. */
export async function performImportFromBackup(
  backup: Record<string, unknown>,
  userId: string
): Promise<{ project: StoredProject; message: string }> {
  const { id: _origId, userId: _origUserId, ...projectData } = backup.project as Record<string, unknown>;
  const newProject = await storage.saveProject({
    ...projectData,
    id: uuidv4(),
    userId,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  } as StoredProject);
  const newProjectId = newProject.id;

  const conditions = (backup.conditions as Record<string, unknown>[]) || [];
  if (conditions.length > 0) {
    await Promise.all(
      conditions.map((c) => {
        const { id: _cId, ...rest } = c;
        return storage.saveCondition({
          ...rest,
          id: uuidv4(),
          projectId: newProjectId,
        } as Parameters<typeof storage.saveCondition>[0]);
      })
    );
  }

  const fileIdMapping: Record<string, string> = {};
  const files = (backup.files as Array<Record<string, unknown>>) || [];
  for (const file of files) {
    const originalFileId = (file.id as string) || '';
    const { id: _fId, fileData, fileDataMimeType, fileDataError, ...fileMeta } = file;
    const newFileId = uuidv4();
    fileIdMapping[originalFileId] = newFileId;
    const mime = (fileDataMimeType || fileMeta.mimetype || 'application/pdf') as string;
    if (fileData && typeof fileData === 'string') {
      try {
        const fileBuffer = Buffer.from(fileData as string, 'base64');
        const ext = fileMeta.filename ? path.extname(fileMeta.filename as string) : '.pdf';
        const storagePath = `${newProjectId}/${newFileId}${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('project-files')
          .upload(storagePath, fileBuffer, { contentType: mime, upsert: false });
        if (uploadError) {
          console.warn(`Failed to upload ${fileMeta.originalName}:`, uploadError);
        }
        await storage.saveFile({
          id: newFileId,
          projectId: newProjectId,
          originalName: (fileMeta.originalName as string) || 'unknown',
          filename: (fileMeta.filename as string) || fileMeta.originalName as string || 'unknown',
          path: storagePath,
          size: fileBuffer.length,
          mimetype: mime,
          uploadedAt: new Date().toISOString(),
        });
      } catch {
        await storage.saveFile({
          id: newFileId,
          projectId: newProjectId,
          originalName: (fileMeta.originalName as string) || 'unknown',
          filename: (fileMeta.filename as string) || fileMeta.originalName as string || 'unknown',
          path: '',
          size: (fileMeta.size as number) || 0,
          mimetype: (fileMeta.mimetype as string) || 'application/pdf',
          uploadedAt: new Date().toISOString(),
        });
      }
    } else {
      await storage.saveFile({
        id: newFileId,
        projectId: newProjectId,
        originalName: (fileMeta.originalName as string) || 'unknown',
        filename: (fileMeta.filename as string) || fileMeta.originalName as string || 'unknown',
        path: '',
        size: (fileMeta.size as number) || 0,
        mimetype: (fileMeta.mimetype as string) || 'application/pdf',
        uploadedAt: new Date().toISOString(),
      });
    }
  }

  const sheetIdMapping: Record<string, string> = {};
  const sheets = (backup.sheets as Array<Record<string, unknown>>) || [];
  for (const sheet of sheets) {
    const { id: _sId, documentId, ...sheetData } = sheet;
    const newDocumentId = fileIdMapping[(documentId as string) || ''] || (documentId as string);
    const newSheetId = uuidv4();
    sheetIdMapping[(sheet.id as string) || ''] = newSheetId;
    await storage.saveSheet({
      ...sheetData,
      id: newSheetId,
      documentId: newDocumentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Parameters<typeof storage.saveSheet>[0]);
  }

  const calibrations = (backup.calibrations as Array<Record<string, unknown>>) || [];
  for (const cal of calibrations) {
    await storage.saveCalibration({
      ...cal,
      id: uuidv4(),
      projectId: newProjectId,
      sheetId: sheetIdMapping[(cal.sheetId as string) || ''] || (cal.sheetId as string),
    } as Parameters<typeof storage.saveCalibration>[0]);
  }

  const measurements = (backup.measurements as Array<Record<string, unknown>>) || [];
  for (const m of measurements) {
    await storage.saveTakeoffMeasurement({
      ...m,
      id: uuidv4(),
      projectId: newProjectId,
      sheetId: sheetIdMapping[(m.sheetId as string) || ''] || (m.sheetId as string),
    } as Parameters<typeof storage.saveTakeoffMeasurement>[0]);
  }

  const documentRotations: Record<string, number> = {};
  const backupRotations = backup.documentRotations as Record<string, number> | undefined;
  if (backupRotations && typeof backupRotations === 'object') {
    for (const [oldFileId, rot] of Object.entries(backupRotations)) {
      const newFileId = fileIdMapping[oldFileId];
      if (newFileId != null && typeof rot === 'number') documentRotations[newFileId] = rot;
    }
  }

  const annotations: Array<Record<string, unknown>> = [];
  const backupAnnotations = backup.annotations as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(backupAnnotations)) {
    for (const a of backupAnnotations) {
      const oldSheetId = (a.sheetId as string) || '';
      const newSheetId = sheetIdMapping[oldSheetId] ?? oldSheetId;
      annotations.push({
        ...a,
        id: `annotation-${uuidv4()}`,
        projectId: newProjectId,
        sheetId: newSheetId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const filesRestored = files.filter((f) => f.fileData).length;
  const filesMissing = files.filter((f) => !f.fileData).length;
  const message = filesMissing > 0
    ? `Project imported. ${filesRestored} PDF(s) restored, ${filesMissing} missing.`
    : `Project imported. All ${filesRestored} PDF(s) restored.`;
  return { project: newProject, message, annotations, documentRotations };
}

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
    const backup = await buildProjectBackup(id, userId, userIsAdmin);
    const project = backup.project as { name?: string };
    const filename = `${(project?.name || 'project').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json(backup);
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    return res.status(status).json({
      error: status === 404 ? err.message : 'Failed to export project',
      details: status === 500 && err.message ? err.message : undefined,
    });
  }
});

// Share project via email - requires auth and project access
router.post(
  '/:id/share-project',
  requireAuth,
  validateUUIDParam('id'),
  requireProjectAccess,
  shareProjectRateLimit,
  async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const { recipients: recipientsRaw, message = '' } = req.body;

      if (!recipientsRaw) {
        return res.status(400).json({ error: 'recipients is required' });
      }
      const recipients: string[] = Array.isArray(recipientsRaw) ? recipientsRaw : [recipientsRaw];
      if (recipients.length === 0 || recipients.length > 10) {
        return res.status(400).json({ error: 'recipients must be 1–10 email addresses' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const validRecipients = [...new Set(
        recipients
          .filter((e) => typeof e === 'string' && emailRegex.test((e as string).trim()))
          .map((e) => (e as string).trim().toLowerCase())
      )];
      if (validRecipients.length === 0) {
        return res.status(400).json({ error: 'No valid email addresses' });
      }

      const userId = req.user?.id;
      const userIsAdmin = req.user?.role === 'admin';
      const backup = await buildProjectBackup(projectId, userId, userIsAdmin);
      const project = backup.project as { name?: string };
      const projectName = project?.name || 'Project';

      const files = (backup.files as Array<{ id?: string }>) || [];
      const fileIds = new Set(files.map((f) => f.id).filter(Boolean));

      const clientDocumentRotations = req.body?.documentRotations as Record<string, number> | undefined;
      if (clientDocumentRotations && typeof clientDocumentRotations === 'object') {
        const documentRotations: Record<string, number> = {};
        for (const [docId, rot] of Object.entries(clientDocumentRotations)) {
          if (fileIds.has(docId) && typeof rot === 'number') documentRotations[docId] = rot;
        }
        if (Object.keys(documentRotations).length > 0) backup.documentRotations = documentRotations;
      }

      const clientAnnotations = req.body?.annotations;
      if (Array.isArray(clientAnnotations) && clientAnnotations.length > 0) {
        const valid = clientAnnotations.filter(
          (a: unknown) =>
            a &&
            typeof a === 'object' &&
            (a as Record<string, unknown>).projectId === projectId
        );
        if (valid.length > 0) backup.annotations = valid;
      }

      const jsonString = JSON.stringify(backup);
      const backupBuffer = Buffer.from(jsonString, 'utf8');
      const backupSize = backupBuffer.length;
      const userEmail = req.user?.email || 'Meridian Takeoff User';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      const escapedMessage = (message as string).replace(/</g, '&lt;').replace(/>/g, '&gt;') || '';

      if (backupSize < PROJECT_SHARE.ATTACHMENT_LIMIT_BYTES) {
        const filename = `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.json`;
        const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Project Shared</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2563eb;">Meridian Takeoff - Project Shared</h2>
    <p>A project has been shared with you: <strong>${projectName}</strong>.</p>
    <p>The project backup is attached to this email. To use it:</p>
    <ol>
      <li>Sign in or create an account at <a href="${frontendUrl}" style="color: #2563eb;">Meridian Takeoff</a></li>
      <li>Go to your projects and click "Restore" (or Open Existing)</li>
      <li>Select the attached backup file to import the project</li>
    </ol>
    ${escapedMessage ? `<p style="margin: 20px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;">${escapedMessage}</p>` : ''}
    <p style="color: #6b7280; font-size: 14px;">Shared by ${userEmail}</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
  </div>
</body>
</html>`;
        const textContent = `A project has been shared with you: ${projectName}.\n\nThe project backup is attached. Sign in or create an account at ${frontendUrl}, then use Backup → Restore to import the attached file.\n\nShared by ${userEmail}`;
        const ok = await emailService.sendEmail({
          to: validRecipients,
          subject: `Project shared: ${projectName} from Meridian Takeoff`,
          text: textContent,
          html: htmlContent,
          attachments: [
            { filename, content: backupBuffer, contentType: 'application/json' },
          ],
        });
        if (!ok) {
          return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
        }
        return res.json({ success: true, deliveryMethod: 'attachment' });
      }

      const shareToken = uuidv4();
      const storagePath = `${PROJECT_SHARE.STORAGE_PREFIX}/${shareToken}/project_backup.json`;
      const { error: uploadError } = await supabase.storage
        .from(PROJECT_SHARE.BUCKET)
        .upload(storagePath, backupBuffer, {
          contentType: 'application/json',
          upsert: false,
        });
      if (uploadError) {
        console.error('Project share upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload project for sharing' });
      }

      const importUrl = `${frontendUrl}/shared/import/${shareToken}`;
      const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Project Shared</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2563eb;">Meridian Takeoff - Project Shared</h2>
    <p>A project has been shared with you: <strong>${projectName}</strong>.</p>
    <p><strong>Click the link below to access and import this project:</strong></p>
    <p><a href="${importUrl}" style="color: #2563eb;">${importUrl}</a></p>
    <p style="font-size: 13px; color: #6b7280;">You will need to sign in or create an account. This link expires in 7 days.</p>
    ${escapedMessage ? `<p style="margin: 20px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;">${escapedMessage}</p>` : ''}
    <p style="color: #6b7280; font-size: 14px;">Shared by ${userEmail}</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
  </div>
</body>
</html>`;
      const textContent = `A project has been shared with you: ${projectName}.\n\nAccess and import the project: ${importUrl}\n\nSign in or create an account. This link expires in 7 days.\n\nShared by ${userEmail}`;
      const ok = await emailService.sendEmail({
        to: validRecipients,
        subject: `Project shared: ${projectName} from Meridian Takeoff`,
        text: textContent,
        html: htmlContent,
      });
      if (!ok) {
        return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
      }
      return res.json({ success: true, deliveryMethod: 'link' });
    } catch (error) {
      console.error('Error sharing project:', error);
      const err = error as Error & { statusCode?: number };
      const status = err.statusCode ?? 500;
      return res.status(status).json({
        error: status === 404 ? err.message : 'Failed to share project',
        details: status === 500 && err.message ? err.message : undefined,
      });
    }
  }
);

// Send quantity report via email - requires auth and project access
router.post(
  '/:id/send-report',
  requireAuth,
  validateUUIDParam('id'),
  requireProjectAccess,
  sendReportRateLimit,
  sendReportFields,
  async (req, res) => {
    try {
      const { id: projectId } = req.params;
      const files = req.files as { file?: Express.Multer.File[]; file2?: Express.Multer.File[] } | undefined;
      const file = files?.file?.[0];
      const file2 = files?.file2?.[0];

      const recipientsRaw = req.body.recipients;
      const format = req.body.format as string | undefined;
      const message = (req.body.message as string | undefined) || '';
      const deliveryMethod = (req.body.deliveryMethod as string | undefined) || 'attachment';

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

      if (format !== 'excel' && format !== 'pdf' && format !== 'both') {
        return res.status(400).json({ error: 'format must be "excel", "pdf", or "both"' });
      }

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      if (format === 'both' && !file2) {
        return res.status(400).json({ error: 'Both Excel and PDF files are required when format is "both"' });
      }

      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const userEmail = req.user?.email || 'Meridian Takeoff User';
      const subject = `Quantity Report: ${project.name} from Meridian Takeoff`;
      const escapedMessage = message ? message.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

      let ok: boolean;
      if (deliveryMethod === 'link') {
        const deliveryId = uuidv4();
        const storageDir = `${REPORT_DELIVERY.STORAGE_PREFIX}/${deliveryId}`;
        const filesToUpload: Array<{ buffer: Buffer; filename: string }> = [];
        if (format === 'both' && file && file2) {
          filesToUpload.push({ buffer: file.buffer, filename: file.originalname });
          filesToUpload.push({ buffer: file2.buffer, filename: file2.originalname });
        } else {
          filesToUpload.push({ buffer: file.buffer, filename: file.originalname });
        }

        for (const { buffer, filename } of filesToUpload) {
          const storagePath = `${storageDir}/${filename}`;
          const { error: uploadError } = await supabase.storage
          .from(REPORT_DELIVERY.BUCKET)
          .upload(storagePath, buffer, {
              contentType: filename.endsWith('.xlsx')
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf',
              upsert: false,
            });
          if (uploadError) {
            console.error('Report storage upload error:', uploadError);
            return res.status(500).json({ error: 'Failed to upload report for link delivery' });
          }
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from(REPORT_DELIVERY.BUCKET)
          .createSignedUrls(
            filesToUpload.map((f) => `${storageDir}/${f.filename}`),
            REPORT_DELIVERY.LINK_EXPIRY_SECONDS
          );
        if (signedError || !signedData?.length) {
          console.error('Report signed URL error:', signedError);
          return res.status(500).json({ error: 'Failed to create download links' });
        }

        const linkListHtml = filesToUpload
          .map(
            (f, i) =>
              `<li><a href="${signedData[i]?.signedUrl || '#'}" style="color: #2563eb;">${f.filename}</a> (expires in 7 days)</li>`
          )
          .join('');
        const linkListText = filesToUpload
          .map((f, i) => `${f.filename}: ${signedData[i]?.signedUrl || ''}`)
          .join('\n');

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Quantity Report</title></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Meridian Takeoff - Quantity Report</h2>
            <p>A quantity report has been shared with you for project: <strong>${project.name}</strong>.</p>
            <p><strong>Download your report(s):</strong></p>
            <ul>${linkListHtml}</ul>
            <p style="font-size: 13px; color: #6b7280;">Links expire in 7 days. Please download before then.</p>
            ${escapedMessage ? `<p style="margin: 20px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;">${escapedMessage}</p>` : ''}
            <p style="color: #6b7280; font-size: 14px;">Generated by ${userEmail}</p>
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
          </div>
        </body>
        </html>
      `;
        const textContent = `A quantity report has been shared with you for project: ${project.name}.\n\nDownload links (expire in 7 days):\n${linkListText}\n\nGenerated by ${userEmail}`;

        ok = await emailService.sendEmail({
          to: validRecipients,
          subject,
          text: textContent,
          html: htmlContent,
        });
      } else {
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Quantity Report</title></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Meridian Takeoff - Quantity Report</h2>
            <p>A quantity report has been shared with you for project: <strong>${project.name}</strong>.</p>
            ${escapedMessage ? `<p style="margin: 20px 0; padding: 12px; background: #f3f4f6; border-radius: 6px;">${escapedMessage}</p>` : ''}
            <p style="color: #6b7280; font-size: 14px;">Generated by ${userEmail}</p>
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">&copy; ${new Date().getFullYear()} Meridian Takeoff. All rights reserved.</p>
          </div>
        </body>
        </html>
      `;
        const textContent = `A quantity report has been shared with you for project: ${project.name}. Generated by ${userEmail}`;

        const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
        if (format === 'both' && file && file2) {
          attachments.push({
            filename: file.originalname,
            content: file.buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          attachments.push({
            filename: file2.originalname,
            content: file2.buffer,
            contentType: 'application/pdf',
          });
        } else {
          const contentType = format === 'excel'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf';
          attachments.push({ filename: file.originalname, content: file.buffer, contentType });
        }

        ok = await emailService.sendEmail({
          to: validRecipients,
          subject,
          text: textContent,
          html: htmlContent,
          attachments,
        });
      }

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
    const backup = JSON.parse(req.file.buffer.toString('utf-8'));
    if (!backup.version || !backup.project || !backup.timestamp) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }
    const { project, message, annotations, documentRotations } = await performImportFromBackup(backup, userId);
    return res.json({ success: true, project, message, annotations, documentRotations });
  } catch (error) {
    console.error('❌ Error importing project:', error);
    return res.status(500).json({ error: 'Failed to import project' });
  }
});

export { router as projectRoutes };
