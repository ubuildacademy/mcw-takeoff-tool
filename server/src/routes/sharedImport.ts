import { Router } from 'express';
import { supabase } from '../supabase';
import { requireAuth, validateUUIDParam } from '../middleware';
import { performImportFromBackup } from './projects';
import { PROJECT_SHARE } from '../config/reportDelivery';

const router = Router();

/** Import a shared project from storage. Requires auth. Token is the share folder name (UUID). */
router.post('/:token', requireAuth, validateUUIDParam('token'), async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const storagePath = `${PROJECT_SHARE.STORAGE_PREFIX}/${token}/project_backup.json`;
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(PROJECT_SHARE.BUCKET)
      .download(storagePath);

    if (downloadError || !fileData) {
      console.warn('Shared import: file not found or expired', token, downloadError?.message);
      return res.status(404).json({
        error: 'This shared project has expired or is invalid.',
      });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const backup = JSON.parse(buffer.toString('utf-8'));
    if (!backup.version || !backup.project || !backup.timestamp) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    const { project, message, annotations, documentRotations } = await performImportFromBackup(backup, userId);
    return res.json({ success: true, project, message, annotations, documentRotations });
  } catch (error) {
    console.error('Error importing shared project:', error);
    return res.status(500).json({ error: 'Failed to import project' });
  }
});

export default router;
