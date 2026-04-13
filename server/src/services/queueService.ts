/**
 * Queue Service for Background Job Processing
 *
 * Uses BullMQ with Redis for long-running work (CV takeoff, titleblock extraction)
 * so HTTP requests return immediately and Railway/proxy timeouts do not kill jobs.
 */

import { randomUUID } from 'crypto';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { cvTakeoffService } from './cvTakeoffService';
import { runTitleblockExtraction, type TitleblockConfig } from './titleblockExtractionRunner';

// Redis connection configuration
// Railway provides REDIS_URL, or we can use a local Redis for development
// If REDIS_URL is not set, the queue will fail gracefully (for development)
const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL || 'redis://localhost:6379';
const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true; // Reconnect on READONLY error
    }
    return false;
  },
});

// Queue for CV takeoff jobs
export const cvTakeoffQueue = new Queue('cv-takeoff', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Worker to process CV takeoff jobs
export const cvTakeoffWorker = new Worker(
  'cv-takeoff',
  async (job: Job) => {
    const { documentId, pageNumber, projectId, scaleFactor, options } = job.data;
    
    console.log(`🔄 [Queue] Processing CV takeoff job ${job.id} for page ${pageNumber}`);
    
    try {
      // Update job progress
      await job.updateProgress(10);
      
      // Process the page
      const result = await cvTakeoffService.processPage(
        documentId,
        pageNumber,
        projectId,
        scaleFactor,
        options || {
          detectRooms: true,
          detectWalls: true,
          detectDoors: true,
          detectWindows: true,
        }
      );
      
      // Update progress to 100%
      await job.updateProgress(100);
      
      console.log(`✅ [Queue] CV takeoff job ${job.id} completed successfully`);
      console.log(`   Results: ${result.conditionsCreated} conditions, ${result.measurementsCreated} measurements`);
      
      return {
        success: true,
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [Queue] CV takeoff job ${job.id} failed:`, errorMessage);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one job at a time to avoid memory issues
    limiter: {
      max: 1,
      duration: 1000, // Max 1 job per second
    },
  }
);

// Event handlers for monitoring
cvTakeoffWorker.on('completed', (job) => {
  console.log(`✅ [Queue] Job ${job.id} completed`);
});

cvTakeoffWorker.on('failed', (job, err) => {
  console.error(`❌ [Queue] Job ${job?.id} failed:`, err.message);
});

cvTakeoffWorker.on('error', (err) => {
  console.error(`❌ [Queue] Worker error:`, err);
});

/** Titleblock extraction — long-running OCR + LLM; same Redis as CV queue */
export const titleblockExtractionQueue = new Queue('titleblock-extraction', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 50 },
    removeOnFail: { age: 86400 },
  },
});

export const titleblockExtractionWorker = new Worker(
  'titleblock-extraction',
  async (job: Job) => {
    const { projectId, documentIds, titleblockConfig } = job.data as {
      projectId: string;
      documentIds: string[];
      titleblockConfig: TitleblockConfig;
    };

    console.log(`🔄 [Queue] Titleblock extraction job ${job.id} (${documentIds?.length ?? 0} document(s))`);

    await job.updateProgress({ percent: 0, processedPages: 0, totalPages: 0 });

    const result = await runTitleblockExtraction({
      projectId,
      documentIds,
      titleblockConfig,
      onProgress: (p) => job.updateProgress(p),
    });

    return result;
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

titleblockExtractionWorker.on('completed', (job) => {
  console.log(`✅ [Queue] Titleblock job ${job.id} completed`);
});

titleblockExtractionWorker.on('failed', (job, err) => {
  console.error(`❌ [Queue] Titleblock job ${job?.id} failed:`, err.message);
});

titleblockExtractionWorker.on('error', (err) => {
  console.error(`❌ [Queue] Titleblock worker error:`, err);
});

export function generateTitleblockJobId(): string {
  return `tb-${randomUUID()}`;
}

// Graceful shutdown
async function shutdownQueues(): Promise<void> {
  console.log('🛑 [Queue] Shutting down workers...');
  await cvTakeoffWorker.close();
  await titleblockExtractionWorker.close();
  await cvTakeoffQueue.close();
  await titleblockExtractionQueue.close();
  await redisConnection.quit();
}

process.on('SIGTERM', async () => {
  await shutdownQueues();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownQueues();
  process.exit(0);
});

