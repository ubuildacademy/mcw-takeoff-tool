/**
 * Assemblies API — the native assembly library (see docs/ASSEMBLIES_DESIGN.md).
 *
 * Import is two steps (`/extract` then `/import`), and the library prices
 * conditions live (`/price`) and produces the Material/Labor budget report
 * (`/report`).
 *
 * The Stage 1 workbook bridge that used to live here — the workbook registry,
 * condition-to-cell mappings and `/generate`, which wrote quantities into a
 * copy of the customer's own spreadsheet — was removed on 2026-07-31, having
 * been superseded by the native library it was built to bootstrap.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin, hasProjectAccess, isValidUUIDAnyVersion, validateUUIDParam } from '../middleware';
import { assemblyExtractor } from '../services/assemblyExtractor';
import {
  deleteAssembly,
  getAssemblyDetail,
  getAssemblyDetails,
  getCostDefaults,
  getOrganizationForUser,
  getProductsByCodes,
  listAssemblies,
} from '../services/assemblyLibraryService';
import {
  priceCondition,
  sumConditionPricing,
  type ConditionPricing,
  type ConditionPricingRequest,
} from '../services/conditionAssemblyPricing';
import {
  buildAssemblyReport,
  ratesForWorkType,
  type MaterialLineSource,
  type WorkType,
} from '../services/assemblyReport';
import {
  resolveAssemblyCostSettings,
  type AssemblyDetail,
  type CostDefaultsRecord,
} from '../services/assemblyLibraryService';
import { previewAssemblyImport, saveAssemblyFromProposal } from '../services/assemblyImportService';

const router = express.Router();

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
    uploadHandler(req, res, (err: unknown) => {
      if (err) {
        const details = err instanceof Error ? err.message : String(err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'File too large', message: 'Workbook exceeds the 25MB limit' });
          }
          return res.status(400).json({ error: 'Upload error', details });
        }
        if (details === 'Invalid file type') {
          return res.status(400).json({ error: 'Invalid file type', message: 'Only .xlsx and .xlsm workbooks are allowed' });
        }
        return res.status(400).json({ error: 'Upload error', details });
      }
      resolve();
      next();
    });
  });
};

// ── Stage 2: native assembly library ───────────────────────────────────
// Import is deliberately TWO steps. `/extract` parses a workbook and returns a
// proposal without writing anything; the reviewer fixes what the importer
// flagged; `/import` saves the reviewed proposal. Saving straight from a parse
// would bake in every gap the extractor could not resolve.

/** The org that owns the library. A user outside one is a setup problem, not an empty list. */
async function requireLibraryOrg(req: express.Request, res: express.Response) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const org = await getOrganizationForUser(user.id);
  if (!org) {
    res.status(409).json({
      error: 'No organization',
      message: 'This account is not a member of any company yet, so it has no assembly library.',
    });
    return null;
  }
  return org;
}

/** Parse a workbook into a proposal. Writes nothing. */
router.post('/extract', requireAuth, requireAdmin, handleUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const org = await requireLibraryOrg(req, res);
    if (!org) {
      await fs.remove(req.file.path).catch(() => {});
      return;
    }

    const proposal = await assemblyExtractor.extract(req.file.path, req.file.originalname);
    await fs.remove(req.file.path).catch(() => {});

    // Show the reviewer what saving WOULD produce — which fields inherit from
    // the company defaults, and what still blocks pricing.
    const preview = await previewAssemblyImport(org.id, proposal as never);
    return res.json({ success: true, proposal, preview });
  } catch (error) {
    console.error('Error extracting assembly workbook:', error);
    if (req.file?.path) await fs.remove(req.file.path).catch(() => {});
    // A workbook we cannot parse is the file's problem, not the server's.
    return res.status(400).json({
      error: 'Failed to read workbook',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Save a reviewed proposal as a native assembly. */
router.post('/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const org = await requireLibraryOrg(req, res);
    if (!org) return;

    const proposal = req.body?.proposal;
    if (!proposal || typeof proposal !== 'object') {
      return res.status(400).json({ error: 'A proposal is required' });
    }
    if (!String(proposal.name ?? '').trim()) {
      return res.status(400).json({ error: 'The assembly needs a name' });
    }

    const summary = await saveAssemblyFromProposal(org.id, proposal, {
      sourceWorkbookId: req.body?.sourceWorkbookId ?? null,
    });
    return res.json({ success: true, assembly: summary });
  } catch (error) {
    console.error('Error importing assembly:', error);
    return res.status(500).json({ error: 'Failed to import assembly', details: String(error) });
  }
});

router.get('/library', requireAuth, async (req, res) => {
  try {
    const org = await requireLibraryOrg(req, res);
    if (!org) return;
    return res.json({ assemblies: await listAssemblies(org.id) });
  } catch (error) {
    console.error('Error listing assemblies:', error);
    return res.status(500).json({ error: 'Failed to list assemblies', details: String(error) });
  }
});

router.get('/library/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const org = await requireLibraryOrg(req, res);
    if (!org) return;
    const assembly = await getAssemblyDetail(org.id, req.params.id);
    if (!assembly) return res.status(404).json({ error: 'Assembly not found' });
    return res.json({ assembly });
  } catch (error) {
    console.error('Error loading assembly:', error);
    return res.status(500).json({ error: 'Failed to load assembly', details: String(error) });
  }
});

/**
 * Price linked conditions live from their takeoff quantities (task I6).
 *
 * `requireAuth`, deliberately not `requireAdmin`: every org member sees the
 * dollars (Jeff, 2026-07-27). Only *editing* the library is gated.
 *
 * The client sends quantities because it already has them — the measurement
 * store is the live source and re-deriving them server-side would put the
 * number a step behind the drawing. The assembly, its prices and the company
 * rates all come from the server, so a client cannot invent a price; the worst
 * a bad quantity does is misprice that caller's own screen.
 */
/**
 * Validate the shared request body and price it. Returns a 400/404 through
 * `res` and null when the request is bad, so both /price and /report enforce
 * the same rules — a second copy of this would be a second place for the
 * project-access check to drift.
 */
async function priceRequestedConditions(
  req: express.Request,
  res: express.Response
): Promise<{
  orgId: string;
  pricings: ConditionPricing[];
  assemblies: Map<string, AssemblyDetail>;
  costDefaults: CostDefaultsRecord;
  unknownAssemblyIds: string[];
} | null> {
  const org = await requireLibraryOrg(req, res);
  if (!org) return null;
  // requireLibraryOrg already answered an unauthenticated request; this re-reads
  // the user as a value so the project check below needs no assertion.
  const user = req.user;
  if (!user) return null;

  const { projectId, items } = req.body ?? {};
  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'items must be an array' });
    return null;
  }
  if (items.length > 500) {
    res.status(400).json({ error: 'Too many items in one request (max 500)' });
    return null;
  }
  if (projectId !== undefined && projectId !== null) {
    if (!isValidUUIDAnyVersion(String(projectId))) {
      res.status(400).json({ error: 'Invalid projectId' });
      return null;
    }
    const allowed = await hasProjectAccess(user.id, String(projectId), user.role === 'admin');
    if (!allowed) {
      res.status(404).json({ error: 'Project not found or access denied' });
      return null;
    }
  }

  const requests: (ConditionPricingRequest & { assemblyId: string })[] = [];
  for (const item of items) {
    const conditionId = String(item?.conditionId ?? '');
    const assemblyId = String(item?.assemblyId ?? '');
    const quantityInputId = String(item?.quantityInputId ?? '');
    if (!isValidUUIDAnyVersion(assemblyId) || !isValidUUIDAnyVersion(quantityInputId)) {
      res.status(400).json({ error: 'Each item needs a valid assemblyId and quantityInputId' });
      return null;
    }
    requests.push({
      conditionId,
      assemblyId,
      quantityInputId,
      quantity: Number(item?.quantity) || 0,
    });
  }

  const costDefaults = await getCostDefaults(org.id);
  if (requests.length === 0) {
    return {
      orgId: org.id,
      pricings: [],
      assemblies: new Map(),
      costDefaults,
      unknownAssemblyIds: [],
    };
  }

  const assemblies = await getAssemblyDetails(org.id, requests.map((r) => r.assemblyId));

  // One price lookup for every code across every assembly asked for.
  const codes = new Set<string>();
  for (const assembly of assemblies.values()) {
    for (const component of assembly.components) {
      if (component.productCode) codes.add(component.productCode);
    }
  }
  const products = await getProductsByCodes(org.id, [...codes]);
  const pricesByCode: Record<string, number> = {};
  for (const [code, product] of products) {
    if (product.netPrice !== null) pricesByCode[code] = product.netPrice;
  }

  const pricings: ConditionPricing[] = [];
  const unknownAssemblyIds: string[] = [];
  for (const request of requests) {
    const assembly = assemblies.get(request.assemblyId);
    // An assembly deleted from the library after a condition was linked to it.
    // Reported rather than skipped, so the UI can say the link is stale instead
    // of quietly showing no cost.
    if (!assembly) {
      unknownAssemblyIds.push(request.assemblyId);
      continue;
    }
    pricings.push(priceCondition({ assembly, request, pricesByCode, costDefaults }));
  }

  return { orgId: org.id, pricings, assemblies, costDefaults, unknownAssemblyIds };
}

router.post('/price', requireAuth, async (req, res) => {
  try {
    const priced = await priceRequestedConditions(req, res);
    if (!priced) return;
    return res.json({
      pricings: priced.pricings,
      totals: sumConditionPricing(priced.pricings),
      unknownAssemblyIds: priced.unknownAssemblyIds,
    });
  } catch (error) {
    console.error('Error pricing conditions:', error);
    return res.status(500).json({ error: 'Failed to price conditions', details: String(error) });
  }
});

/**
 * The Material / Labor budget report (task I7).
 *
 * Prices exactly as /price does, then decomposes the result into the buckets
 * the accounting system posts against. Same auth: every org member may pull a
 * report, because everyone sees the dollars.
 */
router.post('/report', requireAuth, async (req, res) => {
  try {
    const priced = await priceRequestedConditions(req, res);
    if (!priced) return;

    const workType: WorkType = req.body?.workType === 'restoration' ? 'restoration' : 'waterproofing';
    const rates = ratesForWorkType(priced.costDefaults, workType);

    // Packaging lives on the component, not on the priced line, so the report
    // needs the assemblies to fill the Uom column.
    const sourcesByComponentId = new Map<string, MaterialLineSource>();
    const laborByAssemblyId = new Map<string, { crewSize: number; dayRatePerMan: number }>();
    for (const assembly of priced.assemblies.values()) {
      for (const component of assembly.components) {
        sourcesByComponentId.set(component.id, {
          description: component.description,
          productCode: component.productCode,
          yieldUnit: component.yieldUnit,
          packagingUnit: component.packagingUnit,
        });
      }
      const settings = resolveAssemblyCostSettings(assembly, priced.costDefaults);
      laborByAssemblyId.set(assembly.id, {
        crewSize: assembly.crewSize ?? 0,
        dayRatePerMan: settings.dayRatePerMan ?? 0,
      });
    }

    const report = buildAssemblyReport({
      pricings: priced.pricings,
      laborByAssemblyId,
      sourcesByComponentId,
      taxPct: priced.costDefaults.taxPct ?? 0,
      rates,
      workType,
    });

    if (priced.unknownAssemblyIds.length > 0) {
      report.warnings.push(
        `${priced.unknownAssemblyIds.length} condition(s) are linked to an assembly that is no longer in the library and are missing from this report.`
      );
    }

    return res.json({ report, totals: sumConditionPricing(priced.pricings) });
  } catch (error) {
    console.error('Error building assembly report:', error);
    return res.status(500).json({ error: 'Failed to build the report', details: String(error) });
  }
});

router.delete('/library/:id', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const org = await requireLibraryOrg(req, res);
    if (!org) return;
    await deleteAssembly(org.id, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting assembly:', error);
    return res.status(500).json({ error: 'Failed to delete assembly', details: String(error) });
  }
});

export default router;
