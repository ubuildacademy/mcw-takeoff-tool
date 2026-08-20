/**
 * Single-file upload middleware.
 *
 * routes/files.ts, routes/assemblies.ts and routes/products.ts each carried their
 * own copy of the same 45 lines — the same disk storage into `uploads/temp` under a
 * uuid-prefixed name, the same extension allow-list, and the same multer error
 * translation. Only the size cap, the accepted extensions and the two rejection
 * messages ever differed, so those are the parameters and everything else is shared.
 * Notably the allow-list is the server's own check on what it will accept, and three
 * copies of it were three places for it to drift.
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

const uploadRoot = path.join(__dirname, '../../uploads');
fs.ensureDirSync(uploadRoot);

const storageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Land in a temp dir first; each route moves the file to its final home.
    const tempDir = path.join(uploadRoot, 'temp');
    fs.ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: (_req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});

export interface UploadMiddlewareOptions {
  /** Rejected above this size with a 413 carrying `tooLargeBody`. */
  maxBytes: number;
  /** Lower-case extensions, dot included, e.g. ['.xlsx', '.xlsm']. */
  allowedExtensions: string[];
  /** JSON body for the 413 when multer reports LIMIT_FILE_SIZE. */
  tooLargeBody: Record<string, unknown>;
  /** JSON body for the 400 when the extension is not on the allow-list. */
  invalidTypeBody: Record<string, unknown>;
}

/**
 * Express middleware accepting one `file` field.
 *
 * On failure it answers the request and never calls `next()`, so the route handler
 * behind it does not run against a missing file. The promise is intentionally left
 * unresolved on those paths — nothing awaits it, `next()` is what drives the chain.
 */
export function createUploadMiddleware(options: UploadMiddlewareOptions): express.RequestHandler {
  const { maxBytes, allowedExtensions, tooLargeBody, invalidTypeBody } = options;

  const uploadHandler = multer({
    storage: storageEngine,
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedExtensions.includes(ext)) return cb(null, true);
      return cb(new Error('Invalid file type'));
    },
  }).single('file');

  return async (req, res, next) => {
    return new Promise<void>((resolve) => {
      uploadHandler(req, res, (err: unknown) => {
        if (err) {
          const details = err instanceof Error ? err.message : String(err);
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json(tooLargeBody);
            return res.status(400).json({ error: 'Upload error', details });
          }
          if (details === 'Invalid file type') return res.status(400).json(invalidTypeBody);
          return res.status(400).json({ error: 'Upload error', details });
        }

        resolve();
        next();
      });
    });
  };
}
