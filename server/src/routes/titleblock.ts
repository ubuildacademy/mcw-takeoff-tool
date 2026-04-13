import express from 'express';
import { requireAuth, hasProjectAccess, isAdmin } from '../middleware';
import { titleblockExtractionQueue, generateTitleblockJobId } from '../services/queueService';
import type { TitleblockConfig } from '../services/titleblockExtractionRunner';

const router = express.Router();

/**
 * POST /api/titleblock/extract
 * Enqueues background extraction; returns jobId immediately (BullMQ + Redis).
 */
router.post('/extract', requireAuth, async (req, res) => {
  try {
    const { projectId, documentIds, titleblockConfig } = req.body as {
      projectId?: string;
      documentIds?: string[];
      titleblockConfig?: TitleblockConfig;
    };

    if (!projectId || !Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'projectId and documentIds[] are required' });
    }

    if (
      !titleblockConfig ||
      !titleblockConfig.sheetNumberField ||
      !titleblockConfig.sheetNameField
    ) {
      return res
        .status(400)
        .json({ error: 'titleblockConfig with sheetNumberField and sheetNameField is required' });
    }

    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const job = await titleblockExtractionQueue.add(
      'titleblock-extract',
      {
        projectId,
        documentIds,
        titleblockConfig,
      },
      { jobId: generateTitleblockJobId() }
    );

    console.log(`✅ [Titleblock] Queued extraction job ${job.id}`);

    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: 'pending',
      message: 'Titleblock extraction queued',
    });
  } catch (error) {
    console.error('Error enqueueing titleblock extraction:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/titleblock/extract/job/:jobId
 * Poll job status; when completed, `result` matches the former synchronous response body.
 */
router.get('/extract/job/:jobId', requireAuth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await titleblockExtractionQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const { projectId } = job.data as { projectId: string };

    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const state = await job.getState();
    const rawProgress = job.progress;

    let progressPercent = 0;
    let processedPages: number | undefined;
    let totalPages: number | undefined;

    if (typeof rawProgress === 'number') {
      progressPercent = rawProgress;
    } else if (rawProgress && typeof rawProgress === 'object') {
      const p = rawProgress as { percent?: number; processedPages?: number; totalPages?: number };
      progressPercent = typeof p.percent === 'number' ? p.percent : 0;
      processedPages = p.processedPages;
      totalPages = p.totalPages;
    }

    let result: unknown = null;
    let error: string | null = null;

    if (state === 'completed') {
      result = job.returnvalue;
    } else if (state === 'failed') {
      error = job.failedReason || 'Job failed';
    }

    const statusLabel =
      state === 'completed'
        ? 'completed'
        : state === 'failed'
          ? 'failed'
          : state === 'active'
            ? 'processing'
            : 'pending';

    res.json({
      jobId: job.id,
      status: statusLabel,
      progress: progressPercent,
      processedPages,
      totalPages,
      result,
      error,
    });
  } catch (err) {
    console.error('Error getting titleblock job status:', err);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

export default router;
