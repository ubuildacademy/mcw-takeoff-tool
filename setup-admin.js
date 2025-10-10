#!/usr/bin/env node

/**
 * Setup script to create initial admin user and migrate existing projects
 * Run this script after updating the database schema
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupAdmin() {
  try {
    console.log('🚀 Setting up admin user and migrating data...');

    // 1. Create admin user in Supabase Auth
    const adminEmail = 'jparido@mcwcompanies.com';
    const adminPassword = 'admin';

    console.log('📧 Creating admin user in Supabase Auth...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true // Skip email confirmation
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        console.log('✅ Admin user already exists in auth');
        // Get existing user
        const { data: existingUser } = await supabase.auth.admin.getUserByEmail(adminEmail);
        authData.user = existingUser.user;
      } else {
        throw authError;
      }
    } else {
      console.log('✅ Admin user created in auth');
    }

    const adminUserId = authData.user.id;

    // 2. Create user metadata
    console.log('👤 Creating user metadata...');
    const { error: metadataError } = await supabase
      .from('user_metadata')
      .upsert({
        id: adminUserId,
        role: 'admin',
        full_name: 'Jeff Parido',
        company: 'MCW Companies',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (metadataError) {
      console.log('ℹ️  User metadata already exists or error:', metadataError.message);
    } else {
      console.log('✅ User metadata created');
    }

    // 3. Migrate existing projects to admin user
    console.log('📁 Migrating existing projects...');
    const { data: existingProjects, error: projectsError } = await supabase
      .from('takeoff_projects')
      .select('id, name, user_id')
      .is('user_id', null);

    if (projectsError) {
      console.error('❌ Error fetching existing projects:', projectsError);
    } else if (existingProjects && existingProjects.length > 0) {
      console.log(`📋 Found ${existingProjects.length} existing projects to migrate`);

      // Update projects that don't have a user_id
      const { error: updateError } = await supabase
        .from('takeoff_projects')
        .update({ user_id: adminUserId })
        .is('user_id', null);

      if (updateError) {
        console.error('❌ Error migrating projects:', updateError);
      } else {
        console.log('✅ Projects migrated to admin user');
      }
    } else {
      console.log('ℹ️  No existing projects to migrate');
    }

    // 4. Verify setup
    console.log('🔍 Verifying setup...');
    const { data: adminMetadata } = await supabase
      .from('user_metadata')
      .select('*')
      .eq('id', adminUserId)
      .single();

    const { data: adminProjects } = await supabase
      .from('takeoff_projects')
      .select('id, name')
      .eq('user_id', adminUserId);

    console.log('\n📊 Setup Summary:');
    console.log('==================');
    console.log(`Admin Email: ${adminEmail}`);
    console.log(`Admin Password: ${adminPassword}`);
    console.log(`Admin User ID: ${adminUserId}`);
    console.log(`Admin Role: ${adminMetadata?.role || 'Not found'}`);
    console.log(`Projects Assigned: ${adminProjects?.length || 0}`);

    console.log('\n✅ Admin setup completed successfully!');
    console.log('\n🔐 You can now login with:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run the setup
setupAdmin();
