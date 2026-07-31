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
import {
  countAssembliesOverriding,
  getCostDefaults,
  getOrganizationForUser,
  listProducts,
  updateCostDefaults,
} from '../services/assemblyLibraryService';
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
    uploadHandler(req, res, (err: unknown) => {
      if (err) {
        const details = err instanceof Error ? err.message : String(err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res
              .status(413)
              .json({ error: 'File too large', message: 'Price list exceeds the 25MB limit' });
          }
          return res.status(400).json({ error: 'Upload error', details });
        }
        if (details === 'Invalid file type') {
          return res.status(400).json({
            error: 'Invalid file type',
            message: 'Only .xlsx, .xlsm and .csv price lists are allowed',
          });
        }
        return res.status(400).json({ error: 'Upload error', details });
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
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const org = await getOrganizationForUser(user.id);
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

// ── Company cost defaults ──────────────────────────────────────────────
// The rates that repeat across every assembly (day rate, burden, tax, margins,
// insurance). An assembly stores a value only where it differs, so changing one
// here reprices everything that has not overridden it. Crew size and production
// rates are deliberately NOT here — they vary per assembly.

router.get('/cost-defaults', requireAuth, async (req, res) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const [defaults, overrides] = await Promise.all([
      getCostDefaults(org.id),
      countAssembliesOverriding(org.id),
    ]);
    return res.json({ defaults, overrides, organization: { id: org.id, name: org.name } });
  } catch (error) {
    console.error('Error loading cost defaults:', error);
    return res.status(500).json({ error: 'Failed to load cost defaults', details: String(error) });
  }
});

router.put('/cost-defaults', requireAuth, requireAdmin, async (req, res) => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;

    const body = req.body ?? {};
    const numericFields = [
      'dayRatePerMan',
      'laborBurdenPct',
      'escalationPct',
      'surchargePct',
      'taxPct',
      'insuranceRatePerThousand',
      'insuranceMarginPct',
      // Accounting rates (task I7). They do not price anything — they split an
      // already-priced total into the buckets the budget report posts against.
      'payrollTaxPct',
      'workersCompPct',
      'generalLiabilityPct',
      'generalLiabilityRestorationPct',
    ] as const;

    const patch: Record<string, unknown> = { updatedBy: req.user?.id };
    for (const field of numericFields) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || value === '') {
        patch[field] = null;
        continue;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({ error: `${field} must be a number` });
      }
      patch[field] = parsed;
    }

    if ('marginChain' in body) {
      if (!Array.isArray(body.marginChain)) {
        return res.status(400).json({ error: 'marginChain must be an array' });
      }
      const chain = body.marginChain.map((entry: { name?: unknown; rate?: unknown }) => ({
        name: String(entry?.name ?? '').trim(),
        rate: Number(entry?.rate),
      }));
      if (chain.some((m: { name: string; rate: number }) => !m.name || !Number.isFinite(m.rate))) {
        return res.status(400).json({ error: 'each margin needs a name and a numeric rate' });
      }
      // A margin of 1 or more divides by zero in the chain and would produce an
      // infinite price; refuse it here rather than at costing time.
      if (chain.some((m: { rate: number }) => m.rate >= 1 || m.rate < 0)) {
        return res.status(400).json({ error: 'margin rates must be between 0 and 1 (0.22 = 22%)' });
      }
      patch.marginChain = chain;
    }

    const defaults = await updateCostDefaults(org.id, patch);
    const overrides = await countAssembliesOverriding(org.id);
    return res.json({ success: true, defaults, overrides });
  } catch (error) {
    console.error('Error saving cost defaults:', error);
    return res.status(500).json({ error: 'Failed to save cost defaults', details: String(error) });
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
