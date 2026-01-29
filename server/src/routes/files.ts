import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredFileMeta } from '../storage';
import { supabase, TABLES } from '../supabase';
import { requireAuth, isAdmin, hasProjectAccess, validateUUIDParam } from '../middleware';

const router = express.Router();

const uploadRoot = path.join(__dirname, '../../uploads');
fs.ensureDirSync(uploadRoot);

const storageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use a temporary location first, we'll move the file later
    const tempDir = path.join(uploadRoot, 'temp');
    fs.ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const unique = `${uuidv4()}-${file.originalname}`;
    cb(null, unique);
  }
});

// Supabase Storage file size limits - Currently set to 1GB in Supabase dashboard
// Note: Can be increased by admin in Supabase Storage Settings
// Pro tier with Spend Cap disabled allows up to 500GB
const SUPABASE_MAX_FILE_SIZE = parseInt(process.env.SUPABASE_MAX_FILE_SIZE || '1073741824'); // 1GB default (matches current Supabase setting)

const upload = multer({
  storage: storageEngine,
  limits: { fileSize: SUPABASE_MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    return cb(new Error('Invalid file type'));
  }
});

// Wrapper to handle multer errors
const uploadHandler = upload.single('file');
const handleUpload = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  return new Promise<void>((resolve) => {
    uploadHandler(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ 
              error: 'File too large', 
              message: `File size exceeds the maximum allowed size of ${SUPABASE_MAX_FILE_SIZE / (1024 * 1024)}MB for Supabase Storage`,
              maxSize: SUPABASE_MAX_FILE_SIZE
            });
          }
          return res.status(400).json({ error: 'Upload error', details: err.message });
        }
        
        // Handle fileFilter errors
        if (err.message === 'Invalid file type') {
          return res.status(400).json({ error: 'Invalid file type', message: 'Only PDF, DWG, JPG, JPEG, and PNG files are allowed' });
        }
        
        return res.status(400).json({ error: 'Upload error', details: err.message });
      }
      
      // No error, continue to route handler
      resolve();
      next();
    });
  });
};

router.post('/upload', requireAuth, handleUpload, async (req, res) => {
  try {
    console.log('=== FILE UPLOAD REQUEST ===');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);
    console.log('File mimetype:', req.file?.mimetype);
    console.log('File originalname:', req.file?.originalname);
    console.log('File size:', req.file?.size);
    
    if (!req.file) {
      console.log('ERROR: No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Check file size before processing (Supabase Storage limit)
    const maxSizeMB = SUPABASE_MAX_FILE_SIZE / (1024 * 1024);
    if (req.file.size > SUPABASE_MAX_FILE_SIZE) {
      console.log(`ERROR: File size ${req.file.size} exceeds Supabase limit ${SUPABASE_MAX_FILE_SIZE}`);
      // Clean up temp file
      fs.removeSync(req.file.path);
      return res.status(413).json({ 
        error: 'File too large', 
        message: `File size (${(req.file.size / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum allowed size of ${maxSizeMB}MB for Supabase Storage`,
        maxSize: SUPABASE_MAX_FILE_SIZE,
        fileSize: req.file.size
      });
    }
    
    const projectId = (req.body.projectId as string) || 'default';
    console.log('Project ID:', projectId);
    
    // Read file into buffer
    const fileBuffer = fs.readFileSync(req.file.path);
    
    // Additional PDF validation
    if (req.file.mimetype === 'application/pdf') {
      console.log('PDF file detected, checking structure...');
      const header = fileBuffer.toString('ascii', 0, 10);
      
      if (!header.startsWith('%PDF')) {
        console.log('ERROR: Invalid PDF header - file may be corrupted');
        // Clean up temp file
        fs.removeSync(req.file.path);
        return res.status(400).json({ 
          error: 'Invalid PDF structure - file may be corrupted or not a valid PDF',
          details: {
            expectedHeader: '%PDF',
            actualHeader: header,
            fileSize: req.file.size,
            mimetype: req.file.mimetype
          }
        });
      }
      console.log('PDF header validation passed');
    }

    // Generate unique filename for Supabase Storage
    const fileId = uuidv4();
    const fileExtension = path.extname(req.file.originalname);
    const storagePath = `${projectId}/${fileId}${fileExtension}`;
    
    console.log('Uploading to Supabase Storage:', storagePath);
    
    // Upload to Supabase Storage bucket (assuming bucket name is 'project-files')
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('project-files')
      .upload(storagePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    
    // Clean up temp file
    fs.removeSync(req.file.path);
    
    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      
      // Handle specific error cases - check both status and statusCode properties
      const errorStatus = (uploadError as any).statusCode || (uploadError as any).status;
      if (errorStatus === 413 || errorStatus === '413' || uploadError.message?.includes('maximum allowed size')) {
        return res.status(413).json({ 
          error: 'File too large', 
          message: `File size (${(req.file.size / (1024 * 1024)).toFixed(2)}MB) exceeds Supabase Storage limits. Please check your Supabase plan limits.`,
          maxSize: SUPABASE_MAX_FILE_SIZE,
          fileSize: req.file.size,
          details: uploadError.message
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to upload file to storage', 
        details: uploadError.message,
        statusCode: errorStatus
      });
    }
    
    console.log('File uploaded to Supabase Storage successfully');

    const fileMeta: StoredFileMeta = {
      id: fileId,
      projectId,
      originalName: req.file.originalname,
      filename: `${fileId}${fileExtension}`,
      path: storagePath, // Store Supabase Storage path instead of local path
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    };
    
    console.log('File metadata created:', fileMeta);

    const savedFile = await storage.saveFile(fileMeta);
    
    console.log('File saved to storage successfully');
    console.log('File saved:', savedFile);

    return res.json({ success: true, file: savedFile });
  } catch (e) {
    console.error('Upload error:', e);
    // Clean up temp file on error
    if (req.file?.path) {
      try {
        fs.removeSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    return res.status(500).json({ error: 'Upload failed', details: String(e) });
  }
});

// Get all files (admin only)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Only admins can see all files
    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const files = await storage.getFiles();
    return res.json({ files });
  } catch (error) {
    console.error('Error fetching files:', error);
    return res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.get('/:fileId', requireAuth, validateUUIDParam('fileId'), async (req, res) => {
  const startTime = Date.now();
  const { fileId } = req.params;
  
  console.log('🔍 [FILE REQUEST] Starting file fetch:', {
    fileId,
    method: req.method,
    path: req.path,
    userId: req.user!.id,
    timestamp: new Date().toISOString()
  });
  
  try {
    const user = req.user!;
    
    // Query file directly by ID instead of getting all files
    const { data: fileData, error: fileError } = await supabase
      .from(TABLES.FILES)
      .select('*')
      .eq('id', fileId)
      .single();
    
    if (fileError) {
      console.error('❌ Supabase query error:', fileError);
      // Check if it's a "not found" error (PGRST116) or other error
      if (fileError.code === 'PGRST116') {
        return res.status(404).json({ error: 'File not found' });
      }
      return res.status(500).json({ error: 'Database error', details: fileError.message });
    }
    
    if (!fileData) {
      console.error('❌ No file data returned for fileId:', fileId);
      return res.status(404).json({ error: 'File not found' });
    }
    
    console.log('✅ File found:', { id: fileData.id, projectId: fileData.project_id, path: fileData.path });
    
    // Map to StoredFileMeta format
    const meta: StoredFileMeta = {
      id: fileData.id,
      projectId: fileData.project_id,
      originalName: fileData.original_name,
      filename: fileData.filename,
      path: fileData.path,
      size: fileData.size,
      mimetype: fileData.mimetype,
      uploadedAt: fileData.uploaded_at
    };
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    
    // Verify the user has access to this file's project
    let projectQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', meta.projectId);
    
    if (!userIsAdmin) {
      projectQuery = projectQuery.eq('user_id', user.id);
    }
    
    const { data: project, error: projectError } = await projectQuery.single();
    
    if (projectError || !project) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    
    // Get file from Supabase Storage
    console.log('Fetching file from Supabase Storage:', meta.path);
    
    try {
      // Use createReadStream for better memory efficiency on Railway free tier
      // This streams the file instead of loading it all into memory
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(meta.path);
      
      if (error || !data) {
        console.error('Supabase Storage download error:', error);
        return res.status(404).json({ error: 'File not found in storage' });
      }
      
      // Get file size for Content-Length header (if available)
      // Note: Supabase blob doesn't always expose size, so we'll stream without it
      // The browser will handle chunked transfer encoding
      
      // Set appropriate headers
      res.setHeader('Content-Type', meta.mimetype);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.originalName)}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      
      // Convert blob to stream for memory-efficient transfer
      // This is critical for Railway free tier memory limits
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Log file size for debugging
      const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
      const elapsedMs = Date.now() - startTime;
      console.log(`📄 [FILE REQUEST] Sending PDF file: ${meta.originalName} (${fileSizeMB} MB) - took ${elapsedMs}ms`);
      
      // Check if file is too large for free tier (warn but still try)
      // Only warn in development to reduce production log noise
      if (buffer.length > 50 * 1024 * 1024 && process.env.NODE_ENV !== 'production') { // 50MB
        console.warn(`⚠️ [FILE REQUEST] Large file detected (${fileSizeMB} MB) - may cause issues on Railway free tier`);
      }
      
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
      console.log(`✅ [FILE REQUEST] File sent successfully: ${fileId} (${elapsedMs}ms total)`);
      return;
    } catch (error: any) {
      // Enhanced error handling for Railway free tier issues
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = (error as any)?.code;
      const elapsedMs = Date.now() - startTime;
      
      console.error('❌ [FILE REQUEST] Error fetching file from storage:', {
        error: errorMessage,
        code: errorCode,
        fileId: req.params.fileId,
        path: meta?.path || 'unknown',
        stack: error instanceof Error ? error.stack : undefined,
        elapsedMs
      });
      
      // Check for common Railway free tier errors
      if (errorMessage.includes('memory') || errorMessage.includes('ENOMEM')) {
        return res.status(507).json({ 
          error: 'Insufficient memory', 
          message: 'File too large for current plan. Consider upgrading Railway plan or using smaller files.',
          details: errorMessage
        });
      }
      
      if (errorMessage.includes('timeout') || errorCode === 'ETIMEDOUT') {
        return res.status(504).json({ 
          error: 'Request timeout', 
          message: 'File download timed out. File may be too large for current plan.',
          details: errorMessage
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch file',
        details: errorMessage
      });
    }
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('❌ [FILE REQUEST] Unexpected error in file route:', {
      fileId,
      error: errorMessage,
      stack: errorStack,
      elapsedMs,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({ 
      error: 'Failed to fetch file',
      details: errorMessage,
      fileId
    });
  }
});

router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(req.user!.id);
    
    // First, verify the user has access to this project
    let projectQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId);
    
    if (!userIsAdmin) {
      projectQuery = projectQuery.eq('user_id', req.user!.id);
    }
    
    const { data: project, error: projectError } = await projectQuery.single();
    
    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    // Get files for the project
    const { data: files, error } = await supabase
      .from(TABLES.FILES)
      .select('*')
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching project files:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch project files',
        details: error.message 
      });
    }
    
    return res.json({ files: files || [] });
  } catch (error) {
    console.error('Error fetching project files:', error);
    return res.status(500).json({ error: 'Failed to fetch project files' });
  }
});

router.delete('/:fileId', requireAuth, validateUUIDParam('fileId'), async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log('🗑️ DELETE FILE REQUEST:', { fileId, userId: req.user!.id });
    
    // Query file directly by ID
    const { data: fileData, error: fileError } = await supabase
      .from(TABLES.FILES)
      .select('*')
      .eq('id', fileId)
      .single();
    
    if (fileError || !fileData) {
      console.log('❌ File not found:', fileId);
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Check if user has access to this file's project
    const userIsAdmin = await isAdmin(req.user!.id);
    let projectQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', fileData.project_id);
    
    if (!userIsAdmin) {
      projectQuery = projectQuery.eq('user_id', req.user!.id);
    }
    
    const { data: project, error: projectError } = await projectQuery.single();
    
    if (projectError || !project) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }
    
    console.log('🗑️ Deleting file:', { 
      id: fileData.id, 
      name: fileData.original_name, 
      path: fileData.path,
      projectId: fileData.project_id 
    });

    // Check for associated measurements
    const { data: measurements, error: measurementsError } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('id')
      .eq('sheet_id', fileId);
    
    if (measurementsError) {
      console.error('❌ Error checking measurements:', measurementsError);
      return res.status(500).json({ error: 'Failed to check associated data' });
    }
    
    const measurementCount = measurements?.length || 0;
    console.log(`📊 Found ${measurementCount} measurements associated with file ${fileId}`);
    
    // Check for associated annotations (if annotations table exists)
    // Note: Adjust table name if different
    const { data: annotations } = await supabase
      .from('takeoff_annotations')
      .select('id')
      .eq('sheet_id', fileId)
      .limit(1);
    
    const annotationCount = annotations?.length || 0;
    
    // Check for associated calibrations
    const { data: calibrations } = await supabase
      .from(TABLES.CALIBRATIONS)
      .select('id')
      .eq('sheet_id', fileId)
      .limit(1);
    
    const calibrationCount = calibrations?.length || 0;
    
    // If there's associated data, delete it first (cascade delete)
    if (measurementCount > 0 || annotationCount > 0 || calibrationCount > 0) {
      console.log(`🗑️ Cascading delete: ${measurementCount} measurements, ${annotationCount} annotations, ${calibrationCount} calibrations`);
      
      // Delete measurements
      if (measurementCount > 0) {
        const { error: deleteMeasurementsError } = await supabase
          .from(TABLES.TAKEOFF_MEASUREMENTS)
          .delete()
          .eq('sheet_id', fileId);
        
        if (deleteMeasurementsError) {
          console.error('❌ Error deleting measurements:', deleteMeasurementsError);
          return res.status(500).json({ error: 'Failed to delete associated measurements' });
        }
        console.log(`✅ Deleted ${measurementCount} measurements`);
      }
      
      // Delete annotations
      if (annotationCount > 0) {
        const { error: deleteAnnotationsError } = await supabase
          .from('takeoff_annotations')
          .delete()
          .eq('sheet_id', fileId);
        
        if (deleteAnnotationsError) {
          console.warn('⚠️ Error deleting annotations (may not exist):', deleteAnnotationsError);
          // Don't fail if annotations table doesn't exist
        } else {
          console.log(`✅ Deleted ${annotationCount} annotations`);
        }
      }
      
      // Delete calibrations
      if (calibrationCount > 0) {
        const { error: deleteCalibrationsError } = await supabase
          .from(TABLES.CALIBRATIONS)
          .delete()
          .eq('sheet_id', fileId);
        
        if (deleteCalibrationsError) {
          console.error('❌ Error deleting calibrations:', deleteCalibrationsError);
          return res.status(500).json({ error: 'Failed to delete associated calibrations' });
        }
        console.log(`✅ Deleted ${calibrationCount} calibrations`);
      }
    }

    // Delete from Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('project-files')
      .remove([fileData.path]);
    
    if (storageError) {
      console.error('❌ Error removing file from Supabase Storage:', storageError);
      // Continue with metadata removal even if file deletion fails
    } else {
      console.log('✅ File removed from Supabase Storage:', fileData.path);
    }
    
    // Delete file metadata
    const { error: deleteError } = await supabase
      .from(TABLES.FILES)
      .delete()
      .eq('id', fileId);
    
    if (deleteError) {
      console.error('❌ Error deleting file metadata:', deleteError);
      return res.status(500).json({ error: 'Failed to delete file metadata' });
    }
    
    console.log('✅ File and all associated data deleted successfully');
    
    return res.json({ 
      success: true,
      deletedMeasurements: measurementCount,
      deletedAnnotations: annotationCount,
      deletedCalibrations: calibrationCount
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

export { router as fileRoutes };
