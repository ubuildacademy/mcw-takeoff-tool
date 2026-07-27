/**
 * Products API — the org's product price list (Stage 2, task I2).
 *
 * Import source is the MCW Pricing Manager's "Export DB" (.xlsx), or any
 * price list with equivalent columns (.csv accepted). The Pricing Manager
 * stays the system of record; this list is the read cache the costing engine
 * resolves component codes against, so there is no editing surface here on
 * purpose — the way to change a price is to update it there and re-import.
 *
 * Access follows the I1 model: any org member may read, company admins write.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin } from '../middleware';
import { getOrganizationForUser, listProducts } from '../services/assemblyLibraryService';
import { getProductListSummary, importPriceList } from '../services/productsImportService';

const router = express.Router();

const uploadRoot = path.join(__dirname, '../../uploads');
fs.ensureDirSync(uploadRoot);

const storageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tempDir = path.join(uploadRoot, 'temp');
    fs.ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: (_req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});

const upload = multer({
  storage: storageEngine,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xlsm' || ext === '.csv') return cb(null, true);
    return cb(new Error('Invalid file type'));
  },
});

const uploadHandler = upload.single('file');
const handleUpload = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  return new Promise<void>((resolve) => {
    uploadHandler(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res
              .status(413)
              .json({ error: 'File too large', message: 'Price list exceeds the 25MB limit' });
          }
          return res.status(400).json({ error: 'Upload error', details: err.message });
        }
        if (err.message === 'Invalid file type') {
          return res.status(400).json({
            error: 'Invalid file type',
            message: 'Only .xlsx, .xlsm and .csv price lists are allowed',
          });
        }
        return res.status(400).json({ error: 'Upload error', details: err.message });
      }
      resolve();
      next();
    });
  });
};

/**
 * The product list belongs to a company, so every route needs one. A user with
 * no membership is a setup problem (the org backfill did not reach them), not
 * an empty list — say so rather than silently showing nothing.
 */
async function requireOrg(req: express.Request, res: express.Response) {
  const org = await getOrganizationForUser(req.user!.id);
  if (!org) {
    res.status(409).json({
      error: 'No organization',
      message: 'This account is not a member of any company yet, so it has no product list.',
    });
    return null;
  }
  return org;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const [products, summary] = await Promise.all([
      listProducts(org.id),
      getProductListSummary(org.id),
    ]);
    return res.json({ products, summary, organization: { id: org.id, name: org.name } });
  } catch (error) {
    console.error('Error listing products:', error);
    return res.status(500).json({ error: 'Failed to list products', details: String(error) });
  }
});

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    return res.json({ summary: await getProductListSummary(org.id) });
  } catch (error) {
    console.error('Error summarising products:', error);
    return res.status(500).json({ error: 'Failed to summarise products', details: String(error) });
  }
});

router.post('/import', requireAuth, requireAdmin, handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const org = await requireOrg(req, res);
    if (!org) {
      await fs.remove(req.file.path).catch(() => {});
      return;
    }

    const result = await importPriceList(org.id, req.file.path);
    await fs.remove(req.file.path).catch(() => {});

    const summary = await getProductListSummary(org.id);
    return res.json({ success: true, ...result, summary });
  } catch (error) {
    console.error('Error importing price list:', error);
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
    // A parse failure is the user's file being wrong, not the server breaking
    // — give them the parser's own message, which names the missing column.
    return res.status(400).json({
      error: 'Failed to import price list',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
