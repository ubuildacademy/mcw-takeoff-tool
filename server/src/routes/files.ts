import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredFileMeta } from '../storage';
import { supabase, TABLES } from '../supabase';

const router = express.Router();

// Helper function to get authenticated user from request
async function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

// Helper function to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_metadata')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (error || !data) {
    return false;
  }
  
  return data.role === 'admin';
}

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

const upload = multer({
  storage: storageEngine,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '500000000') },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    return cb(new Error('Invalid file type'));
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
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
      return res.status(500).json({ error: 'Failed to upload file to storage', details: uploadError.message });
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

// Get all files
router.get('/', async (req, res) => {
  try {
    const files = await storage.getFiles();
    return res.json({ files });
  } catch (error) {
    console.error('Error fetching files:', error);
    return res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.get('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const files = await storage.getFiles();
    const meta = files.find(f => f.id === fileId);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    
    // Get file from Supabase Storage
    console.log('Fetching file from Supabase Storage:', meta.path);
    const { data, error } = await supabase.storage
      .from('project-files')
      .download(meta.path);
    
    if (error || !data) {
      console.error('Supabase Storage download error:', error);
      return res.status(404).json({ error: 'File not found in storage' });
    }
    
    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Set appropriate headers
    res.setHeader('Content-Type', meta.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${meta.originalName}"`);
    res.setHeader('Content-Length', buffer.length);
    
    return res.send(buffer);
  } catch (error) {
    console.error('Error fetching file:', error);
    return res.status(500).json({ error: 'Failed to fetch file' });
  }
});

router.get('/project/:projectId', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { projectId } = req.params;
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    
    // First, verify the user has access to this project
    let projectQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId);
    
    if (!userIsAdmin) {
      projectQuery = projectQuery.eq('user_id', user.id);
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
      return res.status(500).json({ error: 'Failed to fetch project files' });
    }
    
    return res.json({ files: files || [] });
  } catch (error) {
    console.error('Error fetching project files:', error);
    return res.status(500).json({ error: 'Failed to fetch project files' });
  }
});

router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log('🗑️ DELETE FILE REQUEST:', { fileId });
    
    const files = await storage.getFiles();
    const meta = files.find(f => f.id === fileId);
    
    if (!meta) {
      console.log('❌ File not found in storage:', fileId);
      return res.status(404).json({ error: 'Not found' });
    }
    
    console.log('🗑️ Deleting file:', { 
      id: meta.id, 
      name: meta.originalName, 
      path: meta.path,
      projectId: meta.projectId 
    });

    // Delete from Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('project-files')
      .remove([meta.path]);
    
    if (storageError) {
      console.error('❌ Error removing file from Supabase Storage:', storageError);
      // Continue with metadata removal even if file deletion fails
    } else {
      console.log('✅ File removed from Supabase Storage:', meta.path);
    }
    
    await storage.deleteFile(fileId);
    console.log('✅ File metadata removed from database');
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

export { router as fileRoutes };
