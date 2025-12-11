import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import 'dotenv/config';

async function runMigration(migrationFile: string) {
  try {
    console.log(`📄 Reading migration file: ${migrationFile}`);
    const migrationPath = path.join(__dirname, '..', 'migrations', migrationFile);
    const sql = await fs.readFile(migrationPath, 'utf-8');
    
    const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
    }
    
    console.log('🔧 Executing migration via Supabase REST API...');
    
    // Supabase doesn't have a direct SQL execution endpoint via REST API
    // We need to use the PostgREST API or Management API
    // The simplest way is to use the Supabase SQL editor, but we can try via REST
    
    // Actually, the best approach is to use psql if available, or provide instructions
    console.log('\n⚠️  Supabase JS client cannot execute raw SQL directly.');
    console.log('📋 Please run this migration in your Supabase SQL editor:');
    console.log('\n' + '='.repeat(80));
    console.log(sql);
    console.log('='.repeat(80) + '\n');
    
    console.log('📝 Steps to run:');
    console.log('1. Go to https://supabase.com/dashboard');
    console.log('2. Select your project');
    console.log('3. Go to SQL Editor');
    console.log('4. Paste the SQL above');
    console.log('5. Click "Run"');
    
    // Try to execute via REST API using rpc (if we had a function)
    // For now, just provide instructions
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Get migration file from command line args
const migrationFile = process.argv[2] || 'create_sheet_label_patterns_table.sql';

runMigration(migrationFile);
