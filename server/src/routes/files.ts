import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredFileMeta } from '../storage';

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
    
    console.log('=== REQUEST BODY DEBUG ===');
    console.log('req.body keys:', Object.keys(req.body));
    console.log('req.body.projectId:', req.body.projectId);
    console.log('req.body.projectId type:', typeof req.body.projectId);
    console.log('req.body.projectId length:', req.body.projectId?.length);
    
    const projectId = (req.body.projectId as string) || 'default';
    console.log('Final Project ID:', projectId);
    console.log('Final Project ID type:', typeof projectId);
    console.log('Final Project ID length:', projectId.length);
    
    // Move file from temp location to project-specific folder
    const projectDir = path.join(uploadRoot, projectId);
    fs.ensureDirSync(projectDir);
    const newPath = path.join(projectDir, req.file.filename);
    
    console.log('Moving file from:', req.file.path);
    console.log('Moving file to:', newPath);
    
    try {
      fs.moveSync(req.file.path, newPath);
      console.log('File moved successfully');
      // Update the file path for metadata
      req.file.path = newPath;
    } catch (moveError) {
      console.error('Failed to move file:', moveError);
      return res.status(500).json({ error: 'Failed to organize file' });
    }
    
    // Additional PDF validation
    if (req.file.mimetype === 'application/pdf') {
      console.log('PDF file detected, checking structure...');
      
      // Read first few bytes to check PDF header
      const fs = require('fs');
      const buffer = fs.readFileSync(req.file.path, { start: 0, end: 10 });
      const header = buffer.toString('ascii');
      console.log('PDF header bytes:', header);
      console.log('PDF header hex:', buffer.toString('hex'));
      
      if (!header.startsWith('%PDF')) {
        console.log('ERROR: Invalid PDF header - file may be corrupted');
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

    const fileMeta: StoredFileMeta = {
      id: uuidv4(),
      projectId,
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
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
    if (!fs.existsSync(meta.path)) return res.status(404).json({ error: 'File missing on disk' });
    return res.sendFile(meta.path);
  } catch (error) {
    console.error('Error fetching file:', error);
    return res.status(500).json({ error: 'Failed to fetch file' });
  }
});

router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const files = await storage.getFilesByProject(projectId);
    return res.json({ files });
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

    try { 
      fs.removeSync(meta.path); 
      console.log('✅ File removed from disk:', meta.path);
    } catch (error) {
      console.error('❌ Error removing file from disk:', error);
      // Continue with metadata removal even if file deletion fails
    }
    
    await storage.deleteFile(fileId);
    console.log('✅ File metadata removed from storage');
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

export { router as fileRoutes };
