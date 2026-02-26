/**
 * Cleans up expired report delivery files from Supabase Storage.
 * Report links expire after 7 days; this job deletes files older than that.
 */
import { supabase } from '../supabase';
import { REPORT_DELIVERY } from '../config/reportDelivery';

interface StorageFile {
  name: string;
  id?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export async function cleanupExpiredReportDeliveries(): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  try {
    const { data: topLevel, error: listError } = await supabase.storage
      .from(REPORT_DELIVERY.BUCKET)
      .list(REPORT_DELIVERY.STORAGE_PREFIX, { limit: 1000 });

    if (listError) {
      console.error('Report cleanup: failed to list', listError);
      return { deleted: 0, errors: [listError.message] };
    }

    if (!topLevel?.length) {
      return { deleted: 0, errors: [] };
    }

    const now = Date.now();
    const pathsToDelete: string[] = [];

    for (const item of topLevel as StorageFile[]) {
      const deliveryPath = `${REPORT_DELIVERY.STORAGE_PREFIX}/${item.name}`;
      const { data: files, error: filesError } = await supabase.storage
        .from(REPORT_DELIVERY.BUCKET)
        .list(deliveryPath, { limit: 100 });

      if (filesError) {
        errors.push(`List ${deliveryPath}: ${filesError.message}`);
        continue;
      }

      if (!files?.length) continue;

      const fileList = files as StorageFile[];
      let oldestCreated: number | null = null;
      for (const f of fileList) {
        if (f.created_at) {
          const t = new Date(f.created_at).getTime();
          if (!isNaN(t)) oldestCreated = oldestCreated == null ? t : Math.min(oldestCreated, t);
        }
      }
      if (oldestCreated == null) continue;

      if (now - oldestCreated > REPORT_DELIVERY.LINK_EXPIRY_MS) {
        for (const f of fileList) {
          pathsToDelete.push(`${deliveryPath}/${f.name}`);
        }
      }
    }

    if (pathsToDelete.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(REPORT_DELIVERY.BUCKET)
        .remove(pathsToDelete);

      if (removeError) {
        console.error('Report cleanup: failed to remove', removeError);
        errors.push(removeError.message);
      } else {
        deleted = pathsToDelete.length;
        if (deleted > 0) {
          console.log(`Report cleanup: deleted ${deleted} expired file(s)`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Report cleanup error:', err);
    errors.push(msg);
  }

  return { deleted, errors };
}
