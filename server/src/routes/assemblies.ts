/**
 * Assemblies API — Stage 1 workbook bridge (see docs/ASSEMBLIES_DESIGN.md).
 *
 * Org-wide registry of priced assembly workbooks + condition input-cell
 * mappings (C1: assemblyRegistryService.ts / assembly_workbooks +
 * assembly_mappings tables), plus /generate which sums the mapped
 * conditions' net quantities (locked decision 3), surgically writes them
 * into a copy of the workbook via assembly_write.py, and streams the
 * priced workbook back. The workbook's cost engine always lives on a
 * sheet named "ASSEMBLY" (see design doc); mappings only store cell
 * addresses on that sheet, not a sheet name.
 */
import express from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { storage } from '../storage';
import { requireAuth, requireAdmin, hasProjectAccess, isValidUUIDAnyVersion, validateUUIDParam } from '../middleware';
import {
  createAssemblyWorkbook,
  listAssemblyWorkbooks,
  getAssemblyWorkbook,
  deleteAssemblyWorkbook,
  createAssemblyMapping,
  listAssemblyMappings,
  getAssemblyMappingById,
  deleteAssemblyMapping,
  type AssemblyMappingInput,
} from '../services/assemblyRegistryService';
import { assemblyWriter, type AssemblyCellsBySheet } from '../services/assemblyWriter';

const router = express.Router();

const ASSEMBLY_SHEET_NAME = 'ASSEMBLY';
const CELL_ADDRESS_RE = /^[A-Za-z]+[0-9]+$/;
const STORAGE_BUCKET = 'project-files';
const WORKBOOK_STORAGE_PREFIX = 'assembly-workbooks';

// ── Upload storage plumbing (mirrors routes/files.ts) ───────────────────

const uploadRoot = path.join(__dirname, '../../uploads');
fs.ensureDirSync(uploadRoot);

const storageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(uploadRoot, 'temp');
    fs.ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});

const upload = multer({
  storage: storageEngine,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xlsm') return cb(null, true);
    return cb(new Error('Invalid file type'));
  },
});

const uploadHandler = upload.single('file');
const handleUpload = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  return new Promise<void>((resolve) => {
    uploadHandler(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large', message: 'Workbook exceeds the 25MB limit' });
          }
          return res.status(400).json({ error: 'Upload error', details: err.message });
        }
        if (err.message === 'Invalid file type') {
          return res.status(400).json({ error: 'Invalid file type', message: 'Only .xlsx and .xlsm workbooks are allowed' });
        }
        return res.status(400).json({ error: 'Upload error', details: err.message });
      }
      resolve();
      next();
    });
  });
};

// ── Workbooks ────────────────────────────────────────────────────────────

router.post('/upload', requireAuth, requireAdmin, handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbookId = uuidv4();
    const ext = path.extname(req.file.originalname);
    const storagePath = `${WORKBOOK_STORAGE_PREFIX}/${workbookId}${ext}`;
    const fileBuffer = await fs.readFile(req.file.path);

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: req.file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: false,
      });

    if (uploadError) {
      await fs.remove(req.file.path);
      console.error('Assembly workbook storage upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload workbook to storage', details: uploadError.message });
    }

    const workbook = await createAssemblyWorkbook({
      filename: req.file.originalname,
      storagePath,
      uploadedBy: req.user!.id,
    });

    // C5 auto-map: scan the ASSEMBLY sheet before the temp file is removed.
    // Scan failure must never fail the upload — the manual mapping form is the fallback.
    let proposal = null;
    try {
      proposal = await assemblyWriter.scan(req.file.path);
    } catch (scanError) {
      console.error('Assembly workbook scan error:', scanError);
    }

    await fs.remove(req.file.path);

    return res.json({ success: true, workbook, proposal });
  } catch (error) {
    console.error('Error uploading assembly workbook:', error);
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
    return res.status(500).json({ error: 'Failed to upload assembly workbook', details: String(error) });
  }
});

router.get('/workbooks', requireAuth, async (_req, res) => {
  try {
    const workbooks = await listAssemblyWorkbooks();
    return res.json({ workbooks });
  } catch (error) {
    console.error('Error fetching assembly workbooks:', error);
    return res.status(500).json({ error: 'Failed to fetch assembly workbooks' });
  }
});

router.delete('/workbooks/:id', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const workbook = await getAssemblyWorkbook(id);
    if (!workbook) {
      return res.status(404).json({ error: 'Assembly workbook not found' });
    }

    const { error: removeError } = await supabase.storage.from(STORAGE_BUCKET).remove([workbook.storagePath]);
    if (removeError) {
      console.error('Error removing assembly workbook from storage:', removeError);
      // Continue with metadata removal even if storage cleanup fails.
    }

    // Cascades to assembly_mappings (FK ON DELETE CASCADE).
    await deleteAssemblyWorkbook(id);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting assembly workbook:', error);
    return res.status(500).json({ error: 'Failed to delete assembly workbook' });
  }
});

// ── Mappings ─────────────────────────────────────────────────────────────

function sanitizeInputs(raw: unknown): AssemblyMappingInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const inputs: AssemblyMappingInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { label, cell } = item as { label?: unknown; cell?: unknown };
    if (typeof label !== 'string' || !label.trim()) return null;
    if (typeof cell !== 'string' || !CELL_ADDRESS_RE.test(cell.trim())) return null;
    inputs.push({ label: label.trim(), cell: cell.trim().toUpperCase() });
  }
  return inputs;
}

function sanitizeJobInfoCells(raw: unknown): Record<string, string> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || !CELL_ADDRESS_RE.test(value.trim())) return null;
    out[key] = value.trim().toUpperCase();
  }
  return out;
}

router.post('/mappings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { workbookId, conditionRef, inputs, jobInfoCells } = req.body ?? {};

    if (typeof workbookId !== 'string' || !isValidUUIDAnyVersion(workbookId)) {
      return res.status(400).json({ error: 'Invalid or missing workbookId' });
    }
    const workbook = await getAssemblyWorkbook(workbookId);
    if (!workbook) {
      return res.status(404).json({ error: 'Assembly workbook not found' });
    }
    if (typeof conditionRef !== 'string' || !conditionRef.trim()) {
      return res.status(400).json({ error: 'conditionRef is required (a condition name pattern or template id)' });
    }
    const cleanInputs = sanitizeInputs(inputs);
    if (!cleanInputs) {
      return res.status(400).json({ error: 'inputs must be a non-empty array of {label, cell}' });
    }
    const cleanJobInfoCells = sanitizeJobInfoCells(jobInfoCells);
    if (cleanJobInfoCells === null && jobInfoCells !== undefined && jobInfoCells !== null) {
      return res.status(400).json({ error: 'jobInfoCells must be a map of field name -> cell address' });
    }

    const mapping = await createAssemblyMapping({
      workbookId,
      conditionRef: conditionRef.trim(),
      inputs: cleanInputs,
      jobInfoCells: cleanJobInfoCells,
    });

    return res.json({ success: true, mapping });
  } catch (error) {
    console.error('Error creating assembly mapping:', error);
    return res.status(500).json({ error: 'Failed to create assembly mapping' });
  }
});

router.get('/mappings', requireAuth, async (req, res) => {
  try {
    const workbookId = typeof req.query.workbookId === 'string' ? req.query.workbookId : undefined;
    const mappings = await listAssemblyMappings(workbookId);
    return res.json({ mappings });
  } catch (error) {
    console.error('Error fetching assembly mappings:', error);
    return res.status(500).json({ error: 'Failed to fetch assembly mappings' });
  }
});

router.delete('/mappings/:id', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    await deleteAssemblyMapping(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting assembly mapping:', error);
    return res.status(500).json({ error: 'Failed to delete assembly mapping' });
  }
});

// ── Generate ─────────────────────────────────────────────────────────────

const JOB_INFO_FIELD_SOURCES: Record<string, (project: { name: string; client?: string; location?: string }) => string> = {
  projectName: (p) => p.name ?? '',
  client: (p) => p.client ?? '',
  address: (p) => p.location ?? '',
};

router.post('/generate', requireAuth, async (req, res) => {
  const { projectId, mappingId, conditionIds } = req.body ?? {};

  if (typeof projectId !== 'string' || !isValidUUIDAnyVersion(projectId)) {
    return res.status(400).json({ error: 'Invalid or missing projectId' });
  }
  if (typeof mappingId !== 'string' || !isValidUUIDAnyVersion(mappingId)) {
    return res.status(400).json({ error: 'Invalid or missing mappingId' });
  }
  if (!Array.isArray(conditionIds) || conditionIds.length === 0 || !conditionIds.every((id) => typeof id === 'string')) {
    return res.status(400).json({ error: 'conditionIds must be a non-empty array of condition ids' });
  }

  const userId = req.user!.id;
  const userIsAdmin = req.user!.role === 'admin';
  const hasAccess = await hasProjectAccess(userId, projectId, userIsAdmin);
  if (!hasAccess) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  let tmpDir: string | undefined;

  try {
    const mapping = await getAssemblyMappingById(mappingId);
    if (!mapping) {
      return res.status(404).json({ error: 'Assembly mapping not found' });
    }
    const workbook = await getAssemblyWorkbook(mapping.workbookId);
    if (!workbook) {
      return res.status(404).json({ error: 'Assembly workbook not found' });
    }

    const project = await storage.getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Resolve conditions and their net quantities (net measurement value *
    // condition multiplier, mirroring the client's export math). Sum per
    // locked decision 3: multiple conditions feeding one workbook input.
    const conditions = await Promise.all(conditionIds.map((id: string) => storage.getConditionById(id)));
    const missingIdx = conditions.findIndex((c) => !c || c.projectId !== projectId);
    if (missingIdx !== -1) {
      return res.status(404).json({ error: `Condition not found in project: ${conditionIds[missingIdx]}` });
    }

    const measurements = await storage.getTakeoffMeasurementsByProject(projectId);
    const breakdown = conditions.map((condition) => {
      const c = condition!;
      const net = measurements
        .filter((m) => m.conditionId === c.id)
        .reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
      const quantity = net * (c.multiplier ?? 1);
      return { conditionId: c.id, name: c.name, quantity };
    });
    const totalQuantity = breakdown.reduce((sum, b) => sum + b.quantity, 0);

    const cellsForSheet: Record<string, number | string> = {};
    for (const input of mapping.inputs) {
      cellsForSheet[input.cell] = totalQuantity;
    }
    if (mapping.jobInfoCells) {
      for (const [field, cell] of Object.entries(mapping.jobInfoCells)) {
        const resolver = JOB_INFO_FIELD_SOURCES[field];
        if (resolver) {
          cellsForSheet[cell] = resolver(project);
        }
      }
    }
    const cellsBySheet: AssemblyCellsBySheet = { [ASSEMBLY_SHEET_NAME]: cellsForSheet };

    const { data: workbookBlob, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(workbook.storagePath);
    if (downloadError || !workbookBlob) {
      console.error('Error downloading assembly workbook:', downloadError);
      return res.status(500).json({ error: 'Failed to download assembly workbook from storage' });
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assembly-generate-'));
    const ext = path.extname(workbook.filename) || '.xlsx';
    const srcPath = path.join(tmpDir, `src${ext}`);
    const destPath = path.join(tmpDir, `out${ext}`);

    const arrayBuffer = await workbookBlob.arrayBuffer();
    await fs.writeFile(srcPath, Buffer.from(arrayBuffer));

    await assemblyWriter.write(srcPath, destPath, cellsBySheet);

    const outBuffer = await fs.readFile(destPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(workbook.filename)}"`);
    res.setHeader('Content-Length', outBuffer.length);
    return res.send(outBuffer);
  } catch (error) {
    console.error('Error generating assembly workbook:', error);
    return res.status(500).json({ error: 'Failed to generate assembly workbook', details: String(error) });
  } finally {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  }
});

export default router;
