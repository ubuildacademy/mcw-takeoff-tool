/**
 * Script to create a demo/trial user account in Supabase
 * Run with: npx ts-node src/scripts/createDemoUser.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.error('Please set it in your .env file or environment');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createDemoUser() {
  const email = 'demo@meridiantakeoff.com';
  const password = 'demo321';

  try {
    console.log('🔐 Creating demo user account...');
    console.log(`   Email: ${email}`);

    // Check if user already exists
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error checking existing users:', listError.message);
      process.exit(1);
    }

    const existingUser = existingUsers?.users?.find((u) => u.email === email);
    
    if (existingUser) {
      console.log('⚠️  User already exists. Updating password...');
      
      // Update password for existing user
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        existingUser.id,
        { password }
      );

      if (updateError) {
        console.error('❌ Error updating password:', updateError.message);
        process.exit(1);
      }

      console.log('✅ Password updated successfully');
      
      // Check and update user metadata
      const { data: existingMetadata } = await supabaseAdmin
        .from('user_metadata')
        .select('*')
        .eq('id', existingUser.id)
        .single();

      if (!existingMetadata || existingMetadata.role !== 'user') {
        // Update or create metadata
        const { error: metadataError } = await supabaseAdmin
          .from('user_metadata')
          .upsert({
            id: existingUser.id,
            role: 'user',
            full_name: 'Demo User',
            company: 'Meridian Takeoff'
          }, { onConflict: 'id' });

        if (metadataError) {
          console.error('❌ Error updating user metadata:', metadataError.message);
          process.exit(1);
        }
        
        console.log('✅ User metadata updated (role: user)');
      } else {
        console.log('✅ User metadata already correct (role: user)');
      }

      console.log('\n✅ Demo user ready!');
      console.log(`   User ID: ${existingUser.id}`);
      console.log(`   Email: ${email}`);
      console.log(`   Password: ${password}`);
      console.log(`   Role: user (non-admin)`);
      console.log('\n📝 The demo user will only see projects they create.');
      console.log('   You can now log in as this user and set up a demo project.');
      
      return;
    }

    // Create new user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email so they can log in immediately
      user_metadata: {
        full_name: 'Demo User',
        company: 'Meridian Takeoff'
      }
    });

    if (createError) {
      console.error('❌ Error creating user:', createError.message);
      process.exit(1);
    }

    if (!newUser.user) {
      console.error('❌ User creation succeeded but no user returned');
      process.exit(1);
    }

    console.log('✅ User created successfully');

    // Create user metadata with role 'user' (not admin)
    const { error: metadataError } = await supabaseAdmin
      .from('user_metadata')
      .insert({
        id: newUser.user.id,
        role: 'user',
        full_name: 'Demo User',
        company: 'Meridian Takeoff'
      });

    if (metadataError) {
      console.error('❌ Error creating user metadata:', metadataError.message);
      console.error('   User was created but metadata failed. You may need to set role manually.');
      process.exit(1);
    }

    console.log('✅ User metadata created (role: user)');

    console.log('\n✅ Demo user account created successfully!');
    console.log(`   User ID: ${newUser.user.id}`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Role: user (non-admin)`);
    console.log('\n📝 The demo user will only see projects they create.');
    console.log('   You can now log in as this user and set up a demo project.');

  } catch (error) {
    console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the script
createDemoUser()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

