/**
 * Cleanup script to find and optionally delete orphaned measurements
 * 
 * Orphaned measurements are measurements that reference files (sheetId) that no longer exist.
 * This can happen if files were deleted before we implemented cascade deletion.
 * 
 * Usage:
 *   npm run cleanup-orphaned [--dry-run]
 * 
 * If --dry-run is specified, it will only report orphaned measurements without deleting them.
 */

import 'dotenv/config';
import { supabase, TABLES } from '../supabase';

interface OrphanedMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: string;
  calculatedValue: number;
  pdfPage: number;
}

async function findOrphanedMeasurements(): Promise<OrphanedMeasurement[]> {
  console.log('🔍 Finding orphaned measurements...');
  
  // Get all measurements
  const { data: measurements, error: measurementsError } = await supabase
    .from(TABLES.TAKEOFF_MEASUREMENTS)
    .select('id, project_id, sheet_id, condition_id, type, calculated_value, pdf_page');
  
  if (measurementsError) {
    console.error('❌ Error fetching measurements:', measurementsError);
    throw measurementsError;
  }
  
  if (!measurements || measurements.length === 0) {
    console.log('✅ No measurements found');
    return [];
  }
  
  console.log(`📊 Found ${measurements.length} total measurements`);
  
  // Get all file IDs
  const { data: files, error: filesError } = await supabase
    .from(TABLES.FILES)
    .select('id');
  
  if (filesError) {
    console.error('❌ Error fetching files:', filesError);
    throw filesError;
  }
  
  const fileIds = new Set(files?.map(f => f.id) || []);
  console.log(`📁 Found ${fileIds.size} files`);
  
  // Find measurements with sheetIds that don't exist in files
  const orphaned: OrphanedMeasurement[] = [];
  
  for (const measurement of measurements || []) {
    if (!fileIds.has(measurement.sheet_id)) {
      orphaned.push({
        id: measurement.id,
        projectId: measurement.project_id,
        sheetId: measurement.sheet_id,
        conditionId: measurement.condition_id,
        type: measurement.type,
        calculatedValue: measurement.calculated_value,
        pdfPage: measurement.pdf_page
      });
    }
  }
  
  return orphaned;
}

async function deleteOrphanedMeasurements(orphaned: OrphanedMeasurement[]): Promise<void> {
  if (orphaned.length === 0) {
    console.log('✅ No orphaned measurements to delete');
    return;
  }
  
  console.log(`🗑️ Deleting ${orphaned.length} orphaned measurements...`);
  
  const orphanedIds = orphaned.map(m => m.id);
  
  // Delete in batches to avoid overwhelming the database
  const batchSize = 100;
  for (let i = 0; i < orphanedIds.length; i += batchSize) {
    const batch = orphanedIds.slice(i, i + batchSize);
    const { error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .delete()
      .in('id', batch);
    
    if (error) {
      console.error(`❌ Error deleting batch ${i / batchSize + 1}:`, error);
      throw error;
    }
    
    console.log(`✅ Deleted batch ${i / batchSize + 1} (${batch.length} measurements)`);
  }
  
  console.log(`✅ Successfully deleted ${orphaned.length} orphaned measurements`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  
  try {
    const orphaned = await findOrphanedMeasurements();
    
    if (orphaned.length === 0) {
      console.log('✅ No orphaned measurements found. Database is clean!');
      return;
    }
    
    console.log(`\n⚠️  Found ${orphaned.length} orphaned measurement(s):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Group by sheetId for better reporting
    const bySheetId = new Map<string, OrphanedMeasurement[]>();
    for (const m of orphaned) {
      const existing = bySheetId.get(m.sheetId) || [];
      existing.push(m);
      bySheetId.set(m.sheetId, existing);
    }
    
    for (const [sheetId, measurements] of bySheetId.entries()) {
      const totalValue = measurements.reduce((sum, m) => sum + m.calculatedValue, 0);
      console.log(`\n📄 Missing File: ${sheetId}`);
      console.log(`   Measurements: ${measurements.length}`);
      console.log(`   Total Value: ${totalValue.toFixed(2)}`);
      console.log(`   Project: ${measurements[0].projectId}`);
      console.log(`   Types: ${[...new Set(measurements.map(m => m.type))].join(', ')}`);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (isDryRun) {
      console.log('\n🔍 DRY RUN: No measurements were deleted.');
      console.log('   Run without --dry-run to delete these orphaned measurements.');
    } else {
      console.log('\n🗑️  Proceeding with deletion...');
      await deleteOrphanedMeasurements(orphaned);
      console.log('\n✅ Cleanup complete!');
    }
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { findOrphanedMeasurements, deleteOrphanedMeasurements };

